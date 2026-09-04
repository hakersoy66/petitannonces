#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS pa_sql_migrations (
  name text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

mapfile -t files < <(find packages/database/prisma/migrations -mindepth 2 -maxdepth 2 -name migration.sql -type f | sort)

for file in "${files[@]}"; do
  name="$(basename "$(dirname "$file")")"
  checksum="$(sha256sum "$file" | awk '{print $1}')"
  existing="$(psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 -v name="$name" -c "SELECT checksum FROM pa_sql_migrations WHERE name = :'name';")"

  if [[ -n "$existing" ]]; then
    if [[ "$existing" != "$checksum" ]]; then
      echo "Migration checksum mismatch: $name" >&2
      exit 1
    fi
    echo "Already applied: $name"
    continue
  fi

  echo "Applying: $name"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
BEGIN;
\i '$file'
INSERT INTO pa_sql_migrations(name, checksum) VALUES ('$name', '$checksum');
COMMIT;
SQL
done
