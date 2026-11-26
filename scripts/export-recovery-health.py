#!/usr/bin/env python3
"""Publish only sanitized recovery metadata, never backup contents or secrets."""
import json, os, tempfile, subprocess
from pathlib import Path
from datetime import datetime, timezone
from grp import getgrnam
root=Path("/var/www/petitannonces/shared/health")
def read(path):
    try: return json.loads(Path(path).read_text())
    except (OSError,ValueError): return {}
def stamp(s):
    try:
        if len(s)==16 and s.endswith("Z"): return datetime.strptime(s,"%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc).isoformat()
        return datetime.fromisoformat(s.replace("Z","+00:00")).astimezone(timezone.utc).isoformat()
    except (ValueError,TypeError,AttributeError): return None
def marker(d,**extra):
    return {"ok":d.get("ok") is True,"completedAt":stamp(d.get("completedAt")),**extra}
snap=read("/srv/petitannonces-recovery/public/status.json")
vault=read(root/"local-vault.json")
drill=read(root/"restore-drill.json")
media=read(root/"media-inventory.json")
off=read(root/"offsite-backup.json")
vault_files=list(Path("/srv/petitannonces-recovery-vault").glob("petitannonces-recovery-*.tar.gpg"))
def enabled(unit):
    return subprocess.run(["systemctl","is-enabled",unit],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True).stdout.strip()=="enabled"
def result(unit):
    return subprocess.run(["systemctl","show",unit,"-p","Result","--value"],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True).stdout.strip() or "unknown"
snapshot=marker(snap,verified=snap.get("verified") is True,sizeBytes=sum(v.get("bytes",0) for v in snap.get("files",{}).values() if isinstance(v,dict)),exists=Path("/srv/petitannonces-recovery/latest/postgresql.dump").is_file(),scheduled=enabled("petitannonces-recovery-snapshot.timer"),lastResult=result("petitannonces-recovery-snapshot.service"))
vault_state=marker(vault,sizeBytes=vault.get("bytes"),copies=len(vault_files),scheduled=enabled("petitannonces-local-vault.timer"),lastResult=result("petitannonces-local-vault.service"))
data={"generatedAt":datetime.now(timezone.utc).isoformat(),"snapshot":snapshot,"vault":vault_state,"restore":marker(drill,tables=drill.get("tables"),lastResult=result("petitannonces-restore-drill.service"),scheduled=enabled("petitannonces-restore-drill.timer")),"media":marker(media,objects=media.get("objects"),sizeBytes=media.get("bytes")),"offsite":marker(off,scheduled=enabled("petitannonces-offsite-backup.timer") or enabled("petitannonces-recovery-offsite-drive.timer"))}
out=Path("/var/www/petitannonces/recovery-health")
fd,tmp=tempfile.mkstemp(prefix=".recovery-health-",dir=out)
with os.fdopen(fd,"w") as f: json.dump(data,f)
os.chown(tmp,0,getgrnam("petitannonces").gr_gid)
os.chmod(tmp,0o640)
os.replace(tmp,out/"recovery-summary.json")
