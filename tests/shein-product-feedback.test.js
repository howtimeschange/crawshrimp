import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

class FakeElement {
  constructor(options = {}) {
    this.tagName = String(options.tagName || 'DIV').toUpperCase()
    this.className = String(options.className || '')
    this._text = String(options.text || '')
    this._value = String(options.value || '')
    this._attrs = new Map(Object.entries(options.attributes || {}))
    this._selectors = new Map()
    this._rect = options.rect || { x: 0, y: 0, width: 120, height: 32 }
    this.__clickRequest = options.clickRequest || null
  }

  get innerText() { return this._text }
  get textContent() { return this._text }
  get value() { return this._value }
  set value(next) { this._value = String(next ?? '') }
  get placeholder() { return String(this._attrs.get('placeholder') || '') }

  setSelector(selector, items) {
    this._selectors.set(selector, Array.isArray(items) ? items : [])
    return this
  }

  querySelectorAll(selector) {
    return this._selectors.get(selector) || []
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }

  getAttribute(name) {
    return this._attrs.has(name) ? this._attrs.get(name) : null
  }

  setAttribute(name, value) {
    this._attrs.set(name, String(value))
  }

  removeAttribute(name) {
    this._attrs.delete(name)
  }

  getClientRects() {
    return this._rect.width && this._rect.height ? [this._rect] : []
  }

  getBoundingClientRect() {
    const { x, y, width, height } = this._rect
    return { left: x, top: y, width, height, right: x + width, bottom: y + height }
  }

  scrollIntoView() {}
  focus() {}
  click() {
    if (!this.__clickRequest || typeof this.__runtimeFetch !== 'function') return true
    this.__runtimeFetch(this.__clickRequest.url, this.__clickRequest.init || {})
    return true
  }
  dispatchEvent() { return true }
}

class FakeDocument {
  constructor(bodyText = '') {
    this._selectors = new Map()
    this.body = new FakeElement({
      tagName: 'body',
      text: bodyText,
      rect: { x: 0, y: 0, width: 1920, height: 1080 },
    })
  }

  setSelector(selector, items) {
    this._selectors.set(selector, Array.isArray(items) ? items : [])
    return this
  }

  querySelectorAll(selector) {
    return this._selectors.get(selector) || []
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }
}

async function runScript({ phase = 'main', page = 1, params = {}, shared = {}, document, fetchImpl }) {
  const scriptPath = path.resolve('adapters/shein-helper/product-feedback.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: phase,
      __CRAWSHRIMP_SHARED__: shared,
      __CRAWSHRIMP_PAGE__: page,
    },
    document,
    location: { href: 'https://sso.geiwohuo.com/#/mgs/store-management/product-feedback' },
    fetch: fetchImpl || (async () => { throw new Error('fetch not mocked') }),
    console,
    setTimeout,
    clearTimeout,
    URL,
    JSON,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Map,
    Set,
    Event: class Event {
      constructor(type, init = {}) {
        this.type = type
        Object.assign(this, init)
      }
    },
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
  }
  context.globalThis = context
  context.window.fetch = (...args) => context.fetch(...args)
  const bindRuntimeFetch = element => {
    if (!element || typeof element !== 'object') return
    element.__runtimeFetch = (...args) => context.fetch(...args)
    if (element._selectors instanceof Map) {
      for (const items of element._selectors.values()) {
        for (const item of items || []) bindRuntimeFetch(item)
      }
    }
  }
  bindRuntimeFetch(document)
  bindRuntimeFetch(document?.body)
  return await vm.runInNewContext(source, context, { filename: scriptPath })
}

function attachReactFiberChain(element, chain) {
  let current = null
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const node = chain[index] || {}
    current = {
      memoizedProps: node.memoizedProps || {},
      memoizedState: node.memoizedState || null,
      return: current,
    }
  }
  element.__reactInternalInstance$test = current
  return current
}

test('product feedback main phase captures template from pager request', async () => {
  const prev = new FakeElement({
    tagName: 'button',
    className: 'soui-pagination-button-item soui-button-disabled',
    rect: { x: 1288, y: 857, width: 26, height: 26 },
  })
  const current = new FakeElement({
    tagName: 'button',
    text: '1',
    className: 'soui-pagination-button-item',
    rect: { x: 1322, y: 857, width: 26, height: 26 },
  })
  const next = new FakeElement({
    tagName: 'button',
    className: 'soui-pagination-button-item',
    rect: { x: 1640, y: 857, width: 26, height: 26 },
    clickRequest: {
      url: '/mgs-api-prefix/goods/comment/list',
      init: {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startCommentTime: '2026-01-21 00:00:00',
          commentEndTime: '2026-04-20 23:59:59',
          page: 2,
          perPage: 30,
        }),
      },
    },
  })
  const document = new FakeDocument('商品评价 共 23312 条')
    .setSelector('button', [prev, current, next])
    .setSelector('table', [new FakeElement({ tagName: 'table', text: '评价ID 商品信息' })])
    .setSelector('tbody tr', [new FakeElement({ tagName: 'tr', text: 'row-1' })])

  const fetchImpl = async (url, init = {}) => ({
    url: String(url),
    async json() {
      return {
        code: '0',
        info: {
          data: [],
          meta: { count: 23312 },
        },
      }
    },
    async text() {
      return JSON.stringify({
        code: '0',
        info: {
          data: [],
          meta: { count: 23312 },
        },
      })
    },
    clone() {
      return this
    },
  })

  const result = await runScript({ document, fetchImpl })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'prepare_template')
  assert.equal(result.meta.shared.capture_source, 'pager')
  assert.match(result.meta.shared.captureResult.matches[0].responseUrl, /goods\/comment\/list/)
})

test('product feedback collect_page replays API with perPage 200', async () => {
  const document = new FakeDocument('商品评价')
  const fetchCalls = []
  const pageItems = Array.from({ length: 200 }, (_, index) => ({
    commentId: `C-${index + 1}`,
    goodsTitle: `商品A-${index + 1}`,
    goodsThumb: `https://img.example/a-${index + 1}.jpg`,
    goodsAttribute: '8Y',
    goodSn: `SN-${index + 1}`,
    spu: `SPU-${index + 1}`,
    skc: `SKC-${index + 1}`,
    sku: `SKU-${index + 1}`,
    goodsCommentStar: 5,
    goodsCommentStarName: '5星',
    goodsCommentContent: '很好',
    goodsCommentImages: [`https://img.example/r-${index + 1}.jpg`],
    commentTime: '2026-04-19 20:12',
    supplyOrderNo: `SO-${index + 1}`,
    dataCenterName: '欧洲区域',
  }))
  const fetchImpl = async (url, init = {}) => {
    fetchCalls.push({ url, init })
    return {
      status: 200,
      async json() {
        return {
          code: '0',
          info: {
            data: pageItems,
            meta: { count: 250 },
          },
        }
      },
    }
  }

  const shared = {
    api_template: {
      endpoint: '/mgs-api-prefix/goods/comment/list',
      payload: {
        startCommentTime: '2026-01-21 00:00:00',
        commentEndTime: '2026-04-20 23:59:59',
        skc: ['sk25021051271714212', 'sa260303103351937770319'],
        commentId: '18249209315',
        goodsCommentStar: 4,
        page: 2,
        perPage: 30,
      },
      filter_summary: '评价时间=2026-01-21~2026-04-20; SKC=sk25021051271714212,sa260303103351937770319; 评价ID=18249209315; 星级=4星',
      filter_payload: {
        startCommentTime: '2026-01-21 00:00:00',
        commentEndTime: '2026-04-20 23:59:59',
        skc: ['sk25021051271714212', 'sa260303103351937770319'],
        commentId: '18249209315',
        goodsCommentStar: 4,
      },
    },
  }

  const result = await runScript({
    phase: 'collect_page',
    page: 1,
    shared,
    document,
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.meta.has_more, true)
  assert.equal(result.data.length, 200)
  assert.equal(result.data[0].评价ID, 'C-1')
  assert.equal(result.data[0].商品标题, '商品A-1')
  assert.equal(
    result.data[0].筛选摘要,
    '评价时间=2026-01-21~2026-04-20; SKC=sk25021051271714212,sa260303103351937770319; 评价ID=18249209315; 星级=4星',
  )
  assert.equal(result.meta.shared.total_rows, 250)
  assert.equal(result.meta.shared.total_batches, 2)
  assert.equal(result.meta.shared.current_exec_no, 200)
  assert.equal(result.meta.shared.batch_no, 1)

  const requestPayload = JSON.parse(fetchCalls[0].init.body)
  assert.equal(requestPayload.page, 1)
  assert.equal(requestPayload.perPage, 200)
  assert.deepEqual(requestPayload.skc, ['sk25021051271714212', 'sa260303103351937770319'])
  assert.equal(requestPayload.commentId, '18249209315')
  assert.equal(requestPayload.goodsCommentStar, 4)
})

test('product feedback main phase injects review date range before capturing current filters', async () => {
  const document = new FakeDocument('商品评价 共 23312 条')
    .setSelector('tbody tr', [new FakeElement({ tagName: 'tr', text: 'row-1' })])

  const result = await runScript({
    params: { review_date_range: { start: '2026-04-18', end: '2026-04-18' } },
    document,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'inject_review_date_range')
  assert.equal(result.meta.shared.requestedReviewDateRange.start, '2026-04-18')
  assert.equal(result.meta.shared.requestedReviewDateRange.end, '2026-04-18')
})

test('product feedback prepare_template overrides review date range and resets captured totals', async () => {
  const document = new FakeDocument('商品评价')
  const shared = {
    captureResult: {
      matches: [
        {
          url: 'https://sso.geiwohuo.com/mgs-api-prefix/goods/comment/list',
          responseUrl: 'https://sso.geiwohuo.com/mgs-api-prefix/goods/comment/list',
          method: 'POST',
          headers: {
            Accept: 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
          },
          postData: JSON.stringify({
            startCommentTime: '2026-01-21 00:00:00',
            commentEndTime: '2026-04-20 23:59:59',
            page: 12,
            perPage: 30,
          }),
          body: JSON.stringify({
            code: '0',
            info: {
              data: [],
              meta: { count: 23312 },
            },
          }),
        },
      ],
    },
  }

  const result = await runScript({
    phase: 'prepare_template',
    params: {
      review_date_range: { start: '2026-04-18', end: '2026-04-18' },
    },
    shared,
    document,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'collect_page')
  assert.equal(result.meta.shared.api_template.payload.startCommentTime, '2026-04-18 00:00:00')
  assert.equal(result.meta.shared.api_template.payload.commentEndTime, '2026-04-18 23:59:59')
  assert.equal(result.meta.shared.api_template.filter_summary, '评价时间=2026-04-18~2026-04-18')
  assert.equal(result.meta.shared.total_rows, 0)
  assert.equal(result.meta.shared.total_batches, 0)
})

test('product feedback prepare_template applies requested skc comment id and star filters', async () => {
  const document = new FakeDocument('商品评价')
  const shared = {
    captureResult: {
      matches: [
        {
          url: 'https://sso.geiwohuo.com/mgs-api-prefix/goods/comment/list',
          responseUrl: 'https://sso.geiwohuo.com/mgs-api-prefix/goods/comment/list',
          method: 'POST',
          headers: {
            Accept: 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
          },
          postData: JSON.stringify({
            startCommentTime: '2026-01-21 00:00:00',
            commentEndTime: '2026-04-20 23:59:59',
            skc: 'old-skc',
            commentId: 'old-comment',
            goodsCommentStar: 5,
            page: 12,
            perPage: 30,
          }),
          body: JSON.stringify({
            code: '0',
            info: {
              data: [],
              meta: { count: 23312 },
            },
          }),
        },
      ],
    },
  }

  const result = await runScript({
    phase: 'prepare_template',
    params: {
      filter_skc: 'sk25021051271714212\nsa260303103351937770319',
      filter_comment_id: '18249209315',
      filter_star: '4',
    },
    shared,
    document,
  })

  assert.equal(result.success, true)
  const template = result.meta.shared.api_template
  assert.deepEqual(Array.from(template.payload.skc), ['sk25021051271714212', 'sa260303103351937770319'])
  assert.equal(template.payload.commentId, '18249209315')
  assert.equal(template.payload.goodsCommentStar, 4)
  assert.match(template.filter_summary, /SKC=sk25021051271714212,sa260303103351937770319/)
  assert.match(template.filter_summary, /评价ID=18249209315/)
  assert.match(template.filter_summary, /星级=4星/)
})

test('product feedback inject_review_date_range updates visible inputs through react range handlers', async () => {
  const startInput = new FakeElement({
    tagName: 'input',
    value: '2026-01-21 00:00',
    attributes: { placeholder: '开始日期', readonly: 'readonly' },
  })
  const endInput = new FakeElement({
    tagName: 'input',
    value: '2026-04-20 23:59',
    attributes: { placeholder: '结束日期', readonly: 'readonly' },
  })
  const rangeCalls = []

  const toVisibleValue = (value, endOfDay = false) => {
    if (value instanceof Date) {
      const iso = value.toISOString().slice(0, 19).replace('T', ' ')
      return `${iso.slice(0, 10)} ${endOfDay ? '23:59' : '00:00'}`
    }
    const text = String(value || '').trim()
    if (!text) return ''
    return `${text.slice(0, 10)} ${endOfDay ? '23:59' : '00:00'}`
  }

  const applyRange = candidate => {
    if (!Array.isArray(candidate) || candidate.length < 2) return
    rangeCalls.push(candidate)
    startInput.value = toVisibleValue(candidate[0], false)
    endInput.value = toVisibleValue(candidate[1], true)
  }

  attachReactFiberChain(startInput, [
    { memoizedProps: { onChange: ({ target }) => { startInput.value = String(target?.value || '') } } },
    {
      memoizedProps: {
        range: true,
        value: ['2026-01-21 00:00:00', '2026-04-20 23:59:59'],
        format: 'yyyy-MM-dd HH:mm:ss',
        onChange: applyRange,
      },
    },
  ])

  const document = new FakeDocument('商品评价')
    .setSelector('input', [startInput, endInput])
    .setSelector('tbody tr', [new FakeElement({ tagName: 'tr', text: 'row-1' })])

  const result = await runScript({
    phase: 'inject_review_date_range',
    params: {
      review_date_range: { start: '2026-04-18', end: '2026-04-18' },
    },
    document,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.shared.review_date_range_injection_meta.applied, true)
  assert.equal(startInput.value, '2026-04-18 00:00')
  assert.equal(endInput.value, '2026-04-18 23:59')
  assert.ok(
    rangeCalls.some(candidate =>
      Array.isArray(candidate) &&
      String(candidate[0] || '').includes('2026-04-18') &&
      String(candidate[1] || '').includes('2026-04-18'),
    ),
  )
})
