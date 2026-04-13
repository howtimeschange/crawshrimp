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
    this.disabled = !!options.disabled
    this._rect = options.rect || { x: 0, y: 0, width: 240, height: 40 }
    this._selectors = new Map()
    this._attributes = new Map(Object.entries(options.attributes || {}))
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

  set value(nextValue) {
    this._value = String(nextValue || '')
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

class FakeDocument {
  constructor() {
    this._selectors = new Map()
    this.body = new FakeElement({
      tagName: 'body',
      text: '',
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

function buildExportModalDocument({ selected = false, withModal = true } = {}) {
  const document = new FakeDocument()

  const exportButton = new FakeElement({ tagName: 'button', text: '导出' })
  exportButton.clicked = 0
  exportButton.click = () => {
    exportButton.clicked += 1
  }

  const confirmButton = new FakeElement({ tagName: 'button', text: '确认' })
  confirmButton.clicked = 0
  confirmButton.click = () => {
    confirmButton.clicked += 1
  }

  const cancelButton = new FakeElement({ tagName: 'button', text: '取消' })

  const listOnlyLabel = new FakeElement({
    tagName: 'label',
    text: '导出列表',
    attributes: {
      'data-testid': 'beast-core-radio',
      'data-checked': selected ? 'false' : 'true',
    },
  })
  const withDetailLabel = new FakeElement({
    tagName: 'label',
    text: '导出列表 + 账务详情',
    attributes: {
      'data-testid': 'beast-core-radio',
      'data-checked': selected ? 'true' : 'false',
    },
  })
  withDetailLabel.clicked = 0
  withDetailLabel.click = () => {
    withDetailLabel.clicked += 1
    listOnlyLabel.setAttribute('data-checked', 'false')
    withDetailLabel.setAttribute('data-checked', 'true')
  }

  const exportModal = new FakeElement({
    tagName: 'div',
    text: '导出 导出列表 导出列表 + 账务详情 确认 取消',
    attributes: { 'data-testid': 'beast-core-modal' },
  })
  exportModal.setSelector('label[data-testid="beast-core-radio"]', [listOnlyLabel, withDetailLabel])
  exportModal.setSelector('button, a, [role="button"]', [confirmButton, cancelButton])

  document.setSelector('button, a, [role="button"]', [exportButton])
  document.setSelector('[class*="Drawer_content_"]', [])
  document.setSelector('[class*="Drawer_outerWrapper_"]', [])
  document.setSelector('[data-testid="beast-core-modal"]', withModal ? [exportModal] : [])

  return {
    document,
    exportButton,
    confirmButton,
    withDetailLabel,
  }
}

function buildHistoryDrawerDocument({ record, buttonText = '下载账务明细(卖家中心)' } = {}) {
  const document = new FakeDocument()
  const downloadButton = new FakeElement({ tagName: 'button', text: buttonText })
  downloadButton.__reactFiber$mock = {
    memoizedProps: { record, taskType: 'FUND_DETAIL_EXPORT' },
    return: null,
  }

  const row = new FakeElement({
    tagName: 'div',
    className: 'export-history_list__mock',
    text: '账务明细生成时间2026-04-13 13:50:16',
  })
  row.setSelector('button', [downloadButton])

  const drawer = new FakeElement({
    tagName: 'div',
    className: 'Drawer_content_mock',
    text: '导出历史',
  })
  drawer.setSelector('[class*="export-history_list__"]', [row])
  drawer.setSelector('button, a, [role="button"]', [])

  document.setSelector('[class*="Drawer_content_"]', [drawer])
  document.setSelector('[class*="Drawer_outerWrapper_"]', [])
  document.setSelector('button, a, [role="button"]', [])

  return { document }
}

function buildOpenHistoryDocument() {
  const document = new FakeDocument()
  const exportButton = new FakeElement({
    tagName: 'button',
    text: '导出',
    rect: { x: 280, y: 500, width: 70, height: 36 },
  })

  const sidebarHistory = new FakeElement({
    tagName: 'a',
    text: '导出历史',
    rect: { x: 140, y: 693, width: 92, height: 40 },
  })
  sidebarHistory.clicked = 0
  sidebarHistory.click = () => {
    sidebarHistory.clicked += 1
  }

  const pageHistory = new FakeElement({
    tagName: 'a',
    text: '导出历史',
    rect: { x: 360, y: 511, width: 56, height: 16 },
    attributes: { 'data-testid': 'beast-core-button-link' },
  })
  pageHistory.clicked = 0
  pageHistory.click = () => {
    pageHistory.clicked += 1
  }

  document.setSelector('[class*="Drawer_content_"]', [])
  document.setSelector('[class*="Drawer_outerWrapper_"]', [])
  document.setSelector('button, a, [role="button"]', [exportButton, sidebarHistory, pageHistory])

  return { document, sidebarHistory, pageHistory }
}

async function runScript({ phase, params = {}, shared = {}, document = new FakeDocument(), href = 'https://seller.kuajingmaihuo.com/labor/bill' }) {
  const scriptPath = path.resolve('adapters/temu/bill-center.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: phase,
      __CRAWSHRIMP_SHARED__: shared,
    },
    document,
    location: { href },
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
    HTMLInputElement: class HTMLInputElement {},
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

test('resolve_download_plan builds capture_url_requests for global finance detail', async () => {
  const result = await runScript({
    phase: 'resolve_download_plan',
    params: {
      bill_date_range: { start: '2026-03-14', end: '2026-04-13' },
    },
    shared: {
      requestedBillDateRange: { start: '2026-03-14', end: '2026-04-13' },
      downloadPlans: [
        {
          id: 'global',
          label: '财务明细（全球）',
          filename: 'SEMIR Official Shop-财务明细（全球）.xlsx',
          strategy: 'capture_url',
          captureUrl: 'https://agentseller.temu.com/labor/bill-download-with-detail?params=abc&sign=def',
        },
      ],
      planIndex: 0,
      resolvedDownloads: [],
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'capture_url_requests')
  assert.equal(result.meta.shared_key, 'captureResult')
  assert.equal(result.meta.next_phase, 'handle_captured_plan')
  assert.equal(
    result.meta.url,
    'https://agentseller.temu.com/labor/bill-download-with-detail?params=abc&sign=def',
  )
})

test('handle_captured_plan converts captured response body into ready download item', async () => {
  const result = await runScript({
    phase: 'handle_captured_plan',
    params: {
      bill_date_range: { start: '2026-03-14', end: '2026-04-13' },
    },
    shared: {
      requestedBillDateRange: { start: '2026-03-14', end: '2026-04-13' },
      activePlan: {
        id: 'global',
        label: '财务明细（全球）',
        filename: 'SEMIR Official Shop-财务明细（全球）.xlsx',
        strategy: 'capture_url',
      },
      captureResult: {
        matches: [{
          body: JSON.stringify({
            result: {
              fileUrl: 'https://agentseller.temu.com/labor-tag-u/FundDetail-1776051005012-bc5d.xlsx?signASM=abc',
            },
          }),
        }],
      },
      planIndex: 0,
      resolvedDownloads: [],
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'resolve_download_plan')
  assert.equal(result.meta.shared.planIndex, 1)
  assert.equal(result.meta.shared.resolvedDownloads.length, 1)
  assert.equal(result.meta.shared.resolvedDownloads[0].status, 'ready')
  assert.match(result.meta.shared.resolvedDownloads[0].fileUrl, /FundDetail-1776051005012-bc5d\.xlsx/)
})

test('handle_captured_plan keeps click-button download ready when capture misses signed fileUrl', async () => {
  const result = await runScript({
    phase: 'handle_captured_plan',
    params: {
      bill_date_range: { start: '2026-01-01', end: '2026-01-31' },
    },
    shared: {
      requestedBillDateRange: { start: '2026-01-01', end: '2026-01-31' },
      activePlan: {
        id: 'eu',
        label: '财务明细（欧区）',
        filename: 'SEMIR Official Shop-财务明细（欧区）-2026-01-01~2026-01-31.xlsx',
        strategy: 'capture_url',
        downloadAction: 'click_button',
        buttonText: '下载财务明细(欧区)',
      },
      captureResult: {
        matches: [],
      },
      planIndex: 1,
      resolvedDownloads: [],
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'resolve_download_plan')
  assert.equal(result.meta.shared.planIndex, 2)
  assert.equal(result.meta.shared.resolvedDownloads.length, 1)
  assert.equal(result.meta.shared.resolvedDownloads[0].status, 'ready')
  assert.equal(result.meta.shared.resolvedDownloads[0].fileUrl, '')
  assert.equal(result.meta.shared.resolvedDownloads[0].reason, '未捕获到下载请求')
})

test('wait_export_record builds range-aware filenames and browser-session seller-center plan', async () => {
  const { document } = buildHistoryDrawerDocument({
    record: {
      id: 21918564,
      createTime: Date.now(),
      searchExportTimeBegin: new Date('2026-02-01T00:00:00+08:00').getTime(),
      searchExportTimeEnd: new Date('2026-02-28T00:00:00+08:00').getTime(),
      agentSellerExportParams: 'params',
      agentSellerExportSign: 'sign',
    },
  })

  const result = await runScript({
    phase: 'wait_export_record',
    params: {
      bill_date_range: { start: '2026-02-01', end: '2026-02-28' },
    },
    shared: {
      requestedBillDateRange: { start: '2026-02-01', end: '2026-02-28' },
      exportTriggeredAt: Date.now() - 1000,
      shopName: 'SEMIR Official Shop',
      queryDisplayRange: '2026-02-01 ~ 2026-02-28',
    },
    document,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'resolve_download_plan')
  assert.equal(result.meta.shared.downloadPlans.length, 4)
  assert.equal(
    result.meta.shared.downloadPlans[0].filename,
    'SEMIR Official Shop-账务明细（卖家中心）-2026-02-01~2026-02-28.xlsx',
  )
  assert.equal(result.meta.shared.downloadPlans[0].browserSession, true)
  assert.equal(
    result.meta.shared.downloadPlans[1].filename,
    'SEMIR Official Shop-财务明细（全球）-2026-02-01~2026-02-28.xlsx',
  )
})

test('download_all_files forwards browser_session flag for seller-center artifact', async () => {
  const result = await runScript({
    phase: 'download_all_files',
    params: {
      bill_date_range: { start: '2026-02-01', end: '2026-02-28' },
    },
    shared: {
      requestedBillDateRange: { start: '2026-02-01', end: '2026-02-28' },
      resolvedDownloads: [
        {
          id: 'cn',
          label: '账务明细（卖家中心）',
          filename: 'SEMIR Official Shop-账务明细（卖家中心）-2026-02-01~2026-02-28.xlsx',
          status: 'ready',
          downloadAction: 'direct_url',
          browserSession: true,
          fileUrl: 'https://example.com/FundDetail-demo.xlsx',
        },
      ],
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'download_urls')
  assert.equal(result.meta.items.length, 1)
  assert.equal(result.meta.items[0].browser_session, true)
  assert.equal(
    result.meta.items[0].filename,
    'SEMIR Official Shop-账务明细（卖家中心）-2026-02-01~2026-02-28.xlsx',
  )
})

test('download_click_plan still schedules click download when signed expected_url is missing', async () => {
  const { document } = buildHistoryDrawerDocument({
    record: {
      id: 21920317,
      createTime: Date.now(),
      searchExportTimeBegin: new Date('2026-01-01T00:00:00+08:00').getTime(),
      searchExportTimeEnd: new Date('2026-01-31T00:00:00+08:00').getTime(),
      agentSellerExportParams: 'params',
      agentSellerExportSign: 'sign',
    },
    buttonText: '下载财务明细(欧区)',
  })

  const result = await runScript({
    phase: 'download_click_plan',
    params: {
      bill_date_range: { start: '2026-01-01', end: '2026-01-31' },
    },
    shared: {
      requestedBillDateRange: { start: '2026-01-01', end: '2026-01-31' },
      targetRecordId: 21920317,
      exportTriggeredAt: Date.now() - 1000,
      clickDownloadIndex: 0,
      resolvedDownloads: [
        {
          id: 'eu',
          label: '财务明细（欧区）',
          filename: 'SEMIR Official Shop-财务明细（欧区）-2026-01-01~2026-01-31.xlsx',
          status: 'ready',
          downloadAction: 'click_button',
          buttonText: '下载财务明细(欧区)',
          fileUrl: '',
          reason: '未捕获到下载请求',
        },
      ],
    },
    document,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'download_clicks')
  assert.equal(result.meta.items.length, 1)
  assert.equal(result.meta.items[0].label, '财务明细（欧区）')
  assert.equal(result.meta.items[0].expected_url, '')
  assert.equal(result.meta.items[0].clicks.length, 1)
})

test('trigger_export advances into export modal confirmation phase', async () => {
  const { document, exportButton } = buildExportModalDocument({ withModal: false })
  const result = await runScript({
    phase: 'trigger_export',
    params: {
      bill_date_range: { start: '2026-03-01', end: '2026-03-31' },
    },
    shared: {
      requestedBillDateRange: { start: '2026-03-01', end: '2026-03-31' },
    },
    document,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'confirm_export_modal')
  assert.equal(exportButton.clicked, 1)
  assert.equal(typeof result.meta.shared.exportTriggeredAt, 'number')
})

test('confirm_export_modal selects list plus detail and confirms export', async () => {
  const { document, confirmButton, withDetailLabel } = buildExportModalDocument({ selected: false, withModal: true })
  const result = await runScript({
    phase: 'confirm_export_modal',
    params: {
      bill_date_range: { start: '2026-03-01', end: '2026-03-31' },
    },
    shared: {
      requestedBillDateRange: { start: '2026-03-01', end: '2026-03-31' },
      exportTriggeredAt: Date.now(),
    },
    document,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'open_history_drawer')
  assert.equal(withDetailLabel.clicked >= 1, true)
  assert.equal(withDetailLabel.getAttribute('data-checked'), 'true')
  assert.equal(confirmButton.clicked, 1)
})

test('confirm_export_modal falls back when export modal does not appear', async () => {
  const { document, confirmButton, withDetailLabel } = buildExportModalDocument({ withModal: false })
  const result = await runScript({
    phase: 'confirm_export_modal',
    params: {
      bill_date_range: { start: '2026-03-01', end: '2026-03-31' },
    },
    shared: {
      requestedBillDateRange: { start: '2026-03-01', end: '2026-03-31' },
      exportTriggeredAt: Date.now(),
    },
    document,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'open_history_drawer')
  assert.equal(withDetailLabel.clicked, 0)
  assert.equal(confirmButton.clicked, 0)
})

test('wait_export_record accepts export rows whose end timestamp is end-date 00:00:00', async () => {
  const { document } = buildHistoryDrawerDocument({
    record: {
      id: 21918564,
      createTime: Date.now(),
      searchExportTimeBegin: new Date('2026-03-01T00:00:00+08:00').getTime(),
      searchExportTimeEnd: new Date('2026-03-31T00:00:00+08:00').getTime(),
      agentSellerExportParams: 'params',
      agentSellerExportSign: 'sign',
    },
  })

  const result = await runScript({
    phase: 'wait_export_record',
    params: {
      bill_date_range: { start: '2026-03-01', end: '2026-03-31' },
    },
    shared: {
      requestedBillDateRange: { start: '2026-03-01', end: '2026-03-31' },
      exportTriggeredAt: Date.now() - 1000,
      shopName: 'SEMIR Official Shop',
      queryDisplayRange: '2026-03-01 ~ 2026-03-31',
    },
    document,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'resolve_download_plan')
  assert.equal(result.meta.shared.targetRecord.id, 21918564)
  assert.equal(result.meta.shared.downloadPlans.length, 4)
})

test('open_history_drawer prefers page export-history action over sidebar menu item', async () => {
  const { document, sidebarHistory, pageHistory } = buildOpenHistoryDocument()
  const result = await runScript({
    phase: 'open_history_drawer',
    params: {
      bill_date_range: { start: '2026-02-01', end: '2026-02-28' },
    },
    shared: {
      requestedBillDateRange: { start: '2026-02-01', end: '2026-02-28' },
    },
    document,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'wait_export_record')
  assert.equal(pageHistory.clicked, 1)
  assert.equal(sidebarHistory.clicked, 0)
})
