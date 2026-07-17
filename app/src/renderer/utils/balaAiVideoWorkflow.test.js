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

test('video task list filters by state and submits only checked tasks in bulk', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /const selectedVideoTaskIds = reactive\(new Set\(\)\)/)
  assert.match(workflowSource, /const videoTaskStatusFilter = ref\('all'\)/)
  assert.match(workflowSource, /const videoTaskStatusTabs = computed/)
  assert.match(workflowSource, /const filteredVideoTasks = computed/)
  assert.match(workflowSource, /function toggleVideoTaskSelection/)
  assert.match(workflowSource, /class="aiv-video-task-check"/)
  assert.match(workflowSource, /class="aiv-video-task-status-tabs"/)
  assert.match(workflowSource, /class="aiv-video-task-stage"/)
  assert.match(workflowSource, /@click="runSelectedVideoTasks\('live'\)"/)
  assert.match(workflowSource, /批量提交/)
})

test('find-materials page exposes operational state, aligned stats, and selected-card feedback', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /const materialTaskStage = computed/)
  assert.match(workflowSource, /class="aiv-material-task-state"/)
  assert.match(workflowSource, /class="aiv-material-header-stats"/)
  assert.match(workflowSource, /class="aiv-material-stat"/)
  assert.match(workflowSource, /class="aiv-material-selection-summary"/)
})

test('find-materials page makes running, selected, and active states visually distinct', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /\.aiv-material-task-state\.is-running\s*\{[\s\S]*?color:\s*#60a5fa;/)
  assert.match(workflowSource, /\.aiv-thumb\.selected\s*\{[\s\S]*?box-shadow:[\s\S]*?0 0 0 3px rgba\(255, 107, 43, \.16\)/)
  assert.match(workflowSource, /\.aiv-material-style-tabs button\.active\s*\{[\s\S]*?box-shadow:[\s\S]*?0 6px 16px rgba\(255, 107, 43, \.12\)/)
})

test('find-materials keeps batch stats in the results header and aligns selected-only filtering left', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /class="aiv-panel-head aiv-material-results-head"/)
  assert.match(workflowSource, /class="aiv-material-header-stats"/)
  assert.match(workflowSource, /class="aiv-material-source-actions"/)
  assert.match(workflowSource, /\.aiv-material-source-actions\s*\{[\s\S]*?display:\s*flex;/)
  assert.match(workflowSource, /\.aiv-material-source-switcher > span\s*\{[\s\S]*?margin-left:\s*auto;/)
})

test('find-materials uses a denser thumbnail grid without changing image selection controls', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /\.aiv-material-tab-panel \.aiv-thumb-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fill, minmax\(220px, 1fr\)\);/)
})

test('find-materials uses one polished, compact component system across panels and media', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /\.aiv-material-stage \.aiv-panel\s*\{[\s\S]*?border-radius:\s*12px;[\s\S]*?box-shadow:/)
  assert.match(workflowSource, /\.aiv-material-stage \.aiv-field input,[\s\S]*?\.aiv-material-stage \.aiv-field textarea\s*\{[\s\S]*?transition:\s*border-color/)
  assert.match(workflowSource, /\.aiv-material-stage \.aiv-material-style-tabs button\s*\{[\s\S]*?border-radius:\s*10px;[\s\S]*?transition:/)
  assert.match(workflowSource, /\.aiv-material-stage \.aiv-thumb\s*\{[\s\S]*?border-radius:\s*10px;[\s\S]*?transition:/)
})

test('AI edit uses one compact action-tab row and gives media cards deliberate hover feedback', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /role="tab"/)
  assert.match(workflowSource, /:aria-selected="activeAction === action\.id"/)
  assert.match(workflowSource, /:is="aiActionIcons\[action\.id\]"/)
  assert.match(workflowSource, /const aiActionIcons = \{[\s\S]*?face_swap: IconFaceId,[\s\S]*?background_swap: IconPhoto,[\s\S]*?outfit_swap: IconShirt,[\s\S]*?pose_swap: IconRun,/)
  assert.match(workflowSource, /shortTitle: '换脸'/)
  assert.match(workflowSource, /shortTitle: '换背景'/)
  assert.match(workflowSource, /shortTitle: '换装'/)
  assert.match(workflowSource, /shortTitle: '换姿势'/)
  assert.match(workflowSource, /class="aiv-action-grid-hint"/)
  assert.match(workflowSource, /requirement: '选择模特'/)
  assert.match(workflowSource, /\.aiv-edit-workbench \.aiv-action-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);/)
  assert.match(workflowSource, /\.aiv-edit-workbench \.aiv-action-option\.active\s*\{[\s\S]*?box-shadow:/)
  assert.match(workflowSource, /\.aiv-edit-workbench \.aiv-media-card:hover,[\s\S]*?\{[\s\S]*?transform:\s*translateY\(-2px\);/)
  assert.match(workflowSource, /\.aiv-edit-workbench \.aiv-media-card:hover \.aiv-media-select img,[\s\S]*?\{[\s\S]*?transform:\s*scale\(1\.025\);/)
})

test('AI edit pickers keep filters visible and give model and material selections matching feedback', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /aiv-local-material-modal-panel aiv-picker-modal-panel/)
  assert.match(workflowSource, /aiv-model-library-modal-panel aiv-picker-modal-panel/)
  assert.match(workflowSource, /class="aiv-modal-filter aiv-model-filter-rail"/)
  assert.match(workflowSource, /class="aiv-picker-filter-group"/)
  assert.match(workflowSource, /class="aiv-picker-selection-summary"/)
  assert.match(workflowSource, /const modelLibraryErrorMessage = computed/)
  assert.match(workflowSource, /@click="loadModelLibrary"/)
  assert.match(workflowSource, /\.aiv-picker-modal-panel\s*\{[\s\S]*?border-radius:\s*12px;/)
  assert.match(workflowSource, /\.aiv-model-filter-rail\s*\{[\s\S]*?border-right:/)
  assert.match(workflowSource, /\.aiv-model-card:hover,[\s\S]*?transform:\s*translateY\(-2px\);/)
  assert.match(workflowSource, /\.aiv-local-material-card:hover,[\s\S]*?transform:\s*translateY\(-2px\);/)
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

test('workspace restore never reopens the passive video-results step by default', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /function workspaceSnapshotStep\(\)/)
  assert.match(workflowSource, /activeStep\.value === 'results' \? 'templates' : activeStep\.value/)
  assert.match(workflowSource, /function restoreWorkspaceActiveStep\(snapshot = \{\}\)/)
  assert.match(workflowSource, /const restoredStep = String\(snapshot\.activeStep \|\| ''\) === 'results' \? 'templates' : String\(snapshot\.activeStep \|\| ''\)/)
  assert.match(workflowSource, /restoreWorkspaceActiveStep\(snapshot\)/)
})

test('workflow steps use compact, interactive tabs instead of progress-like tiles', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /<nav class="aiv-stepper" role="tablist"/)
  assert.match(workflowSource, /role="tab"/)
  assert.match(workflowSource, /:aria-selected="activeStep === step\.id"/)
  assert.match(workflowSource, /\.aiv-stepper\s*\{[\s\S]*?padding:\s*8px 22px;/)
  assert.match(workflowSource, /\.aiv-step\s*\{[\s\S]*?height:\s*46px;[\s\S]*?cursor:\s*pointer;/)
  assert.match(workflowSource, /\.aiv-step:hover:not\(\.active\),[\s\S]*?transform:\s*translateY\(-1px\);/)
})

test('AI edit keeps media cards clean until hover and exposes face selection in large preview', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /@click="openLocalMaterialLibrary\('garment'\)"/)
  assert.match(workflowSource, /class="aiv-media-hover-tools"/)
  assert.match(workflowSource, /class="aiv-version-generation-status"/)
  assert.match(workflowSource, /生成中 <strong>\{\{ version\.progress \|\| 0 \}\}%<\/strong>/)
  assert.match(workflowSource, /\.aiv-version-card\s*\{[\s\S]*?aspect-ratio:\s*3\s*\/\s*4;/)
  assert.match(workflowSource, /\.aiv-media-card:hover \.aiv-media-hover-tools/)
  assert.match(workflowSource, /class="aiv-selected-indicator">已选/)
  assert.match(workflowSource, /\.aiv-version-card \.aiv-selected-indicator\s*\{[\s\S]*?color:\s*#fff !important;/)
  assert.match(workflowSource, /v-if="previewEditAction === 'face_swap'" class="aiv-preview-model-picker"/)
  assert.match(workflowSource, /v-if="activeAction === 'face_swap'" class="aiv-selected-model-preview"/)
  assert.match(workflowSource, /\.aiv-selected-model-thumb\s*\{[\s\S]*?max-height:\s*56px;/)
  assert.match(workflowSource, /configuredAiImageModels/)
  assert.match(workflowSource, /shortDisplayName\(version\.label\)/)
})

test('AI edit separates the source-original lane from a single-row horizontally scrollable AI result lane', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /class="aiv-edit-origin-zone"/)
  assert.match(workflowSource, /class="aiv-edit-ai-zone"/)
  assert.match(workflowSource, /class="aiv-edit-lane-head"/)
  assert.match(workflowSource, /class="aiv-edit-lane-connector"/)
  assert.match(workflowSource, /原图区/)
  assert.match(workflowSource, /AI 改图区/)
  assert.match(workflowSource, /左右滑动查看/)
  assert.match(workflowSource, /\.aiv-edit-source-row\s*\{[\s\S]*?grid-template-columns:\s*148px 24px minmax\(0, 1fr\);/)
  assert.match(workflowSource, /\.aiv-version-rail\s*\{[\s\S]*?display:\s*flex;[\s\S]*?overflow-x:\s*auto;/)
  assert.match(workflowSource, /\.aiv-version-rail > \.aiv-version-card\s*\{[\s\S]*?flex:\s*0 0 144px;/)
})

test('AI edit workspace uses a deliberate chevron control for expanding and collapsing style lanes', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /IconChevronDown/)
  assert.match(workflowSource, /class="aiv-workspace-collapse"/)
  assert.match(workflowSource, /class="aiv-workspace-collapse-icon"/)
  assert.match(workflowSource, /收起图片/)
  assert.match(workflowSource, /展开图片/)
  assert.match(workflowSource, /\.aiv-workspace-collapse\s*\{[\s\S]*?transition:/)
  assert.match(workflowSource, /\.aiv-workspace-collapse\.expanded .aiv-workspace-collapse-icon\s*\{[\s\S]*?transform:\s*rotate\(180deg\);/)
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
  assert.match(workflowSource, /class="aiv-modal-panel wide aiv-local-material-modal-panel(?: [^"]+)?"/)
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

  assert.match(workflowSource, /\.aiv-preview-modal-panel\s*\{[\s\S]*?height:\s*min\(920px, calc\(100vh - 48px\)\);/)
  assert.match(workflowSource, /\.aiv-image-editor-stage\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0, 1fr\) auto;[\s\S]*?overflow:\s*hidden;/)
  assert.match(workflowSource, /\.aiv-big-preview\s*\{[\s\S]*?height:\s*100%;[\s\S]*?overflow:\s*hidden;/)
  assert.match(workflowSource, /\.aiv-big-preview-frame\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*14px 18px;/)
  assert.match(workflowSource, /\.aiv-big-preview-image,[\s\S]*?max-height:\s*100%;[\s\S]*?object-fit:\s*contain;/)
  assert.match(workflowSource, /class="aiv-preview-version-count"/)
  assert.match(workflowSource, /class="aiv-preview-history-list"/)
  assert.match(workflowSource, /class="aiv-image-editor-tools-foot"/)
  assert.match(workflowSource, /输出将作为当前图片的新版本加入历史/)
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
  assert.match(workflowSource, /\.aiv-version-rail\s*\{[\s\S]*?display:\s*flex;[\s\S]*?overflow-x:\s*auto;/)
  assert.match(workflowSource, /class="aiv-ai-preview-zoom"/)
  assert.match(workflowSource, /const reviewAssetFeedback = reactive\(\{\}\)/)
  assert.match(workflowSource, /function flashReviewAssetFeedback/)
  assert.match(workflowSource, /aiv-review-card-feedback/)
  assert.match(workflowSource, /\.aiv-ai-card:hover,[\s\S]*?transform:\s*translateY\(-2px\);/)
  assert.match(workflowSource, /@keyframes aiv-review-card-feedback/)
})

test('review supports selecting the current filtered assets for targeted batch approval or rejection', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /const selectedReviewAssetIds = reactive\(new Set\(\)\)/)
  assert.match(workflowSource, /const selectedVisibleReviewAssets = computed/)
  assert.match(workflowSource, /function toggleReviewAssetSelection/)
  assert.match(workflowSource, /function toggleAllVisibleReviewAssetSelections/)
  assert.match(workflowSource, /function requestSelectedReviewStatus/)
  assert.match(workflowSource, /class="aiv-review-selection-bar"/)
  assert.match(workflowSource, /aiv-review-card-select/)
  assert.match(workflowSource, /全选当前筛选项/)
  assert.match(workflowSource, /批量通过/)
  assert.match(workflowSource, /批量舍弃/)
  assert.match(workflowSource, /\.aiv-ai-card\.selected\s*\{[\s\S]*?border-color:\s*rgba\(255, 107, 43, .62\);/)
})

test('review selection uses a checkmark in the card action footer and confirmation actions stay grouped', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /IconCheck/)
  assert.match(workflowSource, /class="aiv-ai-actions">[\s\S]*?aiv-review-card-select/)
  assert.match(workflowSource, /aiv-review-card-select-icon/)
  assert.match(workflowSource, /\.aiv-ai-actions \.aiv-review-card-select\s*\{[\s\S]*?margin-left:\s*auto;/)
  assert.match(workflowSource, /\.aiv-review-card-select\.selected \.aiv-review-card-select-icon\s*\{[\s\S]*?opacity:\s*1;/)
  assert.match(workflowSource, /<footer class="aiv-modal-foot">[\s\S]*?请确认影响范围后继续[\s\S]*?<div class="aiv-modal-foot-actions">[\s\S]*?cancelReviewBulkAction[\s\S]*?confirmReviewBulkAction/)
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
