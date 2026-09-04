#!/usr/bin/env bash
set -euo pipefail

SHA="${1:-}"
if [[ -z "$SHA" ]]; then echo "usage: deploy-production.sh <git-sha>" >&2; exit 2; fi

BASE="${PA_DEPLOY_BASE:-/var/www/petitannonces}"
SOURCE="$BASE/source"
RELEASES="$BASE/releases"
SHARED="$BASE/shared"
BACKUPS="$BASE/backups"
REPO_URL="${PA_REPO_URL:-https://github.com/hakersoy66/petitannonces.git}"
RELEASE="$RELEASES/$SHA"
CURRENT="$BASE/current"
PREVIOUS=""

for cmd in git pnpm pm2 curl pg_dump psql sha256sum python3; do command -v "$cmd" >/dev/null || { echo "Missing command: $cmd" >&2; exit 3; }; done
mkdir -p "$RELEASES" "$SHARED" "$BACKUPS"
[[ -f "$SHARED/.env" ]] || { echo "Missing $SHARED/.env" >&2; exit 4; }

if [[ -L "$CURRENT" ]]; then PREVIOUS="$(readlink -f "$CURRENT")"; fi

if [[ ! -d "$SOURCE/.git" ]]; then
  git clone --filter=blob:none "$REPO_URL" "$SOURCE"
fi

git -C "$SOURCE" fetch --prune origin main
git -C "$SOURCE" cat-file -e "$SHA^{commit}"

if [[ -e "$RELEASE" ]]; then
  git -C "$SOURCE" worktree remove --force "$RELEASE" 2>/dev/null || rm -rf "$RELEASE"
fi
git -C "$SOURCE" worktree add --detach "$RELEASE" "$SHA"
ln -sfn "$SHARED/.env" "$RELEASE/.env"

cd "$RELEASE"
corepack enable >/dev/null 2>&1 || true
if [[ -f pnpm-lock.yaml ]]; then
  pnpm install --frozen-lockfile
else
  echo "WARNING: pnpm-lock.yaml missing; installing with --no-frozen-lockfile." >&2
  pnpm install --no-frozen-lockfile
fi
pnpm build

test -d apps/web/.next
test -d apps/admin/.next
test -f apps/api/dist/apps/api/src/index.js

set -a
# shellcheck disable=SC1090
source "$SHARED/.env"
set +a
: "${DATABASE_URL:?DATABASE_URL must exist in shared .env}"
# shellcheck disable=SC1091
source scripts/lib/database-url.sh
PG_DATABASE_URL="$(pg_url_from_prisma "$DATABASE_URL")"

backup="$BACKUPS/pre-${SHA}-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump "$PG_DATABASE_URL" --format=custom --no-owner --no-acl --file="$backup"

bash scripts/apply-sql-migrations.sh

ln -sfn "$RELEASE" "$CURRENT"
export APP_VERSION="$SHA"
pm2 startOrReload "$CURRENT/infra/pm2/ecosystem.config.cjs" --update-env
pm2 save

healthy=false
for _ in $(seq 1 20); do
  if curl --fail --silent --max-time 3 http://127.0.0.1:4000/health/ready >/dev/null; then healthy=true; break; fi
  sleep 2
done

if [[ "$healthy" != "true" ]]; then
  echo "Health check failed for $SHA; rolling application symlink back." >&2
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    ln -sfn "$PREVIOUS" "$CURRENT"
    export APP_VERSION="$(basename "$PREVIOUS")"
    pm2 startOrReload "$CURRENT/infra/pm2/ecosystem.config.cjs" --update-env
    pm2 save
  fi
  exit 10
fi

printf '%s\n' "$SHA" > "$SHARED/last-successful-release"
find "$BACKUPS" -type f -name '*.dump' -mtime +14 -delete || true

mapfile -t old_releases < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | tail -n +6 | cut -d' ' -f2-)
for old in "${old_releases[@]}"; do
  [[ "$(readlink -f "$CURRENT")" == "$old" ]] && continue
  git -C "$SOURCE" worktree remove --force "$old" 2>/dev/null || rm -rf "$old"
done

echo "Deployment successful: $SHA"
