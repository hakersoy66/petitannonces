#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

# shellcheck disable=SC1091
source scripts/lib/database-url.sh
PG_DATABASE_URL="$(pg_url_from_prisma "$DATABASE_URL")"

export PA_ALLOW_DB_BOOTSTRAP=true
bash scripts/bootstrap-database.sh

psql "$PG_DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT count(*) AS applied_migrations FROM pa_sql_migrations;"
pnpm --filter @pa/database exec prisma validate
