const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const scriptPath = path.join(__dirname, 'download-python.sh')

function writeExecutable(filePath, body) {
  fs.writeFileSync(filePath, body, { mode: 0o755 })
}

test('download-python retries invalid GitHub asset responses before extracting', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-python-download-'))

  try {
    const appDir = path.join(tmp, 'app')
    const scriptsDir = path.join(appDir, 'scripts')
    const coreDir = path.join(tmp, 'core')
    const fakeBinDir = path.join(tmp, 'bin')
    fs.mkdirSync(scriptsDir, { recursive: true })
    fs.mkdirSync(coreDir, { recursive: true })
    fs.mkdirSync(fakeBinDir, { recursive: true })
    fs.copyFileSync(scriptPath, path.join(scriptsDir, 'download-python.sh'))
    fs.writeFileSync(path.join(coreDir, 'requirements.txt'), 'fastapi==0.0.0\n')

    const curlState = path.join(tmp, 'curl-count')
    writeExecutable(
      path.join(fakeBinDir, 'curl'),
      `#!/usr/bin/env bash
set -e
for arg in "$@"; do
  if [ "$arg" = "-sI" ]; then
    echo "HTTP/2 200"
    exit 0
  fi
done
out=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o|--output)
      shift
      out="$1"
      ;;
    http*)
      url="$1"
      ;;
  esac
  shift || true
done
if [ -z "$out" ]; then
  echo "missing output path" >&2
  exit 2
fi
if [[ "$url" == *"SHA256SUMS" ]]; then
  printf 'expected-sha  cpython-3.12.13+20260310-aarch64-apple-darwin-install_only_stripped.tar.gz\\n' > "$out"
  exit 0
fi
count=0
if [ -f "\${FAKE_CURL_STATE}" ]; then
  count="$(cat "\${FAKE_CURL_STATE}")"
fi
count=$((count + 1))
echo "$count" > "\${FAKE_CURL_STATE}"
if [ "$count" -eq 1 ]; then
  printf 'temporary upstream error body' > "$out"
else
  printf 'valid archive marker' > "$out"
fi
`
    )

    writeExecutable(
      path.join(fakeBinDir, 'shasum'),
      `#!/usr/bin/env bash
set -e
if [ "$1" = "-a" ] && [ "$2" = "256" ] && [ "$3" = "-c" ]; then
  input="$(cat)"
  case "$input" in
    expected-sha*) exit 0 ;;
    *) echo "unexpected checksum input: $input" >&2; exit 1 ;;
  esac
fi
echo "unexpected shasum args: $*" >&2
exit 2
`
    )

    writeExecutable(
      path.join(fakeBinDir, 'tar'),
      `#!/usr/bin/env bash
set -e
if [ "$1" = "-tzf" ]; then
  grep -q 'valid archive marker' "$2"
  exit $?
fi
archive=""
dest=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -xzf)
      shift
      archive="$1"
      ;;
    -C)
      shift
      dest="$1"
      ;;
  esac
  shift || true
done
grep -q 'valid archive marker' "$archive"
mkdir -p "$dest/bin"
cat > "$dest/bin/python3" <<'PY'
#!/usr/bin/env bash
if [ "$1" = "-V" ]; then
  echo "Python 3.12.13"
  exit 0
fi
if [ "$1" = "-m" ] && [ "$2" = "pip" ]; then
  exit 0
fi
exit 0
PY
chmod +x "$dest/bin/python3"
`
    )

    const result = spawnSync('bash', [path.join(scriptsDir, 'download-python.sh')], {
      cwd: appDir,
      env: {
        ...process.env,
        PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH}`,
        PYTHON_TARGETS: 'mac-arm64',
        FAKE_CURL_STATE: curlState,
      },
      encoding: 'utf8',
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.equal(fs.readFileSync(curlState, 'utf8').trim(), '2')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('download-python verifies archive SHA256 before extracting', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-python-sha256-'))

  try {
    const appDir = path.join(tmp, 'app')
    const scriptsDir = path.join(appDir, 'scripts')
    const coreDir = path.join(tmp, 'core')
    const fakeBinDir = path.join(tmp, 'bin')
    fs.mkdirSync(scriptsDir, { recursive: true })
    fs.mkdirSync(coreDir, { recursive: true })
    fs.mkdirSync(fakeBinDir, { recursive: true })
    fs.copyFileSync(scriptPath, path.join(scriptsDir, 'download-python.sh'))
    fs.writeFileSync(path.join(coreDir, 'requirements.txt'), 'fastapi==0.0.0\n')

    const verifiedMarker = path.join(tmp, 'sha256-verified')
    writeExecutable(
      path.join(fakeBinDir, 'curl'),
      `#!/usr/bin/env bash
set -e
for arg in "$@"; do
  if [ "$arg" = "-sI" ]; then
    echo "HTTP/2 200"
    exit 0
  fi
done
out=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o|--output)
      shift
      out="$1"
      ;;
    http*)
      url="$1"
      ;;
  esac
  shift || true
done
if [[ "$url" == *"SHA256SUMS" ]]; then
  printf 'expected-sha  cpython-3.12.13+20260310-aarch64-apple-darwin-install_only_stripped.tar.gz\\n' > "$out"
else
  printf 'valid archive marker' > "$out"
fi
`
    )

    writeExecutable(
      path.join(fakeBinDir, 'shasum'),
      `#!/usr/bin/env bash
set -e
if [ "$1" = "-a" ] && [ "$2" = "256" ] && [ "$3" = "-c" ]; then
  input="$(cat)"
  case "$input" in
    expected-sha*) echo verified > "\${FAKE_SHA256_MARKER}"; exit 0 ;;
    *) echo "unexpected checksum input: $input" >&2; exit 1 ;;
  esac
fi
echo "unexpected shasum args: $*" >&2
exit 2
`
    )

    writeExecutable(
      path.join(fakeBinDir, 'tar'),
      `#!/usr/bin/env bash
set -e
if [ "$1" = "-tzf" ]; then
  grep -q 'valid archive marker' "$2"
  exit $?
fi
archive=""
dest=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -xzf)
      shift
      archive="$1"
      ;;
    -C)
      shift
      dest="$1"
      ;;
  esac
  shift || true
done
grep -q 'valid archive marker' "$archive"
mkdir -p "$dest/bin"
cat > "$dest/bin/python3" <<'PY'
#!/usr/bin/env bash
if [ "$1" = "-V" ]; then
  echo "Python 3.12.13"
  exit 0
fi
if [ "$1" = "-m" ] && [ "$2" = "pip" ]; then
  exit 0
fi
exit 0
PY
chmod +x "$dest/bin/python3"
`
    )

    const result = spawnSync('bash', [path.join(scriptsDir, 'download-python.sh')], {
      cwd: appDir,
      env: {
        ...process.env,
        PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH}`,
        PYTHON_TARGETS: 'mac-arm64',
        FAKE_SHA256_MARKER: verifiedMarker,
      },
      encoding: 'utf8',
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.equal(fs.readFileSync(verifiedMarker, 'utf8').trim(), 'verified')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('download-python reinstalls cached bundle when xlrd is missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-python-cache-'))

  try {
    const appDir = path.join(tmp, 'app')
    const scriptsDir = path.join(appDir, 'scripts')
    const coreDir = path.join(tmp, 'core')
    const fakeBinDir = path.join(tmp, 'bin')
    const bundleDir = path.join(appDir, 'python-dist', 'win-x64')
    const sitePackages = path.join(bundleDir, 'Lib', 'site-packages')
    fs.mkdirSync(scriptsDir, { recursive: true })
    fs.mkdirSync(coreDir, { recursive: true })
    fs.mkdirSync(fakeBinDir, { recursive: true })
    fs.mkdirSync(sitePackages, { recursive: true })
    fs.copyFileSync(scriptPath, path.join(scriptsDir, 'download-python.sh'))

    const requirements = [
      'fastapi==0.0.0',
      'uvicorn==0.0.0',
      'websockets==0.0.0',
      'pyyaml==0.0.0',
      'apscheduler==0.0.0',
      'openpyxl==0.0.0',
      'xlrd==0.0.0',
      'pydantic==0.0.0',
      'aiofiles==0.0.0',
      'jsonschema==0.0.0',
      'tzdata==0.0.0',
      'Pillow==0.0.0',
      'PyMuPDF==0.0.0',
    ].join('\n') + '\n'
    fs.writeFileSync(path.join(coreDir, 'requirements.txt'), requirements)
    fs.writeFileSync(path.join(bundleDir, '.crawshrimp-requirements.txt'), requirements)
    fs.writeFileSync(path.join(bundleDir, 'python.exe'), '')

    for (const name of [
      'fastapi',
      'uvicorn',
      'websockets',
      'yaml',
      'apscheduler',
      'openpyxl',
      'pydantic',
      'aiofiles',
      'jsonschema',
      'tzdata',
      'PIL',
      'fitz',
    ]) {
      fs.mkdirSync(path.join(sitePackages, name), { recursive: true })
    }

    writeExecutable(
      path.join(fakeBinDir, 'python3'),
      `#!/usr/bin/env bash
if [ "$1" = "-m" ] && [ "$2" = "pip" ]; then
  if [ "$3" = "--version" ]; then
    echo "pip 0.0.0"
    exit 0
  fi
  shift 2
  target=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --target)
        shift
        target="$1"
        ;;
    esac
    shift || true
  done
  if [ -z "$target" ]; then
    echo "missing --target" >&2
    exit 2
  fi
  mkdir -p "$target/xlrd"
  echo installed > "$target/xlrd/MARKER"
  exit 0
fi
exit 0
`
    )

    const result = spawnSync('bash', [path.join(scriptsDir, 'download-python.sh')], {
      cwd: appDir,
      env: {
        ...process.env,
        PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH}`,
        PYTHON_TARGETS: 'win-x64',
        PYTHON: path.join(fakeBinDir, 'python3'),
      },
      encoding: 'utf8',
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /Cross-installing backend requirements into win-x64/)
    assert.ok(fs.existsSync(path.join(sitePackages, 'xlrd', 'MARKER')))
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
