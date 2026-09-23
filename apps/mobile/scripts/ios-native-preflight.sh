#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_BUNDLE="fr.petitannonces.app"

cd "$ROOT"

actual_bundle="$(APP_VARIANT=production pnpm exec expo config --type public --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(String(j.ios?.bundleIdentifier||""))})')"
if [[ "$actual_bundle" != "$EXPECTED_BUNDLE" ]]; then
  echo "[ios-preflight] BLOCKED: expected bundle id $EXPECTED_BUNDLE, got ${actual_bundle:-<empty>}" >&2
  exit 1
fi

if [[ "${1:-}" == "--signing" ]]; then
  required=(
    APPLE_TEAM_ID
    APP_STORE_CONNECT_KEY_ID
    APP_STORE_CONNECT_ISSUER_ID
    APP_STORE_CONNECT_API_KEY_B64
    IOS_DISTRIBUTION_CERT_P12_BASE64
    IOS_DISTRIBUTION_CERT_PASSWORD
    IOS_PROVISIONING_PROFILE_BASE64
  )
  for name in "${required[@]}"; do
    if [[ -z "${!name:-}" ]]; then
      echo "[ios-preflight] BLOCKED: missing $name" >&2
      exit 1
    fi
  done
fi

echo "[ios-preflight] identity OK: $actual_bundle"
