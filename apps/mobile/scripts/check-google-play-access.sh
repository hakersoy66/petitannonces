#!/usr/bin/env bash
set -euo pipefail
ROOT="/var/www/petitannonces/repository/apps/mobile"
VENV="/var/www/petitannonces/shared/play-publisher/venv"
KEY="${GOOGLE_PLAY_SERVICE_ACCOUNT_JSON:-/var/www/petitannonces/shared/android-firebase/fcm-service-account.json}"
exec "$VENV/bin/python" "$ROOT/scripts/google-play-publisher.py" check --key "$KEY"