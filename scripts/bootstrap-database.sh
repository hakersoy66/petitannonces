#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

if [[ "${PA_ALLOW_DB_BOOTSTRAP:-false}" != "true" ]]; then
  echo "Refusing database bootstrap. Set PA_ALLOW_DB_BOOTSTRAP=true explicitly." >&2
  exit 2
fi

existing_tables="$(psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_tables WHERE schemaname='public';")"
if [[ "$existing_tables" != "0" ]]; then
  echo "Refusing bootstrap: public schema is not empty ($existing_tables tables)." >&2
  exit 3
fi

pnpm --filter @pa/database exec prisma db push --skip-generate
bash scripts/apply-sql-migrations.sh

echo "Database bootstrap completed."
