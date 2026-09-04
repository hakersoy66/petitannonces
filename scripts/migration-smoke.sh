#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

export PA_ALLOW_DB_BOOTSTRAP=true
bash scripts/bootstrap-database.sh

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT count(*) AS applied_migrations FROM pa_sql_migrations;"
pnpm --filter @pa/database exec prisma validate
