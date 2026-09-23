#!/usr/bin/env python3
import base64
import json
import os
import re
import subprocess
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

HOST = "127.0.0.1"
PORT = 7361
ROOT = Path("/var/www/petitannonces/repository")
STATE = Path("/var/lib/pa-multiagent")
PUBLIC_KEY = STATE / "panel.pub.b64"
REPLAY = STATE / "replay.json"
PA_RELEASES = STATE / "pa-releases.json"
AUDIT = Path("/var/log/pa-multiagent/audit.jsonl")
GETSY_KEY = "/root/.ssh/getsy_recovery_ed25519"
GETSY_HOST = "root@host.getsy.fr"
GETSY_SCRIPT = STATE / "getsy-remote-ops.py"
MAX_BODY = 32768
REPLAY_LOCK = threading.Lock()
OPERATION_LOCK = threading.Lock()

def audit(event, extra=None):
    row = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "event": event,
    }
    if extra:
        row.update(extra)
    try:
        AUDIT.parent.mkdir(parents=True, exist_ok=True)
        with AUDIT.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        os.chmod(AUDIT, 0o600)
    except Exception:
        pass

def read_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)

def verify_signature(raw, signature_b64):
    try:
        public_raw = base64.b64decode(PUBLIC_KEY.read_text().strip(), validate=True)
        signature = base64.b64decode(signature_b64, validate=True)
        if len(public_raw) != 32:
            return False
        Ed25519PublicKey.from_public_bytes(public_raw).verify(signature, raw)
        return True
    except (InvalidSignature, ValueError, FileNotFoundError):
        return False
    except Exception:
        return False

def fresh_request(request):
    request_id = str(request.get("request_id") or "")
    now = int(time.time())
    try:
        timestamp = int(request.get("ts") or 0)
    except Exception:
        return False, "bad_timestamp"
    if not re.fullmatch(r"[0-9a-f]{32}", request_id):
        return False, "bad_request_id"
    if abs(now - timestamp) > 90:
        return False, "expired"
    with REPLAY_LOCK:
        seen = read_json(REPLAY, {})
        seen = {key: value for key, value in seen.items() if now - int(value) < 600}
        if request_id in seen:
            return False, "replay"
        seen[request_id] = now
        write_json(REPLAY, seen)
    return True, "ok"

def run(command, timeout=120, cwd=None, input_text=None):
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=timeout,
        cwd=cwd,
        input=input_text,
    )

def getsy_action(action, params):
    arguments = [action]
    if action == "rollback":
        arguments.append(str(params.get("release_id") or ""))
    command = [
        "ssh",
        "-i", GETSY_KEY,
        "-o", "BatchMode=yes",
        "-o", "StrictHostKeyChecking=yes",
        "-o", "ConnectTimeout=8",
        GETSY_HOST,
        "python3", "-",
        *arguments,
    ]
    try:
        result = run(
            command,
            timeout=1200,
            input_text=GETSY_SCRIPT.read_text(encoding="utf-8"),
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "getsy_timeout"}
    parsed = None
    for line in reversed((result.stdout or "").splitlines()):
        try:
            parsed = json.loads(line)
            break
        except Exception:
            continue
    if parsed is None:
        return {
            "ok": False,
            "error": "getsy_invalid_output",
            "returncode": result.returncode,
            "tail": ((result.stdout or "") + "\n" + (result.stderr or ""))[-5000:],
        }
    return parsed

def pa_current_sha():
    try:
        result = run(["git", "-C", str(ROOT), "rev-parse", "HEAD"], timeout=10)
        sha = result.stdout.strip().lower()
        return sha if re.fullmatch(r"[0-9a-f]{40}", sha) else None
    except Exception:
        return None

def pa_release_records():
    records = read_json(PA_RELEASES, [])
    if not isinstance(records, list):
        records = []
    current = pa_current_sha()
    if current and not any(
        isinstance(item, dict) and item.get("id") == current for item in records
    ):
        records.insert(0, {
            "id": current,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "label": "current",
        })
        write_json(PA_RELEASES, records[:12])
    return records[:12]

def pa_record(sha, label):
    records = [
        item for item in pa_release_records()
        if isinstance(item, dict) and item.get("id") != sha
    ]
    records.insert(0, {
        "id": sha,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "label": label,
    })
    write_json(PA_RELEASES, records[:12])

def github_ci_success(sha):
    query = urllib.parse.urlencode({
        "head_sha": sha,
        "status": "success",
        "per_page": "30",
    })
    url = "https://api.github.com/repos/hakersoy66/petitannonces/actions/runs?" + query
    try:
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": "PA-MultiAgent/1.0",
                "Accept": "application/vnd.github+json",
            },
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            data = json.loads(response.read().decode())
        return any(
            run_data.get("head_sha") == sha
            and run_data.get("conclusion") == "success"
            and str(run_data.get("name", "")).strip().lower() == "ci"
            for run_data in data.get("workflow_runs", [])
        )
    except Exception as exc:
        audit("ci_check_error", {"sha": sha, "error": str(exc)[:300]})
        return False

def pa_health():
    try:
        request = urllib.request.Request(
            "https://petitannonces.fr/healthz",
            headers={"User-Agent": "PA-MultiAgent/1.0"},
        )
        with urllib.request.urlopen(request, timeout=8) as response:
            return response.status == 200
    except Exception:
        return False

def pa_restart():
    try:
        color = Path("/var/www/petitannonces/shared/active-color").read_text().strip()
    except Exception:
        color = ""
    if color not in {"blue", "green"}:
        return {"ok": False, "error": "active_color_invalid"}
    tails = []
    for service in ("web", "admin", "api"):
        result = run(
            [
                "runuser", "-u", "petitannonces", "--",
                "pm2", "restart", f"pa-{service}-{color}",
            ],
            timeout=60,
        )
        tails.append((result.stdout or "") + (result.stderr or ""))
        if result.returncode:
            return {
                "ok": False,
                "error": "pm2_restart_failed",
                "service": service,
                "tail": "\n".join(tails)[-5000:],
            }
    time.sleep(3)
    ok = pa_health()
    return {
        "ok": ok,
        "active_color": color,
        "tail": "\n".join(tails)[-5000:],
    }

def pa_deploy_sha(sha, require_ci=True, label="deploy"):
    sha = str(sha or "").lower().strip()
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        return {"ok": False, "error": "invalid_sha"}
    if require_ci and not github_ci_success(sha):
        return {"ok": False, "error": "ci_not_verified"}
    before = pa_current_sha()
    if before:
        pa_record(before, "rollback-point")
    try:
        result = run(
            ["/bin/bash", str(ROOT / "scripts/deploy-production.sh"), sha],
            timeout=1800,
            cwd=str(ROOT),
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "deploy_timeout"}
    ok = result.returncode == 0 and pa_health()
    if ok:
        pa_record(sha, label)
    return {
        "ok": ok,
        "sha": sha,
        "previous_sha": before,
        "returncode": result.returncode,
        "tail": ((result.stdout or "") + "\n" + (result.stderr or ""))[-12000:],
    }

def pa_action(action, params):
    if action == "releases":
        return {"ok": True, "releases": pa_release_records()}
    if action == "restart":
        return pa_restart()
    if action == "deploy":
        return pa_deploy_sha(params.get("sha"), True, "deploy")
    if action == "rollback":
        sha = str(params.get("release_id") or "").lower()
        allowed = {
            item.get("id") for item in pa_release_records()
            if isinstance(item, dict)
        }
        if sha not in allowed:
            return {"ok": False, "error": "release_not_registered"}
        result = pa_deploy_sha(sha, False, "rollback")
        result["database_note"] = (
            "Code rollback only; SQL migrations are not reversed automatically."
        )
        return result
    return {"ok": False, "error": "unsupported_action"}

def dispatch(request):
    target = str(request.get("target") or "")
    action = str(request.get("action") or "")
    params = request.get("params") or {}
    if target not in {"getsy", "petitannonces"}:
        return {"ok": False, "error": "invalid_target"}, 400
    if action not in {"releases", "restart", "deploy", "rollback"}:
        return {"ok": False, "error": "invalid_action"}, 400
    if action == "releases":
        result = (
            getsy_action(action, params)
            if target == "getsy"
            else pa_action(action, params)
        )
        return result, 200 if result.get("ok") else 500
    if not OPERATION_LOCK.acquire(blocking=False):
        return {"ok": False, "error": "operation_in_progress"}, 409
    try:
        audit("operation_start", {
            "target": target,
            "action": action,
            "request_id": request.get("request_id"),
        })
        result = (
            getsy_action(action, params)
            if target == "getsy"
            else pa_action(action, params)
        )
        audit("operation_finish", {
            "target": target,
            "action": action,
            "ok": bool(result.get("ok")),
            "request_id": request.get("request_id"),
        })
        return result, 200 if result.get("ok") else 500
    finally:
        OPERATION_LOCK.release()

class Handler(BaseHTTPRequestHandler):
    server_version = "PAMultiAgentBroker/1.0"

    def log_message(self, fmt, *args):
        audit("http", {"message": fmt % args})

    def send_json(self, status, value):
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"ok": True})
            return
        self.send_json(404, {"ok": False, "error": "not_found"})

    def do_POST(self):
        if self.path != "/ops":
            self.send_json(404, {"ok": False, "error": "not_found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except Exception:
            self.send_json(400, {"ok": False, "error": "bad_length"})
            return
        if length <= 0 or length > MAX_BODY:
            self.send_json(400, {"ok": False, "error": "bad_length"})
            return
        raw = self.rfile.read(length)
        signature = self.headers.get("X-Agents-Signature", "")
        if not verify_signature(raw, signature):
            audit("signature_reject")
            self.send_json(403, {"ok": False, "error": "bad_signature"})
            return
        try:
            request = json.loads(raw)
        except Exception:
            self.send_json(400, {"ok": False, "error": "invalid_json"})
            return
        fresh, reason = fresh_request(request)
        if not fresh:
            audit("freshness_reject", {"reason": reason})
            self.send_json(409, {"ok": False, "error": reason})
            return
        result, status = dispatch(request)
        self.send_json(status, result)

def main():
    STATE.mkdir(parents=True, exist_ok=True)
    audit("broker_start", {"port": PORT})
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

if __name__ == "__main__":
    main()