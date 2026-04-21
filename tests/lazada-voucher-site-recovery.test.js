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
    this._rect = options.rect || { x: 0, y: 0, width: 240, height: 40 }
    this._selectors = new Map()
    this.disabled = Boolean(options.disabled)
    this.readOnly = Boolean(options.readOnly)
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

  getClientRects() {
    return this._rect.width && this._rect.height ? [this._rect] : []
  }

  getBoundingClientRect() {
    const { x, y, width, height } = this._rect
    return { left: x, top: y, width, height, right: x + width, bottom: y + height }
  }

  closest() {
    return null
  }

  contains(node) {
    return node === this
  }

  scrollIntoView() {}
  focus() {}
  click() {}
  dispatchEvent() { return true }
}

class FakeDocument {
  constructor({ bodyText = '', title = '' } = {}) {
    this.title = title
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

  contains(node) {
    return node === this.body
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

async function runScript({ phase, page = 1, params, shared = {}, document, href }) {
  const scriptPath = path.resolve('adapters/lazada-plus-v1/voucher-create.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: phase,
      __CRAWSHRIMP_SHARED__: shared,
      __CRAWSHRIMP_PAGE__: page,
    },
    document,
    location: { href },
    navigator: { userAgent: 'node-test' },
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
    URLSearchParams,
    parseInt,
    parseFloat,
    isNaN,
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
    KeyboardEvent: class KeyboardEvent {
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
  }
  context.globalThis = context
  context.window.location = context.location
  context.window.document = context.document
  return await vm.runInNewContext(source, context, { filename: scriptPath })
}

function buildParams() {
  return {
    execute_mode: 'live',
    input_file: {
      rows: [
        {
          唯一键: 'REGULAR_TH_001',
          站点: 'TH',
          优惠工具: 'Regular Voucher',
          促销名称: 'TH Regular Voucher 20%',
          领取生效类型: 'FIXED_TIME',
          券生效开始时间: '2026-04-25 00:00:00',
          券生效结束时间: '2026-04-26 23:59:00',
          适用范围: 'ENTIRE_SHOP',
          折扣类型: 'PERCENT_OFF',
          折扣值: '20',
          最低消费金额: '500',
          最高优惠金额: '250',
          每人限用次数: '1',
          总发行量: '2',
        },
      ],
    },
  }
}

test('resolve_existing_promotions treats matched list URL with extra query as already on target page', async () => {
  const document = new FakeDocument({ bodyText: 'Promotion List' })
  document.setSelector('tbody, .next-table-body, .next-table', [new FakeElement({ tagName: 'tbody' })])
  document.setSelector('tr, [role="row"], .next-table-row', [])
  document.setSelector('button, a, [role="button"]', [])

  const result = await runScript({
    phase: 'resolve_existing_promotions',
    params: buildParams(),
    shared: {},
    document,
    href: 'https://sellercenter.lazada.co.th/apps/promotion/voucher/list?moduleType=REGULAR_VOUCHER&spm=abc123',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'open_create_page')
})

test('resolve_existing_promotions falls back to ensure_site_home after repeated cross-site navigation misses', async () => {
  const document = new FakeDocument({ bodyText: 'Create Regular Voucher - Lazada Seller Center' })
  document.setSelector('tbody, .next-table-body, .next-table', [])
  document.setSelector('tr, [role="row"], .next-table-row', [])
  document.setSelector('button, a, [role="button"]', [])

  const result = await runScript({
    phase: 'resolve_existing_promotions',
    params: buildParams(),
    shared: {
      nav_scope: 'resolve_existing_promotions',
      nav_target_url: 'https://sellercenter.lazada.co.th/apps/promotion/voucher/list?moduleType=REGULAR_VOUCHER',
      nav_retry_count: 5,
    },
    document,
    href: 'https://sellercenter.lazada.vn/apps/voucher/create?action=create&moduleType=REGULAR_VOUCHER',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'ensure_site_home')
})

test('ID live rows stop immediately with an account-health redirect warning', async () => {
  const document = new FakeDocument({ bodyText: 'Kesehatan Akun' })
  const params = {
    execute_mode: 'live',
    input_file: {
      rows: [
        {
          唯一键: 'REGULAR_ID_001',
          站点: 'ID',
          优惠工具: 'Regular Voucher',
          促销名称: 'ID Regular Voucher 20%',
          领取生效类型: 'FIXED_TIME',
          券生效开始时间: '2026-04-25 00:00:00',
          券生效结束时间: '2026-04-26 23:59:00',
          适用范围: 'ENTIRE_SHOP',
          折扣类型: 'PERCENT_OFF',
          折扣值: '20',
          最低消费金额: '500',
          最高优惠金额: '250',
          每人限用次数: '1',
          总发行量: '2',
        },
      ],
    },
  }

  const result = await runScript({
    phase: 'main',
    params,
    shared: {},
    document,
    href: 'https://sellercenter.lazada.co.id/apps/seller/account_health',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.data[0].执行状态, '失败')
  assert.match(result.data[0].错误原因, /account health/i)
})
