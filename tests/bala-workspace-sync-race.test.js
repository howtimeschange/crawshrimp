import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
const syncSource = source.slice(source.indexOf('async function syncWorkspaceFiles()'), source.indexOf('function materialRecallStyleSummary'))
function harness() {
  const applied = []
  const scans = []
  const state = {
    workspaceDir: { value: '/workspace/a' }, materialRecallClearBusy: { value: false },
    workspaceFileSyncBusy: false, workspaceFileSyncGeneration: 0,
    applyWorkspaceFileSync: files => applied.push(files),
    applyWorkspaceVideoFileSync: files => applied.push(files),
    window: { cs: {
      listBalaWorkspaceImages: workspace => new Promise(resolve => scans.push({ workspace, resolve })),
      listBalaWorkspaceVideos: async () => ['video'],
    } },
  }
  vm.createContext(state)
  vm.runInContext(syncSource, state)
  return { state, scans, applied }
}

test('overlapping polls and a scan completing after deletion cannot restore cleared images', async () => {
  const { state, scans, applied } = harness()
  const first = state.syncWorkspaceFiles()
  await state.syncWorkspaceFiles()
  assert.equal(scans.length, 1)
  state.materialRecallClearBusy.value = true
  state.workspaceFileSyncGeneration += 1
  await state.syncWorkspaceFiles()
  assert.equal(scans.length, 1)
  // The delete operation finishes before the old scan returns.
  state.materialRecallClearBusy.value = false
  scans[0].resolve(['deleted-image'])
  await first
  assert.deepEqual(applied, [])
  const next = state.syncWorkspaceFiles()
  scans[1].resolve([])
  await next
  assert.deepEqual(applied, [[], ['video']])
})

test('directory switches discard the old scan and scan failures release the poll lock', async () => {
  const { state, scans, applied } = harness()
  const first = state.syncWorkspaceFiles()
  state.workspaceDir.value = '/workspace/b'
  scans[0].resolve(['workspace-a-image'])
  await first
  assert.deepEqual(applied, [])
  state.window.cs.listBalaWorkspaceImages = async () => { throw new Error('file removed') }
  await state.syncWorkspaceFiles()
  assert.equal(state.workspaceFileSyncBusy, false)
  assert.deepEqual(applied, [['video']])
})
