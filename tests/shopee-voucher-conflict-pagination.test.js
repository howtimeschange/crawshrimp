const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const realSetTimeout = global.setTimeout
const realClearTimeout = global.clearTimeout

class FakeElement {
  constructor(options = {}) {
    this.tagName = String(options.tagName || 'DIV').toUpperCase()
    this._text = options.text || ''
    this._value = options.value || ''
    this.className = String(options.className || '')
    this._attrs = new Map(Object.entries(options.attributes || {}))
    this._rect = options.rect || { x: 0, y: 0, width: 240, height: 32 }
    this._queryHandler = options.queryHandler || null
    this._click = options.onClick || null
    this._closest = options.closest || null
    this.parentElement = options.parentElement || null
    this.disabled = !!options.disabled
  }

  get innerText() {
    return typeof this._text === 'function' ? this._text() : String(this._text || '')
  }

  get textContent() {
    return this.innerText
  }

  get value() {
    return typeof this._value === 'function' ? this._value() : String(this._value || '')
  }

  set value(next) {
    this._value = String(next ?? '')
  }

  get outerHTML() {
    return `<${this.tagName.toLowerCase()} class="${this.className}">${this.innerText}</${this.tagName.toLowerCase()}>`
  }

  querySelectorAll(selector) {
    if (!this._queryHandler) return []
    return this._queryHandler(selector) || []
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }

  getClientRects() {
    return this._rect.width && this._rect.height ? [this._rect] : []
  }

  getBoundingClientRect() {
    const { x, y, width, height } = this._rect
    return { left: x, top: y, width, height, right: x + width, bottom: y + height }
  }

  getAttribute(name) {
    return this._attrs.has(name) ? this._attrs.get(name) : null
  }

  setAttribute(name, value) {
    this._attrs.set(name, String(value))
    return this
  }

  closest(selector) {
    if (typeof this._closest === 'function') return this._closest(selector)
    return this._closest || null
  }

  contains(target) {
    return target === this
  }

  scrollIntoView() {}
  focus() {}

  click() {
    if (typeof this._click === 'function') this._click()
  }

  dispatchEvent() {
    return true
  }
}

function styleFor() {
  return {
    display: 'block',
    visibility: 'visible',
  }
}

function fastSetTimeout(fn, _ms, ...args) {
  return realSetTimeout(fn, 0, ...args)
}

function isRowSelector(selector) {
  return String(selector || '').includes('tbody tr') || String(selector || '').includes('[role="row"]')
}

function selectorMatchesClassToken(selector, className) {
  const text = String(selector || '')
  return String(className || '')
    .split(/\s+/)
    .filter(Boolean)
    .some(token => text.includes(`.${token}`))
}

function buildBaseRow(voucherType) {
  return {
    站点: '马来西亚',
    店铺: 'semir2022.my',
    优惠券品类: voucherType,
    奖励类型: '折扣',
    折扣类型: '扣除百分比',
    优惠限额: '20',
    最低消费金额: '100',
    可使用总数: '20',
    每个买家可用的优惠券数量上限: '1',
    '优惠券领取期限（开始）精确到分': '2026/04/24-20:00:00',
    '优惠券领取期限（结束）精确到分': '2026/05/05-23:59:00',
    '是否覆盖已有券': '1',
  }
}

function buildScenarioDocument(state) {
  const tableBody = new FakeElement({ tagName: 'TBODY', text: 'voucher table' })

  function currentPages() {
    return state.pagesByTab[state.activeTab] || [[]]
  }

  function currentPageNo() {
    return state.currentPageByTab[state.activeTab] || 1
  }

  function currentRows() {
    return currentPages()[currentPageNo() - 1] || []
  }

  function recordPageAction(entry) {
    state.pageActions.push({ tab: state.activeTab, page: currentPageNo(), ...entry })
  }

  function buildDialogRoot() {
    if (!state.dialog) return null
    const confirmButton = new FakeElement({
      tagName: 'BUTTON',
      text: state.dialog.action,
      className: 'eds-react-button eds-react-button--normal',
      onClick: () => {
        state.actionLog.push({
          action: state.dialog.action,
          rowKey: state.dialog.rowKey,
          tab: state.dialog.tab,
          page: state.dialog.page,
        })
        state.dialog = null
      },
    })
    const dialog = new FakeElement({
      tagName: 'DIV',
      className: state.dialogRootClassName || 'eds-react-modal',
      text: () => state.dialog?.action || '',
      queryHandler: selector => {
        if (String(selector).includes('button') || String(selector).includes('[role="button"]')) return [confirmButton]
        return []
      },
    })
    confirmButton._closest = selector => (
      selectorMatchesClassToken(selector, dialog.className) || String(selector).includes('[role="dialog"]')
    ) ? dialog : null
    return dialog
  }

  function buildMenuItem() {
    if (!state.menuRowKey) return null
    const triggerMenuAction = () => {
      state.dialog = {
        action: '结束',
        rowKey: state.menuRowKey,
        tab: state.activeTab,
        page: currentPageNo(),
      }
      state.menuRowKey = ''
    }
    const useWrapperClick = state.menuClickTarget === 'wrapper'
    const useNoDomClick = state.menuClickTarget === 'cdp' || state.menuClickTarget === 'none'
    const menuButton = new FakeElement({
      tagName: 'BUTTON',
      text: '结束',
      className: 'eds-react-button eds-react-button--normal',
      onClick: useWrapperClick || useNoDomClick ? null : () => {
        triggerMenuAction()
      },
    })
    const wrapper = new FakeElement({
      tagName: 'DIV',
      text: '结束',
      className: 'eds-react-dropdown-item',
      attributes: { role: 'menuitem' },
      onClick: useWrapperClick ? () => {
        triggerMenuAction()
      } : (useNoDomClick ? null : null),
      queryHandler: selector => {
        if (String(selector).includes('button') || String(selector).includes('[role="button"]') || String(selector).includes('[role="menuitem"]')) return [menuButton]
        return []
      },
    })
    menuButton.parentElement = wrapper
    menuButton._closest = selector => {
      if (String(selector).includes('[role="menu"]') || String(selector).includes('[class*="dropdown"]') || String(selector).includes('[class*="menu"]')) return wrapper
      return null
    }
    return wrapper
  }

  function buildRow(rowDef) {
    const row = new FakeElement({
      tagName: 'TR',
      text: rowDef.text,
      className: 'voucher-row',
    })
    const buttons = []
    const actionNodes = []
    const cells = (rowDef.cells || []).map(text => {
      const cell = new FakeElement({
        tagName: 'TD',
        text,
        className: 'eds-react-table__cell',
      })
      cell._closest = selector => (isRowSelector(selector) ? row : null)
      return cell
    })
    const pushButton = (text, onClick) => {
      const button = new FakeElement({
        tagName: 'BUTTON',
        text,
        className: 'eds-react-button eds-react-button--normal',
        onClick,
      })
      button._closest = selector => (isRowSelector(selector) ? row : null)
      buttons.push(button)
      actionNodes.push(button)
      return button
    }

    const pushMoreAction = () => {
      const clickTarget = rowDef.moreClickTarget || state.moreClickTarget || 'button'
      const openMenu = () => {
        state.menuRowKey = rowDef.key
      }
      if (clickTarget === 'button') {
        pushButton('更多', openMenu)
        return
      }

      const button = new FakeElement({
        tagName: 'BUTTON',
        text: '更多',
        className: 'eds-react-button eds-react-button--normal',
        onClick: clickTarget === 'button' ? openMenu : null,
      })
      const span = new FakeElement({
        tagName: 'SPAN',
        text: '更多',
      })
      const dropdown = new FakeElement({
        tagName: 'DIV',
        text: '更多',
        className: 'eds-react-dropdown',
        onClick: clickTarget === 'dropdown' ? openMenu : null,
      })
      const wrapper = new FakeElement({
        tagName: 'DIV',
        text: '更多',
        className: '_2klzl_j238zFOLnk1xkbko',
        onClick: clickTarget === 'wrapper' ? openMenu : null,
      })
      button.parentElement = dropdown
      span.parentElement = button
      button._closest = selector => {
        if (isRowSelector(selector)) return row
        if (String(selector).includes('.eds-react-dropdown')) return dropdown
        return null
      }
      span._closest = selector => {
        if (isRowSelector(selector)) return row
        if (String(selector).includes('.eds-react-dropdown')) return dropdown
        return null
      }
      dropdown.parentElement = wrapper
      dropdown._closest = selector => (isRowSelector(selector) ? row : null)
      wrapper._closest = selector => (isRowSelector(selector) ? row : null)
      buttons.push(button)
      actionNodes.push(wrapper, dropdown, button, span)
    }

    const actionButtons = rowDef.buttons || (
      rowDef.kind === 'ongoing'
        ? ['更多']
        : (rowDef.kind === 'upcoming' ? ['删除'] : [])
    )

    actionButtons.forEach(text => {
      if (text === '更多') {
        pushMoreAction()
        return
      }
      if (text === '删除' || text === '结束') {
        pushButton(text, () => {
          state.dialog = {
            action: text,
            rowKey: rowDef.key,
            tab: state.activeTab,
            page: currentPageNo(),
          }
        })
        return
      }
      pushButton(text, () => {})
    })

    row._queryHandler = selector => {
      if (String(selector).includes('td') || String(selector).includes('[role="cell"]')) {
        return cells
      }
      if (String(selector).includes('div') || String(selector).includes('span') || String(selector).includes('.eds-react-dropdown')) {
        return actionNodes
      }
      if (String(selector).includes('button') || String(selector).includes('[role="button"]') || String(selector).includes('[role="menuitem"]')) {
        return buttons
      }
      return []
    }
    return row
  }

  function buildTabs() {
    return ['全部', '进行中的活动', '接下来的活动', '已过期'].map(label => new FakeElement({
      tagName: 'DIV',
      text: label,
      className: label === state.activeTab ? 'eds-react-tabs-tab-active eds-react-tabs-tab' : 'eds-react-tabs-tab',
      attributes: {
        role: 'tab',
        'aria-disabled': 'false',
        'aria-selected': label === state.activeTab ? 'true' : 'false',
      },
      onClick: () => {
        state.activeTab = label
        if (state.pagesByTab[label]) state.currentPageByTab[label] = 1
        state.menuRowKey = ''
        state.dialog = null
      },
    }))
  }

  function buildPagerRoot() {
    const totalPages = currentPages().length || 1
    const current = currentPageNo()
    const prevButton = new FakeElement({
      tagName: 'BUTTON',
      text: '',
      className: `eds-react-button eds-react-pagination-pager__button eds-react-pagination-pager__button-prev${current <= 1 ? ' disabled' : ''}`,
      disabled: current <= 1,
      onClick: () => {
        if (currentPageNo() <= 1) return
        const targetPage = currentPageNo() - 1
        state.currentPageByTab[state.activeTab] = targetPage
        recordPageAction({ type: 'prev', targetPage })
      },
    })
    prevButton.setAttribute('aria-label', 'arrow-left-bold')

    const pageItems = []
    for (let pageNo = 1; pageNo <= totalPages; pageNo += 1) {
      pageItems.push(new FakeElement({
        tagName: 'LI',
        text: String(pageNo),
        className: `eds-react-pagination-pager__page${pageNo === current ? ' active' : ''}`,
        onClick: () => {
          state.currentPageByTab[state.activeTab] = pageNo
          recordPageAction({ type: 'page', targetPage: pageNo })
        },
      }))
    }

    const nextButton = new FakeElement({
      tagName: 'BUTTON',
      text: '',
      className: `eds-react-button eds-react-pagination-pager__button eds-react-pagination-pager__button-next${current >= totalPages ? ' disabled' : ''}`,
      disabled: current >= totalPages,
      onClick: () => {
        if (currentPageNo() >= totalPages) return
        const targetPage = currentPageNo() + 1
        state.currentPageByTab[state.activeTab] = targetPage
        recordPageAction({ type: 'next', targetPage })
      },
    })
    nextButton.setAttribute('aria-label', 'arrow-right-bold')

    const goButton = new FakeElement({
      tagName: 'BUTTON',
      text: 'Go',
      className: 'eds-react-button eds-react-button--normal',
    })

    const controls = [prevButton, ...pageItems, nextButton, goButton]
    return new FakeElement({
      tagName: 'DIV',
      text: () => `${pageItems.map(item => item.innerText).join(' ')} Go to page Go`,
      className: 'eds-react-pagination eds-react-table-pagination',
      queryHandler: selector => {
        if (
          String(selector).includes('button') ||
          String(selector).includes('li') ||
          String(selector).includes('[role="button"]') ||
          String(selector).includes('[aria-current="page"]')
        ) {
          return controls
        }
        return []
      },
    })
  }

  const document = {
    body: new FakeElement({
      tagName: 'BODY',
      text: () => state.bodyText || `${state.activeTab} vouchers`,
      rect: { x: 0, y: 0, width: 1600, height: 900 },
    }),
    querySelectorAll(selector) {
      const tabs = buildTabs()
      const pagerRoot = buildPagerRoot()
      const rows = currentRows().map(buildRow)
      const dialogRoot = buildDialogRoot()
      const menuItem = buildMenuItem()
      const menuButtons = menuItem ? menuItem.querySelectorAll('button, a, [role="button"], [role="menuitem"]') : []
      const inlineErrors = (state.inlineErrors || []).map(text => new FakeElement({
        tagName: 'DIV',
        text,
        className: 'eds-react-form-item__extra',
      }))
      const toastErrors = (state.toastErrors || []).map(text => new FakeElement({
        tagName: 'DIV',
        text,
        className: 'eds-toast',
        attributes: { role: 'alert' },
      }))
      const rowButtons = rows.flatMap(row => row.querySelectorAll('button, a, [role="button"], [role="menuitem"]'))
      const pagerButtons = pagerRoot.querySelectorAll('button, a, li, [role="button"], [aria-current="page"]')
      const dialogButtons = dialogRoot ? dialogRoot.querySelectorAll('button, a, [role="button"]') : []

      if (selector === '.eds-react-tabs-tab-active') return tabs.filter(tab => tab.className.includes('eds-react-tabs-tab-active'))
      if (selector === '.eds-react-tabs-tab') return tabs
      if (selector === '[role="dialog"], .eds-modal, .shopee-modal, .eds-react-modal, .eds-react-modal__container') {
        return dialogRoot && (selectorMatchesClassToken(selector, dialogRoot.className) || String(selector).includes('[role="dialog"]'))
          ? [dialogRoot]
          : []
      }
      if (selector === '[role="dialog"], .eds-modal, .shopee-modal, .eds-react-modal') {
        return dialogRoot && (selectorMatchesClassToken(selector, dialogRoot.className) || String(selector).includes('[role="dialog"]'))
          ? [dialogRoot]
          : []
      }
      if (selector === '.eds-react-form-item__extra, .eds-react-form-item__help, .eds-form-item__extra, .eds-form-item__help, [class*="error-msg"], [class*="error-text"], [class*="form-error"]') return inlineErrors
      if (selector === '[role=alert], .eds-toast, .eds-message, .eds-notification') return toastErrors
      if (selector === 'tbody tr, [role="row"]') return rows
      if (selector === 'tbody, .eds-react-table-body') return [tableBody]
      if (selector === '.eds-react-pagination, .eds-react-table-pagination, .eds-pagination, [class*="pagination"], [class*="pager"]') return [pagerRoot]
      if (selector === '.eds-react-spin, .eds-spin, [class*="loading"], [class*="skeleton"], [class*="placeholder"]') return []
      if (selector === '.eds-react-empty, .eds-empty, [class*="empty"], [class*="no-data"], [class*="empty-state"]') {
        return rows.length ? [] : [new FakeElement({ text: '暂无数据' })]
      }
      if (selector === '.fullstory-modal-wrapper' || selector === '.diagnosis-result-modal') return []
      if (selector === 'button') return [...rowButtons, ...dialogButtons, ...pagerButtons].filter(el => el.tagName === 'BUTTON')
      if (selector === 'button, a, [role="button"]') return [...rowButtons, ...dialogButtons, ...pagerButtons]
      if (selector === 'button, a, div, li, [role="button"], [role="menuitem"], .eds-react-dropdown-item') {
        return [...tabs, ...rowButtons, ...pagerButtons, ...(menuItem ? [menuItem] : []), ...menuButtons, ...dialogButtons]
      }
      return []
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null
    },
    contains(node) {
      return node === this.body
    },
  }

  return document
}

async function runVoucherScript({ scriptRelPath, params, document, shared = {}, href, phase = 'resolve_existing_vouchers', userAgent = 'node-test' }) {
  const scriptPath = path.resolve(scriptRelPath)
  const source = fs.readFileSync(scriptPath, 'utf8')
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: phase,
      __CRAWSHRIMP_SHARED__: shared,
      __CRAWSHRIMP_PAGE__: 1,
      __CRAWSHRIMP_RUN_TOKEN__: 'test-run',
      location: null,
      document,
    },
    document,
    location: { href },
    navigator: { userAgent },
    console,
    setTimeout: fastSetTimeout,
    clearTimeout: realClearTimeout,
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
    HTMLInputElement: class HTMLInputElement {},
    HTMLTextAreaElement: class HTMLTextAreaElement {},
  }
  context.window.location = context.location
  context.globalThis = context
  return await vm.runInNewContext(source, context, { filename: scriptPath })
}

test('voucher-create paginates ongoing tab before ending a conflicting voucher', async () => {
  const state = {
    activeTab: '全部',
    currentPageByTab: {
      '接下来的活动': 1,
      '进行中的活动': 1,
    },
    pagesByTab: {
      '接下来的活动': [[
        { key: 'upcoming-safe', kind: 'upcoming', text: '接下来的活动 SAFE-1 优惠券码：SAFE1 店铺优惠券 全部商品 所有买家 20%折扣 20 0 2026/05/10 00:00 - 2026/05/12 23:59 删除' },
      ]],
      '进行中的活动': [
        [
          { key: 'ongoing-safe', kind: 'ongoing', text: '进行中的活动 SAFE-2 优惠券码：SAFE2 店铺优惠券 全部商品 所有买家 20%折扣 20 0 2026/05/10 00:00 - 2026/05/12 23:59 更多' },
        ],
        [
          { key: 'ongoing-conflict', kind: 'ongoing', text: '进行中的活动 CONFLICT 优惠券码：CONFLICT 店铺优惠券 全部商品 所有买家 20%折扣 20 0 2026/04/24 20:00 - 2026/05/05 23:59 更多' },
        ],
      ],
    },
    menuRowKey: '',
    dialog: null,
    actionLog: [],
    pageActions: [],
  }

  const result = await runVoucherScript({
    scriptRelPath: 'adapters/shopee-plus-v2/voucher-create.js',
    params: { input_file: { rows: [buildBaseRow('商店优惠券')] } },
    shared: { shopId: '804281004', result: {} },
    document: buildScenarioDocument(state),
    href: 'https://seller.shopee.cn/portal/marketing/vouchers/list?cnsc_shop_id=804281004',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'resolve_existing_vouchers')
  assert.equal(state.actionLog.length, 1)
  assert.deepEqual(state.actionLog[0], {
    action: '结束',
    rowKey: 'ongoing-conflict',
    tab: '进行中的活动',
    page: 2,
  })
  assert.equal(state.pageActions.filter(item => item.type === 'next' && item.tab === '进行中的活动').length, 1)
})

test('voucher-create supports ending a conflicting voucher directly from the row action', async () => {
  const state = {
    activeTab: '全部',
    currentPageByTab: {
      '接下来的活动': 1,
      '进行中的活动': 1,
    },
    pagesByTab: {
      '接下来的活动': [[
        { key: 'upcoming-safe', kind: 'upcoming', text: '接下来的活动 SAFE-1 优惠券码：SAFE1 店铺优惠券 全部商品 所有买家 20%折扣 20 0 2026/05/10 00:00 - 2026/05/12 23:59 删除' },
      ]],
      '进行中的活动': [[
        {
          key: 'ongoing-inline-end',
          kind: 'ongoing',
          buttons: ['结束'],
          text: '进行中的活动 INLINE-END 优惠券码：INLINE1 店铺优惠券 全部商品 所有买家 20%折扣 20 0 2026/04/24 20:00 - 2026/05/05 23:59 结束',
        },
      ]],
    },
    menuRowKey: '',
    dialog: null,
    actionLog: [],
    pageActions: [],
  }

  const result = await runVoucherScript({
    scriptRelPath: 'adapters/shopee-plus-v2/voucher-create.js',
    params: { input_file: { rows: [buildBaseRow('商店优惠券')] } },
    shared: { shopId: '804281004', result: {} },
    document: buildScenarioDocument(state),
    href: 'https://seller.shopee.cn/portal/marketing/vouchers/list?cnsc_shop_id=804281004',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'resolve_existing_vouchers')
  assert.deepEqual(state.actionLog, [{
    action: '结束',
    rowKey: 'ongoing-inline-end',
    tab: '进行中的活动',
    page: 1,
  }])
})

test('voucher-create prefers cdp clicks first for upcoming delete in a real browser runtime', async () => {
  const state = {
    activeTab: '全部',
    currentPageByTab: {
      '接下来的活动': 1,
      '进行中的活动': 1,
    },
    pagesByTab: {
      '接下来的活动': [[
        {
          key: 'upcoming-cdp-delete-conflict',
          kind: 'upcoming',
          text: '接下来的活动 UPCOMING 优惠券码：UPCOMING1 店铺优惠券 全部商品 所有买家 20%折扣 20 0 2026/04/24 20:00 - 2026/05/05 23:59 删除',
        },
      ]],
      '进行中的活动': [[]],
    },
    menuRowKey: '',
    dialog: null,
    actionLog: [],
    pageActions: [],
  }

  const result = await runVoucherScript({
    scriptRelPath: 'adapters/shopee-plus-v2/voucher-create.js',
    params: { input_file: { rows: [buildBaseRow('商店优惠券')] } },
    shared: { shopId: '804281004', result: {} },
    document: buildScenarioDocument(state),
    href: 'https://seller.shopee.cn/portal/marketing/vouchers/list?cnsc_shop_id=804281004',
    userAgent: 'Mozilla/5.0 Chrome/125.0.0.0 Safari/537.36',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'cdp_clicks')
  assert.equal(result.meta.next_phase, 'resolve_existing_vouchers')
  assert.equal(result.meta.shared.conflict_cdp_row_key, 'UPCOMING1')
  assert.equal(result.meta.shared.conflict_cdp_step, 'delete_dialog_opened')
  assert.equal((result.meta.clicks || []).length, 1)
})

test('voucher-create confirms an upcoming delete dialog after cdp re-entry', async () => {
  const state = {
    activeTab: '全部',
    currentPageByTab: {
      '接下来的活动': 1,
      '进行中的活动': 1,
    },
    pagesByTab: {
      '接下来的活动': [[
        {
          key: 'upcoming-cdp-delete-conflict',
          kind: 'upcoming',
          text: '接下来的活动 UPCOMING 优惠券码：UPCOMING1 店铺优惠券 全部商品 所有买家 20%折扣 20 0 2026/04/24 20:00 - 2026/05/05 23:59 删除',
        },
      ]],
      '进行中的活动': [[]],
    },
    menuRowKey: '',
    dialog: {
      action: '删除',
      rowKey: 'upcoming-cdp-delete-conflict',
      tab: '接下来的活动',
      page: 1,
    },
    actionLog: [],
    pageActions: [],
  }

  const result = await runVoucherScript({
    scriptRelPath: 'adapters/shopee-plus-v2/voucher-create.js',
    params: { input_file: { rows: [buildBaseRow('商店优惠券')] } },
    shared: {
      shopId: '804281004',
      result: {},
      conflict_cdp_row_key: 'UPCOMING1',
      conflict_cdp_step: 'delete_dialog_opened',
    },
    document: buildScenarioDocument(state),
    href: 'https://seller.shopee.cn/portal/marketing/vouchers/list?cnsc_shop_id=804281004',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'resolve_existing_vouchers')
  assert.deepEqual(state.actionLog, [{
    action: '删除',
    rowKey: 'upcoming-cdp-delete-conflict',
    tab: '接下来的活动',
    page: 1,
  }])
})

test('voucher-create confirms an already-open upcoming delete dialog before clicking row delete again', async () => {
  const state = {
    activeTab: '全部',
    currentPageByTab: {
      '接下来的活动': 1,
      '进行中的活动': 1,
    },
    pagesByTab: {
      '接下来的活动': [[
        {
          key: 'upcoming-open-delete-conflict',
          kind: 'upcoming',
          text: '接下来的活动 UPCOMING 优惠券码：UPCOMING2 店铺优惠券 全部商品 所有买家 20%折扣 20 0 2026/04/24 20:00 - 2026/05/05 23:59 删除',
        },
      ]],
      '进行中的活动': [[]],
    },
    menuRowKey: '',
    dialog: {
      action: '删除',
      rowKey: 'upcoming-open-delete-conflict',
      tab: '接下来的活动',
      page: 1,
    },
    actionLog: [],
    pageActions: [],
  }

  const result = await runVoucherScript({
    scriptRelPath: 'adapters/shopee-plus-v2/voucher-create.js',
    params: { input_file: { rows: [buildBaseRow('商店优惠券')] } },
    shared: { shopId: '804281004', result: {} },
    document: buildScenarioDocument(state),
    href: 'https://seller.shopee.cn/portal/marketing/vouchers/list?cnsc_shop_id=804281004',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'resolve_existing_vouchers')
  assert.deepEqual(state.actionLog, [{
    action: '删除',
    rowKey: 'upcoming-open-delete-conflict',
    tab: '接下来的活动',
    page: 1,
  }])
})

test('voucher-create recognizes Shopee modal container roots before re-clicking an upcoming delete row action', async () => {
  const state = {
    activeTab: '全部',
    currentPageByTab: {
      '接下来的活动': 1,
      '进行中的活动': 1,
    },
    pagesByTab: {
      '接下来的活动': [[
        {
          key: 'upcoming-container-delete-conflict',
          kind: 'upcoming',
          text: '接下来的活动 UPCOMING 优惠券码：UPCOMING3 店铺优惠券 全部商品 所有买家 20%折扣 20 0 2026/04/24 20:00 - 2026/05/05 23:59 删除',
        },
      ]],
      '进行中的活动': [[]],
    },
    menuRowKey: '',
    dialog: {
      action: '删除',
      rowKey: 'upcoming-container-delete-conflict',
      tab: '接下来的活动',
      page: 1,
    },
    dialogRootClassName: 'eds-react-modal__container',
    actionLog: [],
    pageActions: [],
  }

  const result = await runVoucherScript({
    scriptRelPath: 'adapters/shopee-plus-v2/voucher-create.js',
    params: { input_file: { rows: [buildBaseRow('商店优惠券')] } },
    shared: { shopId: '804281004', result: {} },
    document: buildScenarioDocument(state),
    href: 'https://seller.shopee.cn/portal/marketing/vouchers/list?cnsc_shop_id=804281004',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'resolve_existing_vouchers')
  assert.deepEqual(state.actionLog, [{
    action: '删除',
    rowKey: 'upcoming-container-delete-conflict',
    tab: '接下来的活动',
    page: 1,
  }])
})

test('voucher-create chooses the dropdown end action instead of another row inline end button', async () => {
  const state = {
    activeTab: '全部',
    currentPageByTab: {
      '接下来的活动': 1,
      '进行中的活动': 1,
    },
    pagesByTab: {
      '接下来的活动': [[]],
      '进行中的活动': [[
        {
          key: 'follow-inline-end',
          kind: 'ongoing',
          buttons: ['结束'],
          text: '进行中的活动 20% 关注 优惠券码：SFP1 关注礼优惠券 全部商品 店铺粉丝 20%折扣 500 1 2026/04/01 00:00 - 2026/04/29 16:37 结束',
        },
        {
          key: 'repurchase-conflict',
          kind: 'ongoing',
          text: '进行中的活动 12%back 优惠券码：BACK1 回购买家优惠券 全部商品 重复购买买家 12%折扣 350 2 2026/04/24 20:00 - 2026/05/05 23:59 更多',
        },
      ]],
    },
    menuRowKey: '',
    dialog: null,
    actionLog: [],
    pageActions: [],
  }

  const result = await runVoucherScript({
    scriptRelPath: 'adapters/shopee-plus-v2/voucher-create.js',
    params: { input_file: { rows: [buildBaseRow('回购买家优惠券')] } },
    shared: { shopId: '804281004', result: {} },
    document: buildScenarioDocument(state),
    href: 'https://seller.shopee.cn/portal/marketing/vouchers/list?cnsc_shop_id=804281004',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'resolve_existing_vouchers')
  assert.deepEqual(state.actionLog, [{
    action: '结束',
    rowKey: 'repurchase-conflict',
    tab: '进行中的活动',
    page: 1,
  }])
})

test('voucher-create retries the dropdown wrapper when the inner end button does not open the confirm dialog', async () => {
  const state = {
    activeTab: '全部',
    currentPageByTab: {
      '接下来的活动': 1,
      '进行中的活动': 1,
    },
    pagesByTab: {
      '接下来的活动': [[]],
      '进行中的活动': [[
        {
          key: 'follow-inline-end',
          kind: 'ongoing',
          buttons: ['结束'],
          text: '进行中的活动 20% 关注 优惠券码：SFP1 关注礼优惠券 全部商品 店铺粉丝 20%折扣 500 1 2026/04/01 00:00 - 2026/04/29 16:37 结束',
        },
        {
          key: 'repurchase-wrapper-conflict',
          kind: 'ongoing',
          text: '进行中的活动 12%back 优惠券码：BACK2 回购买家优惠券 全部商品 重复购买买家 12%折扣 350 2 2026/04/24 20:00 - 2026/05/05 23:59 更多',
        },
      ]],
    },
    menuRowKey: '',
    menuClickTarget: 'wrapper',
    dialog: null,
    actionLog: [],
    pageActions: [],
  }

  const result = await runVoucherScript({
    scriptRelPath: 'adapters/shopee-plus-v2/voucher-create.js',
    params: { input_file: { rows: [buildBaseRow('回购买家优惠券')] } },
    shared: { shopId: '804281004', result: {} },
    document: buildScenarioDocument(state),
    href: 'https://seller.shopee.cn/portal/marketing/vouchers/list?cnsc_shop_id=804281004',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'resolve_existing_vouchers')
  assert.deepEqual(state.actionLog, [{
    action: '结束',
    rowKey: 'repurchase-wrapper-conflict',
    tab: '进行中的活动',
    page: 1,
  }])
})

test('voucher-create prefers wrapper-style 更多 triggers before inert inner button nodes', async () => {
  const state = {
    activeTab: '全部',
    currentPageByTab: {
      '接下来的活动': 1,
      '进行中的活动': 1,
    },
    pagesByTab: {
      '接下来的活动': [[]],
      '进行中的活动': [[
        {
          key: 'repurchase-wrapper-more-conflict',
          kind: 'ongoing',
          moreClickTarget: 'wrapper',
          text: '进行中的活动 12%back 优惠券码：BACK3 回购买家优惠券 全部商品 重复购买买家 12%折扣 350 2 2026/04/24 20:00 - 2026/05/05 23:59 更多',
        },
      ]],
    },
    menuRowKey: '',
    menuClickTarget: 'wrapper',
    dialog: null,
    actionLog: [],
    pageActions: [],
  }

  const result = await runVoucherScript({
    scriptRelPath: 'adapters/shopee-plus-v2/voucher-create.js',
    params: { input_file: { rows: [buildBaseRow('回购买家优惠券')] } },
    shared: { shopId: '804281004', result: {} },
    document: buildScenarioDocument(state),
    href: 'https://seller.shopee.cn/portal/marketing/vouchers/list?cnsc_shop_id=804281004',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'resolve_existing_vouchers')
  assert.deepEqual(state.actionLog, [{
    action: '结束',
    rowKey: 'repurchase-wrapper-more-conflict',
    tab: '进行中的活动',
    page: 1,
  }])
})

test('voucher-create prefers cdp clicks first for 更多 in a real browser runtime', async () => {
  const state = {
    activeTab: '全部',
    currentPageByTab: {
      '接下来的活动': 1,
      '进行中的活动': 1,
    },
    pagesByTab: {
      '接下来的活动': [[]],
      '进行中的活动': [[
        {
          key: 'repurchase-cdp-more-conflict',
          kind: 'ongoing',
          text: '进行中的活动 12%back 优惠券码：BACK-CDP-MORE 回购买家优惠券 全部商品 重复购买买家 12%折扣 350 2 2026/04/24 20:00 - 2026/05/05 23:59 更多',
        },
      ]],
    },
    menuRowKey: '',
    dialog: null,
    actionLog: [],
    pageActions: [],
  }

  const result = await runVoucherScript({
    scriptRelPath: 'adapters/shopee-plus-v2/voucher-create.js',
    params: { input_file: { rows: [buildBaseRow('回购买家优惠券')] } },
    shared: { shopId: '804281004', result: {} },
    document: buildScenarioDocument(state),
    href: 'https://seller.shopee.cn/portal/marketing/vouchers/list?cnsc_shop_id=804281004',
    userAgent: 'Mozilla/5.0 Chrome/125.0.0.0 Safari/537.36',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'cdp_clicks')
  assert.equal(result.meta.next_phase, 'resolve_existing_vouchers')
  assert.equal(result.meta.shared.conflict_cdp_row_key, 'BACK-CDP-MORE')
  assert.equal(result.meta.shared.conflict_cdp_step, 'menu_opened')
  assert.equal((result.meta.clicks || []).length, 1)
})

test('voucher-create falls back to cdp clicks when dropdown end action ignores DOM clicks', async () => {
  const state = {
    activeTab: '全部',
    currentPageByTab: {
      '接下来的活动': 1,
      '进行中的活动': 1,
    },
    pagesByTab: {
      '接下来的活动': [[]],
      '进行中的活动': [[
        {
          key: 'repurchase-cdp-end-conflict',
          kind: 'ongoing',
          text: '进行中的活动 12%back 优惠券码：BACK4 回购买家优惠券 全部商品 重复购买买家 12%折扣 350 2 2026/04/24 20:00 - 2026/05/05 23:59 更多',
        },
      ]],
    },
    menuRowKey: '',
    menuClickTarget: 'cdp',
    dialog: null,
    actionLog: [],
    pageActions: [],
  }

  const result = await runVoucherScript({
    scriptRelPath: 'adapters/shopee-plus-v2/voucher-create.js',
    params: { input_file: { rows: [buildBaseRow('回购买家优惠券')] } },
    shared: { shopId: '804281004', result: {} },
    document: buildScenarioDocument(state),
    href: 'https://seller.shopee.cn/portal/marketing/vouchers/list?cnsc_shop_id=804281004',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'cdp_clicks')
  assert.equal(result.meta.next_phase, 'resolve_existing_vouchers')
  assert.equal(result.meta.shared.conflict_cdp_row_key, 'BACK4')
  assert.equal(result.meta.shared.conflict_cdp_step, 'dialog_opened')
  assert.equal((result.meta.clicks || []).length, 1)
})

test('voucher-create confirms the pending end dialog after cdp fallback re-entry', async () => {
  const state = {
    activeTab: '全部',
    currentPageByTab: {
      '接下来的活动': 1,
      '进行中的活动': 1,
    },
    pagesByTab: {
      '接下来的活动': [[]],
      '进行中的活动': [[
        {
          key: 'repurchase-cdp-end-conflict',
          kind: 'ongoing',
          text: '进行中的活动 12%back 优惠券码：BACK4 回购买家优惠券 全部商品 重复购买买家 12%折扣 350 2 2026/04/24 20:00 - 2026/05/05 23:59 更多',
        },
      ]],
    },
    menuRowKey: '',
    menuClickTarget: 'cdp',
    dialog: {
      action: '结束',
      rowKey: 'repurchase-cdp-end-conflict',
      tab: '进行中的活动',
      page: 1,
    },
    actionLog: [],
    pageActions: [],
  }

  const result = await runVoucherScript({
    scriptRelPath: 'adapters/shopee-plus-v2/voucher-create.js',
    params: { input_file: { rows: [buildBaseRow('回购买家优惠券')] } },
    shared: {
      shopId: '804281004',
      result: {},
      conflict_cdp_row_key: 'BACK4',
      conflict_cdp_step: 'dialog_opened',
    },
    document: buildScenarioDocument(state),
    href: 'https://seller.shopee.cn/portal/marketing/vouchers/list?cnsc_shop_id=804281004',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'resolve_existing_vouchers')
})

test('voucher-create recognizes MM/DD/YYYY list ranges when ending a follow-prize conflict row', async () => {
  const state = {
    activeTab: '全部',
    currentPageByTab: {
      '接下来的活动': 1,
      '进行中的活动': 1,
    },
    pagesByTab: {
      '接下来的活动': [[]],
      '进行中的活动': [[
        {
          key: 'follow-ph-conflict',
          kind: 'ongoing',
          buttons: ['结束'],
          text: '进行中的活动 20% 优惠券码：SFP-1384530292269056 关注礼优惠券 全部商品 店铺粉丝 20%折扣 500 0 03/26/2026 15:04 - 05/08/2026 23:59 结束',
        },
      ]],
    },
    menuRowKey: '',
    dialog: null,
    actionLog: [],
    pageActions: [],
  }

  const result = await runVoucherScript({
    scriptRelPath: 'adapters/shopee-plus-v2/voucher-create.js',
    params: {
      input_file: {
        rows: [{
          ...buildBaseRow('关注礼优惠券'),
          站点: '菲律宾',
          店铺: 'balabala2023.ph',
          '优惠券领取期限（开始）精确到分': '2026/03/26-15:04:00',
          '优惠券领取期限（结束）精确到分': '2026/05/08-23:59:00',
        }],
      },
    },
    shared: { shopId: '1022810483', result: {} },
    document: buildScenarioDocument(state),
    href: 'https://seller.shopee.cn/portal/marketing/vouchers/list?cnsc_shop_id=1022810483',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'resolve_existing_vouchers')
  assert.deepEqual(state.actionLog, [{
    action: '结束',
    rowKey: 'follow-ph-conflict',
    tab: '进行中的活动',
    page: 1,
  }])
})

test('voucher-create does not click the same resolved conflict row twice even if it still remains visible', async () => {
  const state = {
    activeTab: '全部',
    currentPageByTab: {
      '接下来的活动': 1,
      '进行中的活动': 1,
    },
    pagesByTab: {
      '接下来的活动': [[]],
      '进行中的活动': [[
        {
          key: 'resolved-persist',
          kind: 'ongoing',
          buttons: ['结束'],
          text: '进行中的活动 12%back 优惠券码：BACK-PERSIST 回购买家优惠券 全部商品 重复购买买家 12%折扣 350 2 2026/04/01 00:00 - 2026/04/29 17:04 结束',
        },
      ]],
    },
    menuRowKey: '',
    dialog: null,
    actionLog: [],
    pageActions: [],
  }

  const firstPass = await runVoucherScript({
    scriptRelPath: 'adapters/shopee-plus-v2/voucher-create.js',
    params: { input_file: { rows: [buildBaseRow('回购买家优惠券')] } },
    shared: { shopId: '804281004', result: {} },
    document: buildScenarioDocument(state),
    href: 'https://seller.shopee.cn/portal/marketing/vouchers/list?cnsc_shop_id=804281004',
  })

  assert.equal(firstPass.success, true)
  assert.equal(firstPass.meta.next_phase, 'resolve_existing_vouchers')
  assert.deepEqual(state.actionLog, [{
    action: '结束',
    rowKey: 'resolved-persist',
    tab: '进行中的活动',
    page: 1,
  }])

  const secondPass = await runVoucherScript({
    scriptRelPath: 'adapters/shopee-plus-v2/voucher-create.js',
    params: { input_file: { rows: [buildBaseRow('回购买家优惠券')] } },
    shared: firstPass.meta.shared,
    document: buildScenarioDocument(state),
    href: 'https://seller.shopee.cn/portal/marketing/vouchers/list?cnsc_shop_id=804281004',
  })

  assert.equal(secondPass.success, true)
  assert.equal(secondPass.meta.next_phase, 'open_usecase_form')
  assert.equal(state.actionLog.length, 1)
})

test('voucher-create keeps resolved conflict row keys across reopen so lingering follow-prize rows are not ended twice', async () => {
  const state = {
    activeTab: '全部',
    currentPageByTab: {
      '接下来的活动': 1,
      '进行中的活动': 1,
    },
    pagesByTab: {
      '接下来的活动': [[]],
      '进行中的活动': [[
        {
          key: 'follow-persist',
          kind: 'ongoing',
          buttons: ['结束'],
          text: '进行中的活动 20% 优惠券码：SFP-1384530292269056 关注礼优惠券 全部商品 店铺粉丝 20%折扣 500 0 03/26/2026 15:04 - 05/08/2026 23:59 结束',
        },
      ]],
    },
    menuRowKey: '',
    dialog: null,
    actionLog: [],
    pageActions: [],
  }

  const row = {
    ...buildBaseRow('关注礼优惠券'),
    站点: '菲律宾',
    店铺: 'balabala2023.ph',
    '优惠券领取期限（开始）精确到分': '2026/03/26-15:04:00',
    '优惠券领取期限（结束）精确到分': '2026/05/08-23:59:00',
  }

  const cleanupPass = await runVoucherScript({
    scriptRelPath: 'adapters/shopee-plus-v2/voucher-create.js',
    phase: 'resolve_submit_conflicts',
    params: { input_file: { rows: [row] } },
    shared: { shopId: '1022810483', result: {}, submit_conflict_retry_count: 1 },
    document: buildScenarioDocument(state),
    href: 'https://seller.shopee.cn/portal/marketing/vouchers/list?cnsc_shop_id=1022810483',
  })

  assert.equal(cleanupPass.success, true)
  assert.equal(cleanupPass.meta.next_phase, 'open_usecase_form')
  assert.deepEqual(state.actionLog, [{
    action: '结束',
    rowKey: 'follow-persist',
    tab: '进行中的活动',
    page: 1,
  }])
  assert.equal(
    Array.from(cleanupPass.meta.shared.resolved_conflict_row_keys || []).join(','),
    'SFP-1384530292269056'
  )
  assert.equal(cleanupPass.meta.shared.submit_conflict_cleanup_round, 1)

  const reopenPass = await runVoucherScript({
    scriptRelPath: 'adapters/shopee-plus-v2/voucher-create.js',
    phase: 'open_usecase_form',
    params: { input_file: { rows: [row] } },
    shared: cleanupPass.meta.shared,
    document: buildScenarioDocument(state),
    href: 'https://seller.shopee.cn/portal/marketing/vouchers/list?cnsc_shop_id=1022810483',
  })

  assert.equal(reopenPass.success, true)
  assert.equal(reopenPass.meta.next_phase, 'open_usecase_form')
  assert.equal(
    Array.from(reopenPass.meta.shared.resolved_conflict_row_keys || []).join(','),
    'SFP-1384530292269056'
  )
  assert.equal(reopenPass.meta.shared.submit_conflict_cleanup_round, 1)

  const secondCleanupPass = await runVoucherScript({
    scriptRelPath: 'adapters/shopee-plus-v2/voucher-create.js',
    phase: 'resolve_submit_conflicts',
    params: { input_file: { rows: [row] } },
    shared: reopenPass.meta.shared,
    document: buildScenarioDocument(state),
    href: 'https://seller.shopee.cn/portal/marketing/vouchers/list?cnsc_shop_id=1022810483',
  })

  assert.equal(secondCleanupPass.success, true)
  assert.equal(secondCleanupPass.meta.next_phase, 'open_usecase_form')
  assert.equal(state.actionLog.length, 1)
})

test('live-voucher-create resets to page 1 then paginates upcoming tab before deleting a conflicting voucher', async () => {
  const state = {
    activeTab: '接下来的活动',
    currentPageByTab: {
      '接下来的活动': 2,
      '进行中的活动': 1,
    },
    pagesByTab: {
      '接下来的活动': [
        [
          { key: 'upcoming-safe', kind: 'upcoming', text: '接下来的活动 SAFE-LIVE 优惠券码：LIVE1 直播优惠券 全部商品 所有买家 20%折扣 20 0 2026/05/10 00:00 - 2026/05/12 23:59 删除' },
        ],
        [
          { key: 'upcoming-conflict', kind: 'upcoming', text: '接下来的活动 CONFLICT-LIVE 优惠券码：LIVE2 直播优惠券 全部商品 所有买家 20%折扣 20 0 2026/04/24 20:00 - 2026/05/05 23:59 删除' },
        ],
      ],
      '进行中的活动': [[]],
    },
    menuRowKey: '',
    dialog: null,
    actionLog: [],
    pageActions: [],
  }

  const liveRow = {
    ...buildBaseRow('直播优惠券'),
    优惠商品范围: '全部商品',
  }

  const result = await runVoucherScript({
    scriptRelPath: 'adapters/shopee-plus-v2/live-voucher-create.js',
    params: { input_file: { rows: [liveRow] } },
    shared: { shopId: '804281004', result: {} },
    document: buildScenarioDocument(state),
    href: 'https://seller.shopee.cn/portal/marketing/vouchers/list?cnsc_shop_id=804281004',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'resolve_existing_vouchers')
  assert.equal(state.actionLog.length, 1)
  assert.deepEqual(state.actionLog[0], {
    action: '删除',
    rowKey: 'upcoming-conflict',
    tab: '接下来的活动',
    page: 2,
  })
  assert.equal(state.pageActions.some(item => item.type === 'page' && item.targetPage === 1), true)
  assert.equal(state.pageActions.some(item => item.type === 'next' && item.tab === '接下来的活动' && item.targetPage === 2), true)
})

test('voucher-create does not treat another voucher type as repurchase just because the name contains 回购', async () => {
  const state = {
    activeTab: '全部',
    currentPageByTab: {
      '接下来的活动': 1,
      '进行中的活动': 1,
    },
    pagesByTab: {
      '接下来的活动': [[]],
      '进行中的活动': [[
        {
          key: 'brand-member-row',
          kind: 'ongoing',
          buttons: ['订单'],
          cells: [
            '回购-选90天，购买次数大于等于1 优惠券码：SFC-1387485062918144',
            '品牌会员优惠券',
            '全部商品',
            '店铺会员',
            '13%折扣',
            '500',
            '4',
            '2026/04/01 16:57 - 2026/05/01 23:59',
          ],
          text: '进行中的活动 回购-选90天，购买次数大于等于1 优惠券码：SFC-1387485062918144 品牌会员优惠券 全部商品 店铺会员 13%折扣 500 4 2026/04/01 16:57 - 2026/05/01 23:59 订单',
        },
      ]],
    },
    menuRowKey: '',
    dialog: null,
    actionLog: [],
    pageActions: [],
  }

  const result = await runVoucherScript({
    scriptRelPath: 'adapters/shopee-plus-v2/voucher-create.js',
    params: { input_file: { rows: [buildBaseRow('回购买家优惠券')] } },
    shared: { shopId: '1022810113', result: {} },
    document: buildScenarioDocument(state),
    href: 'https://seller.shopee.cn/portal/marketing/vouchers/list?cnsc_shop_id=1022810113',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'open_usecase_form')
  assert.equal(state.actionLog.length, 0)
})

test('voucher-create falls back to conflict cleanup from post_submit for second-order voucher duplicate message', async () => {
  const state = {
    activeTab: '全部',
    currentPageByTab: {
      '接下来的活动': 1,
      '进行中的活动': 1,
    },
    pagesByTab: {
      '接下来的活动': [[]],
      '进行中的活动': [[]],
    },
    inlineErrors: ['Please create a new second order voucher after the existing one is expired'],
    bodyText: '创建优惠券 表单校验失败',
    menuRowKey: '',
    dialog: null,
    actionLog: [],
    pageActions: [],
  }

  const result = await runVoucherScript({
    scriptRelPath: 'adapters/shopee-plus-v2/voucher-create.js',
    phase: 'post_submit',
    params: { input_file: { rows: [buildBaseRow('回购买家优惠券')] } },
    shared: { shopId: '804281004', result: {} },
    document: buildScenarioDocument(state),
    href: 'https://seller.shopee.cn/portal/marketing/vouchers/new?cnsc_shop_id=804281004',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'resolve_submit_conflicts')
  assert.equal(result.meta.shared.submit_conflict_retry_count, 1)
})

test('voucher-create falls back to conflict cleanup from post_submit for shop welcome voucher duplicate message', async () => {
  const state = {
    activeTab: '全部',
    currentPageByTab: {
      '接下来的活动': 1,
      '进行中的活动': 1,
    },
    pagesByTab: {
      '接下来的活动': [[]],
      '进行中的活动': [[]],
    },
    inlineErrors: ['Please create a new shop welcome voucher after the existing one is expired'],
    bodyText: '创建优惠券 表单校验失败',
    menuRowKey: '',
    dialog: null,
    actionLog: [],
    pageActions: [],
  }

  const result = await runVoucherScript({
    scriptRelPath: 'adapters/shopee-plus-v2/voucher-create.js',
    phase: 'post_submit',
    params: { input_file: { rows: [buildBaseRow('新买家优惠券')] } },
    shared: { shopId: '804281004', result: {} },
    document: buildScenarioDocument(state),
    href: 'https://seller.shopee.cn/portal/marketing/vouchers/new?cnsc_shop_id=804281004',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'resolve_submit_conflicts')
  assert.equal(result.meta.shared.submit_conflict_retry_count, 1)
})

test('voucher-create falls back to conflict cleanup when follow-prize duplicate message only appears in claim period region text', async () => {
  const state = {
    activeTab: '全部',
    currentPageByTab: {
      '接下来的活动': 1,
      '进行中的活动': 1,
    },
    pagesByTab: {
      '接下来的活动': [[]],
      '进行中的活动': [[]],
    },
    bodyText: '创建新优惠券 Claim Period 这个时段已存在另一个关注礼优惠券，请选择另一时段。 取消 确认',
    menuRowKey: '',
    dialog: null,
    actionLog: [],
    pageActions: [],
  }

  const result = await runVoucherScript({
    scriptRelPath: 'adapters/shopee-plus-v2/voucher-create.js',
    phase: 'post_submit',
    params: { input_file: { rows: [buildBaseRow('关注礼优惠券')] } },
    shared: { shopId: '804281004', result: {} },
    document: buildScenarioDocument(state),
    href: 'https://seller.shopee.cn/portal/marketing/follow-prize/new?cnsc_shop_id=804281004',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'resolve_submit_conflicts')
  assert.equal(result.meta.shared.submit_conflict_retry_count, 1)
})

test('voucher-create fallback cleanup sweeps all matching conflicts before reopening the create form', async () => {
  const state = {
    activeTab: '全部',
    currentPageByTab: {
      '接下来的活动': 1,
      '进行中的活动': 1,
    },
    pagesByTab: {
      '接下来的活动': [[
        {
          key: 'upcoming-conflict',
          kind: 'upcoming',
          text: '接下来的活动 UPCOMING 优惠券码：UP1 回购买家优惠券 全部商品 重复购买买家 12%折扣 350 0 2026/04/24 20:00 - 2026/05/05 23:59 删除',
        },
      ]],
      '进行中的活动': [[
        {
          key: 'ongoing-conflict',
          kind: 'ongoing',
          text: '进行中的活动 ONGOING 优惠券码：ON1 回购买家优惠券 全部商品 重复购买买家 12%折扣 350 2 2026/04/24 20:00 - 2026/05/05 23:59 更多',
        },
      ]],
    },
    menuRowKey: '',
    dialog: null,
    actionLog: [],
    pageActions: [],
  }

  const result = await runVoucherScript({
    scriptRelPath: 'adapters/shopee-plus-v2/voucher-create.js',
    phase: 'resolve_submit_conflicts',
    params: { input_file: { rows: [buildBaseRow('回购买家优惠券')] } },
    shared: { shopId: '804281004', result: {}, submit_conflict_retry_count: 1 },
    document: buildScenarioDocument(state),
    href: 'https://seller.shopee.cn/portal/marketing/vouchers/list?cnsc_shop_id=804281004',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'open_usecase_form')
  assert.deepEqual(state.actionLog, [
    {
      action: '删除',
      rowKey: 'upcoming-conflict',
      tab: '接下来的活动',
      page: 1,
    },
    {
      action: '结束',
      rowKey: 'ongoing-conflict',
      tab: '进行中的活动',
      page: 1,
    },
  ])
})

test('voucher-create scans every page in both tabs before continuing when no conflict exists', async () => {
  const state = {
    activeTab: '全部',
    currentPageByTab: {
      '接下来的活动': 1,
      '进行中的活动': 1,
    },
    pagesByTab: {
      '接下来的活动': [
        [
          { key: 'upcoming-safe-1', kind: 'upcoming', text: '接下来的活动 SAFE-UP-1 优惠券码：UP1 店铺优惠券 全部商品 所有买家 20%折扣 20 0 2026/05/10 00:00 - 2026/05/12 23:59 删除' },
        ],
        [
          { key: 'upcoming-safe-2', kind: 'upcoming', text: '接下来的活动 SAFE-UP-2 优惠券码：UP2 店铺优惠券 全部商品 所有买家 20%折扣 20 0 2026/05/13 00:00 - 2026/05/14 23:59 删除' },
        ],
      ],
      '进行中的活动': [
        [
          { key: 'ongoing-safe-1', kind: 'ongoing', text: '进行中的活动 SAFE-ON-1 优惠券码：ON1 店铺优惠券 全部商品 所有买家 20%折扣 20 0 2026/05/10 00:00 - 2026/05/12 23:59 更多' },
        ],
        [
          { key: 'ongoing-safe-2', kind: 'ongoing', text: '进行中的活动 SAFE-ON-2 优惠券码：ON2 店铺优惠券 全部商品 所有买家 20%折扣 20 0 2026/05/13 00:00 - 2026/05/14 23:59 更多' },
        ],
      ],
    },
    menuRowKey: '',
    dialog: null,
    actionLog: [],
    pageActions: [],
  }

  const result = await runVoucherScript({
    scriptRelPath: 'adapters/shopee-plus-v2/voucher-create.js',
    params: { input_file: { rows: [buildBaseRow('商店优惠券')] } },
    shared: { shopId: '804281004', result: {} },
    document: buildScenarioDocument(state),
    href: 'https://seller.shopee.cn/portal/marketing/vouchers/list?cnsc_shop_id=804281004',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'open_usecase_form')
  assert.equal(state.actionLog.length, 0)
  assert.equal(state.pageActions.filter(item => item.type === 'next' && item.tab === '接下来的活动').length, 1)
  assert.equal(state.pageActions.filter(item => item.type === 'next' && item.tab === '进行中的活动').length, 1)
})
