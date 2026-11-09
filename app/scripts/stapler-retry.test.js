const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function runMock({ action = 'staple', failures = 1, status = 68, error }) {
  return spawnSync('bash', ['-c', `
    set -euo pipefail
    source "$1"
    calls=0
    xcrun() {
      calls=$((calls + 1))
      printf 'action=%s target=%s\n' "$2" "$3"
      if [ "$calls" -le "$MOCK_FAILURES" ]; then
        printf '%s\n' "$MOCK_ERROR"
        return "$MOCK_STATUS"
      fi
    }
    sleep() { :; }
    if run_stapler_with_retry "$MOCK_ACTION" '/tmp/抓虾 test.app'; then
      result=0
    else
      result=$?
    fi
    printf 'calls=%s\n' "$calls"
    exit "$result"
  `, 'stapler-test', path.join(__dirname, 'stapler-retry.sh')], {
    encoding: 'utf8',
    env: { ...process.env, MOCK_ACTION: action, MOCK_FAILURES: String(failures),
      MOCK_STATUS: String(status), MOCK_ERROR: error },
  })
}

for (const action of ['staple', 'validate']) {
  test(`stapler ${action} retries a lost Apple connection and preserves the target`, () => {
    const result = runMock({ action, error: 'NSURLErrorDomain Code=-1005 "The network connection was lost."' })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /calls=2/)
    assert.match(result.stdout, new RegExp(`action=${action} target=/tmp/抓虾 test.app`))
  })
}

test('stapler fails immediately on an invalid ticket', () => {
  const result = runMock({ error: 'The ticket does not match the code signature.' })
  assert.equal(result.status, 68)
  assert.match(result.stdout, /calls=1/)
  assert.doesNotMatch(result.stdout, /retrying/)
})

test('persistent Apple connection failure stops after five attempts', () => {
  const result = runMock({ failures: 10, error: 'NSURLErrorDomain Code=-1005' })
  assert.equal(result.status, 68)
  assert.match(result.stdout, /calls=5/)
})
