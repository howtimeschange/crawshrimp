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
    this._rect = options.rect || { x: 0, y: 0, width: 240, height: 40 }
    this._selectors = new Map()
    this._attrs = { ...(options.attrs || {}) }
    this.parentElement = options.parentElement || null
    this._value = String(options.value || '')
    this._onClick = options.onClick || null
    this._closest = new Map()
  }

  get innerText() {
    return this._text
  }

  get textContent() {
    return this._text
  }

  get value() {
    return this._value
  }

  set value(next) {
    this._value = String(next ?? '')
  }

  getClientRects() {
    return this._rect.width && this._rect.height ? [this._rect] : []
  }

  getBoundingClientRect() {
    const { x, y, width, height } = this._rect
    return { left: x, top: y, width, height, right: x + width, bottom: y + height }
  }

  setSelector(selector, items) {
    const list = Array.isArray(items) ? items.filter(Boolean) : []
    this._selectors.set(selector, list)
    for (const item of list) {
      if (!item.parentElement) item.parentElement = this
    }
    return this
  }

  querySelectorAll(selector) {
    return this._selectors.get(selector) || []
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }

  setClosest(selector, value) {
    this._closest.set(selector, value)
    return this
  }

  closest(selector) {
    return this._closest.get(selector) || null
  }

  contains(target) {
    if (!target) return false
    if (target === this) return true
    for (const list of this._selectors.values()) {
      for (const item of list) {
        if (item === target) return true
        if (typeof item.contains === 'function' && item.contains(target)) return true
      }
    }
    return false
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null
  }

  scrollIntoView() {}
  focus() {}

  click() {
    this._onClick?.()
  }

  dispatchEvent() {
    return true
  }
}

class FakeHTMLInputElement extends FakeElement {}

Object.defineProperty(FakeHTMLInputElement.prototype, 'value', {
  get() {
    return this._value
  },
  set(next) {
    this._value = String(next ?? '')
  },
  configurable: true,
})

class FakeDocument {
  constructor(bodyText = '') {
    this.body = new FakeElement({
      tagName: 'body',
      text: bodyText,
      rect: { x: 0, y: 0, width: 1920, height: 1080 },
    })
    this._selectors = new Map()
  }

  setSelector(selector, items) {
    this._selectors.set(selector, Array.isArray(items) ? items.filter(Boolean) : [])
    return this
  }

  querySelectorAll(selector) {
    return this._selectors.get(selector) || []
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }
}

function styleFor() {
  return {
    display: 'block',
    visibility: 'visible',
    cursor: 'default',
    zIndex: '0',
  }
}

function buildOuterSiteNode(site, active = false) {
  return new FakeElement({
    tagName: 'a',
    text: site,
    className: active
      ? 'index-module__drItem___ index-module__active___'
      : 'index-module__drItem___',
  })
}

const OPTION_SELECTOR = '[class*="ST_option_"], [class*="ST_item_"], [class*="cIL_item_"], [role="option"], li[class*="option"]'
const DETAIL_ROW_SELECTOR = 'tbody tr[class*="TB_tr_"], tr[class*="TB_tr_"]'

function buildTableCell(text) {
  return new FakeElement({ tagName: 'td', text })
}

function buildDetailPageSizeDocument({ pageSize = '10', site = '加拿大', includePageSizeOption = false } = {}) {
  const doc = new FakeDocument('商品数据分析 流量明细')
  const drawer = new FakeElement({
    tagName: 'div',
    text: '商品数据分析 流量明细',
    className: 'Drawer_content_',
  })
  const drawerTable = new FakeElement({ tagName: 'table', text: '流量明细' })
  const grainCapsule = new FakeElement({
    tagName: 'div',
    text: '按日',
    className: 'TAB_capsule_ TAB_active_',
  })
  const row = new FakeElement({
    tagName: 'tr',
    text: '2026-04-11 加拿大站 33 2 2 2 0 0 0 0 0',
    className: 'TB_tr_',
  })
  row.setSelector('td', [
    buildTableCell('2026-04-11'),
    buildTableCell('加拿大站'),
    buildTableCell('33'),
    buildTableCell('2'),
    buildTableCell('2'),
    buildTableCell('2'),
    buildTableCell('0'),
    buildTableCell('0'),
  ])

  const siteWrapper = new FakeElement({
    tagName: 'div',
    text: site,
    className: 'ST_outerWrapper_',
    rect: { x: 300, y: 120, width: 120, height: 28 },
  })
  const siteInput = new FakeHTMLInputElement({
    tagName: 'input',
    value: site,
    attrs: { 'data-testid': 'beast-core-select-htmlInput' },
    rect: { x: 305, y: 120, width: 96, height: 24 },
  })
  siteInput
    .setClosest('[data-testid="beast-core-select"]', siteWrapper)
    .setClosest('[class*="ST_outerWrapper_"]', siteWrapper)

  const pageSizeWrapper = new FakeElement({
    tagName: 'div',
    text: String(pageSize),
    className: 'ST_outerWrapper_ PGT_sizeSelect_',
    rect: { x: 100, y: 400, width: 52, height: 28 },
  })
  const pageSizeInput = new FakeHTMLInputElement({
    tagName: 'input',
    value: String(pageSize),
    attrs: { 'data-testid': 'beast-core-select-htmlInput' },
    rect: { x: 105, y: 400, width: 28, height: 24 },
  })
  pageSizeInput
    .setClosest('[data-testid="beast-core-select"]', pageSizeWrapper)
    .setClosest('[class*="ST_outerWrapper_"]', pageSizeWrapper)
  const pageSizeSuffix = new FakeElement({
    tagName: 'span',
    className: 'suffix',
    rect: { x: 136, y: 400, width: 16, height: 28 },
  })

  pageSizeWrapper.setSelector('[data-testid="beast-core-input-suffix"]', [pageSizeSuffix])
  pageSizeWrapper.setSelector('[data-testid="beast-core-select-header"]', [])
  pageSizeWrapper.setSelector('[class*="ST_head_"]', [])

  const closeOptions = () => {
    doc.setSelector(OPTION_SELECTOR, [])
  }
  const siteOption = new FakeElement({
    tagName: 'li',
    text: site,
    className: 'ST_option_',
    onClick: () => {
      siteInput.value = site
      closeOptions()
    },
  })
  siteWrapper._onClick = () => {
    doc.setSelector(OPTION_SELECTOR, [siteOption])
  }
  doc.body._onClick = closeOptions

  if (includePageSizeOption) {
    const pageSizeOption = new FakeElement({
      tagName: 'li',
      text: '40',
      className: 'ST_option_',
      onClick: () => {
        pageSizeInput.value = '40'
        closeOptions()
      },
    })
    doc.setSelector(OPTION_SELECTOR, [pageSizeOption])
  } else {
    doc.setSelector(OPTION_SELECTOR, [])
  }

  drawer.setSelector('table', [drawerTable])
  drawer.setSelector(DETAIL_ROW_SELECTOR, [row])
  drawer.setSelector('[class*="TAB_capsule_"]', [grainCapsule])
  drawer.setSelector('[class*="TB_empty_"]', [])
  drawer.setSelector('li[class*="PGT_next_"]', [])
  drawer.setSelector('li[class*="PGT_prev_"]', [])
  drawer.setSelector('li[class*="PGT_pagerItemActive_"]', [])
  drawer.setSelector('input[data-testid="beast-core-select-htmlInput"]', [siteInput, pageSizeInput])

  doc
    .setSelector('[class*="Drawer_content_"]', [drawer])
    .setSelector('[class*="Drawer_outerWrapper_"]', [])
    .setSelector('a[class*="index-module__drItem___"]', [buildOuterSiteNode('全球', true)])

  return {
    document: doc,
    pageSizeInput,
    pageSizeWrapper,
    siteInput,
    siteWrapper,
  }
}

function buildBusyListDocument() {
  const queryBtn = new FakeElement({ tagName: 'button', text: '查询' })
  return new FakeDocument('商品明细 Too many visitors, please try again later.')
    .setSelector('button', [queryBtn])
    .setSelector('a[class*="index-module__drItem___"]', [buildOuterSiteNode('美国', true)])
    .setSelector('[class*="Drawer_content_"]', [])
    .setSelector('[class*="Drawer_outerWrapper_"]', [])
    .setSelector('table', [])
}

function buildPrepareQueryBusyDocument() {
  const doc = buildBusyListDocument()
  const resetBtn = new FakeElement({ tagName: 'button', text: '重置' })
  const queryBtn = new FakeElement({ tagName: 'button', text: '查询' })
  const selectInput = new FakeHTMLInputElement({
    tagName: 'input',
    value: 'SPU',
    attrs: { 'data-testid': 'beast-core-select-htmlInput' },
  })
  const textInput = new FakeHTMLInputElement({ tagName: 'input', value: '' })
  const container = new FakeElement({ tagName: 'div', text: '' })
  const label = new FakeElement({ tagName: 'label', text: '商品ID查询', parentElement: container })

  container.setSelector('input, [class*="ST_outerWrapper_"], [class*="CSD_cascaderWrapper_"]', [selectInput])
  container.setSelector('input[data-testid="beast-core-select-htmlInput"]', [selectInput])
  container.setSelector('input', [selectInput, textInput])

  return doc
    .setSelector('button', [resetBtn, queryBtn])
    .setSelector('div, label, span', [label])
}

function buildBusyDrawerDocument() {
  const drawer = new FakeElement({ tagName: 'div', text: '商品数据分析 流量明细', className: 'Drawer_content_' })
  return new FakeDocument('Too many visitors, please try again later.')
    .setSelector('[class*="Drawer_content_"]', [drawer])
    .setSelector('[class*="Drawer_outerWrapper_"]', [])
}

function buildClosableDrawerDocument() {
  const doc = new FakeDocument('流量明细')
  const drawer = new FakeElement({ tagName: 'div', text: '商品数据分析 流量明细', className: 'Drawer_content_' })
  const closeBtn = new FakeElement({
    tagName: 'button',
    attrs: { 'data-testid': 'beast-core-icon-close' },
    onClick: () => {
      doc.setSelector('[class*="Drawer_content_"]', [])
      doc.setSelector('[class*="Drawer_outerWrapper_"]', [])
    },
  })
  return doc
    .setSelector('[class*="Drawer_content_"]', [drawer])
    .setSelector('[class*="Drawer_outerWrapper_"]', [])
    .setSelector('[data-testid="beast-core-icon-close"]', [closeBtn])
}

async function runScript({ phase, params = {}, shared = {}, document, href = 'https://agentseller.temu.com/main/flux-analysis-full' }) {
  const scriptPath = path.resolve('adapters/temu/goods-traffic-detail.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: phase,
      __CRAWSHRIMP_SHARED__: shared,
      __CRAWSHRIMP_PAGE__: 1,
      HTMLInputElement: FakeHTMLInputElement,
    },
    HTMLInputElement: FakeHTMLInputElement,
    document,
    location: { href },
    getComputedStyle: styleFor,
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
    Event: class Event {
      constructor(type, init = {}) {
        this.type = type
        Object.assign(this, init)
      }
    },
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    Math,
    Number,
    String,
    Boolean,
    RegExp,
    Array,
    Object,
    Map,
    Set,
    JSON,
    URL,
    parseInt,
    parseFloat,
    isNaN,
  }

  context.globalThis = context
  return await vm.runInNewContext(source, context, { filename: scriptPath })
}

test('after_outer_site_switch busy list prefers prepare_query over reload', async () => {
  const result = await runScript({
    phase: 'after_outer_site_switch',
    document: buildBusyListDocument(),
    shared: {
      targetOuterSite: '美国',
      currentSpu: '123456',
      resume_phase: 'prepare_query',
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'prepare_query')
})

test('prepare_query retries targeted SPU search before any reload', async () => {
  const result = await runScript({
    phase: 'prepare_query',
    document: buildPrepareQueryBusyDocument(),
    shared: {
      currentSpu: '123456',
      currentListTimeRange: '',
      prepareQueryRetry: 0,
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'prepare_query')
  assert.equal(result.meta.shared.prepareQueryRetry, 1)
})

test('after_open_detail busy drawer routes to recover_detail_query', async () => {
  const result = await runScript({
    phase: 'after_open_detail',
    document: buildBusyDrawerDocument(),
    shared: {
      currentSpu: '123456',
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'recover_detail_query')
})

test('recover_detail_query closes drawer and returns to prepare_query', async () => {
  const result = await runScript({
    phase: 'recover_detail_query',
    document: buildClosableDrawerDocument(),
    shared: {
      currentSpu: '123456',
      detailCloseRetry: 0,
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'prepare_query')
  assert.equal(result.meta.shared.detailCloseRetry, 0)
})

test('collect_detail_combo falls back to cdp click when page-size dropdown does not open via DOM', async () => {
  const { document, pageSizeWrapper } = buildDetailPageSizeDocument()
  const result = await runScript({
    phase: 'collect_detail_combo',
    document,
    shared: {
      currentOuterSite: '全球',
      currentSpu: '123456',
      targetDetailGrains: ['按日'],
      targetDetailSites: ['加拿大'],
      targetDetailSitesByGrain: { 按日: ['加拿大'] },
      detailSiteIndex: 0,
      detailGrainIndex: 0,
      lastAppliedDetailSite: '加拿大',
      lastAppliedDetailGrain: '按日',
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'cdp_clicks')
  assert.equal(result.meta.next_phase, 'after_collect_detail_page_size_open')
  assert.equal(result.meta.shared.detailPageSizeTarget, '40')
  assert.equal(result.meta.shared.detailPageSizeOpenRetry, 0)
  assert.equal(result.meta.clicks.length, 1)
  const suffixRect = pageSizeWrapper.querySelector('[data-testid="beast-core-input-suffix"]').getBoundingClientRect()
  assert.equal(result.meta.clicks[0].x, suffixRect.left + suffixRect.width / 2)
  assert.equal(result.meta.clicks[0].y, pageSizeWrapper.getBoundingClientRect().top + pageSizeWrapper.getBoundingClientRect().height / 2)
})

test('prepare_detail seeds all known daily site targets when site select is visible', async () => {
  const { document } = buildDetailPageSizeDocument({ pageSize: '40', site: '全部' })
  const result = await runScript({
    phase: 'prepare_detail',
    document,
    params: {
      detail_grains: ['按日'],
    },
    shared: {
      currentOuterSite: '全球',
      currentSpu: '123456',
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'collect_detail_combo')
  assert.equal(
    JSON.stringify(Array.from(result.meta.shared.targetDetailSitesByGrain.按日)),
    JSON.stringify(['全部', '加拿大', '澳大利亚', '日本', '韩国']),
  )
  assert.equal(result.meta.shared.total_batches, 5)
})

test('collect_detail_combo does not skip a site when the precheck only echoes current site value', async () => {
  const { document, siteInput, siteWrapper } = buildDetailPageSizeDocument({ pageSize: '40', site: '全部' })
  let openCount = 0

  const closeOptions = () => {
    document.setSelector(OPTION_SELECTOR, [])
  }
  const allOption = new FakeElement({
    tagName: 'li',
    text: '全部',
    className: 'ST_option_',
    onClick: () => {
      siteInput.value = '全部'
      closeOptions()
    },
  })
  const canadaOption = new FakeElement({
    tagName: 'li',
    text: '加拿大',
    className: 'ST_option_',
    onClick: () => {
      siteInput.value = '加拿大'
      closeOptions()
    },
  })

  siteWrapper._onClick = () => {
    openCount += 1
    if (openCount === 1) {
      document.setSelector(OPTION_SELECTOR, [])
      return
    }
    document.setSelector(OPTION_SELECTOR, [allOption, canadaOption])
  }
  document.body._onClick = closeOptions

  const result = await runScript({
    phase: 'collect_detail_combo',
    document,
    shared: {
      currentOuterSite: '全球',
      currentSpu: '123456',
      targetDetailGrains: ['按日'],
      targetDetailSites: ['加拿大'],
      targetDetailSitesByGrain: { 按日: ['加拿大'] },
      detailSiteIndex: 0,
      detailGrainIndex: 0,
      lastAppliedDetailSite: '全部',
      lastAppliedDetailGrain: '按日',
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'close_detail')
  assert.equal(siteInput.value, '加拿大')
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0]['记录类型'], '明细')
})

test('after_restore_detail_page_size_open applies page size and resumes combo recovery flow', async () => {
  const { document, pageSizeInput } = buildDetailPageSizeDocument({ includePageSizeOption: true })
  const result = await runScript({
    phase: 'after_restore_detail_page_size_open',
    document,
    shared: {
      currentOuterSite: '全球',
      currentSpu: '123456',
      targetDetailGrains: ['按日'],
      targetDetailSites: ['加拿大'],
      targetDetailSitesByGrain: { 按日: ['加拿大'] },
      detailSiteIndex: 0,
      detailGrainIndex: 0,
      detailResumePageNo: 1,
      currentDetailSite: '加拿大',
      currentDetailGrain: '按日',
      detailPageSizeTarget: '40',
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'collect_detail_combo')
  assert.equal(pageSizeInput.value, '40')
  assert.equal(result.meta.shared.currentDetailSite, '加拿大')
  assert.equal(result.meta.shared.currentDetailGrain, '按日')
})
