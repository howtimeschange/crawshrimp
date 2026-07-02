import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync('src/renderer/utils/devCsBridge.js', 'utf8')
const rendererEntry = fs.readFileSync('src/renderer/main.js', 'utf8')

test('dev browser bridge installs only when preload bridge is missing', () => {
  assert.match(source, /window\.cs \|\| !isLocalRenderer\(\)/)
  assert.match(source, /window\.cs = createDevCsBridge\(\)/)
  assert.match(rendererEntry, /installDevCsBridge\(\)/)
})

test('dev browser bridge supports task instances and local API token header', () => {
  assert.match(source, /X-Crawshrimp-Token/)
  assert.match(source, /listTaskInstances/)
  assert.match(source, /createTaskInstance/)
  assert.match(source, /runTaskInstance/)
  assert.match(source, /TOKEN_STORAGE_KEY = 'crawshrimp\.apiToken'/)
  assert.match(source, /API_BASE_STORAGE_KEY = 'crawshrimp\.apiBase'/)
  assert.match(source, /crawshrimp_api_base/)
})
