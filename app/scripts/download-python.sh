#!/usr/bin/env bash
# Download python-build-standalone for all platforms into app/python-dist/
# Usage: bash app/scripts/download-python.sh

set -e

PY_VERSION="3.12.13"
BUILD_VERSION="20260310"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${APP_DIR}/.." && pwd)"
OUT_DIR="${APP_DIR}/python-dist"
REQUIREMENTS_FILE="${ROOT_DIR}/core/requirements.txt"
PY_MAJOR="${PY_VERSION%%.*}"
PY_MINOR_REST="${PY_VERSION#*.}"
PY_MINOR="${PY_MINOR_REST%%.*}"
PY_ABI="cp${PY_MAJOR}${PY_MINOR}"
PY_MAJOR_MINOR="${PY_MAJOR}.${PY_MINOR}"

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

target_python() {
  case "$1" in
    mac-arm64|mac-x64)
      echo "$2/bin/python3"
      ;;
    win-x64)
      if [ -f "$2/python.exe" ]; then
        echo "$2/python.exe"
      else
        echo "$2/python3.exe"
      fi
      ;;
    *)
      return 1
      ;;
  esac
}

host_python() {
  if command -v python3 >/dev/null 2>&1; then
    command -v python3
    return
  fi
  command -v python
}

target_site_packages() {
  case "$1" in
    win-x64)
      echo "$2/Lib/site-packages"
      ;;
    mac-arm64|mac-x64)
      echo "$2/lib/python${PY_MAJOR_MINOR}/site-packages"
      ;;
    *)
      return 1
      ;;
  esac
}

has_core_requirements() {
  local key="$1"
  local dest="$2"
  local site_packages
  site_packages="$(target_site_packages "$key" "$dest")" || return 1
  [ -d "${site_packages}/fastapi" ] &&
    [ -d "${site_packages}/uvicorn" ] &&
    [ -d "${site_packages}/apscheduler" ] &&
    [ -d "${site_packages}/openpyxl" ] &&
    [ -d "${site_packages}/tzdata" ]
}

install_windows_requirements_cross() {
  local dest="$1"
  local host_py
  local site_packages

  host_py="$(host_python)" || {
    echo "[error] Host Python not found; cannot cross-install win-x64 dependencies"
    exit 1
  }
  site_packages="$(target_site_packages "win-x64" "$dest")"
  mkdir -p "$site_packages"

  echo "[deps] Cross-installing backend requirements into win-x64 ..."
  "$host_py" -m pip install \
    --disable-pip-version-check \
    --no-warn-script-location \
    --upgrade \
    --target "$site_packages" \
    --platform win_amd64 \
    --python-version "$PY_MAJOR_MINOR" \
    --implementation cp \
    --abi "$PY_ABI" \
    --only-binary=:all: \
    -r "$REQUIREMENTS_FILE"
}

install_requirements() {
  local key="$1"
  local dest="$2"
  local py_bin
  local marker

  py_bin="$(target_python "$key" "$dest")" || {
    echo "[error] Unsupported Python target for deps: $key"
    exit 1
  }

  if [ ! -f "$py_bin" ]; then
    echo "[error] Python executable not found: $py_bin"
    exit 1
  fi

  marker="${dest}/.crawshrimp-requirements.txt"
  if [ -f "$marker" ] && cmp -s "$REQUIREMENTS_FILE" "$marker" && has_core_requirements "$key" "$dest"; then
    echo "[skip] $key requirements already installed"
    return
  fi

  if ! "$py_bin" -V >/dev/null 2>&1; then
    if [ "$key" = "win-x64" ]; then
      install_windows_requirements_cross "$dest"
      cp "$REQUIREMENTS_FILE" "$marker"
      echo "[ok] $key requirements installed"
      return
    fi
    echo "[warn] Cannot execute $py_bin on this host; skip dependency install for $key"
    return
  fi

  echo "[deps] Installing backend requirements into $key ..."
  if ! "$py_bin" -m pip --version >/dev/null 2>&1; then
    "$py_bin" -m ensurepip --upgrade
  fi
  "$py_bin" -m pip install \
    --disable-pip-version-check \
    --no-warn-script-location \
    -r "$REQUIREMENTS_FILE"

  cp "$REQUIREMENTS_FILE" "$marker"
  echo "[ok] $key requirements installed"
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
  else
    echo "[download] $KEY ..."
    curl -sI "$URL" | grep -q "HTTP/" || { echo "[error] URL not found: $URL"; exit 1; }
    curl -L -o "/tmp/${FILE}" "$URL"
    mkdir -p "$DEST"
    tar -xzf "/tmp/${FILE}" -C "$DEST" --strip-components=1
    rm "/tmp/${FILE}"
    echo "[ok] $KEY -> $DEST"
  fi

  install_requirements "$KEY" "$DEST"
done

echo "All Python bundles ready in $OUT_DIR"
