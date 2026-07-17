import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('Electron and browser-development bridges expose matching favorite methods', () => {
  const main = read('app/src/main.js')
  const preload = read('app/src/preload.js')
  const devBridge = read('app/src/renderer/utils/devCsBridge.js')

  assert.match(main, /secureHandle\('get-script-favorites'/)
  assert.match(main, /secureHandle\('favorite-script'/)
  assert.match(main, /secureHandle\('unfavorite-script'/)
  assert.match(preload, /getScriptFavorites:\s*\(\) => ipcRenderer\.invoke\('get-script-favorites'\)/)
  assert.match(preload, /favoriteScript:\s*\(id\) => ipcRenderer\.invoke\('favorite-script', id\)/)
  assert.match(preload, /unfavoriteScript:\s*\(id\) => ipcRenderer\.invoke\('unfavorite-script', id\)/)
  assert.match(devBridge, /getScriptFavorites:\s*\(\) => apiCall\('GET', '\/script-favorites'\)/)
  assert.match(devBridge, /favoriteScript:\s*\(id\) => apiCall\('PUT'/)
  assert.match(devBridge, /unfavoriteScript:\s*\(id\) => apiCall\('DELETE'/)
})
