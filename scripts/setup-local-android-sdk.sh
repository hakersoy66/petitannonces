#!/usr/bin/env bash
set -euo pipefail
SDK_ROOT="${ANDROID_SDK_ROOT:-/opt/android-sdk}"
TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-15859902_latest.zip"
TOOLS_SHA256="4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583"

if [[ "${PA_ANDROID_SDK_LICENSE_ACCEPTED:-}" != "true" ]]; then
  cat <<'MSG'
Android SDK installation paused.
Google Android SDK license acceptance is required before downloading/installing SDK packages.
Review: https://developer.android.com/studio/terms
After the account owner explicitly accepts the terms, rerun with:
  PA_ANDROID_SDK_LICENSE_ACCEPTED=true sudo -E bash scripts/setup-local-android-sdk.sh
MSG
  exit 3
fi

command -v java >/dev/null || { echo "JDK is missing" >&2; exit 2; }
command -v unzip >/dev/null || { echo "unzip is missing" >&2; exit 2; }
mkdir -p "$SDK_ROOT/cmdline-tools" /tmp/pa-android-sdk
ZIP=/tmp/pa-android-sdk/cmdline-tools.zip
curl -fL "$TOOLS_URL" -o "$ZIP"
echo "$TOOLS_SHA256  $ZIP" | sha256sum -c -
rm -rf "$SDK_ROOT/cmdline-tools/latest" /tmp/pa-android-sdk/unpack
mkdir -p /tmp/pa-android-sdk/unpack
unzip -q "$ZIP" -d /tmp/pa-android-sdk/unpack
mv /tmp/pa-android-sdk/unpack/cmdline-tools "$SDK_ROOT/cmdline-tools/latest"
export ANDROID_SDK_ROOT="$SDK_ROOT"
export PATH="$SDK_ROOT/cmdline-tools/latest/bin:$SDK_ROOT/platform-tools:$PATH"
yes | sdkmanager --licenses >/tmp/pa-sdk-licenses.log
sdkmanager "platform-tools" "platforms;android-36" "build-tools;35.0.0"
chown -R petitannonces:petitannonces "$SDK_ROOT"
cat >/etc/profile.d/petitannonces-android-sdk.sh <<EOF
export ANDROID_SDK_ROOT="$SDK_ROOT"
export ANDROID_HOME="$SDK_ROOT"
export PATH="\$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:\$ANDROID_SDK_ROOT/platform-tools:\$PATH"
EOF
printf 'Android SDK ready: %s\n' "$SDK_ROOT"
sdkmanager --list_installed | sed -n '1,80p'
