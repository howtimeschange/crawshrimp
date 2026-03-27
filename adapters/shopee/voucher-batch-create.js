;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page = window.__CRAWSHRIMP_PAGE__ || 1
  const rows = params.input_file?.rows || []
  const mode = (params.mode || 'current').trim().toLowerCase()

  const ENTRY_URL = 'https://seller.shopee.cn/portal/marketing'
  const VOUCHERS_URL = 'https://seller.shopee.cn/portal/marketing/vouchers/'
  const row = rows[page - 1]

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim() }
  function esc(s) { return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
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
    return style && style.visibility !== 'hidden' && style.display !== 'none' && rect.width >= 0 && rect.height >= 0
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

  async function waitFor(fn, timeout = 12000, interval = 300) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const res = fn()
      if (res) return res
      await sleep(interval)
    }
    return null
  }

  function findInputByLabel(labelTexts) {
    const labels = Array.isArray(labelTexts) ? labelTexts : [labelTexts]
    const all = [...document.querySelectorAll('label, div, span, p')].filter(visible)
    for (const lbl of all) {
      const t = textOf(lbl)
      if (!t) continue
      if (!labels.some(x => t.includes(x))) continue

      let cur = lbl
      for (let depth = 0; depth < 5 && cur; depth++, cur = cur.parentElement) {
        const input = cur.querySelector('input:not([type="checkbox"]):not([type="radio"]), textarea')
        if (input && visible(input)) return input
      }

      let sib = lbl.nextElementSibling
      for (let i = 0; i < 3 && sib; i++, sib = sib.nextElementSibling) {
        const input = sib.matches?.('input, textarea') ? sib : sib.querySelector?.('input, textarea')
        if (input && visible(input)) return input
      }
    }
    return null
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

  async function fillField(labelTexts, value, required = true) {
    const input = findInputByLabel(labelTexts)
    if (!input) {
      if (required) throw new Error(`未找到输入框：${(Array.isArray(labelTexts) ? labelTexts.join('/') : labelTexts)}`)
      return false
    }
    click(input)
    await sleep(120)
    setNativeValue(input, value)
    await sleep(220)
    return true
  }

  async function setCheckboxNearText(labelTexts, desired) {
    const labels = Array.isArray(labelTexts) ? labelTexts : [labelTexts]
    for (const el of [...document.querySelectorAll('label, span, div')].filter(visible)) {
      const t = textOf(el)
      if (!t || !labels.some(x => t.includes(x))) continue
      let cur = el
      for (let i = 0; i < 4 && cur; i++, cur = cur.parentElement) {
        const cb = cur.querySelector('input[type="checkbox"]')
        if (cb) {
          const checked = !!cb.checked
          if (checked !== desired) click(cb)
          await sleep(200)
          return true
        }
      }
    }
    return false
  }

  async function chooseByText(labelTexts, optionText) {
    if (!optionText) return false
    const labels = Array.isArray(labelTexts) ? labelTexts : [labelTexts]
    const opener = findByText(labels[0], false)
    if (opener) {
      let cur = opener
      for (let i = 0; i < 4 && cur; i++, cur = cur.parentElement) {
        const trigger = cur.querySelector('[role="combobox"], input, .shopee-select, [class*="select"], [class*="Select"]')
        if (trigger && visible(trigger)) {
          click(trigger)
          await sleep(300)
          break
        }
      }
    }
    const ok = await clickByTexts(optionText, true, 3000) || await clickByTexts(optionText, false, 3000)
    if (!ok) throw new Error(`未找到选项：${optionText}`)
    return true
  }

  async function ensureAt(url, timeout = 12000) {
    if (!location.href.startsWith(url)) {
      location.href = url
      await waitFor(() => location.href.startsWith(url), timeout, 300)
      await sleep(1500)
    }
  }

  async function searchAndSwitchStore(site, store) {
    await ensureAt(ENTRY_URL, 15000)
    const searchInput = await waitFor(() => {
      const inputs = [...document.querySelectorAll('input, textarea')].filter(visible)
      return inputs.find(el => {
        const ph = norm(el.getAttribute('placeholder'))
        const aria = norm(el.getAttribute('aria-label'))
        const nearby = norm(el.parentElement?.innerText || '')
        return /店铺|store|shop/i.test(ph + ' ' + aria + ' ' + nearby)
      })
    }, 8000)

    if (!searchInput) throw new Error('未找到店铺搜索框')
    click(searchInput)
    await sleep(120)
    setNativeValue(searchInput, store)
    await sleep(800)

    const exactStore = await waitFor(() => {
      return allCandidates().find(el => {
        const t = textOf(el)
        return t === store || t.includes(store)
      })
    }, 5000)

    if (!exactStore) throw new Error(`未找到店铺候选项：${store}`)
    click(exactStore)
    await sleep(1500)

    const pageText = norm(document.body.innerText)
    if (site && pageText && !pageText.includes(site) && !pageText.includes(store)) {
      // 站点有时不会明确展示，弱校验：站点和店铺至少命中一个
      console.warn('站点/店铺校验较弱，继续执行')
    }
    return true
  }

  async function gotoVouchers() {
    if (!location.href.startsWith(VOUCHERS_URL)) {
      const clicked = await clickByTexts(['优惠券', 'Vouchers'], true, 4000) || await clickByTexts(['优惠券', 'Vouchers'], false, 4000)
      if (!clicked) {
        location.href = VOUCHERS_URL
      }
      await waitFor(() => location.href.includes('/marketing/vouchers'), 12000, 300)
      await sleep(1500)
    }
  }

  async function enterVoucherType(voucherType) {
    const aliasMap = {
      '商店优惠券': ['商店优惠券', '店铺优惠券', 'Shop Voucher'],
      '新买家优惠券': ['新买家优惠券', '新客优惠券', 'New Buyer Voucher'],
      '回购买家优惠券': ['回购买家优惠券', '回购优惠券', 'Repeat Buyer Voucher'],
      '关注礼优惠券': ['关注礼优惠券', '关注礼', 'Follow Prize Voucher']
    }
    const aliases = aliasMap[voucherType] || [voucherType]
    const clicked = await clickByTexts(aliases, true, 4000) || await clickByTexts(aliases, false, 5000)
    if (!clicked) throw new Error(`未找到优惠券类型入口：${voucherType}`)
    await sleep(1200)
    return true
  }

  async function submitAndWait() {
    const clicked = await clickByTexts(['确认', '提交', '创建', '保存'], true, 5000) || await clickByTexts(['确认', '提交', '创建', '保存'], false, 5000)
    if (!clicked) throw new Error('未找到“确认/提交/创建/保存”按钮')
    await sleep(2000)

    const bodyText = norm(document.body.innerText)
    if (/失败|错误|必填|请输入|不能为空|格式不正确/i.test(bodyText) && !/成功|已创建/i.test(bodyText)) {
      throw new Error('提交后页面出现校验或错误提示，请检查字段填写或页面控件定位')
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

    await fillField(['优惠券名称', '名称'], couponName)
    await fillField(['优惠码', 'Voucher Code', '代码'], couponCode)
    await fillField(['领取期限开始', '开始时间', '领取开始'], startAt, false)
    await fillField(['领取期限结束', '结束时间', '领取结束'], endAt, false)
    await setCheckboxNearText(['提前显示优惠券', '提前显示', '显示优惠券'], showEarly)

    await clickByTexts([rewardType], true, 2000).catch?.(() => {})
    if (rewardType) await clickByTexts([rewardType], false, 3000)
    if (discountType) await chooseByText(['折扣类型', '优惠方式', '类型'], discountType).catch(async () => {
      await clickByTexts([discountType], false, 3000)
    })

    await fillField(['优惠限额', '折扣值', '优惠力度'], discountLimit)
    await fillField(['最高优惠金额', '最高折扣金额', '最高优惠'], maxDiscount, false)
    await fillField(['最低消费金额', '最低消费', '门槛'], minSpend, false)
    await fillField(['可使用总数', '总数', '发行量'], totalCount, false)
    await fillField(['每个买家可用的优惠券数量上限', '每个买家', '每人限领'], perBuyerLimit, false)

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
