#!/usr/bin/env bash
# Download python-build-standalone for all platforms into app/python-dist/
# Usage: bash app/scripts/download-python.sh

set -e

PY_VERSION="3.12.13"
BUILD_VERSION="20260310"
OUT_DIR="$(dirname "$0")/../python-dist"

BASE_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${BUILD_VERSION}"

mkdir -p "$OUT_DIR"

if [ -n "${PYTHON_TARGETS:-}" ]; then
  IFS=',' read -r -a SELECTED_TARGETS <<< "${PYTHON_TARGETS}"
else
  SELECTED_TARGETS=("mac-arm64" "mac-x64" "win-x64")
fi

target_file() {
  case "$1" in
    mac-arm64)
      echo "cpython-${PY_VERSION}+${BUILD_VERSION}-aarch64-apple-darwin-install_only_stripped.tar.gz"
      ;;
    mac-x64)
      echo "cpython-${PY_VERSION}+${BUILD_VERSION}-x86_64-apple-darwin-install_only_stripped.tar.gz"
      ;;
    win-x64)
      echo "cpython-${PY_VERSION}+${BUILD_VERSION}-x86_64-pc-windows-msvc-install_only_stripped.tar.gz"
      ;;
    *)
      return 1
      ;;
  esac
}

for KEY in "${SELECTED_TARGETS[@]}"; do
  FILE="$(target_file "$KEY")" || {
    echo "[error] Unknown Python target: $KEY"
    exit 1
  }
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
