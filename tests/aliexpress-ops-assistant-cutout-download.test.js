import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const SCRIPT_PATH = path.resolve('adapters/aliexpress-ops-assistant/product-cutout-download.js')

async function runAdapter({
  phase = 'main',
  params = {},
  shared = {},
  href = 'https://csp.aliexpress.com/ait/cn_pop/item_product/product_publish?productId=1005010649710870&channelId=125417',
  formValues = {},
  includeForm = true,
  documentBodyText = '商品发布 基本信息 商品图片',
  mtopImpl = null,
  exportsBox = null,
} = {}) {
  const source = fs.readFileSync(SCRIPT_PATH, 'utf8')
  const location = {
    href,
    assign(next) { this.href = String(next || '') },
  }
  const form = {
    values: formValues,
    getValuesIn(pathname) {
      return String(pathname || '').split('.').reduce((acc, key) => acc?.[key], this.values)
    },
  }
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: phase,
      __CRAWSHRIMP_SHARED__: shared,
      __CRAWSHRIMP_EXPORTS__: exportsBox,
      ...(includeForm ? { __form__: form } : {}),
      lib: mtopImpl ? { mtop: { request: mtopImpl } } : {},
      scrollTo() {},
    },
    document: {
      readyState: 'complete',
      body: { innerText: documentBodyText },
      querySelectorAll() { return [] },
      querySelector() { return null },
    },
    location,
    URL,
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
    Promise,
    Error,
    encodeURIComponent,
    decodeURIComponent,
  }
  context.globalThis = context
  return await vm.runInNewContext(source, context, { filename: SCRIPT_PATH })
}

async function loadExports() {
  const exportsBox = {}
  await runAdapter({ phase: '__exports__', exportsBox })
  return exportsBox
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test('normalizes pasted product ids and builds publish URLs', async () => {
  const helpers = await loadExports()

  assert.deepEqual(plain(helpers.normalizeProductIds('1005012039686365\n1005012039686365, 1005012041834064；bad')), [
    '1005012039686365',
    '1005012041834064',
  ])
  assert.equal(
    helpers.buildPublishUrl('1005012039686365', '125417'),
    'https://csp.aliexpress.com/ait/cn_pop/item_product/product_publish?productId=1005012039686365&channelId=125417',
  )
})

test('main phase seeds row progress and moves to publish page preparation', async () => {
  const result = await runAdapter({
    params: {
      product_ids: '1005012039686365\n1005012041834064',
      channel_id: '125417',
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'ensure_publish_page')
  assert.deepEqual(plain(result.meta.shared.target_product_ids), ['1005012039686365', '1005012041834064'])
  assert.equal(result.meta.shared.total_rows, 2)
  assert.equal(result.meta.shared.current_exec_no, 1)
  assert.equal(result.meta.shared.current_buyer_id, '1005012039686365')
})

test('main phase reads uploaded Excel rows, applies row range before dedupe, and preserves source row numbers', async () => {
  const result = await runAdapter({
    params: {
      product_file: {
        rows: [
          { 款号: '1005012039686365' },
          { 商品ID: 'https://csp.aliexpress.com/ait/cn_pop/item_product/product_publish?productId=1005012041834064&channelId=125417' },
          { productId: 'duplicate 1005012039686365' },
          { '商品款号': '1005012042309848' },
        ],
      },
      product_ids: '1005012041834064\n1005012042853924',
      channel_id: '125417',
      start_row: 2,
      end_row: 3,
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'ensure_publish_page')
  assert.deepEqual(plain(result.meta.shared.target_product_ids), [
    '1005012041834064',
    '1005012039686365',
  ])
  assert.deepEqual(plain(result.meta.shared.target_product_jobs), [
    {
      product_id: '1005012041834064',
      row_no: 3,
      source: 'Excel',
      exec_no: 1,
    },
    {
      product_id: '1005012039686365',
      row_no: 4,
      source: 'Excel',
      exec_no: 2,
    },
  ])
  assert.equal(result.meta.shared.total_rows, 2)
  assert.equal(result.meta.shared.current_exec_no, 1)
  assert.equal(result.meta.shared.current_row_no, 3)
  assert.equal(result.meta.shared.current_buyer_id, '1005012041834064')
})

test('ensure_publish_page navigates to the current product publish URL', async () => {
  const result = await runAdapter({
    phase: 'ensure_publish_page',
    href: 'https://csp.aliexpress.com/m_apps/productManage/list-manage?channelId=125417',
    shared: {
      target_product_ids: ['1005012039686365'],
      product_index: 0,
      channel_id: '125417',
      result_rows: [],
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'wait_publish_page')
  assert.equal(
    result.meta.shared.target_url,
    'https://csp.aliexpress.com/ait/cn_pop/item_product/product_publish?productId=1005012039686365&channelId=125417',
  )
})

test('wait_publish_page waits for real form or main image DOM before cutout', async () => {
  const result = await runAdapter({
    phase: 'wait_publish_page',
    includeForm: false,
    documentBodyText: '商品发布 基本信息 商品图片',
    shared: {
      target_product_ids: ['1005010649710870'],
      product_index: 0,
      channel_id: '125417',
      result_rows: [],
      wait_count: 0,
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'wait_publish_page')
  assert.equal(result.meta.shared.wait_count, 1)
})

test('cutout_current calls AliExpress cutout MTop API and records output row', async () => {
  const calls = []
  const result = await runAdapter({
    phase: 'cutout_current',
    formValues: {
      mainImage: [{ url: 'https://ae-pic-a1.aliexpress-media.com/kf/source.jpg' }],
    },
    shared: {
      target_product_ids: ['1005012039686365'],
      product_index: 0,
      channel_id: '125417',
      result_rows: [],
      current_exec_no: 1,
      current_buyer_id: '1005012039686365',
    },
    mtopImpl(request, success) {
      calls.push(request)
      success({
        ret: ['SUCCESS::调用成功'],
        data: { data: 'https://ae-pic-a1.aliexpress-media.com/kf/cutout.jpg' },
      })
    },
  })

  assert.equal(result.success, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].api, 'mtop.csp.merchant.media.file.cutout')
  assert.equal(calls[0].type, 'GET')
  assert.equal(calls[0].dataType, 'json')
  assert.equal(calls[0].data.productId, '1005012039686365')
  assert.equal(calls[0].data.channelId, '125417')
  assert.equal(calls[0].data.url, 'https://ae-pic-a1.aliexpress-media.com/kf/source.jpg')
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'advance_product')
  assert.equal(result.data[0].款号, '1005012039686365')
  assert.equal(result.data[0].原主图地址, 'https://ae-pic-a1.aliexpress-media.com/kf/source.jpg')
  assert.equal(result.data[0].抠图后图片地址, 'https://ae-pic-a1.aliexpress-media.com/kf/cutout.jpg')
  assert.equal(result.data[0].执行结果, '成功')
  assert.equal(Object.hasOwn(result.meta.shared, 'result_rows'), false)
  assert.equal(result.meta.shared.success_count, 1)
  assert.equal(result.meta.shared.failed_count, 0)
})

test('cutout_current retries once when AliExpress MTop session refreshes after expiry', async () => {
  const calls = []
  const result = await runAdapter({
    phase: 'cutout_current',
    formValues: {
      mainImage: [{ url: 'https://ae-pic-a1.aliexpress-media.com/kf/source.jpg' }],
    },
    shared: {
      target_product_ids: ['1005012039686365'],
      product_index: 0,
      channel_id: '125417',
      result_rows: [],
      current_exec_no: 1,
      current_buyer_id: '1005012039686365',
    },
    mtopImpl(request, success, failure) {
      calls.push(request)
      if (calls.length === 1) {
        failure({ ret: ['FAIL_SYS_SESSION_EXPIRED::SESSION失效'] })
        return
      }
      success({
        ret: ['SUCCESS::调用成功'],
        data: { data: 'https://ae-pic-a1.aliexpress-media.com/kf/cutout.jpg' },
      })
    },
  })

  assert.equal(result.success, true)
  assert.equal(calls.length, 2)
  assert.equal(result.data[0].款号, '1005012039686365')
  assert.equal(result.data[0].抠图后图片地址, 'https://ae-pic-a1.aliexpress-media.com/kf/cutout.jpg')
  assert.equal(result.data[0].执行结果, '成功')
  assert.equal(result.meta.shared.retry_count, 1)
})

test('cutout_current retries transient MTop failures up to configured max attempts', async () => {
  const calls = []
  const result = await runAdapter({
    phase: 'cutout_current',
    params: {
      max_attempts: 5,
    },
    formValues: {
      mainImage: [{ url: 'https://ae-pic-a1.aliexpress-media.com/kf/source.jpg' }],
    },
    shared: {
      target_product_ids: ['1005012039686365'],
      product_index: 0,
      channel_id: '125417',
      current_exec_no: 1,
      current_buyer_id: '1005012039686365',
    },
    mtopImpl(request, success, failure) {
      calls.push(request)
      if (calls.length < 3) {
        failure({ ret: ['FAIL_SYS_SERVICE_FAULT::服务暂不可用'] })
        return
      }
      success({
        ret: ['SUCCESS::调用成功'],
        data: { data: 'https://ae-pic-a1.aliexpress-media.com/kf/cutout.jpg' },
      })
    },
  })

  assert.equal(result.success, true)
  assert.equal(calls.length, 3)
  assert.equal(result.data[0].执行结果, '成功')
  assert.equal(result.meta.shared.retry_count, 2)
  assert.equal(result.meta.shared.success_count, 1)
  assert.equal(result.meta.shared.failed_count, 0)
})

test('cutout_current does not inflate retry count for non-transient API failures', async () => {
  const calls = []
  const result = await runAdapter({
    phase: 'cutout_current',
    params: {
      max_attempts: 5,
    },
    formValues: {
      mainImage: [{ url: 'https://ae-pic-a1.aliexpress-media.com/kf/source.jpg' }],
    },
    shared: {
      target_product_ids: ['1005012039686365'],
      product_index: 0,
      channel_id: '125417',
      current_exec_no: 1,
      current_buyer_id: '1005012039686365',
    },
    mtopImpl(request, success, failure) {
      calls.push(request)
      failure({ ret: ['FAIL_BIZ_RULE::图片地址无效'] })
    },
  })

  assert.equal(result.success, true)
  assert.equal(calls.length, 1)
  assert.equal(result.data[0].执行结果, '失败')
  assert.equal(result.data[0].重试次数, 0)
  assert.equal(result.meta.shared.retry_count, 0)
  assert.equal(result.meta.shared.failed_count, 1)
})

test('cutout_current accumulates retry counts across page recovery retries', async () => {
  const calls = []
  const result = await runAdapter({
    phase: 'cutout_current',
    params: {
      max_attempts: 2,
    },
    formValues: {
      mainImage: [{ url: 'https://ae-pic-a1.aliexpress-media.com/kf/source.jpg' }],
    },
    shared: {
      target_product_ids: ['1005012039686365'],
      product_index: 0,
      channel_id: '125417',
      current_exec_no: 1,
      current_buyer_id: '1005012039686365',
      product_retry_count: 2,
    },
    mtopImpl(request, success) {
      calls.push(request)
      success({
        ret: ['SUCCESS::调用成功'],
        data: { data: 'https://ae-pic-a1.aliexpress-media.com/kf/cutout.jpg' },
      })
    },
  })

  assert.equal(result.success, true)
  assert.equal(calls.length, 1)
  assert.equal(result.data[0].执行结果, '成功')
  assert.equal(result.data[0].重试次数, 2)
  assert.equal(result.meta.shared.retry_count, 2)
  assert.equal(result.meta.shared.product_retry_count, 0)
})

test('cutout_current records a failed row when the first main image is missing', async () => {
  const result = await runAdapter({
    phase: 'cutout_current',
    formValues: { mainImage: [] },
    shared: {
      target_product_ids: ['1005012039686365'],
      product_index: 0,
      channel_id: '125417',
      result_rows: [],
      current_exec_no: 1,
      current_buyer_id: '1005012039686365',
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'advance_product')
  assert.equal(result.data[0].款号, '1005012039686365')
  assert.equal(result.data[0].执行结果, '失败')
  assert.match(result.data[0].备注, /未找到第一张主图/)
  assert.equal(result.meta.shared.success_count, 0)
  assert.equal(result.meta.shared.failed_count, 1)
})
