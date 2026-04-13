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
  await vm.runInNewContext(instrumentedSource, context, { filename: scriptPath })
  return { hook, context }
}

async function runScript(scriptRelativePath, options = {}) {
  const scriptPath = path.resolve(scriptRelativePath)
  const source = fs.readFileSync(scriptPath, 'utf8')
  const href = options.href || 'https://agentseller.temu.com/main/act/data-full'
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
