/**
 * Shopee+ voucher batch create v2
 *
 * SDK-aligned phase flow:
 *   main -> prepare_row -> ensure_marketing -> ensure_store
 *   -> open_usecase_form -> fill_usecase_form -> submit_form -> post_submit
 */
;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page = window.__CRAWSHRIMP_PAGE__ || 1
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const phaseAliasMap = {
    ensure_voucher_list: 'open_usecase_form',
    open_create_page: 'open_usecase_form',
    fill_basic: 'fill_usecase_form',
    fill_dates: 'fill_usecase_form',
    fill_rules: 'fill_usecase_form',
    verify_all_fields: 'fill_usecase_form',
    submit: 'submit_form',
  }
  const currentPhase = phaseAliasMap[phase] || phase
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const rawRows = params.input_file?.rows || []

  const MARKETING_URL = 'https://seller.shopee.cn/portal/marketing'
  const VOUCHERS_LIST_URL = 'https://seller.shopee.cn/portal/marketing/vouchers/list'
  const SITE_ALIAS_MAP = {
    '马来西亚': ['马来西亚', '马来', 'malaysia', 'my'],
    '新加坡': ['新加坡', 'singapore', 'sg'],
    '泰国': ['泰国', 'thailand', 'th'],
    '巴西': ['巴西', 'brazil', 'br'],
    '菲律宾': ['菲律宾', 'philippines', 'ph'],
    '越南': ['越南', 'vietnam', 'vn'],
    '台湾': ['台湾', 'taiwan', 'tw'],
    '印尼': ['印尼', 'indonesia', 'id'],
  }

  const executionRows = buildExecutionRows(rawRows)
  const execRow = executionRows[page - 1]

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
  function norm(value) { return String(value || '').replace(/\s+/g, ' ').trim() }
  function textOf(el) { return norm(el?.innerText || el?.textContent || el?.value || '') }
  function digitsOnly(value) { return String(value ?? '').replace(/,/g, '').trim() }

  function toNumber(value) {
    const raw = digitsOnly(value).replace(/%$/, '').trim()
    const num = Number(raw)
    return Number.isNaN(num) ? raw : num
  }

  function boolLike(value) {
    return String(value || '').trim() === '1' || /^(是|true|yes|y)$/i.test(String(value || '').trim())
  }

  function discountLimitValue(raw, discountType) {
    const numeric = toNumber(raw)
    if (typeof numeric === 'number' && /百分比|percentage/i.test(discountType || '') && numeric > 0 && numeric <= 1) {
      return String(Math.round(numeric * 100))
    }
    return String(numeric || '')
  }

  function buildCouponName(discountType, discountLimit) {
    const typeText = norm(discountType)
    const limitText = norm(discountLimit)
    if (!typeText || !limitText) return ''
    const suffix = /百分比|percentage/i.test(typeText) ? '%' : ''
    return `${typeText}：${limitText}${suffix}`
  }

  function randCode(length = 5) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let out = ''
    for (let i = 0; i < length; i += 1) {
      out += chars[Math.floor(Math.random() * chars.length)]
    }
    return out
  }

  function parseDateTime(raw, kind) {
    const value = norm(raw)
    if (!value) return null
    const match = value.match(
      /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[T\s-](\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?)?$/
    )
    if (!match) return null
    const year = match[1]
    const month = String(match[2]).padStart(2, '0')
    const day = String(match[3]).padStart(2, '0')
    const hour = match[4] != null ? String(match[4]).padStart(2, '0') : (kind === 'start' ? '00' : '23')
    const minute = match[5] != null ? String(match[5]).padStart(2, '0') : (kind === 'start' ? '00' : '59')
    return {
      y: year,
      mo: month,
      d: day,
      hh: hour,
      mm: minute,
      year: Number(year),
      month: Number(month),
      day: Number(day),
      str: `${year}-${month}-${day} ${hour}:${minute}`,
    }
  }

  function parseLooseDateTime(text) {
    const value = norm(text)
    if (!value) return ''
    const match = value.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2}).*?(\d{1,2}):(\d{1,2})/)
    if (!match) return value
    const year = match[1]
    const month = String(match[2]).padStart(2, '0')
    const day = String(match[3]).padStart(2, '0')
    const hour = String(match[4]).padStart(2, '0')
    const minute = String(match[5]).padStart(2, '0')
    return `${year}-${month}-${day} ${hour}:${minute}`
  }

  function sameDateTime(actual, expected) {
    if (!expected) return true
    const actualNorm = parseLooseDateTime(actual)
    return actualNorm.includes(expected.str)
  }

  function parseComparableNumber(value) {
    const raw = String(value ?? '').trim()
    if (!raw) return null
    let normalized = raw.replace(/[^\d.,-]/g, '')
    if (!normalized) return null

    if (normalized.includes(',') && normalized.includes('.')) {
      if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
        normalized = normalized.replace(/\./g, '').replace(',', '.')
      } else {
        normalized = normalized.replace(/,/g, '')
      }
    } else if (normalized.includes(',')) {
      const parts = normalized.split(',')
      if (parts.length === 2 && parts[1].length <= 2) {
        normalized = `${parts[0].replace(/,/g, '')}.${parts[1]}`
      } else {
        normalized = normalized.replace(/,/g, '')
      }
    }

    const num = Number(normalized)
    return Number.isNaN(num) ? null : num
  }

  function sameNumeric(actual, expected) {
    const a = digitsOnly(actual)
    const b = digitsOnly(expected)
    if (a === '' && b === '') return true
    const na = parseComparableNumber(actual)
    const nb = parseComparableNumber(expected)
    if (na != null && nb != null) return na === nb
    return a === b
  }

  function aliasMatch(actual, aliases) {
    const text = norm(actual).toLowerCase()
    return aliases.some(alias => {
      const lower = String(alias || '').toLowerCase()
      return lower && (text === lower || text.includes(lower))
    })
  }

  function getSiteAliases(site, store = '') {
    const out = new Set()
    const add = value => {
      const text = norm(value)
      if (text) out.add(text)
    }

    add(site)
    ;(SITE_ALIAS_MAP[norm(site)] || []).forEach(add)

    const suffix = norm(store).split('.').pop()
    const suffixAliases = {
      my: ['my', 'malaysia', '马来西亚'],
      sg: ['sg', 'singapore', '新加坡'],
      th: ['th', 'thailand', '泰国'],
      br: ['br', 'brazil', '巴西'],
      ph: ['ph', 'philippines', '菲律宾'],
      vn: ['vn', 'vietnam', '越南'],
      tw: ['tw', 'taiwan', '台湾'],
      id: ['id', 'indonesia', '印尼'],
    }
    ;(suffixAliases[suffix] || []).forEach(add)
    return [...out]
  }

  function storeNameMatch(actual, expectedStore) {
    const actualText = norm(actual).toLowerCase()
    const expectedText = norm(expectedStore).toLowerCase()
    if (!actualText || !expectedText) return false
    return actualText === expectedText || actualText.includes(expectedText)
  }

  function visible(el) {
    if (!el) return false
    const style = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
  }

  async function waitFor(fn, timeout = 10000, interval = 300) {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      const result = fn()
      if (result) return result
      await sleep(interval)
    }
    return null
  }

  function rectCenter(el) {
    if (!el) return null
    const rect = el.getBoundingClientRect()
    if (!rect.width && !rect.height) return null
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    }
  }

  function dispatchSyntheticClick(el) {
    if (!el) return false
    try { el.scrollIntoView({ block: 'center' }) } catch {}
    try { el.focus?.() } catch {}
    const options = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1, detail: 1 }
    for (const eventName of ['mousedown', 'mouseup', 'click']) {
      try { el.dispatchEvent(new MouseEvent(eventName, options)) } catch {}
    }
    try { el.click?.() } catch {}
    return true
  }

  function clickSequence(el) {
    if (!el) return false
    try { el.scrollIntoView({ block: 'center' }) } catch {}
    const options = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1, detail: 1 }
    for (const eventName of ['mousedown', 'mouseup', 'click']) {
      try { el.dispatchEvent(new MouseEvent(eventName, options)) } catch {}
    }
    try { el.click?.() } catch {}
    return true
  }

  function reactPropsOf(el) {
    if (!el) return null
    const key = Object.keys(el).find(item => item.startsWith('__reactProps') || item.startsWith('__reactEventHandlers'))
    return key ? el[key] : null
  }

  function reactClick(el) {
    if (!el) return false
    try { el.scrollIntoView({ block: 'center' }) } catch {}
    const props = reactPropsOf(el)
    if (props?.onClick) {
      try {
        props.onClick({
          preventDefault() {},
          stopPropagation() {},
          target: el,
          currentTarget: el,
          nativeEvent: { target: el },
        })
        return true
      } catch {}
    }
    return false
  }

  function singleDispatchClick(el) {
    if (!el) return false
    try { el.scrollIntoView({ block: 'center' }) } catch {}
    try {
      el.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 0,
        buttons: 1,
        detail: 1,
      }))
    } catch {}
    return true
  }

  function openPageClick(el) {
    return reactClick(el) || dispatchSyntheticClick(el)
  }

  function pageClick(el) {
    return dispatchSyntheticClick(el)
  }

  function setNativeValue(el, value) {
    if (!el) return false
    const val = String(value ?? '')
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const desc = Object.getOwnPropertyDescriptor(proto, 'value')
    if (desc?.set) desc.set.call(el, val)
    else el.value = val
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.dispatchEvent(new Event('blur', { bubbles: true }))
    return true
  }

  function setNativeChecked(el, checked) {
    if (!el) return false
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')
    if (desc?.set) desc.set.call(el, !!checked)
    else el.checked = !!checked
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }

  async function typeInto(el, value) {
    if (!el) return false
    dispatchSyntheticClick(el)
    await sleep(100)
    try { el.focus() } catch {}
    setNativeValue(el, value)
    await sleep(180)
    if (norm(el.value) === '' && String(value || '') !== '') {
      el.value = String(value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(100)
    }
    return true
  }

  async function closeBlockingOverlays() {
    for (const selector of ['.fullstory-modal-wrapper', '.diagnosis-result-modal']) {
      for (const el of [...document.querySelectorAll(selector)]) {
        try { el.remove() } catch {}
      }
    }

    for (const btn of [...document.querySelectorAll('button')]) {
      const text = textOf(btn)
      if (!visible(btn)) continue
      if (!/^(关闭|知道了|稍后)$/.test(text)) continue
      const scope = btn.closest('[role="dialog"], .eds-modal, .eds-drawer, .shopee-modal')
      if (!scope) continue
      try {
        reactClick(btn) || dispatchSyntheticClick(btn)
      } catch {}
    }
    await sleep(100)
  }

  function buildExecutionRows(rows) {
    const groups = new Map()
    const order = []
    rows.forEach((row, index) => {
      const site = norm(row?.['站点'])
      const store = norm(row?.['店铺'])
      const key = store ? `${site}::${store}` : `__row__${index + 1}`
      if (!groups.has(key)) {
        groups.set(key, [])
        order.push(key)
      }
      groups.get(key).push({ sourceIndex: index + 1, row })
    })
    return order.flatMap(key => groups.get(key) || [])
  }

  function getUsecaseByVoucherType(voucherType) {
    const map = {
      '商店优惠券': '1',
      '新买家优惠券': '3',
      '回购买家优惠券': '4',
      '关注礼优惠券': '999',
    }
    return map[voucherType] || ''
  }

  function getVoucherMeta(voucherType) {
    const map = {
      '商店优惠券': { usecase: '1', testId: 'voucherEntry1', aliases: ['商店优惠券'] },
      '新买家优惠券': { usecase: '3', testId: 'voucherEntry3', aliases: ['新买家优惠券', '新买家'] },
      '回购买家优惠券': { usecase: '4', testId: 'voucherEntry4', aliases: ['回购买家优惠券', '回购'] },
      '关注礼优惠券': { usecase: '999', testId: 'voucherEntry999', aliases: ['关注礼优惠券', '关注礼'] },
    }
    return map[voucherType] || { usecase: '', testId: '', aliases: [voucherType] }
  }

  function getUrlShopId() {
    try {
      return new URL(location.href).searchParams.get('cnsc_shop_id') || ''
    } catch {
      return ''
    }
  }

  function buildVouchersListUrl(shopId) {
    const url = new URL(VOUCHERS_LIST_URL)
    const actualShopId = shopId || getUrlShopId()
    if (actualShopId) url.searchParams.set('cnsc_shop_id', actualShopId)
    return url.toString()
  }

  function buildCreateUrl(voucherType, shopId) {
    const meta = getVoucherMeta(voucherType)
    if (!meta.usecase) throw new Error(`未配置的优惠券类型：${voucherType}`)
    const base = meta.usecase === '999'
      ? 'https://seller.shopee.cn/portal/marketing/follow-prize/new'
      : 'https://seller.shopee.cn/portal/marketing/vouchers/new'
    const url = new URL(base)
    if (meta.usecase !== '999') url.searchParams.set('usecase', meta.usecase)
    const actualShopId = shopId || getUrlShopId()
    if (actualShopId) url.searchParams.set('cnsc_shop_id', actualShopId)
    return url.toString()
  }

  function getCurrentStoreInfo() {
    const selectors = [
      '.shop-switcher .shop-select',
      '.shop-switcher .shop-info',
      '.shop-switcher',
      '.shop-switcher-container .shop-select',
      '.shop-switcher-container .shop-info',
      '.shop-select',
      '.shop-info',
      '.shop-label',
    ]

    const candidates = selectors
      .flatMap(selector => [...document.querySelectorAll(selector)])
      .filter(visible)
      .map(el => ({
        el,
        text: textOf(el.closest('.shop-switcher, .shop-switcher-container, .shop-info') || el),
      }))
      .filter(item => item.text)
      .sort((a, b) => b.text.length - a.text.length)

    const best = candidates[0]
    return {
      text: best?.text || '',
      shopId: getUrlShopId(),
    }
  }

  function getStoreText() {
    const info = getCurrentStoreInfo()
    if (info.text) return info.text
    const fallback = [...document.querySelectorAll('div, span')].find(el => visible(el) && textOf(el).startsWith('当前店铺'))
    return fallback ? textOf(fallback) : ''
  }

  function isStoreMatched(ctx) {
    const info = getCurrentStoreInfo()
    const storeText = info.text || getStoreText()
    if (!storeNameMatch(storeText, ctx.store)) return false

    const siteAliases = getSiteAliases(ctx.site, ctx.store)
    const siteMatched = siteAliases.length === 0 || aliasMatch(storeText, siteAliases)
    if (!siteMatched) {
      const compactStore = norm(ctx.store).toLowerCase()
      if (!compactStore || norm(storeText).toLowerCase() !== compactStore) return false
    }

    if (shared.awaiting_store_switch) {
      const previousShopId = String(shared.previous_shop_id || '')
      const currentShopId = String(info.shopId || '')
      if (previousShopId && currentShopId && previousShopId === currentShopId) {
        return false
      }
    }

    return true
  }

  function findStoreSearchInput() {
    return [...document.querySelectorAll('input')].find(el => {
      if (!visible(el)) return false
      const placeholder = norm(el.placeholder)
      return placeholder.includes('搜索店铺') || placeholder.includes('搜索')
    }) || null
  }

  function findStoreSwitcherTrigger() {
    return (
      document.querySelector('.shop-switcher .shop-select') ||
      document.querySelector('.shop-switcher-container .shop-select') ||
      document.querySelector('.shop-switcher .shop-info') ||
      document.querySelector('.shop-switcher-container .shop-info') ||
      document.querySelector('.shop-select') ||
      null
    )
  }

  function findStoreCandidate(ctx) {
    const selectors = '.search-item, [role="option"], li, [class*="shop-item"], [class*="shopItem"]'
    const siteAliases = getSiteAliases(ctx.site, ctx.store)
    return [...document.querySelectorAll(selectors)]
      .filter(visible)
      .map(el => {
        const text = textOf(el)
        const lower = text.toLowerCase()
        const storeLower = ctx.store.toLowerCase()
        if (!storeLower || !lower.includes(storeLower)) return null

        let score = 1
        if (lower === storeLower) score += 4
        if (text.includes(ctx.store)) score += 3
        if (aliasMatch(text, siteAliases)) score += 3
        if (/当前店铺|current|selected/i.test(text)) score -= 2
        return { el, score, len: text.length }
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score
        return a.len - b.len
      })[0]?.el || null
  }

  function getNextExecRow() {
    return executionRows[page] || null
  }

  function getPreviousExecRow() {
    return executionRows[page - 2] || null
  }

  function sameStoreGroup(left, right) {
    if (!left || !right) return false
    const leftSite = norm(left.row?.['站点'])
    const leftStore = norm(left.row?.['店铺'])
    const rightSite = norm(right.row?.['站点'])
    const rightStore = norm(right.row?.['店铺'])
    return leftSite === rightSite && leftStore === rightStore
  }

  function getFormItem(labelText) {
    const labels = Array.isArray(labelText) ? labelText.map(norm) : [norm(labelText)]
    return [...document.querySelectorAll('.eds-react-form-item, .eds-form-item')].find(el => {
      const label = el.querySelector('.eds-react-form-item__label, .eds-form-item__label')
      const text = norm(label?.textContent)
      return text && labels.some(item => text.includes(item))
    }) || null
  }

  function getTextInputs(container) {
    return [...(container || document).querySelectorAll(
      'input:not([type=radio]):not([type=checkbox]), textarea'
    )].filter(visible)
  }

  function hasCreateFormMounted() {
    return !!getFormItem('优惠券名称')
  }

  function isOnCreatePage() {
    return (
      location.href.includes('/portal/marketing/vouchers/new') ||
      location.href.includes('/portal/marketing/follow-prize/new') ||
      hasCreateFormMounted()
    )
  }

  function buildResultBase(ctx) {
    return {
      '序号': ctx.sourceIndex,
      '队列总数': executionRows.length,
      '站点': ctx.site,
      '店铺': ctx.store,
      '优惠券品类': ctx.voucherType,
      '奖励类型': ctx.rewardType,
      '折扣类型': ctx.discountType,
      '优惠限额': ctx.discountLimit,
      '生成优惠券名称': ctx.couponName,
      '生成优惠码': ctx.couponCode,
      '执行状态': '待执行',
      '错误原因': '',
      '当前URL': location.href || '',
    }
  }

  function buildContext(currentExecRow) {
    if (!currentExecRow) return null
    const row = currentExecRow.row || {}
    const showEarlyKey = Object.keys(row).find(key => key.replace(/\s+/g, '').includes('是否提前显示'))
    const store = norm(row['店铺'])
    const site = norm(row['站点'])
    const voucherType = norm(row['优惠券品类'])
    const rewardType = norm(row['奖励类型'])
    const discountType = norm(row['折扣类型'])
    const rawLimit = digitsOnly(row['优惠限额'])
    const discountLimit = rawLimit ? discountLimitValue(rawLimit, discountType) : ''
    const ctx = {
      row,
      sourceIndex: currentExecRow.sourceIndex,
      site,
      store,
      voucherType,
      rewardType,
      discountType,
      discountLimit,
      rawLimit,
      maxDiscount: digitsOnly(row['最高优惠金额']),
      minSpend: digitsOnly(row['最低消费金额']),
      totalCount: digitsOnly(row['可使用总数']),
      perBuyer: digitsOnly(row['每个买家可用的优惠券数量上限']),
      showEarly: boolLike(showEarlyKey ? row[showEarlyKey] : ''),
      startDt: parseDateTime(row['优惠券领取期限（开始）精确到分'], 'start'),
      endDt: parseDateTime(row['优惠券领取期限（结束）精确到分'], 'end'),
      couponName: shared.couponName || buildCouponName(discountType, discountLimit),
      couponCode: shared.couponCode || randCode(5),
      shopId: shared.shopId || getUrlShopId(),
    }
    ctx.usecase = getUsecaseByVoucherType(ctx.voucherType)
    ctx.result = shared.result || buildResultBase(ctx)
    return ctx
  }

  function validateContext(ctx) {
    if (!ctx.store) throw new Error('Excel 缺少"店铺"列')
    if (!ctx.voucherType) throw new Error('Excel 缺少"优惠券品类"列')
    if (!ctx.usecase) throw new Error(`不支持的优惠券品类：${ctx.voucherType}`)
    if (!ctx.couponName) throw new Error('未能生成优惠券名称')
    if (!ctx.couponCode) throw new Error('未能生成优惠码')
  }

  function markStage(ctx, stage) {
    if (!ctx?.result) return
    ctx.result['当前URL'] = location.href || ''
    ctx.result['当前阶段'] = stage
  }

  function buildShared(ctx, extras = {}) {
    return {
      couponName: ctx?.couponName || shared.couponName || '',
      couponCode: ctx?.couponCode || shared.couponCode || '',
      result: ctx?.result || shared.result || {},
      shopId: extras.shopId != null ? extras.shopId : (ctx?.shopId || shared.shopId || ''),
      ...extras,
    }
  }

  function navigateSoon(url, delayMs = 30) {
    const target = String(url || '').trim()
    if (!target) return false
    setTimeout(() => {
      try { location.href = target } catch {}
    }, delayMs)
    return true
  }

  function nextPhase(nextPhaseName, sleepMs, ctx, extras = {}) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'next_phase',
        next_phase: nextPhaseName,
        sleep_ms: sleepMs == null ? 1200 : sleepMs,
        shared: buildShared(ctx, extras),
      },
    }
  }

  function cdpPhase(clicks, nextPhaseName, sleepMs, ctx, extras = {}) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'cdp_clicks',
        clicks: clicks || [],
        next_phase: nextPhaseName,
        sleep_ms: sleepMs == null ? 300 : sleepMs,
        shared: buildShared(ctx, extras),
      },
    }
  }

  function finishRow(ctx, error) {
    const result = (ctx?.result || buildResultBase(ctx || {}))
    result['当前URL'] = location.href || result['当前URL'] || ''
    result['执行状态'] = error ? '失败' : '成功'
    result['错误原因'] = error || ''
    return {
      success: true,
      data: [result],
      meta: {
        action: 'complete',
        has_more: page < executionRows.length,
        page,
        total: executionRows.length,
        shared: {},
      },
    }
  }

  function completeNoRow() {
    return {
      success: true,
      data: [],
      meta: {
        action: 'complete',
        has_more: false,
        page,
        total: executionRows.length,
        shared: {},
      },
    }
  }

  function readInputValueFromItem(item, inputIndex = 0) {
    if (!item) return ''
    const input = getTextInputs(item)[inputIndex]
    return input ? norm(input.value || input.textContent || '') : ''
  }

  async function typeAndVerify(labelText, value, options = {}) {
    const item = getFormItem(labelText)
    if (!item) throw new Error(`未找到表单项：${Array.isArray(labelText) ? labelText.join(' / ') : labelText}`)
    const input = options.findInput ? options.findInput(item) : getTextInputs(item)[options.inputIndex || 0]
    if (!input) throw new Error(`表单项"${Array.isArray(labelText) ? labelText[0] : labelText}"没有可编辑输入框`)
    const compare = options.compare || ((actual, expected) => norm(actual) === norm(expected))

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await typeInto(input, value)
      const actual = norm(input.value || input.textContent || '')
      if (compare(actual, value)) return input
      await sleep(120)
    }
    throw new Error(`字段填写校验失败：${Array.isArray(labelText) ? labelText[0] : labelText}`)
  }

  function readCheckboxStateByText(text) {
    const target = [...document.querySelectorAll('label, .eds-react-checkbox')].find(el => {
      return visible(el) && textOf(el).includes(text)
    }) || null
    if (!target) return null
    const cb = target.querySelector?.('input[type=checkbox]') || (target.tagName === 'INPUT' ? target : null)
    if (cb) return !!cb.checked
    return target.classList.contains('eds-react-checkbox--checked') || target.getAttribute('aria-checked') === 'true'
  }

  async function setCheckboxAndVerify(text, desired, options = {}) {
    const target = [...document.querySelectorAll('label, .eds-react-checkbox')].find(el => {
      return visible(el) && textOf(el).includes(text)
    }) || null
    if (!target) {
      if (options.allowMissing) return false
      throw new Error(`未找到复选框：${text}`)
    }
    const cb = target.querySelector?.('input[type=checkbox]') || (target.tagName === 'INPUT' ? target : null)
    const applyState = async () => {
      if (cb) {
        setNativeChecked(cb, desired)
        const props = reactPropsOf(cb)
        try { props?.onChange?.({ target: cb, currentTarget: cb, nativeEvent: { target: cb } }) } catch {}
        try { props?.onClick?.({ target: cb, currentTarget: cb, preventDefault() {}, stopPropagation() {} }) } catch {}
      }
      if (readCheckboxStateByText(text) !== !!desired) {
        reactClick(target) || dispatchSyntheticClick(target)
      }
      await sleep(180)
    }

    if (readCheckboxStateByText(text) === !!desired) return true
    await applyState()
    if (readCheckboxStateByText(text) !== !!desired) {
      await applyState()
    }
    if (readCheckboxStateByText(text) !== !!desired) {
      throw new Error(`复选框状态不匹配：${text}`)
    }
    return true
  }

  function getRadioAliases(value) {
    const map = {
      '折扣': ['折扣', 'discount'],
      'shopee币回扣': ['shopee币回扣', 'shopee币回扣', '币回扣', 'coin cashback'],
    }
    return map[value] || [value]
  }

  function readSelectedRadioText(scope) {
    const item = scope || document
    const checked = [...item.querySelectorAll('input[type=radio]')].find(el => el.checked)
    if (checked) {
      const wrap = checked.closest('label, .eds-react-radio, .eds-radio') || checked.parentElement
      return textOf(wrap)
    }
    const checkedRoot = [...item.querySelectorAll('.eds-react-radio--checked, .eds-radio--checked, [aria-checked="true"]')]
      .find(visible)
    return checkedRoot ? textOf(checkedRoot) : ''
  }

  async function setRadioAndVerify(labelText, desiredText, options = {}) {
    const item = options.scope || getFormItem(labelText) || document
    const aliases = (options.aliases || getRadioAliases(desiredText)).map(alias => alias.toLowerCase())
    const current = readSelectedRadioText(item)
    if (aliasMatch(current, aliases)) return current

    const label = [...item.querySelectorAll('.eds-react-radio__label, .eds-radio__label, label, span')].find(el => {
      if (!visible(el)) return false
      const text = textOf(el).toLowerCase()
      return aliases.some(alias => text === alias || text.includes(alias))
    })
    if (!label) throw new Error(`未找到单选项：${desiredText}`)

    const radioRoot = label.closest('label, .eds-react-radio, .eds-radio') || label
    const radioInput = radioRoot.querySelector?.('input[type=radio]') || (radioRoot.tagName === 'INPUT' ? radioRoot : null)
    if (radioInput) {
      setNativeChecked(radioInput, true)
      const props = reactPropsOf(radioInput)
      try { props?.onChange?.({ target: radioInput, currentTarget: radioInput }) } catch {}
      try { props?.onClick?.({ target: radioInput, currentTarget: radioInput, preventDefault() {}, stopPropagation() {} }) } catch {}
      radioInput.dispatchEvent(new Event('change', { bubbles: true }))
    }
    if (!aliasMatch(readSelectedRadioText(item), aliases)) {
      reactClick(radioRoot) || dispatchSyntheticClick(radioRoot)
      await sleep(180)
    }
    const actual = readSelectedRadioText(item)
    if (!aliasMatch(actual, aliases)) {
      throw new Error(`单选未切换成功，期望：${desiredText}，实际：${actual || '(空)'}`)
    }
    return actual
  }

  function findSelectTrigger(item) {
    return item?.querySelector(
      '.trigger.trigger--normal, .eds-selector, [role="combobox"], .eds-react-select__inner, .eds-react-select'
    ) || null
  }

  function findSelectDisplay(item) {
    return (
      item?.querySelector('.trigger .eds-react-select__inner') ||
      item?.querySelector('.eds-selector__inner') ||
      item?.querySelector('.eds-react-select__inner') ||
      item?.querySelector('.trigger.trigger--normal') ||
      findSelectTrigger(item)
    )
  }

  function readSelectValue(item) {
    const display = findSelectDisplay(item)
    return textOf(display)
  }

  function getVueSelectInstance(item) {
    const root = findSelectDisplay(item) || findSelectTrigger(item)
    let inst = root?.__vueParentComponent || root?.__vue__ || null
    for (let i = 0; inst && i < 8; i += 1) {
      const typeName = inst.type?.name || inst.type?.__name || ''
      if (typeName === 'EdsSelect') return inst
      inst = inst.parent
    }
    return null
  }

  function getVueParentInstance(item, names) {
    const wanted = new Set((Array.isArray(names) ? names : [names]).filter(Boolean))
    const root = findSelectDisplay(item) || findSelectTrigger(item)
    let inst = root?.__vueParentComponent || root?.__vue__ || null
    for (let i = 0; inst && i < 20; i += 1) {
      const typeName = inst.type?.name || inst.type?.__name || ''
      if (wanted.has(typeName)) return inst
      inst = inst.parent
    }
    return null
  }

  function discountTypeValueForText(text, aliases) {
    const all = [text, ...(aliases || [])].map(v => String(v || '').toLowerCase())
    if (all.some(v => /百分比|percentage/.test(v))) return 1
    if (all.some(v => /金额|fixed/.test(v))) return 0
    return null
  }

  function readDiscountTypeState(item) {
    const selectInst = getVueSelectInstance(item)
    const rewardInst = getVueParentInstance(item, 'VoucherRewardSetting')
    return {
      text: readSelectValue(item),
      modelValue: selectInst?.props?.modelValue,
      voucherValue: rewardInst?.vnode?.props?.voucher?.discountType,
    }
  }

  function discountTypeMatches(item, desiredText, aliases) {
    const state = readDiscountTypeState(item)
    const allAliases = (aliases || [desiredText]).map(alias => String(alias || '').toLowerCase())
    if (aliasMatch(state.text, allAliases)) return true
    const targetValue = discountTypeValueForText(desiredText, aliases)
    if (targetValue == null) return false
    return Number(state.modelValue) === targetValue || Number(state.voucherValue) === targetValue
  }

  function getSelectControllerProps(item) {
    const root = findSelectDisplay(item) || findSelectTrigger(item)
    if (!root) return null
    const fiberKey = Object.keys(root).find(key => key.startsWith('__reactFiber'))
    let fiber = fiberKey ? root[fiberKey] : null
    for (let i = 0; fiber && i < 20; i += 1) {
      const props = fiber.memoizedProps || null
      if (props?.onChange && Array.isArray(props?.options)) {
        return props
      }
      fiber = fiber.return
    }
    return null
  }

  function selectOptionLabel(option) {
    if (!option) return ''
    if (typeof option.label === 'string') return norm(option.label)
    if (typeof option.children === 'string') return norm(option.children)
    return norm(option?.label?.props?.children || option?.children || '')
  }

  async function selectByInjectedValue(item, desiredText, aliases, resolveItem) {
    const props = getSelectControllerProps(item)
    if (!props?.onChange || !Array.isArray(props?.options)) return ''

    const allAliases = (aliases || [desiredText]).map(alias => String(alias || '').toLowerCase())
    const targetOption = props.options.find(option => {
      const label = selectOptionLabel(option).toLowerCase()
      return allAliases.some(alias => label === alias || label.includes(alias))
    })
    if (!targetOption) return ''

    const candidateValues = [targetOption.value, String(targetOption.value)]
    for (const candidate of candidateValues) {
      try {
        props.onChange(candidate)
      } catch {
        continue
      }
      await sleep(260)
      const currentItem = (typeof resolveItem === 'function' && resolveItem()) || item
      const actual = readSelectValue(currentItem)
      if (aliasMatch(actual, allAliases) || discountTypeMatches(currentItem, desiredText, aliases)) {
        return actual || desiredText
      }
    }
    return ''
  }

  async function selectByVueOption(item, desiredText, aliases, resolveItem) {
    const selectInst = getVueSelectInstance(item)
    if (!selectInst) return ''

    const allAliases = (aliases || [desiredText]).map(alias => String(alias || '').toLowerCase())
    const initialItem = (typeof resolveItem === 'function' && resolveItem()) || item
    const current = readSelectValue(initialItem)
    if (aliasMatch(current, allAliases) || discountTypeMatches(initialItem, desiredText, aliases)) return current || desiredText

    try {
      if (typeof selectInst.ctx?.show === 'function') selectInst.ctx.show()
      else if (typeof selectInst.ctx?.toggleVisible === 'function') selectInst.ctx.toggleVisible()
    } catch {}
    await sleep(260)

    const target = [...document.querySelectorAll('.eds-option, .eds-select-option, [role="option"], [class*="select-option"]')]
      .filter(visible)
      .find(el => {
        const text = textOf(el).toLowerCase()
        return allAliases.some(alias => text === alias || text.includes(alias))
      })
    if (!target) return ''

    const optionInst = target.__vueParentComponent || target.__vue__
    if (typeof optionInst?.ctx?.onOptionClick === 'function') {
      try {
        optionInst.ctx.onOptionClick({
          preventDefault() {},
          stopPropagation() {},
          target,
          currentTarget: target,
          nativeEvent: { target },
        })
      } catch {}
    } else {
      clickSequence(target)
    }
    await sleep(300)
    const currentItem = (typeof resolveItem === 'function' && resolveItem()) || item
    return readSelectValue(currentItem) || (discountTypeMatches(currentItem, desiredText, aliases) ? desiredText : '')
  }

  async function selectByVueChange(item, desiredText, aliases, resolveItem) {
    const targetValue = discountTypeValueForText(desiredText, aliases)
    if (targetValue == null) return ''

    const allAliases = (aliases || [desiredText]).map(alias => String(alias || '').toLowerCase())
    const initialItem = (typeof resolveItem === 'function' && resolveItem()) || item
    if (discountTypeMatches(initialItem, desiredText, aliases)) return readSelectValue(initialItem) || desiredText

    const emitters = [
      getVueParentInstance(item, 'DisplayType')?.vnode?.props?.onChange,
      getVueParentInstance(item, 'VoucherRewardSetting')?.vnode?.props?.onChange,
    ].filter(fn => typeof fn === 'function')

    for (const emitChange of emitters) {
      try {
        emitChange({ discountType: targetValue })
      } catch {
        continue
      }
      const actual = await waitFor(() => {
        const currentItem = (typeof resolveItem === 'function' && resolveItem()) || item
        if (!discountTypeMatches(currentItem, desiredText, aliases)) return ''
        return readSelectValue(currentItem) || desiredText
      }, 5000, 150)
      if (actual) {
        return actual
      }
    }

    return ''
  }

  async function openSelectAndChoose(labelText, desiredText, aliases) {
    const item = getFormItem(labelText)
    if (!item) throw new Error(`未找到下拉字段：${Array.isArray(labelText) ? labelText[0] : labelText}`)
    const trigger = findSelectTrigger(item)
    if (!trigger) throw new Error(`未找到下拉触发器：${Array.isArray(labelText) ? labelText[0] : labelText}`)

    const allAliases = (aliases || [desiredText]).map(alias => alias.toLowerCase())
    const resolveItem = () => getFormItem(labelText) || item
    const readCurrentValue = () => {
      const currentItem = resolveItem()
      return readSelectValue(currentItem)
    }
    const currentMatches = () => {
      const currentItem = resolveItem()
      return !!currentItem && (aliasMatch(readSelectValue(currentItem), allAliases) || discountTypeMatches(currentItem, desiredText, aliases))
    }

    if (currentMatches()) {
      return readCurrentValue()
    }

    const injectedActual = await selectByInjectedValue(item, desiredText, aliases, resolveItem)
    if (aliasMatch(injectedActual, allAliases) || currentMatches()) {
      return injectedActual
    }

    const vueChanged = await selectByVueChange(item, desiredText, aliases, resolveItem)
    if (aliasMatch(vueChanged, allAliases) || currentMatches()) {
      return vueChanged
    }

    const vueActual = await selectByVueOption(item, desiredText, aliases, resolveItem)
    if (aliasMatch(vueActual, allAliases) || currentMatches()) {
      return vueActual
    }

    const findOptions = () => {
      const panels = [...document.querySelectorAll(
        '.eds-react-select-option-popover, .eds-react-popover, .eds-dropdown, .eds-popper, [role="listbox"], ' +
        '.eds-react-select-option-container, .eds-react-select-options-list'
      )].filter(visible)

      const roots = new Set([
        ...document.querySelectorAll(
          '.eds-react-select-option, .eds-select-option, [role="option"], [class*="select-option"]'
        ),
      ])

      return [...roots]
        .filter(el => {
          if (!visible(el)) return false
          if (trigger === el || trigger?.contains?.(el) || el?.contains?.(trigger)) return false
          const text = textOf(el).toLowerCase()
          if (!text) return false
          return allAliases.some(alias => text === alias || text.includes(alias))
        })
        .map(el => {
          const rect = el.getBoundingClientRect()
          const text = textOf(el).toLowerCase()
          const rootProps = reactPropsOf(el)
          return {
            el,
            text,
            exact: allAliases.some(alias => text === alias),
            inPanel: panels.some(panel => panel.contains(el)),
            selected: /selected|active|checked/i.test(String(el.className || '')),
            hasProps: !!rootProps?.onClick || !!rootProps?.onMouseDown,
            area: Math.round(rect.width * rect.height),
          }
        })
        .sort((a, b) => {
          if (a.exact !== b.exact) return a.exact ? -1 : 1
          if (a.inPanel !== b.inPanel) return a.inPanel ? -1 : 1
          if (a.selected !== b.selected) return a.selected ? 1 : -1
          if (a.hasProps !== b.hasProps) return a.hasProps ? -1 : 1
          if (a.text.length !== b.text.length) return a.text.length - b.text.length
          return a.area - b.area
        })
        .map(entry => entry.el)
    }

    const openTrigger = async () => {
      const target = trigger.closest('.trigger.trigger--normal, .eds-selector, [role="combobox"]') || trigger
      try { target.scrollIntoView({ block: 'center' }) } catch {}
      await sleep(120)

      const props = reactPropsOf(target)
      if (props?.onMouseDown) {
        try {
          props.onMouseDown({
            preventDefault() {},
            stopPropagation() {},
            target,
            currentTarget: target,
            nativeEvent: { target },
          })
          return
        } catch {}
      }
      if (props?.onClick) {
        try {
          props.onClick({
            preventDefault() {},
            stopPropagation() {},
            target,
            currentTarget: target,
            nativeEvent: { target },
          })
          return
        } catch {}
      }
      clickSequence(target)
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await openTrigger()
      await sleep(450)

      const options = await waitFor(() => {
        const list = findOptions()
        return list.length > 0 ? list : null
      }, 3000, 200)
      if (!options?.length) continue

      for (const option of options.slice(0, 6)) {
        const clickTargets = [...new Set([
          option,
          option.querySelector?.('.eds-react-select-option__content, span, div'),
          option.closest('[role="option"], .eds-react-select-option, .eds-select-option, li, button, label, div'),
        ].filter(Boolean))]

        for (const clickTarget of clickTargets) {
          const props = reactPropsOf(clickTarget)
          if (props?.onMouseDown) {
            try {
              props.onMouseDown({
                preventDefault() {},
                stopPropagation() {},
                target: clickTarget,
                currentTarget: clickTarget,
                nativeEvent: { target: clickTarget },
              })
              await sleep(280)
              const actual = readCurrentValue()
              if (aliasMatch(actual, allAliases) || currentMatches()) return actual || desiredText
            } catch {}
          }
          if (props?.onClick) {
            try {
              props.onClick({
                preventDefault() {},
                stopPropagation() {},
                target: clickTarget,
                currentTarget: clickTarget,
                nativeEvent: { target: clickTarget },
              })
              await sleep(280)
              const actual = readCurrentValue()
              if (aliasMatch(actual, allAliases) || currentMatches()) return actual || desiredText
            } catch {}
          }
          clickSequence(clickTarget)
          await sleep(280)
          const actual = readCurrentValue()
          if (aliasMatch(actual, allAliases) || currentMatches()) return actual || desiredText
        }
      }
    }

    throw new Error(`下拉选择失败，期望：${desiredText}，实际：${readCurrentValue() || '(空)'}`)
  }

  async function fillDiscountLimitAndVerify(value) {
    const resolved = await waitFor(() => {
      const item = getFormItem('折扣类型 | 优惠限额') || getFormItem('折扣类型')
      if (!item) return null
      const input = getTextInputs(item).find(el => visible(el))
      return input ? { item, input } : null
    }, 5000, 150)
    if (!resolved) throw new Error('未找到优惠限额输入框')
    const { input } = resolved
    await typeInto(input, value)
    const actual = norm(input.value)
    if (!sameNumeric(actual, value)) {
      await typeInto(input, value)
    }
    if (!sameNumeric(norm(input.value), value)) {
      throw new Error(`优惠限额校验失败，期望：${value}，实际：${input.value || '(空)'}`)
    }
  }

  function getMaxDiscountLabels() {
    return ['最高优惠金额', '最高折扣金额', '最高优惠', '最高减免', '最高上限数额', 'Max Discount']
  }

  function findMaxDiscountItem() {
    for (const label of getMaxDiscountLabels()) {
      const item = getFormItem(label)
      if (item) return item
    }
    return null
  }

  function findMaxDiscountInput(item) {
    if (!item) return null
    const localInput = getTextInputs(item).find(el => visible(el))
    if (localInput) return localInput

    const scope = item.closest('[data-testid="rewardSettingForm"], form, .KKFTrn2tfR--O59BPo8w1, ._3w6d_xvJaKfb7LDYRY2bMT') || item.parentElement || document
    const nearby = [...scope.querySelectorAll('input:not([type=radio]):not([type=checkbox]), textarea')]
      .filter(visible)
      .find(el => {
        const wrap = el.closest('.eds-react-form-item, .eds-form-item, .eds-react-input, .eds-input') || el.parentElement
        return getMaxDiscountLabels().some(label => textOf(wrap).includes(label)) || textOf(wrap).includes('设置金额')
      })
    if (nearby) return nearby

    const itemRect = item.getBoundingClientRect()
    const spatial = getTextInputs(scope)
      .filter(el => visible(el) && !item.contains(el))
      .map(el => ({ el, rect: el.getBoundingClientRect() }))
      .filter(({ rect }) => {
        return rect.top >= itemRect.bottom - 8 &&
          rect.top <= itemRect.bottom + 220 &&
          rect.left >= itemRect.left - 8
      })
      .sort((a, b) => {
        const scoreA = Math.abs(a.rect.top - itemRect.bottom) + Math.abs(a.rect.left - itemRect.left)
        const scoreB = Math.abs(b.rect.top - itemRect.bottom) + Math.abs(b.rect.left - itemRect.left)
        return scoreA - scoreB
      })
    if (spatial[0]?.el) return spatial[0].el

    let sibling = item.nextElementSibling
    while (sibling) {
      const input = [...sibling.querySelectorAll('input:not([type=radio]):not([type=checkbox]), textarea')]
        .filter(visible)[0]
      if (input) return input
      sibling = sibling.nextElementSibling
    }
    return null
  }

  async function fillMaxDiscountAndVerify(value) {
    const item = await waitFor(() => findMaxDiscountItem(), 5000, 150)
    if (!item) throw new Error('未找到最高优惠金额表单项')

    const setAmountLabel = [...item.querySelectorAll('label, .eds-react-radio__label, .eds-radio__label, span')]
      .find(el => visible(el) && /设置金额|Set Amount/.test(textOf(el)))
    if (setAmountLabel) {
      const scope = item
      await setRadioAndVerify(null, '设置金额', { scope, aliases: ['设置金额', 'set amount'] })
      await sleep(300)
    }

    let input = await waitFor(() => findMaxDiscountInput(item), 3000, 200)
    if (!input) {
      if (setAmountLabel) {
        reactClick(setAmountLabel.closest('label') || setAmountLabel) || dispatchSyntheticClick(setAmountLabel.closest('label') || setAmountLabel)
        await sleep(500)
      }
      input = await waitFor(() => findMaxDiscountInput(item), 3000, 200)
    }
    if (!input) throw new Error('最高优惠金额输入框未出现')

    await typeInto(input, String(toNumber(value)))
    if (!sameNumeric(norm(input.value), String(toNumber(value)))) {
      await typeInto(input, String(toNumber(value)))
    }
    if (!sameNumeric(norm(input.value), String(toNumber(value)))) {
      throw new Error(`最高优惠金额校验失败，期望：${value}，实际：${input.value || '(空)'}`)
    }
    return true
  }

  function getDateValueInput(item, kind) {
    const root = item?.querySelector(kind === 'start' ? '#startDate' : '#endDate')
    return (
      root?.querySelector('input.eds-react-input__input') ||
      root?.querySelector('input') ||
      item?.querySelector(`.picker-item.${kind}-picker input.eds-react-input__input`) ||
      item?.querySelector(`.picker-item.${kind}-picker input`) ||
      null
    )
  }

  function readDateRangeValues(item) {
    const startInput = getDateValueInput(item, 'start')
    const endInput = getDateValueInput(item, 'end')

    const start = norm(
      startInput?.value ||
      item?.querySelector('.picker-item.start-picker .eds-selector__inner, .picker-item.start-picker .line-clamp--1')?.textContent ||
      item?.querySelector('.picker-item.start-picker')?.textContent ||
      ''
    )
    const end = norm(
      endInput?.value ||
      item?.querySelector('.picker-item.end-picker .eds-selector__inner, .picker-item.end-picker .line-clamp--1')?.textContent ||
      item?.querySelector('.picker-item.end-picker')?.textContent ||
      ''
    )
    return { start, end }
  }

  async function closeDatePickerPanels() {
    for (let i = 0; i < 2; i += 1) {
      try { document.body.click() } catch {}
      await sleep(120)
    }
  }

  async function setDateRangeJS(startDt, endDt) {
    const container = document.querySelector('.date-range-picker-container, .date-range-picker, .date-range-picker-container.date-picker')
    if (!container) throw new Error('未找到关注礼日期组件')

    let vueInst = container.__vue__ || container.__vueParentComponent
    if (!vueInst?.ctx?.handleStartChange) {
      const vueEl = [...document.querySelectorAll('*')].find(el => {
        return el.__vue__?.ctx?.handleStartChange || el.__vueParentComponent?.ctx?.handleStartChange
      })
      vueInst = vueEl?.__vue__ || vueEl?.__vueParentComponent
    }
    if (!vueInst?.ctx?.handleStartChange) throw new Error('未找到关注礼日期处理器')

    const ctx = vueInst.ctx
    const toLocalString = dt => dt ? `${dt.y}-${dt.mo}-${dt.d} ${dt.hh}:${dt.mm}:00` : null

    if (startDt) {
      ctx.handleStartChange(toLocalString(startDt))
      await sleep(250)
    }
    if (endDt) {
      ctx.handleEndChange(toLocalString(endDt))
      await sleep(250)
    }
    try { ctx.validate?.() } catch {}
    try { document.body.click() } catch {}
    await sleep(200)

    const item = getFormItem(['优惠券领取期限', 'Claim Period']) || container
    const values = readDateRangeValues(item)
    if (startDt && !sameDateTime(values.start, startDt)) {
      throw new Error(`开始日期回读失败，期望：${startDt.str}，实际：${values.start || '(空)'}`)
    }
    if (endDt && !sameDateTime(values.end, endDt)) {
      throw new Error(`结束日期回读失败，期望：${endDt.str}，实际：${values.end || '(空)'}`)
    }
    return true
  }

  function findDatePickerProps(root) {
    if (!root) return null
    const fiberKey = Object.keys(root).find(key => key.startsWith('__reactFiber'))
    let fiber = fiberKey ? root[fiberKey] : null
    for (let i = 0; fiber && i < 18; i += 1) {
      const props = fiber.memoizedProps || null
      if (props?.onChange && Object.prototype.hasOwnProperty.call(props, 'value')) {
        return props
      }
      fiber = fiber.return
    }
    return null
  }

  function dateRootForKind(item, kind) {
    return (
      item?.querySelector(kind === 'start' ? '#startDate' : '#endDate') ||
      item?.querySelector(`.picker-item.${kind}-picker .eds-react-date-picker__input`) ||
      item?.querySelector(`.picker-item.${kind}-picker .eds-date-picker`) ||
      null
    )
  }

  function toBrowserDate(dt) {
    if (!dt) return null
    return new Date(dt.year, dt.month - 1, dt.day, Number(dt.hh), Number(dt.mm), 0, 0)
  }

  async function setReactDateRange(startDt, endDt, item) {
    const applyOne = async (kind, dt) => {
      if (!dt) return
      const root = dateRootForKind(item, kind)
      if (!root) throw new Error(`未找到${kind === 'start' ? '开始' : '结束'}日期根节点`)
      const props = findDatePickerProps(root)
      if (!props?.onChange) throw new Error(`未找到${kind === 'start' ? '开始' : '结束'}日期注入处理器`)
      props.onChange(toBrowserDate(dt), dt.str)
      await sleep(300)
    }

    if (startDt) await applyOne('start', startDt)
    if (endDt) await applyOne('end', endDt)
    await sleep(200)

    const values = readDateRangeValues(item)
    if (startDt && !sameDateTime(values.start, startDt)) {
      throw new Error(`开始日期回读失败，期望：${startDt.str}，实际：${values.start || '(空)'}`)
    }
    if (endDt && !sameDateTime(values.end, endDt)) {
      throw new Error(`结束日期回读失败，期望：${endDt.str}，实际：${values.end || '(空)'}`)
    }
    return true
  }

  function ensureResultExists(ctx) {
    if (!ctx.result) ctx.result = buildResultBase(ctx)
    return ctx
  }

  function verifyAllFields(ctx) {
    const issues = []

    const couponNameValue = readInputValueFromItem(getFormItem('优惠券名称'))
    if (norm(couponNameValue) !== norm(ctx.couponName)) {
      issues.push(`优惠券名称不匹配（期望：${ctx.couponName}，实际：${couponNameValue || '(空)'}）`)
    }

    const couponCodeItem = getFormItem('优惠码')
    if (couponCodeItem) {
      const couponCodeInput = getTextInputs(couponCodeItem).find(input => !input.readOnly && !input.disabled)
      if (couponCodeInput) {
        const couponCodeValue = norm(couponCodeInput.value || couponCodeInput.textContent || '')
        if (couponCodeValue !== norm(ctx.couponCode)) {
          issues.push(`优惠码不匹配（期望：${ctx.couponCode}，实际：${couponCodeValue || '(空)'}）`)
        }
      }
    }

    const dateItem = getFormItem(['优惠券领取期限', 'Claim Period'])
    if (dateItem) {
      const values = readDateRangeValues(dateItem)
      if (ctx.startDt && !sameDateTime(values.start, ctx.startDt)) {
        issues.push(`开始日期不匹配（期望：${ctx.startDt.str}，实际：${values.start || '(空)'}）`)
      }
      if (ctx.endDt && !sameDateTime(values.end, ctx.endDt)) {
        issues.push(`结束日期不匹配（期望：${ctx.endDt.str}，实际：${values.end || '(空)'}）`)
      }
    }

    const showEarlyState = readCheckboxStateByText('提前显示优惠券')
    if (showEarlyState != null && showEarlyState !== !!ctx.showEarly) {
      issues.push(`提前显示优惠券不匹配（期望：${!!ctx.showEarly}，实际：${showEarlyState}）`)
    }

    if (ctx.rewardType) {
      const rewardText = readSelectedRadioText(getFormItem('奖励类型') || document)
      if (!aliasMatch(rewardText, getRadioAliases(ctx.rewardType))) {
        issues.push(`奖励类型不匹配（期望：${ctx.rewardType}，实际：${rewardText || '(空)'}）`)
      }
    }

    if (ctx.discountType) {
      const aliases = {
        '扣除百分比': ['扣除百分比', '折扣百分比', 'percentage'],
        '折扣金额': ['折扣金额', '固定金额', 'fixed amount'],
      }
      const item = getFormItem('折扣类型 | 优惠限额') || getFormItem('折扣类型')
      const actual = readSelectValue(item)
      if (!aliasMatch(actual, aliases[ctx.discountType] || [ctx.discountType]) && !discountTypeMatches(item, ctx.discountType, aliases[ctx.discountType] || [ctx.discountType])) {
        issues.push(`折扣类型不匹配（期望：${ctx.discountType}，实际：${actual || '(空)'}）`)
      }
    }

    if (ctx.discountLimit) {
      const actual = readInputValueFromItem(getFormItem('折扣类型 | 优惠限额') || getFormItem('折扣类型'))
      if (!sameNumeric(actual, ctx.discountLimit)) {
        issues.push(`优惠限额不匹配（期望：${ctx.discountLimit}，实际：${actual || '(空)'}）`)
      }
    }

    if (ctx.maxDiscount) {
      const maxItem = findMaxDiscountItem()
      const maxInput = findMaxDiscountInput(maxItem)
      const actual = norm(maxInput?.value || '')
      if (!sameNumeric(actual, ctx.maxDiscount)) {
        issues.push(`最高优惠金额不匹配（期望：${ctx.maxDiscount}，实际：${actual || '(空)'}）`)
      }
    }

    if (ctx.minSpend) {
      const actual = readInputValueFromItem(getFormItem('最低消费金额'))
      if (!sameNumeric(actual, ctx.minSpend)) {
        issues.push(`最低消费金额不匹配（期望：${ctx.minSpend}，实际：${actual || '(空)'}）`)
      }
    }

    if (ctx.totalCount) {
      const actual = readInputValueFromItem(getFormItem(['可使用总数', '优惠券可使用总数']))
      if (!sameNumeric(actual, ctx.totalCount)) {
        issues.push(`可使用总数不匹配（期望：${ctx.totalCount}，实际：${actual || '(空)'}）`)
      }
    }

    if (ctx.perBuyer) {
      const perBuyerItem = getFormItem('每个买家可用的优惠券数量上限') || getFormItem('每个买家')
      if (perBuyerItem) {
        const actual = readInputValueFromItem(perBuyerItem)
        if (!sameNumeric(actual, ctx.perBuyer)) {
          issues.push(`每个买家限额不匹配（期望：${ctx.perBuyer}，实际：${actual || '(空)'}）`)
        }
      }
    }

    return issues
  }

  function isExpectedCreatePage(ctx) {
    const href = location.href || ''
    if (ctx.usecase === '999') return href.includes('/portal/marketing/follow-prize/new')
    if (!href.includes('/portal/marketing/vouchers/new')) return false
    try {
      return new URL(href).searchParams.get('usecase') === ctx.usecase
    } catch {
      return false
    }
  }

  async function ensureCreateFormReady(ctx) {
    const formReady = await waitFor(() => {
      return (
        getFormItem('优惠券名称') ||
        getFormItem(['优惠券领取期限', 'Claim Period']) ||
        document.querySelector('.date-range-picker-container, .date-range-picker')
      )
    }, 8000, 200)
    if (!formReady) {
      throw new Error(`未进入${ctx.voucherType}创建表单，当前URL：${location.href.substring(0, 120)}`)
    }
    return formReady
  }

  async function fillCouponIdentity(ctx) {
    await typeAndVerify('优惠券名称', ctx.couponName)
    const couponCodeItem = getFormItem('优惠码')
    if (couponCodeItem) {
      const couponCodeInput = getTextInputs(couponCodeItem).find(input => !input.readOnly && !input.disabled)
      if (couponCodeInput) {
        await typeAndVerify('优惠码', ctx.couponCode, {
          findInput: () => couponCodeInput,
        })
      }
    }
  }

  async function fillVoucherDates(ctx, options = {}) {
    if (!ctx.startDt && !ctx.endDt) return true
    const dateItem = getFormItem(['优惠券领取期限', 'Claim Period']) ||
      document.querySelector('.date-range-picker-container, .date-range-picker')
    if (!dateItem) throw new Error('未找到优惠券领取期限表单项')
    if (options.mode === 'legacy') {
      await setDateRangeJS(ctx.startDt, ctx.endDt)
    } else {
      await setReactDateRange(ctx.startDt, ctx.endDt, dateItem)
    }
    await closeDatePickerPanels()
    return true
  }

  async function fillCommonRuleFields(ctx, options = {}) {
    await setCheckboxAndVerify('提前显示优惠券', ctx.showEarly, {
      allowMissing: !!options.allowMissingShowEarly,
    })

    if (ctx.rewardType) {
      await setRadioAndVerify('奖励类型', ctx.rewardType)
    }

    if (ctx.discountType) {
      const aliases = {
        '扣除百分比': ['扣除百分比', '折扣百分比', 'percentage'],
        '折扣金额': ['折扣金额', '固定金额', 'fixed amount'],
      }
      await openSelectAndChoose(['折扣类型 | 优惠限额', '折扣类型'], ctx.discountType, aliases[ctx.discountType] || [ctx.discountType])
    }

    if (ctx.discountLimit) {
      await fillDiscountLimitAndVerify(ctx.discountLimit)
    }

    if (ctx.maxDiscount) {
      await fillMaxDiscountAndVerify(ctx.maxDiscount)
    }

    if (ctx.minSpend) {
      await typeAndVerify('最低消费金额', String(toNumber(ctx.minSpend)), {
        compare: sameNumeric,
      })
    }

    if (ctx.totalCount) {
      await typeAndVerify(['可使用总数', '优惠券可使用总数'], String(toNumber(ctx.totalCount)), {
        compare: sameNumeric,
      })
    }

    if (ctx.perBuyer) {
      const perBuyerItem = getFormItem('每个买家可用的优惠券数量上限') || getFormItem('每个买家')
      if (perBuyerItem) {
        await typeAndVerify(['每个买家可用的优惠券数量上限', '每个买家'], String(toNumber(ctx.perBuyer)), {
          compare: sameNumeric,
        })
      }
    }
  }

  async function waitForFollowPrizeDiscountFields(ctx) {
    if (!ctx.discountType) return true
    const aliases = {
      '扣除百分比': ['扣除百分比', '折扣百分比', 'percentage'],
      '折扣金额': ['折扣金额', '固定金额', 'fixed amount'],
    }
    const allAliases = aliases[ctx.discountType] || [ctx.discountType]
    const needMaxDiscount = /百分比|percentage/i.test(ctx.discountType || '') && !!ctx.maxDiscount

    const ready = await waitFor(() => {
      const item = getFormItem('折扣类型 | 优惠限额') || getFormItem('折扣类型')
      if (!item) return null
      const matched = aliasMatch(readSelectValue(item), allAliases) || discountTypeMatches(item, ctx.discountType, allAliases)
      if (!matched) return null
      const discountInput = getTextInputs(item).find(el => visible(el))
      if (!discountInput) return null
      if (needMaxDiscount && !findMaxDiscountItem()) return null
      return true
    }, 5000, 150)

    if (!ready) {
      throw new Error(`关注礼折扣设置未完成渲染：${ctx.discountType}`)
    }
    return true
  }

  async function fillFollowPrizeRuleFields(ctx) {
    if (ctx.rewardType) {
      await setRadioAndVerify('奖励类型', ctx.rewardType)
    }

    if (ctx.discountType) {
      const aliases = {
        '扣除百分比': ['扣除百分比', '折扣百分比', 'percentage'],
        '折扣金额': ['折扣金额', '固定金额', 'fixed amount'],
      }
      await openSelectAndChoose(['折扣类型 | 优惠限额', '折扣类型'], ctx.discountType, aliases[ctx.discountType] || [ctx.discountType])
      await waitForFollowPrizeDiscountFields(ctx)
    }

    if (ctx.discountLimit) {
      await fillDiscountLimitAndVerify(ctx.discountLimit)
    }

    if (ctx.maxDiscount && /百分比|percentage/i.test(ctx.discountType || '')) {
      await fillMaxDiscountAndVerify(ctx.maxDiscount)
    }

    if (ctx.minSpend) {
      await typeAndVerify('最低消费金额', String(toNumber(ctx.minSpend)), {
        compare: sameNumeric,
      })
    }

    if (ctx.totalCount) {
      await typeAndVerify(['可使用总数', '优惠券可使用总数'], String(toNumber(ctx.totalCount)), {
        compare: sameNumeric,
      })
    }
  }

  async function fillNormalVoucherUsecase(ctx) {
    await ensureCreateFormReady(ctx)
    await fillCouponIdentity(ctx)
    await fillVoucherDates(ctx, { mode: 'react' })
    await fillCommonRuleFields(ctx)
  }

  async function fillFollowPrizeUsecase(ctx) {
    await ensureCreateFormReady(ctx)
    await fillCouponIdentity(ctx)
    await fillVoucherDates(ctx, { mode: 'legacy' })
    await fillFollowPrizeRuleFields(ctx)
  }

  async function fillVoucherFormByUsecase(ctx) {
    if (ctx.usecase === '999') {
      await fillFollowPrizeUsecase(ctx)
    } else {
      await fillNormalVoucherUsecase(ctx)
    }
    const issues = verifyAllFields(ctx)
    if (issues.length > 0) {
      throw new Error(`字段最终校验失败：${issues.join(' | ')}`)
    }
  }

  function looksLikeValidationError(text) {
    const msg = norm(text)
    if (!msg) return false
    if (/将不会展示给买家|吸引人的折扣优惠券|可使用的优惠券总数/.test(msg)) return false
    return /错误|失败|不能为空|不可|不能|无效|必填|至少|最多|超出|已存在|不支持|请.+(输入|选择|填写)|must|invalid|required|failed|error/i.test(msg)
  }

  function collectVisibleFormErrors() {
    return [...document.querySelectorAll(
      '.eds-react-form-item__extra, .eds-react-form-item__help, .eds-form-item__extra, .eds-form-item__help, ' +
      '[class*="error-msg"], [class*="error-text"], [class*="form-error"]'
    )]
      .filter(visible)
      .map(el => textOf(el))
      .filter(looksLikeValidationError)
  }

  function findSubmitConfirmButton() {
    const isPopupButton = el => !!el?.closest(
      '.eds-react-date-picker__popup, .eds-react-popover, .eds-popover, .picker-panel, .date-picker-panel, ' +
      '.time-picker-panel, [class*="popover"], [class*="picker-panel"]'
    )

    const candidates = [...document.querySelectorAll('button')]
      .filter(visible)
      .filter(el => /^(确认|确定)$/.test(textOf(el)))
      .filter(el => !isPopupButton(el))
      .map(el => {
        const rect = el.getBoundingClientRect()
        return {
          el,
          primary: (el.className || '').includes('primary'),
          inFooter: !!el.closest('form, .footer, .page-footer, .footer-actions, .button-group, .eds-sticky, .sticky-footer, .footer-container'),
          top: rect.top,
        }
      })
      .sort((a, b) => {
        if (a.inFooter !== b.inFooter) return a.inFooter ? -1 : 1
        if (a.primary !== b.primary) return a.primary ? -1 : 1
        return b.top - a.top
      })

    if (candidates.length > 0) return candidates[0].el

    return [...document.querySelectorAll('button')].filter(visible).find(el => /^(确认|确定)$/.test(textOf(el))) || null
  }

  if (!execRow) {
    return completeNoRow()
  }

  try {
    const ctx = ensureResultExists(buildContext(execRow))
    await closeBlockingOverlays()

    if (currentPhase === 'main') {
      markStage(ctx, 'main')
      return nextPhase('prepare_row', 80, ctx)
    }

    if (currentPhase === 'prepare_row') {
      markStage(ctx, 'prepare_row')
      validateContext(ctx)
      return nextPhase('ensure_marketing', 80, ctx)
    }

    if (currentPhase === 'ensure_marketing') {
      markStage(ctx, 'ensure_marketing')
      const previousExecRow = getPreviousExecRow()
      const crossStoreBoundary = previousExecRow && !sameStoreGroup(previousExecRow, execRow)
      const onMarketingHome = /^https:\/\/seller\.shopee\.cn\/portal\/marketing(?:\?|$)/.test(location.href || '')
      const sameStoreAsCurrentPage = isStoreMatched(ctx)
      if ((crossStoreBoundary || (!sameStoreAsCurrentPage && !onMarketingHome)) && !onMarketingHome) {
        navigateSoon(MARKETING_URL)
        return nextPhase('ensure_marketing', 2500, ctx, {
          awaiting_store_switch: false,
          previous_shop_id: '',
        })
      }
      if (!location.href.includes('/portal/marketing')) {
        navigateSoon(MARKETING_URL)
        return nextPhase('ensure_marketing', 2500, ctx)
      }
      return nextPhase('ensure_store', 100, ctx)
    }

    if (currentPhase === 'ensure_store') {
      markStage(ctx, 'ensure_store')
      if (isStoreMatched(ctx)) {
        const shopId = getUrlShopId() || shared.shopId || ctx.shopId
        if (!shopId) {
          navigateSoon(MARKETING_URL)
          return nextPhase('ensure_store', 1800, ctx, { awaiting_store_switch: false })
        }
        ctx.shopId = shopId
        return nextPhase('open_usecase_form', 100, ctx, {
          shopId,
          awaiting_store_switch: false,
          previous_shop_id: '',
        })
      }

      if (!location.href.includes('/portal/marketing')) {
        navigateSoon(MARKETING_URL)
        return nextPhase('ensure_store', 2500, ctx, { awaiting_store_switch: false })
      }

      const searchInput = findStoreSearchInput()
      if (!searchInput) {
        const trigger = findStoreSwitcherTrigger()
        if (!trigger) {
          navigateSoon(MARKETING_URL)
          return nextPhase('ensure_store', 2500, ctx, { awaiting_store_switch: false })
        }
        const coord = rectCenter(trigger)
        if (!coord) throw new Error('店铺切换入口坐标为空')
        return cdpPhase([{ ...coord, delay_ms: 500, label: '店铺切换入口' }], 'ensure_store', 800, ctx)
      }

      await typeInto(searchInput, ctx.store)
      const switcher = document.querySelector('.shop-switcher')
      const switcherVue = switcher?.__vueParentComponent || switcher?.__vue__
      if (switcherVue?.ctx?.searchShop) {
        try { switcherVue.ctx.searchShop(ctx.store) } catch {}
      }
      await sleep(300)

      const candidate = await waitFor(() => findStoreCandidate(ctx), 5000, 200)
      if (!candidate) throw new Error(`搜索后未找到店铺：${ctx.store}`)
      const coord = rectCenter(candidate)
      if (!coord) throw new Error('店铺候选项坐标为空')
      return cdpPhase([{ ...coord, delay_ms: 600, label: `选择店铺:${ctx.store}` }], 'ensure_store', 1800, ctx, {
        previous_shop_id: getUrlShopId(),
        awaiting_store_switch: true,
      })
    }

    if (currentPhase === 'open_usecase_form') {
      markStage(ctx, 'open_usecase_form')
      const shopId = shared.shopId || ctx.shopId || getUrlShopId()
      if (!shopId) throw new Error('未解析到店铺 shopId')
      ctx.shopId = shopId
      const targetUrl = buildCreateUrl(ctx.voucherType, shopId)
      if (!isExpectedCreatePage(ctx)) {
        navigateSoon(targetUrl)
        return nextPhase('open_usecase_form', 2500, ctx, { shopId })
      }
      await ensureCreateFormReady(ctx)
      return nextPhase('fill_usecase_form', 100, ctx, { shopId })
    }

    if (currentPhase === 'fill_usecase_form') {
      markStage(ctx, 'fill_usecase_form')
      await fillVoucherFormByUsecase(ctx)
      return nextPhase('submit_form', 120, ctx)
    }

    if (currentPhase === 'submit_form') {
      markStage(ctx, 'submit_form')
      await closeDatePickerPanels()
      await closeBlockingOverlays()
      const preErrors = collectVisibleFormErrors()
      if (preErrors.length > 0) {
        throw new Error(`表单校验错误：${preErrors.join(' | ')}`)
      }
      const confirmBtn = findSubmitConfirmButton()
      if (!confirmBtn) throw new Error('未找到提交确认按钮')
      reactClick(confirmBtn) || dispatchSyntheticClick(confirmBtn)
      return nextPhase('post_submit', 3200, ctx)
    }

    if (currentPhase === 'post_submit') {
      markStage(ctx, 'post_submit')
      const ok = await waitFor(() => {
        const href = location.href || ''
        if (href.includes('/vouchers/list') || (href.includes('/portal/marketing/vouchers/') && !href.includes('/new'))) return 'url'
        const bodyText = norm(document.body?.innerText || '')
        const actionTexts = [...document.querySelectorAll('button, a')]
          .filter(visible)
          .map(el => textOf(el))
          .join(' ')
        if (/创建成功|设置成功|已创建|已新增优惠券|创建完成/.test(bodyText)) return 'toast'
        if (/查看详情|返回列表页面|返回优惠券列表|继续创建/.test(actionTexts)) return 'inline-success'
        if (/查看详情/.test(bodyText) && /返回列表页面|返回优惠券列表/.test(bodyText)) return 'inline-success'
        if (/您的优惠券会在|优惠券已生效|优惠券将在/.test(bodyText) && /我的广播|查看详情|返回列表页面/.test(bodyText)) return 'inline-success'
        const alerts = [...document.querySelectorAll('[role=alert], .eds-toast, .eds-message, .eds-notification')]
          .filter(visible)
          .map(el => textOf(el))
          .join(' ')
        if (/成功/.test(alerts)) return 'toast'
        return null
      }, 18000, 300)

      if (ok) {
        return finishRow(ctx, '')
      }

      const inlineErrors = [...document.querySelectorAll(
        '.eds-react-form-item__extra, .eds-react-form-item__help, .eds-form-item__extra, .eds-form-item__help, ' +
        '[class*="error-msg"], [class*="error-text"], [class*="form-error"]'
      )]
        .filter(visible)
        .map(el => textOf(el))
        .filter(looksLikeValidationError)

      const toastErrors = [...document.querySelectorAll('[role=alert], .eds-toast, .eds-message, .eds-notification')]
        .filter(visible)
        .map(el => textOf(el))
        .filter(Boolean)

      const errors = [...new Set([...inlineErrors, ...toastErrors])]
      if (errors.length > 0) {
        throw new Error(`提交失败：${errors.join(' | ')}`)
      }

      throw new Error(`提交后未能确认成功，当前URL：${location.href.substring(0, 120)}`)
    }

    throw new Error(`未知 phase：${phase}`)
  } catch (error) {
    const ctx = ensureResultExists(buildContext(execRow) || {})
    return finishRow(ctx, error?.message || String(error))
  }
})()
