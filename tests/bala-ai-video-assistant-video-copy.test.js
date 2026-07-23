import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const SCRIPT_PATH = path.resolve('adapters/bala-ai-video-assistant/tmall-video-copy-generate.js')

function fakeDocument(overrides = {}) {
  return {
    body: { innerText: '' },
    querySelector: () => null,
    querySelectorAll: () => [],
    ...overrides,
  }
}

async function execute({ phase = '__exports__', params = {}, shared = {}, document = fakeDocument(), location = {}, window = {} } = {}) {
  const exportsBox = {}
  const locationValue = {
    href: 'https://myseller.taobao.com/home.htm/SellManage/on_sale?current=1&pageSize=20',
    ...location,
  }
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: phase,
      __CRAWSHRIMP_SHARED__: shared,
      __CRAWSHRIMP_EXPORTS__: phase === '__exports__' ? exportsBox : null,
      ...window,
    },
    document,
    location: locationValue,
    console,
    setTimeout,
    clearTimeout,
    URLSearchParams,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    Set,
    Promise,
  }
  context.globalThis = context
  const result = await vm.runInNewContext(fs.readFileSync(SCRIPT_PATH, 'utf8'), context, { filename: SCRIPT_PATH })
  return { exportsBox, result: JSON.parse(JSON.stringify(result)), location: locationValue }
}

test('template rows normalize 款号 and ID while preserving one task per product', async () => {
  const { exportsBox } = await execute()
  const normalized = exportsBox.normalizeJobs({
    input_file: {
      rows: [
        { 款号: 204125140101, ID: '850170525107' },
        { 款号: '204125140101', ID: 'https://item.taobao.com/item.htm?id=850170525107' },
        { 款号: '', ID: '800214310727' },
      ],
    },
  })

  assert.equal(normalized.jobs.length, 2)
  assert.equal(normalized.jobs[0].style_code, '204125140101')
  assert.equal(normalized.jobs[0].item_id, '850170525107')
  assert.equal(normalized.jobs[1].style_code, '')
  assert.equal(normalized.jobs[1].item_id, '800214310727')
  assert.equal(normalized.invalidRows.length, 1)
  assert.match(normalized.invalidRows[0].上传情况, /重复/)
})

test('product edit state provides title and five original main images', async () => {
  const stateValues = {
    title: { title: ['巴拉巴拉童鞋儿童运动鞋男童透气跑步鞋'] },
    outerId: '208326133201',
    mainImagesGroup: {
      images: Array.from({ length: 6 }, (_, index) => ({
        url: `//img.alicdn.com/imgextra/main-${index + 1}.jpg`,
      })),
    },
  }
  const { exportsBox } = await execute({
    window: {
      __SELL_STATE__: {
        getState: () => ({ getComponentValue: name => stateValues[name] }),
      },
    },
  })

  assert.equal(exportsBox.extractTitle(), stateValues.title.title[0])
  assert.equal(exportsBox.extractStyleCode(), '208326133201')
  assert.deepEqual(
    Array.from(exportsBox.extractMainImages()),
    Array.from({ length: 5 }, (_, index) => `https://img.alicdn.com/imgextra/main-${index + 1}.jpg`),
  )
  const row = exportsBox.collectProductMaterial({
    row_no: 2,
    style_code: '204125140101',
    item_id: '850170525107',
  })
  assert.equal(row.__generate_video_copy, true)
  assert.equal(row.__image_count, 5)
  assert.equal(row.ID, '850170525107')
})

test('ID-only template row backfills 款号 from the real product edit state', async () => {
  const stateValues = {
    title: { title: ['巴拉巴拉童装宝宝连体衣'] },
    outerId: '208326133201',
    mainImagesGroup: {
      images: Array.from({ length: 5 }, (_, index) => ({
        url: `//img.alicdn.com/imgextra/id-only-${index + 1}.jpg`,
      })),
    },
  }
  const { exportsBox } = await execute({
    window: {
      __SELL_STATE__: {
        getState: () => ({ getComponentValue: name => stateValues[name] }),
      },
    },
  })
  const normalized = exportsBox.normalizeJobs({
    input_file: { rows: [{ ID: '1027640116164' }] },
  })
  const row = exportsBox.collectProductMaterial(normalized.jobs[0])

  assert.equal(normalized.invalidRows.length, 0)
  assert.equal(row.款号, '208326133201')
  assert.equal(row.ID, '1027640116164')
  assert.equal(row.__image_count, 5)
})

test('navigate phase uses the matching 千牛 编辑商品 link before direct fallback', async () => {
  const editLink = {
    textContent: '编辑商品',
    href: 'https://sell.publish.tmall.com/tmall/itemEdit.htm?itemId=850170525107',
  }
  const { result, location } = await execute({
    phase: 'navigate_item',
    shared: {
      jobs: [{ row_no: 2, style_code: '204125140101', item_id: '850170525107' }],
      job_index: 0,
      result_rows: [],
    },
    document: fakeDocument({
      querySelectorAll: selector => selector === 'a[href]' ? [editLink] : [],
    }),
  })

  assert.equal(location.href, editLink.href)
  assert.equal(result.meta.next_phase, 'wait_item')
  assert.match(result.meta.shared.current_store, /进入商品/)
})

test('desktop runner main phase initializes template jobs', async () => {
  const { result } = await execute({
    phase: 'main',
    params: {
      input_file: {
        rows: [{ 款号: '204125140101', ID: '850170525107' }],
      },
    },
  })

  assert.equal(result.meta.next_phase, 'navigate_item')
  assert.equal(result.meta.shared.jobs.length, 1)
  assert.equal(result.meta.shared.total_rows, 1)
})
