const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const workbench = fs.readFileSync(path.join(root, 'app/src/renderer/views/AiImageWorkbench.vue'), 'utf8')

function functionBody(name, nextName) {
  const start = workbench.indexOf(`function ${name}`)
  const end = workbench.indexOf(`function ${nextName}`, start + 1)
  assert.ok(start >= 0, `${name} missing`)
  assert.ok(end > start, `${nextName} missing after ${name}`)
  return workbench.slice(start, end)
}

test('batch dialog caps Prompt cards at 20', () => {
  assert.match(workbench, /const MAX_BATCH_PROMPTS = 20/)
  assert.match(workbench, /batchPromptCards\.value\.length >= MAX_BATCH_PROMPTS/)
  assert.match(workbench, /最多添加 20 条 Prompt/)
  assert.match(workbench, /:disabled="batchGenerationDialog\.submitting \|\| batchPromptCards\.length >= MAX_BATCH_PROMPTS"/)
})

test('batch submission reuses current job and calls the async endpoint once', () => {
  const body = functionBody('submitBatchGeneration', 'generate')
  assert.match(body, /ensureCurrentTask\(\)/)
  assert.match(body, /window\.cs\.updateAiImageJob\(jobUid,/)
  assert.match(body, /window\.cs\.batchRunAiImageJob\(jobUid,/)
  assert.match(body, /request_uid:/)
  assert.match(body, /batchGenerationDialog\.open = false/)
  assert.match(body, /startJobPolling\(jobUid\)/)
  assert.doesNotMatch(body, /for \(const \[index, card\]/)
  assert.doesNotMatch(body, /window\.cs\.createAiImageJob/)
  assert.doesNotMatch(body, /window\.cs\.runAiImageJob/)
})

test('workbench polls only the local job while active runs exist', () => {
  assert.match(workbench, /function hasActiveRuns\(job\)/)
  assert.match(workbench, /function startJobPolling\(jobUid\)/)
  assert.match(workbench, /window\.cs\.getAiImageJob\(uid\)/)
  assert.match(workbench, /setTimeout\([^,]+, 1000\)/)
  assert.match(workbench, /function stopJobPolling\(\)/)
  assert.match(workbench, /clearTimeout\(jobPollingTimer\)/)
  assert.match(workbench, /onBeforeUnmount\([\s\S]*stopJobPolling\(\)/)
})

test('queued, running, and failed persisted runs remain visible as queue cards', () => {
  const body = functionBody('collectResultQueues', 'collectResultCardsFromRun')
  assert.match(body, /workbenchRunPlaceholder\(job, run, index\)/)
  assert.match(workbench, /\['queued', 'running'\]\.includes\(status\)/)
  assert.match(workbench, /if \(status === 'failed'\)/)
  assert.match(workbench, /item\.failed/)
  assert.match(workbench, /生成失败/)
})

test('Nano Banana controls use resolution tiers and hide unsupported fields', () => {
  assert.match(workbench, /isNanoBananaModel/)
  assert.match(workbench, /sizeOptionsForModel\(form\.modelId, form\.ratio\)/)
  assert.match(workbench, /qualityOptionsForModel\(form\.modelId\)/)
  assert.match(workbench, /v-if="!activeNanoBanana"[\s\S]*>质量</)
  assert.match(workbench, /v-if="!activeNanoBanana"[\s\S]*>格式</)
  assert.match(workbench, /:disabled="activeNanoBanana"/)
})

test('preview falls back to remote URL while local cache data is loading', () => {
  const body = functionBody('resultPreviewSrc', 'lightboxThumbnailSrc')
  assert.match(body, /for \(const key of resultPreviewCandidates\(item\)\)/)
  assert.doesNotMatch(body, /!isRemoteOrDataImage\(key\)[^\n]+return ''/)
  assert.match(body, /continue/)
})

test('new remote result URLs are cached without waiting for image load', () => {
  assert.match(workbench, /watch\(resultCards, \(cards\) => \{[\s\S]*cards\.forEach\(\(card\) => queueResultCache\(card\)\)/)
  assert.match(workbench, /function queueResultCache\(item\)/)
  assert.match(workbench, /resultCachePending\.has\(url\)/)
})

test('loading cards show contextual artwork and rotating Crawshrimp copy', () => {
  assert.match(workbench, /resolveLoadingPreviewContext/)
  assert.match(workbench, /class="aiw-loading-source"/)
  assert.match(workbench, /class="aiw-loading-default-art"/)
  assert.match(workbench, /loadingMessage\(item\)/)
  assert.match(workbench, /loadingMessageTimer = setInterval/)
  assert.match(workbench, /clearInterval\(loadingMessageTimer\)/)
  assert.match(workbench, /refreshImagePreview\(item\.loadingPreviewPath\)/)
})
