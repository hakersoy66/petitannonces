#!/usr/bin/env bash
set -euo pipefail

ROOT=/var/www/petitannonces/repository
SHARED=/var/www/petitannonces/shared
LOCK=/run/lock/pa-agent-release.lock
MESSAGE="${*:-agent: production release $(date -u +%Y-%m-%dT%H:%M:%SZ)}"

exec 9>"$LOCK"
flock -n 9 || { echo "Another Petit Annonces release is running." >&2; exit 75; }
cd "$ROOT"

git restore --source=HEAD --worktree -- apps/web/next-env.d.ts apps/admin/next-env.d.ts 2>/dev/null || true
git add -u

if git diff --cached --quiet; then
  echo "No staged/tracked task changes to release. Stage any new task files first." >&2
  exit 3
fi

if git diff --cached --name-only | grep -E '(^|/)(\.env($|\.)|credentials\.json$|google-services\.json$|.*\.(jks|keystore|pem|key)$)' >/dev/null; then
  echo "Refusing release: staged secret/credential material detected." >&2
  exit 4
fi

git diff --cached --check
sudo -u petitannonces pnpm --filter @pa/api typecheck
sudo -u petitannonces pnpm --filter @pa/web typecheck
sudo -u petitannonces pnpm --filter @pa/admin typecheck
sudo -u petitannonces pnpm --filter @pa/mobile typecheck

git config user.name "Petit Annonces Agent"
git config user.email "agent@petitannonces.local"
git commit -m "$MESSAGE"
SHA="$(git rev-parse HEAD)"

bash "$ROOT/scripts/deploy-production.sh" "$SHA"

mkdir -p "$SHARED"
if git push origin "$SHA:refs/heads/main"; then
  rm -f "$SHARED/git-sync-pending"
  echo "GitHub mirror synchronized: $SHA"
else
  printf '%s\n' "$SHA" > "$SHARED/git-sync-pending"
  chown petitannonces:petitannonces "$SHARED/git-sync-pending" 2>/dev/null || true
  echo "Production is healthy; GitHub sync is pending for $SHA." >&2
fi

echo "Agent release complete: $SHA"
