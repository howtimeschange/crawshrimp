'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')
const preload = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8')

function section(source, start, end) {
  const from = source.indexOf(start)
  assert.notEqual(from, -1, `missing section start: ${start}`)
  const to = end ? source.indexOf(end, from + start.length) : source.length
  assert.notEqual(to, -1, `missing section end: ${end}`)
  return source.slice(from, to)
}

test('desktop generates one AI video capability secret and injects it into every backend spawn', () => {
  assert.match(main, /const AI_VIDEO_CAPABILITY_SECRET = crypto\.randomBytes\(32\)\.toString\('hex'\)/)
  const spawnSource = section(main, 'function spawnBackendProcess()', 'function stopBackendProcess')
  assert.match(spawnSource, /CRAWSHRIMP_AI_VIDEO_CAPABILITY_SECRET:\s*AI_VIDEO_CAPABILITY_SECRET/)
})

test('preload exposes dedicated token-only AI video file IPC and no renderer root authorization', () => {
  const contracts = [
    ['selectAiVideoImages', 'ai-video:select-files'],
    ['selectAiVideoDirectory', 'ai-video:select-directory'],
    ['getSavedAiVideoDirectory', 'ai-video:get-saved-directory'],
    ['listAiVideoDirectory', 'ai-video:list-directory'],
    ['openAiVideoDirectory', 'ai-video:open-directory'],
    ['openAiVideoFile', 'ai-video:open-file'],
    ['getAiVideoMediaUrl', 'ai-video:get-media-url'],
    ['readAiVideoImagePreview', 'ai-video:read-image-preview'],
    ['readAiVideoImageThumbnail', 'ai-video:read-image-thumbnail'],
  ]
  for (const [method, channel] of contracts) {
    assert.match(preload, new RegExp(`${method}:`))
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\('${channel}'`))
    assert.match(main, new RegExp(`secureHandle\\('${channel}'`))
  }
  assert.doesNotMatch(preload, /authorizeLocalMediaRoot:/)
  assert.doesNotMatch(main, /secureHandle\('authorize-local-media-root'/)
})

test('input directory selection is persisted in main storage and restored through a fresh token-only IPC', () => {
  const selectSource = section(main, 'async function selectAiVideoDirectory', 'function listAiVideoDirectory')
  assert.match(selectSource, /scope === 'input'/)
  assert.match(selectSource, /rememberAiVideoInputDirectory/)

  const restoreSource = section(main, 'function getSavedAiVideoDirectory', 'function listAiVideoDirectory')
  assert.match(restoreSource, /readSavedAiVideoInputDirectory/)
  assert.match(main, /path\.join\(getCrawshrimpDataDir\(\), 'ai-video-input-directory\.json'\)/)
})

test('local media protocol resolves a signed file capability and never trusts a path from its URL', () => {
  const urlSource = section(main, 'function localMediaUrl(', 'function parseLocalMediaPayload')
  assert.match(urlSource, /fileToken/)
  assert.doesNotMatch(urlSource, /filePath|JSON\.stringify/)

  const handlerSource = section(main, 'async function handleLocalMediaRequest', 'function normalizePathForIdentity')
  assert.match(handlerSource, /getAiVideoCapabilityMediaFile/)
  assert.doesNotMatch(handlerSource, /payload\.filePath|getAuthorizedLocalMediaFile/)
})

test('AI video files are opened only after resolving a media capability in main', () => {
  const openSource = section(main, 'async function openAiVideoFile', 'function aiVideoMediaForRenderer')
  assert.match(openSource, /getAiVideoCapabilityMediaFile\(fileToken, \['media'\]\)/)
  assert.match(openSource, /await shell\.openPath\(media\.path\)/)
  assert.match(openSource, /if \(error\) throw new Error\(error\)/)

  const handlerSource = section(main, "secureHandle('ai-video:open-file'", "secureHandle('ai-video:get-media-url'")
  assert.match(handlerSource, /openAiVideoFile\(fileToken\)/)
})

test('legacy raw-path media stays bounded, while generic image previews honor image-only limits without a folder allowlist', () => {
  assert.doesNotMatch(main, /^\s*path\.join\(os\.homedir\(\), 'Downloads'\),?\s*$/m)

  const legacyMedia = section(main, "secureHandle('get-local-media-url'", "secureHandle('read-bala-workspace-manifest'")
  assert.match(legacyMedia, /getAuthorizedLocalMediaFile/)
  assert.match(legacyMedia, /signAiVideoCapability/)

  const legacyPreview = section(main, "secureHandle('read-local-image-preview'", "secureHandle('read-local-image-thumbnail'")
  assert.match(legacyPreview, /readLocalImageDataUrl\(filePath\)/)
  assert.doesNotMatch(legacyPreview, /getAuthorizedLocalMediaFile/)

  const legacyThumbnail = section(main, "secureHandle('read-local-image-thumbnail'", "secureHandle('list-directory-files'")
  assert.match(legacyThumbnail, /readLocalImageThumbnail\(filePath, opts \|\| \{\}\)/)
  assert.doesNotMatch(legacyThumbnail, /getAuthorizedLocalMediaFile/)

  const legacyList = section(main, "secureHandle('list-directory-files'", "secureHandle('render-pdf-preview'")
  assert.match(legacyList, /getAuthorizedLocalMediaDirectory/)
})

test('Bala workspace image preview IPC stays constrained to a selected workspace', () => {
  assert.match(preload, /readBalaWorkspaceImagePreview: \(workspaceRoot, filePath\) => ipcRenderer\.invoke\('read-bala-workspace-image-preview'/)
  assert.match(preload, /readBalaWorkspaceImageThumbnail: \(workspaceRoot, filePath, opts = \{\}\) => ipcRenderer\.invoke\('read-bala-workspace-image-thumbnail'/)

  const previewHandler = section(main, "secureHandle('read-bala-workspace-image-preview'", "secureHandle('read-bala-workspace-image-thumbnail'")
  const thumbnailHandler = section(main, "secureHandle('read-bala-workspace-image-thumbnail'", "secureHandle('get-local-media-url'")
  assert.match(previewHandler, /getAuthorizedBalaWorkspaceImage/)
  assert.match(thumbnailHandler, /getAuthorizedBalaWorkspaceImage/)
})

test('AI video config IPC removes backend paths and returns the fixed output capability', () => {
  const configHandler = section(main, "secureHandle('ai-video:get-config'", "secureHandle('ai-video:validate'")
  assert.match(configHandler, /aiVideoConfigForRenderer/)
  assert.match(main, /sanitizeAiVideoConfigResponse/)
  assert.match(main, /defaultOutputDirToken/)
  assert.match(main, /defaultOutputDirName/)
})
