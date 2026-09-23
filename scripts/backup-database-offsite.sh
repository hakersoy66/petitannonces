#!/usr/bin/env bash
set -euo pipefail
umask 077
ENV=/var/www/petitannonces/shared/.env
LOCAL_BACKUP=/var/www/petitannonces/repository/scripts/backup-database.sh
RETENTION_DAYS=${OFFSITE_BACKUP_RETENTION_DAYS:-30}
set -a
. "$ENV"
set +a
: "${OBJECT_STORAGE_ENDPOINT:?OBJECT_STORAGE_ENDPOINT is required}"
: "${OBJECT_STORAGE_REGION:?OBJECT_STORAGE_REGION is required}"
: "${OBJECT_STORAGE_BUCKET:?OBJECT_STORAGE_BUCKET is required}"
: "${OBJECT_STORAGE_ACCESS_KEY_ID:?OBJECT_STORAGE_ACCESS_KEY_ID is required}"
: "${OBJECT_STORAGE_SECRET_ACCESS_KEY:?OBJECT_STORAGE_SECRET_ACCESS_KEY is required}"
DUMP="$($LOCAL_BACKUP)"
[ -s "$DUMP" ] || { echo "backup file missing or empty" >&2; exit 1; }
SHA256="$(sha256sum "$DUMP" | awk '{print $1}')"
BASENAME="$(basename "$DUMP")"
YEAR="$(date -u +%Y)"; MONTH="$(date -u +%m)"
KEY="disaster-recovery/database/${YEAR}/${MONTH}/${BASENAME}"
python3 - "$DUMP" "$KEY" "$SHA256" "$RETENTION_DAYS" <<'PY'
import os,sys
from datetime import datetime,timezone,timedelta
import boto3
from botocore.config import Config
path,key,sha,retention=sys.argv[1],sys.argv[2],sys.argv[3],int(sys.argv[4])
force_path=os.environ.get("OBJECT_STORAGE_FORCE_PATH_STYLE","").lower() in {"1","true","yes"}
client=boto3.client("s3",endpoint_url=os.environ["OBJECT_STORAGE_ENDPOINT"],region_name=os.environ["OBJECT_STORAGE_REGION"],aws_access_key_id=os.environ["OBJECT_STORAGE_ACCESS_KEY_ID"],aws_secret_access_key=os.environ["OBJECT_STORAGE_SECRET_ACCESS_KEY"],config=Config(signature_version="s3v4",s3={"addressing_style":"path" if force_path else "virtual"}))
bucket=os.environ["OBJECT_STORAGE_BUCKET"]
client.upload_file(path,bucket,key,ExtraArgs={"ACL":"private","ContentType":"application/octet-stream","Metadata":{"sha256":sha,"backup-type":"postgresql-custom"}})
head=client.head_object(Bucket=bucket,Key=key)
if int(head.get("ContentLength",-1)) != os.path.getsize(path): raise SystemExit("offsite verification failed: size mismatch")
if head.get("Metadata",{}).get("sha256") != sha: raise SystemExit("offsite verification failed: checksum metadata mismatch")
cutoff=datetime.now(timezone.utc)-timedelta(days=retention)
token=None; deleted=0
while True:
    kw={"Bucket":bucket,"Prefix":"disaster-recovery/database/"}
    if token: kw["ContinuationToken"]=token
    resp=client.list_objects_v2(**kw)
    old=[{"Key":o["Key"]} for o in resp.get("Contents",[]) if o.get("LastModified") and o["LastModified"]<cutoff]
    if old:
        client.delete_objects(Bucket=bucket,Delete={"Objects":old,"Quiet":True}); deleted+=len(old)
    if not resp.get("IsTruncated"): break
    token=resp.get("NextContinuationToken")
print(f"uploaded={key} size={os.path.getsize(path)} verified=yes retention_deleted={deleted}")
PY
HEALTH_DIR=/var/www/petitannonces/shared/health
mkdir -p "$HEALTH_DIR"
printf '{"ok":true,"completedAt":"%s","backup":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$BASENAME" > "$HEALTH_DIR/offsite-backup.json.tmp"
mv "$HEALTH_DIR/offsite-backup.json.tmp" "$HEALTH_DIR/offsite-backup.json"
chmod 640 "$HEALTH_DIR/offsite-backup.json"
