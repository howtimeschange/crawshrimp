#!/usr/bin/env bash
# Download python-build-standalone for all platforms into app/python-dist/
# Usage: bash app/scripts/download-python.sh

set -e

PY_VERSION="3.12.13"
BUILD_VERSION="20260310"
OUT_DIR="$(dirname "$0")/../python-dist"

declare -A TARGETS
TARGETS["mac-arm64"]="cpython-${PY_VERSION}+${BUILD_VERSION}-aarch64-apple-darwin-install_only_stripped.tar.gz"
TARGETS["mac-x64"]="cpython-${PY_VERSION}+${BUILD_VERSION}-x86_64-apple-darwin-install_only_stripped.tar.gz"
TARGETS["win-x64"]="cpython-${PY_VERSION}+${BUILD_VERSION}-x86_64-pc-windows-msvc-install_only_stripped.tar.gz"

BASE_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${BUILD_VERSION}"

mkdir -p "$OUT_DIR"

for KEY in "${!TARGETS[@]}"; do
  FILE="${TARGETS[$KEY]}"
  URL="${BASE_URL}/${FILE}"
  DEST="${OUT_DIR}/${KEY}"

  if [ -d "$DEST" ]; then
    echo "[skip] $KEY already exists"
    continue
  fi

  echo "[download] $KEY ..."
  curl -sI "$URL" | grep -q "HTTP/" || { echo "[error] URL not found: $URL"; exit 1; }
  curl -L -o "/tmp/${FILE}" "$URL"
  mkdir -p "$DEST"
  tar -xzf "/tmp/${FILE}" -C "$DEST" --strip-components=1
  rm "/tmp/${FILE}"
  echo "[ok] $KEY -> $DEST"
done

echo "All Python bundles ready in $OUT_DIR"
