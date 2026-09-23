#!/usr/bin/env bash
set -euo pipefail
ROOT=/var/www/petitannonces/repository
ENV=/var/www/petitannonces/shared/.env
STATE=/var/www/petitannonces/shared/active-color
NGINX=/etc/nginx/sites-available/petitannonces-bootstrap
APP_USER=petitannonces
cd "$ROOT"

DEPLOY_SHA="${1:?missing deploy SHA}"

# Next.js rewrites next-env.d.ts to the active blue/green dist directory during
# builds. These generated references are never a human production edit.
git restore --source=HEAD --worktree -- \
  apps/web/next-env.d.ts apps/admin/next-env.d.ts 2>/dev/null || true

# Refuse to overwrite any remaining tracked live edits. Untracked runtime/build
# files are intentionally ignored because production keeps blue/green outputs.
if ! git diff --quiet --ignore-submodules -- || ! git diff --cached --quiet --ignore-submodules --; then
  echo "Tracked production changes detected; refusing automated deploy." >&2
  git status --short --untracked-files=no >&2
  exit 1
fi

# Fetch and validate the exact commit that passed CI before touching production.
git fetch --quiet --no-tags origin "$DEPLOY_SHA"
git cat-file -e "$DEPLOY_SHA^{commit}"

# A verified PostgreSQL backup is mandatory before each production release.
sudo bash "$ROOT/scripts/backup-database.sh" >/dev/null

# Make the server source tree match the exact CI-tested commit.
git reset --hard "$DEPLOY_SHA"
sudo -u "$APP_USER" pnpm install --frozen-lockfile

active=$(cat "$STATE" 2>/dev/null || echo green)
if [ "$active" = green ]; then
  next=blue; web_port=3000; admin_port=3001; api_port=4000
else
  next=green; web_port=3200; admin_port=3101; api_port=4100
fi

# Build the inactive color into isolated Next.js output directories.
# This is critical for Server Actions: the active color must never have its
# .next files replaced while it is still serving open browser sessions.
WEB_DIST=".next-${next}"
ADMIN_DIST=".next-${next}"

# Clean only the inactive color output. Active color output remains untouched.
sudo rm -rf "$ROOT/apps/web/$WEB_DIST" "$ROOT/apps/admin/$ADMIN_DIST"
chown -R "$APP_USER:$APP_USER" "$ROOT/apps/web" "$ROOT/apps/admin" "$ROOT/apps/api/dist" 2>/dev/null || true

# Build while the active color continues serving traffic.
sudo -u "$APP_USER" pnpm --filter @pa/api build
sudo -u "$APP_USER" env NEXT_DIST_DIR="$WEB_DIST" pnpm --filter @pa/web build
sudo -u "$APP_USER" env NEXT_DIST_DIR="$ADMIN_DIST" pnpm --filter @pa/admin build

# Keep recent immutable Next.js assets from the active release available in the new release.
# Open tabs/PWAs can still request an older hashed chunk for a few minutes after a deploy.
# Only static assets are merged; server manifests and Server Action metadata stay isolated per color.
ACTIVE_WEB_DIST=".next-${active}"
ACTIVE_ADMIN_DIST=".next-${active}"
for pair in "web:$ACTIVE_WEB_DIST:$WEB_DIST" "admin:$ACTIVE_ADMIN_DIST:$ADMIN_DIST"; do
  IFS=: read -r app old_dist new_dist <<< "$pair"
  old_static="$ROOT/apps/$app/$old_dist/static"
  new_static="$ROOT/apps/$app/$new_dist/static"
  if [ -d "$old_static" ]; then
    sudo -u "$APP_USER" mkdir -p "$new_static"
    sudo -u "$APP_USER" cp -a --update=none "$old_static/." "$new_static/"
    # Bound disk growth while keeping a generous compatibility window for stale tabs/PWAs.
    find "$new_static" -type f -mtime +7 -delete 2>/dev/null || true
  fi
done

# Recreate only the inactive color on its own ports.
for svc in web admin api; do sudo -u "$APP_USER" pm2 delete "pa-${svc}-${next}" >/dev/null 2>&1 || true; done
sudo -u "$APP_USER" bash -lc "cd '$ROOT'; set -a; . '$ENV'; set +a; TZ='Europe/Paris' NEXT_DIST_DIR='$WEB_DIST' API_INTERNAL_URL='http://127.0.0.1:$api_port' PORT='$web_port' pm2 start pnpm --name 'pa-web-$next' -- --filter @pa/web start >/dev/null; TZ='Europe/Paris' NEXT_DIST_DIR='$ADMIN_DIST' API_INTERNAL_URL='http://127.0.0.1:$api_port' PORT='$admin_port' pm2 start pnpm --name 'pa-admin-$next' -- --filter @pa/admin start >/dev/null; TZ='Europe/Paris' APP_COLOR='$next' WEB_PORT='$web_port' ADMIN_PORT='$admin_port' API_PORT='$api_port' pm2 start pnpm --name 'pa-api-$next' -- --filter @pa/api start >/dev/null"

# Do not switch traffic until all three services are healthy.
ready=0
for i in $(seq 1 45); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${web_port}/deposer-une-annonce" >/dev/null 2>&1 \
    && curl -fsS --max-time 2 "http://127.0.0.1:${admin_port}/" >/dev/null 2>&1 \
    && curl -fsS --max-time 2 "http://127.0.0.1:${api_port}/health/ready" >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
if [ "$ready" != 1 ]; then
  for svc in web admin api; do sudo -u "$APP_USER" pm2 delete "pa-${svc}-${next}" >/dev/null 2>&1 || true; done
  echo "New release failed health checks; active release was left untouched." >&2
  exit 1
fi

# Atomically change nginx upstream ports while the old color still serves.
sudo python3 - "$NGINX" "$web_port" "$admin_port" "$api_port" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]); web,admin,api=sys.argv[2:]
s=p.read_text()
s=re.sub(r'upstream pa_boot_web \{ server 127\.0\.0\.1:\d+; \}',f'upstream pa_boot_web {{ server 127.0.0.1:{web}; }}',s)
s=re.sub(r'upstream pa_boot_admin \{ server 127\.0\.0\.1:\d+; \}',f'upstream pa_boot_admin {{ server 127.0.0.1:{admin}; }}',s)
s=re.sub(r'upstream pa_boot_api \{ server 127\.0\.0\.1:\d+; \}',f'upstream pa_boot_api {{ server 127.0.0.1:{api}; }}',s)
p.write_text(s)
PY
sudo nginx -t

# Capture the currently-serving nginx workers. After reload, established
# keep-alive connections can remain on these workers and still reference the
# old upstream ports. Never retire the old app color until those workers exit.
nginx_master_pid=$(cat /run/nginx.pid 2>/dev/null || true)
old_nginx_workers=""
if [ -n "$nginx_master_pid" ]; then old_nginx_workers=$(pgrep -P "$nginx_master_pid" 2>/dev/null || true); fi
sudo systemctl reload nginx

# Verify public traffic before considering the switch successful.
for i in $(seq 1 20); do
  if curl -kfsS --max-time 3 https://petitannonces.fr/deposer-une-annonce >/dev/null && curl -kfsS --max-time 3 https://petitannonces.fr/healthz >/dev/null; then break; fi
  sleep 1
done
curl -kfsS --max-time 3 https://petitannonces.fr/deposer-une-annonce >/dev/null
curl -kfsS --max-time 3 https://petitannonces.fr/healthz >/dev/null

printf "%s\n" "$next" | sudo tee "$STATE" >/dev/null
sudo chown "$APP_USER:$APP_USER" "$STATE"

# Gracefully drain nginx workers that still hold the old upstream config.
retire_old=1
if [ -n "$old_nginx_workers" ]; then
  retire_old=0
  for i in $(seq 1 90); do
    still_alive=0
    for pid in $old_nginx_workers; do
      if kill -0 "$pid" 2>/dev/null; then still_alive=1; break; fi
    done
    if [ "$still_alive" = 0 ]; then retire_old=1; break; fi
    sleep 1
  done
fi
if [ "$retire_old" = 1 ]; then
  for svc in web admin api; do sudo -u "$APP_USER" pm2 delete "pa-${svc}-${active}" >/dev/null 2>&1 || true; done
else
  echo "Old nginx workers are still draining; keeping pa-*- $active processes alive to avoid 503s." >&2
fi
# Keep only the two color-specific builds; remove the legacy shared .next after migration.
rm -rf "$ROOT/apps/web/.next" "$ROOT/apps/admin/.next" 2>/dev/null || true
sudo -u "$APP_USER" pm2 save >/dev/null
printf 'Deployment complete: %s -> %s\n' "$active" "$next"
