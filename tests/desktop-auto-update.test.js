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

test('desktop updater dependency and state service are restored', () => {
  const packageJson = JSON.parse(readRepoFile('app/package.json'))
  const updateServicePath = path.join(repoRoot, 'app/src/updateService.js')
  const updateService = readRepoFile('app/src/updateService.js')
  const main = readRepoFile('app/src/main.js')
  const preload = readRepoFile('app/src/preload.js')

  assert.equal(packageJson.dependencies['electron-updater'], '6.8.9')
  assert.equal(fs.existsSync(updateServicePath), true)
  assert.match(updateService, /autoDownload = false/)
  assert.match(updateService, /autoInstallOnAppQuit = false/)
  assert.match(main, /require\('electron-updater'\)/)
  assert.match(main, /createUpdateService/)
  assert.match(main, /createUpdateInstallCoordinator/)
  assert.match(main, /15000/)
  assert.match(main, /update:get-status/)
  assert.match(main, /update:check/)
  assert.match(main, /update:download/)
  assert.match(main, /update:install/)
  assert.match(preload, /getUpdateStatus/)
  assert.match(preload, /checkForUpdates/)
  assert.match(preload, /downloadUpdate/)
  assert.match(preload, /installUpdate/)
  assert.match(preload, /onUpdateStatus/)
  assert.doesNotMatch(preload, /setFeedURL/)
})
