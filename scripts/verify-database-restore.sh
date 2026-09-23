#!/usr/bin/env bash
set -euo pipefail
LATEST=$(find /var/www/petitannonces/backups -maxdepth 1 -type f -name 'petitannonces-*.dump' -printf '%T@ %p\n' | sort -nr | sed -n '1s/^[^ ]* //p')
[ -n "$LATEST" ] || { echo "restore_drill_failed no_backup_found" >&2; exit 1; }
TMP=/tmp/pa-restore-drill-$$.dump
TESTDB="petitannonces_restore_drill_$(date +%s)"
cleanup(){ rm -f "$TMP"; sudo -u postgres dropdb --if-exists "$TESTDB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cp "$LATEST" "$TMP"
chmod 644 "$TMP"
sudo -u postgres createdb "$TESTDB"
sudo -u postgres pg_restore --no-owner --no-acl --dbname="$TESTDB" "$TMP"
TABLES=$(sudo -u postgres psql -d "$TESTDB" -Atc "select count(*) from pg_tables where schemaname='public';")
[ "$TABLES" -ge 50 ] || { echo "restore_drill_failed tables=$TABLES" >&2; exit 1; }
echo "restore_drill_ok backup=$(basename "$LATEST") tables=$TABLES"
HEALTH_DIR=/var/www/petitannonces/shared/health
mkdir -p "$HEALTH_DIR"
printf '{"ok":true,"completedAt":"%s","backup":"%s","tables":%s}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$LATEST")" "$TABLES" > "$HEALTH_DIR/restore-drill.json.tmp"
mv "$HEALTH_DIR/restore-drill.json.tmp" "$HEALTH_DIR/restore-drill.json"
chmod 640 "$HEALTH_DIR/restore-drill.json"
