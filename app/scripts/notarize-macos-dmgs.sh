#!/usr/bin/env bash
set -euo pipefail

: "${APPLE_NOTARY_KEY:?APPLE_NOTARY_KEY is required}"
: "${APPLE_NOTARY_KEY_ID:?APPLE_NOTARY_KEY_ID is required}"
: "${APPLE_NOTARY_ISSUER:?APPLE_NOTARY_ISSUER is required}"

timeout_duration="${APPLE_NOTARY_TIMEOUT:-2h}"
poll_interval="${APPLE_NOTARY_POLL_INTERVAL:-60}"

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

timeout_seconds="$(duration_to_seconds "${timeout_duration}")"
deadline=$((SECONDS + timeout_seconds))
submission_ids=()
submission_dmgs=()
submission_statuses=()
stapled=()

for dmg in "${dmgs[@]}"; do
  echo "Submitting ${dmg} to Apple notarization"
  result_file="$(mktemp "${RUNNER_TEMP:-/tmp}/notary-result.XXXXXX.json")"

  set +e
  xcrun notarytool submit "${dmg}" \
    --key "${APPLE_NOTARY_KEY}" \
    --key-id "${APPLE_NOTARY_KEY_ID}" \
    --issuer "${APPLE_NOTARY_ISSUER}" \
    --output-format json > "${result_file}" 2>&1
  submit_status=$?
  set -e

  echo "notarytool submit output for ${dmg}:"
  cat "${result_file}"

  submission_id="$(extract_json_field "${result_file}" id)"

  if [ "${submit_status}" -ne 0 ]; then
    exit "${submit_status}"
  fi

  if [ -z "${submission_id}" ]; then
    echo "::error::Apple notarization did not return a submission id for ${dmg}"
    exit 1
  fi

  submission_ids+=("${submission_id}")
  submission_dmgs+=("${dmg}")
  submission_statuses+=("Submitted")
  stapled+=("0")
done

echo "Polling ${#submission_ids[@]} Apple notarization submission(s) for up to ${timeout_duration}"

while true; do
  pending=0

  for index in "${!submission_ids[@]}"; do
    submission_id="${submission_ids[$index]}"
    dmg="${submission_dmgs[$index]}"
    current_status="${submission_statuses[$index]}"

    if [ "${current_status}" = "Accepted" ]; then
      continue
    fi

    info_file="$(mktemp "${RUNNER_TEMP:-/tmp}/notary-info.XXXXXX.json")"
    set +e
    xcrun notarytool info "${submission_id}" \
      --key "${APPLE_NOTARY_KEY}" \
      --key-id "${APPLE_NOTARY_KEY_ID}" \
      --issuer "${APPLE_NOTARY_ISSUER}" \
      --output-format json > "${info_file}" 2>&1
    info_status=$?
    set -e

    if [ "${info_status}" -ne 0 ]; then
      echo "::warning::Failed to fetch notarization status for ${dmg} (${submission_id})"
      cat "${info_file}"
      pending=1
      continue
    fi

    submission_status="$(extract_json_field "${info_file}" status)"
    if [ -z "${submission_status}" ]; then
      submission_status="unknown"
    fi

    echo "$(timestamp) Apple notarization ${submission_id} for ${dmg}: ${submission_status}"
    submission_statuses[$index]="${submission_status}"

    case "${submission_status}" in
      Accepted)
        echo "Stapling notarization ticket to ${dmg}"
        xcrun stapler staple "${dmg}"
        xcrun stapler validate "${dmg}"
        stapled[$index]="1"
        ;;
      Invalid|Rejected)
        echo "::error::Apple notarization failed for ${dmg}; status=${submission_status}"
        echo "notarytool info for ${submission_id}:"
        cat "${info_file}"
        echo "notarytool log for ${submission_id}:"
        print_notary_log "${submission_id}"
        exit 1
        ;;
      *)
        pending=1
        ;;
    esac
  done

  if [ "${pending}" -eq 0 ]; then
    break
  fi

  if [ "${SECONDS}" -ge "${deadline}" ]; then
    echo "::error::Apple notarization timed out after ${timeout_duration}"
    for index in "${!submission_ids[@]}"; do
      if [ "${submission_statuses[$index]}" != "Accepted" ]; then
        submission_id="${submission_ids[$index]}"
        dmg="${submission_dmgs[$index]}"
        echo "Final notarytool info for ${dmg} (${submission_id}):"
        xcrun notarytool info "${submission_id}" \
          --key "${APPLE_NOTARY_KEY}" \
          --key-id "${APPLE_NOTARY_KEY_ID}" \
          --issuer "${APPLE_NOTARY_ISSUER}" || true
        echo "Final notarytool log for ${dmg} (${submission_id}):"
        print_notary_log "${submission_id}"
      fi
    done
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

for index in "${!submission_ids[@]}"; do
  if [ "${stapled[$index]}" != "1" ]; then
    echo "::error::Internal error: ${submission_dmgs[$index]} was accepted but not stapled"
    exit 1
  fi
done
