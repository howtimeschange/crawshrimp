import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

test('desktop backend starts as a module from python-scripts root', () => {
  const main = readRepoFile('app/src/main.js')

  assert.match(main, /function getBackendLaunchArgs\(\) \{\s*return \['-m', 'core\.api_server'\]\s*\}/)
  assert.match(main, /const launchArgs = getBackendLaunchArgs\(\)/)
  assert.match(main, /spawn\(pythonBin, launchArgs, \{/)
  assert.match(main, /cwd: scriptsDir/)
  assert.match(main, /PYTHONPATH: scriptsDir/)
  assert.doesNotMatch(main, /spawn\(pythonBin, \[serverScript\]/)
})

test('desktop backend switches away from an occupied non-compatible API port before launch', () => {
  const main = readRepoFile('app/src/main.js')

  assert.match(main, /async function prepareBackendEndpoint\(\)/)
  assert.match(main, /const availablePort = await findAvailableApiPort\(apiPort\)/)
  assert.match(main, /port \$\{apiPort\} is occupied but no compatible backend responded/)
  assert.match(main, /async function startBackend\(\) \{\s*await prepareBackendEndpoint\(\)\s*await backendController\.ensureReady\(\)\s*\}/)
})

test('settings page displays the runtime backend port reported by the main process', () => {
  const appShell = readRepoFile('app/src/renderer/App.vue')
  const settings = readRepoFile('app/src/renderer/views/SettingsPage.vue')

  assert.match(appShell, /apiPort: 18765/)
  assert.match(appShell, /status\.value\.apiPort = s\.apiPort \|\| status\.value\.apiPort/)
  assert.match(settings, /核心服务 \(端口 \{\{ props\.status\?\.apiPort \|\| 18765 \}\}\)/)
})

test('desktop backend receives a resolved writable CRAWSHRIMP_DATA directory', () => {
  const main = readRepoFile('app/src/main.js')

  assert.match(main, /function resolveCrawshrimpDataDir\(\)/)
  assert.match(main, /function readDesktopConfig\(\)/)
  assert.match(main, /function writeDesktopConfig\(patch = \{\}\)/)
  assert.match(main, /function resolveConfiguredDataDir\(rawValue = ''\)/)
  assert.match(main, /function getWindowsLocalCrawshrimpDataDir\(\)/)
  assert.match(main, /path\.join\(localAppData, 'crawshrimp'\)/)
  assert.match(main, /function readLegacyConfiguredDataDir\(\)/)
  assert.match(main, /function ensureWritableDirectory\(dirPath, label = 'directory'\)/)
  assert.match(main, /function ensureWritableDataDir\(dirPath\)/)
  assert.match(main, /for \(const childName of \['adapters', 'adapter-meta', 'data', 'logs'\]\)/)
  assert.match(main, /function prepareCrawshrimpDataDir\(\)/)
  assert.match(main, /resolvedCrawshrimpDataDir = prepareCrawshrimpDataDir\(\)/)
  assert.match(main, /resolvedCrawshrimpDataDir = getCrawshrimpDataDir\(\)/)
  assert.match(main, /CRAWSHRIMP_DATA: resolvedCrawshrimpDataDir/)
  assert.match(main, /writeDesktopConfig\(\{ data_dir: writable \}\)/)
  assert.match(main, /cfg\.data_dir = desktopDataDir \|\| getCrawshrimpDataDir\(\)/)
  assert.match(main, /plain\.data_dir = dataDir/)
  assert.match(main, /return resolvedCrawshrimpDataDir/)
})
