const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

function findCommand(cmd) {
  const tool = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(tool, [cmd], { encoding: 'utf8' })
  if (result.status !== 0) return null
  const line = (result.stdout || '').split(/\r?\n/).map(s => s.trim()).find(Boolean)
  return line || null
}

function ensurePythonOnPath(env) {
  if (findCommand('python')) return env

  const python3 = findCommand('python3')
  if (!python3) return env

  const shimDir = path.join(__dirname, '..', '.builder-bin')
  fs.mkdirSync(shimDir, { recursive: true })

  if (process.platform === 'win32') {
    const shimPath = path.join(shimDir, 'python.cmd')
    fs.writeFileSync(shimPath, `@echo off\r\n"${python3}" %*\r\n`)
  } else {
    const shimPath = path.join(shimDir, 'python')
    try {
      if (fs.existsSync(shimPath)) fs.unlinkSync(shimPath)
      fs.symlinkSync(python3, shimPath)
    } catch (e) {
      fs.writeFileSync(shimPath, `#!/usr/bin/env bash\n"${python3}" "$@"\n`)
      fs.chmodSync(shimPath, 0o755)
    }
  }

  env.PATH = `${shimDir}${path.delimiter}${env.PATH || ''}`
  return env
}

const env = ensurePythonOnPath({ ...process.env })
const builderBin = path.join(
  __dirname,
  '..',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'
)
const builderCommand = process.env.ELECTRON_BUILDER_BIN || builderBin

const args = ['--config', 'build.yml', ...process.argv.slice(2)]
const maxAttempts = Math.max(1, Number.parseInt(process.env.ELECTRON_BUILDER_ATTEMPTS || '4', 10) || 4)
const retryDelayMs = Math.max(0, Number.parseInt(process.env.ELECTRON_BUILDER_RETRY_DELAY_MS || '10000', 10) || 10000)

function quoteWindowsArg(value) {
  if (value === '') return '""'
  if (!/[ \t"]/u.test(value)) return value
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`
}

function runBuilder() {
  const options = {
    cwd: path.join(__dirname, '..'),
    env,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  }

  if (process.platform !== 'win32') {
    return spawnSync(builderCommand, args, options)
  }

  const command = [builderCommand, ...args].map(quoteWindowsArg).join(' ')
  return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], options)
}

function writeResultOutput(result) {
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

function isTransientDownloadFailure(result) {
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  return (
    /cannot resolve https:\/\/github\.com\/.+status code 5\d\d/i.test(output) ||
    /response code 5\d\d/i.test(output) ||
    /gateway time-?out/i.test(output)
  )
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

let result
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  result = runBuilder()
  writeResultOutput(result)

  if (result.error || result.status === 0 || !isTransientDownloadFailure(result) || attempt === maxAttempts) {
    break
  }

  console.warn(`[build] electron-builder transient download failure on attempt ${attempt}/${maxAttempts}; retrying`)
  sleep(retryDelayMs)
}

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status == null ? 1 : result.status)
