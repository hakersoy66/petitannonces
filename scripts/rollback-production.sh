#!/usr/bin/env bash
set -euo pipefail

BASE="${PA_DEPLOY_BASE:-/var/www/petitannonces}"
RELEASES="$BASE/releases"
CURRENT="$BASE/current"
TARGET="${1:-}"

if [[ -z "$TARGET" ]]; then
  current_real="$(readlink -f "$CURRENT" 2>/dev/null || true)"
  mapfile -t releases < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2-)
  for release in "${releases[@]}"; do
    if [[ "$release" != "$current_real" ]]; then TARGET="$release"; break; fi
  done
else
  [[ "$TARGET" = /* ]] || TARGET="$RELEASES/$TARGET"
fi

[[ -n "$TARGET" && -d "$TARGET" ]] || { echo "No rollback release available" >&2; exit 2; }
[[ -f "$TARGET/infra/pm2/ecosystem.config.cjs" ]] || { echo "Invalid release: $TARGET" >&2; exit 3; }

ln -sfn "$TARGET" "$CURRENT"
export APP_VERSION="$(basename "$TARGET")"
pm2 startOrReload "$CURRENT/infra/pm2/ecosystem.config.cjs" --update-env
pm2 save

for _ in $(seq 1 20); do
  if curl --fail --silent --max-time 3 http://127.0.0.1:4000/health/ready >/dev/null; then
    echo "Application rollback successful: $(basename "$TARGET")"
    exit 0
  fi
  sleep 2
done

echo "Rollback target failed health check" >&2
exit 10
