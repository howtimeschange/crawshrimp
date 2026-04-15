import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

class FakeElement {
  constructor(options = {}) {
    this.tagName = String(options.tagName || 'DIV').toUpperCase()
    this.className = String(options.className || '')
    this._text = options.text || ''
    this._value = String(options.value || '')
    this._rect = options.rect || { x: 0, y: 0, width: 240, height: 40 }
    this._attrs = new Map(Object.entries(options.attributes || {}))
    this._selectors = new Map()
    this.parentElement = options.parentElement || null
    this._closest = options.closest || null
    this.src = options.src || ''
  }

  get innerText() {
    return typeof this._text === 'function' ? this._text() : this._text
  }

  get textContent() {
    return this.innerText
  }

  get value() {
    return typeof this._value === 'function' ? this._value() : this._value
  }

  set value(next) {
    this._value = String(next ?? '')
  }

  setSelector(selector, items) {
    this._selectors.set(selector, typeof items === 'function' ? items : (items || []))
    return this
  }

  querySelectorAll(selector) {
    const value = this._selectors.get(selector)
    if (typeof value === 'function') return value()
    return value || []
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }

  closest(selector) {
    if (typeof this._closest === 'function') return this._closest(selector)
    return this._closest || null
  }

  getAttribute(name) {
    return this._attrs.has(name) ? this._attrs.get(name) : null
  }

  setAttribute(name, value) {
    this._attrs.set(name, value)
    return this
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
  click() {}
  dispatchEvent() { return true }
}

class FakeDocument {
  constructor(bodyText = '') {
    this._selectors = new Map()
    this.body = new FakeElement({
      tagName: 'body',
      text: bodyText,
      rect: { x: 0, y: 0, width: 1600, height: 900 },
    })
  }

  setSelector(selector, items) {
    this._selectors.set(selector, typeof items === 'function' ? items : (items || []))
    return this
  }

  querySelectorAll(selector) {
    const value = this._selectors.get(selector)
    if (typeof value === 'function') return value()
    return value || []
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }
}

async function runScript({ phase, params = {}, shared = {}, document, href }) {
  const scriptPath = path.resolve('adapters/temu/evaluate-list.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: phase,
      __CRAWSHRIMP_SHARED__: shared,
      __CRAWSHRIMP_PAGE__: 1,
      HTMLInputElement: class HTMLInputElement {},
    },
    document,
    location: new URL(href),
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Event: class Event {
      constructor(type, init = {}) {
        this.type = type
        Object.assign(this, init)
      }
    },
    MouseEvent: class MouseEvent {
      constructor(type, init = {}) {
        this.type = type
        Object.assign(this, init)
      }
    },
    PointerEvent: class PointerEvent {
      constructor(type, init = {}) {
        this.type = type
        Object.assign(this, init)
      }
    },
    Date,
    URL,
    Math,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Map,
    Set,
  }
  context.globalThis = context
  return await vm.runInNewContext(source, context, { filename: scriptPath })
}

function buildCustomRangeDocument(rangeValue) {
  const document = new FakeDocument('商品评价 全球 评价时间 查询')
  const label = new FakeElement({ text: '评价时间' })
  const input = new FakeElement({
    tagName: 'input',
    value: rangeValue,
    attributes: { 'data-testid': 'beast-core-rangePicker-htmlInput' },
  })
  const root = new FakeElement({
    attributes: { 'data-testid': 'beast-core-rangePicker-input' },
  })
  input.parentElement = root
  input._closest = selector => {
    if (selector === '[data-testid="beast-core-rangePicker-input"]') return root
    return null
  }
  root.setSelector('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]', () => [input])

  const row = new FakeElement()
  row.setSelector('div, label, span, td, th', () => [label])
  row.setSelector('[data-testid="beast-core-rangePicker-input"], [class*="RPR_inputWrapper_"]', () => [root])
  row.setSelector('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]', () => [input])

  const customNode = new FakeElement({
    tagName: 'button',
    text: '自定义',
    className: 'tab active',
  })
  row.setSelector('div, span, button, a, label', () => [label, customNode])

  const query = new FakeElement({ tagName: 'button', text: '查询' })
  const region = new FakeElement({ tagName: 'a', text: '全球', className: 'index-module__drItem___ index-module__active___' })

  document.setSelector('div[class*="index-module__row___"]', () => [row])
  document.setSelector('tr', () => [])
  document.setSelector('[class*="filter"], [class*="Filter"]', () => [])
  document.setSelector('button', () => [query])
  document.setSelector('a[class*="index-module__drItem___"]', () => [region])
  document.setSelector('table', () => [new FakeElement({ tagName: 'table', text: '商品信息 评价时间 审核状态' })])
  document.setSelector('tbody tr[class*="TB_tr_"], tr[class*="TB_tr_"]', () => [])
  document.setSelector('thead tr', () => [])
  document.setSelector('[class*="TB_empty_"]', () => [new FakeElement({ text: '暂无数据' })])
  document.setSelector('li[class*="PGT_pagerItemActive_"], li[aria-current="page"]', () => [new FakeElement({ tagName: 'li', text: '1' })])
  document.setSelector('li[class*="PGT_next_"]', () => [new FakeElement({ tagName: 'li', className: 'PGT_next_ PGT_disabled_' })])
  return document
}

function buildActiveCustomCapsuleDocument() {
  const document = new FakeDocument('商品评价 全球 评价时间 查询')
  const timeLabel = new FakeElement({ text: '评价时间' })
  const quick30 = new FakeElement({ tagName: 'button', text: '近30天', className: 'flat-field_capsule__' })
  const quick60 = new FakeElement({ tagName: 'button', text: '近60天', className: 'flat-field_capsule__' })
  const quick90 = new FakeElement({ tagName: 'button', text: '近90天', className: 'flat-field_capsule__' })
  const activeRange = new FakeElement({
    tagName: 'button',
    text: '2026-04-01 ~ 2026-04-07',
    className: 'flat-field_capsule__ flat-field_active__',
  })
  const timeRow = new FakeElement({ className: 'flat-field_item__' })
  timeRow.setSelector('[class*="flat-field_capsule__"]', () => [quick30, quick60, quick90, activeRange])
  timeRow.setSelector('div, span, button, a, label', () => [timeLabel, quick30, quick60, quick90, activeRange])

  const otherLabel = new FakeElement({ text: '评价内容' })
  const otherActive = new FakeElement({
    tagName: 'button',
    text: '全部',
    className: 'flat-field_capsule__ flat-field_active__',
  })
  const otherRow = new FakeElement({ className: 'flat-field_item__' })
  otherRow.setSelector('[class*="flat-field_capsule__"]', () => [otherActive])
  otherRow.setSelector('div, span, button, a, label', () => [otherLabel, otherActive])

  const query = new FakeElement({ tagName: 'button', text: '查询' })
  const region = new FakeElement({ tagName: 'a', text: '全球', className: 'index-module__drItem___ index-module__active___' })

  document.setSelector('[class*="flat-field_item__"]', () => [timeRow, otherRow])
  document.setSelector('div[class*="index-module__row___"]', () => [])
  document.setSelector('tr', () => [])
  document.setSelector('[class*="filter"], [class*="Filter"]', () => [])
  document.setSelector('button', () => [query])
  document.setSelector('a[class*="index-module__drItem___"]', () => [region])
  document.setSelector('table', () => [new FakeElement({ tagName: 'table', text: '商品信息 评价时间 审核状态' })])
  document.setSelector('tbody tr[class*="TB_tr_"], tr[class*="TB_tr_"]', () => [])
  document.setSelector('thead tr', () => [])
  document.setSelector('[class*="TB_empty_"]', () => [new FakeElement({ text: '暂无数据' })])
  document.setSelector('li[class*="PGT_pagerItemActive_"], li[aria-current="page"]', () => [new FakeElement({ tagName: 'li', text: '1' })])
  document.setSelector('li[class*="PGT_next_"]', () => [new FakeElement({ tagName: 'li', className: 'PGT_next_ PGT_disabled_' })])
  return document
}

function buildCollectDocument() {
  const document = new FakeDocument('商品评价 全球 评价时间 查询 商品信息 SKU属性 评价时间 审核状态')

  const region = new FakeElement({ tagName: 'a', text: '全球', className: 'index-module__drItem___ index-module__active___' })
  const query = new FakeElement({ tagName: 'button', text: '查询' })
  const next = new FakeElement({ tagName: 'li', className: 'PGT_next_ PGT_disabled_' })
  const activePage = new FakeElement({ tagName: 'li', className: 'PGT_pagerItemActive_', text: '1' })

  const headerCells = [
    new FakeElement({ tagName: 'th', text: '商品信息' }),
    new FakeElement({ tagName: 'th', text: 'SKU属性' }),
    new FakeElement({ tagName: 'th', text: '评价星级' }),
    new FakeElement({ tagName: 'th', text: '评价信息' }),
    new FakeElement({ tagName: 'th', text: '评价时间' }),
    new FakeElement({ tagName: 'th', text: '审核状态' }),
    new FakeElement({ tagName: 'th', text: '操作' }),
  ]
  const headRow = new FakeElement({ tagName: 'tr' })
  headRow.children = headerCells

  const goodsImg = new FakeElement({ tagName: 'img', src: 'https://img.example/goods.jpg' })
  const reviewImg = new FakeElement({ tagName: 'img', src: 'https://img.example/review.jpg' })

  const goodsCell = new FakeElement({
    tagName: 'td',
    text: '共6张\nSemir牛仔夹克\n类目：男士牛仔夹克\nSPU：6374039413\nSKC：88609336752\n在售',
  })
  goodsCell.setAttribute('style', 'background-image: url(\"https://img.example/goods-bg.jpg\")')
  goodsCell.setSelector('img', () => [goodsImg])

  const skuCell = new FakeElement({
    tagName: 'td',
    text: '牛仔深蓝88301-Asian XL\nSKU：21396331357',
  })
  const starCell = new FakeElement({
    tagName: 'td',
    text: '5分\n评价有礼',
  })
  const reviewCell = new FakeElement({
    tagName: 'td',
    text: 'Great jacket - good material as shown\n合身情况：Large\n不合身原因：Foot Length',
  })
  reviewCell.setAttribute('style', 'background-image: url(\"https://img.example/review-bg.jpg\")')
  reviewCell.setSelector('img', () => [reviewImg])
  const timeCell = new FakeElement({ tagName: 'td', text: '2026-04-08 18:02:31' })
  const auditCell = new FakeElement({ tagName: 'td', text: '-' })
  const opCell = new FakeElement({ tagName: 'td', text: '申诉' })

  const row = new FakeElement({ tagName: 'tr', className: 'TB_tr_' })
  row.setSelector('td[class*="TB_td_"], td', () => [goodsCell, skuCell, starCell, reviewCell, timeCell, auditCell, opCell])
  row.setSelector('td', () => [goodsCell, skuCell, starCell, reviewCell, timeCell, auditCell, opCell])

  const table = new FakeElement({ tagName: 'table', text: '商品信息 SKU属性 评价星级 评价信息 评价时间 审核状态 操作' })
  table.setSelector('thead tr', () => [headRow])
  table.setSelector('tbody tr[class*="TB_tr_"], tr[class*="TB_tr_"]', () => [row])

  document.setSelector('a[class*="index-module__drItem___"]', () => [region])
  document.setSelector('button', () => [query])
  document.setSelector('table', () => [table])
  document.setSelector('thead tr', () => [headRow])
  document.setSelector('tbody tr[class*="TB_tr_"], tr[class*="TB_tr_"]', () => [row])
  document.setSelector('[class*="TB_empty_"]', () => [])
  document.setSelector('li[class*="PGT_pagerItemActive_"], li[aria-current="page"]', () => [activePage])
  document.setSelector('li[class*="PGT_next_"]', () => [next])
  return document
}

test('evaluate-list accepts populated custom review range', async () => {
  const result = await runScript({
    phase: 'apply_review_time_range',
    href: 'https://agentseller.temu.com/main/evaluate/evaluate-list',
    document: buildCustomRangeDocument('2026-04-01 ~ 2026-04-07'),
    params: {
      mode: 'current',
      regions: ['全球'],
      review_time_range: '自定义',
      custom_review_time_range: { start: '2026-04-01', end: '2026-04-07' },
    },
    shared: {
      currentOuterSite: '全球',
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta?.action, 'next_phase')
  assert.equal(result.meta?.next_phase, 'run_query')
  assert.equal(result.meta?.shared.currentReviewTimeScope, '2026-04-01 ~ 2026-04-07')
})

test('evaluate-list reads active custom review range from the review-time row only', async () => {
  const result = await runScript({
    phase: 'apply_review_time_range',
    href: 'https://agentseller.temu.com/main/evaluate/evaluate-list',
    document: buildActiveCustomCapsuleDocument(),
    params: {
      mode: 'current',
      regions: ['全球'],
      review_time_range: '自定义',
      custom_review_time_range: { start: '2026-04-01', end: '2026-04-07' },
    },
    shared: {
      currentOuterSite: '全球',
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta?.action, 'next_phase')
  assert.equal(result.meta?.next_phase, 'run_query')
  assert.equal(result.meta?.shared.currentReviewTimeScope, '2026-04-01 ~ 2026-04-07')
})

test('evaluate-list collects one backend review row', async () => {
  const result = await runScript({
    phase: 'collect',
    href: 'https://agentseller.temu.com/main/evaluate/evaluate-list',
    document: buildCollectDocument(),
    params: {
      mode: 'current',
      regions: ['全球'],
      review_time_range: '近90天',
    },
    shared: {
      currentOuterSite: '全球',
      currentReviewTimeScope: '近90天',
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta?.action, 'complete')
  assert.equal(result.meta?.has_more, false)
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].地区, '全球')
  assert.equal(result.data[0].商品名称, 'Semir牛仔夹克')
  assert.equal(result.data[0].SPU, '6374039413')
  assert.equal(result.data[0].SKU, '21396331357')
  assert.equal(result.data[0].评价星级, '5')
  assert.equal(result.data[0].合身情况, 'Large')
  assert.equal(result.data[0].不合身原因, 'Foot Length')
  assert.equal(result.data[0].评价时间, '2026-04-08 18:02:31')
  assert.match(result.data[0].商品图片, /goods-bg\.jpg|goods\.jpg/)
  assert.match(result.data[0].评价图片, /review-bg\.jpg|review\.jpg/)
})
