'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const bash = spawnSync('bash', ['-c', 'command -v jq && command -v sort'], { encoding: 'utf8' }).status === 0

test('GitHub publication serializes both pointers and uses the current guard for recovery artifacts', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/build-desktop.yml'), 'utf8')
  const bridge = workflow.slice(workflow.indexOf('  publish-release:'), workflow.indexOf('  publish-cloudflare-r2:'))
  assert.match(bridge, /concurrency:\s+group: desktop-github-release-pointers\s+cancel-in-progress: false/)
  assert.match(bridge, /ref: \$\{\{ needs.release-source.outputs.sha \}\}/)
  assert.match(bridge, /ref: \$\{\{ github.workflow_sha \}\}\s+path: release-workflow/)
  assert.match(bridge, /bash release-workflow\/app\/scripts\/check-desktop-release-pointers.sh/)
  assert.match(bridge, /\n          check_pointers\n\n          if gh release view desktop-latest/)
  assert.match(bridge, /\n          check_pointers\n          git push --force-with-lease=/)
  assert.match(bridge, /\n          check_pointers\n          gh release edit "\$\{RELEASE_TAG\}" --latest/)
  const version = workflow.slice(workflow.indexOf('  publish-version-release:'))
  assert.doesNotMatch(version, /--latest\s*$/m)
})

test('release guard rejects either newer pointer when adjacent versions finish in reverse order', { skip: !bash }, () => {
  const folder = fs.mkdtempSync(path.join(tmpdir(), 'desktop-release-guard-'))
  try {
    fs.writeFileSync(path.join(folder, 'gh'), `#!/usr/bin/env bash
case "$3" in
  */releases/latest) field="tag_name"; value="$FIXTURE_LATEST"; status="$FIXTURE_LATEST_STATUS" ;;
  */releases/tags/desktop-latest) field="name"; value="$FIXTURE_BRIDGE"; status="$FIXTURE_BRIDGE_STATUS" ;;
  */git/ref/tags/desktop-latest)
    if [[ -z "$FIXTURE_TAG_VERSION" ]]; then printf 'HTTP/2 404\\n\\n'; exit 1; fi
    printf 'HTTP/2 200\\n\\n{"object":{"sha":"fixed-fixture-sha"}}\\n'
    exit 0 ;;
  *)
    if [[ "$2" == */contents/app/package.json?ref=fixed-fixture-sha ]]; then
      jq -n --arg version "$FIXTURE_TAG_VERSION" '{version:$version}' | base64
      exit 0
    fi
    exit 91 ;;
esac
printf 'HTTP/2 %s\\r\\nContent-Type: application/json\\r\\n\\r\\n' "$status"
if [[ "$status" != 200 ]]; then exit 1; fi
jq -n --arg field "$field" --arg value "$value" '{($field): $value}'
`, { mode: 0o700 })
    const run = (tag, latest, bridge, tagVersion = '', latestStatus = latest ? '200' : '404') => spawnSync('bash', [
      path.join(root, 'app/scripts/check-desktop-release-pointers.sh'), tag, 'fixture/repo',
    ], {
      encoding: 'utf8',
      env: {
        ...process.env, PATH: `${folder}${path.delimiter}${process.env.PATH}`,
        FIXTURE_LATEST: latest, FIXTURE_BRIDGE: bridge, FIXTURE_TAG_VERSION: tagVersion,
        FIXTURE_LATEST_STATUS: latestStatus, FIXTURE_BRIDGE_STATUS: bridge ? '200' : '404',
      },
    })
    assert.equal(run('v2.5.10', '', '').status, 0)
    assert.equal(run('v2.5.10', 'v2.5.9', '抓虾 Desktop Latest v2.5.9').status, 0)
    assert.equal(run('v2.5.10', 'v2.5.10', '抓虾 Desktop Latest v2.5.10').status, 0)
    assert.equal(run('v2.5.9', 'v2.5.10', '抓虾 Desktop Latest v2.5.9').status, 3)
    assert.equal(run('v2.5.9', 'v2.5.9', '抓虾 Desktop Latest v2.5.10').status, 3)
    assert.equal(run('v2.5.16', 'v2.5.15', '抓虾 Desktop Latest v2.5.15', '2.5.17').status, 3)
    assert.equal(run('v2.5.16', 'v2.5.15', '', '2.5.17').status, 3)
    assert.equal(run('v2.5.16', 'v2.5.15', '抓虾 Desktop Latest v2.5.17', '2.5.15').status, 3)
    assert.equal(run('v2.5.17', 'v2.5.15', '抓虾 Desktop Latest v2.5.15', '2.5.17').status, 0)
    assert.equal(run('v2.5.10', '', '', '', '503').status, 1)
  } finally {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

test('dev startup names the header and keeps the API token out of terminal output', { skip: !bash }, () => {
  const folder = fs.mkdtempSync(path.join(tmpdir(), 'dev-startup-'))
  try {
    fs.copyFileSync(path.join(root, 'dev.sh'), path.join(folder, 'dev.sh'))
    fs.mkdirSync(path.join(folder, 'venv', 'bin'), { recursive: true })
    fs.writeFileSync(path.join(folder, 'venv', 'bin', 'python3'), `#!/usr/bin/env bash
if [[ "$1" == "-" ]]; then
  printf '%s\\n' "$FIXTURE_DATA"
else
  if [[ -z "$FIXTURE_TOKEN" ]]; then FIXTURE_TOKEN="$(cat "$FIXTURE_DATA/api-token")"; fi
  [[ "$CRAWSHRIMP_API_TOKEN" == "$FIXTURE_TOKEN" ]]
fi
`, { mode: 0o700 })
    const secret = 'local-review-secret-fixture'
    const tokenFile = path.join(folder, 'api-token')
    fs.writeFileSync(tokenFile, secret, { mode: 0o600 })
    const start = (token, expectedToken) => {
      const result = spawnSync('bash', [path.join(folder, 'dev.sh')], {
        encoding: 'utf8', env: { ...process.env, CRAWSHRIMP_API_TOKEN: token, FIXTURE_TOKEN: expectedToken, FIXTURE_DATA: folder },
      })
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /X-Crawshrimp-Token/)
      return result
    }
    for (const token of [secret, '']) {
      const result = start(token, secret)
      assert.ok(!result.stdout.includes(secret))
      assert.ok(!result.stderr.includes(secret))
    }

    fs.truncateSync(tokenFile, 0)
    fs.chmodSync(tokenFile, 0o644)
    const recovered = start('', '')
    const generated = fs.readFileSync(tokenFile, 'utf8')
    assert.equal(fs.statSync(tokenFile).mode & 0o777, 0o600, 'the recovered token file must be private')
    assert.match(generated, /^[0-9a-f]{64}$/)
    assert.ok(!recovered.stdout.includes(generated))
    assert.ok(!recovered.stderr.includes(generated))
  } finally {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})
