import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('AI video workflow only applies inert as a real boolean while a modal is open', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const templateSource = source.split('<script setup>')[0]

  assert.match(templateSource, /class="aiv-stage"[\s\S]*:inert="hasOpenModal \|\| undefined"/)
  assert.doesNotMatch(templateSource, /:inert="hasOpenModal \? '' : null"/)
})

test('AI video settings keep provider advanced fields folded and expose dedicated OSS upload config', () => {
  const settings = fs.readFileSync('app/src/renderer/views/SettingsPage.vue', 'utf8')

  assert.match(settings, /<details class="settings-advanced-panel">[\s\S]*百炼业务空间 ID[\s\S]*百炼区域[\s\S]*<\/details>/)
  assert.match(settings, /OSS 上传配置/)
  assert.match(settings, /ai\.video\.bailian_upload_api_key/)
  assert.match(settings, /ai\.video\.bailian_uploads_url/)
})

test('AI video workflow review local upload menu opens the desktop image picker', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')

  assert.match(source, /<button type="button"[^>]*@click="uploadLocalReviewImage\(style\.styleCode\)"[^>]*>\s*上传本地图\s*<\/button>/)
  assert.match(source, /async function uploadLocalReviewImage\(styleCode = ''\)[\s\S]*window\.cs\.browseFile\(\{[\s\S]*images: true,[\s\S]*multi: true/)
})

test('AI video workflow keeps local assets enabled for Bailian Kling and PixVerse models', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const providerUsesLocalImages = source.match(/function providerUsesLocalImages[\s\S]*?\n}/)?.[0] || ''
  const klingDefaults = source.match(/if \(isKlingVideoProvider\(provider\)\) \{[\s\S]*?\n  \}/)?.[0] || ''
  const pixverseDefaults = source.match(/if \(isPixVerseVideoProvider\(provider\)\) \{[\s\S]*?\n  \}/)?.[0] || ''

  assert.match(providerUsesLocalImages, /isKlingVideoProvider\(provider\)/)
  assert.match(providerUsesLocalImages, /isPixVerseVideoProvider\(provider\)/)
  assert.doesNotMatch(klingDefaults, /videoTaskDraft\.assetIds\s*=\s*\[\]/)
  assert.doesNotMatch(pixverseDefaults, /videoTaskDraft\.assetIds\s*=\s*\[\]/)
  assert.match(source, /pixverse_video_path:\s*gen\.videoPath \|\| task\.pixverseVideoPath \|\| ''/)
  assert.match(source, /video_paths:\s*videoTaskVideoPaths\(task\)/)
})

test('AI video workflow review retry sends only durable review assets to remote regenerate', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
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
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const start = source.indexOf('const selectedEditSourceCount = computed')
  const end = source.indexOf('const selectedEditVersionCount = computed', start)
  const countSource = source.slice(start, end)

  assert.match(countSource, /source\.editSelected\s*\?\s*1\s*:\s*0/)
  assert.match(source, /function continueEditingSource\(source = \{\}\)[\s\S]*source\.editSelected = true/)
})

test('AI video workflow local review-only edit inputs do not sync fake asset ids to material selection', () => {
  const source = fs.readFileSync('app/src/renderer/views/AiVideoWorkflow.vue', 'utf8')
  const start = source.indexOf('function selectedMaterialAssetIds')
  const end = source.indexOf('function selectedSourceAssetsForAi', start)
  const selectionSource = source.slice(start, end)

  assert.match(source, /localReviewOnly:\s*true/)
  assert.match(selectionSource, /!asset\.localReviewOnly/)
})
