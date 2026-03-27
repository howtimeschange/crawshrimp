/**
 * Shopee+ 优惠券批量创建脚本
 *
 * 架构：
 *   runner 驱动外层循环（page = Excel row index），
 *   脚本内部用 phase 状态机处理多步骤 CDP 交互。
 *
 * 关键协议（与 js_runner.py 配合）：
 *   return { success, data, meta: { action: 'cdp_clicks', clicks, next_phase, sleep_ms, shared } }
 *   return { success, data, meta: { action: 'next_phase', next_phase, sleep_ms, shared } }
 *   return { success, data, meta: { action: 'complete', has_more, page, total, shared } }
 *
 * CDP 点击坐标格式：{ x, y, delay_ms, label }
 */
;(async () => {
  // ─── 全局上下文 ────────────────────────────────────────────────────────────────
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page   = window.__CRAWSHRIMP_PAGE__   || 1
  const phase  = window.__CRAWSHRIMP_PHASE__  || 'init'
  const shared = window.__CRAWSHRIMP_SHARED__  || {}
  const rows   = params.input_file?.rows      || []

  // ─── 常量 ─────────────────────────────────────────────────────────────────────
  const MARKETING_URL = 'https://seller.shopee.cn/portal/marketing'
  const VOUCHER_LIST_URL = 'https://seller.shopee.cn/portal/marketing/vouchers/list'

  const row = rows[page - 1]
  if (!row) {
    return { success: true, data: [], meta: { action: 'complete', has_more: false, page, total: rows.length } }
  }

  // ─── 持久化状态（挂在 window 上，跨 phase 保留）───────────────────────────────
  // 用于记住当前在哪个店铺，避免重复切换
  const currentStore = shared._currentStore || ''
  const rowIndex    = shared._rowIndex      || 0

  // ─── 工具函数 ────────────────────────────────────────────────────────────────
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  const norm  = (s) => String(s || '').replace(/\s+/g, ' ').trim()
  const textOf = (el) => norm(el?.innerText || el?.textContent || el?.value || '')

  const digitsOnly = (v) => String(v ?? '').replace(/,/g, '').trim()

  const toNumber = (v) => {
    const s = digitsOnly(v).replace(/%$/, '').trim()
    const n = Number(s)
    return Number.isNaN(n) ? s : n
  }

  // 优惠限额：0.05（小数）=> 5（百分比），金额保持原值
  const discountLimitValue = (raw, discountType) => {
    const n = toNumber(raw)
    if (typeof n === 'number' && /百分比|percentage/i.test(discountType || '') && n > 0 && n <= 1) {
      return String(Math.round(n * 100))
    }
    return String(n)
  }

  const boolLike = (v) =>
    String(v || '').trim() === '1' || /^(是|true|yes|y)$/i.test(String(v || '').trim())

  const randCode = (n = 5) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let out = ''
    for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * chars.length)]
    return out
  }

  // 解析 "2026-04-01" 或 "2026/04/01" 或 "2026-04-01 14:30"
  const parseDateTime = (raw, kind) => {
    const s = norm(raw)
    if (!s) return null
    const m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[T\s-](\d{1,2})(?::(\d{1,2}))?)?$/)
    if (!m) return null
    const y = m[1], mo = String(m[2]).padStart(2, '0'), d = String(m[3]).padStart(2, '0')
    const hh = m[4] != null ? String(m[4]).padStart(2, '0') : (kind === 'start' ? '00' : '23')
    const mm = m[5] != null ? String(m[5]).padStart(2, '0') : (kind === 'start' ? '00' : '59')
    return { y, mo, d, hh, mm, str: `${y}-${mo}-${d} ${hh}:${mm}` }
  }

  const visible = (el) => {
    if (!el) return false
    const st = getComputedStyle(el)
    const r  = el.getBoundingClientRect()
    return st.visibility !== 'hidden' && st.display !== 'none' && r.width > 0 && r.height > 0
  }

  async function waitFor(fn, timeout = 10000, interval = 300) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const r = fn()
      if (r) return r
      await sleep(interval)
    }
    return null
  }

  // 获取元素中心点坐标（用于 CDP click）
  const rectCenter = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return null
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }

  // 派发合成鼠标事件（用于非 React 元素，或 React 的非关键交互）
  function dispatchSyntheticClick(el) {
    if (!el) return false
    try { el.scrollIntoView({ block: 'center' }) } catch {}
    try { el.focus?.() } catch {}
    const opts = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1, detail: 1 }
    try {
      if (typeof PointerEvent === 'function') {
        el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse', isPrimary: true }))
      }
    } catch {}
    for (const ev of ['mousedown', 'mouseup', 'click']) {
      try { el.dispatchEvent(new MouseEvent(ev, opts)) } catch {}
    }
    try { el.click?.() } catch {}
    return true
  }

  // 设置 input 的原生值（用于 React controlled input）
  function setNativeValue(el, value) {
    if (!el) return false
    const val = String(value ?? '')
    const last = el.value
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const desc = Object.getOwnPropertyDescriptor(proto, 'value')
    if (desc?.set) desc.set.call(el, val)
    else el.value = val
    try {
      const tracker = el._valueTracker
      if (tracker && typeof tracker.setValue === 'function') tracker.setValue(last)
    } catch {}
    el.dispatchEvent(new Event('input',  { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.dispatchEvent(new Event('blur',   { bubbles: true }))
    return true
  }

  async function typeInto(el, value) {
    dispatchSyntheticClick(el)
    await sleep(80)
    try { el.focus() } catch {}
    setNativeValue(el, value)
    await sleep(200)
  }

  // 关闭可能遮挡操作的弹窗
  async function closeBlockingOverlays() {
    for (const sel of ['.fullstory-modal-wrapper', '.diagnosis-result-modal']) {
      [...document.querySelectorAll(sel)].forEach(el => { try { el.remove() } catch {} })
    }
    for (const btn of [...document.querySelectorAll('button')]) {
      const t = textOf(btn)
      if (!visible(btn)) continue
      if (!/^(关闭|知道了|稍后)$/.test(t)) continue
      const scope = btn.closest('[role="dialog"], .eds-modal, .eds-drawer, .shopee-modal')
      if (!scope) continue
      try { dispatchSyntheticClick(btn) } catch {}
    }
    await sleep(100)
  }

  // ─── 表单工具 ───────────────────────────────────────────────────────────────────
  function getFormItem(labelText) {
    const labels = Array.isArray(labelText) ? labelText.map(norm) : [norm(labelText)]
    return [...document.querySelectorAll('.eds-react-form-item')].find(el => {
      const lbl = el.querySelector('.eds-react-form-item__label')
      const t   = norm(lbl?.textContent)
      return t && labels.some(x => t.includes(x))
    }) || null
  }

  function getTextInputs(container) {
    return [...(container || document).querySelectorAll('input:not([type=radio]):not([type=checkbox]), textarea')]
      .filter(visible)
  }

  async function fillField(labelText, value, inputIndex = 0) {
    const item = getFormItem(labelText)
    if (!item) throw new Error(`未找到表单项：${labelText}`)
    const inputs = getTextInputs(item)
    const el = inputs[inputIndex]
    if (!el) throw new Error(`表单项"${labelText}"没有可编辑 input（找到 ${inputs.length} 个）`)
    await typeInto(el, value)
    return el
  }

  function getFormItemControl(item) {
    return item?.querySelector('.eds-react-form-item__control, .eds-form-item__control') || item
  }

  function reactPropsOf(el) {
    const k = Object.keys(el || {}).find(x => x.startsWith('__reactProps'))
    return k ? el[k] : null
  }

  // ─── 店铺切换 ───────────────────────────────────────────────────────────────────
  function getStoreText() {
    const el = document.querySelector('.shop-switcher, .shop-switcher-container, .shop-select, .shop-info, .shop-label')
    if (el && visible(el)) return textOf(el.closest('.shop-info') || el.parentElement || el)
    const all = [...document.querySelectorAll('div, span')]
      .filter(e => visible(e) && textOf(e).startsWith('当前店铺'))
    return all.length ? textOf(all[0]) : ''
  }

  function buildVoucherListUrl(shopId) {
    const u = new URL(VOUCHER_LIST_URL)
    if (shopId) u.searchParams.set('cnsc_shop_id', shopId)
    return u.toString()
  }

  function getUrlShopId() {
    try {
      return new URL(location.href).searchParams.get('cnsc_shop_id') || ''
    } catch { return '' }
  }

  // ─── 券种配置 ───────────────────────────────────────────────────────────────────
  const VOUCHER_TYPE_MAP = {
    '商店优惠券':     { usecase: '1',  testId: 'voucherEntry1',  aliases: ['商店优惠券'] },
    '新买家优惠券':   { usecase: '3',  testId: 'voucherEntry3',  aliases: ['新买家优惠券', '新买家'] },
    '回购买家优惠券': { usecase: '4',  testId: 'voucherEntry4',  aliases: ['回购买家优惠券', '回购'] },
    '关注礼优惠券':   { usecase: '999', testId: 'voucherEntry999', aliases: ['关注礼优惠券', '关注礼'] },
  }

  function getVoucherMeta(voucherType) {
    return VOUCHER_TYPE_MAP[voucherType] || { usecase: '', testId: '', aliases: [voucherType] }
  }

  function buildCreateUrl(voucherType, shopId) {
    const meta = getVoucherMeta(voucherType)
    if (!meta.usecase) throw new Error(`未配置的券种：${voucherType}`)
    const base = meta.usecase === '999'
      ? 'https://seller.shopee.cn/portal/marketing/follow-prize/new'
      : 'https://seller.shopee.cn/portal/marketing/vouchers/new'
    const u = new URL(base)
    if (meta.usecase !== '999') u.searchParams.set('usecase', meta.usecase)
    if (shopId) u.searchParams.set('cnsc_shop_id', shopId)
    return u.toString()
  }

  // ─── 结果构建 ───────────────────────────────────────────────────────────────────
  function buildResult(overrides = {}) {
    return {
      '序号':                    page,
      '队列总数':                rows.length,
      '站点':                    norm(row['站点'] || ''),
      '店铺':                    norm(row['店铺'] || ''),
      '优惠券品类':              norm(row['优惠券品类'] || ''),
      '奖励类型':                norm(row['奖励类型'] || ''),
      '折扣类型':                norm(row['折扣类型'] || ''),
      '优惠限额':                discountLimitValue(row['优惠限额'] || '', row['折扣类型'] || ''),
      '生成优惠券名称':          shared.couponName || '',
      '生成优惠码':              shared.couponCode || '',
      '执行状态':                '待执行',
      '错误原因':                '',
      ...overrides,
    }
  }

  // ─── 协议返回 ──────────────────────────────────────────────────────────────────
  // CDP 点击 + 阶段切换
  const cdpPhase = (clicks, nextPhase, sleepMs = 300, extras = {}) => ({
    success: true,
    data: [],
    meta: {
      action: 'cdp_clicks',
      clicks: clicks || [],
      next_phase: nextPhase,
      sleep_ms: sleepMs,
      shared: { ...shared, ...extras },
    },
  })

  // 纯阶段切换
  const nextPhase = (nextPhase, sleepMs = 1200, extras = {}) => ({
    success: true,
    data: [],
    meta: {
      action: 'next_phase',
      next_phase: nextPhase,
      sleep_ms: sleepMs,
      shared: { ...shared, ...extras },
    },
  })

  // 完成当前行（无论成功失败）
  const finishRow = (result) => ({
    success: true,
    data: [result],
    meta: {
      action: 'complete',
      has_more: page < rows.length,
      page,
      total: rows.length,
      shared: {},
    },
  })

  // ─── 阶段处理 ──────────────────────────────────────────────────────────────────

  try {
    await closeBlockingOverlays()

    // ══════════════════════════════════════════════════════════════════════════════
    // INIT — 确定入口，决定是否需要导航
    // ══════════════════════════════════════════════════════════════════════════════
    if (phase === 'init') {
      const store       = norm(row['店铺'])
      const voucherType = norm(row['优惠券品类'])
      if (!store)       throw new Error('Excel 缺少"店铺"列')
      if (!voucherType) throw new Error('Excel 缺少"优惠券品类"列')

      const couponName = shared.couponName || (store + discountLimitValue(row['优惠限额'] || '', row['折扣类型'] || ''))
      const couponCode = shared.couponCode || randCode(5)
      const meta       = getVoucherMeta(voucherType)
      const result     = shared.result || buildResult({ '生成优惠券名称': couponName, '生成优惠码': couponCode })

      const curUrl   = location.href || ''
      const onMarket = curUrl.includes('/portal/marketing')
      const needNav  = (params.mode || 'current').trim().toLowerCase() === 'new' || !onMarket

      if (!onMarket) {
        location.href = MARKETING_URL
        return nextPhase('init', 3000, { couponName, couponCode, result, _rowIndex: page, _currentStore: store })
      }

      // 已在营销中心，检查店铺是否匹配
      const storeText = getStoreText()
      const storeMatch = storeText.includes(store) && (!row['站点'] || storeText.includes(norm(row['站点'] || '')))

      if (storeMatch && !needNav) {
        // 店铺已匹配，不需要重新切换
        return nextPhase('goto_list', 200, { couponName, couponCode, result, _rowIndex: page, _currentStore: store })
      }

      // 店铺不匹配或需要重新导航
      return nextPhase('store_switch', 300, { couponName, couponCode, result, _rowIndex: page, _currentStore: store })
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // GOTO_LIST — 导航到优惠券列表页
    // ══════════════════════════════════════════════════════════════════════════════
    if (phase === 'goto_list') {
      const store = shared._currentStore || norm(row['店铺'])
      const shopId = getUrlShopId()
      location.href = buildVoucherListUrl(shopId)
      return nextPhase('enter_type', 3000, { ...shared, _currentStore: store })
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // STORE_SWITCH — 搜索并切换到目标店铺
    // ══════════════════════════════════════════════════════════════════════════════
    if (phase === 'store_switch') {
      const store   = shared._currentStore || norm(row['店铺'])
      const site    = norm(row['站点'] || '')
      const result  = shared.result || buildResult()

      // 先确保在营销中心主页
      if (!location.href.includes('/portal/marketing')) {
        location.href = MARKETING_URL
        return nextPhase('store_switch', 3000, { ...shared, result })
      }

      const storeText = getStoreText()
      const matched = storeText.includes(store) && (!site || storeText.includes(site))

      if (matched) {
        // 店铺已匹配，导航到列表
        const shopId = getUrlShopId()
        location.href = buildVoucherListUrl(shopId)
        return nextPhase('enter_type', 3000, { ...shared, result })
      }

      // 需要搜索切换
      const searchInput = await waitFor(() =>
        [...document.querySelectorAll('input')].find(el =>
          visible(el) && (
            norm(el.placeholder).includes('搜索') ||
            el.closest('.shop-switcher, .shop-select, [class*="shopSwitch"], [class*="shop-switch"]')
          )
        ), 8000, 300
      )
      if (!searchInput) throw new Error('未找到店铺搜索框，请确认已打开营销中心主页')

      dispatchSyntheticClick(searchInput)
      await sleep(200)
      setNativeValue(searchInput, store)
      await sleep(1200)

      const candidate = await waitFor(() =>
        [...document.querySelectorAll('li, [role=option], [class*="shopItem"], [class*="shop-item"]')]
          .filter(visible)
          .find(el => {
            const t = textOf(el)
            if (!t.includes(store)) return false
            if (site && !t.includes(site)) return false
            return true
          })
      , 6000, 250)
      if (!candidate) throw new Error(`搜索后未找到店铺：${store}`)
      if (/没有权限|无权限/.test(textOf(candidate))) throw new Error(`店铺"${store}"无权限`)

      dispatchSyntheticClick(candidate)
      await sleep(2000)
      await closeBlockingOverlays()

      // 等待店铺名更新
      await waitFor(() => {
        const t = getStoreText()
        return t.includes(store) ? t : null
      }, 5000, 300)

      const verifyText = getStoreText()
      if (!verifyText.includes(store)) {
        const full = document.body.innerText
        if (!full.includes(store)) throw new Error(`切换店铺后未能确认，当前文本：${verifyText.substring(0, 80)}`)
      }

      const shopId = getUrlShopId()
      location.href = buildVoucherListUrl(shopId)
      return nextPhase('enter_type', 3000, { ...shared, result, _currentStore: store })
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // ENTER_TYPE — 进入券种创建页面
    // ══════════════════════════════════════════════════════════════════════════════
    if (phase === 'enter_type') {
      const store   = shared._currentStore || norm(row['店铺'])
      const voucherType = norm(row['优惠券品类'])
      const meta = getVoucherMeta(voucherType)
      const shopId = getUrlShopId()

      // 已经在创建页，直接进入
      if (location.href.includes('/portal/marketing/vouchers/new') ||
          location.href.includes('/portal/marketing/follow-prize/new')) {
        return nextPhase('form_fill', 200, { ...shared, _currentStore: store })
      }

      // 关注礼需要特殊路径（先去营销主页拿正确 shopId）
      if (meta.usecase === '999') {
        location.href = MARKETING_URL
        return nextPhase('follow_prize_nav', 2000, { ...shared, _currentStore: store })
      }

      // 从列表页的入口卡片进入
      // 先确保在列表页
      if (!location.href.includes('/portal/marketing/vouchers/list')) {
        location.href = buildVoucherListUrl(shopId)
        return nextPhase('enter_type', 3000, { ...shared, _currentStore: store })
      }

      // 展开"为特定买家"入口
      const expandBtn = [...document.querySelectorAll('button, a')].find(el =>
        visible(el) && textOf(el).includes('为特定买家提供更多种类的优惠券')
      )
      if (expandBtn) {
        dispatchSyntheticClick(expandBtn)
        await sleep(800)
      }

      // 找券种入口卡片
      let card = document.querySelector(`button[data-testid="${meta.testId}"]`)
      if (!card || !visible(card)) {
        card = [...document.querySelectorAll('button[data-testid^="voucherEntry"]')].find(el => {
          if (!visible(el)) return false
          return meta.aliases.some(a => textOf(el).includes(a))
        }) || null
      }
      if (!card) throw new Error(`未找到券种入口卡片：${voucherType}`)

      // 点击"创建"按钮
      const createBtn = [...card.querySelectorAll('button')]
        .find(el => visible(el) && /^(创建|去创建)$/.test(textOf(el))) || card
      dispatchSyntheticClick(createBtn)

      // 等待创建页出现
      const formReady = await waitFor(() => {
        const href = location.href || ''
        if (!href.includes('/vouchers/new') && !href.includes('/follow-prize/new')) return null
        const item = getFormItem('优惠券名称')
        return item && visible(item) ? item : null
      }, 12000, 300)
      if (!formReady) throw new Error(`点击创建后未能进入表单页，当前URL：${location.href.substring(0, 100)}`)

      // 预填优惠券名称和优惠码
      await sleep(300)
      await fillField('优惠券名称', shared.couponName || '')
      try { await fillField('优惠码', shared.couponCode || '') } catch {}

      return nextPhase('form_fill', 200, { ...shared, _currentStore: store })
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // FOLLOW_PRIZE_NAV — 关注礼：从主页拿到 shopId 后跳转 follow-prize/new
    // ══════════════════════════════════════════════════════════════════════════════
    if (phase === 'follow_prize_nav') {
      const voucherType = norm(row['优惠券品类'])
      const shopId = getUrlShopId()
      location.href = buildCreateUrl(voucherType, shopId)
      return nextPhase('enter_type', 3000)
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // FORM_FILL — 填写表单：名称+优惠码（已在 enter_type 预填）+ 领券期限
    // ══════════════════════════════════════════════════════════════════════════════
    if (phase === 'form_fill') {
      const result = shared.result || buildResult()
      const startDt = parseDateTime(row['优惠券领取期限（开始）精确到分'], 'start')
      const endDt   = parseDateTime(row['优惠券领取期限（结束）精确到分'], 'end')

      // 等表单加载
      const formReady = await waitFor(() => getFormItem('优惠券名称') || null, 10000, 400)
      if (!formReady) throw new Error(`创建表单未出现，当前URL：${location.href.substring(0, 100)}`)
      await sleep(300)

      // 兜底：名称和优惠码（enter_type 可能已填，try-catch 防止失败）
      try { await fillField('优惠券名称', shared.couponName || '') } catch {}
      try { await fillField('优惠码',     shared.couponCode || '') } catch {}

      // 领券期限处理
      const item = getFormItem(['优惠券领取期限', 'Claim Period'])
      if (item && item.querySelector('.picker-item.start-picker, .eds-react-date-picker__input')) {
        // EDS React 日期选择器 → 用 CDP
        if (startDt) {
          // 保存目标日期到 shared，跨 CDP 轮次保留
          return cdpPhase(
            [],
            'date_start_open',
            100,
            {
              ...shared,
              result,
              _startTarget:  startDt,
              _endTarget:    endDt,
            }
          )
        }
        if (endDt) {
          return cdpPhase(
            [],
            'date_end_open',
            100,
            { ...shared, result, _startTarget: null, _endTarget: endDt }
          )
        }
        return nextPhase('form_fill_rest', 100, { ...shared, result, _startTarget: null, _endTarget: null })
      }

      // Vue DateRangePicker 或无日期 picker → 纯 JS 处理
      if (startDt || endDt) {
        await setDateRangeJS(startDt, endDt)
      }

      return nextPhase('form_fill_rest', 100, { ...shared, result })
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // DATE PICKER — CDP 多阶段状态机（open → nav循环 → day → time → confirm → verify）
    // ══════════════════════════════════════════════════════════════════════════════

    // 辅助：找日期选择器面板
    function getDatePickerPanel(item) {
      const local = item?.querySelector('.eds-react-date-picker__panel-wrap, .eds-react-popover.eds-react-date-picker__popup')
      if (local && visible(local)) return local
      return [...document.querySelectorAll('.eds-react-popover.eds-react-date-picker__popup, .eds-react-date-picker__panel-wrap')]
        .find(el => visible(el) && /确认/.test(textOf(el))) || null
    }

    // 辅助：解析面板 Header（当前年月）
    const MONTH_MAP = {
      january:1, february:2, march:3, april:4, may:5, june:6,
      july:7, august:8, september:9, october:10, november:11, december:12,
      'jan':1,'feb':2,'mar':3,'apr':4,'may':5,'jun':6,
      'jul':7,'aug':8,'sep':9,'oct':10,'nov':11,'dec':12,
      '一月':1,'二月':2,'三月':3,'四月':4,'五月':5,'六月':6,
      '七月':7,'八月':8,'九月':9,'十月':10,'十一月':11,'十二月':12,
    }

    function getDatePickerHeader(panel) {
      if (!panel) return null
      const headerEl = panel.querySelector('.eds-react-date-picker__header, .date-box, .date-default-style')
      if (!headerEl) return null

      const texts = [...headerEl.querySelectorAll('button, span, i')]
        .filter(visible).map(el => textOf(el)).filter(t => t.length > 0)
      const headerText = textOf(headerEl)

      let year = null, month = null

      // 从分块文本提取
      for (const t of texts) {
        if (/^\d{4}年?$/.test(t)) year = Number(t.replace('年', ''))
        else if (/^\d{1,2}月$/.test(t)) month = Number(t.replace('月', ''))
        else {
          const enMatch = t.match(/([A-Za-z]+)/)
          if (enMatch && MONTH_MAP[enMatch[1].toLowerCase()]) month = MONTH_MAP[enMatch[1].toLowerCase()]
        }
      }
      // 从整体文本备用提取
      if (!year) {
        const ym = headerText.match(/(\d{4})/)
        if (ym) year = Number(ym[1])
      }
      if (!month) {
        const mm = headerText.match(/(\d{1,2})\s*月/)
        if (mm) month = Number(mm[1])
        else {
          const enMatch = headerText.match(/([A-Za-z]+)/)
          if (enMatch && MONTH_MAP[enMatch[1].toLowerCase()]) month = MONTH_MAP[enMatch[1].toLowerCase()]
        }
      }

      if (year && month && month >= 1 && month <= 12) return { year, month }
      return null
    }

    // 辅助：找导航按钮（宽 < 50px 的可点击元素）
    function getNavButtons(panel) {
      const header = panel.querySelector('.date-default-style, .date-box, .eds-react-date-picker__header')
      if (!header) return { prevMonth: null, nextMonth: null }
      const all = [
        ...header.querySelectorAll('button:has(svg), button:has(i)'),
        ...header.querySelectorAll('.eds-icon, svg'),
      ].filter(b => visible(b))
      const navBtns = all.filter(b => {
        const r = b.getBoundingClientRect()
        return r.width > 0 && r.width < 50 && r.height < 50
      }).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
      let prevMonth = null, nextMonth = null
      if (navBtns.length >= 4) { prevMonth = navBtns[1]; nextMonth = navBtns[navBtns.length - 2] }
      else if (navBtns.length >= 2) { prevMonth = navBtns[0]; nextMonth = navBtns[navBtns.length - 1] }
      return { prevMonth, nextMonth }
    }

    // ── date_start_open ─────────────────────────────────────────────────────────
    if (phase === 'date_start_open') {
      await sleep(500)
      const item = getFormItem(['优惠券领取期限', 'Claim Period'])
      if (!item) throw new Error('开始日期表单项未找到')
      const target = shared._startTarget
      if (!target) return nextPhase('date_end_open', 100, shared)

      const dateId = 'startDate'
      const trigger = (
        item.querySelector(`.picker-item.start-picker input.eds-react-input__input`) ||
        item.querySelector(`.picker-item.start-picker input.eds-react-date-picker__input`) ||
        item.querySelector(`.picker-item.start-picker #${dateId}`) ||
        item.querySelector(`.picker-item.start-picker input`) ||
        item.querySelector(`#${dateId}`) ||
        [...item.querySelectorAll('.eds-react-date-picker input, .eds-react-input input')].filter(visible)[0] ||
        null
      )
      if (!trigger) throw new Error(`开始日期触发器未找到`)
      const tc = rectCenter(trigger)
      if (!tc) throw new Error('开始日期触发器坐标为空')
      console.log(`[DATE] 开始日期触发: ${target.str}`)
      return cdpPhase([{ ...tc, delay_ms: 100, label: '开始日期触发器' }], 'date_start_nav', 500, shared)
    }

    // ── date_start_nav ──────────────────────────────────────────────────────────
    if (phase === 'date_start_nav') {
      const item   = getFormItem(['优惠券领取期限', 'Claim Period'])
      const target = shared._startTarget
      if (!item || !target) throw new Error('开始日期数据丢失')

      const panel = getDatePickerPanel(item)
      if (!panel) {
        // 面板未出现，重新触发
        const trigger = item.querySelector('.picker-item.start-picker input')
        const tc = rectCenter(trigger)
        if (tc) return cdpPhase([{ ...tc, delay_ms: 200, label: '重新触发' }], phase, 500, shared)
        throw new Error('开始日期面板消失')
      }

      const header = getDatePickerHeader(panel)
      if (!header) return cdpPhase([], phase, 500, shared)

      console.log(`[DATE] 开始: 当前 ${header.year}-${header.month} → 目标 ${target.year}-${target.month}`)

      if (header.year === target.year && header.month === target.month) {
        return cdpPhase([], 'date_start_day', 300, shared)
      }

      const nav = getNavButtons(panel)
      const delta = (target.year - header.year) * 12 + (target.month - header.month)
      const btn   = delta >= 0 ? nav.nextMonth : nav.prevMonth
      if (!btn) throw new Error('开始日期导航按钮未找到')
      const bc = rectCenter(btn)
      if (!bc) throw new Error('导航按钮坐标为空')
      return cdpPhase([{ ...bc, delay_ms: 200, label: '开始月份导航' }], phase, 100, shared)
    }

    // ── date_start_day ──────────────────────────────────────────────────────────
    if (phase === 'date_start_day') {
      const item   = getFormItem(['优惠券领取期限', 'Claim Period'])
      const target = shared._startTarget
      if (!item || !target) throw new Error('开始日期数据丢失')

      const panel = getDatePickerPanel(item)
      if (!panel) throw new Error('开始日期面板消失')

      const header = getDatePickerHeader(panel)
      if (header && (header.year !== target.year || header.month !== target.month)) {
        return cdpPhase([], 'date_start_nav', 200, shared)
      }

      const cells = [...panel.querySelectorAll('.eds-react-date-picker__table-cell, .eds-react-date-picker__table-cell-wrap')]
      const cell  = cells.find(c =>
        visible(c) &&
        norm(c.textContent) === String(Number(target.d)) &&
        !/disabled|out-of-range/.test(c.className || '')
      )
      if (!cell) throw new Error(`未找到开始日期格：${target.d}`)
      const cc = rectCenter(cell)
      if (!cc) throw new Error('开始日期格坐标为空')
      console.log(`[DATE] 点击开始日期: ${target.d}`)
      return cdpPhase([{ ...cc, delay_ms: 200, label: `开始日期${target.d}` }], 'date_start_time', 100, shared)
    }

    // ── date_start_time ──────────────────────────────────────────────────────────
    if (phase === 'date_start_time') {
      const item   = getFormItem(['优惠券领取期限', 'Claim Period'])
      const target = shared._startTarget
      if (!item || !target) throw new Error('开始日期数据丢失')

      const panel = getDatePickerPanel(item)
      const clicks = []
      if (panel) {
        const cols = [...panel.querySelectorAll('.eds-react-time-picker__tp-scrollbar')].filter(visible)
        if (cols.length >= 2) {
          const hourBox = [...cols[0].querySelectorAll('.time-box')]
            .find(el => visible(el) && norm(el.textContent) === target.hh)
          const minBox = [...cols[1].querySelectorAll('.time-box')]
            .find(el => visible(el) && norm(el.textContent) === target.mm)
          if (hourBox) { const c = rectCenter(hourBox); if (c) clicks.push({ ...c, delay_ms: 150, label: `开始时${target.hh}` }) }
          if (minBox)  { const c = rectCenter(minBox);  if (c) clicks.push({ ...c, delay_ms: 150, label: `开始分${target.mm}` }) }
        }
      }
      console.log(`[DATE] 开始时分 clicks: ${clicks.length}`)
      return cdpPhase(clicks, 'date_start_confirm', 100, shared)
    }

    // ── date_start_confirm ───────────────────────────────────────────────────────
    if (phase === 'date_start_confirm') {
      const item = getFormItem(['优惠券领取期限', 'Claim Period'])
      const panel = getDatePickerPanel(item)

      if (!panel) {
        // 面板已关闭（点日期格后自动关闭的情况），直接验证
        return cdpPhase([], 'date_start_verify', 300, shared)
      }

      const okBtn = [...panel.querySelectorAll('button')]
        .find(b => /^确认$|^确定$|^OK$/i.test(norm(b.textContent)) && visible(b))
      if (!okBtn) {
        console.log('[DATE] 未找到确认按钮，点击空白关闭')
        const bodyC = rectCenter(document.body)
        if (bodyC) return cdpPhase([{ ...bodyC, delay_ms: 300, label: '点击空白' }], 'date_start_verify', 200, shared)
        throw new Error('开始日期确认按钮未找到')
      }
      const oc = rectCenter(okBtn)
      if (!oc) throw new Error('开始确认按钮坐标为空')
      console.log('[DATE] 点击开始确认按钮')
      return cdpPhase([{ ...oc, delay_ms: 400, label: '开始确认' }], 'date_start_verify', 400, shared)
    }

    // ── date_start_verify ───────────────────────────────────────────────────────
    if (phase === 'date_start_verify') {
      await sleep(300)
      const item   = getFormItem(['优惠券领取期限', 'Claim Period'])
      const target = shared._startTarget
      const input  = item?.querySelector('.picker-item.start-picker input.eds-react-input__input')
      const val    = norm(input?.value || '')

      console.log(`[DATE] 验证开始: 期望「${target?.str}」，实际「${val}」`)

      if (target && !val.includes(target.str)) {
        throw new Error(`开始时间未写入成功，期望：${target.str}，实际：${val || '(空)'}`)
      }

      // 开始验证通过，处理结束日期
      if (shared._endTarget) {
        return cdpPhase([], 'date_end_open', 100, shared)
      }

      return nextPhase('form_fill_rest', 100, shared)
    }

    // ── date_end_open ───────────────────────────────────────────────────────────
    if (phase === 'date_end_open') {
      await sleep(500)
      const item = getFormItem(['优惠券领取期限', 'Claim Period'])
      if (!item) throw new Error('结束日期表单项未找到')
      const target = shared._endTarget
      if (!target) return nextPhase('form_fill_rest', 100, shared)

      const trigger = (
        item.querySelector(`.picker-item.end-picker input.eds-react-input__input`) ||
        item.querySelector(`.picker-item.end-picker input`) ||
        [...item.querySelectorAll('.eds-react-date-picker input, .eds-react-input input')].filter(visible)[1] ||
        null
      )
      if (!trigger) throw new Error('结束日期触发器未找到')
      const tc = rectCenter(trigger)
      if (!tc) throw new Error('结束日期触发器坐标为空')
      console.log(`[DATE] 结束日期触发: ${target.str}`)
      return cdpPhase([{ ...tc, delay_ms: 100, label: '结束日期触发器' }], 'date_end_nav', 500, shared)
    }

    // ── date_end_nav ────────────────────────────────────────────────────────────
    if (phase === 'date_end_nav') {
      const item   = getFormItem(['优惠券领取期限', 'Claim Period'])
      const target = shared._endTarget
      if (!item || !target) throw new Error('结束日期数据丢失')

      const panel = getDatePickerPanel(item)
      if (!panel) {
        const trigger = item.querySelector('.picker-item.end-picker input')
        const tc = rectCenter(trigger)
        if (tc) return cdpPhase([{ ...tc, delay_ms: 200, label: '重新触发' }], phase, 500, shared)
        throw new Error('结束日期面板消失')
      }

      const header = getDatePickerHeader(panel)
      if (!header) return cdpPhase([], phase, 500, shared)

      console.log(`[DATE] 结束: 当前 ${header.year}-${header.month} → 目标 ${target.year}-${target.month}`)

      if (header.year === target.year && header.month === target.month) {
        return cdpPhase([], 'date_end_day', 300, shared)
      }

      const nav = getNavButtons(panel)
      const delta = (target.year - header.year) * 12 + (target.month - header.month)
      const btn   = delta >= 0 ? nav.nextMonth : nav.prevMonth
      if (!btn) throw new Error('结束日期导航按钮未找到')
      const bc = rectCenter(btn)
      if (!bc) throw new Error('导航按钮坐标为空')
      return cdpPhase([{ ...bc, delay_ms: 200, label: '结束月份导航' }], phase, 100, shared)
    }

    // ── date_end_day ─────────────────────────────────────────────────────────────
    if (phase === 'date_end_day') {
      const item   = getFormItem(['优惠券领取期限', 'Claim Period'])
      const target = shared._endTarget
      if (!item || !target) throw new Error('结束日期数据丢失')

      const panel = getDatePickerPanel(item)
      if (!panel) throw new Error('结束日期面板消失')

      const header = getDatePickerHeader(panel)
      if (header && (header.year !== target.year || header.month !== target.month)) {
        return cdpPhase([], 'date_end_nav', 200, shared)
      }

      const cells = [...panel.querySelectorAll('.eds-react-date-picker__table-cell, .eds-react-date-picker__table-cell-wrap')]
      const cell  = cells.find(c =>
        visible(c) &&
        norm(c.textContent) === String(Number(target.d)) &&
        !/disabled|out-of-range/.test(c.className || '')
      )
      if (!cell) throw new Error(`未找到结束日期格：${target.d}`)
      const cc = rectCenter(cell)
      if (!cc) throw new Error('结束日期格坐标为空')
      console.log(`[DATE] 点击结束日期: ${target.d}`)
      return cdpPhase([{ ...cc, delay_ms: 200, label: `结束日期${target.d}` }], 'date_end_time', 100, shared)
    }

    // ── date_end_time ───────────────────────────────────────────────────────────
    if (phase === 'date_end_time') {
      const item   = getFormItem(['优惠券领取期限', 'Claim Period'])
      const target = shared._endTarget
      if (!item || !target) throw new Error('结束日期数据丢失')

      const panel = getDatePickerPanel(item)
      const clicks = []
      if (panel) {
        const cols = [...panel.querySelectorAll('.eds-react-time-picker__tp-scrollbar')].filter(visible)
        if (cols.length >= 2) {
          const hourBox = [...cols[0].querySelectorAll('.time-box')]
            .find(el => visible(el) && norm(el.textContent) === target.hh)
          const minBox = [...cols[1].querySelectorAll('.time-box')]
            .find(el => visible(el) && norm(el.textContent) === target.mm)
          if (hourBox) { const c = rectCenter(hourBox); if (c) clicks.push({ ...c, delay_ms: 150, label: `结束时${target.hh}` }) }
          if (minBox)  { const c = rectCenter(minBox);  if (c) clicks.push({ ...c, delay_ms: 150, label: `结束分${target.mm}` }) }
        }
      }
      return cdpPhase(clicks, 'date_end_confirm', 100, shared)
    }

    // ── date_end_confirm ────────────────────────────────────────────────────────
    if (phase === 'date_end_confirm') {
      const item = getFormItem(['优惠券领取期限', 'Claim Period'])
      const panel = getDatePickerPanel(item)

      if (!panel) {
        return cdpPhase([], 'date_end_verify', 300, shared)
      }

      const okBtn = [...panel.querySelectorAll('button')]
        .find(b => /^确认$|^确定$|^OK$/i.test(norm(b.textContent)) && visible(b))
      if (!okBtn) {
        const bodyC = rectCenter(document.body)
        if (bodyC) return cdpPhase([{ ...bodyC, delay_ms: 300, label: '点击空白' }], 'date_end_verify', 200, shared)
        throw new Error('结束日期确认按钮未找到')
      }
      const oc = rectCenter(okBtn)
      if (!oc) throw new Error('结束确认按钮坐标为空')
      return cdpPhase([{ ...oc, delay_ms: 400, label: '结束确认' }], 'date_end_verify', 400, shared)
    }

    // ── date_end_verify ─────────────────────────────────────────────────────────
    if (phase === 'date_end_verify') {
      await sleep(300)
      const item   = getFormItem(['优惠券领取期限', 'Claim Period'])
      const target = shared._endTarget
      const inputs = [...(item?.querySelectorAll('input.eds-react-input__input') || [])].filter(visible)
      const startVal = norm(inputs[0]?.value || '')
      const endVal   = norm(inputs[1]?.value || '')

      console.log(`[DATE] 验证结束: start="${startVal}" end="${endVal}"`)

      const startTarget = shared._startTarget
      if (startTarget && !startVal.includes(startTarget.str)) {
        throw new Error(`开始时间未写入，期望：${startTarget.str}，实际：${startVal || '(空)'}`)
      }
      if (target && !endVal.includes(target.str)) {
        throw new Error(`结束时间未写入，期望：${target.str}，实际：${endVal || '(空)'}`)
      }

      return nextPhase('form_fill_rest', 100, shared)
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // FORM_FILL_REST — 填写其他字段（提前显示、奖励类型、折扣类型等）
    // ══════════════════════════════════════════════════════════════════════════════
    if (phase === 'form_fill_rest') {
      const result = shared.result || buildResult()

      // ── 1. 提前显示优惠券 ────────────────────────────────────────────────────
      const showEarlyKey = Object.keys(row).find(k => k.replace(/\s+/g, '').includes('是否提前显示'))
      const showEarly = boolLike(showEarlyKey ? row[showEarlyKey] : '')
      await setShowEarly(showEarly)

      // ── 2. 奖励类型 ──────────────────────────────────────────────────────────
      const rewardType = norm(row['奖励类型'] || '')
      if (rewardType) await setRewardType(rewardType)

      // ── 3. 折扣类型（下拉）───────────────────────────────────────────────────
      const discountType = norm(row['折扣类型'] || '')
      let actualDiscountType = discountType
      if (discountType) actualDiscountType = await setDiscountType(discountType)

      // ── 4. 优惠限额 ──────────────────────────────────────────────────────────
      const rawLimit = digitsOnly(row['优惠限额'] || '')
      if (rawLimit) {
        const limitValue = discountLimitValue(rawLimit, actualDiscountType || discountType)
        await fillDiscountLimit(limitValue)
      }

      // ── 5. 最高优惠金额 ─────────────────────────────────────────────────────
      const maxDiscount = digitsOnly(row['最高优惠金额'] || '')
      if (maxDiscount) await fillMaxDiscount(maxDiscount)

      // ── 6. 最低消费金额 ──────────────────────────────────────────────────────
      const minSpend = digitsOnly(row['最低消费金额'] || '')
      if (minSpend) {
        const item = getFormItem('最低消费金额')
        if (item) {
          const inp = getTextInputs(item)[0]
          if (inp) await typeInto(inp, String(toNumber(minSpend)))
        }
      }

      // ── 7. 可使用总数 ────────────────────────────────────────────────────────
      const totalCount = digitsOnly(row['可使用总数'] || '')
      if (totalCount) {
        const item = getFormItem(['可使用总数', '优惠券可使用总数'])
        if (item) {
          const inp = getTextInputs(item)[0]
          if (inp) await typeInto(inp, String(toNumber(totalCount)))
        }
      }

      // ── 8. 每个买家可用数量上限 ─────────────────────────────────────────────
      const perBuyer = digitsOnly(row['每个买家可用的优惠券数量上限'] || '')
      if (perBuyer) {
        const item = getFormItem('每个买家可用的优惠券数量上限') || getFormItem('每个买家')
        if (item) {
          const inp = getTextInputs(item)[0]
          if (inp) await typeInto(inp, String(toNumber(perBuyer)))
        }
      }

      return nextPhase('form_validate', 200, { ...shared, result })
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // FORM_VALIDATE — 提交前预校验（所有关键字段值是否正确写入）
    // ══════════════════════════════════════════════════════════════════════════════
    if (phase === 'form_validate') {
      const result = shared.result || buildResult()
      const errors = []

      // 优惠券名称
      const nameInput = getFormItem('优惠券名称')
        ? getTextInputs(getFormItem('优惠券名称'))[0]
        : null
      if (!nameInput || !norm(nameInput.value).length) {
        errors.push('优惠券名称未填写')
      }

      // 日期范围
      const dateItem = getFormItem(['优惠券领取期限', 'Claim Period'])
      if (dateItem) {
        const inputs = [...dateItem.querySelectorAll('input.eds-react-input__input')].filter(visible)
        const startTarget = shared._startTarget
        const endTarget   = shared._endTarget
        if (startTarget && inputs[0] && !norm(inputs[0].value).includes(startTarget.str)) {
          errors.push(`领取期限开始时间未写入，期望：${startTarget.str}`)
        }
        if (endTarget && inputs[1] && !norm(inputs[1].value).includes(endTarget.str)) {
          errors.push(`领取期限结束时间未写入，期望：${endTarget.str}`)
        }
      }

      // 折扣类型
      const discountType = norm(row['折扣类型'] || '')
      if (discountType) {
        const item = getFormItem('折扣类型 | 优惠限额') || getFormItem('折扣类型')
        if (item) {
          const trigger = item.querySelector('.trigger, .eds-selector, .eds-react-select__inner')
          if (trigger && !/折扣|percentage|金额|fixed/i.test(textOf(trigger))) {
            errors.push(`折扣类型选择失败，当前值：${textOf(trigger)}`)
          }
        }
      }

      // 优惠限额
      const rawLimit = digitsOnly(row['优惠限额'] || '')
      if (rawLimit) {
        const item = getFormItem('折扣类型 | 优惠限额') || getFormItem('折扣类型')
        if (item) {
          const inputs = getTextInputs(item)
          const inp = inputs.find(el => el.tagName === 'INPUT')
          if (!inp || !norm(inp.value)) {
            errors.push('优惠限额未填写')
          }
        }
      }

      if (errors.length) {
        throw new Error(`字段校验失败：${errors.join('；')}`)
      }

      return nextPhase('submit', 100, { ...shared, result })
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // SUBMIT — 点击确认按钮
    // ══════════════════════════════════════════════════════════════════════════════
    if (phase === 'submit') {
      const allBtns = [...document.querySelectorAll('button')].filter(visible)
      const actionBtns = allBtns.filter(el => {
        const t = textOf(el)
        if (!/^(确认|确定)$/.test(t)) return false
        if (/取消|预览|关闭/.test(t)) return false
        const scopeText = textOf(el.closest('form, .footer, .page-footer, .footer-actions, .button-group, .eds-sticky, .sticky-footer, .footer-container') || '')
        return /确认|确定/.test(scopeText) || (el.className || '').includes('primary')
      })
      const confirmBtn = (
        actionBtns.find(el => (el.className || '').includes('primary')) ||
        actionBtns[0] ||
        allBtns.find(el => /^(确认|确定)$/.test(textOf(el)) && (el.className || '').includes('primary')) ||
        allBtns.find(el => /^(确认|确定)$/.test(textOf(el)))
      )
      if (!confirmBtn) throw new Error('未找到"确认"按钮')
      dispatchSyntheticClick(confirmBtn)
      return nextPhase('post_submit', 3500, shared)
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // POST_SUBMIT — 等待创建成功
    // ══════════════════════════════════════════════════════════════════════════════
    if (phase === 'post_submit') {
      const result = shared.result || buildResult()

      const ok = await waitFor(() => {
        const href = location.href || ''
        if (href.includes('/vouchers/list') || (href.includes('/vouchers/') && !href.includes('/new'))) return 'url'
        const bt = norm(document.body.innerText)
        if (/创建成功|设置成功|已创建/.test(bt)) return 'toast'
        const alerts = [...document.querySelectorAll('[role=alert], .eds-toast, .eds-message')]
          .filter(visible).map(e => textOf(e)).join(' ')
        if (/成功/.test(alerts)) return 'toast'
        return null
      }, 8000, 300)

      if (ok) {
        result['执行状态'] = '成功'
        result['错误原因'] = ''
        result['当前URL']  = location.href || ''
        return finishRow(result)
      }

      // 检查错误提示
      const inlineErrors = [...document.querySelectorAll(
        '.eds-react-form-item__extra, .eds-react-form-item__help, [class*="error-msg"]'
      )].filter(visible).map(e => textOf(e)).filter(Boolean)
      const toastErrors = [...document.querySelectorAll('[role=alert], .eds-toast, .eds-message')]
        .filter(visible).map(e => textOf(e)).filter(Boolean)
      const allErrors = [...new Set([...inlineErrors, ...toastErrors])]

      if (allErrors.length) throw new Error(`提交校验：${allErrors.join(' | ')}`)

      const bt = norm(document.body.innerText)
      if (/失败|必填|请输入|不能为空|格式不正确|无权限/.test(bt)) {
        throw new Error('提交后页面有错误提示，请检查字段')
      }

      // 再等 5s
      const ok2 = await waitFor(() => {
        if (!location.href.includes('/new')) return 'url'
        const bt2 = norm(document.body.innerText)
        if (/创建成功|设置成功/.test(bt2)) return 'toast'
        return null
      }, 5000, 400)
      if (ok2) {
        result['执行状态'] = '成功'
        result['错误原因'] = ''
        result['当前URL']  = location.href || ''
        return finishRow(result)
      }

      throw new Error(`提交后未能确认成功，当前URL：${location.href.substring(0, 100)}`)
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // 未知 phase
    // ══════════════════════════════════════════════════════════════════════════════
    throw new Error(`未知 phase：${phase}`)

  } catch (e) {
    const result = shared.result || buildResult({ '执行状态': '失败', '错误原因': e.message || String(e) })
    result['当前URL'] = location.href || ''
    return finishRow(result)
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 以下是需要单独调用的函数（不在 phase 流程内）
  // ══════════════════════════════════════════════════════════════════════════════

  // ─── 提前显示优惠券 ──────────────────────────────────────────────────────────────
  async function setShowEarly(desired) {
    const target = [...document.querySelectorAll('label, .eds-react-checkbox')].find(el =>
      visible(el) && textOf(el).includes('提前显示优惠券')
    )
    if (!target) {
      if (location.href.includes('/follow-prize/new')) return false
      if (desired) throw new Error('未找到"提前显示优惠券"复选框')
      return false
    }
    const cb = target.querySelector?.('input[type=checkbox]') ||
               (target.tagName === 'INPUT' ? target : null)
    const isChecked = () => {
      if (cb) return !!cb.checked
      return target.classList.contains('eds-react-checkbox--checked') ||
             target.getAttribute('aria-checked') === 'true'
    }
    if (isChecked() !== !!desired) {
      if (cb) {
        setNativeChecked(cb, desired)
        const props = reactPropsOf(cb)
        try { props?.onChange?.({ target: cb, currentTarget: cb }) } catch {}
        try { props?.onClick?.({ target: cb, currentTarget: cb, preventDefault(){}, stopPropagation(){} }) } catch {}
      }
      if (isChecked() !== !!desired) try { dispatchSyntheticClick(target) } catch {}
      await sleep(200)
    }
    if (isChecked() !== !!desired) {
      throw new Error(`提前显示优惠券状态不符合预期，期望：${!!desired}`)
    }
    return true
  }

  function setNativeChecked(el, checked) {
    if (!el) return false
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')
    if (desc?.set) desc.set.call(el, !!checked)
    else el.checked = !!checked
    el.dispatchEvent(new Event('input',  { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }

  // ─── 奖励类型 radio ──────────────────────────────────────────────────────────────
  async function setRewardType(text) {
    const aliases = {
      '折扣': ['折扣', 'discount'],
      'shopee币回扣': ['shopee币回扣', 'Shopee币回扣', '币回扣', 'coin cashback'],
    }
    const keys = (aliases[text] || [text]).map(s => s.toLowerCase())
    const item = getFormItem('奖励类型') || document
    const label = [...item.querySelectorAll('.eds-react-radio__label, label, span')].find(el => {
      if (!visible(el)) return false
      const t = textOf(el).toLowerCase()
      return keys.some(k => t === k || t.includes(k))
    })
    if (!label) throw new Error(`未找到奖励类型：${text}`)
    dispatchSyntheticClick(label.closest('label') || label)
    await sleep(200)
  }

  // ─── 折扣类型下拉 ───────────────────────────────────────────────────────────────
  async function setDiscountType(text) {
    const aliases = {
      '扣除百分比': ['扣除百分比', '折扣百分比', 'percentage'],
      '折扣金额':   ['折扣金额', '固定金额', 'fixed amount'],
    }
    const desired = String(text || '').trim()
    const keys    = (aliases[desired] || [desired]).map(s => s.toLowerCase())

    const item = getFormItem('折扣类型 | 优惠限额') || getFormItem('折扣类型')
    if (!item) throw new Error('未找到折扣类型表单项')

    // 优先直接点击已渲染的选项
    const findOption = () =>
      [...document.querySelectorAll('.eds-react-select-option, .eds-option')].find(el => {
        const t = textOf(el).toLowerCase()
        return keys.some(k => t === k || t.includes(k))
      }) || null

    let option = findOption()
    if (option) {
      dispatchSyntheticClick(option)
      await sleep(300)
      const selText = textOf(item.querySelector('.eds-react-select__inner, .eds-selector, .trigger.trigger--normal'))
      if (keys.some(k => selText.toLowerCase().includes(k))) return selText
    }

    // 触发下拉
    const trigger = item.querySelector('.trigger.trigger--normal, .eds-selector')
    if (!trigger || !visible(trigger)) throw new Error('未找到折扣类型下拉触发器')
    trigger.scrollIntoView({ block: 'center' })
    await sleep(100)
    const props = reactPropsOf(trigger)
    try { props?.onMouseDown?.({ button: 0, buttons: 1, preventDefault(){}, stopPropagation(){}, currentTarget: trigger, target: trigger }) } catch {}
    try { props?.onClick?.({ preventDefault(){}, stopPropagation(){}, currentTarget: trigger, target: trigger }) } catch {}
    for (const ev of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      try { trigger.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window, buttons: 1 })) } catch (_) {}
    }
    try { trigger.click?.() } catch {}
    await sleep(400)

    const options = await waitFor(() => {
      const opts = [...document.querySelectorAll('.eds-react-select-option, .eds-option')]
      return opts.length > 0 ? opts : null
    }, 3000, 120)
    if (!options) throw new Error('折扣类型下拉未展开')

    option = options.find(el => {
      const t = textOf(el).toLowerCase()
      return keys.some(k => t === k || t.includes(k))
    })
    if (!option && options.length === 1) option = options[0]
    if (!option) throw new Error(`未找到折扣类型选项：${text}（可选：${options.map(o => textOf(o)).join('/')}）`)

    dispatchSyntheticClick(option)
    await sleep(300)

    const selText = textOf(item.querySelector('.eds-react-select__inner, .eds-selector, .trigger.trigger--normal'))
    if (!keys.some(k => selText.toLowerCase().includes(k))) {
      throw new Error(`折扣类型选择失败，期望：${text}，实际：${selText || '(空)'}`)
    }
    return selText
  }

  // ─── 优惠限额 ────────────────────────────────────────────────────────────────────
  async function fillDiscountLimit(value) {
    const item = getFormItem('折扣类型 | 优惠限额') || getFormItem('折扣类型')
    if (!item) throw new Error('未找到折扣类型/优惠限额表单项')
    const inputs = getTextInputs(item)
    const inp    = inputs.find(el => visible(el) && el.tagName === 'INPUT')
    if (!inp) throw new Error('未找到优惠限额输入框')
    await typeInto(inp, value)
    return true
  }

  // ─── 最高优惠金额 ────────────────────────────────────────────────────────────────
  async function fillMaxDiscount(value) {
    for (const lbl of ['最高优惠金额', '最高折扣金额', '最高优惠', '最高减免', '最高上限数额']) {
      const item = getFormItem(lbl)
      if (!item) continue

      // 若是"设置金额"radio，先切
      const setAmount = [...item.querySelectorAll('label, .eds-react-radio__label, span')]
        .find(el => visible(el) && textOf(el).includes('设置金额'))
      if (setAmount) {
        dispatchSyntheticClick(setAmount.closest('label') || setAmount)
        await sleep(300)
      }

      let inp = await waitFor(() => getTextInputs(item).find(el => visible(el)) || null, 1500, 120)
      if (!inp) {
        const scope = item.parentElement || document
        inp = [...scope.querySelectorAll('input:not([type=radio]):not([type=checkbox]), textarea')]
          .filter(visible)
          .find(el => {
            const wrapText = textOf(el.closest('.eds-react-input, .eds-react-form-item, .eds-react-form-item__control'))
            return /最高优惠金额|最高折扣金额|最高优惠|最高减免|最高上限数额/.test(wrapText)
          }) || null
      }
      if (!inp) {
        let sib = item.nextElementSibling
        while (sib && !inp) {
          inp = [...sib.querySelectorAll('input:not([type=radio]):not([type=checkbox]), textarea')].filter(visible)[0] || null
          sib = inp ? null : sib.nextElementSibling
        }
      }
      if (inp && visible(inp)) {
        await typeInto(inp, String(toNumber(value)))
        return true
      }
    }
    return false
  }

  // ─── Vue DateRangePicker 路径（关注礼等，无 CDP）─────────────────────────────────
  async function setDateRangeJS(startDt, endDt) {
    const item = getFormItem(['优惠券领取期限', 'Claim Period'])
    if (!item) throw new Error('未找到"优惠券领取期限/Claim Period"')

    const rangeComp = item.querySelector('.date-range-picker-container, .date-range-picker')?.__vueParentComponent || null
    if (rangeComp?.ctx && (typeof rangeComp.ctx.handleStartChange === 'function' || typeof rangeComp.ctx.handleEndChange === 'function')) {
      if (startDt && typeof rangeComp.ctx.handleStartChange === 'function') {
        rangeComp.ctx.handleStartChange(new Date(`${startDt.y}-${startDt.mo}-${startDt.d}T${startDt.hh}:${startDt.mm}:00+08:00`).toISOString())
        await sleep(250)
      }
      if (endDt && typeof rangeComp.ctx.handleEndChange === 'function') {
        rangeComp.ctx.handleEndChange(new Date(`${endDt.y}-${endDt.mo}-${endDt.d}T${endDt.hh}:${endDt.mm}:00+08:00`).toISOString())
        await sleep(250)
      }
      try { rangeComp.ctx.validate?.() } catch {}
      try { document.body.click() } catch {}
      await sleep(150)
      return true
    }

    const inputs = getTextInputs(item)
    if (inputs.length >= 2) {
      if (startDt) await fillDatetimePicker(inputs[0], startDt)
      if (endDt)   await fillDatetimePicker(inputs[1], endDt)
      try { document.body.click() } catch {}
      await sleep(200)
      return true
    }
    return false
  }

  async function fillDatetimePicker(triggerInput, dt) {
    dispatchSyntheticClick(triggerInput)
    await sleep(600)
    const panel = await waitFor(() =>
      document.querySelector('.eds-react-date-picker-panel, .eds-react-date-picker__panel-wrap, .eds-picker-dropdown')
    , 3000, 100)
    if (!panel) {
      setNativeValue(triggerInput, dt.str)
      await sleep(200)
      try { document.body.click() } catch {}
      return
    }
    const pInputs = [...panel.querySelectorAll('input')].filter(visible)
    if (pInputs.length >= 5) {
      for (const [i, v] of [[0, dt.y], [1, dt.mo], [2, dt.d], [3, dt.hh], [4, dt.mm]]) {
        await typeInto(pInputs[i], v)
      }
    } else if (pInputs.length >= 2) {
      await typeInto(pInputs[0], `${dt.y}-${dt.mo}-${dt.d}`)
      await typeInto(pInputs[1], `${dt.hh}:${dt.mm}`)
    } else if (pInputs.length === 1) {
      await typeInto(pInputs[0], dt.str)
    }
    await sleep(200)
    const okBtn = [...panel.querySelectorAll('button')].find(b => visible(b) && /^(确认|确定|OK)$/i.test(textOf(b)))
    if (okBtn) { dispatchSyntheticClick(okBtn); await sleep(300) }
    else { try { document.body.click() } catch {}; await sleep(200) }
  }
})()
