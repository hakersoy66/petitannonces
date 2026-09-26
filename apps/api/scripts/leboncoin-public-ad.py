#!/usr/bin/env python3
import json
import random
import re
import sys
import uuid

from curl_cffi import requests


def app_user_agent() -> str:
    ios_versions = ["18.6", "18.7", "26.0", "26.1", "26.2"]
    app_versions = ["101.45.0", "101.44.0", "101.43.1", "101.42.1"]
    return f"LBC;iOS;{random.choice(ios_versions)};iPhone;phone;{uuid.uuid4()};wifi;{random.choice(app_versions)}"


def fetch(ad_id: str) -> dict:
    last_status = 0
    profiles = ["safari_ios", "chrome_android", "safari"]
    for profile in profiles:
        try:
            session = requests.Session(impersonate=profile)
            session.headers.update(
                {
                    "User-Agent": app_user_agent(),
                    "Sec-Fetch-Dest": "empty",
                    "Sec-Fetch-Mode": "cors",
                    "Sec-Fetch-Site": "same-site",
                    "Accept": "application/json",
                }
            )
            session.get("https://www.leboncoin.fr/", timeout=15)
            response = session.get(
                f"https://api.leboncoin.fr/api/adfinder/v1/classified/{ad_id}",
                timeout=20,
            )
            last_status = response.status_code
            if response.ok:
                payload = response.json()
                if isinstance(payload, dict):
                    return payload
        except Exception:
            continue
    raise RuntimeError(f"leboncoin_api_http_{last_status or 502}")


def main() -> int:
    if len(sys.argv) != 2 or not re.fullmatch(r"\d{6,20}", sys.argv[1]):
        print(json.dumps({"error": "invalid_ad_id"}))
        return 2
    try:
        payload = fetch(sys.argv[1])
    except Exception as exc:
        print(json.dumps({"error": str(exc)[:120]}))
        return 3
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
