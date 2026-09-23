#!/usr/bin/env bash
set -euo pipefail

VERSION_CODE="${1:-$(date +%Y%m%d%H)}"
if [[ ! "$VERSION_CODE" =~ ^[0-9]+$ ]] || (( VERSION_CODE < 1 || VERSION_CODE > 2100000000 )); then
  echo "Usage: $0 [versionCode<=2100000000]" >&2
  exit 2
fi

ROOT=/var/www/petitannonces/repository
BASE=/var/www/petitannonces/shared/local-android-build
WORK="${MOBILE_LOCAL_AAB_WORK_DIR:-$BASE/aab-work-$VERSION_CODE}"
SDK=/opt/android-sdk
GRADLE_HOME=$BASE/gradle-home
FIREBASE=/var/www/petitannonces/shared/android-firebase/google-services.json
CREDS=/var/www/petitannonces/shared/android-signing/credentials.json
KEYSTORE=/var/www/petitannonces/shared/android-signing/production-upload.jks
OUT="${PA_ANDROID_AAB_OUT:-$ROOT/apps/mobile/dist-android-production/petitannonces-production.aab}"
OUT_DIR="$(dirname "$OUT")"
trap 'rm -rf "$WORK"' EXIT

for f in "$FIREBASE" "$CREDS" "$KEYSTORE"; do
  [[ -f "$f" ]] || { echo "Missing required file: $f" >&2; exit 2; }
done

rm -rf "$WORK"
mkdir -p "$WORK" "$OUT_DIR"
rsync -a --delete   --exclude node_modules   --exclude 'apps/*/node_modules'   --exclude '.next*'   --exclude 'apps/mobile/android'   --exclude 'apps/mobile/ios'   --exclude 'apps/mobile/dist-*'   "$ROOT/" "$WORK/"

cd "$WORK"
CI=1 pnpm install --frozen-lockfile
cd apps/mobile
rm -rf android ios
cp "$FIREBASE" google-services.json

APP_VARIANT=production PA_ANDROID_VERSION_CODE="$VERSION_CODE" EXPO_PUBLIC_API_URL=https://petitannonces.fr/api GOOGLE_SERVICES_JSON=./google-services.json CI=1 npx expo prebuild --platform android --clean

cp "$FIREBASE" android/app/google-services.json

python3 - "$VERSION_CODE" "$KEYSTORE" "$CREDS" <<'PY'
from pathlib import Path
import json, sys

version_code, keystore, creds_path = sys.argv[1:]
creds = json.load(open(creds_path))['android']['keystore']
p = Path('android/app/build.gradle')
s = p.read_text()

if f'versionCode {version_code}\n' not in s:
    raise SystemExit(f'generated build.gradle versionCode mismatch: expected {version_code}')

marker = """signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }"""
replacement = f"""signingConfigs {{
        debug {{
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }}
        release {{
            storeFile file({keystore!r})
            storePassword System.getenv('PA_ANDROID_KS_PASS')
            keyAlias System.getenv('PA_ANDROID_KEY_ALIAS')
            keyPassword System.getenv('PA_ANDROID_KEY_PASS')
        }}
    }}"""
if marker not in s:
    raise SystemExit('signingConfigs marker not found in generated build.gradle')
s = s.replace(marker, replacement, 1)
if s.count('signingConfig signingConfigs.debug') < 2:
    raise SystemExit('release signingConfig marker not found')
head, sep, tail = s.rpartition('signingConfig signingConfigs.debug')
s = head + 'signingConfig signingConfigs.release' + tail
p.write_text(s)
PY

grep -q "versionCode $VERSION_CODE" android/app/build.gradle || { echo "versionCode verification failed" >&2; exit 4; }
python3 - <<'PYVERIFY'
from pathlib import Path
s=Path('android/app/build.gradle').read_text()
if s.count('signingConfig signingConfigs.debug') != 1:
    raise SystemExit('debug signing verification failed')
if s.count('signingConfig signingConfigs.release') != 1:
    raise SystemExit('release signing verification failed')
if 'versionCode ' not in s:
    raise SystemExit('versionCode verification failed')
print('gradle release identity/signing verified')
PYVERIFY

eval "$(python3 - "$CREDS" <<'PYENV'
import json, shlex, sys
c=json.load(open(sys.argv[1]))['android']['keystore']
print('export PA_ANDROID_KS_PASS='+shlex.quote(c['keystorePassword']))
print('export PA_ANDROID_KEY_ALIAS='+shlex.quote(c['keyAlias']))
print('export PA_ANDROID_KEY_PASS='+shlex.quote(c['keyPassword']))
PYENV
)"

export ANDROID_HOME="$SDK"
export ANDROID_SDK_ROOT="$SDK"
export GRADLE_USER_HOME="$GRADLE_HOME"
export NODE_ENV=production

./android/gradlew -p android :app:bundleRelease   -PreactNativeArchitectures=arm64-v8a,armeabi-v7a   --no-daemon --no-parallel -Dorg.gradle.workers.max=2

BUNDLE=android/app/build/outputs/bundle/release/app-release.aab
[[ -f "$BUNDLE" ]] || { echo "AAB not produced: $BUNDLE" >&2; exit 3; }
cp -f "$BUNDLE" "$OUT"
chmod 0644 "$OUT"

echo "AAB=$OUT"
echo "VERSION_CODE=$VERSION_CODE"
sha256sum "$OUT"
