import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

class DynamicElement {
  constructor(options = {}) {
    this.tagName = String(options.tagName || 'DIV').toUpperCase()
    this._className = options.className || ''
    this._text = options.text || ''
    this._value = options.value || ''
    this._rect = options.rect || { x: 0, y: 0, width: 240, height: 40 }
    this._selectors = new Map()
    this._attributes = new Map(Object.entries(options.attributes || {}))
    this.children = Array.isArray(options.children) ? options.children : []
    this.parentElement = options.parentElement || null
    this._closest = options.closest || null
  }

  get className() {
    return typeof this._className === 'function' ? this._className() : this._className
  }

  set className(value) {
    this._className = value
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

  set value(nextValue) {
    this._value = nextValue
  }

  getClientRects() {
    return this._rect.width && this._rect.height ? [this._rect] : []
  }

  getBoundingClientRect() {
    const { x, y, width, height } = this._rect
    return { left: x, top: y, width, height, right: x + width, bottom: y + height }
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

  contains(target) {
    return target === this
  }

  getAttribute(name) {
    return this._attributes.has(name) ? this._attributes.get(name) : null
  }

  setAttribute(name, value) {
    this._attributes.set(name, value)
    return this
  }

  scrollIntoView() {}
  focus() {}
  click() {}
  dispatchEvent() { return true }
}

class DynamicDocument {
  constructor(state) {
    this._selectors = new Map()
    this.body = new DynamicElement({
      tagName: 'body',
      text: () => (state.busy ? 'Too many visitors, please try again later.' : state.bodyText || ''),
      rect: { x: 0, y: 0, width: 1920, height: 1080 },
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

function styleFor() {
  return {
    display: 'block',
    visibility: 'visible',
    cursor: 'default',
    zIndex: '0',
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function formatLocalDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function buildStatefulDocument(state, { includeDateRange = false, rangeReactProps = null } = {}) {
  const document = new DynamicDocument(state)

  const makeRow = text => {
    const cell = new DynamicElement({ tagName: 'td', text })
    const row = new DynamicElement({ tagName: 'tr', className: 'TB_tr_mock', text })
    row.setSelector('td', [cell])
    return row
  }

  const table = new DynamicElement({
    tagName: 'table',
    text: () => `${(state.rows || []).join(' ')} 查看`,
  })
  table.setSelector('tbody tr[class*="TB_tr_"], tr[class*="TB_tr_"]', () => (state.rows || []).map(makeRow))
  table.setSelector('thead tr', [])

  const pagerRoot = new DynamicElement({
    tagName: 'div',
    text: () => `共有 ${state.totalCount || 0} 条 每页100条 ${state.pageNo || 1}`,
  })
  const activePage = new DynamicElement({
    tagName: 'li',
    className: 'PGT_pagerItemActive_mock',
    text: () => String(state.pageNo || 1),
  })
  const nextPage = new DynamicElement({
    tagName: 'li',
    className: () => (state.hasNext === false ? 'PGT_next_mock PGT_disabled_' : 'PGT_next_mock'),
    text: 'next',
    closest: () => pagerRoot,
  })
  pagerRoot.setSelector('li[class*="PGT_pagerItemActive_"]', () => [activePage])
  pagerRoot.setSelector('li[class*="PGT_next_"]', () => [nextPage])

  document.setSelector('table', () => [table])
  document.setSelector('li[class*="PGT_next_"]', () => [nextPage])
  document.setSelector('[class*="TB_empty_"]', () => (state.empty ? [new DynamicElement({ text: 'empty' })] : []))
  document.setSelector('[class*="Drawer_content_"]', [])
  document.setSelector('[class*="Drawer_outerWrapper_"]', [])

  if (state.activeGrain) {
    const activeGrain = new DynamicElement({
      tagName: 'div',
      className: 'TAB_capsule_mock TAB_active_',
      text: () => state.activeGrain,
    })
    document.setSelector('[class*="TAB_capsule_"][class*="TAB_active_"]', () => [activeGrain])
  } else {
    document.setSelector('[class*="TAB_capsule_"][class*="TAB_active_"]', [])
  }

  if (!includeDateRange) return document

  const rangeInput = new DynamicElement({
    tagName: 'input',
    value: () => state.dateRangeValue || '',
    attributes: { 'data-testid': 'beast-core-rangePicker-htmlInput' },
  })
  const rangeRoot = new DynamicElement({
    tagName: 'div',
    attributes: { 'data-testid': 'beast-core-rangePicker-input' },
  })
  rangeInput._closest = selector => {
    if (selector === '[data-testid="beast-core-rangePicker-input"]') return rangeRoot
    return null
  }
  rangeInput.parentElement = rangeRoot
  if (rangeReactProps) {
    rangeRoot.__reactFiber$mock = {
      memoizedProps: { value: state.dateRangeValue || '' },
      return: {
        get memoizedProps() {
          return typeof rangeReactProps === 'function' ? rangeReactProps() : rangeReactProps
        },
        return: null,
      },
    }
  }
  rangeRoot.setSelector('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]', () => [rangeInput])

  const label = new DynamicElement({ tagName: 'div', text: '统计日期' })
  const row = new DynamicElement({ tagName: 'div', className: 'index-module__row___' })
  row.setSelector('div, label, span', () => [label])
  row.setSelector('[data-testid="beast-core-rangePicker-input"], [class*="RPR_inputWrapper_"]', () => [rangeRoot])
  row.setSelector('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]', () => [rangeInput])

  document.setSelector('div[class*="index-module__row___"]', () => [row])
  document.setSelector('[data-testid="beast-core-rangePicker-input"], [class*="RPR_inputWrapper_"]', () => [rangeRoot])
  document.setSelector('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]', () => [rangeInput])
  document.__rangeInput = rangeInput
  document.__rangeRoot = rangeRoot

  return document
}

function buildSinglePickerDocument(state, { pickerKind = 'week', pickerReactProps } = {}) {
  const document = new DynamicDocument(state)
  const testId = pickerKind === 'month'
    ? 'beast-core-monthPicker-htmlInput'
    : 'beast-core-weekPicker-htmlInput'
  const className = pickerKind === 'month'
    ? 'IPT_input_mock MPR_input_mock'
    : 'IPT_input_mock RPR_input_mock'
  const wrapperClassName = pickerKind === 'month'
    ? 'IPT_inputWrapper_mock MPR_inputWrapper_mock'
    : 'IPT_inputWrapper_mock RPR_inputWrapper_mock'

  const input = new DynamicElement({
    tagName: 'input',
    value: () => state.pickerValue || '',
    className,
    attributes: { 'data-testid': testId },
  })
  const wrapper = new DynamicElement({
    tagName: 'div',
    className: wrapperClassName,
    attributes: { 'data-testid': 'beast-core-input' },
  })
  input._closest = selector => {
    if (selector === '[data-testid]') return wrapper
    return null
  }
  input.parentElement = wrapper
  wrapper.__reactFiber$mock = {
    memoizedProps: {
      onChange() {},
      value: state.pickerValue || '',
    },
    return: {
      get memoizedProps() {
        return typeof pickerReactProps === 'function' ? pickerReactProps() : pickerReactProps
      },
      return: null,
    },
  }

  document.setSelector(
    pickerKind === 'month'
      ? 'input[data-testid="beast-core-monthPicker-htmlInput"], input[class*="MPR_input_"]'
      : 'input[data-testid="beast-core-weekPicker-htmlInput"], input[class*="WPR_input_"]',
    () => [input],
  )
  document.setSelector('[class*="TAB_capsule_"][class*="TAB_active_"]', () => [
    new DynamicElement({
      tagName: 'div',
      className: 'TAB_capsule_mock TAB_active_',
      text: () => state.activeGrain || '',
    }),
  ])
  document.__singlePickerInput = input
  document.__singlePickerWrapper = wrapper
  return document
}

async function loadHook(scriptRelativePath, exportNames, options = {}) {
  const scriptPath = path.resolve(scriptRelativePath)
  const originalSource = fs.readFileSync(scriptPath, 'utf8')
  const marker = "  try {\n    if (phase === 'main') {"
  const exposeBlock = [
    '  if (window.__CRAWSHRIMP_TEST_HOOK__) {',
    '    Object.assign(window.__CRAWSHRIMP_TEST_HOOK__, {',
    ...exportNames.map(name => `      ${name},`),
    '    })',
    '  }',
    '',
    "  try {\n    if (phase === 'main') {",
  ].join('\n')
  assert.ok(originalSource.includes(marker), `Hook marker missing in ${scriptRelativePath}`)
  const instrumentedSource = originalSource.replace(marker, exposeBlock)

  const hook = {}
  const href = options.href || 'https://agentseller.temu.com/main/act/data-full'
  const timerSetTimeout = options.setTimeout || setTimeout
  const timerClearTimeout = options.clearTimeout || clearTimeout
  const RuntimeDate = options.Date || Date
  const location = {
    href,
    hostname: new URL(href).hostname,
  }
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: options.params || {},
      __CRAWSHRIMP_PHASE__: options.phase || 'noop',
      __CRAWSHRIMP_SHARED__: options.shared || {},
      __CRAWSHRIMP_PAGE__: 1,
      __CRAWSHRIMP_TEST_HOOK__: hook,
      HTMLInputElement: class HTMLInputElement {},
      ...(options.windowProps || {}),
    },
    document: options.document || new DynamicDocument({ bodyText: '' }),
    location,
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
    setTimeout: timerSetTimeout,
    clearTimeout: timerClearTimeout,
    Promise,
    Date: RuntimeDate,
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
  await vm.runInNewContext(instrumentedSource, context, { filename: scriptPath })
  return { hook, context }
}

async function runScript(scriptRelativePath, options = {}) {
  const scriptPath = path.resolve(scriptRelativePath)
  const source = fs.readFileSync(scriptPath, 'utf8')
  const href = options.href || 'https://agentseller.temu.com/main/act/data-full'
  const timerSetTimeout = options.setTimeout || setTimeout
  const timerClearTimeout = options.clearTimeout || clearTimeout
  const RuntimeDate = options.Date || Date
  const location = {
    href,
    hostname: new URL(href).hostname,
  }
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: options.params || {},
      __CRAWSHRIMP_PHASE__: options.phase || 'noop',
      __CRAWSHRIMP_SHARED__: options.shared || {},
      __CRAWSHRIMP_PAGE__: 1,
      HTMLInputElement: class HTMLInputElement {},
      ...(options.windowProps || {}),
    },
    document: options.document || new DynamicDocument({ bodyText: '' }),
    location,
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
    setTimeout: timerSetTimeout,
    clearTimeout: timerClearTimeout,
    Promise,
    Date: RuntimeDate,
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

function createWebpackChunkRuntime(moduleFactory) {
  const req = id => moduleFactory(String(id))
  return {
    push(payload) {
      if (Array.isArray(payload) && typeof payload[2] === 'function') {
        payload[2](req)
      }
      return 1
    },
  }
}

function createMicrotaskTimers() {
  let nextId = 1
  const pending = new Set()
  return {
    setTimeout(handler, ...args) {
      const id = nextId
      nextId += 1
      pending.add(id)
      Promise.resolve().then(() => {
        if (!pending.has(id)) return
        pending.delete(id)
        handler(...args)
      })
      return id
    },
    clearTimeout(id) {
      pending.delete(id)
    },
  }
}

function buildGoodsTrafficSkeletonDocument(state = {}) {
  const document = new DynamicDocument({
    bodyText: state.bodyText || '商品明细 商品流量列表',
    busy: !!state.busy,
  })

  const makeCell = text => new DynamicElement({ tagName: 'td', text })
  const makeRow = text => {
    const row = new DynamicElement({ tagName: 'tr', className: 'TB_tr_mock', text })
    row.setSelector('td', [makeCell(text)])
    return row
  }

  const headerRow = new DynamicElement({
    tagName: 'tr',
    children: [
      new DynamicElement({ tagName: 'th', text: '商品信息' }),
      new DynamicElement({ tagName: 'th', text: '流量情况' }),
      new DynamicElement({ tagName: 'th', text: '增长潜力' }),
      new DynamicElement({ tagName: 'th', text: '操作' }),
    ],
  })

  const table = new DynamicElement({
    tagName: 'table',
    text: () => `商品信息 流量情况 增长潜力 操作 ${(state.rows || []).join(' ')}`,
  })
  table.setSelector('thead tr', () => [headerRow])
  table.setSelector('tbody tr[class*="TB_tr_"], tr[class*="TB_tr_"]', () => (state.rows || []).map(makeRow))

  const siteNode = new DynamicElement({
    tagName: 'a',
    text: state.siteText || '全球',
    className: 'index-module__drItem___ index-module__active___',
  })
  const queryButton = new DynamicElement({ tagName: 'button', text: '查询' })
  const resetButton = new DynamicElement({ tagName: 'button', text: '重置' })

  document.setSelector('table', () => [table])
  document.setSelector('a[class*="index-module__drItem___"]', () => [siteNode])
  document.setSelector('button', () => [queryButton, resetButton])
  document.setSelector('[class*="TB_empty_"]', () => (state.empty ? [new DynamicElement({ text: 'empty' })] : []))
  document.setSelector('[class*="Drawer_content_"]', [])
  document.setSelector('[class*="Drawer_outerWrapper_"]', [])
  document.setSelector('[class*="TAB_capsule_"][class*="TAB_active_"]', [])
  document.setSelector('li[class*="PGT_next_"]', [])

  return document
}

async function assertStrictPageTurn(scriptRelativePath, href) {
  const state = {
    pageNo: 1,
    rows: ['page1-row-a', 'page1-row-b'],
    totalCount: 200,
    bodyText: '列表内容',
  }
  const document = buildStatefulDocument(state)
  const { hook } = await loadHook(scriptRelativePath, ['getListPageSignature', 'waitListPageChange'], {
    href,
    document,
  })

  const oldSignature = hook.getListPageSignature()
  const pageTurnPromise = hook.waitListPageChange(oldSignature, 1, 1400, 2)

  setTimeout(() => {
    state.pageNo = 2
  }, 20)
  setTimeout(() => {
    state.rows = ['page2-row-a', 'page2-row-b']
  }, 520)

  const earlyResult = await Promise.race([
    pageTurnPromise.then(() => 'resolved'),
    sleep(350).then(() => 'timeout'),
  ])

  assert.equal(earlyResult, 'timeout')
  assert.equal(await pageTurnPromise, true)
}

test('activity-data waits for row refresh after pager number changes', async () => {
  await assertStrictPageTurn('adapters/temu/activity-data.js', 'https://agentseller.temu.com/main/act/data-full')
})

test('mall-flux waits for row refresh after pager number changes', async () => {
  await assertStrictPageTurn('adapters/temu/mall-flux.js', 'https://agentseller.temu.com/main/mall-flux-analysis-full')
})

test('goods-traffic-list waits for row refresh after pager number changes', async () => {
  await assertStrictPageTurn('adapters/temu/goods-traffic-list.js', 'https://agentseller.temu.com/main/flux-analysis-full')
})

test('goods-traffic-list prefers visible empty state over stale busy warning', async () => {
  const state = {
    pageNo: 1,
    rows: [],
    totalCount: 0,
    bodyText: '商品流量列表',
    busy: true,
    empty: true,
  }
  const document = buildStatefulDocument(state)

  const buttonQuery = new DynamicElement({ tagName: 'button', text: '查询' })
  const buttonReset = new DynamicElement({ tagName: 'button', text: '重置' })
  document.setSelector('button', () => [buttonQuery, buttonReset])

  const { hook } = await loadHook(
    'adapters/temu/goods-traffic-list.js',
    ['waitForListReady'],
    {
      href: 'https://agentseller.temu.com/main/flux-analysis-full',
      document,
    },
  )

  const readyState = await hook.waitForListReady(200)
  assert.equal(readyState.ready, true)
  assert.equal(readyState.empty, true)
  assert.equal(readyState.busy, false)

  const result = await runScript('adapters/temu/goods-traffic-list.js', {
    phase: 'after_list_page_turn',
    href: 'https://agentseller.temu.com/main/flux-analysis-full',
    document,
    shared: {
      currentOuterSite: '全球',
      targetOuterSites: ['全球'],
      lastCollectedPageNo: 1,
      listBusyRetry: 0,
      listPageRetry: 0,
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'collect')
})

test('goods-traffic-list query wait requires refreshed evidence beyond stale empty baseline', async () => {
  const state = {
    pageNo: 1,
    rows: [],
    totalCount: 0,
    bodyText: '商品流量列表',
    empty: true,
  }
  const document = buildStatefulDocument(state)
  const { hook } = await loadHook(
    'adapters/temu/goods-traffic-list.js',
    ['getListPageSignature', 'waitForQueryResultRefresh'],
    {
      href: 'https://agentseller.temu.com/main/flux-analysis-full',
      document,
    },
  )

  const baseline = {
    signature: hook.getListPageSignature(),
  }
  const refreshPromise = hook.waitForQueryResultRefresh(baseline, 2200, 1600)

  const earlyResult = await Promise.race([
    refreshPromise.then(() => 'resolved'),
    sleep(350).then(() => 'timeout'),
  ])
  assert.equal(earlyResult, 'timeout')

  setTimeout(() => {
    state.empty = false
    state.totalCount = 2
    state.rows = ['page1-row-a', 'page1-row-b']
  }, 520)

  const refreshed = await refreshPromise
  assert.equal(refreshed.ready, true)
  assert.equal(refreshed.signatureChanged, true)
  assert.equal(refreshed.rows.length, 2)
})

test('goods-traffic-list builds api payload from filters', async () => {
  const document = buildStatefulDocument({
    bodyText: '商品流量列表',
    activeGrain: '今日',
  })
  const { hook } = await loadHook(
    'adapters/temu/goods-traffic-list.js',
    ['buildListApiRequestPayload'],
    {
      href: 'https://agentseller.temu.com/main/flux-analysis-full',
      document,
      params: {
        list_time_range: '近7日',
        quick_filter: '短期增长中',
        product_id_type: 'SPU',
        product_id_query: '123 456，789',
        goods_no_type: 'SKU货号',
        goods_no_query: 'SKU-A, SKU-B',
        product_name: '卫衣',
      },
    },
  )

  const payload = JSON.parse(JSON.stringify(hook.buildListApiRequestPayload(3, 40, { categoryLeafId: 9988 })))
  assert.deepEqual(payload, {
    pageSize: 40,
    pageNum: 3,
    timeDimension: 3,
    quickFilterType: 2,
    productIdList: [123, 456, 789],
    skuExtCodeList: ['SKU-A', 'SKU-B'],
    catIdList: [9988],
    goodsName: '卫衣',
  })
})

test('goods-traffic-list api payload falls back to current active time capsule', async () => {
  const document = buildStatefulDocument({
    bodyText: '商品流量列表',
    activeGrain: '本月',
  })
  const { hook } = await loadHook(
    'adapters/temu/goods-traffic-list.js',
    ['resolveTimeDimensionState', 'buildListApiRequestPayload'],
    {
      href: 'https://agentseller.temu.com/main/flux-analysis-full',
      document,
      params: {},
    },
  )

  const timeState = hook.resolveTimeDimensionState({})
  assert.equal(timeState.label, '本月')
  assert.equal(timeState.value, 6)
  assert.equal(hook.buildListApiRequestPayload(1, 40, {}).timeDimension, 6)
})

test('goods-traffic-list maps every explicit time label to the expected api dimension', async () => {
  const labelMap = new Map([
    ['昨日', 1],
    ['今日', 2],
    ['近7日', 3],
    ['近30日', 4],
    ['本周', 5],
    ['本月', 6],
  ])

  for (const [label, value] of labelMap.entries()) {
    const { hook } = await loadHook(
      'adapters/temu/goods-traffic-list.js',
      ['resolveTimeDimensionState', 'buildListApiRequestPayload'],
      {
        href: 'https://agentseller.temu.com/main/flux-analysis-full',
        document: buildStatefulDocument({ bodyText: '商品流量列表', activeGrain: '今日' }),
        params: { list_time_range: label },
      },
    )

    const timeState = hook.resolveTimeDimensionState({})
    assert.equal(timeState.label, label)
    assert.equal(timeState.value, value)
    assert.equal(hook.buildListApiRequestPayload(1, 100, {}).timeDimension, value)
  }
})

test('goods-traffic-list carries switched outer-site context into the next phase', async () => {
  const document = buildStatefulDocument({
    bodyText: '商品明细 商品流量列表',
    activeGrain: '今日',
    rows: ['row-a'],
    pageNo: 1,
    totalCount: 1,
  })
  const siteGlobal = new DynamicElement({
    tagName: 'a',
    text: '全球',
    className: 'index-module__drItem___ index-module__active___',
  })
  const siteUs = new DynamicElement({
    tagName: 'a',
    text: '美国',
    className: 'index-module__drItem___',
  })
  const queryButton = new DynamicElement({ tagName: 'button', text: '查询' })
  const resetButton = new DynamicElement({ tagName: 'button', text: '重置' })
  document.setSelector('a[class*="index-module__drItem___"]', () => [siteGlobal, siteUs])
  document.setSelector('button', () => [queryButton, resetButton])

  const result = await runScript('adapters/temu/goods-traffic-list.js', {
    phase: 'after_outer_site_switch',
    href: 'https://agentseller-us.temu.com/main/flux-analysis-full',
    document,
    shared: {
      targetOuterSite: '美国',
      targetOuterSites: ['全球', '美国', '欧区'],
      currentOuterSite: '全球',
      resume_phase: 'prepare_current_site',
      listBusyRetry: 3,
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'prepare_current_site')
  assert.equal(result.meta.shared.currentOuterSite, '美国')
  assert.equal(result.meta.shared.switchedOuterSite, true)
  assert.equal(result.meta.shared.listBusyRetry, 0)
})

test('goods-traffic-list resolves outer-site from hostname when url-driven switch is in progress', async () => {
  const { hook } = await loadHook(
    'adapters/temu/goods-traffic-list.js',
    ['getResolvedOuterSite', 'getOuterSiteUrl'],
    {
      href: 'https://agentseller-eu.temu.com/main/flux-analysis-full',
      document: buildStatefulDocument({ bodyText: '商品流量列表', activeGrain: '今日' }),
    },
  )

  assert.equal(hook.getResolvedOuterSite(), '欧区')
  assert.equal(hook.getOuterSiteUrl('美国'), 'https://agentseller-us.temu.com/main/flux-analysis-full')
})

test('goods-traffic-list preserves explicit time-range state when advancing to the next outer site', async () => {
  const document = buildStatefulDocument({
    bodyText: '商品明细 商品流量列表',
    activeGrain: '昨日',
    rows: ['row-a'],
    pageNo: 6,
    totalCount: 593,
  })
  const siteGlobal = new DynamicElement({
    tagName: 'a',
    text: '全球',
    className: 'index-module__drItem___ index-module__active___',
  })
  const siteUs = new DynamicElement({
    tagName: 'a',
    text: '美国',
    className: 'index-module__drItem___',
  })
  const siteEu = new DynamicElement({
    tagName: 'a',
    text: '欧区',
    className: 'index-module__drItem___',
  })
  const queryButton = new DynamicElement({ tagName: 'button', text: '查询' })
  const resetButton = new DynamicElement({ tagName: 'button', text: '重置' })
  document.setSelector('a[class*="index-module__drItem___"]', () => [siteGlobal, siteUs, siteEu])
  document.setSelector('button', () => [queryButton, resetButton])

  const result = await runScript('adapters/temu/goods-traffic-list.js', {
    phase: 'advance_cursor',
    href: 'https://agentseller.temu.com/main/flux-analysis-full',
    document,
    shared: {
      targetOuterSites: ['全球', '美国', '欧区'],
      currentOuterSite: '全球',
      currentPageNo: 6,
      totalPages: 6,
      timeDimension: 2,
      timeDimensionLabel: '今日',
      categoryLeafId: 9988,
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'after_outer_site_switch')
  assert.equal(result.meta.shared.targetOuterSite, '美国')
  assert.equal(result.meta.shared.timeDimension, 2)
  assert.equal(result.meta.shared.timeDimensionLabel, '今日')
  assert.equal(result.meta.shared.categoryLeafId, 9988)
})

test('goods-traffic-list preserves explicit time-range state when switching to the first requested outer site', async () => {
  const document = buildStatefulDocument({
    bodyText: '商品明细 商品流量列表',
    activeGrain: '昨日',
    rows: ['row-a'],
    pageNo: 1,
    totalCount: 1,
  })
  const siteGlobal = new DynamicElement({
    tagName: 'a',
    text: '全球',
    className: 'index-module__drItem___',
  })
  const siteUs = new DynamicElement({
    tagName: 'a',
    text: '美国',
    className: 'index-module__drItem___ index-module__active___',
  })
  const siteEu = new DynamicElement({
    tagName: 'a',
    text: '欧区',
    className: 'index-module__drItem___',
  })
  const queryButton = new DynamicElement({ tagName: 'button', text: '查询' })
  const resetButton = new DynamicElement({ tagName: 'button', text: '重置' })
  document.setSelector('a[class*="index-module__drItem___"]', () => [siteGlobal, siteUs, siteEu])
  document.setSelector('button', () => [queryButton, resetButton])

  const result = await runScript('adapters/temu/goods-traffic-list.js', {
    phase: 'ensure_target',
    href: 'https://agentseller-us.temu.com/main/flux-analysis-full',
    document,
    params: {
      outer_sites: ['全球', '美国', '欧区'],
      list_time_range: '今日',
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'after_outer_site_switch')
  assert.equal(result.meta.shared.targetOuterSite, '全球')
  assert.equal(result.meta.shared.timeDimension, 2)
  assert.equal(result.meta.shared.timeDimensionLabel, '今日')
})

test('goods-traffic-list captures the current shop name from the strict account header', async () => {
  const document = buildStatefulDocument({
    bodyText: '商品明细 商品流量列表',
    activeGrain: '今日',
    rows: ['row-a'],
    pageNo: 1,
    totalCount: 1,
  })
  const siteGlobal = new DynamicElement({
    tagName: 'a',
    text: '全球',
    className: 'index-module__drItem___ index-module__active___',
  })
  const queryButton = new DynamicElement({ tagName: 'button', text: '查询' })
  const resetButton = new DynamicElement({ tagName: 'button', text: '重置' })
  const strictShop = new DynamicElement({
    tagName: 'div',
    className: 'account-info_mallInfo__mock',
    text: 'Balabala Official Shop 123 人关注',
  })
  const staleShop = new DynamicElement({
    tagName: 'div',
    className: 'elli_outerWrapper__mock',
    text: 'SEMIR Official Shop',
  })
  const userRoot = new DynamicElement({ tagName: 'div', className: 'account-info_userInfo__mock' })
  userRoot.setSelector('[class*="account-info_mallInfo__"], [class*="account-info_accountInfo__"], [class*="elli_outerWrapper"], [class*="shopName"], [class*="seller-name"]', () => [staleShop])
  userRoot.setSelector('*', () => [staleShop])

  document.setSelector('a[class*="index-module__drItem___"]', () => [siteGlobal])
  document.setSelector('button', () => [queryButton, resetButton])
  document.setSelector('[class*="account-info_mallInfo__"], [class*="account-info_accountInfo__"]', () => [strictShop])
  document.setSelector('[class*="userInfo"], [class*="seller-name"], [class*="account-info_userInfo"]', () => [userRoot])

  const result = await runScript('adapters/temu/goods-traffic-list.js', {
    phase: 'ensure_target',
    href: 'https://agentseller.temu.com/main/flux-analysis-full',
    document,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'prepare_current_site')
  assert.equal(result.meta.shared.shopName, 'Balabala Official Shop')
})

test('goods-traffic-list exposes conservative retry and collect pacing helpers', async () => {
  const { hook } = await loadHook(
    'adapters/temu/goods-traffic-list.js',
    ['getListApiRetryBackoffMs', 'getListApiCollectDelayMs', 'getListPageRecoveryCooldownMs'],
    {
      href: 'https://agentseller.temu.com/main/flux-analysis-full',
      document: buildStatefulDocument({ bodyText: '商品流量列表', activeGrain: '今日' }),
    },
  )

  assert.equal(
    hook.getListApiRetryBackoffMs({ errorCode: 4000004, errorMsg: 'Too many visitors, please try again later.' }, 1),
    20000,
  )
  assert.equal(
    hook.getListApiRetryBackoffMs({ errorCode: 40002, errorMsg: 'Network Timeout, Please Try Again Later' }, 2),
    30000,
  )
  assert.equal(hook.getListApiCollectDelayMs({ lastApiAttempt: 1 }, {}), 12000)
  assert.equal(hook.getListApiCollectDelayMs({ lastApiAttempt: 3 }, {}), 28000)
  assert.equal(hook.getListApiCollectDelayMs({ lastApiAttempt: 1 }, { nextPageNo: 3 }), 72000)
  assert.equal(
    hook.getListApiCollectDelayMs({ switchedOuterSite: true, lastApiAttempt: 1 }, { afterSiteSwitch: true }),
    15000,
  )
  assert.equal(
    hook.getListApiCollectDelayMs({ pendingCollectDelayMs: 20000, recoveredListPage: true }, { afterRecovery: true }),
    20000,
  )
  assert.equal(
    hook.getListPageRecoveryCooldownMs({ listPageRetry: 1 }, '商品流量列表 API 抓取失败：Network Timeout'),
    40000,
  )
})

test('goods-traffic-list collect phase retries retriable api errors in the next phase', async () => {
  const timers = createMicrotaskTimers()
  const result = await runScript('adapters/temu/goods-traffic-list.js', {
    phase: 'collect',
    href: 'https://agentseller.temu.com/main/flux-analysis-full',
    document: buildStatefulDocument({ bodyText: '商品流量列表', activeGrain: '今日' }),
    shared: {
      currentOuterSite: '全球',
      targetOuterSites: ['全球'],
      currentPageNo: 3,
      lastApiAttempt: 1,
      timeDimension: 2,
      timeDimensionLabel: '今日',
    },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    windowProps: {
      chunkLoadingGlobal_bgb_sca_main: createWebpackChunkRuntime(id => {
        if (id === '3204') {
          return {
            bE: async () => {
              throw {
                errorCode: 40002,
                errorMsg: 'Network Timeout, Please Try Again Later',
              }
            },
          }
        }
        throw new Error(`unknown module ${id}`)
      }),
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'collect')
  assert.equal(result.meta.sleep_ms, 15000)
  assert.equal(result.meta.shared.currentPageNo, 3)
  assert.equal(result.meta.shared.lastApiAttempt, 2)
})

test('goods-traffic-list recover_list_page waits for real list readiness before continuing', async () => {
  const state = {
    rows: [],
    bodyText: '商品明细 商品流量列表',
  }
  const document = buildGoodsTrafficSkeletonDocument(state)
  const resultPromise = runScript('adapters/temu/goods-traffic-list.js', {
    phase: 'recover_list_page',
    href: 'https://agentseller.temu.com/main/flux-analysis-full',
    document,
    shared: {
      recoverOuterSite: '全球',
      currentOuterSite: '全球',
      recoverPageNo: 5,
    },
  })

  setTimeout(() => {
    state.rows = ['page5-row-a']
  }, 520)

  const earlyResult = await Promise.race([
    resultPromise.then(() => 'resolved'),
    sleep(350).then(() => 'timeout'),
  ])

  assert.equal(earlyResult, 'timeout')

  const result = await resultPromise
  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'recover_list_page_prepare')
})

test('goods-traffic-list restore_list_page resets api retry budget after recovery', async () => {
  const result = await runScript('adapters/temu/goods-traffic-list.js', {
    phase: 'restore_list_page',
    href: 'https://agentseller.temu.com/main/flux-analysis-full',
    document: buildStatefulDocument({ bodyText: '商品流量列表', activeGrain: '近7日' }),
    shared: {
      currentOuterSite: '全球',
      recoverOuterSite: '全球',
      recoverPageNo: 9,
      lastApiAttempt: 4,
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'collect')
  assert.equal(result.meta.shared.lastApiAttempt, 1)
})

test('goods-traffic-list collect phase reads rows from api helper and tracks pagination', async () => {
  const windowProps = {
    chunkLoadingGlobal_bgb_sca_main: createWebpackChunkRuntime(id => {
      if (id === '3204') {
        return {
          bE: async (endpoint, payload) => {
            assert.equal(endpoint, '/api/seller/full/flow/analysis/goods/list')
            assert.equal(payload.pageSize, 500)
            assert.equal(payload.pageNum, 2)
            assert.equal(payload.timeDimension, 2)
            assert.equal(payload.quickFilterType, 1)
            return {
              total: 1281,
              updateAt: 1776047296966,
              list: [
                {
                  goodsName: '测试商品A',
                  goodsImageUrl: 'https://img.example.com/a.jpg',
                  category: { cat1Name: '服装', cat2Name: '上衣' },
                  productSpuId: 1234567890,
                  exposeNum: 100,
                  clickNum: 10,
                  goodsDetailVisitorNum: 9,
                  goodsDetailVisitNum: 12,
                  addToCartUserNum: 2,
                  collectUserNum: 1,
                  payGoodsNum: 3,
                  payOrderNum: 2,
                  buyerNum: 2,
                  exposePayConversionRate: 0.03,
                  exposeClickConversionRate: 0.1,
                  clickPayConversionRate: 0.3,
                  searchExposeNum: 50,
                  searchClickNum: 5,
                  searchPayOrderNum: 1,
                  searchPayGoodsNum: 1,
                  recommendExposeNum: 40,
                  recommendClickNum: 4,
                  recommendPayOrderNum: 1,
                  recommendPayGoodsNum: 2,
                  growDataText: '流量待增长',
                },
              ],
            }
          },
        }
      }
      throw new Error(`unknown module ${id}`)
    }),
  }

  const result = await runScript('adapters/temu/goods-traffic-list.js', {
    phase: 'collect',
    href: 'https://agentseller.temu.com/main/flux-analysis-full',
    document: buildStatefulDocument({ bodyText: '商品流量列表', activeGrain: '今日' }),
    params: {
      list_time_range: '今日',
      quick_filter: '流量待增长',
    },
    shared: {
      currentOuterSite: '全球',
      targetOuterSites: ['全球', '美国'],
      currentPageNo: 2,
      timeDimension: 2,
      timeDimensionLabel: '今日',
    },
    windowProps,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.meta.has_more, true)
  assert.equal(result.meta.shared.totalPages, 3)
  assert.equal(result.meta.shared.lastApiAttempt, 1)
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].SPU, '1234567890')
  assert.equal(result.data[0]['商品分类'], '服装 > 上衣')
  assert.equal(result.data[0]['转化情况/点击率'], '10.00%')
  assert.equal(result.data[0]['操作'], '查看详情')
})

test('activity-data date filter wait requires refreshed evidence beyond input echo', async () => {
  const state = {
    pageNo: 1,
    rows: ['same-page-row-a', 'same-page-row-b'],
    totalCount: 800,
    bodyText: '统计时间段：2026-04-04～2026-04-10 活动数据列表',
    dateRangeValue: '2026-04-01 ~ 2026-04-10',
  }
  const document = buildStatefulDocument(state, { includeDateRange: true })
  const { hook } = await loadHook(
    'adapters/temu/activity-data.js',
    ['getListPageSignature', 'waitForDateFilteredList', 'appendUniqueRows', 'buildRowDedupeKey'],
    {
      href: 'https://agentseller.temu.com/main/act/data-full',
      document,
    },
  )

  const baseline = {
    signature: hook.getListPageSignature(),
    totalCount: 800,
    inputRange: '2026-04-01 ~ 2026-04-10',
    summaryRange: '2026-04-04 ~ 2026-04-10',
  }
  const filteredPromise = hook.waitForDateFilteredList('2026-04-01', '2026-04-10', baseline, 1800)

  setTimeout(() => {
    state.bodyText = '统计时间段：2026-04-01～2026-04-10'
  }, 80)

  setTimeout(() => {
    state.totalCount = 744
  }, 520)

  const earlyResult = await Promise.race([
    filteredPromise.then(() => 'resolved'),
    sleep(450).then(() => 'timeout'),
  ])

  assert.equal(earlyResult, 'timeout')
  assert.equal(await filteredPromise, true)

  const previousRow = {
    外层站点: '全球',
    活动类型: '秒杀',
    活动主题: '夏季活动',
    统计日期范围: '2026-04-01 ~ 2026-04-10',
    商品名称: '同款商品',
    SPU: '123456',
    商品信息: '同款商品 SPU ID: 123456',
    活动成交额: '100',
  }
  const sameSpuDifferentActivity = {
    ...previousRow,
    活动主题: '秋季活动',
    商品信息: '同款商品 SPU ID: 123456 秋季活动',
  }

  const deduped = hook.appendUniqueRows([
    { ...previousRow, 列表页码: 2, 列表行号: 1, 抓取时间: '2026-04-10 19:00:55' },
    { ...sameSpuDifferentActivity, 列表页码: 2, 列表行号: 2, 抓取时间: '2026-04-10 19:00:56' },
    { ...sameSpuDifferentActivity, 列表页码: 2, 列表行号: 3, 抓取时间: '2026-04-10 19:00:57' },
  ], {
    seenRowKeys: [hook.buildRowDedupeKey(previousRow)],
  })

  assert.equal(deduped.rows.length, 1)
  assert.equal(deduped.rows[0].活动主题, '秋季活动')
  assert.equal(deduped.skipped, 2)
})

test('activity-data resolves stat date range from input when summary is stale', async () => {
  const state = {
    pageNo: 1,
    rows: ['same-page-row-a', 'same-page-row-b'],
    totalCount: 76,
    bodyText: '统计时间段：2026-04-01～2026-04-07 活动数据列表',
    dateRangeValue: '2026-04-04 ~ 2026-04-10',
  }
  const document = buildStatefulDocument(state, { includeDateRange: true })
  const { hook } = await loadHook(
    'adapters/temu/activity-data.js',
    ['getResolvedStatDateRangeValue'],
    {
      href: 'https://agentseller-us.temu.com/main/act/data-full',
      document,
    },
  )
  assert.equal(hook.getResolvedStatDateRangeValue(), '2026-04-04 ~ 2026-04-10')
})

test('mall-flux resolves single week and month params into concrete date ranges', async () => {
  const { hook: weekHook } = await loadHook(
    'adapters/temu/mall-flux.js',
    ['resolveRequestedStatGrain', 'resolveRequestedStatRange'],
    {
      href: 'https://agentseller.temu.com/main/mall-flux-analysis-full',
      params: {
        stat_grain: '按周',
        stat_week: '2026-W14',
      },
    },
  )

  assert.equal(weekHook.resolveRequestedStatGrain(), '按周')
  const weekRange = weekHook.resolveRequestedStatRange()
  assert.equal(weekRange.start, '2026-03-30')
  assert.equal(weekRange.end, '2026-04-05')

  const { hook: monthHook } = await loadHook(
    'adapters/temu/mall-flux.js',
    ['resolveRequestedStatGrain', 'resolveRequestedStatRange'],
    {
      href: 'https://agentseller.temu.com/main/mall-flux-analysis-full',
      params: {
        stat_grain: '按月',
        stat_month: '2026-03',
      },
    },
  )

  assert.equal(monthHook.resolveRequestedStatGrain(), '按月')
  const monthRange = monthHook.resolveRequestedStatRange()
  assert.equal(monthRange.start, '2026-03-01')
  assert.equal(monthRange.end, '2026-03-31')
})

test('mall-flux finds higher-level date picker react props for week and month inputs', async () => {
  const weekState = {
    bodyText: '店铺流量',
    activeGrain: '按周',
    pickerValue: '2026 第 14 周',
  }
  const weekPickerProps = {
    value: new Date('2026-04-03T00:00:00'),
    onChange() {},
  }
  const weekDocument = buildSinglePickerDocument(weekState, {
    pickerKind: 'week',
    pickerReactProps: weekPickerProps,
  })
  const { hook: weekHook } = await loadHook(
    'adapters/temu/mall-flux.js',
    ['getWeekPickerInput', 'getDateValuePickerReactPropsFromInput', 'resolveWeekPickerTargetDate'],
    {
      href: 'https://agentseller.temu.com/main/mall-flux-analysis-full',
      document: weekDocument,
    },
  )

  const weekProps = weekHook.getDateValuePickerReactPropsFromInput(weekHook.getWeekPickerInput())
  assert.equal(typeof weekProps?.onChange, 'function')
  assert.equal(weekProps?.value?.getFullYear(), 2026)
  assert.equal(formatLocalDate(weekHook.resolveWeekPickerTargetDate('2026-W13')), '2026-03-26')

  const monthState = {
    bodyText: '店铺流量',
    activeGrain: '按月',
    pickerValue: '2026年03月',
  }
  const monthPickerProps = {
    value: new Date('2026-03-31T00:00:00'),
    onChange() {},
  }
  const monthDocument = buildSinglePickerDocument(monthState, {
    pickerKind: 'month',
    pickerReactProps: monthPickerProps,
  })
  const { hook: monthHook } = await loadHook(
    'adapters/temu/mall-flux.js',
    ['getMonthPickerInput', 'getDateValuePickerReactPropsFromInput', 'resolveMonthPickerTargetDate'],
    {
      href: 'https://agentseller.temu.com/main/mall-flux-analysis-full',
      document: monthDocument,
    },
  )

  const monthProps = monthHook.getDateValuePickerReactPropsFromInput(monthHook.getMonthPickerInput())
  assert.equal(typeof monthProps?.onChange, 'function')
  assert.equal(monthProps?.value?.getMonth(), 2)
  assert.equal(formatLocalDate(monthHook.resolveMonthPickerTargetDate('2026-02')), '2026-02-01')
})

test('mall-flux injects week and month picker values through date picker onChange', async () => {
  const weekState = {
    bodyText: '店铺流量',
    activeGrain: '按周',
    pickerValue: '2026 第 14 周',
  }
  const weekPickerProps = {
    value: new Date('2026-04-03T00:00:00'),
    onChange(nextDate) {
      const day = formatLocalDate(nextDate)
      if (day === '2026-03-26') weekState.pickerValue = '2026 第 13 周'
    },
  }
  const weekDocument = buildSinglePickerDocument(weekState, {
    pickerKind: 'week',
    pickerReactProps: weekPickerProps,
  })
  const { hook: weekHook } = await loadHook(
    'adapters/temu/mall-flux.js',
    ['injectWeekPickerValue'],
    {
      href: 'https://agentseller.temu.com/main/mall-flux-analysis-full',
      document: weekDocument,
    },
  )
  assert.equal(await weekHook.injectWeekPickerValue('2026-W13'), true)
  assert.equal(weekState.pickerValue, '2026 第 13 周')

  const monthState = {
    bodyText: '店铺流量',
    activeGrain: '按月',
    pickerValue: '2026年03月',
  }
  const monthPickerProps = {
    value: new Date('2026-03-31T00:00:00'),
    onChange(nextDate) {
      const day = formatLocalDate(nextDate)
      if (day === '2026-02-01') monthState.pickerValue = '2026年02月'
    },
  }
  const monthDocument = buildSinglePickerDocument(monthState, {
    pickerKind: 'month',
    pickerReactProps: monthPickerProps,
  })
  const { hook: monthHook } = await loadHook(
    'adapters/temu/mall-flux.js',
    ['injectMonthPickerValue'],
    {
      href: 'https://agentseller.temu.com/main/mall-flux-analysis-full',
      document: monthDocument,
    },
  )
  assert.equal(await monthHook.injectMonthPickerValue('2026-02'), true)
  assert.equal(monthState.pickerValue, '2026年02月')
})

test('mall-flux finds range picker react props from input candidates', async () => {
  const state = {
    bodyText: '统计日期 店铺流量列表',
    dateRangeValue: '2026-04-01 ~ 2026-04-10',
    activeGrain: '按日',
  }
  const rangeReactProps = {
    value: [new Date('2026-04-01T00:00:00'), new Date('2026-04-10T00:00:00')],
    onChange() {},
  }
  const document = buildStatefulDocument(state, {
    includeDateRange: true,
    rangeReactProps,
  })
  const { hook } = await loadHook(
    'adapters/temu/mall-flux.js',
    ['getRangePickerInputCandidates', 'getRangePickerReactPropsFromInput', 'readRangeModelValueByLabel'],
    {
      href: 'https://agentseller.temu.com/main/mall-flux-analysis-full',
      document,
    },
  )

  const candidates = hook.getRangePickerInputCandidates('统计日期')
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0], document.__rangeInput)

  const props = hook.getRangePickerReactPropsFromInput(candidates[0])
  assert.equal(typeof props?.onChange, 'function')
  const modelValue = hook.readRangeModelValueByLabel('统计日期')
  assert.equal(modelValue.start, '2026-04-01')
  assert.equal(modelValue.end, '2026-04-10')
})

test('mall-flux falls back to hidden range picker inputs when visible ones are absent', async () => {
  const state = {
    bodyText: '统计日期 店铺流量列表',
    dateRangeValue: '',
    activeGrain: '按月',
  }
  const rangeReactProps = {
    value: [new Date('2026-03-01T00:00:00'), new Date('2026-03-31T00:00:00')],
    onChange() {},
  }
  const document = buildStatefulDocument(state, {
    includeDateRange: true,
    rangeReactProps,
  })
  document.__rangeInput._rect = { x: 0, y: 0, width: 0, height: 0 }
  document.__rangeRoot._rect = { x: 0, y: 0, width: 0, height: 0 }

  const { hook } = await loadHook(
    'adapters/temu/mall-flux.js',
    ['getRangePickerInputCandidates', 'readRangeModelValueByLabel'],
    {
      href: 'https://agentseller.temu.com/main/mall-flux-analysis-full',
      document,
    },
  )

  const candidates = hook.getRangePickerInputCandidates('统计日期')
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0], document.__rangeInput)
  const modelValue = hook.readRangeModelValueByLabel('统计日期')
  assert.equal(modelValue.start, '2026-03-01')
  assert.equal(modelValue.end, '2026-03-31')
})

test('mall-flux week date filter wait requires refreshed row evidence beyond input echo', async () => {
  const state = {
    pageNo: 1,
    rows: ['2026-03-16~2026-03-22', '2026-03-23~2026-03-29'],
    totalCount: 80,
    bodyText: '店铺流量列表',
    dateRangeValue: '2026-03-30 ~ 2026-04-12',
    activeGrain: '按周',
  }
  const document = buildStatefulDocument(state, { includeDateRange: true })
  const { hook } = await loadHook(
    'adapters/temu/mall-flux.js',
    ['getListPageSignature', 'waitForDateFilteredRows'],
    {
      href: 'https://agentseller.temu.com/main/mall-flux-analysis-full',
      document,
    },
  )

  const baseline = {
    signature: hook.getListPageSignature(),
    totalCount: 80,
    pageNo: 1,
    grain: '按周',
  }
  const filteredPromise = hook.waitForDateFilteredRows(
    '2026-03-30',
    '2026-04-12',
    { grain: '按周', baseline },
    1800,
  )

  setTimeout(() => {
    state.totalCount = 64
    state.rows = ['2026-03-30~2026-04-05', '2026-04-06~2026-04-12']
  }, 520)

  const earlyResult = await Promise.race([
    filteredPromise.then(() => 'resolved'),
    sleep(350).then(() => 'timeout'),
  ])

  assert.equal(earlyResult, 'timeout')
  assert.equal(await filteredPromise, true)
})

test('mall-flux waitForListReady ignores hidden empty markers until visible rows arrive', async () => {
  const state = {
    pageNo: 1,
    rows: [],
    totalCount: 6,
    bodyText: '店铺流量列表',
    activeGrain: '按日',
  }
  const document = buildStatefulDocument(state, { includeDateRange: true })
  const hiddenEmpty = new DynamicElement({
    tagName: 'div',
    text: 'empty',
    rect: { x: 0, y: 0, width: 0, height: 0 },
  })
  document.setSelector('[class*="TB_empty_"]', () => [hiddenEmpty])

  const { hook } = await loadHook(
    'adapters/temu/mall-flux.js',
    ['waitForListReady'],
    {
      href: 'https://agentseller-us.temu.com/main/mall-flux-analysis-full',
      document,
    },
  )

  const readyPromise = hook.waitForListReady(1600)
  const earlyResult = await Promise.race([
    readyPromise.then(() => 'resolved'),
    sleep(260).then(() => 'timeout'),
  ])
  assert.equal(earlyResult, 'timeout')

  setTimeout(() => {
    state.rows = ['2026-04-12', '2026-04-11']
  }, 320)

  const readyState = await readyPromise
  assert.equal(readyState.ready, true)
  assert.equal(readyState.empty, false)
  assert.equal(readyState.rows.length, 2)
})

test('mall-flux falls back to requested week and month labels when picker display is empty', async () => {
  const monthState = {
    pageNo: 1,
    rows: ['2026-03'],
    totalCount: 1,
    bodyText: '店铺流量列表',
    dateRangeValue: '',
    activeGrain: '按月',
  }
  const monthDocument = buildStatefulDocument(monthState, { includeDateRange: true })
  const { hook: monthHook } = await loadHook(
    'adapters/temu/mall-flux.js',
    ['getStatDateRangeValue'],
    {
      href: 'https://agentseller-eu.temu.com/main/mall-flux-analysis-full',
      document: monthDocument,
      params: {
        stat_grain: '按月',
        stat_month: '2026-03',
      },
    },
  )
  assert.equal(monthHook.getStatDateRangeValue(), '2026-03')

  const weekState = {
    pageNo: 1,
    rows: ['2026-03-30~2026-04-05'],
    totalCount: 1,
    bodyText: '店铺流量列表',
    dateRangeValue: '',
    activeGrain: '按周',
  }
  const weekDocument = buildStatefulDocument(weekState, { includeDateRange: true })
  const { hook: weekHook } = await loadHook(
    'adapters/temu/mall-flux.js',
    ['getStatDateRangeValue'],
    {
      href: 'https://agentseller-us.temu.com/main/mall-flux-analysis-full',
      document: weekDocument,
      params: {
        stat_grain: '按周',
        stat_week: '2026-W14',
      },
    },
  )
  assert.equal(weekHook.getStatDateRangeValue(), '2026-W14')
})

test('mall-flux restores requested filters from shared state after cross-site navigation', async () => {
  const state = {
    pageNo: 1,
    rows: ['2026-04-12'],
    totalCount: 1,
    bodyText: '店铺流量列表',
    activeGrain: '按日',
  }
  const document = buildStatefulDocument(state, { includeDateRange: true })
  const { hook } = await loadHook(
    'adapters/temu/mall-flux.js',
    ['resolveRequestedStatGrain', 'resolveRequestedStatRange', 'resolveRequestedStatWeekValue', 'resolveRequestedStatMonthValue'],
    {
      href: 'https://agentseller-us.temu.com/main/mall-flux-analysis-full',
      document,
      params: {},
      shared: {
        requestedMode: 'current',
        requestedOuterSites: ['美国'],
        requestedStatGrain: '按日',
        requestedStatDateRange: { start: '2026-04-07', end: '2026-04-09' },
        requestedStatWeek: '2026-W15',
        requestedStatMonth: '2026-04',
      },
    },
  )

  assert.equal(hook.resolveRequestedStatGrain(), '按日')
  const restoredRange = hook.resolveRequestedStatRange('按日')
  assert.equal(restoredRange.start, '2026-04-07')
  assert.equal(restoredRange.end, '2026-04-09')
  assert.equal(hook.resolveRequestedStatWeekValue(), '2026-W15')
  assert.equal(hook.resolveRequestedStatMonthValue(), '2026-04')
})

test('mall-flux target readiness does not require a visible date input in month view', async () => {
  const state = {
    pageNo: 1,
    rows: ['2026-03'],
    totalCount: 1,
    bodyText: '店铺流量 按日 按周 按月',
    activeGrain: '按月',
  }
  const document = buildStatefulDocument(state)
  const outerSiteGlobal = new DynamicElement({
    tagName: 'a',
    text: '全球',
    className: 'index-module__drItem___ index-module__active___',
  })
  document.setSelector('a[class*="index-module__drItem___"]', () => [outerSiteGlobal])

  const { hook } = await loadHook(
    'adapters/temu/mall-flux.js',
    ['waitForTargetReady'],
    {
      href: 'https://agentseller-eu.temu.com/main/mall-flux-analysis-full',
      document,
    },
  )

  assert.equal(await hook.waitForTargetReady(200), true)
})

test('activity-data does not switch outer site when total count implies more pages', async () => {
  const state = {
    pageNo: 1,
    rows: ['page1-row-a', 'page1-row-b'],
    totalCount: 176,
    bodyText: '活动类型 统计日期 活动数据列表',
    hasNext: false,
  }
  const document = buildStatefulDocument(state)
  const buttonQuery = new DynamicElement({ tagName: 'button', text: '查询' })
  const buttonReset = new DynamicElement({ tagName: 'button', text: '重置' })
  const outerSiteGlobal = new DynamicElement({
    tagName: 'a',
    text: '全球',
    className: 'index-module__drItem___ index-module__active___',
  })
  const outerSiteUs = new DynamicElement({
    tagName: 'a',
    text: '美国',
    className: 'index-module__drItem___',
  })
  document.setSelector('button', () => [buttonQuery, buttonReset])
  document.setSelector('a[class*="index-module__drItem___"]', () => [outerSiteGlobal, outerSiteUs])

  const result = await runScript('adapters/temu/activity-data.js', {
    phase: 'advance_cursor',
    href: 'https://agentseller.temu.com/main/act/data-full',
    document,
    shared: {
      currentOuterSite: '全球',
      targetOuterSites: ['全球', '美国'],
      currentPageNo: 1,
      lastCollectedPageNo: 1,
      listPageRetry: 0,
      listBusyRetry: 0,
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'reload_page')
  assert.equal(result.meta.next_phase, 'recover_list_page')
  assert.equal(result.meta.shared.recoverOuterSite, '全球')
  assert.equal(result.meta.shared.recoverPageNo, 1)
})

test('activity-data restores requested outer sites from shared state after cross-site navigation', async () => {
  const document = new DynamicDocument({ bodyText: '活动数据列表' })
  const outerSiteGlobal = new DynamicElement({
    tagName: 'a',
    text: '全球',
    className: 'index-module__drItem___ index-module__active___',
  })
  const outerSiteUs = new DynamicElement({
    tagName: 'a',
    text: '美国',
    className: 'index-module__drItem___',
  })
  const outerSiteEu = new DynamicElement({
    tagName: 'a',
    text: '欧区',
    className: 'index-module__drItem___',
  })
  document.setSelector('a[class*="index-module__drItem___"]', () => [outerSiteGlobal, outerSiteUs, outerSiteEu])

  const { hook } = await loadHook(
    'adapters/temu/activity-data.js',
    ['buildTargetOuterSites'],
    {
      href: 'https://agentseller.temu.com/main/act/data-full',
      document,
      params: {},
      shared: {
        requestedOuterSites: ['全球', '美国'],
      },
    },
  )

  const { available, target } = hook.buildTargetOuterSites()
  assert.deepEqual(Array.from(available), ['全球', '美国', '欧区'])
  assert.deepEqual(Array.from(target), ['全球', '美国'])
})
