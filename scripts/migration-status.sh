#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
source scripts/lib/database-url.sh
PG_DATABASE_URL="$(pg_url_from_prisma "$DATABASE_URL")"
if ! psql "$PG_DATABASE_URL" -At -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='pa_sql_migrations'" | grep -q 1; then
  echo "migration_registry_missing" >&2; exit 2
fi
missing=0; mismatch=0; checked=0
while IFS= read -r file; do
  name="$(basename "$(dirname "$file")")"; checksum="$(sha256sum "$file" | awk '{print $1}')"; checked=$((checked+1))
  [[ "$name" =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "unsafe_migration_name=$name" >&2; exit 3; }
  existing="$(psql "$PG_DATABASE_URL" -At -v ON_ERROR_STOP=1 -c "SELECT checksum FROM pa_sql_migrations WHERE name='$name'")"
  if [ -z "$existing" ]; then echo "MISSING $name"; missing=$((missing+1)); elif [ "$existing" != "$checksum" ]; then echo "MISMATCH $name"; mismatch=$((mismatch+1)); fi
done < <(find packages/database/prisma/migrations -mindepth 2 -maxdepth 2 -name migration.sql -type f | sort)
echo "checked=$checked missing=$missing mismatch=$mismatch"
[ "$missing" -eq 0 ] && [ "$mismatch" -eq 0 ]
