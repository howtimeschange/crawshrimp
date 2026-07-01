#!/usr/bin/env bash
set -euo pipefail

: "${APPLE_NOTARY_KEY:?APPLE_NOTARY_KEY is required}"
: "${APPLE_NOTARY_KEY_ID:?APPLE_NOTARY_KEY_ID is required}"
: "${APPLE_NOTARY_ISSUER:?APPLE_NOTARY_ISSUER is required}"

timeout_duration="${APPLE_NOTARY_TIMEOUT:-2h}"

shopt -s nullglob
dmgs=(dist/*.dmg)
if [ "${#dmgs[@]}" -eq 0 ]; then
  echo "::error::No macOS DMG artifacts found under app/dist"
  exit 1
fi

extract_json_field() {
  local file="$1"
  local field="$2"
  python3 - "$file" "$field" <<'PY'
import json
import sys

path, field = sys.argv[1], sys.argv[2]
try:
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
except Exception:
    sys.exit(0)

value = data.get(field)
if value is not None:
    print(value)
PY
}

for dmg in "${dmgs[@]}"; do
  echo "Submitting ${dmg} to Apple notarization with timeout ${timeout_duration}"
  result_file="$(mktemp "${RUNNER_TEMP:-/tmp}/notary-result.XXXXXX.json")"

  set +e
  xcrun notarytool submit "${dmg}" \
    --key "${APPLE_NOTARY_KEY}" \
    --key-id "${APPLE_NOTARY_KEY_ID}" \
    --issuer "${APPLE_NOTARY_ISSUER}" \
    --wait \
    --timeout "${timeout_duration}" \
    --output-format json > "${result_file}" 2>&1
  submit_status=$?
  set -e

  echo "notarytool output for ${dmg}:"
  cat "${result_file}"

  submission_id="$(extract_json_field "${result_file}" id)"
  submission_status="$(extract_json_field "${result_file}" status)"

  if [ "${submit_status}" -ne 0 ]; then
    if [ -n "${submission_id}" ]; then
      echo "notarytool info for ${submission_id}:"
      xcrun notarytool info "${submission_id}" \
        --key "${APPLE_NOTARY_KEY}" \
        --key-id "${APPLE_NOTARY_KEY_ID}" \
        --issuer "${APPLE_NOTARY_ISSUER}" || true

      echo "notarytool log for ${submission_id}:"
      xcrun notarytool log "${submission_id}" \
        --key "${APPLE_NOTARY_KEY}" \
        --key-id "${APPLE_NOTARY_KEY_ID}" \
        --issuer "${APPLE_NOTARY_ISSUER}" || true
    fi
    exit "${submit_status}"
  fi

  if [ "${submission_status}" != "Accepted" ]; then
    echo "::error::Apple notarization did not return Accepted for ${dmg}; status=${submission_status:-unknown}"
    if [ -n "${submission_id}" ]; then
      xcrun notarytool log "${submission_id}" \
        --key "${APPLE_NOTARY_KEY}" \
        --key-id "${APPLE_NOTARY_KEY_ID}" \
        --issuer "${APPLE_NOTARY_ISSUER}" || true
    fi
    exit 1
  fi

  echo "Stapling notarization ticket to ${dmg}"
  xcrun stapler staple "${dmg}"
  xcrun stapler validate "${dmg}"
done
