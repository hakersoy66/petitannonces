#!/usr/bin/env bash
set -euo pipefail
VERSION_CODE="${1:-}"
if [[ ! "$VERSION_CODE" =~ ^[0-9]+$ ]]; then
  echo "Usage: $0 <versionCode>" >&2
  exit 2
fi
ROOT=/var/www/petitannonces/repository
BASE=/var/www/petitannonces/shared/local-android-build
WORK=${MOBILE_LOCAL_WORK_DIR:-$BASE/work-$VERSION_CODE}
SDK=/opt/android-sdk
GRADLE_HOME=$BASE/gradle-home
TMPDIR=$BASE/tmp-$VERSION_CODE
FIREBASE=/var/www/petitannonces/shared/android-firebase/google-services.json
CREDS=/var/www/petitannonces/shared/android-signing/credentials.json
KEYSTORE=/var/www/petitannonces/shared/android-signing/production-upload.jks
ARTIFACT=$BASE/artifacts/petitannonces-android-test-${VERSION_CODE}-signed.apk
RELEASE_ARTIFACT=/var/www/petitannonces/shared/android-release/petitannonces-1.0.0-${VERSION_CODE}-LOCAL-TEST.apk
LATEST=/var/www/petitannonces/shared/android-release/petitannonces-latest.apk
mkdir -p "$BASE/artifacts" /var/www/petitannonces/shared/android-release "$TMPDIR"
chmod 0700 "$TMPDIR"
if [ ! -d "$WORK/node_modules" ]; then
  rm -rf "$WORK"
  mkdir -p "$WORK"
fi
rsync -a --delete --exclude node_modules --exclude 'apps/*/node_modules' --exclude '.next*' --exclude 'apps/mobile/android' --exclude 'apps/mobile/ios' --exclude 'apps/mobile/dist-*' --exclude 'scripts/backup-database-offsite.sh' --exclude 'scripts/media-inventory-offsite.py' --exclude 'scripts/verify-database-restore.sh' --exclude 'scripts/__pycache__' "$ROOT/" "$WORK/"
cd "$WORK"
CI=1 pnpm install --frozen-lockfile
cd apps/mobile
rm -rf android ios
cp "$FIREBASE" google-services.json
APP_VARIANT=production EXPO_PUBLIC_API_URL=https://petitannonces.fr/api GOOGLE_SERVICES_JSON=./google-services.json npx expo prebuild --platform android --clean --non-interactive
cp "$FIREBASE" android/app/google-services.json
python3 - "$VERSION_CODE" <<'PY'
from pathlib import Path
import sys
p=Path('android/app/build.gradle')
s=p.read_text()
s=s.replace('versionCode 1\n', f'versionCode {sys.argv[1]}\n', 1)
p.write_text(s)
PY
export ANDROID_HOME="$SDK"
export ANDROID_SDK_ROOT="$SDK"
export GRADLE_USER_HOME="$GRADLE_HOME"
export TMPDIR
export NODE_ENV=production
./android/gradlew -p android :app:assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a --no-daemon --no-parallel -Dorg.gradle.workers.max=2 -x lintVitalAnalyzeRelease
UNSIGNED=android/app/build/outputs/apk/release/app-release.apk
python3 - "$UNSIGNED" "$ARTIFACT" <<'PY'
import json, os, subprocess, sys
src,out=sys.argv[1:]
c=json.load(open('/var/www/petitannonces/shared/android-signing/credentials.json'))['android']['keystore']
os.environ['KS_PASS']=c['keystorePassword']
os.environ['KEY_PASS']=c['keyPassword']
subprocess.check_call(['/opt/android-sdk/build-tools/36.0.0/apksigner','sign','--ks','/var/www/petitannonces/shared/android-signing/production-upload.jks','--ks-key-alias',c['keyAlias'],'--ks-pass','env:KS_PASS','--key-pass','env:KEY_PASS','--out',out,src])
PY
/opt/android-sdk/build-tools/36.0.0/apksigner verify --verbose "$ARTIFACT"
cp -f "$ARTIFACT" "$RELEASE_ARTIFACT"
chmod 0644 "$ARTIFACT" "$RELEASE_ARTIFACT"
ln -sfn "$(basename "$RELEASE_ARTIFACT")" "$LATEST"
echo "APK=$ARTIFACT"
echo "RELEASE_APK=$RELEASE_ARTIFACT"
sha256sum "$ARTIFACT"
