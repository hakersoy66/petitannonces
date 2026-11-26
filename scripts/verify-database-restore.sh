#!/usr/bin/env bash
set -euo pipefail
umask 077
HEALTH_DIR=/var/www/petitannonces/shared/health
mkdir -p "$HEALTH_DIR"
exec 8>/run/lock/petitannonces-restore-drill.lock
flock -n 8 || { echo "restore drill already running"; exit 1; }
exec 9>/run/lock/petitannonces-recovery-snapshot.lock
flock -s -w 120 9
LATEST=/srv/petitannonces-recovery/latest/postgresql.dump
MANIFEST=/srv/petitannonces-recovery/latest/SHA256SUMS
TESTDB="petitannonces_restore_drill_$(date +%s)_$$"
created=0
success=0
reason=unknown
write_marker(){
 local ok="$1" tables="$2" why="$3"
 local f
 f=$(mktemp "$HEALTH_DIR/.restore-drill.XXXXXX")
 printf '{"ok":%s,"completedAt":"%s","source":"recovery-snapshot","tables":%s,"reason":"%s"}\n' "$ok" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$tables" "$why" > "$f"
 chown root:petitannonces "$f"; chmod 640 "$f"
 mv -f "$f" "$HEALTH_DIR/restore-drill.json"
}
cleanup(){
 local code=$?
 if (( created )); then sudo -u postgres dropdb --if-exists "$TESTDB" >/dev/null 2>&1 || { success=0; reason=cleanup_failed; code=1; }; fi
 if (( success )); then write_marker true "$TABLES" verified; else write_marker false 0 "$reason"; fi
 exit "$code"
}
trap cleanup EXIT
reason=missing_snapshot
[[ -s "$LATEST" && -s "$MANIFEST" ]]
reason=stale_snapshot
age=$(( $(date +%s) - $(stat -c %Y "$LATEST") ))
(( age >= 0 && age <= 6 * 3600 ))
reason=checksum_failed
expected=$(awk '$2=="postgresql.dump"{print $1}' "$MANIFEST")
[[ "$expected" =~ ^[0-9a-f]{64}$ ]]
[[ "$(sha256sum "$LATEST" | cut -d' ' -f1)" == "$expected" ]]
pg_restore --list "$LATEST" >/dev/null
reason=create_test_database_failed
sudo -u postgres createdb "$TESTDB"
created=1
reason=restore_failed
sudo -u postgres pg_restore --exit-on-error --no-owner --no-acl --dbname="$TESTDB" < "$LATEST"
reason=validation_failed
TABLES=$(sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d "$TESTDB" -Atc "SELECT COUNT(*) FROM pg_tables WHERE schemaname='public';")
(( TABLES >= 50 ))
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d "$TESTDB" -Atc 'SELECT COUNT(*) FROM "User"; SELECT COUNT(*) FROM "Listing"; SELECT COUNT(*) FROM "MarketplaceOrder";' >/dev/null
success=1
echo "restore_drill_ok tables=$TABLES source=recovery-snapshot"
