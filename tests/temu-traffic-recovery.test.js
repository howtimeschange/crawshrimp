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

async function runScript(scriptPath, { phase, params = {}, shared = {}, document, href }) {
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

test('activity-data schedules reload recovery after busy page turn', async () => {
  const scriptPath = path.resolve('adapters/temu/activity-data.js')
  const document = new FakeDocument('Too many visitors, please try again later.')
  document.setSelector('tbody tr', [])
  document.setSelector('[class*="TB_empty_"]', [])
  const result = await runScript(scriptPath, {
    phase: 'after_list_page_turn',
    document,
    href: 'https://agentseller.temu.com/main/act/data-full',
    shared: {
      currentOuterSite: '全球',
      currentPageNo: 2,
      lastCollectedPageNo: 2,
      targetOuterSites: ['全球', '美国'],
      listBusyRetry: 0,
      listPageRetry: 0,
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'reload_page')
  assert.equal(result.meta.next_phase, 'recover_list_page')
  assert.equal(result.meta.shared.recoverOuterSite, '全球')
  assert.equal(result.meta.shared.recoverPageNo, 3)
})

test('mall-flux schedules reload recovery after busy page turn', async () => {
  const scriptPath = path.resolve('adapters/temu/mall-flux.js')
  const document = new FakeDocument('Too many visitors, please try again later.')
  document.setSelector('tbody tr', [])
  document.setSelector('[class*="TB_empty_"]', [])
  const result = await runScript(scriptPath, {
    phase: 'after_list_page_turn',
    document,
    href: 'https://agentseller.temu.com/main/mall-flux-analysis-full',
    shared: {
      currentOuterSite: '美国',
      currentPageNo: 4,
      lastCollectedPageNo: 4,
      targetOuterSites: ['全球', '美国'],
      listBusyRetry: 0,
      listPageRetry: 0,
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'reload_page')
  assert.equal(result.meta.next_phase, 'recover_list_page')
  assert.equal(result.meta.shared.recoverOuterSite, '美国')
  assert.equal(result.meta.shared.recoverPageNo, 5)
})
