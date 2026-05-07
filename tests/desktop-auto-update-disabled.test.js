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

test('desktop app source no longer exposes app auto-update runtime hooks', () => {
  const main = readRepoFile('app/src/main.js')
  const preload = readRepoFile('app/src/preload.js')
  const appShell = readRepoFile('app/src/renderer/App.vue')
  const settings = readRepoFile('app/src/renderer/views/SettingsPage.vue')

  assert.doesNotMatch(main, /electron-updater/)
  assert.doesNotMatch(main, /createUpdateService/)
  assert.doesNotMatch(main, /update:get-status/)
  assert.doesNotMatch(main, /update:check/)

  assert.doesNotMatch(preload, /getUpdateStatus/)
  assert.doesNotMatch(preload, /checkForUpdates/)
  assert.doesNotMatch(preload, /downloadUpdate/)
  assert.doesNotMatch(preload, /installUpdate/)
  assert.doesNotMatch(preload, /onUpdateStatus/)

  assert.doesNotMatch(appShell, /topbar-update-btn/)
  assert.doesNotMatch(settings, /auto-update-section/)
  assert.doesNotMatch(settings, /检查更新/)
})

test('desktop packaging no longer publishes app auto-update metadata', () => {
  const packageJson = JSON.parse(readRepoFile('app/package.json'))
  const buildYml = readRepoFile('app/build.yml')
  const workflow = readRepoFile('.github/workflows/build-desktop.yml')

  assert.equal(packageJson.dependencies['electron-updater'], undefined)
  assert.doesNotMatch(buildYml, /\npublish:\n/)
  assert.doesNotMatch(buildYml, /target:\s*\n\s*-\s*target:\s*zip/)
  assert.doesNotMatch(workflow, /latest\*\.yml/)
})
