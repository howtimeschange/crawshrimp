const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { requirePythonBundle, requirePythonScriptsBundle } = require('./after-pack')

test('requirePythonBundle rejects missing bundled Python source', () => {
  const missing = path.join(__dirname, '..', '.missing-python-dist', 'win-x64')

  assert.throws(
    () => requirePythonBundle(missing),
    /bundled Python not found/
  )
})

test('requirePythonBundle rejects Windows bundle without python.exe', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-python-'))

  try {
    assert.throws(
      () => requirePythonBundle(tmp, 'win-x64'),
      /python\.exe/
    )
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('requirePythonBundle rejects bundle missing required backend dependencies', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-python-'))

  try {
    fs.writeFileSync(path.join(tmp, 'python.exe'), '')
    fs.mkdirSync(path.join(tmp, 'Lib', 'site-packages'), { recursive: true })

    assert.throws(
      () => requirePythonBundle(tmp, 'win-x64'),
      /missing bundled Python dependencies/
    )
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('requirePythonBundle rejects a legacy-complete bundle missing cryptography', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-python-crypto-'))

  try {
    const sitePackages = path.join(tmp, 'Lib', 'site-packages')
    fs.writeFileSync(path.join(tmp, 'python.exe'), '')
    for (const name of [
      'fastapi',
      'uvicorn',
      'websockets',
      'yaml',
      'apscheduler',
      'openpyxl',
      'xlrd',
      'pydantic',
      'aiofiles',
      'jsonschema',
      'tzdata',
      'PIL',
      'fitz',
    ]) {
      fs.mkdirSync(path.join(sitePackages, name), { recursive: true })
    }

    assert.throws(
      () => requirePythonBundle(tmp, 'win-x64'),
      /cryptography/
    )
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('requirePythonScriptsBundle rejects resources without backend entrypoint', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-resources-'))

  try {
    assert.throws(
      () => requirePythonScriptsBundle(tmp),
      /api_server\.py/
    )
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('requirePythonScriptsBundle rejects resources without adapter manifests', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-resources-'))

  try {
    fs.mkdirSync(path.join(tmp, 'python-scripts', 'core'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'python-scripts', 'core', 'api_server.py'), '')

    assert.throws(
      () => requirePythonScriptsBundle(tmp),
      /adapter manifest/
    )
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('requirePythonScriptsBundle rejects adapter directories without manifest', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-resources-'))

  try {
    fs.mkdirSync(path.join(tmp, 'python-scripts', 'core'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'python-scripts', 'core', 'api_server.py'), '')
    fs.mkdirSync(path.join(tmp, 'python-scripts', 'adapters', 'good-adapter'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'python-scripts', 'adapters', 'good-adapter', 'manifest.yaml'), '')
    fs.mkdirSync(path.join(tmp, 'python-scripts', 'adapters', 'broken-adapter'), { recursive: true })

    assert.throws(
      () => requirePythonScriptsBundle(tmp),
      /missing manifest\.yaml/
    )
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('requirePythonScriptsBundle rejects resources without shared video integrations', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-resources-'))

  try {
    fs.mkdirSync(path.join(tmp, 'python-scripts', 'core'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'python-scripts', 'core', 'api_server.py'), '')
    fs.mkdirSync(path.join(tmp, 'python-scripts', 'adapters', 'good-adapter'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'python-scripts', 'adapters', 'good-adapter', 'manifest.yaml'), '')

    assert.throws(
      () => requirePythonScriptsBundle(tmp),
      /shared video integration/
    )
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
