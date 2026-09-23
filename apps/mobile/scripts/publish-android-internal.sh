#!/usr/bin/env bash
set -euo pipefail
ROOT="/var/www/petitannonces/repository/apps/mobile"
VENV="/var/www/petitannonces/shared/play-publisher/venv"
AAB="${PA_ANDROID_AAB:-$ROOT/dist-android-production/petitannonces-production.aab}"
KEY="${GOOGLE_PLAY_SERVICE_ACCOUNT_JSON:-/var/www/petitannonces/shared/android-firebase/fcm-service-account.json}"
[[ -x "$VENV/bin/python" ]] || { echo "publisher venv missing" >&2; exit 2; }
[[ -f "$AAB" ]] || { echo "AAB missing: $AAB" >&2; exit 2; }
[[ -f "$KEY" ]] || { echo "service account key missing: $KEY" >&2; exit 2; }
exec "$VENV/bin/python" "$ROOT/scripts/google-play-publisher.py" upload --track internal --aab "$AAB" --key "$KEY"