;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page = window.__CRAWSHRIMP_PAGE__ || 1
  const rows = params.input_file?.rows || []
  const mode = (params.mode || 'current').trim().toLowerCase()

  const ENTRY_URL = 'https://seller.shopee.cn/portal/marketing'
  const VOUCHERS_LIST_URL = 'https://seller.shopee.cn/portal/marketing/vouchers/list'
  const row = rows[page - 1]

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim() }
  function digitsOnly(v) { return String(v ?? '').replace(/,/g, '').trim() }
  function boolLike(v) {
    const s = norm(v)
    return s === '1' || /^(是|true|yes|y)$/i.test(s)
  }
  function randCode(n = 5) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let out = ''
    for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * chars.length)]
    return out
  }

  function parseDateTime(raw, kind) {
    const s = norm(raw)
    if (!s) return ''
    const m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:\s*[- ]\s*(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?)?$/)
    if (!m) return s
    const y = m[1]
    const mo = String(m[2]).padStart(2, '0')
    const d = String(m[3]).padStart(2, '0')
    const hh = m[4] != null ? String(m[4]).padStart(2, '0') : (kind === 'start' ? '00' : '23')
    const mm = m[5] != null ? String(m[5]).padStart(2, '0') : (kind === 'start' ? '00' : '59')
    return `${y}-${mo}-${d} ${hh}:${mm}`
  }

  function visible(el) {
    if (!el) return false
    const style = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    return style && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
  }

  function textOf(el) {
    return norm(el?.innerText || el?.textContent || el?.value || '')
  }

  function click(el) {
    if (!el) return false
    try { el.scrollIntoView({ block: 'center', inline: 'center' }) } catch {}
    for (const ev of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      try { el.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window })) } catch {}
    }
    try { el.click() } catch {}
    return true
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

  async function waitFor(fn, timeout = 12000, interval = 300) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const res = fn()
      if (res) return res
      await sleep(interval)
    }
    return null
  }

  function allCandidates() {
    return [...document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="option"], li, div, span, label')]
      .filter(visible)
  }

  function findByText(text, exact = false) {
    const target = norm(text)
    if (!target) return null
    for (const el of allCandidates()) {
      const t = textOf(el)
      if (!t) continue
      if ((exact && t === target) || (!exact && t.includes(target))) return el
    }
    return null
  }

  async function clickByTexts(texts, exact = false, timeout = 6000) {
    const arr = Array.isArray(texts) ? texts : [texts]
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      for (const txt of arr) {
        const el = findByText(txt, exact)
        if (el) { click(el); await sleep(800); return true }
      }
      await sleep(250)
    }
    return false
  }

  function getFormItemByLabel(labelText) {
    const items = [...document.querySelectorAll('.eds-react-form-item')].filter(visible)
    for (const item of items) {
      const label = item.querySelector('.eds-react-form-item__label')
      const t = textOf(label)
      if (t === labelText || t.includes(labelText)) return item
    }
    return null
  }

  function getEditableInputs(container) {
    return [...(container || document).querySelectorAll('input:not([type="radio"]):not([type="checkbox"]), textarea')]
      .filter(visible)
  }

  async function fillFormField(labelText, value, index = 0, required = true) {
    const item = getFormItemByLabel(labelText)
    if (!item) {
      if (required) throw new Error(`未找到表单项：${labelText}`)
      return false
    }
    const inputs = getEditableInputs(item)
    const input = inputs[index]
    if (!input) {
      if (required) throw new Error(`表单项“${labelText}”未找到输入框`)
      return false
    }
    click(input)
    await sleep(120)
    setNativeValue(input, value)
    await sleep(260)
    return true
  }

  async function setDateRange(startAt, endAt) {
    const item = getFormItemByLabel('优惠券领取期限')
    if (!item) throw new Error('未找到“优惠券领取期限”表单项')
    const inputs = getEditableInputs(item)
    if (inputs.length < 2) throw new Error('未找到领取期限开始/结束输入框')
    click(inputs[0]); await sleep(100); setNativeValue(inputs[0], startAt); await sleep(220)
    click(inputs[1]); await sleep(100); setNativeValue(inputs[1], endAt); await sleep(220)
  }

  async function setCheckboxByLabel(labelText, desired) {
    const label = [...document.querySelectorAll('.eds-react-checkbox__label, label, span, div')]
      .find(el => visible(el) && textOf(el) === labelText)
    if (!label) return false
    const root = label.closest('label') || label.parentElement || label
    const cb = root.querySelector('input[type="checkbox"]') || root.closest('label')?.querySelector('input[type="checkbox"]')
    if (!cb) return false
    if (!!cb.checked !== !!desired) {
      click(root)
      await sleep(220)
    }
    return true
  }

  async function setRadioByLabel(labelText) {
    const label = [...document.querySelectorAll('.eds-react-radio__label, label, span')]
      .find(el => visible(el) && textOf(el) === labelText)
    if (!label) throw new Error(`未找到单选项：${labelText}`)
    click(label.closest('label') || label)
    await sleep(260)
  }

  async function chooseDiscountType(optionText) {
    const item = getFormItemByLabel('折扣类型 | 优惠限额')
    if (!item) throw new Error('未找到“折扣类型 | 优惠限额”')
    const trigger = item.querySelector('.eds-react-select .trigger') || item.querySelector('.eds-react-select')
    if (!trigger) throw new Error('未找到折扣类型下拉框')
    click(trigger)
    await sleep(500)
    const option = await waitFor(() => {
      return [...document.querySelectorAll('.eds-react-select-option, [role="option"], div')]
        .find(el => visible(el) && textOf(el) === optionText)
    }, 4000, 200)
    if (!option) throw new Error(`未找到折扣类型选项：${optionText}`)
    click(option)
    await sleep(500)
  }

  async function closeBlockingOverlays() {
    for (const el of [...document.querySelectorAll('.fullstory-modal-wrapper, .diagnosis-result-modal, .eds-modal-mask')]) {
      try { el.remove() } catch {}
    }
    const closers = [...document.querySelectorAll('button, span, div')]
      .filter(el => visible(el) && /关闭|知道了|取消|稍后|×|x/i.test(textOf(el)))
    for (const el of closers.slice(0, 6)) {
      try { click(el) } catch {}
    }
    await sleep(200)
  }

  async function ensureAt(url, timeout = 12000) {
    if (!location.href.startsWith(url)) {
      location.href = url
      await waitFor(() => location.href.startsWith(url), timeout, 300)
      await sleep(1600)
    }
  }

  async function searchAndSwitchStore(site, store) {
    await ensureAt(VOUCHERS_LIST_URL, 15000)
    await closeBlockingOverlays()

    const shopInfo = document.querySelector('.shop-info')
    const currentShopText = textOf(shopInfo || document.body)
    if (currentShopText.includes(store) && (!site || currentShopText.includes(site)) && !/没有权限/.test(currentShopText)) {
      return true
    }

    const searchInput = await waitFor(() => {
      return [...document.querySelectorAll('input, textarea')].find(el => visible(el) && norm(el.getAttribute('placeholder')) === '搜索店铺')
    }, 8000, 250)
    if (!searchInput) throw new Error('未找到店铺搜索框')

    click(searchInput)
    await sleep(100)
    setNativeValue(searchInput, store)
    await sleep(1000)

    const candidate = await waitFor(() => {
      const items = [...document.querySelectorAll('.search-item, .username, .shop-info, li, div, span')]
        .filter(visible)
      return items.find(el => {
        const t = textOf(el)
        if (!t || !t.includes(store)) return false
        if (site && !t.includes(site) && !textOf(el.parentElement || {}).includes(site)) return false
        return true
      })
    }, 6000, 250)

    if (!candidate) throw new Error(`未找到店铺候选项：${store}`)

    const candidateText = textOf(candidate.closest('.search-item') || candidate)
    if (/没有权限|无权限/.test(candidateText) || (candidate.closest('.search-item')?.className || '').includes('disabled')) {
      throw new Error(`店铺“${store}”当前账号无权限切换`)
    }

    click(candidate.closest('.search-item') || candidate)
    await sleep(1400)
    await closeBlockingOverlays()

    const verified = await waitFor(() => {
      const txt = textOf(document.querySelector('.shop-info') || document.body)
      return txt.includes(store) && (!site || txt.includes(site))
    }, 5000, 250)
    if (!verified) throw new Error(`切换店铺后校验失败：${store}`)

    const finalShopText = textOf(document.querySelector('.shop-selector') || document.body)
    if (/没有权限|无权限/.test(finalShopText)) {
      throw new Error(`店铺“${store}”显示无权限，无法继续创建优惠券`)
    }
    return true
  }

  async function gotoVouchers() {
    await ensureAt(VOUCHERS_LIST_URL, 15000)
    await closeBlockingOverlays()
  }

  async function enterVoucherType(voucherType) {
    const aliasMap = {
      '商店优惠券': ['商店优惠券', '店铺优惠券', 'Shop Voucher'],
      '新买家优惠券': ['新买家优惠券', '新客优惠券', 'New Buyer Voucher'],
      '回购买家优惠券': ['回购买家优惠券', '回购优惠券', 'Repeat Buyer Voucher'],
      '关注礼优惠券': ['关注礼优惠券', '关注礼', 'Follow Prize Voucher']
    }
    const aliases = aliasMap[voucherType] || [voucherType]

    const btn = await waitFor(() => {
      return [...document.querySelectorAll('button')].find(el => {
        const t = textOf(el)
        return aliases.some(a => t.includes(a)) && t.includes('创建')
      })
    }, 6000, 250)

    if (!btn) throw new Error(`未找到优惠券类型创建入口：${voucherType}`)
    click(btn)
    await waitFor(() => location.href.includes('/portal/marketing/vouchers/new'), 12000, 300)
    await sleep(1800)
    await closeBlockingOverlays()
    return true
  }

  async function submitAndWait() {
    await closeBlockingOverlays()
    const confirmBtn = [...document.querySelectorAll('button')]
      .find(el => visible(el) && textOf(el) === '确认')
    if (!confirmBtn) throw new Error('未找到“确认”按钮')
    click(confirmBtn)
    await sleep(2500)

    const bodyText = norm(document.body.innerText)
    if (/失败|错误|必填|请输入|不能为空|格式不正确|无权限/.test(bodyText) && !/成功|已创建|创建成功/.test(bodyText)) {
      throw new Error('提交后页面出现校验或错误提示，请检查字段填写、权限或页面控件定位')
    }
    return true
  }

  if (!row) {
    return { success: true, data: [], meta: { has_more: false } }
  }

  const result = {
    '序号': page,
    '站点': row['站点'] || '',
    '店铺': row['店铺'] || '',
    '优惠券品类': row['优惠券品类'] || '',
    '奖励类型': row['奖励类型'] || '',
    '折扣类型': row['折扣类型'] || '',
    '优惠限额': row['优惠限额'] || '',
    '生成优惠券名称': '',
    '生成优惠码': '',
    '执行状态': '待执行',
    '错误原因': ''
  }

  try {
    if (page === 1 && mode === 'new') {
      await ensureAt(ENTRY_URL, 15000)
    }

    const store = norm(row['店铺'])
    const site = norm(row['站点'])
    const voucherType = norm(row['优惠券品类'])
    const rewardType = norm(row['奖励类型'])
    const discountType = norm(row['折扣类型'])
    const discountLimit = digitsOnly(row['优惠限额'])
    const maxDiscount = digitsOnly(row['最高优惠金额'])
    const minSpend = digitsOnly(row['最低消费金额'])
    const totalCount = digitsOnly(row['可使用总数'])
    const perBuyerLimit = digitsOnly(row['每个买家可用的优惠券数量上限'])
    const showEarly = boolLike(row['是否提前显示\n优惠券（是：1/否：0）'] || row['是否提前显示优惠券（是：1/否：0）'])
    const startAt = parseDateTime(row['优惠券领取期限（开始）精确到分'], 'start')
    const endAt = parseDateTime(row['优惠券领取期限（结束）精确到分'], 'end')

    if (!store) throw new Error('Excel 缺少“店铺”')
    if (!voucherType) throw new Error('Excel 缺少“优惠券品类”')

    const couponName = `${store}${discountLimit}`
    const couponCode = randCode(5)
    result['生成优惠券名称'] = couponName
    result['生成优惠码'] = couponCode

    await searchAndSwitchStore(site, store)
    await gotoVouchers()
    await enterVoucherType(voucherType)

    await fillFormField('优惠券名称', couponName)
    await fillFormField('优惠码', couponCode)
    await setDateRange(startAt, endAt)
    await setCheckboxByLabel('提前显示优惠券', showEarly)

    if (rewardType) await setRadioByLabel(rewardType)
    if (discountType) await chooseDiscountType(discountType)

    await fillFormField('折扣类型 | 优惠限额', discountLimit, 0)
    if (discountType === '扣除百分比' && maxDiscount) {
      await fillFormField('最高优惠金额', maxDiscount, 0, false)
    }
    await fillFormField('最低消费金额', minSpend, 0, false)
    await fillFormField('可使用总数', totalCount, 0, false)
    await fillFormField('每个买家可用的优惠券数量上限', perBuyerLimit, 0, false)

    await submitAndWait()
    result['执行状态'] = '成功'
  } catch (e) {
    result['执行状态'] = '失败'
    result['错误原因'] = e.message || String(e)
  }

  return {
    success: true,
    data: [result],
    meta: {
      has_more: page < rows.length,
      page,
      total: rows.length
    }
  }
})()
