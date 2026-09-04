#!/usr/bin/env bash
set -euo pipefail

pg_url_from_prisma() {
  local input="${1:?database URL is required}"
  python3 - "$input" <<'PY'
import sys
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

value = sys.argv[1]
parts = urlsplit(value)
params = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != "schema"]
print(urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(params), parts.fragment)))
PY
}
