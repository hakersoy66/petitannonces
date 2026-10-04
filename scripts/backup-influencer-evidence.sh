#!/usr/bin/env bash
set -euo pipefail
SOURCE=/var/www/petitannonces/shared/private/influencer-evidence
DEST=/var/www/petitannonces/backups/influencer-evidence
if [[ ! -d "$SOURCE" ]]; then
  echo "No influencer evidence directory yet; no private files to back up."
  exit 0
fi
install -d -m 0700 -o petitannonces -g petitannonces "$DEST"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
out="$DEST/influencer-evidence-$timestamp.tar.gz"
tmp="$out.tmp"
trap 'rm -f "$tmp"' EXIT
sudo -u petitannonces tar -C "$SOURCE" -czf "$tmp" .
sudo -u petitannonces tar -tzf "$tmp" >/dev/null
mv "$tmp" "$out"
chown petitannonces:petitannonces "$out"
chmod 600 "$out"
find "$DEST" -maxdepth 1 -type f -name 'influencer-evidence-*.tar.gz' -mtime +7 -delete
echo "$out"
