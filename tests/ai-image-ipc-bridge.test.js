const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const main = fs.readFileSync(path.join(root, 'app/src/main.js'), 'utf8')
const preload = fs.readFileSync(path.join(root, 'app/src/preload.js'), 'utf8')
const devBridge = fs.readFileSync(path.join(root, 'app/src/renderer/utils/devCsBridge.js'), 'utf8')

test('main process registers ai image IPC handlers backed by local API routes', () => {
  const expected = [
    ['list-ai-image-jobs', "apiCall('GET', '/ai-image/jobs"],
    ['create-ai-image-job', "apiCall('POST', '/ai-image/jobs'"],
    ['get-ai-image-job', "/ai-image/jobs/${encodeURIComponent"],
    ['update-ai-image-job', "apiCall('PATCH', `/ai-image/jobs/${encodeURIComponent"],
    ['run-ai-image-job', "apiCall('POST', `/ai-image/jobs/${encodeURIComponent"],
    ['batch-run-ai-image-job', '/batch-run`'],
    ['save-as-ai-image-job', "/save-as`"],
    ['materialize-ai-image-result', "/materialize`"],
    ['create-ai-image-asset', "apiCall('POST', '/ai-image/assets'"],
    ['create-ai-image-canvas', "apiCall('POST', '/ai-image/canvases'"],
    ['read-local-image-preview', 'readLocalImageDataUrl'],
  ]
  for (const [channel, route] of expected) {
    assert.match(main, new RegExp(`secureHandle\\('${channel}'`))
    assert.ok(main.includes(route), `${route} missing`)
  }
})

test('preload exposes ai image methods with IPC fallback to HTTP', () => {
  const methods = [
    'listAiImageJobs',
    'createAiImageJob',
    'getAiImageJob',
    'updateAiImageJob',
    'runAiImageJob',
    'batchRunAiImageJob',
    'saveAsAiImageJob',
    'materializeAiImageResult',
    'createAiImageAsset',
    'createAiImageCanvas',
    'readLocalImagePreview',
  ]
  for (const method of methods) {
    assert.match(preload, new RegExp(`${method}:`))
  }
  assert.match(preload, /invokeWithApiFallback\('list-ai-image-jobs'/)
  assert.match(preload, /apiCall\('POST', `\/ai-image\/jobs\/\$\{encodePathPart\(uid\)\}\/run`/)
  assert.match(preload, /batchRunAiImageJob: \(uid, payload\) => invokeWithApiFallback\('batch-run-ai-image-job'/)
  assert.match(preload, /apiCall\('POST', `\/ai-image\/jobs\/\$\{encodePathPart\(uid\)\}\/batch-run`, payload \|\| \{\}\)/)
  assert.match(preload, /materializeAiImageResult: \(uid, payload\) => invokeWithApiFallback\('materialize-ai-image-result'/)
  assert.match(preload, /apiCall\('POST', `\/ai-image\/jobs\/\$\{encodePathPart\(uid\)\}\/materialize`, payload \|\| \{\}\)/)
  assert.match(preload, /readLocalImagePreview: \(path\) => invokeWithApiFallback\('read-local-image-preview'/)
  assert.match(preload, /apiCall\('POST', '\/files\/local-image-preview', \{ path \}\)/)
})

test('dev bridge maps ai image methods directly to local HTTP API', () => {
  assert.match(devBridge, /listAiImageJobs: \(\) => apiCall\('GET', '\/ai-image\/jobs'\)/)
  assert.match(devBridge, /createAiImageJob: \(payload\) => apiCall\('POST', '\/ai-image\/jobs', payload \|\| \{\}\)/)
  assert.match(devBridge, /getAiImageJob: \(uid\) => apiCall\('GET', `\/ai-image\/jobs\/\$\{encodePathPart\(uid\)\}`\)/)
  assert.match(devBridge, /runAiImageJob: \(uid\) => apiCall\('POST', `\/ai-image\/jobs\/\$\{encodePathPart\(uid\)\}\/run`, \{\}\)/)
  assert.match(devBridge, /batchRunAiImageJob: \(uid, payload\) => apiCall\('POST', `\/ai-image\/jobs\/\$\{encodePathPart\(uid\)\}\/batch-run`, payload \|\| \{\}\)/)
  assert.match(devBridge, /materializeAiImageResult: \(uid, payload\) => apiCall\('POST', `\/ai-image\/jobs\/\$\{encodePathPart\(uid\)\}\/materialize`, payload \|\| \{\}\)/)
  assert.match(devBridge, /createAiImageAsset: \(payload\) => apiCall\('POST', '\/ai-image\/assets', payload \|\| \{\}\)/)
  assert.match(devBridge, /createAiImageCanvas: \(payload\) => apiCall\('POST', '\/ai-image\/canvases', payload \|\| \{\}\)/)
  assert.match(devBridge, /readLocalImagePreview: \(path\) => apiCall\('POST', '\/files\/local-image-preview', \{ path \}\)/)
})
