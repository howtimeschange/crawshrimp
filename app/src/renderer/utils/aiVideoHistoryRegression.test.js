import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import * as workflow from './balaAiVideoWorkflow.js'

const source = fs.readFileSync(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')
function loadFunctions(names, state) {
  const context = vm.createContext(state)
  for (const name of names) {
    const code = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`))?.[0]
    assert.ok(code, `missing ${name}`)
    vm.runInContext(code, context)
  }
  return context
}

test('record-only cleanup persists hidden paths and a later scan does not resurrect the MP4', async () => {
  const videoPath = '/workspace/209426107202_seedance_old.mp4'
  const result = { id: 'task-old', taskRefId: 'task-old', path: videoPath }
  let saved
  const state = {
    videoResults: [result], videoTasks: [{ id: 'task-old' }], videoHistoryHiddenPaths: new Set(),
    videoResultElements: new Map(), videoResultToPlayId: { value: '' }, videoStageState: {},
    videoHistoryCleanupBusy: { value: false },
    clearBalaVideoTaskHistory: workflow.clearBalaVideoTaskHistory,
    restoreBalaVideoResultsFromWorkspaceFiles: workflow.restoreBalaVideoResultsFromWorkspaceFiles,
    videoResultLocalPath: workflow.normalizeBalaVideoLocalPath,
    releaseWorkspaceVideoPreviews() {}, resetVideoResultPoll() {},
    flushWorkspaceManifest: async () => { saved = [...state.videoHistoryHiddenPaths]; return true },
    upsertVideoResults(results) { state.videoResults.push(...results) },
    videoTaskForResult: () => null,
    toBalaBridgeStringArray: workflow.toBalaBridgeStringArray,
  }
  const ctx = loadFunctions(['removeClearedVideoTasks', 'clearVideoHistoryRecords',
    'applyWorkspaceVideoFileSync', 'restoreVideoHistoryHiddenPaths'], state)
  await ctx.clearVideoHistoryRecords([result])
  assert.equal(state.videoResults.length, 0)
  assert.equal(state.videoTasks.length, 0)
  assert.deepEqual(saved, [videoPath])
  state.videoHistoryHiddenPaths.clear()
  ctx.restoreVideoHistoryHiddenPaths(JSON.parse(JSON.stringify(saved)))
  ctx.applyWorkspaceVideoFileSync([{ path: videoPath }])
  assert.equal(state.videoResults.length, 0)
})

test('cleanup releases the media handle and calls the workspace deletion bridge', async () => {
  const events = []
  const videoPath = '/workspace/209426107202.mp4'
  const ctx = loadFunctions(['deleteVideoHistoryLocalFiles'], {
    workspaceDir: { value: '/workspace' }, videoResults: [{ id: 'old', path: videoPath }],
    videoResultElements: new Map([['old', {
      pause: () => events.push('pause'), removeAttribute: () => events.push('remove-src'),
      load: () => events.push('release'),
    }]]),
    toBalaBridgeStringArray: workflow.toBalaBridgeStringArray,
    pathInsideDirectory: () => true, releaseWorkspaceVideoPreviews() {},
    videoResultLocalPath: workflow.normalizeBalaVideoLocalPath,
    window: { cs: { deleteBalaWorkspaceVideos: async (root, paths) => {
      assert.equal(root, '/workspace')
      assert.equal(paths[0], videoPath)
      events.push('delete')
      return { ok: true, failed_count: 0 }
    } } },
  })
  assert.equal((await ctx.deleteVideoHistoryLocalFiles([videoPath])).ok, true)
  assert.deepEqual(events, ['pause', 'remove-src', 'release', 'delete'])
})

test('loading an older snapshot repairs falsely completed drafts and preserves real completed tasks', () => {
  const draft = { id: 'draft', styleCode: '209426107202', status: '已完成' }
  const real = { id: 'real', providerTaskId: 'cgt-real-12345', status: '已完成' }
  const results = [draft, real].map(task => ({
    id: task.id, taskRefId: task.id, progressSource: 'local-workspace',
    path: `/workspace/209426107202_${task.id}.mp4`,
  }))
  const repaired = workflow.repairBalaVideoDraftAssociations([draft, real], results)
  assert.equal(repaired.tasks[0].status, '待预检')
  assert.equal(workflow.isBalaVideoTaskSubmitEligible(repaired.tasks[0]), true)
  const detached = repaired.results.find(item => item.path === results[0].path)
  assert.equal(detached.taskRefId, '')
  assert.equal(detached.path, results[0].path)
  assert.equal(repaired.tasks[1], real)
  assert.equal(repaired.results.find(item => item.id === real.id), results[1])
})

test('editing a completed video creates a fresh task using the new prompt and preserves the old task', () => {
  const old = { id: 'old', styleCode: '209426107202', status: '已完成', prompt: 'old prompt' }
  const state = {
    videoTasks: [old], editingVideoTaskId: { value: 'old' },
    videoTaskDraft: { provider: 'seedance', styleCode: old.styleCode, prompt: 'new prompt', outputDir: '/workspace' },
    videoTaskDraftRequirements: { value: [] }, selectedVideoTaskDraftAssets: { value: [] },
    videoTaskDraftError: { value: '' }, videoStageState: {}, videoTaskDialogOpen: { value: true },
    providerLabel: () => 'Seedance', videoTaskGenerationParams: () => ({}),
    isVideoTaskSubmittable: workflow.isBalaVideoTaskSubmitEligible,
    normalizeQnVideoModel: () => 'standard', normalizeQnVideoDuration: () => 15,
    isKlingVideoProvider: () => false, cancelVideoTaskPromptGeneration() {},
  }
  const ctx = loadFunctions(['createVideoTaskFromDraft'], state)
  ctx.createVideoTaskFromDraft()
  assert.equal(state.videoTasks.length, 2)
  assert.equal(state.videoTasks[1], old)
  assert.equal(old.prompt, 'old prompt')
  const fresh = state.videoTasks[0]
  assert.notEqual(fresh.id, old.id)
  assert.equal(fresh.prompt, 'new prompt')
  assert.equal(fresh.providerTaskId, '')
  assert.equal(workflow.isBalaVideoTaskSubmitEligible(fresh), true)
})
