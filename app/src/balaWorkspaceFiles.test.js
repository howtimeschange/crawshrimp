'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  authorizeBalaWorkspaceRoot,
  deleteAuthorizedWorkspaceImage,
  getAuthorizedBalaWorkspaceImage,
  getAuthorizedBalaWorkspaceVideo,
  listAuthorizedBalaWorkspaceImages,
  loadAuthorizedBalaWorkspaceRoots,
  readAuthorizedBalaWorkspaceManifest,
  rememberAuthorizedBalaWorkspaceRoot,
  writeAuthorizedBalaWorkspaceManifest,
} = require('./balaWorkspaceFiles')

function withTempTree(run) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'bala-workspace-test-'))
  const workspace = path.join(parent, 'workspace')
  const outside = path.join(parent, 'outside')
  fs.mkdirSync(workspace)
  fs.mkdirSync(outside)
  try {
    return run({ parent, workspace, outside })
  } finally {
    fs.rmSync(parent, { recursive: true, force: true })
  }
}

test('workspace deletion unlinks a regular nested image without a directory grant', () => {
  withTempTree(({ workspace }) => {
    const nested = path.join(workspace, 'AI生成图')
    const imagePath = path.join(nested, 'result.png')
    fs.mkdirSync(nested)
    fs.writeFileSync(imagePath, 'image')

    const result = deleteAuthorizedWorkspaceImage({
      workspaceRoot: workspace,
      filePath: imagePath,
    })

    assert.equal(result.ok, true)
    assert.equal(result.path, fs.realpathSync.native(nested) + path.sep + 'result.png')
    assert.equal(fs.existsSync(imagePath), false)
  })
})

test('workspace deletion allows regular images outside an approved workspace', () => {
  withTempTree(({ workspace, outside }) => {
    const insideImage = path.join(workspace, 'inside.jpg')
    const outsideImage = path.join(outside, 'outside.jpg')
    fs.writeFileSync(insideImage, 'inside')
    fs.writeFileSync(outsideImage, 'outside')
    const roots = new Set()

    const insideResult = deleteAuthorizedWorkspaceImage({
      workspaceRoot: workspace,
      filePath: insideImage,
      roots,
    })

    assert.equal(insideResult.ok, true)
    assert.equal(fs.existsSync(insideImage), false)
    authorizeBalaWorkspaceRoot(workspace, { roots })
    const outsideResult = deleteAuthorizedWorkspaceImage({
      workspaceRoot: workspace,
      filePath: outsideImage,
      roots,
    })
    assert.equal(outsideResult.ok, true)
    assert.equal(fs.existsSync(outsideImage), false)
  })
})

test('workspace deletion permits AI image cache files without a workspace grant', () => {
  withTempTree(({ parent, workspace, outside }) => {
    const cache = path.join(parent, 'ai-image-cache')
    const imagePath = path.join(cache, 'result-job-hash.png')
    const outsideImage = path.join(outside, 'outside.png')
    fs.mkdirSync(cache)
    fs.writeFileSync(imagePath, 'image')
    fs.writeFileSync(outsideImage, 'outside')
    const roots = new Set()

    const result = deleteAuthorizedWorkspaceImage({
      workspaceRoot: workspace,
      filePath: imagePath,
      roots,
    })

    assert.equal(result.ok, true)
    assert.equal(result.path, fs.realpathSync.native(cache) + path.sep + 'result-job-hash.png')
    assert.equal(fs.existsSync(imagePath), false)
    const outsideResult = deleteAuthorizedWorkspaceImage({
      workspaceRoot: workspace,
      filePath: outsideImage,
      roots,
    })
    assert.equal(outsideResult.ok, true)
    assert.equal(fs.existsSync(outsideImage), false)
  })
})

test('workspace deletion rejects the root, directories, non-images, and symlinks', () => {
  withTempTree(({ workspace, outside }) => {
    const textFile = path.join(workspace, 'notes.txt')
    const outsideImage = path.join(outside, 'outside.png')
    const link = path.join(workspace, 'linked.png')
    fs.writeFileSync(textFile, 'notes')
    fs.writeFileSync(outsideImage, 'outside')
    fs.symlinkSync(outsideImage, link)
    assert.throws(() => deleteAuthorizedWorkspaceImage({ workspaceRoot: workspace, filePath: workspace }), /目录/)
    assert.throws(() => deleteAuthorizedWorkspaceImage({ workspaceRoot: workspace, filePath: path.join(workspace, '.') }), /目录/)
    assert.throws(() => deleteAuthorizedWorkspaceImage({ workspaceRoot: workspace, filePath: textFile }), /图片文件/)
    assert.throws(() => deleteAuthorizedWorkspaceImage({ workspaceRoot: workspace, filePath: link }), /符号链接/)
    assert.equal(fs.existsSync(textFile), true)
    assert.equal(fs.existsSync(outsideImage), true)
  })
})

test('workspace image listing only returns real regular images with their current file versions', () => {
  withTempTree(({ workspace, outside }) => {
    const imageDir = path.join(workspace, '208326102205', '01_模拍原图')
    fs.mkdirSync(imageDir, { recursive: true })
    const imagePath = path.join(imageDir, 'front-AI.jpg')
    fs.writeFileSync(imagePath, 'image')
    fs.writeFileSync(path.join(workspace, 'note.txt'), 'not an image')
    fs.symlinkSync(path.join(outside, 'outside.jpg'), path.join(workspace, 'unsafe.jpg'))
    const assets = listAuthorizedBalaWorkspaceImages({ workspaceRoot: workspace })
    assert.deepEqual(assets.map(asset => asset.path), [fs.realpathSync.native(imagePath)])
    assert.equal(assets[0].styleCode, '208326102205')
    assert.equal(assets[0].sourceType, 'model')
    assert.match(assets[0].version, /-/)
    assert.equal(typeof assets[0].mtimeMs, 'number')
    assert.equal(Number.isFinite(Date.parse(assets[0].modifiedAt)), true)
  })
})

test('workspace image listing treats the AI result folder as selected model material', () => {
  withTempTree(({ workspace }) => {
    const imageDir = path.join(workspace, '208326102205', '03_AI图')
    fs.mkdirSync(imageDir, { recursive: true })
    fs.writeFileSync(path.join(imageDir, 'result.png'), 'image')
    const [asset] = listAuthorizedBalaWorkspaceImages({ workspaceRoot: workspace })
    assert.equal(asset.styleCode, '208326102205')
    assert.equal(asset.sourceType, 'model')
    assert.equal(asset.isAi, true)
  })
})

test('legacy workspace authorization store remains readable while deletion does not depend on it', () => {
  withTempTree(({ parent, workspace }) => {
    const storePath = path.join(parent, 'authorized-bala-workspaces.json')
    const imagePath = path.join(workspace, 'generated.webp')
    fs.writeFileSync(imagePath, 'image')

    const firstProcessRoots = new Set()
    rememberAuthorizedBalaWorkspaceRoot(workspace, {
      roots: firstProcessRoots,
      storePath,
    })

    const restartedProcessRoots = new Set()
    loadAuthorizedBalaWorkspaceRoots(storePath, { roots: restartedProcessRoots })
    const result = deleteAuthorizedWorkspaceImage({
      workspaceRoot: workspace,
      filePath: imagePath,
      roots: restartedProcessRoots,
    })

    assert.equal(result.ok, true)
    assert.equal(fs.existsSync(imagePath), false)
    const stored = JSON.parse(fs.readFileSync(storePath, 'utf8'))
    assert.equal(stored.version, 1)
    assert.deepEqual(stored.roots, [fs.realpathSync.native(workspace)])
  })
})

test('workspace deletion is idempotent when the image is already missing anywhere on disk', () => {
  withTempTree(({ workspace, outside }) => {
    const missingImage = path.join(workspace, 'already-removed.png')
    const missingOutsideImage = path.join(outside, 'outside.png')

    const result = deleteAuthorizedWorkspaceImage({
      workspaceRoot: workspace,
      filePath: missingImage,
    })

    assert.deepEqual(result, {
      ok: true,
      path: fs.realpathSync.native(workspace) + path.sep + 'already-removed.png',
      alreadyMissing: true,
    })
    const missingOutsideResult = deleteAuthorizedWorkspaceImage({
      workspaceRoot: workspace,
      filePath: missingOutsideImage,
    })
    assert.deepEqual(missingOutsideResult, {
      ok: true,
      path: fs.realpathSync.native(outside) + path.sep + 'outside.png',
      alreadyMissing: true,
    })
  })
})

test('workspace video metadata permits regular videos anywhere and never serializes video bytes', () => {
  withTempTree(({ workspace, outside }) => {
    const nested = path.join(workspace, '视频结果')
    const videoPath = path.join(nested, 'result.mp4')
    const outsideVideo = path.join(outside, 'outside.mp4')
    const linkPath = path.join(workspace, 'linked.mp4')
    fs.mkdirSync(nested)
    fs.writeFileSync(videoPath, Buffer.alloc(64 * 1024, 7))
    fs.writeFileSync(outsideVideo, 'outside')
    fs.symlinkSync(outsideVideo, linkPath)

    const media = getAuthorizedBalaWorkspaceVideo({ workspaceRoot: workspace, filePath: videoPath })
    const outsideMedia = getAuthorizedBalaWorkspaceVideo({ workspaceRoot: workspace, filePath: outsideVideo })

    assert.equal(media.path, fs.realpathSync.native(videoPath))
    assert.equal(media.mime, 'video/mp4')
    assert.equal(media.size, 64 * 1024)
    assert.equal(Object.hasOwn(media, 'data_url'), false)
    assert.equal(outsideMedia.path, fs.realpathSync.native(outsideVideo))
    assert.equal(outsideMedia.mime, 'video/mp4')
    assert.throws(
      () => getAuthorizedBalaWorkspaceVideo({ workspaceRoot: workspace, filePath: linkPath }),
      /符号链接/,
    )
  })
})

test('workspace image metadata permits regular images anywhere and rejects symlinks', () => {
  withTempTree(({ workspace, outside }) => {
    const nested = path.join(workspace, '208326102205', '01_模拍原图')
    const imagePath = path.join(nested, '1-AI.jpg')
    const outsideImage = path.join(outside, 'outside.jpg')
    const linkPath = path.join(workspace, 'linked.jpg')
    fs.mkdirSync(nested, { recursive: true })
    fs.writeFileSync(imagePath, 'image')
    fs.writeFileSync(outsideImage, 'outside')
    fs.symlinkSync(outsideImage, linkPath)

    const media = getAuthorizedBalaWorkspaceImage({ workspaceRoot: workspace, filePath: imagePath })
    const outsideMedia = getAuthorizedBalaWorkspaceImage({ workspaceRoot: workspace, filePath: outsideImage })

    assert.equal(media.path, fs.realpathSync.native(imagePath))
    assert.equal(media.mime, 'image/jpeg')
    assert.equal(outsideMedia.path, fs.realpathSync.native(outsideImage))
    assert.equal(outsideMedia.mime, 'image/jpeg')
    assert.throws(
      () => getAuthorizedBalaWorkspaceImage({ workspaceRoot: workspace, filePath: linkPath }),
      /符号链接/,
    )
  })
})

test('workspace manifest reads and writes under any selected workspace directory', () => {
  withTempTree(({ workspace, outside }) => {
    const payload = {
      version: 1,
      workspaceDir: workspace,
      video: {
        tasks: [{ id: 'task-1', styleCode: '208326102205' }],
        results: [{ id: 'result-1', path: path.join(workspace, '视频结果', 'result.mp4') }],
      },
    }

    const saved = writeAuthorizedBalaWorkspaceManifest({ workspaceRoot: workspace, payload })
    assert.equal(saved.ok, true)
    assert.equal(fs.existsSync(saved.path), true)
    assert.deepEqual(readAuthorizedBalaWorkspaceManifest({ workspaceRoot: workspace }), payload)
    assert.equal(readAuthorizedBalaWorkspaceManifest({ workspaceRoot: outside }), null)
  })
})
