#!/usr/bin/env python3
import json, os, secrets, shutil, subprocess, sys, time, urllib.request
from pathlib import Path

APP = Path("/srv/getsy/app")
ACTIVE = APP / ".next-agent-build"
RELEASES = Path("/var/lib/getsy-panel-releases")
MAX_RELEASES = 5

def emit(obj, code=0):
    print(json.dumps(obj, ensure_ascii=False))
    raise SystemExit(code)

def release_id():
    return time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + secrets.token_hex(4)

def health():
    result = subprocess.run(
        ["systemctl", "is-active", "getsy-app.service"],
        capture_output=True, text=True, timeout=10
    )
    if result.stdout.strip() != "active":
        return False, "service_" + result.stdout.strip()
    try:
        request = urllib.request.Request(
            "http://127.0.0.1:3000/",
            headers={"User-Agent": "GetsyMultiAgent/1.0"},
        )
        with urllib.request.urlopen(request, timeout=8) as response:
            if response.status >= 500:
                return False, "http_" + str(response.status)
    except Exception as exc:
        return False, "http_" + str(exc)[:160]
    return True, "ok"

def env_from_files():
    env = os.environ.copy()
    for file_path in (
        Path("/srv/getsy/shared/.env.production"),
        Path("/srv/getsy/shared/stripe-api.env"),
    ):
        if not file_path.exists():
            continue
        for raw in file_path.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
                value = value[1:-1]
            env[key.strip()] = value
    env["NODE_ENV"] = "production"
    return env

def snapshot():
    if not ACTIVE.is_dir():
        emit({"ok": False, "error": "active_build_missing"}, 2)
    RELEASES.mkdir(parents=True, exist_ok=True)
    identifier = release_id()
    release_dir = RELEASES / identifier
    release_dir.mkdir()
    shutil.copytree(ACTIVE, release_dir / "build", symlinks=True)
    manifest = {
        "id": identifier,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (release_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    existing = sorted(
        [item for item in RELEASES.iterdir() if item.is_dir()],
        key=lambda item: item.stat().st_mtime,
        reverse=True,
    )
    for old in existing[MAX_RELEASES:]:
        shutil.rmtree(old, ignore_errors=True)
    return identifier

def list_releases():
    RELEASES.mkdir(parents=True, exist_ok=True)
    items = []
    folders = sorted(
        [item for item in RELEASES.iterdir() if item.is_dir()],
        key=lambda item: item.stat().st_mtime,
        reverse=True,
    )[:10]
    for folder in folders:
        try:
            manifest = json.loads((folder / "manifest.json").read_text())
            items.append({
                "id": manifest.get("id", folder.name),
                "created_at": manifest.get("created_at"),
            })
        except Exception:
            continue
    emit({"ok": True, "releases": items})

def swap_build(candidate):
    previous = APP / (".next-agent-build.previous-" + release_id())
    if previous.exists():
        shutil.rmtree(previous)
    os.replace(ACTIVE, previous)
    os.replace(candidate, ACTIVE)
    restart = subprocess.run(
        ["systemctl", "restart", "getsy-app.service"],
        capture_output=True, text=True, timeout=60,
    )
    time.sleep(2)
    ok, detail = health()
    if ok:
        shutil.rmtree(previous, ignore_errors=True)
        return True, detail
    failed = APP / (".next-agent-build.failed-" + release_id())
    if ACTIVE.exists():
        os.replace(ACTIVE, failed)
    os.replace(previous, ACTIVE)
    subprocess.run(
        ["systemctl", "restart", "getsy-app.service"],
        capture_output=True, text=True, timeout=60,
    )
    shutil.rmtree(failed, ignore_errors=True)
    return False, detail

def restart():
    result = subprocess.run(
        ["systemctl", "restart", "getsy-app.service"],
        capture_output=True, text=True, timeout=60,
    )
    time.sleep(2)
    ok, detail = health()
    emit({
        "ok": ok,
        "status": detail,
        "stderr": (result.stderr or "")[-1200:],
    }, 0 if ok else 2)

def deploy():
    rollback_release = snapshot()
    build_name = ".next-panel-candidate-" + release_id()
    candidate = APP / build_name
    env = env_from_files()
    env["GETSY_BUILD_DIR"] = build_name
    result = subprocess.run(
        ["runuser", "-u", "getsyapp", "--", "/usr/bin/npm", "run", "build"],
        cwd=str(APP), env=env, capture_output=True, text=True, timeout=900,
    )
    tail = ((result.stdout or "") + "\n" + (result.stderr or ""))[-8000:]
    if result.returncode != 0:
        shutil.rmtree(candidate, ignore_errors=True)
        emit({
            "ok": False,
            "error": "build_failed",
            "rollback_release": rollback_release,
            "tail": tail,
        }, 2)
    ok, detail = swap_build(candidate)
    emit({
        "ok": ok,
        "status": detail,
        "rollback_release": rollback_release,
        "tail": tail,
    }, 0 if ok else 2)

def rollback(identifier):
    if not identifier or "/" in identifier or ".." in identifier:
        emit({"ok": False, "error": "invalid_release"}, 2)
    source = (RELEASES / identifier / "build").resolve()
    if RELEASES.resolve() not in source.parents or not source.is_dir():
        emit({"ok": False, "error": "release_not_found"}, 2)
    safety_release = snapshot()
    candidate = APP / (".next-panel-rollback-" + release_id())
    shutil.copytree(source, candidate, symlinks=True)
    ok, detail = swap_build(candidate)
    emit({
        "ok": ok,
        "status": detail,
        "release": identifier,
        "safety_release": safety_release,
    }, 0 if ok else 2)

def main():
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    if action == "releases":
        list_releases()
    if action == "restart":
        restart()
    if action == "deploy":
        deploy()
    if action == "rollback":
        rollback(sys.argv[2] if len(sys.argv) > 2 else "")
    emit({"ok": False, "error": "unsupported_action"}, 2)

if __name__ == "__main__":
    main()