#!/usr/bin/env bash
set -euo pipefail

: "${IOS_DISTRIBUTION_CERT_P12_BASE64:?missing IOS_DISTRIBUTION_CERT_P12_BASE64}"
: "${IOS_DISTRIBUTION_CERT_PASSWORD:?missing IOS_DISTRIBUTION_CERT_PASSWORD}"
: "${IOS_PROVISIONING_PROFILE_BASE64:?missing IOS_PROVISIONING_PROFILE_BASE64}"

CERT_PATH="${RUNNER_TEMP:?}/ios-distribution.p12"
PROFILE_PATH="${RUNNER_TEMP:?}/app-store.mobileprovision"
KEYCHAIN_PATH="$RUNNER_TEMP/petitannonces-signing.keychain-db"
KEYCHAIN_PASSWORD="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(32))
PY
)"

echo "$IOS_DISTRIBUTION_CERT_P12_BASE64" | base64 --decode > "$CERT_PATH"
echo "$IOS_PROVISIONING_PROFILE_BASE64" | base64 --decode > "$PROFILE_PATH"

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security import "$CERT_PATH" -P "$IOS_DISTRIBUTION_CERT_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN_PATH"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security list-keychains -d user -s "$KEYCHAIN_PATH" login.keychain-db

PROFILE_PLIST="$RUNNER_TEMP/profile.plist"
security cms -D -i "$PROFILE_PATH" > "$PROFILE_PLIST"
PROFILE_UUID="$(/usr/libexec/PlistBuddy -c 'Print :UUID' "$PROFILE_PLIST")"
PROFILE_NAME="$(/usr/libexec/PlistBuddy -c 'Print :Name' "$PROFILE_PLIST")"
PROFILE_BUNDLE="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$PROFILE_PLIST" | sed 's/^[^.]*\.//')"

if [[ "$PROFILE_BUNDLE" != "fr.petitannonces.app" ]]; then
  echo "[ios-signing] provisioning profile belongs to unexpected bundle: $PROFILE_BUNDLE" >&2
  exit 1
fi

mkdir -p "$HOME/Library/MobileDevice/Provisioning Profiles"
cp "$PROFILE_PATH" "$HOME/Library/MobileDevice/Provisioning Profiles/$PROFILE_UUID.mobileprovision"

echo "IOS_PROVISIONING_PROFILE_NAME=$PROFILE_NAME" >> "${GITHUB_ENV:?}"
echo "[ios-signing] installed Apple Distribution certificate and profile for fr.petitannonces.app"
