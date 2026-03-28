const fs = require('fs')
const os = require('os')
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

const args = ['--config', 'build.yml', ...process.argv.slice(2)]
const result = spawnSync(builderBin, args, {
  cwd: path.join(__dirname, '..'),
  env,
  stdio: 'inherit',
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status || 0)
