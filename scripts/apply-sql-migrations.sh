#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

# shellcheck disable=SC1091
source scripts/lib/database-url.sh
PG_DATABASE_URL="$(pg_url_from_prisma "$DATABASE_URL")"

psql "$PG_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS pa_sql_migrations (
  name text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

mapfile -t files < <(
  find packages/database/prisma/migrations -mindepth 2 -maxdepth 2 -name migration.sql -type f | while read -r file; do
    name="$(basename "$(dirname "$file")")"
    phase="$(printf '%s' "$name" | sed -n 's/.*_phase\([0-9][0-9]*\)_.*/\1/p')"
    [[ -n "$phase" ]] || phase=999
    printf '%04d\t%s\n' "$phase" "$file"
  done | sort -n -k1,1 -k2,2 | cut -f2-
)

for file in "${files[@]}"; do
  name="$(basename "$(dirname "$file")")"
  checksum="$(sha256sum "$file" | awk '{print $1}')"
  [[ "$name" =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "Unsafe migration name: $name" >&2; exit 1; }
  [[ "$checksum" =~ ^[a-f0-9]{64}$ ]] || { echo "Invalid checksum: $checksum" >&2; exit 1; }
  existing="$(psql "$PG_DATABASE_URL" -At -v ON_ERROR_STOP=1 -c "SELECT checksum FROM pa_sql_migrations WHERE name = '$name';")"

  if [[ -n "$existing" ]]; then
    if [[ "$existing" != "$checksum" ]]; then
      echo "Migration checksum mismatch: $name" >&2
      exit 1
    fi
    echo "Already applied: $name"
    continue
  fi

  echo "Applying: $name"
  psql "$PG_DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
BEGIN;
\i '$file'
INSERT INTO pa_sql_migrations(name, checksum) VALUES ('$name', '$checksum');
COMMIT;
SQL
done
