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
  }

  get innerText() {
    return this._text
  }

  get textContent() {
    return this._text
  }

  getClientRects() {
    return this._rect.width && this._rect.height ? [this._rect] : []
  }

  getBoundingClientRect() {
    const { x, y, width, height } = this._rect
    return { left: x, top: y, width, height, right: x + width, bottom: y + height }
  }

  querySelectorAll(selector) {
    return this._selectors.get(selector) || []
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }

  setSelector(selector, items) {
    this._selectors.set(selector, Array.isArray(items) ? items : [])
    return this
  }

  closest() {
    return null
  }

  contains() {
    return false
  }

  scrollIntoView() {}
  focus() {}
  click() {}
  dispatchEvent() { return true }
  getAttribute() { return null }
}

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

function buildDocument(activeOuterSite = '全球') {
  return new FakeDocument('商品明细 查询')
    .setSelector('a[class*="index-module__drItem___"]', [
      buildOuterSiteNode('全球', activeOuterSite === '全球'),
      buildOuterSiteNode('美国', activeOuterSite === '美国'),
      buildOuterSiteNode('欧区', activeOuterSite === '欧区'),
    ])
    .setSelector('[class*="Drawer_content_"]', [])
    .setSelector('[class*="Drawer_outerWrapper_"]', [])
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
    },
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

test('process_source_row keeps list-result filtering behavior', async () => {
  const result = await runScript({
    phase: 'process_source_row',
    document: buildDocument('美国'),
    params: {
      list_result_file: {
        rows: [
          { SPU: '111111', 外层站点: '全球', 商品名称: '全球款', 列表时间范围: '近7日', 列表页码: '1' },
          { SPU: '222222', 外层站点: '美国', 商品名称: '美国款', 列表时间范围: '本月', 列表页码: '1' },
        ],
      },
      outer_sites: ['美国'],
    },
    shared: {
      rowIndex: 0,
      availableOuterSites: ['全球', '美国'],
      fallbackOuterSite: '全球',
      processed_count: 0,
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'prepare_query')
  assert.equal(result.meta.shared.total_rows, 1)
  assert.equal(result.meta.shared.currentSpu, '222222')
  assert.equal(result.meta.shared.currentOuterSite, '美国')
  assert.equal(result.meta.shared.currentProductName, '美国款')
  assert.equal(result.meta.shared.currentListTimeRange, '本月')
})

test('process_source_row expands SPU-only import rows to selected outer sites', async () => {
  const result = await runScript({
    phase: 'process_source_row',
    document: buildDocument('全球'),
    params: {
      list_result_file: {
        rows: [{ SPU: '333333' }],
      },
      outer_sites: ['全球', '美国'],
    },
    shared: {
      rowIndex: 0,
      availableOuterSites: ['全球', '美国'],
      fallbackOuterSite: '全球',
      processed_count: 0,
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'prepare_query')
  assert.equal(result.meta.shared.total_rows, 2)
  assert.equal(result.meta.shared.currentSpu, '333333')
  assert.equal(result.meta.shared.currentOuterSite, '全球')
})

test('process_source_row defaults SPU-only import rows to current page outer site', async () => {
  const result = await runScript({
    phase: 'process_source_row',
    document: buildDocument('美国'),
    params: {
      list_result_file: {
        rows: [{ SPU: '444444' }],
      },
    },
    shared: {
      rowIndex: 0,
      availableOuterSites: ['全球', '美国'],
      fallbackOuterSite: '美国',
      processed_count: 0,
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'prepare_query')
  assert.equal(result.meta.shared.total_rows, 1)
  assert.equal(result.meta.shared.currentSpu, '444444')
  assert.equal(result.meta.shared.currentOuterSite, '美国')
})
