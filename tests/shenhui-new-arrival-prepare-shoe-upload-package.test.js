import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const SCRIPT_PATH = path.resolve('adapters/shenhui-new-arrival/prepare-shoe-upload-package.js')

async function loadExports() {
  const source = fs.readFileSync(SCRIPT_PATH, 'utf8')
  const exportsBox = {}
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: {},
      __CRAWSHRIMP_PHASE__: '__exports__',
      __CRAWSHRIMP_SHARED__: {},
      __CRAWSHRIMP_EXPORTS__: exportsBox,
    },
    document: {},
    location: { href: 'https://fmp.semirapp.com/web/index#/home/file', hash: '#/home/file' },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    Set,
    Map,
  }
  context.globalThis = context
  await vm.runInNewContext(source, context, { filename: SCRIPT_PATH })
  return exportsBox
}

async function runScript(options = {}) {
  const source = fs.readFileSync(SCRIPT_PATH, 'utf8')
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: options.params || {},
      __CRAWSHRIMP_PHASE__: options.phase || 'init',
      __CRAWSHRIMP_SHARED__: options.shared || {},
      __CRAWSHRIMP_EXPORTS__: null,
    },
    document: {},
    location: { href: 'https://fmp.semirapp.com/web/index#/home/file', hash: '#/home/file' },
    fetch: options.fetch,
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    Set,
    Map,
  }
  context.globalThis = context
  return vm.runInNewContext(source, context, { filename: SCRIPT_PATH })
}

test('shoe upload-package adapter has its own script', () => {
  assert.equal(fs.existsSync(SCRIPT_PATH), true)
})

test('shoe asset collection keeps images without applying clothing yq semantics', async () => {
  const helpers = await loadExports()
  const image = helpers.classifyShoeAsset({
    ext: 'jpg',
    filename: 'GD005292.jpg',
    fullpath: '鞋品/204326141005-已写/00317/36/GD005292.jpg',
  })
  const labelImage = helpers.classifyShoeAsset({
    ext: 'jpg',
    filename: '功能吊牌.jpg',
    fullpath: '鞋品/204326141005-已写/00317/36/功能吊牌.jpg',
  })
  const database = helpers.classifyShoeAsset({
    ext: 'db',
    filename: 'Thumbs.db',
    fullpath: '鞋品/204326141005-已写/00317/36/Thumbs.db',
  })

  assert.equal(image.keep, true)
  assert.equal(image.role, 'shoe_source')
  assert.equal(labelImage.keep, true)
  assert.equal(labelImage.role, 'shoe_source')
  assert.equal(database.keep, false)
})

test('shoe color code is read from the folder above the size folder', async () => {
  const helpers = await loadExports()
  assert.equal(
    helpers.inferShoeColorCode(
      '巴拉货控/平拍原图/全域/小程序/鞋品/204326141005-已写/00317/36/GD005292.jpg',
      '204326141005',
    ),
    '00317',
  )
  assert.equal(
    helpers.inferShoeColorCode(
      '巴拉货控/平拍原图/全域/小程序/鞋品/204326141005-已写/10301/GD004125.jpg',
      '204326141005',
    ),
    '10301',
  )
})

test('shoe task init builds a single shoe source from the configured cloud path', async () => {
  const result = await runScript({
    params: {
      shoe_cloud_path: '巴拉营运BU-商品//巴拉货控/平拍原图/全域/小程序/鞋品/',
      item_codes: '204326141005',
      folder_scan_depth: 4,
      download_concurrency: 8,
    },
    fetch: async (url) => {
      if (String(url).includes('/fengcloud/1/account/mount')) {
        return {
          ok: true,
          json: async () => ({
            list: [{ org_name: '巴拉营运BU-商品', mount_id: 'm1' }],
          }),
        }
      }
      return { ok: true, json: async () => ({}) }
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'ensure_folder')
  assert.deepEqual([...Object.keys(result.meta.shared.source_configs)], ['shoe'])
  assert.equal(
    result.meta.shared.source_configs.shoe.relativePath,
    '巴拉货控/平拍原图/全域/小程序/鞋品',
  )
  assert.deepEqual([...result.meta.shared.source_types], ['shoe'])
})
