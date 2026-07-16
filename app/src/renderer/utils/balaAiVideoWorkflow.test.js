import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

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
    label: '向左收起找图',
    ariaLabel: '向左收起找图面板',
    direction: 'left',
  })
  assert.deepEqual(balaMaterialPanelControl(false), {
    label: '展开找图',
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

  assert.match(workflowSource, /class="aiv-video-asset-card-actions"/)
  assert.match(workflowSource, /class="aiv-video-asset-select"/)
  assert.match(workflowSource, /class="aiv-video-asset-zoom"/)
  assert.doesNotMatch(
    workflowSource,
    /<article[\s\S]*?class="aiv-video-asset-card"[\s\S]*?role="button"[\s\S]*?class="aiv-video-asset-zoom"[\s\S]*?<\/article>/,
  )
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

test('AI video local reference selectors reuse the styled action chips', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /\['aiv-action-chip', \{ active: activeLocalReferenceKind === 'garment' \}\]/)
  assert.match(workflowSource, /\['aiv-action-chip', \{ active: activeLocalReferenceKind === 'outfit' \}\]/)
  assert.match(workflowSource, /\['aiv-action-chip', \{ active: activeLocalReferenceKind === 'variant' \}\]/)
})

test('review image preview keeps its annotation canvas transparent and inactive until a tool is selected', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /const previewAnnotationTool = ref\(''\)/)
  assert.match(workflowSource, /\.aiv-image-annotation-layer\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?pointer-events:\s*none;/)
  assert.match(workflowSource, /\.aiv-image-annotation-layer :deep\(\.tl-container\)\s*\{[\s\S]*?--tl-color-background:\s*transparent;/)
  assert.match(workflowSource, /\.aiv-image-annotation-layer :deep\(\.tl-background\),[\s\S]*?background:\s*transparent !important;/)
})

test('video task cards use a compact asset-and-details layout and expose editing', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /class="aiv-video-task-layout"/)
  assert.match(workflowSource, /task\.assets\.slice\(0, 3\)/)
  assert.match(workflowSource, /编辑视频任务/)
  assert.match(workflowSource, /openVideoTaskDialog\('', task, 'edit'\)/)
  assert.match(workflowSource, /const editingVideoTaskId = ref\(''\)/)
  assert.match(workflowSource, /\.aiv-video-task-list\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit, minmax\(360px, 1fr\)\);/)
  assert.match(workflowSource, /\.aiv-video-task-layout\s*\{[\s\S]*?grid-template-columns:\s*116px minmax\(0, 1fr\);/)
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

  assert.match(workflowSource, /v-if="activeAction === 'outfit_swap'" class="aiv-local-material-library"/)
  assert.match(workflowSource, /class="aiv-media-hover-tools"/)
  assert.match(workflowSource, /\.aiv-media-card:hover \.aiv-media-hover-tools/)
  assert.match(workflowSource, /class="aiv-selected-indicator">已选/)
  assert.match(workflowSource, /v-if="previewEditAction === 'face_swap'" class="aiv-preview-model-picker"/)
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
  assert.match(workflowSource, /class="aiv-video-task-selection"/)
  assert.match(workflowSource, /role="tablist" aria-label="视频任务素材状态"/)
  assert.match(workflowSource, /v-for="asset in filteredVideoTaskAssets"/)
  assert.match(workflowSource, /@keydown\.left\.prevent="moveVideoTaskStyleTab\('previous'\)"/)
  assert.match(workflowSource, /@keydown\.right\.prevent="moveVideoTaskAssetTab\('next'\)"/)
  assert.match(workflowSource, /\.aiv-modal-body\.video-task\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 360px;/)
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
