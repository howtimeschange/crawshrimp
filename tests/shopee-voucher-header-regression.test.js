const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

class FakeElement {
  constructor(options = {}) {
    this.tagName = String(options.tagName || 'DIV').toUpperCase()
    this._text = String(options.text || '')
    this._value = String(options.value || '')
    this._rect = options.rect || { x: 0, y: 0, width: 240, height: 40 }
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

  querySelectorAll() {
    return []
  }

  querySelector() {
    return null
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
  constructor() {
    this.body = new FakeElement({
      tagName: 'body',
      text: 'Shopee Marketing',
      rect: { x: 0, y: 0, width: 1920, height: 1080 },
    })
  }

  querySelectorAll() {
    return []
  }

  querySelector() {
    return null
  }

  contains(node) {
    return node === this.body
  }
}

function styleFor() {
  return {
    display: 'block',
    visibility: 'visible',
  }
}

async function runScript({ phase = 'prepare_row', page = 1, params, shared = {}, href = 'https://seller.shopee.cn/portal/marketing' }) {
  const scriptPath = path.resolve('adapters/shopee-plus-v2/voucher-create.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const document = new FakeDocument()
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

test('prepare_row tolerates mildly deformed voucher headers', async () => {
  const result = await runScript({
    params: {
      input_file: {
        rows: [
          {
            '站点/越南': '越南',
            '店铺/balabala2023.vn': 'balabala2023.vn',
            '优惠券领取期限（开始）精确到分/2026/5/1-01:00:00': '2026/5/1-01:00:00',
            '优惠券领取期限（结束）精确到分/2026/6/1-01:00:00': '2026/6/1-01:00:00',
            '是否提前显示\n优惠券（是：1/否：0）/1': '1',
            '优惠券品类/商店优惠券': '商店优惠券',
            '奖励类型/折扣': '折扣',
            '折扣类型/扣除百分比': '扣除百分比',
            '优惠限额/0.07': '0.07',
            '最高优惠金额(无限制填：nocap)/100000': '100000',
            '最低消费金额/99000': '99000',
            '可使用总数/700': '700',
            '每个买家可用的优惠券数量上限/5': '5',
            '是否覆盖已有券（如果有冲突日期券，则取消旧券以这次新建的为准；是：1/否：0）/0': '0',
          },
        ],
      },
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'ensure_marketing')
  assert.equal(result.meta.shared.result['站点'], '越南')
  assert.equal(result.meta.shared.result['店铺'], 'balabala2023.vn')
  assert.equal(result.meta.shared.result['优惠券品类'], '商店优惠券')
})

test('prepare_row prefers coupon name and code from the sheet when provided', async () => {
  const result = await runScript({
    params: {
      input_file: {
        rows: [
          {
            站点: '越南',
            店铺: 'balabala2023.vn',
            '优惠券名称（可选）': '越南新客满减券',
            '优惠码（可选）': 'a10z',
            '优惠券领取期限（开始）精确到分': '2026/5/1-01:00:00',
            '优惠券领取期限（结束）精确到分': '2026/6/1-01:00:00',
            '是否提前显示\n优惠券（是：1/否：0）': '1',
            优惠券品类: '新买家优惠券',
            奖励类型: '折扣',
            折扣类型: '扣除百分比',
            优惠限额: '0.07',
            '最高优惠金额(无限制填：nocap)': '100000',
            最低消费金额: '99000',
            可使用总数: '700',
            每个买家可用的优惠券数量上限: '5',
            '是否覆盖已有券（如果有冲突日期券，则取消旧券以这次新建的为准；是：1/否：0）': '0',
          },
        ],
      },
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.shared.result['生成优惠券名称'], '越南新客满减券')
  assert.equal(result.meta.shared.result['生成优惠码'], 'A10Z')
})

test('prepare_row generates a stronger default coupon name when the sheet omits it', async () => {
  const result = await runScript({
    params: {
      input_file: {
        rows: [
          {
            站点: '越南',
            店铺: 'balabala2023.vn',
            '优惠券领取期限（开始）精确到分': '2026/5/1-01:00:00',
            '优惠券领取期限（结束）精确到分': '2026/6/1-01:00:00',
            '是否提前显示\n优惠券（是：1/否：0）': '1',
            优惠券品类: '商店优惠券',
            奖励类型: '折扣',
            折扣类型: '扣除百分比',
            优惠限额: '0.07',
            '最高优惠金额(无限制填：nocap)': '100000',
            最低消费金额: '99000',
            可使用总数: '700',
            每个买家可用的优惠券数量上限: '5',
            '是否覆盖已有券（如果有冲突日期券，则取消旧券以这次新建的为准；是：1/否：0）': '0',
          },
        ],
      },
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.shared.result['生成优惠券名称'], '商店优惠券-扣除百分比7%-满99000-封顶100000-R1')
})
