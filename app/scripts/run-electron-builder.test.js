const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const scriptPath = path.join(__dirname, 'run-electron-builder.js')

function writeExecutable(filePath, body) {
  fs.writeFileSync(filePath, body, { mode: 0o755 })
}

test('run-electron-builder retries transient GitHub download failures', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-builder-retry-'))

  try {
    const fakeBuilder = path.join(tmp, 'electron-builder')
    const stateFile = path.join(tmp, 'attempts')
    writeExecutable(
      fakeBuilder,
      `#!/usr/bin/env bash
count=0
if [ -f "${stateFile}" ]; then
  count="$(cat "${stateFile}")"
fi
count=$((count + 1))
echo "$count" > "${stateFile}"
if [ "$count" -eq 1 ]; then
  echo "cannot resolve https://github.com/electron/electron/releases/download/v29.4.6/electron-v29.4.6-darwin-arm64.zip: status code 504" >&2
  exit 1
fi
echo "builder success"
exit 0
`
    )

    const result = spawnSync(process.execPath, [scriptPath, '--mac'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        ELECTRON_BUILDER_BIN: fakeBuilder,
        ELECTRON_BUILDER_ATTEMPTS: '2',
        ELECTRON_BUILDER_RETRY_DELAY_MS: '1',
      },
      encoding: 'utf8',
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.equal(fs.readFileSync(stateFile, 'utf8').trim(), '2')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
