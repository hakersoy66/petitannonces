#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-/var/www/petitannonces/shared/.env}"
[[ -f "$ENV_FILE" ]] || { echo "Missing env file: $ENV_FILE" >&2; exit 2; }

has_value() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n1 || true)"
  [[ -n "$line" && "${line#*=}" != "" ]]
}

status_group() {
  local name="$1"; shift
  local missing=()
  local key
  for key in "$@"; do
    has_value "$key" || missing+=("$key")
  done
  if ((${#missing[@]} == 0)); then
    printf 'READY   %s\n' "$name"
  else
    printf 'MISSING %-18s %s\n' "$name" "${missing[*]}"
  fi
}

status_group "core" DATABASE_URL REDIS_URL TWO_FACTOR_ENCRYPTION_KEY INTERNAL_CRON_SECRET
status_group "object-storage" OBJECT_STORAGE_ENDPOINT OBJECT_STORAGE_BUCKET OBJECT_STORAGE_ACCESS_KEY_ID OBJECT_STORAGE_SECRET_ACCESS_KEY OBJECT_STORAGE_PUBLIC_BASE_URL
status_group "email-resend" RESEND_API_KEY EMAIL_FROM
status_group "web-push" NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY WEB_PUSH_PRIVATE_KEY WEB_PUSH_SUBJECT
status_group "sms" SMS_GATEWAY_URL SMS_GATEWAY_TOKEN SMS_SENDER
status_group "sendcloud" SENDCLOUD_PUBLIC_KEY SENDCLOUD_PRIVATE_KEY SENDCLOUD_WEBHOOK_SECRET
status_group "payments" MARKETPLACE_PAYMENT_API_URL MARKETPLACE_PAYMENT_API_TOKEN MARKETPLACE_WEBHOOK_SECRET

if has_value OPENSEARCH_URL; then
  echo 'READY   opensearch'
else
  echo 'OPTIONAL opensearch         PostgreSQL fallback active'
fi

if has_value PUSH_NATIVE_GATEWAY_URL && has_value PUSH_NATIVE_GATEWAY_TOKEN; then
  echo 'READY   native-push'
else
  echo 'OPTIONAL native-push        gateway not configured'
fi

if grep -q '^MARKETPLACE_PAYMENT_PROVIDER=mock$' "$ENV_FILE"; then
  echo 'BLOCKER payments-provider   MARKETPLACE_PAYMENT_PROVIDER=mock'
fi

if grep -q '^NOTIFICATION_WORKER_ENABLED=true$' "$ENV_FILE"; then
  echo 'INFO    notification-worker enabled'
else
  echo 'SAFE    notification-worker disabled'
fi
