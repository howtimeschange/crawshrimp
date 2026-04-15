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
    this._rect = options.rect || { x: 0, y: 0, width: 240, height: 40 }
    this._selectors = new Map()
    this._attrs = new Map(Object.entries(options.attributes || {}))
    this.parentElement = options.parentElement || null
    this._closest = options.closest || null
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

  querySelectorAll(selector) {
    const value = this._selectors.get(selector)
    if (typeof value === 'function') return value()
    return value || []
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }

  setSelector(selector, items) {
    this._selectors.set(selector, items)
    return this
  }

  closest(selector) {
    if (typeof this._closest === 'function') return this._closest(selector)
    return this._closest || null
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
      rect: { x: 0, y: 0, width: 1440, height: 900 },
    })
  }

  setSelector(selector, items) {
    this._selectors.set(selector, items)
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

async function runScript({ phase = 'apply_custom_range', params = {}, shared = {}, document }) {
  const scriptPath = path.resolve('adapters/temu/goods-data.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: phase,
      __CRAWSHRIMP_SHARED__: shared,
      __CRAWSHRIMP_PAGE__: 1,
    },
    document,
    location: {
      href: 'https://agentseller.temu.com/newon/goods-data',
      hostname: 'agentseller.temu.com',
    },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    MouseEvent: class MouseEvent {},
    PointerEvent: class PointerEvent {},
    Date,
    URL,
  }
  context.globalThis = context
  return await vm.runInNewContext(source, context)
}

function buildApplyCustomRangeDocument({ rangeValue }) {
  const document = new FakeDocument('商品数据 全球 时间区间 自定义')
  const label = new FakeElement({
    className: 'index-module__row_label___',
    text: '时间区间',
  })
  const rangeInput = new FakeElement({
    tagName: 'input',
    value: rangeValue,
    attributes: { 'data-testid': 'beast-core-rangePicker-htmlInput' },
  })
  const rangeRoot = new FakeElement({
    attributes: { 'data-testid': 'beast-core-rangePicker-input' },
  })
  rangeInput.parentElement = rangeRoot
  rangeInput._closest = selector => {
    if (selector === '[data-testid="beast-core-rangePicker-input"]') return rangeRoot
    return null
  }
  rangeRoot.setSelector('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]', () => [rangeInput])

  const row = new FakeElement({ className: 'index-module__row___' })
  row.setSelector('[class*="index-module__row_label___"]', () => [label])
  row.setSelector('[data-testid="beast-core-rangePicker-input"], [class*="RPR_inputWrapper_"]', () => [rangeRoot])
  row.setSelector('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]', () => [rangeInput])

  const picker = new FakeElement({ className: 'RPR_outerPickerWrapper' })
  const panel = new FakeElement({ className: 'PP_outerWrapper' })
  panel.setSelector('[class*="RPR_outerPickerWrapper"]', () => [picker])

  document.setSelector('[class*="index-module__row___"]', () => [row])
  document.setSelector('[data-testid="beast-core-rangePicker-input"], [class*="RPR_inputWrapper_"]', () => [rangeRoot])
  document.setSelector('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]', () => [rangeInput])
  document.setSelector('[class*="PP_outerWrapper"]', () => [panel])
  document.setSelector('tbody tr[class*="TB_tr_"]', () => [])
  document.setSelector('[class*="TB_empty_"]', () => [new FakeElement({ text: 'empty' })])
  return document
}

test('apply_custom_range accepts already-populated custom range value', async () => {
  const result = await runScript({
    document: buildApplyCustomRangeDocument({ rangeValue: '2026-03-31 ~ 2026-03-31' }),
    params: {
      mode: 'new',
      time_range: '自定义',
      custom_range: { start: '2026-03-31', end: '2026-03-31' },
    },
    shared: {
      customRange: { start: '2026-03-31', end: '2026-03-31' },
      customRangeOpenAttempts: 1,
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta?.action, 'next_phase')
  assert.equal(result.meta?.next_phase, 'run_query')
})
