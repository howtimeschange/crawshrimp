#!/usr/bin/env bash
# Exit 3 when a newer release already owns either public GitHub pointer.
set -euo pipefail

release_tag="$1"
repo="$2"
stable_tag='^v[0-9]+\.[0-9]+\.[0-9]+$'
[[ "${release_tag}" =~ ${stable_tag} ]]

read_github_json() {
  local response body
  if response=$(gh api --include "$1"); then
    # --include separates the response headers from its JSON body with an empty line.
    body=$(printf '%s\n' "${response}" | awk 'found { print } /^\r?$/ { found=1 }')
    jq -er "$2" <<< "${body}"
  elif [[ "${response%%$'\n'*}" =~ ^HTTP/[^[:space:]]+[[:space:]]404([[:space:]]|$) ]]; then
    return 0
  else
    echo "::error::Cannot check GitHub release pointer $1" >&2
    return 1
  fi
}

latest=$(read_github_json "repos/${repo}/releases/latest" '.tag_name')
bridge_title=$(read_github_json "repos/${repo}/releases/tags/desktop-latest" '.name')
bridge_title_version="${bridge_title##* }"
if [[ ! "${bridge_title_version}" =~ ${stable_tag} ]]; then
  bridge_title_version=''
fi

# The Release title and tag can diverge after a partially completed release.
# Resolve the tag independently, including when no rolling Release exists.
rolling_sha=$(read_github_json "repos/${repo}/git/ref/tags/desktop-latest" '.object.sha')
rolling_version=''
if [[ -n "${rolling_sha}" ]]; then
  rolling_version="v$(gh api "repos/${repo}/contents/app/package.json?ref=${rolling_sha}" --jq '.content' | base64 --decode | jq -er '.version')"
fi
for current in "${latest}" "${bridge_title_version}" "${rolling_version}"; do
  [[ -z "${current}" ]] && continue
  if [[ ! "${current}" =~ ${stable_tag} ]]; then
    echo "::error::Unrecognized public GitHub release version ${current}"
    exit 1
  fi
  if [[ "$(printf '%s\n' "${current}" "${release_tag}" | sort -V | tail -1)" != "${release_tag}" ]]; then
    echo "GitHub already serves newer desktop release ${current}; skipping ${release_tag}"
    exit 3
  fi
done
