import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as balaWorkflow from './balaAiVideoWorkflow.js'

import {
  balaMaterialPanelControl,
  normalizeBalaVideoResultRows,
  resolveBalaAssetPreviewSource,
  resolveBalaVideoPlaybackSource,
} from './balaAiVideoWorkflow.js'

test('local AI-video images render only through the bridged preview cache', () => {
  const asset = {
    path: '/Users/xingyicheng/Downloads/巴拉 AI 视频/208326102205/01_模拍原图/1-AL.jpg',
  }
  const localPreviews = {
    [asset.path]: 'data:image/jpeg;base64,local-preview',
  }

  assert.equal(
    resolveBalaAssetPreviewSource(asset, { localPreviews }),
    'data:image/jpeg;base64,local-preview',
  )
  assert.equal(resolveBalaAssetPreviewSource(asset), '')
})

test('remote AI-video image URLs take precedence over local cached previews', () => {
  const asset = {
    imageUrl: '/api/assets/preview.png',
    path: '/Users/xingyicheng/Downloads/preview.png',
  }

  assert.equal(
    resolveBalaAssetPreviewSource(asset, {
      localPreviews: { [asset.path]: 'data:image/png;base64,local-preview' },
      resolveRemote: value => `http://127.0.0.1:18080${value}`,
    }),
    'http://127.0.0.1:18080/api/assets/preview.png',
  )
})

test('material panel control describes a horizontal collapse and keeps expansion reachable', () => {
  assert.deepEqual(balaMaterialPanelControl(true), {
    label: '收起',
    ariaLabel: '向左收起找图面板',
    direction: 'left',
  })
  assert.deepEqual(balaMaterialPanelControl(false), {
    label: '展开',
    ariaLabel: '向右展开找图面板',
    direction: 'right',
  })
})

test('material panel keeps its horizontal arrow rules free of vertical-collapse overrides', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /\.aiv-collapse-chevron\[data-direction="left"\]\s*\{/)
  assert.match(workflowSource, /\.aiv-collapse-chevron\[data-direction="right"\]\s*\{/)
  assert.doesNotMatch(workflowSource, /\.aiv-collapse-head\s+\.aiv-collapse-chevron\s*\{/)
  assert.doesNotMatch(workflowSource, /\.aiv-collapse-head\[aria-expanded="true"\]\s+\.aiv-collapse-chevron\s*\{/)
})

test('video results resolve downloadable local files and remote playback URLs', () => {
  assert.equal(
    resolveBalaVideoPlaybackSource({ path: '/Users/xingyicheng/Downloads/result clip.mp4' }),
    'file:///Users/xingyicheng/Downloads/result%20clip.mp4',
  )
  assert.equal(
    resolveBalaVideoPlaybackSource({ videoUrl: 'https://cdn.example.com/result.mp4', path: '/ignored.mp4' }),
    'https://cdn.example.com/result.mp4',
  )
  assert.equal(
    resolveBalaVideoPlaybackSource({ path: '/Users/xingyicheng/Downloads/巴拉AI视频成片' }),
    '',
  )
})

test('local video results use the authorized streaming-media bridge instead of Base64 object URLs', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /getBalaWorkspaceVideoMedia/)
  assert.match(workflowSource, /media_url|mediaUrl/)
  assert.doesNotMatch(workflowSource, /fetch\(dataUrl\)\.blob\(\)/)
})

test('video-task asset selection keeps preview and selection as sibling native buttons', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /class="aiv-vtask-card"/)
  assert.match(workflowSource, /class="aiv-vtask-card-hit"/)
  assert.match(workflowSource, /class="aiv-vtask-card-zoom"/)
  assert.match(workflowSource, /class="aiv-vtask-card-img"/)
  // Selection hit and zoom are separate buttons (zoom does not nest inside hit as role=button article)
  assert.match(workflowSource, /@click\.stop="openImagePreview\(asset, videoTaskDraft\.styleCode\)"/)
})

test('video result normalization keeps local files and remote playback URLs in separate fields', () => {
  const [localResult, remoteResult] = normalizeBalaVideoResultRows([
    {
      状态: '已下载',
      本地视频文件: '/Users/xingyicheng/Downloads/local-result.mp4',
    },
    {
      status: 'completed',
      video_url: 'https://cdn.example.com/remote-result.mp4',
    },
  ], { id: 'task-1', styleCode: '208326102205' })

  assert.equal(localResult.path, '/Users/xingyicheng/Downloads/local-result.mp4')
  assert.equal(localResult.videoUrl, '')
  assert.equal(remoteResult.path, '')
  assert.equal(remoteResult.videoUrl, 'https://cdn.example.com/remote-result.mp4')
  assert.equal(remoteResult.status, '已完成')
})

test('AI video local material library uses category chips for model and detail photos', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /\['aiv-action-chip', \{ active: localMaterialLibraryCategory === 'all' \}\]/)
  assert.match(workflowSource, /\['aiv-action-chip', \{ active: localMaterialLibraryCategory === 'model' \}\]/)
  assert.match(workflowSource, /\['aiv-action-chip', \{ active: localMaterialLibraryCategory === 'detail' \}\]/)
})

test('review image preview keeps its annotation canvas transparent and inactive until a tool is selected', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /const previewAnnotationTool = ref\(''\)/)
  assert.match(workflowSource, /\.aiv-image-annotation-layer\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?pointer-events:\s*none;/)
  assert.match(workflowSource, /\.aiv-image-annotation-layer :deep\(\.tl-container\)\s*\{[\s\S]*?--tl-color-background:\s*transparent;/)
  assert.match(workflowSource, /\.aiv-image-annotation-layer :deep\(\.tl-background\),[\s\S]*?background:\s*transparent !important;/)
})

test('video task cards use a compact horizontal row layout and expose editing', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /class="aiv-video-task-row"/)
  assert.match(workflowSource, /task\.assets\.slice\(0, 4\)/)
  assert.match(workflowSource, /openVideoTaskDialog\('', task, 'edit'\)/)
  assert.match(workflowSource, /const editingVideoTaskId = ref\(''\)/)
  assert.match(workflowSource, /\.aiv-video-task-list\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/)
  assert.match(workflowSource, /\.aiv-video-task-row\s*\{[\s\S]*?grid-template-columns:\s*auto minmax\(0, 1fr\) auto;/)
})

test('find-materials page exposes operational state, aligned stats, and selected-card feedback', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /const materialTaskStage = computed/)
  assert.match(workflowSource, /class="aiv-material-task-state"/)
  assert.match(workflowSource, /class="aiv-material-header-stats"/)
  assert.match(workflowSource, /class="aiv-material-stat"/)
  assert.match(workflowSource, /class="aiv-material-selection-summary"/)
})

test('AI video keeps local references, image tasks, and workspace snapshots isolated', async () => {
  const [workflowSource, workbenchSource] = await Promise.all([
    readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8'),
    readFile(new URL('../views/AiImageWorkbench.vue', import.meta.url), 'utf8'),
  ])

  assert.match(workflowSource, /BALA_AI_VIDEO_WORKSPACE_STATE_STORAGE_KEY = 'crawshrimp\.bala-ai-video\.workspace-state\.v2'/)
  assert.match(workflowSource, /function restoreWorkspaceSnapshot/)
  assert.match(workflowSource, /workspace_dir: workspaceDir\.value/)
  assert.match(workflowSource, /surface: 'ai-video-workflow'/)
  assert.match(workbenchSource, /import \{ isAiVideoWorkflowJob, selectRestorableAiImageJob \} from '\.\.\/utils\/aiImageTaskIsolation\.js'/)
  assert.match(workbenchSource, /if \(isAiVideoWorkflowJob\(detail\)\)/)
  assert.match(workbenchSource, /records\.filter\(job => !isAiVideoWorkflowJob\(job\)\)/)
})

test('AI edit keeps media cards clean until hover and exposes face selection in large preview', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /@click="openLocalMaterialLibrary\('garment'\)"/)
  assert.match(workflowSource, /class="aiv-media-hover-tools"/)
  assert.match(workflowSource, /\.aiv-media-card:hover \.aiv-media-hover-tools/)
  assert.match(workflowSource, /class="aiv-selected-indicator">已选/)
  assert.match(workflowSource, /v-if="previewEditAction === 'face_swap'" class="aiv-preview-model-picker"/)
  assert.match(workflowSource, /v-if="activeAction === 'face_swap'" class="aiv-selected-model-preview"/)
  assert.match(workflowSource, /\.aiv-selected-model-thumb\s*\{[\s\S]*?max-height:\s*56px;/)
  assert.match(workflowSource, /configuredAiImageModels/)
  assert.match(workflowSource, /shortDisplayName\(version\.label\)/)
})

test('AI edit version previews fall back after a generated preview is broken', () => {
  assert.equal(typeof balaWorkflow.resolveBalaVersionPreviewSource, 'function')
  assert.equal(
    balaWorkflow.resolveBalaVersionPreviewSource(
      { id: 'generated' },
      { id: 'source' },
      {
        resolvePreview: asset => `${asset.id}.jpg`,
        brokenSources: { 'generated.jpg': true },
      },
    ),
    'source.jpg',
  )
})

test('AI edit local materials open as a shared picker for each outfit reference role', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /const localMaterialLibraryOpen = ref\(false\)/)
  assert.match(workflowSource, /function openLocalMaterialLibrary\(kind = 'garment'\)/)
  assert.match(workflowSource, /@click="openLocalMaterialLibrary\('outfit'\)"/)
  assert.match(workflowSource, /@click="openLocalMaterialLibrary\('variant'\)"/)
  assert.match(workflowSource, /@click="uploadLocalMaterialFromDisk"/)
  assert.match(workflowSource, /localMaterialLibraryCategory === 'model'/)
  assert.match(workflowSource, /localMaterialLibraryCategory === 'detail'/)
  assert.match(workflowSource, /localMaterialLibraryStyleFilter === 'all'/)
  assert.match(workflowSource, /v-model="localMaterialLibraryStyleQuery"/)
  assert.match(workflowSource, /localMaterialLibraryStyleOptions/)
  assert.match(workflowSource, /v-if="localMaterialLibraryOpen" class="aiv-modal aiv-modal-stacked"/)
  assert.match(workflowSource, /class="aiv-modal-panel wide aiv-local-material-modal-panel"/)
  assert.match(workflowSource, /class="\['aiv-local-material-card'/)
  assert.match(workflowSource, /\.aiv-local-material-card-preview\s*\{[\s\S]*?padding-top:\s*133\.333%;/)
  assert.match(workflowSource, /\.aiv-local-material-card\s*\{[\s\S]*?flex:\s*0 0 148px;/)
  assert.match(workflowSource, /v-if="previewEditAction === 'outfit_swap'" class="aiv-preview-outfit-pickers"/)
  assert.match(workflowSource, /AI 换装需要至少选择一张服装图/)
  assert.match(workflowSource, /function continueEditingSource/)
  assert.doesNotMatch(workflowSource, /aria-label="素材用途"/)
  assert.doesNotMatch(workflowSource, /<details[^>]*class="aiv-local-material-library"/)
})

test('video task dialog exposes model and detail image kind filters', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /const videoTaskKindFilter = ref\('all'\)/)
  assert.match(workflowSource, /const videoTaskKindTabs = computed/)
  assert.match(workflowSource, /function videoTaskAssetSourceType/)
  assert.match(workflowSource, /function videoTaskAssetIsAi/)
  assert.match(workflowSource, /class="aiv-video-task-kind-tabs"/)
  assert.match(workflowSource, /label: '模特图'/)
  assert.match(workflowSource, /label: '细节图'/)
  assert.match(workflowSource, /label: 'AI 图'/)
  // AI is overlay; model/detail come from folder source
  assert.match(workflowSource, /videoTaskAssetIsAi\(asset\)/)
  assert.match(workflowSource, /videoTaskAssetSourceType\(asset\) === 'detail'/)
})

test('AI edit hover tools do not steal card selection clicks', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')
  const hoverRule = workflowSource.match(/\.aiv-media-card:hover \.aiv-media-hover-tools,[^{]+\{([^}]*)\}/)?.[1] || ''

  assert.doesNotMatch(workflowSource, /\.aiv-version-card\s*>\s*:not\(\.aiv-version-preview\)/)
  assert.match(workflowSource, /\.aiv-media-hover-tools\s*\{[\s\S]*?pointer-events:\s*none;/)
  assert.match(workflowSource, /\.aiv-media-hover-tools button\s*\{[\s\S]*?pointer-events:\s*auto;/)
  assert.doesNotMatch(hoverRule, /pointer-events:\s*auto;/)
})

test('large image editor uses a bounded viewport layout with a contained image and history rail', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /\.aiv-preview-modal-panel\s*\{[\s\S]*?height:\s*min\(900px, calc\(100vh - 48px\)\);/)
  assert.match(workflowSource, /\.aiv-image-editor-stage\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0, 1fr\) auto;[\s\S]*?overflow:\s*hidden;/)
  assert.match(workflowSource, /\.aiv-big-preview\s*\{[\s\S]*?height:\s*100%;[\s\S]*?overflow:\s*hidden;/)
  assert.match(workflowSource, /\.aiv-big-preview-frame\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*16px;/)
  assert.match(workflowSource, /\.aiv-big-preview-image,[\s\S]*?max-height:\s*100%;[\s\S]*?object-fit:\s*contain;/)
  assert.match(workflowSource, /TldrawAnnotationLayer[\s\S]*?v-if="activePreviewHistoryItem\?\.src && !brokenPreviews/)
  assert.match(workflowSource, /selectedAiImageModelId/)
  assert.match(workflowSource, /openAiImageModelSettings/)
})

test('model library keeps age and gender filters fixed while only results scroll', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.equal((workflowSource.match(/v-for="age in modelAgeOptions"/g) || []).length, 1)
  assert.match(workflowSource, /class="aiv-modal-body model-library"/)
  assert.match(workflowSource, /class="aiv-model-grid-scroll"/)
  assert.match(workflowSource, /\.aiv-modal-body\.model-library\s*\{[\s\S]*?overflow:\s*hidden;/)
  assert.match(workflowSource, /\.aiv-model-grid-scroll\s*\{[\s\S]*?overflow-y:\s*auto;/)
})

test('video task page packs its toolbar and cards at the top without stretching an empty panel', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /\.aiv-video-task-workbench\s*\{[\s\S]*?grid-template-rows:\s*auto auto;[\s\S]*?align-content:\s*start;/)
  assert.match(workflowSource, /\.aiv-video-task-workbench\s*>\s*\.aiv-panel:first-child\s*\{[\s\S]*?align-self:\s*start;/)
})

test('video task creation shows in-dialog requirements and prevents incomplete submission', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /const videoTaskDraftError = ref\(''\)/)
  assert.match(workflowSource, /const videoTaskDraftRequirements = computed/)
  assert.match(workflowSource, /const canCreateVideoTask = computed/)
  assert.match(workflowSource, /role="alert">\{\{ videoTaskDraftError \}\}/)
  assert.match(workflowSource, /:disabled="!canCreateVideoTask" @click="createVideoTaskFromDraft"/)
  assert.match(workflowSource, /请选择视频结果输出目录/)
})

test('video task creation prioritizes reviewed images in a left media area with a right-side control rail', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /const videoTaskAssetFilter = ref\('approved'\)/)
  assert.match(workflowSource, /const videoTaskAssetTabs = computed/)
  assert.match(workflowSource, /const filteredVideoTaskAssets = computed/)
  assert.match(workflowSource, /const displayedVideoTaskAssets = computed/)
  assert.match(workflowSource, /class="aiv-video-task-selection"/)
  assert.match(workflowSource, /role="tablist" aria-label="视频任务素材状态"/)
  assert.match(workflowSource, /v-for="asset in displayedVideoTaskAssets"/)
  assert.match(workflowSource, /class="aiv-vtask-grid"/)
  assert.match(workflowSource, /scheduleVideoTaskThumbs/)
  assert.match(workflowSource, /@keydown\.left\.prevent="moveVideoTaskStyleTab\('previous'\)"/)
  assert.match(workflowSource, /@keydown\.right\.prevent="moveVideoTaskAssetTab\('next'\)"/)
  // Left ops rail + right image content (aligned with AI 生视频)
  assert.match(workflowSource, /\.aiv-modal-body\.video-task\s*\{[\s\S]*?grid-template-columns:\s*minmax\(300px, 360px\) minmax\(0, 1fr\);/)
})

test('video results use discrete task stages and reserve percent bars for reported live progress', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /function videoResultStage\(item = \{\}\)/)
  assert.match(workflowSource, /function videoResultHasLiveProgress\(item = \{\}\)/)
  assert.match(workflowSource, /v-if="videoResultHasLiveProgress\(item\)" class="aiv-progress-bar slim"/)
  assert.match(workflowSource, /canRefreshVideoResult\(item\).*刷新状态/)
  assert.match(workflowSource, /canDownloadVideoResult\(item\).*下载视频/)
  assert.doesNotMatch(workflowSource, /progress: normalized === 'running' \? 60 : 20/)
  assert.doesNotMatch(workflowSource, /progress: .*\? 100 : 70/)
})

test('review bulk actions disclose scope, require confirmation, and offer one-step undo', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /<details v-if="hiddenReviewSourceAssetCount\(style\)" class="aiv-source-assets-more">/)
  assert.match(workflowSource, /const reviewBulkConfirmation = ref\(null\)/)
  assert.match(workflowSource, /function requestReviewBulkAction/)
  assert.match(workflowSource, /async function undoReviewBulkAction/)
  assert.match(workflowSource, /role="alertdialog"[\s\S]*?aiv-review-bulk-title/)
  assert.match(workflowSource, /撤销本次批量操作/)
})

test('review cards use compact density matching AI-edit media cards', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')
  const boardRule = workflowSource.match(/\.aiv-ai-asset-board\s*\{([^}]*)\}/)?.[1] || ''

  assert.match(workflowSource, /class="aiv-ai-status-badge">\{\{ assetStatusLabel\(asset\.status\) \}\}<\/i>/)
  assert.match(workflowSource, /class="aiv-ai-card-copy"/)
  assert.match(boardRule, /grid-template-columns:\s*repeat\(auto-fill, minmax\(132px, 148px\)\);/)
  assert.doesNotMatch(boardRule, /repeat\(4,\s*minmax\(0,\s*1fr\)\)/)
  assert.match(workflowSource, /\.aiv-ai-card \.aiv-ai-preview,[\s\S]*?aspect-ratio:\s*3 \/ 4;/)
  assert.match(workflowSource, /\.aiv-ai-card footer\s*\{[\s\S]*?padding:\s*6px 7px 7px;/)
  assert.match(workflowSource, /\.aiv-version-rail\s*\{[\s\S]*?minmax\(112px, 1fr\)/)
})

test('workflow preserves selected-material filtering, readable tokens, focus, and reduced-motion support', async () => {
  const [workflowSource, appSource] = await Promise.all([
    readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8'),
    readFile(new URL('../App.vue', import.meta.url), 'utf8'),
  ])

  assert.match(workflowSource, /const materialShowSelectedOnly = ref\(false\)/)
  assert.match(workflowSource, /只看已选素材/)
  assert.match(workflowSource, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(workflowSource, /\.aiv-workbench button:focus-visible/)
  assert.match(appSource, /--on-orange: #17131A/)
  assert.match(appSource, /--text3: #8e8ca4/)
})
