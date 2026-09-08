const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path')
const source = fs.readFileSync(path.join(__dirname, '../app/src/renderer/views/AiVideoWorkflow.vue'), 'utf8')
function fixture() {
  const completions = []
  const state = {
    localVideoPreviews: {}, workspaceDir: { value: '/workspace' }, localImagePreviews: {}, brokenPreviews: {}, localImagePreviewLoading: new Set(),
    localImageCacheKey: (path, thumb) => thumb ? `thumb:${path}` : path,
    window: { cs: { readBalaWorkspaceImageThumbnail: () => new Promise(resolve => completions.push(resolve)) } },
  }
  vm.createContext(state)
  vm.runInContext(source.slice(source.indexOf('const localImagePreviewRequests ='), source.indexOf('function imagePreviewSource(')) + source.slice(source.indexOf('function releaseWorkspaceImagePreviews('), source.indexOf('function filesAfterMaterialRecallClear(')) + source.slice(source.indexOf('function releaseWorkspacePreviews('), source.indexOf('function releaseWorkspaceVideoPreviews(')), state)
  return { state, completions }
}
test('old preview cannot overwrite a replacement or clear its in-flight request', async () => {
  const { state, completions } = fixture()
  const file = '/workspace/photo.jpg', key = `thumb:${file}`
  const old = state.loadLocalImagePreview(file, { thumbnail: true })
  state.releaseWorkspaceImagePreviews([file])
  const fresh = state.loadLocalImagePreview(file, { thumbnail: true })
  assert.equal(completions.length, 2)
  completions[0]({ data_url: 'OLD' }); await old
  assert.equal(state.localImagePreviews[key], undefined)
  assert.equal(state.localImagePreviewLoading.has(key), true)
  completions[1]({ data_url: 'NEW' }); await fresh
  assert.equal(state.localImagePreviews[key], 'NEW')
  assert.equal(state.localImagePreviewLoading.has(key), false)
})
test('completion from the previous workspace does not populate the cache', async () => {
  const { state, completions } = fixture()
  const pending = state.loadLocalImagePreview('/workspace/photo.jpg', { thumbnail: true })
  state.workspaceDir.value = '/new-workspace'
  completions[0]({ data_url: 'OLD' }); await pending
  assert.equal(Object.keys(state.localImagePreviews).length, 0)
})

test('clearing the workspace invalidates pending image completions', async () => {
  const { state, completions } = fixture()
  const pending = state.loadLocalImagePreview('/workspace/photo.jpg', { thumbnail: true })
  state.releaseWorkspacePreviews()
  completions[0]({ data_url: 'OLD' }); await pending
  assert.equal(Object.keys(state.localImagePreviews).length, 0)
  assert.equal(state.localImagePreviewLoading.size, 0)
})
