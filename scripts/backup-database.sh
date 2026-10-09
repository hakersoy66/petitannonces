#!/usr/bin/env bash
set -euo pipefail
ENV=/var/www/petitannonces/shared/.env
BACKUP_DIR=/var/www/petitannonces/backups
APP_USER=petitannonces

set -a
. "$ENV"
set +a
: "${DATABASE_URL:?DATABASE_URL is required}"

mkdir -p "$BACKUP_DIR"
chown "$APP_USER:$APP_USER" "$BACKUP_DIR"
chmod 750 "$BACKUP_DIR"

# Prisma-style query params (notably ?schema=public) are not accepted by pg_dump.
PG_URL=$(python3 - "$DATABASE_URL" <<'PY'
import sys
from urllib.parse import urlsplit,urlunsplit,parse_qsl,urlencode
u=urlsplit(sys.argv[1])
q=[(k,v) for k,v in parse_qsl(u.query,keep_blank_values=True) if k not in {'schema'}]
print(urlunsplit((u.scheme,u.netloc,u.path,urlencode(q),u.fragment)))
PY
)

ts=$(date -u +%Y%m%dT%H%M%SZ)
out="$BACKUP_DIR/petitannonces-$ts.dump"
tmp="$out.tmp"
trap 'rm -f "$tmp"' EXIT

sudo -u "$APP_USER" pg_dump --format=custom --no-owner --no-acl --dbname="$PG_URL" --file="$tmp"
# Verify archive readability before accepting it as a backup.
sudo -u "$APP_USER" pg_restore --list "$tmp" >/dev/null
mv "$tmp" "$out"
chown "$APP_USER:$APP_USER" "$out"
chmod 600 "$out"
# Keep several recoverable points in time instead of deleting every backup
# whenever a new one is written. At a three-hour cadence, 24 files = 72 hours.
# These files are chmod 600; cleanup only affects older *validated* dumps.
BACKUP_RETENTION_COUNT=24
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'petitannonces-*.dump' -printf '%T@ %p\n' |
  sort -rn | tail -n "+$((BACKUP_RETENTION_COUNT+1))" |
  cut -d' ' -f2- | while IFS= read -r old; do
    [ -n "$old" ] && rm -f -- "$old"
  done
printf '%s\n' "$out"
