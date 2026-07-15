'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  authorizeBalaWorkspaceRoot,
  deleteAuthorizedWorkspaceImage,
  loadAuthorizedBalaWorkspaceRoots,
  rememberAuthorizedBalaWorkspaceRoot,
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

test('authorized workspace deletion unlinks a regular nested image', () => {
  withTempTree(({ workspace }) => {
    const nested = path.join(workspace, 'AI生成图')
    const imagePath = path.join(nested, 'result.png')
    fs.mkdirSync(nested)
    fs.writeFileSync(imagePath, 'image')

    const roots = new Set()
    const authorizedRoot = authorizeBalaWorkspaceRoot(workspace, { roots })
    const result = deleteAuthorizedWorkspaceImage({
      workspaceRoot: authorizedRoot,
      filePath: imagePath,
      roots,
    })

    assert.equal(result.ok, true)
    assert.equal(result.path, fs.realpathSync.native(nested) + path.sep + 'result.png')
    assert.equal(fs.existsSync(imagePath), false)
  })
})

test('workspace deletion rejects an unapproved root and a path outside the approved root', () => {
  withTempTree(({ workspace, outside }) => {
    const insideImage = path.join(workspace, 'inside.jpg')
    const outsideImage = path.join(outside, 'outside.jpg')
    fs.writeFileSync(insideImage, 'inside')
    fs.writeFileSync(outsideImage, 'outside')
    const roots = new Set()

    assert.throws(() => deleteAuthorizedWorkspaceImage({
      workspaceRoot: workspace,
      filePath: insideImage,
      roots,
    }), /未授权/)

    authorizeBalaWorkspaceRoot(workspace, { roots })
    assert.throws(() => deleteAuthorizedWorkspaceImage({
      workspaceRoot: workspace,
      filePath: outsideImage,
      roots,
    }), /工作区内/)
    assert.equal(fs.existsSync(outsideImage), true)
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
    const roots = new Set()
    authorizeBalaWorkspaceRoot(workspace, { roots })

    assert.throws(() => deleteAuthorizedWorkspaceImage({ workspaceRoot: workspace, filePath: workspace, roots }), /工作区本身/)
    assert.throws(() => deleteAuthorizedWorkspaceImage({ workspaceRoot: workspace, filePath: path.join(workspace, '.'), roots }), /工作区本身/)
    assert.throws(() => deleteAuthorizedWorkspaceImage({ workspaceRoot: workspace, filePath: textFile, roots }), /图片文件/)
    assert.throws(() => deleteAuthorizedWorkspaceImage({ workspaceRoot: workspace, filePath: link, roots }), /符号链接/)
    assert.equal(fs.existsSync(textFile), true)
    assert.equal(fs.existsSync(outsideImage), true)
  })
})

test('system-picked workspace authorization survives a main-process restart', () => {
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

test('authorized workspace deletion is idempotent when the image is already missing', () => {
  withTempTree(({ workspace, outside }) => {
    const missingImage = path.join(workspace, 'already-removed.png')
    const missingOutsideImage = path.join(outside, 'outside.png')
    const roots = new Set()
    authorizeBalaWorkspaceRoot(workspace, { roots })

    const result = deleteAuthorizedWorkspaceImage({
      workspaceRoot: workspace,
      filePath: missingImage,
      roots,
    })

    assert.deepEqual(result, {
      ok: true,
      path: fs.realpathSync.native(workspace) + path.sep + 'already-removed.png',
      alreadyMissing: true,
    })
    assert.throws(() => deleteAuthorizedWorkspaceImage({
      workspaceRoot: workspace,
      filePath: missingOutsideImage,
      roots,
    }), /工作区内/)
  })
})
