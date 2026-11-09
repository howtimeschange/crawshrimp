#!/usr/bin/env bash

# Retry ticket delivery network errors; signature and ticket errors still fail.
run_stapler_with_retry() {
  local attempt=1
  local max_attempts=5
  local status
  local output_file
  output_file="$(mktemp "${RUNNER_TEMP:-/tmp}/stapler.XXXXXX")" || return 1

  while true; do
    if xcrun stapler "$@" > "${output_file}" 2>&1; then
      cat "${output_file}"
      rm -f "${output_file}"
      return 0
    else
      status=$?
    fi
    cat "${output_file}"

    if [ "${attempt}" -ge "${max_attempts}" ] ||
       ! grep -Eq 'NSURLErrorDomain Code=-(1001|1003|1004|1005|1009)([^0-9]|$)|The network connection was lost|The request timed out' "${output_file}"; then
      rm -f "${output_file}"
      return "${status}"
    fi

    echo "::warning::Apple ticket delivery network error; retrying stapler $1 (attempt $((attempt + 1))/${max_attempts})"
    sleep "$((attempt * 15))"
    attempt=$((attempt + 1))
  done
}
