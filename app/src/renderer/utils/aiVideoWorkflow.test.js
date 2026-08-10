import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const viewsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../views')

function readView(name) {
  return fs.readFileSync(path.join(viewsDir, name), 'utf8')
}

test('AI video workflow only applies inert as a real boolean while a modal is open', () => {
  const source = readView('AiVideoWorkflow.vue')
  const templateSource = source.split('<script setup>')[0]

  assert.match(templateSource, /class="aiv-stage"[\s\S]*:inert="hasOpenModal \|\| undefined"/)
  assert.doesNotMatch(templateSource, /:inert="hasOpenModal \? '' : null"/)
})

test('AI video workflow clears a missing persisted workspace and asks for a replacement', () => {
  const source = readView('AiVideoWorkflow.vue')
  const recoveryStart = source.indexOf('function clearMissingWorkspacePath')
  const recoveryEnd = source.indexOf('async function flushWorkspaceManifest', recoveryStart)
  const recoverySource = source.slice(recoveryStart, recoveryEnd)

  assert.match(source, /function isMissingWorkspacePathError\(error\)/)
  assert.match(source, /\\bENOENT\\b\|no such file or directory/)
  assert.match(recoverySource, /workspaceDir\.value = ''/)
  assert.match(recoverySource, /persistWorkspaceDir\(''\)/)
  assert.match(recoverySource, /materialWorkspaceRequired\.value = true/)
  assert.match(recoverySource, /上次使用的工作区目录已不存在，请重新选择工作区目录。/)
  assert.match(source, /if \(clearMissingWorkspacePath\(targetWorkspace, error\)\) return false/)
})

test('AI video settings keep provider advanced fields folded and expose dedicated OSS upload config', () => {
  const settings = readView('SettingsPage.vue')

  assert.match(settings, /<details class="settings-advanced-panel">[\s\S]*百炼业务空间 ID[\s\S]*百炼区域[\s\S]*<\/details>/)
  assert.match(settings, /OSS 上传配置/)
  assert.match(settings, /ai\.video\.bailian_upload_api_key/)
  assert.match(settings, /ai\.video\.bailian_uploads_url/)
})

test('AI video workflow review local upload menu opens the desktop image picker', () => {
  const source = readView('AiVideoWorkflow.vue')

  assert.match(source, /<button type="button"[^>]*@click="uploadLocalReviewImage\(style\.styleCode\)"[^>]*>\s*上传本地图\s*<\/button>/)
  assert.match(source, /async function uploadLocalReviewImage\(styleCode = ''\)[\s\S]*window\.cs\.browseFile\(\{[\s\S]*images: true,[\s\S]*multi: true/)
})

test('AI video workflow keeps local assets enabled for Business Manager and supported image-to-video models', () => {
  const source = readView('AiVideoWorkflow.vue')
  const providerUsesLocalImages = source.match(/function providerUsesLocalImages[\s\S]*?\n}/)?.[0] || ''
  const klingDefaults = source.match(/if \(isKlingVideoProvider\(provider\)\) \{[\s\S]*?\n  \}/)?.[0] || ''
  const pixverseDefaults = source.match(/if \(isPixVerseVideoProvider\(provider\)\) \{[\s\S]*?\n  \}/)?.[0] || ''

  assert.match(providerUsesLocalImages, /isKlingVideoProvider\(provider\)/)
  assert.match(providerUsesLocalImages, /isPixVerseVideoProvider\(provider\)/)
  assert.match(providerUsesLocalImages, /provider === 'qn'/)
  assert.doesNotMatch(klingDefaults, /videoTaskDraft\.assetIds\s*=\s*\[\]/)
  assert.doesNotMatch(pixverseDefaults, /videoTaskDraft\.assetIds\s*=\s*\[\]/)
  assert.match(source, /pixverse_video_path:\s*gen\.videoPath \|\| task\.pixverseVideoPath \|\| ''/)
  assert.match(source, /video_paths:\s*videoTaskVideoPaths\(task\)/)
})

test('video task grid prefers the signed material thumbnail before requesting a locally authorized file', () => {
  const source = readView('AiVideoWorkflow.vue')
  const enqueue = source.match(/function enqueueVideoTaskThumb[\s\S]*?\n}/)?.[0] || ''

  assert.match(source, /function videoTaskThumbRemoteSource/)
  assert.match(source, /asset\.thumbnailUrl \|\| asset\.thumbnail_url/)
  assert.match(enqueue, /videoTaskThumbRemoteSource\(asset\)/)
})

test('AI video workflow review retry sends only durable review assets to remote regenerate', () => {
  const source = readView('AiVideoWorkflow.vue')
  const start = source.indexOf('async function requestReviewAssetRetry')
  const end = source.indexOf('function reviewSummaryCounts', start)
  const retrySource = source.slice(start, end)

  assert.match(source, /function canRegenerateRemoteReviewAsset\(/)
  assert.match(source, /function queueLocalReviewAssetForAiEdit\(/)
  assert.match(retrySource, /if \(!canRegenerateRemoteReviewAsset\(asset\)\) \{[\s\S]*queueLocalReviewAssetForAiEdit\(asset\)[\s\S]*return/)
  assert.doesNotMatch(retrySource, /asset\.reviewBoardUrl\s*\|\|\s*reviewBoardUrl\.value/)
  assert.doesNotMatch(retrySource, /asset_id:\s*asset\.remoteAssetId\s*\|\|\s*asset\.id/)
  assert.match(retrySource, /asset_id:\s*remoteAssetId/)
  assert.match(retrySource, /Bala review asset not found/)
})

test('AI video workflow continuing an original image counts it as an AI edit input', () => {
  const source = readView('AiVideoWorkflow.vue')
  const start = source.indexOf('const selectedEditSourceCount = computed')
  const end = source.indexOf('const selectedEditVersionCount = computed', start)
  const countSource = source.slice(start, end)

  assert.match(countSource, /source\.editSelected\s*\?\s*1\s*:\s*0/)
  assert.match(source, /function continueEditingSource\(source = \{\}\)[\s\S]*source\.editSelected = true/)
})

test('AI video workflow refreshes model and provider state when returning from settings', () => {
  const source = readView('AiVideoWorkflow.vue')
  const mountedStart = source.indexOf('onMounted(() => {')
  const mountedEnd = source.indexOf('// 筛选/款号切换后重绑缩略图观察', mountedStart)
  const lifecycleSource = source.slice(mountedStart, mountedEnd)

  assert.match(source, /onActivated/)
  assert.match(source, /async function refreshAiVideoRuntimeState\(\{ includeCatalogs = false \} = \{\}\)/)
  assert.match(lifecycleSource, /refreshAiVideoRuntimeState\(\{ includeCatalogs: true \}\)/)
  assert.match(lifecycleSource, /onActivated\(\(\) => \{[\s\S]*refreshAiVideoRuntimeState\(\)/)
  assert.match(source, /loadAiImageSettings\(\)/)
  assert.match(source, /loadVideoProviderStatus\(\)/)
})

test('AI video workflow inserts visible AI edit loading versions after generation starts', () => {
  const source = readView('AiVideoWorkflow.vue')
  const start = source.indexOf('async function startAiImageGeneration')
  const end = source.indexOf('async function pollAiImageTask', start)
  const generationSource = source.slice(start, end)

  assert.match(source, /function appendAiGeneratingVersions\(selectedSources = selectedSourceAssetsForAi\(\)\)/)
  assert.match(source, /function isAiVersionGenerating\(version = \{\}\)/)
  assert.match(source, /loading: isAiVersionGenerating\(version\)/)
  assert.match(source, /status:\s*'running'/)
  assert.match(source, /pending:\s*true/)
  assert.match(source, /function updateAiGeneratingVersions\(progress = aiTaskState\.progress, placeholderIds = activeAiPlaceholderIds\)/)
  assert.match(source, /function finishAiGeneratingVersions\(status = 'failed', placeholderIds = activeAiPlaceholderIds\)/)
  assert.match(source, /function queueAiGeneratingVersions\(placeholderIds = activeAiPlaceholderIds\)/)
  assert.ok(generationSource.indexOf('appendAiGeneratingVersions(selectedSources)') < generationSource.indexOf('await ensureBalaMaterialBatchAvailable'))
  assert.match(generationSource, /finishAiGeneratingVersions\('failed', placeholderIds\)/)
  assert.match(source, /\.aiv-version-card\.loading \.aiv-media-hover-tools\s*\{[\s\S]*opacity:\s*1;/)
  assert.match(source, /@keyframes aiv-version-loading-sweep/)
})

test('AI video workflow keeps prompts isolated for each AI edit operation', () => {
  const source = readView('AiVideoWorkflow.vue')
  const start = source.indexOf('async function startAiImageGeneration')
  const end = source.indexOf('async function pollAiImageTask', start)
  const generationSource = source.slice(start, end)

  assert.match(source, /const AI_ACTION_PROMPT_DEFAULTS = \{[\s\S]*face_swap:[\s\S]*保留原始背景\/场景[\s\S]*outfit_swap:[\s\S]*保留原人物脸部/)
  assert.match(source, /const aiActionPrompts = reactive\(\{ \.\.\.AI_ACTION_PROMPT_DEFAULTS \}\)/)
  assert.match(source, /const aiPrompt = computed\(\{[\s\S]*get: \(\) => String\(aiActionPrompts\[activeAction\.value\] \|\| ''\),[\s\S]*aiActionPrompts\[activeAction\.value\] = String\(value \|\| ''\)/)
  assert.match(source, /:placeholder="activePromptPlaceholder"/)
  assert.match(source, /prompts: cloneWorkspaceValue\(aiActionPrompts, \{\}\)/)
  assert.match(source, /Object\.assign\(aiActionPrompts, \{ \.\.\.AI_ACTION_PROMPT_DEFAULTS, \.\.\.\(image\.prompts \|\| \{\}\) \}\)/)
  assert.match(generationSource, /const promptExtra = \['background_swap', 'pose_swap'\]\.includes\(activeAction\.value\) \? '' : promptText/)
  assert.match(generationSource, /background_prompt: activeAction\.value === 'background_swap' \? promptText : ''/)
  assert.match(generationSource, /pose_prompt: activeAction\.value === 'pose_swap' \? promptText : ''/)
  assert.match(generationSource, /prompt_extra: promptExtra/)
})

test('AI video workflow local review-only edit inputs do not sync fake asset ids to material selection', () => {
  const source = readView('AiVideoWorkflow.vue')
  const start = source.indexOf('function selectedMaterialAssetIds')
  const end = source.indexOf('function selectedSourceAssetsForAi', start)
  const selectionSource = source.slice(start, end)

  assert.match(source, /localReviewOnly:\s*true/)
  assert.match(selectionSource, /!asset\.localReviewOnly/)
})

test('AI video workflow validates material batch before saving AI edit selection', () => {
  const source = readView('AiVideoWorkflow.vue')
  const start = source.indexOf('async function startAiImageGeneration')
  const end = source.indexOf('async function pollAiImageTask', start)
  const generationSource = source.slice(start, end)

  assert.match(source, /function isStaleBalaMaterialBatchError\(error, ref = null\)/)
  assert.match(source, /function clearStaleBalaMaterialBatch\(ref = null\)/)
  assert.match(source, /async function ensureBalaMaterialBatchAvailable\(ref = null\)/)
  assert.match(source, /await window\.cs\.getBalaMaterialBatch\(ref\.batchId, ref\.token\)/)
  assert.ok(generationSource.indexOf('await ensureBalaMaterialBatchAvailable(ref)') < generationSource.indexOf('await window.cs.saveBalaMaterialSelection'))
  assert.match(generationSource, /staleBalaMaterialBatchMessage\(ref\)/)
})
