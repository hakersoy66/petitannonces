#!/usr/bin/env python3
"""Aggregate Nginx request totals by day, without storing IPs, URLs or user agents."""
import collections
import datetime as dt
import gzip
import glob
import json
import os
import re
from pathlib import Path
from zoneinfo import ZoneInfo

LOG_GLOB = "/var/log/nginx/access.log*"
OUTPUT = Path("/var/www/petitannonces/shared/traffic-quality.json")
PATTERN = re.compile(r'^\S+ \S+ \S+ \[(\d{2}/[A-Za-z]{3}/\d{4}):[^\]]+\] "[^"]*" (\d{3}) \S+ "[^"]*" "([^"]*)"')
KNOWN_BOT = re.compile(r"bot|spider|crawler|crawl|slurp|semrush|ahrefs|headless|lighthouse|facebookexternalhit|google-inspection|curl/|wget/|python-|go-http-client|gpt|claude|bytespider|petalbot|sogou|yandex|bingpreview|googleother|googlebot|bingbot",re.I)
RESEARCH = re.compile(r'"(?:GET|HEAD) /recherche(?:\?| |/)',re.I)
today=dt.datetime.now(ZoneInfo("Europe/Paris")).date()
since=today-dt.timedelta(days=45)
rows=collections.defaultdict(lambda:collections.Counter())

for path in glob.glob(LOG_GLOB):
    if os.path.basename(path).startswith(("error.","petitannonces-")): continue
    op=gzip.open if path.endswith(".gz") else open
    with op(path, "rt", encoding="utf-8", errors="replace") as stream:
        for line in stream:
            match=PATTERN.match(line)
            if not match: continue
            raw_day,status,ua=match.groups()
            try: day=dt.datetime.strptime(raw_day,"%d/%b/%Y").date()
            except ValueError: continue
            if day<since or day>today: continue
            c=rows[day.isoformat()]
            c["requests"]+=1
            if KNOWN_BOT.search(ua): c["knownBotRequests"]+=1
            if RESEARCH.search(line): c["searchRequests"]+=1
            if status.startswith("4"): c["http4xx"]+=1
            if status.startswith("5"): c["http5xx"]+=1

payload={"updatedAt":dt.datetime.now(dt.timezone.utc).isoformat(),
         "note":"User-agent signatures only; these are HTTP requests, not people or sessions.",
         "daily":[{"day":day,**{key:count[key] for key in ("requests","knownBotRequests","searchRequests","http4xx","http5xx")}} for day,count in sorted(rows.items())]}
temp=OUTPUT.with_suffix(".json.tmp")
temp.write_text(json.dumps(payload,ensure_ascii=False,separators=(",",":")))
os.chmod(temp,0o644)
os.replace(temp,OUTPUT)
print(json.dumps({"days":len(payload["daily"]),"last":payload["daily"][-1] if payload["daily"] else None,"updatedAt":payload["updatedAt"]}))
