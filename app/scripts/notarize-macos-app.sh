#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 /path/to/App.app" >&2
  exit 64
fi

app_path="$1"
if [ ! -d "${app_path}" ]; then
  echo "::error::macOS app bundle not found: ${app_path}"
  exit 1
fi

: "${APPLE_NOTARY_KEY:?APPLE_NOTARY_KEY is required}"
: "${APPLE_NOTARY_KEY_ID:?APPLE_NOTARY_KEY_ID is required}"
: "${APPLE_NOTARY_ISSUER:?APPLE_NOTARY_ISSUER is required}"

timeout_duration="${APPLE_NOTARY_TIMEOUT:-2h}"
poll_interval="${APPLE_NOTARY_POLL_INTERVAL:-60}"
temp_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/notary-app.XXXXXX")"
zip_path="${temp_dir}/$(basename "${app_path%/}").zip"

cleanup() {
  rm -rf "${temp_dir}"
}
trap cleanup EXIT

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

duration_to_seconds() {
  python3 - "$1" <<'PY'
import re
import sys

value = sys.argv[1].strip().lower()
match = re.fullmatch(r"(\d+)([smh]?)", value)
if not match:
    print("7200")
    sys.exit(0)

amount = int(match.group(1))
unit = match.group(2) or "s"
multiplier = {"s": 1, "m": 60, "h": 3600}[unit]
print(amount * multiplier)
PY
}

timestamp() {
  date -u '+%Y-%m-%dT%H:%M:%SZ'
}

print_notary_log() {
  local submission_id="$1"
  xcrun notarytool log "${submission_id}" \
    --key "${APPLE_NOTARY_KEY}" \
    --key-id "${APPLE_NOTARY_KEY_ID}" \
    --issuer "${APPLE_NOTARY_ISSUER}" || true
}

echo "Verifying Developer ID signature for ${app_path}"
codesign --verify --deep --strict --verbose=2 "${app_path}"

echo "Creating notarization ZIP for ${app_path}"
ditto -c -k --keepParent "${app_path}" "${zip_path}"

result_file="${temp_dir}/notary-result.json"
set +e
xcrun notarytool submit "${zip_path}" \
  --key "${APPLE_NOTARY_KEY}" \
  --key-id "${APPLE_NOTARY_KEY_ID}" \
  --issuer "${APPLE_NOTARY_ISSUER}" \
  --output-format json > "${result_file}" 2>&1
submit_status=$?
set -e

echo "notarytool submit output for ${app_path}:"
cat "${result_file}"

submission_id="$(extract_json_field "${result_file}" id)"

if [ "${submit_status}" -ne 0 ]; then
  exit "${submit_status}"
fi

if [ -z "${submission_id}" ]; then
  echo "::error::Apple notarization did not return a submission id for ${app_path}"
  exit 1
fi

timeout_seconds="$(duration_to_seconds "${timeout_duration}")"
deadline=$((SECONDS + timeout_seconds))
submission_status="Submitted"

echo "Polling Apple notarization submission ${submission_id} for up to ${timeout_duration}"

while true; do
  info_file="${temp_dir}/notary-info-${SECONDS}.json"
  set +e
  xcrun notarytool info "${submission_id}" \
    --key "${APPLE_NOTARY_KEY}" \
    --key-id "${APPLE_NOTARY_KEY_ID}" \
    --issuer "${APPLE_NOTARY_ISSUER}" \
    --output-format json > "${info_file}" 2>&1
  info_status=$?
  set -e

  if [ "${info_status}" -ne 0 ]; then
    echo "::warning::Failed to fetch notarization status for ${app_path} (${submission_id})"
    cat "${info_file}"
  else
    submission_status="$(extract_json_field "${info_file}" status)"
    if [ -z "${submission_status}" ]; then
      submission_status="unknown"
    fi

    echo "$(timestamp) Apple notarization ${submission_id} for ${app_path}: ${submission_status}"

    case "${submission_status}" in
      Accepted)
        echo "Stapling notarization ticket to ${app_path}"
        xcrun stapler staple "${app_path}"
        xcrun stapler validate "${app_path}"
        codesign --verify --deep --strict --verbose=2 "${app_path}"
        spctl --assess --type execute --verbose=2 "${app_path}"
        exit 0
        ;;
      Invalid|Rejected)
        echo "::error::Apple notarization failed for ${app_path}; status=${submission_status}"
        echo "notarytool info for ${submission_id}:"
        cat "${info_file}"
        echo "notarytool log for ${submission_id}:"
        print_notary_log "${submission_id}"
        exit 1
        ;;
      *)
        ;;
    esac
  fi

  if [ "${SECONDS}" -ge "${deadline}" ]; then
    echo "::error::Apple notarization timed out after ${timeout_duration}"
    echo "Final notarytool info for ${app_path} (${submission_id}):"
    xcrun notarytool info "${submission_id}" \
      --key "${APPLE_NOTARY_KEY}" \
      --key-id "${APPLE_NOTARY_KEY_ID}" \
      --issuer "${APPLE_NOTARY_ISSUER}" || true
    echo "Final notarytool log for ${app_path} (${submission_id}):"
    print_notary_log "${submission_id}"
    exit 1
  fi

  sleep_seconds="${poll_interval}"
  remaining=$((deadline - SECONDS))
  if [ "${remaining}" -lt "${sleep_seconds}" ]; then
    sleep_seconds="${remaining}"
  fi
  if [ "${sleep_seconds}" -lt 1 ]; then
    sleep_seconds=1
  fi

  echo "Waiting ${sleep_seconds}s before checking Apple notarization again"
  sleep "${sleep_seconds}"
done
