#!/usr/bin/env bash
# Quick dev start for crawshrimp core API
# Usage: bash dev.sh
set -e
cd "$(dirname "$0")"

# Create venv if missing
if [ ! -d "venv" ]; then
  echo "[setup] Creating venv..."
  python3 -m venv venv
  venv/bin/pip install -r core/requirements.txt
fi

DATA_DIR="$(PYTHONPATH=. venv/bin/python3 - <<'PY'
from core import runtime_paths
print(runtime_paths.data_root())
PY
)"
TOKEN_FILE="$DATA_DIR/api-token"
if [ -z "${CRAWSHRIMP_API_TOKEN:-}" ]; then
  if [ -s "$TOKEN_FILE" ]; then
    CRAWSHRIMP_API_TOKEN="$(cat "$TOKEN_FILE")"
  else
    CRAWSHRIMP_API_TOKEN="$(python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
)"
    (
      token_tmp="$(mktemp "$TOKEN_FILE.XXXXXX")"
      trap 'rm -f "$token_tmp"' EXIT
      chmod 600 "$token_tmp"
      printf '%s' "$CRAWSHRIMP_API_TOKEN" > "$token_tmp"
      mv -f "$token_tmp" "$TOKEN_FILE"
    )
  fi
  export CRAWSHRIMP_API_TOKEN
fi

echo "[start] crawshrimp API on http://127.0.0.1:18765"
echo "[docs]  http://127.0.0.1:18765/docs"
echo "[auth]  X-Crawshrimp-Token header configured"
PYTHONPATH=. venv/bin/python3 core/api_server.py
