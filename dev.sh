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

echo "[start] crawshrimp API on http://127.0.0.1:18765"
echo "[docs]  http://127.0.0.1:18765/docs"
PYTHONPATH=. venv/bin/python3 core/api_server.py
