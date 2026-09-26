#!/usr/bin/env python3
import os, json, hashlib, datetime
from pathlib import Path
for line in Path('/var/www/petitannonces/shared/.env').read_text().splitlines():
    if not line or line.lstrip().startswith('#') or '=' not in line: continue
    k,v=line.split('=',1); os.environ.setdefault(k,v.strip().strip('"').strip("'"))
import boto3
from botocore.config import Config
bucket=os.environ['OBJECT_STORAGE_BUCKET']
client=boto3.client('s3',endpoint_url=os.environ['OBJECT_STORAGE_ENDPOINT'],region_name=os.environ.get('OBJECT_STORAGE_REGION'),aws_access_key_id=os.environ['OBJECT_STORAGE_ACCESS_KEY_ID'],aws_secret_access_key=os.environ['OBJECT_STORAGE_SECRET_ACCESS_KEY'],config=Config(s3={'addressing_style':'virtual'}))
rows=[]; token=None
while True:
    kw={'Bucket':bucket,'MaxKeys':1000}
    if token: kw['ContinuationToken']=token
    r=client.list_objects_v2(**kw)
    for o in r.get('Contents',[]):
        key=o['Key']
        if key.startswith('disaster-recovery/'): continue
        rows.append({'key':key,'size':int(o['Size']),'etag':str(o.get('ETag','')).strip('"'),'last_modified':o['LastModified'].isoformat()})
    if not r.get('IsTruncated'): break
    token=r.get('NextContinuationToken')
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
body=(json.dumps({'generated_at':stamp,'bucket':bucket,'object_count':len(rows),'total_bytes':sum(x['size'] for x in rows),'objects':rows},ensure_ascii=False,separators=(',',':')) + chr(10)).encode()
sha=hashlib.sha256(body).hexdigest()
key=f'disaster-recovery/media-inventory/{stamp}.json'
client.put_object(Bucket=bucket,Key=key,Body=body,ContentType='application/json',Metadata={'sha256':sha,'object-count':str(len(rows))})
head=client.head_object(Bucket=bucket,Key=key)
if head.get('Metadata',{}).get('sha256')!=sha: raise SystemExit('manifest verification failed')
health=Path('/var/www/petitannonces/shared/health')
health.mkdir(parents=True,exist_ok=True)
tmp=health/'media-inventory.json.tmp'
tmp.write_text(json.dumps({'ok':True,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z'),'objects':len(rows),'bytes':sum(x['size'] for x in rows),'manifestKey':key},separators=(',',':'))+'\n')
tmp.chmod(0o640)
tmp.replace(health/'media-inventory.json')
print(f'media_inventory_ok objects={len(rows)} bytes={sum(x["size"] for x in rows)} key={key}')
