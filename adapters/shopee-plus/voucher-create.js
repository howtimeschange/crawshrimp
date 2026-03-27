/**
 * Shopee+ 优惠券批量创建脚本 v2
 *
 * Phase 设计（每个 phase 对应一个"人类操作步骤"）：
 *   main              → 决定导航 / 是否需要切换店铺
 *   store_switch_open → CDP 点击店铺选择器，打开搜索弹窗
 *   store_switch_search → JS 填搜索词，等候选项，返回 CDP 点击坐标
 *   store_switch_done → 验证店铺切换成功，导航到列表页
 *   enter_type        → 导航到对应券种创建页
 *   form_fill         → 填写名称 / 优惠码 / 触发日期面板
 *   date_nav          → 逐月导航到目标月（每次 1 步，避免坐标漂移）
 *   date_select       → 点日期格 + 批量调时间箭头 + 点确认（三批坐标合一次返回）
 *   form_fill_rest    → 填写其余字段（奖励类型/折扣类型/金额等）
 *   submit            → 点确认按钮
 *   post_submit       → 等待创建成功
 *
 * CDP 协议：
 *   return { success, data, meta: { action:'cdp_clicks', clicks:[{x,y,delay_ms}], next_phase, sleep_ms, shared } }
 *   return { success, data, meta: { action:'next_phase', next_phase, sleep_ms, shared } }
 *   return { success, data, meta: { action:'complete', has_more, page, total } }
 */
;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page   = window.__CRAWSHRIMP_PAGE__   || 1
  const phase  = window.__CRAWSHRIMP_PHASE__  || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const rows   = params.input_file?.rows      || []

  const MARKETING_URL    = 'https://seller.shopee.cn/portal/marketing'
  const VOUCHER_LIST_URL = 'https://seller.shopee.cn/portal/marketing/vouchers/list'

  const row = rows[page - 1]
  if (!row) {
    return { success: true, data: [], meta: { action: 'complete', has_more: false, page, total: rows.length } }
  }

  // ─── 工具函数 ──────────────────────────────────────────────────────────────────
  const sleep  = (ms) => new Promise(r => setTimeout(r, ms))
  const norm   = (s) => String(s || '').replace(/\s+/g, ' ').trim()
  const textOf = (el) => norm(el?.innerText || el?.textContent || el?.value || '')

  const digitsOnly = (v) => String(v ?? '').replace(/,/g, '').trim()

  const toNumber = (v) => {
    const s = digitsOnly(v).replace(/%$/, '').trim()
    const n = Number(s)
    return Number.isNaN(n) ? s : n
  }

  // 优惠限额：0.05 (小数) → 5 (百分比); 金额保持原值
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

  // 解析 "2026-04-01" / "2026/04/01" / "2028/3/27-11:29:57"
  const parseDateTime = (raw, kind) => {
    const s = norm(raw)
    if (!s) return null
    const m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[T\s-](\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?)?$/)
    if (!m) return null
    const y  = m[1]
    const mo = String(m[2]).padStart(2, '0')
    const d  = String(m[3]).padStart(2, '0')
    const hh = m[4] != null ? String(m[4]).padStart(2, '0') : (kind === 'start' ? '00' : '23')
    const mm = m[5] != null ? String(m[5]).padStart(2, '0') : (kind === 'start' ? '00' : '59')
    return { y, mo, d, hh, mm, str: `${y}-${mo}-${d} ${hh}:${mm}`, year: Number(y), month: Number(mo) }
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

  const rectCenter = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return null
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  }

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

  function setNativeValue(el, value) {
    if (!el) return false
    const val  = String(value ?? '')
    const last = el.value
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const desc  = Object.getOwnPropertyDescriptor(proto, 'value')
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

  function setNativeChecked(el, checked) {
    if (!el) return false
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')
    if (desc?.set) desc.set.call(el, !!checked)
    else el.checked = !!checked
    el.dispatchEvent(new Event('input',  { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }

  async function typeInto(el, value) {
    dispatchSyntheticClick(el)
    await sleep(80)
    try { el.focus() } catch {}
    setNativeValue(el, value)
    await sleep(200)
  }

  function reactPropsOf(el) {
    const k = Object.keys(el || {}).find(x => x.startsWith('__reactProps'))
    return k ? el[k] : null
  }

  // React onClick 优先触发（CDP 坐标点击对 React 合成事件无效的场景用这个）
  function reactClick(el) {
    if (!el) return false
    try { el.scrollIntoView({ block: 'center' }) } catch {}
    const props = reactPropsOf(el)
    if (props?.onClick) {
      try {
        props.onClick({
          preventDefault: () => {}, stopPropagation: () => {},
          target: el, currentTarget: el, nativeEvent: { target: el }
        })
        return true
      } catch {}
    }
    return false
  }

  async function closeBlockingOverlays() {
    for (const sel of ['.fullstory-modal-wrapper', '.diagnosis-result-modal']) {
      ;[...document.querySelectorAll(sel)].forEach(el => { try { el.remove() } catch {} })
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

  // ─── 表单工具 ──────────────────────────────────────────────────────────────────
  function getFormItem(labelText) {
    const labels = Array.isArray(labelText) ? labelText.map(norm) : [norm(labelText)]
    return [...document.querySelectorAll('.eds-react-form-item, .eds-form-item')].find(el => {
      const lbl = el.querySelector('.eds-react-form-item__label, .eds-form-item__label')
      const t   = norm(lbl?.textContent)
      return t && labels.some(x => t.includes(x))
    }) || null
  }

  function getTextInputs(container) {
    return [...(container || document).querySelectorAll(
      'input:not([type=radio]):not([type=checkbox]), textarea'
    )].filter(visible)
  }

  async function fillField(labelText, value, inputIndex = 0) {
    const item   = getFormItem(labelText)
    if (!item) throw new Error(`未找到表单项：${labelText}`)
    const inputs = getTextInputs(item)
    const el     = inputs[inputIndex]
    if (!el) throw new Error(`表单项"${labelText}"没有可编辑 input（找到 ${inputs.length} 个）`)
    await typeInto(el, value)
    return el
  }

  // ─── 券种配置 ──────────────────────────────────────────────────────────────────
  const VOUCHER_TYPE_MAP = {
    '商店优惠券':     { usecase: '1',   testId: 'voucherEntry1',   aliases: ['商店优惠券'] },
    '新买家优惠券':   { usecase: '3',   testId: 'voucherEntry3',   aliases: ['新买家优惠券', '新买家'] },
    '回购买家优惠券': { usecase: '4',   testId: 'voucherEntry4',   aliases: ['回购买家优惠券', '回购'] },
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

  function getUrlShopId() {
    try { return new URL(location.href).searchParams.get('cnsc_shop_id') || '' } catch { return '' }
  }

  function buildVoucherListUrl(shopId) {
    const u = new URL(VOUCHER_LIST_URL)
    if (shopId) u.searchParams.set('cnsc_shop_id', shopId)
    return u.toString()
  }

  function getStoreText() {
    const el = document.querySelector('.shop-switcher, .shop-switcher-container, .shop-select, .shop-info, .shop-label')
    if (el && visible(el)) return textOf(el.closest('.shop-info') || el.parentElement || el)
    const all = [...document.querySelectorAll('div, span')]
      .filter(e => visible(e) && textOf(e).startsWith('当前店铺'))
    return all.length ? textOf(all[0]) : ''
  }

  // ─── 结果构建 ──────────────────────────────────────────────────────────────────
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
  const cdpPhase = (clicks, nextPhase, sleepMs = 300, extras = {}) => ({
    success: true, data: [],
    meta: {
      action: 'cdp_clicks',
      clicks: clicks || [],
      next_phase: nextPhase,
      sleep_ms: sleepMs,
      shared: { ...shared, ...extras },
    },
  })

  const nextPhase = (np, sleepMs = 1200, extras = {}) => ({
    success: true, data: [],
    meta: {
      action: 'next_phase',
      next_phase: np,
      sleep_ms: sleepMs,
      shared: { ...shared, ...extras },
    },
  })

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

  // ══════════════════════════════════════════════════════════════════════════════
  // 主执行块（try/catch 兜底，所有异常统一写入 finishRow 失败）
  // ══════════════════════════════════════════════════════════════════════════════
  try {
    await closeBlockingOverlays()

    // ══════════════════════════════════════════════════════════════════════════
    // MAIN — 判断入口，决定是否需要切换店铺或重新导航
    // ══════════════════════════════════════════════════════════════════════════
    if (phase === 'main') {
      const store       = norm(row['店铺'])
      const voucherType = norm(row['优惠券品类'])
      if (!store)       throw new Error('Excel 缺少"店铺"列')
      if (!voucherType) throw new Error('Excel 缺少"优惠券品类"列')

      const couponName = shared.couponName || (store + discountLimitValue(row['优惠限额'] || '', row['折扣类型'] || ''))
      const couponCode = shared.couponCode || randCode(5)
      const result     = buildResult({ '生成优惠券名称': couponName, '生成优惠码': couponCode })

      const onMarket = location.href.includes('/portal/marketing')
      if (!onMarket) {
        location.href = MARKETING_URL
        return nextPhase('main', 3000, { couponName, couponCode, result, _currentStore: store })
      }

      const storeText  = getStoreText()
      const site       = norm(row['站点'] || '')
      const storeMatch = storeText.includes(store) && (!site || storeText.includes(site))

      if (storeMatch) {
        // 店铺已匹配，直接去创建页
        return nextPhase('enter_type', 200, { couponName, couponCode, result, _currentStore: store })
      }
      return nextPhase('store_switch_open', 300, { couponName, couponCode, result, _currentStore: store })
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STORE_SWITCH_OPEN — CDP 点击店铺选择器，打开搜索弹窗（Bug 1 修复）
    // ══════════════════════════════════════════════════════════════════════════
    if (phase === 'store_switch_open') {
      // 确保在营销中心
      if (!location.href.includes('/portal/marketing')) {
        location.href = MARKETING_URL
        return nextPhase('store_switch_open', 3000, shared)
      }

      // 找店铺选择器触发区域（点击后才会出现搜索输入框）
      const trigger = (
        document.querySelector('.shop-switcher .shop-select') ||
        document.querySelector('.shop-switcher-container .shop-select') ||
        document.querySelector('.shop-select') ||
        null
      )
      if (!trigger || !visible(trigger)) {
        throw new Error('未找到店铺选择器触发元素 .shop-select')
      }
      const tc = rectCenter(trigger)
      if (!tc) throw new Error('店铺选择器坐标为空')

      console.log('[STORE] CDP 点击店铺选择器，打开搜索弹窗')
      // CDP 点击打开弹窗，然后切换到 store_switch_search 做 JS 搜索
      return cdpPhase(
        [{ ...tc, delay_ms: 600, label: '店铺选择器' }],
        'store_switch_search',
        800,
        shared
      )
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STORE_SWITCH_SEARCH — JS 填搜索词，等候选项出现，返回 CDP 点击坐标
    // ══════════════════════════════════════════════════════════════════════════
    if (phase === 'store_switch_search') {
      const store = shared._currentStore || norm(row['店铺'])

      // 等待搜索 input 出现（CDP 点击后弹窗已打开）
      const searchInput = await waitFor(() =>
        [...document.querySelectorAll('input')].find(el =>
          visible(el) && (el.placeholder === '搜索店铺' || /搜索店铺/.test(el.placeholder))
        )
      , 5000, 200)

      if (!searchInput) {
        // 弹窗可能没开，重试一次 open
        return nextPhase('store_switch_open', 500, shared)
      }

      // JS 填写搜索关键词（搜索 input 是普通 input，不是 React controlled，可以直接 setNativeValue）
      dispatchSyntheticClick(searchInput)
      await sleep(100)
      setNativeValue(searchInput, store)

      // 同时尝试 Vue ctx searchShop（弹窗已打开，这时才有效）
      const switcher    = document.querySelector('.shop-switcher')
      const switcherVue = switcher?.__vueParentComponent || switcher?.__vue__
      if (switcherVue?.ctx?.searchShop) {
        try { switcherVue.ctx.searchShop(store) } catch {}
      }
      const vueInput = searchInput.__vueParentComponent || searchInput.__vue__
      if (vueInput?.ctx?.setCurrentValue) {
        try { vueInput.ctx.setCurrentValue(store) } catch {}
      }

      // 等候选项出现
      const candidate = await waitFor(() =>
        [...document.querySelectorAll('.search-item')].filter(el => visible(el))
          .find(el => textOf(el).includes(store))
      , 6000, 300)

      if (!candidate) throw new Error(`搜索后未找到店铺候选项：${store}`)

      const cc = rectCenter(candidate)
      if (!cc) throw new Error('店铺候选项坐标为空')

      console.log(`[STORE] 找到候选项，CDP 点击选择店铺：${textOf(candidate).substring(0, 40)}`)
      return cdpPhase(
        [{ ...cc, delay_ms: 500, label: `选择店铺:${store}` }],
        'store_switch_done',
        2000,
        shared
      )
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STORE_SWITCH_DONE — 验证店铺切换，导航到券列表
    // ══════════════════════════════════════════════════════════════════════════
    if (phase === 'store_switch_done') {
      await sleep(300)
      await closeBlockingOverlays()
      const store = shared._currentStore || norm(row['店铺'])

      const storeText = getStoreText()
      if (!storeText.includes(store) && !document.body.innerText.includes(store)) {
        throw new Error(`切换店铺后验证失败，当前：${storeText.substring(0, 60)}`)
      }

      const shopId = getUrlShopId()
      location.href = buildVoucherListUrl(shopId)
      return nextPhase('enter_type', 3000, shared)
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ENTER_TYPE — 导航到对应券种创建页，预填名称+优惠码
    // ══════════════════════════════════════════════════════════════════════════
    if (phase === 'enter_type') {
      const voucherType = norm(row['优惠券品类'])
      const meta        = getVoucherMeta(voucherType)
      const shopId      = getUrlShopId()

      // 已在创建页
      if (location.href.includes('/vouchers/new') || location.href.includes('/follow-prize/new')) {
        return nextPhase('form_fill', 200, shared)
      }

      // 关注礼走独立路径（需要先到主页拿正确 shopId）
      if (meta.usecase === '999') {
        if (!location.href.includes('/portal/marketing')) {
          location.href = MARKETING_URL
          return nextPhase('enter_type', 2500, shared)
        }
        const sid = getUrlShopId()
        location.href = buildCreateUrl(voucherType, sid)
        return nextPhase('form_fill', 3000, shared)
      }

      // 普通券：从列表页入口卡片点"创建"
      if (!location.href.includes('/vouchers/list')) {
        location.href = buildVoucherListUrl(shopId)
        return nextPhase('enter_type', 3000, shared)
      }

      // 展开"为特定买家"入口
      const expandBtn = [...document.querySelectorAll('button, a')].find(el =>
        visible(el) && textOf(el).includes('为特定买家提供更多种类的优惠券')
      )
      if (expandBtn) { dispatchSyntheticClick(expandBtn); await sleep(800) }

      // 找券种入口卡片
      let card = document.querySelector(`button[data-testid="${meta.testId}"]`)
      if (!card || !visible(card)) {
        card = [...document.querySelectorAll('button[data-testid^="voucherEntry"]')].find(el =>
          visible(el) && meta.aliases.some(a => textOf(el).includes(a))
        ) || null
      }
      if (!card) throw new Error(`未找到券种入口卡片：${voucherType}`)

      const createBtn = [...card.querySelectorAll('button')]
        .find(el => visible(el) && /^(创建|去创建)$/.test(textOf(el))) || card
      dispatchSyntheticClick(createBtn)

      // 等创建页表单出现
      const formReady = await waitFor(() => {
        const href = location.href || ''
        if (!href.includes('/vouchers/new') && !href.includes('/follow-prize/new')) return null
        const item = getFormItem('优惠券名称')
        return item && visible(item) ? item : null
      }, 12000, 300)
      if (!formReady) throw new Error(`点击创建后未能进入表单页，当前URL：${location.href.substring(0, 100)}`)

      // 预填名称和优惠码
      await sleep(300)
      await fillField('优惠券名称', shared.couponName || '')
      try { await fillField('优惠码', shared.couponCode || '') } catch {}

      return nextPhase('form_fill', 200, shared)
    }

    // ══════════════════════════════════════════════════════════════════════════
    // FORM_FILL — 等表单就绪，兜底填名称+优惠码，处理日期字段
    // ══════════════════════════════════════════════════════════════════════════
    if (phase === 'form_fill') {
      const result  = shared.result || buildResult()
      const startDt = parseDateTime(row['优惠券领取期限（开始）精确到分'], 'start')
      const endDt   = parseDateTime(row['优惠券领取期限（结束）精确到分'], 'end')

      const formReady = await waitFor(() => getFormItem('优惠券名称') || null, 10000, 400)
      if (!formReady) throw new Error(`创建表单未出现，当前URL：${location.href.substring(0, 100)}`)
      await sleep(300)

      // 兜底：enter_type 已预填，这里补一次确保写入
      try { await fillField('优惠券名称', shared.couponName || '') } catch {}
      try { await fillField('优惠码',     shared.couponCode || '') } catch {}

      const isFollowPrize = location.href.includes('/follow-prize/new')
      const dateItem      = getFormItem(['优惠券领取期限', 'Claim Period'])
      const hasReactPicker = dateItem?.querySelector('.picker-item.start-picker, .eds-react-date-picker__input')

      if (isFollowPrize || !hasReactPicker) {
        // 关注礼 / Vue DateRangePicker → 纯 JS 注入
        if (startDt || endDt) {
          try { await setDateRangeJS(startDt, endDt) }
          catch (e) { console.warn(`[DATE] Vue 日期注入失败，继续：${e.message}`) }
        }
        return nextPhase('form_fill_rest', 200, { ...shared, result, _startTarget: startDt, _endTarget: endDt })
      }

      // 普通券 React EDS 日期选择器 → CDP 多步
      if (!startDt && !endDt) {
        return nextPhase('form_fill_rest', 100, { ...shared, result, _startTarget: null, _endTarget: null })
      }

      // 触发开始日期面板（优先 React onClick，fallback CDP）
      const startTrigger = (
        dateItem.querySelector('#startDate') ||
        dateItem.querySelector('.picker-item.start-picker input.eds-react-input__input') ||
        dateItem.querySelector('.picker-item.start-picker input') ||
        null
      )

      if (startDt) {
        const clicked = reactClick(startTrigger)
        if (clicked) {
          console.log(`[DATE] React onClick 触发开始面板`)
          return nextPhase('date_nav', 800, {
            ...shared, result,
            _startTarget: startDt, _endTarget: endDt,
            _dateWhich: 'start',
          })
        }
        const tc = rectCenter(startTrigger)
        if (!tc) throw new Error('开始日期触发器坐标为空')
        return cdpPhase(
          [{ ...tc, delay_ms: 100, label: '开始日期触发器' }],
          'date_nav',
          800,
          { ...shared, result, _startTarget: startDt, _endTarget: endDt, _dateWhich: 'start' }
        )
      }

      // 只有结束日期
      const endTrigger = (
        dateItem.querySelector('#endDate') ||
        dateItem.querySelector('.picker-item.end-picker input.eds-react-input__input') ||
        dateItem.querySelector('.picker-item.end-picker input') ||
        null
      )
      const clicked = reactClick(endTrigger)
      if (clicked) {
        return nextPhase('date_nav', 800, {
          ...shared, result,
          _startTarget: null, _endTarget: endDt, _dateWhich: 'end',
        })
      }
      const tc = rectCenter(endTrigger)
      if (!tc) throw new Error('结束日期触发器坐标为空')
      return cdpPhase(
        [{ ...tc, delay_ms: 100, label: '结束日期触发器' }],
        'date_nav',
        800,
        { ...shared, result, _startTarget: null, _endTarget: endDt, _dateWhich: 'end' }
      )
    }

    // ══════════════════════════════════════════════════════════════════════════
    // DATE_NAV — 逐月导航到目标月（每次 1 步，避免面板结构变化导致坐标漂移）
    // ══════════════════════════════════════════════════════════════════════════
    if (phase === 'date_nav') {
      const which  = shared._dateWhich || 'start'
      const target = which === 'start' ? shared._startTarget : shared._endTarget
      if (!target) {
        // 无目标，跳到下一个
        if (which === 'start' && shared._endTarget) {
          return nextPhase('form_fill', 100, { ...shared, _dateWhich: 'end', _startTarget: null })
        }
        return nextPhase('form_fill_rest', 100, shared)
      }

      const dateItem = getFormItem(['优惠券领取期限', 'Claim Period'])
      const panel    = getDatePickerPanel(dateItem)
      if (!panel) {
        console.warn(`[DATE] ${which} 面板消失，跳过`)
        if (which === 'start' && shared._endTarget) {
          // 尝试重新打开结束日期
          return nextPhase('form_fill', 100, { ...shared, _dateWhich: 'end', _startTarget: null })
        }
        return nextPhase('form_fill_rest', 100, shared)
      }

      const header = getDatePickerHeader(panel)
      if (!header) return cdpPhase([], 'date_nav', 500, shared)

      console.log(`[DATE] ${which}: 当前 ${header.year}-${header.month} → 目标 ${target.year}-${target.month}`)

      if (header.year === target.year && header.month === target.month) {
        // 已到达目标月，进入选日 + 调时 + 确认
        return cdpPhase([], 'date_select', 300, shared)
      }

      const nav   = getNavButtons(panel)
      const delta = (target.year - header.year) * 12 + (target.month - header.month)
      const btn   = delta > 0 ? nav.nextMonth : nav.prevMonth
      if (!btn) {
        console.warn(`[DATE] 导航按钮未找到，跳过`)
        return nextPhase('form_fill_rest', 100, shared)
      }
      const bc = rectCenter(btn)
      if (!bc) return nextPhase('form_fill_rest', 100, shared)
      console.log(`[DATE] 导航 1 步（delta=${delta}）`)
      return cdpPhase([{ ...bc, delay_ms: 200, label: '月导航' }], 'date_nav', 500, shared)
    }

    // ══════════════════════════════════════════════════════════════════════════
    // DATE_SELECT — 点日期格 + 批量调时间箭头 + 点确认（三批坐标合一次返回）
    //
    // Bug 2 修复：
    //   旧版 date_start_time 中 getTimePickerState 返回 null 时直接跳 confirm，
    //   时间没设置就继续了（静默失败）。
    //   新版：先点日期格，等时间选择器出现后在同一次 JS 执行里计算箭头坐标，
    //   一次性把"日期格 + 全部时间箭头点击 + 确认按钮"打包成坐标数组返回。
    //   如果时间选择器不出现（panel 结构问题），直接 throw 让外层记录失败原因，
    //   而不是静默跳过。
    // ══════════════════════════════════════════════════════════════════════════
    if (phase === 'date_select') {
      const which  = shared._dateWhich || 'start'
      const target = which === 'start' ? shared._startTarget : shared._endTarget
      if (!target) {
        if (which === 'start' && shared._endTarget) {
          return nextPhase('form_fill', 100, { ...shared, _dateWhich: 'end', _startTarget: null })
        }
        return nextPhase('form_fill_rest', 100, shared)
      }

      const dateItem = getFormItem(['优惠券领取期限', 'Claim Period'])
      const panel    = getDatePickerPanel(dateItem)
      if (!panel) {
        console.warn(`[DATE] ${which} 面板在 date_select 阶段消失`)
        throw new Error(`日期面板消失（${which}），无法设置日期`)
      }

      // 验证当前月是目标月（导航可能有偏差）
      const header = getDatePickerHeader(panel)
      if (header && (header.year !== target.year || header.month !== target.month)) {
        return cdpPhase([], 'date_nav', 200, shared)
      }

      // 1. 找目标日期格
      const cells = [...panel.querySelectorAll('.eds-react-date-picker__table-cell')]
      const cell  = cells.find(c =>
        visible(c) &&
        norm(c.textContent) === String(Number(target.d)) &&
        !/disabled|out-of-range/.test(c.className || '')
      )
      if (!cell) throw new Error(`未找到日期格：${target.str}（${which}）`)
      const cellCoord = rectCenter(cell)
      if (!cellCoord) throw new Error(`日期格坐标为空：${target.str}`)

      // 点击日期格后等时间选择器出现，再计算箭头坐标
      // 先 CDP 点一次日期格，然后在下一个 phase 收集时间箭头（避免面板还没渲染）
      // 注：时间选择器只在点击日期格后才出现，所以必须分两步
      return cdpPhase(
        [{ ...cellCoord, delay_ms: 400, label: `日期格-${target.d}(${which})` }],
        'date_time_set',
        400,
        shared
      )
    }

    // ══════════════════════════════════════════════════════════════════════════
    // DATE_TIME_SET — 日期格已点，收集时间箭头坐标并批量返回 + 确认按钮
    //
    // Bug 2 修复核心：时间 picker 如果 getTimePickerState 返回 null → 明确报错，
    // 不再静默跳过（旧版 date_start_time 的问题）。
    // ══════════════════════════════════════════════════════════════════════════
    if (phase === 'date_time_set') {
      const which  = shared._dateWhich || 'start'
      const target = which === 'start' ? shared._startTarget : shared._endTarget
      if (!target) {
        if (which === 'start' && shared._endTarget) {
          return nextPhase('form_fill', 100, { ...shared, _dateWhich: 'end', _startTarget: null })
        }
        return nextPhase('form_fill_rest', 100, shared)
      }

      const dateItem = getFormItem(['优惠券领取期限', 'Claim Period'])
      const panel    = getDatePickerPanel(dateItem)
      if (!panel) throw new Error(`时间选择器面板消失（${which}），日期格点击后面板未出现`)

      // 等时间选择器渲染（点击日期格后可能有动画延迟）
      const timeState = await waitFor(() => getTimePickerState(panel), 3000, 200)
      if (!timeState) {
        throw new Error(`时间选择器未出现（${which}），getTimePickerState 返回 null，面板结构可能变化`)
      }

      const targetH = parseInt(target.hh)
      const targetM = parseInt(target.mm)
      const clicks  = []

      // 打包所有小时箭头点击
      const hDiff = targetH - timeState.curHour
      if (hDiff !== 0) {
        const btn = hDiff > 0 ? timeState.hourInc : timeState.hourDec
        for (let i = 0; i < Math.abs(hDiff); i++) {
          clicks.push({ ...btn, delay_ms: 200, label: `时-${i+1}/${Math.abs(hDiff)}(${which})` })
        }
        console.log(`[DATE] ${which} hour ${timeState.curHour}→${targetH}，${Math.abs(hDiff)} clicks`)
      }

      // 打包所有分钟箭头点击
      const mDiff = targetM - timeState.curMin
      if (mDiff !== 0) {
        const btn = mDiff > 0 ? timeState.minInc : timeState.minDec
        for (let i = 0; i < Math.abs(mDiff); i++) {
          clicks.push({ ...btn, delay_ms: 200, label: `分-${i+1}/${Math.abs(mDiff)}(${which})` })
        }
        console.log(`[DATE] ${which} min ${timeState.curMin}→${targetM}，${Math.abs(mDiff)} clicks`)
      }

      // 找确认按钮坐标，追加到末尾（时间箭头点完就点确认）
      const okBtn = [...panel.querySelectorAll('button')]
        .find(b => /^确认$|^确定$|^OK$/i.test(norm(b.textContent)) && visible(b))
      if (okBtn) {
        const oc = rectCenter(okBtn)
        if (oc) clicks.push({ ...oc, delay_ms: 400, label: `确认(${which})` })
      }

      if (clicks.length === 0) {
        // 时间已是目标值，直接点确认
        if (okBtn) {
          const oc = rectCenter(okBtn)
          if (oc) {
            return cdpPhase([{ ...oc, delay_ms: 400, label: `确认(${which})` }], 'date_done', 500, shared)
          }
        }
        return nextPhase('date_done', 300, shared)
      }

      console.log(`[DATE] ${which} 批量点击 ${clicks.length} 个坐标（时间箭头+确认）`)
      return cdpPhase(clicks, 'date_done', 600, shared)
    }

    // ══════════════════════════════════════════════════════════════════════════
    // DATE_DONE — 一个日期选完，决定是否继续选另一个
    // ══════════════════════════════════════════════════════════════════════════
    if (phase === 'date_done') {
      await sleep(400)
      const which = shared._dateWhich || 'start'

      if (which === 'start' && shared._endTarget) {
        // 选完开始，继续选结束
        const dateItem = getFormItem(['优惠券领取期限', 'Claim Period'])
        const endTrigger = (
          dateItem?.querySelector('#endDate') ||
          dateItem?.querySelector('.picker-item.end-picker input.eds-react-input__input') ||
          dateItem?.querySelector('.picker-item.end-picker input') ||
          null
        )
        if (endTrigger) {
          const clicked = reactClick(endTrigger)
          if (clicked) {
            return nextPhase('date_nav', 800, { ...shared, _dateWhich: 'end' })
          }
          const tc = rectCenter(endTrigger)
          if (tc) {
            return cdpPhase(
              [{ ...tc, delay_ms: 100, label: '结束日期触发器' }],
              'date_nav',
              800,
              { ...shared, _dateWhich: 'end' }
            )
          }
        }
        console.warn('[DATE] 结束日期触发器未找到，跳过结束日期')
      }

      console.log(`[DATE] ${which} 日期完成，进入 form_fill_rest`)
      return nextPhase('form_fill_rest', 200, shared)
    }

    // ══════════════════════════════════════════════════════════════════════════
    // FORM_FILL_REST — 填写其余字段
    // ══════════════════════════════════════════════════════════════════════════
    if (phase === 'form_fill_rest') {
      const result   = shared.result || buildResult()
      const warnings = []

      // 1. 提前显示优惠券
      try {
        const showEarlyKey = Object.keys(row).find(k => k.replace(/\s+/g, '').includes('是否提前显示'))
        const showEarly    = boolLike(showEarlyKey ? row[showEarlyKey] : '')
        await setShowEarly(showEarly)
      } catch (e) { warnings.push(`提前显示：${e.message}`) }

      // 2. 奖励类型
      try {
        const rewardType = norm(row['奖励类型'] || '')
        if (rewardType) await setRewardType(rewardType)
      } catch (e) { warnings.push(`奖励类型：${e.message}`) }

      // 3. 折扣类型
      const discountType = norm(row['折扣类型'] || '')
      let actualDiscountType = discountType
      try {
        if (discountType) actualDiscountType = await setDiscountType(discountType)
      } catch (e) { warnings.push(`折扣类型：${e.message}`) }

      // 4. 优惠限额
      try {
        const rawLimit = digitsOnly(row['优惠限额'] || '')
        if (rawLimit) {
          const limitValue = discountLimitValue(rawLimit, actualDiscountType || discountType)
          await fillDiscountLimit(limitValue)
        }
      } catch (e) { warnings.push(`优惠限额：${e.message}`) }

      // 5. 最高优惠金额
      try {
        const maxDiscount = digitsOnly(row['最高优惠金额'] || '')
        if (maxDiscount) await fillMaxDiscount(maxDiscount)
      } catch (e) { warnings.push(`最高优惠金额：${e.message}`) }

      // 6. 最低消费金额
      try {
        const minSpend = digitsOnly(row['最低消费金额'] || '')
        if (minSpend) {
          const item = getFormItem('最低消费金额')
          if (item) {
            const inp = getTextInputs(item)[0]
            if (inp) await typeInto(inp, String(toNumber(minSpend)))
          }
        }
      } catch (e) { warnings.push(`最低消费金额：${e.message}`) }

      // 7. 可使用总数
      try {
        const totalCount = digitsOnly(row['可使用总数'] || '')
        if (totalCount) {
          const item = getFormItem(['可使用总数', '优惠券可使用总数'])
          if (item) {
            const inp = getTextInputs(item)[0]
            if (inp) await typeInto(inp, String(toNumber(totalCount)))
          }
        }
      } catch (e) { warnings.push(`可使用总数：${e.message}`) }

      // 8. 每个买家可用数量上限
      try {
        const perBuyer = digitsOnly(row['每个买家可用的优惠券数量上限'] || '')
        if (perBuyer) {
          const item = getFormItem('每个买家可用的优惠券数量上限') || getFormItem('每个买家')
          if (item) {
            const inp = getTextInputs(item)[0]
            if (inp) await typeInto(inp, String(toNumber(perBuyer)))
          }
        }
      } catch (e) { warnings.push(`每个买家限额：${e.message}`) }

      if (warnings.length > 0) console.warn(`[FORM_REST] 字段警告（不阻断流程）：${warnings.join(' | ')}`)
      return nextPhase('submit', 200, { ...shared, result })
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SUBMIT — 提交前扫描校验错误，再点确认按钮
    // ══════════════════════════════════════════════════════════════════════════
    if (phase === 'submit') {
      const result = shared.result || buildResult()

      // 提交前扫描页面上已有的校验错误（例如"结束时间不能超过开始时间后的3个月"）
      // 选择器覆盖：React EDS form item help/extra、通用 error-msg、标红的输入框旁说明
      const preErrors = [...document.querySelectorAll(
        '.eds-react-form-item__extra, .eds-react-form-item__help, ' +
        '[class*="error-msg"], [class*="error-text"], [class*="form-error"], ' +
        '.eds-form-item__help, .eds-form-item__extra'
      )].filter(visible).map(e => textOf(e)).filter(t => t.length > 0)

      if (preErrors.length > 0) {
        console.warn(`[SUBMIT] 页面存在校验错误，不提交：${preErrors.join(' | ')}`)
        result['执行状态'] = '失败'
        result['错误原因'] = `表单校验错误：${preErrors.join(' | ')}`
        result['当前URL']  = location.href || ''
        return finishRow(result)
      }

      const allBtns = [...document.querySelectorAll('button')].filter(visible)
      // 优先找 primary 确认按钮，排除弹窗内的取消/关闭
      const confirmBtn = (
        allBtns.find(el =>
          /^(确认|确定)$/.test(textOf(el)) &&
          (el.className || '').includes('primary') &&
          el.closest('form, .footer, .page-footer, .footer-actions, .button-group, .eds-sticky, .sticky-footer, .footer-container')
        ) ||
        allBtns.find(el =>
          /^(确认|确定)$/.test(textOf(el)) &&
          el.closest('form, .footer, .page-footer, .footer-actions, .button-group, .eds-sticky, .sticky-footer, .footer-container')
        ) ||
        allBtns.find(el => /^(确认|确定)$/.test(textOf(el)) && (el.className || '').includes('primary')) ||
        allBtns.find(el => /^(确认|确定)$/.test(textOf(el)))
      )
      if (!confirmBtn) throw new Error('未找到"确认"提交按钮')

      // 优先 React props 触发（对 React 表单更可靠）
      const clicked = reactClick(confirmBtn)
      if (!clicked) dispatchSyntheticClick(confirmBtn)

      return nextPhase('post_submit', 3500, shared)
    }

    // ══════════════════════════════════════════════════════════════════════════
    // POST_SUBMIT — 等待创建成功 / 检测错误
    // ══════════════════════════════════════════════════════════════════════════
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

      // 收集页面内联错误和 toast 错误
      const inlineErrors = [...document.querySelectorAll(
        '.eds-react-form-item__extra, .eds-react-form-item__help, [class*="error-msg"]'
      )].filter(visible).map(e => textOf(e)).filter(Boolean)
      const toastErrors = [...document.querySelectorAll('[role=alert], .eds-toast, .eds-message')]
        .filter(visible).map(e => textOf(e)).filter(Boolean)
      const allErrors = [...new Set([...inlineErrors, ...toastErrors])]

      if (allErrors.length) throw new Error(`提交失败：${allErrors.join(' | ')}`)

      // 再等 5s
      const ok2 = await waitFor(() => {
        if (!location.href.includes('/new')) return 'url'
        if (/创建成功|设置成功/.test(norm(document.body.innerText))) return 'toast'
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

    throw new Error(`未知 phase：${phase}`)

  } catch (e) {
    const result = shared.result || buildResult()
    result['执行状态'] = '失败'
    result['错误原因'] = e.message || String(e)
    result['当前URL']  = location.href || ''
    return finishRow(result)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 辅助函数（在 try 块外定义，被 phase 内调用）
  // ══════════════════════════════════════════════════════════════════════════

  // ─── 日期选择器辅助 ────────────────────────────────────────────────────────────
  function getDatePickerPanel(item) {
    const local = item?.querySelector('.eds-react-date-picker__panel-wrap, .eds-react-popover.eds-react-date-picker__popup')
    if (local && visible(local)) return local
    return [...document.querySelectorAll('.eds-react-popover.eds-react-date-picker__popup, .eds-react-date-picker__panel-wrap')]
      .find(el => visible(el) && /确认/.test(textOf(el))) || null
  }

  const MONTH_MAP = {
    january:1, february:2, march:3, april:4, may:5, june:6,
    july:7, august:8, september:9, october:10, november:11, december:12,
    jan:1, feb:2, mar:3, apr:4, may:5, jun:6,
    jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
    '一月':1,'二月':2,'三月':3,'四月':4,'五月':5,'六月':6,
    '七月':7,'八月':8,'九月':9,'十月':10,'十一月':11,'十二月':12,
  }

  function getDatePickerHeader(panel) {
    if (!panel) return null
    const headerEl = panel.querySelector('.eds-react-date-picker__header, .date-box, .date-default-style')
    if (!headerEl) return null
    const texts     = [...headerEl.querySelectorAll('button, span, i')].filter(visible).map(el => textOf(el)).filter(t => t.length > 0)
    const headerText = textOf(headerEl)
    let year = null, month = null
    for (const t of texts) {
      if (/^\d{4}年?$/.test(t)) year = Number(t.replace('年', ''))
      else if (/^\d{1,2}月$/.test(t)) month = Number(t.replace('月', ''))
      else {
        const em = t.match(/([A-Za-z]+)/)
        if (em && MONTH_MAP[em[1].toLowerCase()]) month = MONTH_MAP[em[1].toLowerCase()]
      }
    }
    if (!year) { const ym = headerText.match(/(\d{4})/); if (ym) year = Number(ym[1]) }
    if (!month) {
      const mm = headerText.match(/(\d{1,2})\s*月/)
      if (mm) month = Number(mm[1])
      else { const em = headerText.match(/([A-Za-z]+)/); if (em && MONTH_MAP[em[1].toLowerCase()]) month = MONTH_MAP[em[1].toLowerCase()] }
    }
    return (year && month && month >= 1 && month <= 12) ? { year, month } : null
  }

  function getNavButtons(panel) {
    const header  = panel.querySelector('.date-box, .eds-react-date-picker__header')
    if (!header) return { prevMonth: null, nextMonth: null }
    const allBtns = [...header.querySelectorAll('.btn-arrow-default')]
      .filter(b => visible(b))
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
    if (allBtns.length >= 4) return { prevMonth: allBtns[1], nextMonth: allBtns[allBtns.length - 2] }
    if (allBtns.length >= 2) return { prevMonth: allBtns[0], nextMonth: allBtns[allBtns.length - 1] }
    return { prevMonth: null, nextMonth: null }
  }

  // Bug 2 修复：getTimePickerState 返回 null 时调用方会 throw，不再静默跳过
  function getTimePickerState(panel) {
    if (!panel) return null
    const cols = [...panel.querySelectorAll('.eds-react-time-picker__tp-scrollbar')]
    if (cols.length < 2) return null
    const curHour = parseInt([...cols[0].querySelectorAll('.time-box')].find(b => b.className.includes('selected'))?.textContent?.trim() || '0')
    const curMin  = parseInt([...cols[1].querySelectorAll('.time-box')].find(b => b.className.includes('selected'))?.textContent?.trim() || '0')
    const btns    = [...panel.querySelectorAll('.btn-op-time')].filter(el => el.offsetWidth > 0)
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left || a.getBoundingClientRect().top - b.getBoundingClientRect().top)
    if (btns.length < 4) return null
    const coord = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } }
    return {
      curHour, curMin,
      hourDec: coord(btns[0]),
      hourInc: coord(btns[1]),
      minDec:  coord(btns[2]),
      minInc:  coord(btns[3]),
    }
  }

  // ─── Vue DateRangePicker 注入（关注礼 usecase=999）────────────────────────────
  async function setDateRangeJS(startDt, endDt) {
    const container = document.querySelector('.date-range-picker-container, .date-range-picker, .date-range-picker-container.date-picker')
    if (!container) throw new Error('未找到 date-range-picker-container')

    // 优先 __vue__（根组件），fallback __vueParentComponent，再全局搜索有 handleStartChange 的实例
    let vueInst = container.__vue__ || container.__vueParentComponent
    if (!vueInst?.ctx?.handleStartChange) {
      const vueEl = [...document.querySelectorAll('*')].find(el => el.__vue__?.ctx?.handleStartChange)
      vueInst = vueEl?.__vue__ || vueEl?.__vueParentComponent
    }
    if (!vueInst?.ctx?.handleStartChange) throw new Error('未找到 Vue handleStartChange（999 页面组件实例）')

    const ctx   = vueInst.ctx
    // 关注礼的 handleStartChange/handleEndChange 接收本地时间字符串（YYYY-MM-DD HH:mm:ss），
    // 不能传 UTC ISO（会导致时差偏移 -8h），直接传格式化的本地字符串
    const toISO = (dt) => dt ? `${dt.y}-${dt.mo}-${dt.d} ${dt.hh}:${dt.mm}:00` : null

    if (startDt) {
      try { ctx.handleStartChange(toISO(startDt)) }
      catch (e) { throw new Error(`handleStartChange 失败：${e.message}`) }
      await sleep(300)
    }
    if (endDt) {
      try { ctx.handleEndChange(toISO(endDt)) }
      catch (e) { throw new Error(`handleEndChange 失败：${e.message}`) }
      await sleep(300)
    }
    try { ctx.validate?.() } catch {}
    try { document.body.click() } catch {}
    await sleep(200)
    return true
  }

  // ─── 提前显示优惠券 ────────────────────────────────────────────────────────────
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
    return true
  }

  // ─── 奖励类型 radio ────────────────────────────────────────────────────────────
  // Bug 3 修复：旧版只用 dispatchSyntheticClick，对 Vue EDS v-model radio 无效。
  // 新版：同时尝试 React props.onChange + Vue v-model change 事件，确保两套组件都能触发。
  async function setRewardType(text) {
    const aliases = {
      '折扣':        ['折扣', 'discount'],
      'shopee币回扣': ['shopee币回扣', 'Shopee币回扣', '币回扣', 'coin cashback'],
    }
    const keys = (aliases[text] || [text]).map(s => s.toLowerCase())
    const scope = getFormItem('奖励类型') || document

    const label = [...scope.querySelectorAll('.eds-react-radio__label, .eds-radio__label, label, span')].find(el => {
      if (!visible(el)) return false
      const t = textOf(el).toLowerCase()
      return keys.some(k => t === k || t.includes(k))
    })
    if (!label) throw new Error(`未找到奖励类型：${text}`)

    const radioRoot = label.closest('label') || label
    try { radioRoot.scrollIntoView({ block: 'center' }) } catch {}

    // 1. React props（React EDS）
    const radioInput = radioRoot.querySelector('input[type=radio]') || radioRoot
    const reactProps = reactPropsOf(radioInput)
    if (reactProps?.onChange) {
      try {
        reactProps.onChange({ target: radioInput, currentTarget: radioInput, preventDefault(){}, stopPropagation(){} })
        await sleep(200)
        return
      } catch {}
    }
    if (reactProps?.onClick) {
      try {
        reactProps.onClick({ target: radioInput, currentTarget: radioInput, preventDefault(){}, stopPropagation(){} })
        await sleep(200)
        return
      } catch {}
    }

    // 2. Vue EDS v-model：原生 checked + input/change 事件冒泡
    if (radioInput.tagName === 'INPUT') {
      setNativeChecked(radioInput, true)
      // 手动向上冒泡，让 Vue 的 v-model 监听到
      const changeEvt = new Event('change', { bubbles: true })
      radioInput.dispatchEvent(changeEvt)
      await sleep(200)
      return
    }

    // 3. Fallback: 合成点击整个 label
    dispatchSyntheticClick(radioRoot)
    await sleep(200)
  }

  // ─── 折扣类型下拉 ──────────────────────────────────────────────────────────────
  // Bug 3 修复：对 Vue EDS 下拉，旧版只有合成 click 没有 change。
  // 新版：触发下拉后，选择选项时同时发送 change 事件冒泡，并尝试 Vue ctx 直接设值。
  async function setDiscountType(text) {
    const aliases = {
      '扣除百分比': ['扣除百分比', '折扣百分比', 'percentage'],
      '折扣金额':   ['折扣金额', '固定金额', 'fixed amount'],
    }
    const desired = String(text || '').trim()
    const keys    = (aliases[desired] || [desired]).map(s => s.toLowerCase())

    const item = getFormItem('折扣类型 | 优惠限额') || getFormItem('折扣类型')
    if (!item) throw new Error('未找到折扣类型表单项')

    const findOption = () =>
      [...document.querySelectorAll('.eds-react-select-option, .eds-select-option, .eds-option, [class*="select-option"]')].find(el => {
        const t = textOf(el).toLowerCase()
        return keys.some(k => t === k || t.includes(k))
      }) || null

    // 先看选项是否已展开
    let option = findOption()
    if (option) {
      dispatchSyntheticClick(option)
      option.dispatchEvent(new Event('change', { bubbles: true }))
      await sleep(300)
    } else {
      // 触发下拉
      const trigger = item.querySelector('.trigger.trigger--normal, .eds-selector, .eds-react-select__inner')
      if (!trigger || !visible(trigger)) throw new Error('未找到折扣类型下拉触发器')
      trigger.scrollIntoView({ block: 'center' })
      await sleep(100)

      // React props 触发
      const props = reactPropsOf(trigger)
      try { props?.onMouseDown?.({ button:0, buttons:1, preventDefault(){}, stopPropagation(){}, currentTarget:trigger, target:trigger }) } catch {}
      try { props?.onClick?.({ preventDefault(){}, stopPropagation(){}, currentTarget:trigger, target:trigger }) } catch {}
      // 合成事件兜底
      for (const ev of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
        try { trigger.dispatchEvent(new MouseEvent(ev, { bubbles:true, cancelable:true, view:window, buttons:1 })) } catch {}
      }
      try { trigger.click?.() } catch {}
      await sleep(400)

      const options = await waitFor(() => {
        const opts = [...document.querySelectorAll('.eds-react-select-option, .eds-select-option, .eds-option, [class*="select-option"]')]
        return opts.length > 0 ? opts : null
      }, 3000, 120)
      if (!options) throw new Error('折扣类型下拉未展开')

      option = options.find(el => {
        const t = textOf(el).toLowerCase()
        return keys.some(k => t === k || t.includes(k))
      }) || (options.length === 1 ? options[0] : null)
      if (!option) throw new Error(`未找到折扣类型选项：${text}（可选：${options.map(o => textOf(o)).join('/')}）`)

      // React props 触发 + 合成 click + change 冒泡
      const optProps = reactPropsOf(option)
      if (optProps?.onClick) {
        try { optProps.onClick({ preventDefault(){}, stopPropagation(){}, currentTarget:option, target:option }) } catch {}
      } else {
        dispatchSyntheticClick(option)
      }
      option.dispatchEvent(new Event('change', { bubbles: true }))
      await sleep(300)
    }

    // 验证
    const selText = textOf(item.querySelector('.eds-react-select__inner, .eds-selector__inner, .eds-selector, .trigger.trigger--normal'))
    if (!keys.some(k => selText.toLowerCase().includes(k))) {
      throw new Error(`折扣类型选择失败，期望：${text}，实际：${selText || '(空)'}`)
    }
    return selText
  }

  // ─── 优惠限额 ──────────────────────────────────────────────────────────────────
  async function fillDiscountLimit(value) {
    const item = getFormItem('折扣类型 | 优惠限额') || getFormItem('折扣类型')
    if (!item) throw new Error('未找到折扣类型/优惠限额表单项')
    const inp = getTextInputs(item).find(el => visible(el) && el.tagName === 'INPUT')
    if (!inp) throw new Error('未找到优惠限额输入框')
    await typeInto(inp, value)
    return true
  }

  // ─── 最高优惠金额（Bug 4 已修复，保留逻辑）────────────────────────────────────
  async function fillMaxDiscount(value) {
    for (const lbl of ['最高优惠金额', '最高折扣金额', '最高优惠', '最高减免', '最高上限数额']) {
      const item = getFormItem(lbl)
      if (!item) continue

      // 先切换到"设置金额" radio（如果存在）
      const setAmountLabel = [...item.querySelectorAll('label, .eds-react-radio__label, .eds-radio__label, span')]
        .find(el => visible(el) && textOf(el).includes('设置金额'))
      if (setAmountLabel) {
        dispatchSyntheticClick(setAmountLabel.closest('label') || setAmountLabel)
        await sleep(300)
      }

      let inp = await waitFor(() => getTextInputs(item).find(el => visible(el)) || null, 1500, 120)
      if (!inp) {
        // 扩大搜索范围
        inp = [...(item.parentElement || document).querySelectorAll('input:not([type=radio]):not([type=checkbox]), textarea')]
          .filter(visible)
          .find(el => {
            const wrapText = textOf(el.closest('.eds-react-input, .eds-input, .eds-react-form-item, .eds-form-item, .eds-react-form-item__control, .eds-form-item__control'))
            return /最高优惠金额|最高折扣金额|最高优惠|最高减免|最高上限数额/.test(wrapText)
          }) || null
      }
      if (inp && visible(inp)) {
        await typeInto(inp, String(toNumber(value)))
        return true
      }
    }
    return false
  }

})()
