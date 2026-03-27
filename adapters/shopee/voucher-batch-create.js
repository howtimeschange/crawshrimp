;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page = window.__CRAWSHRIMP_PAGE__ || 1
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const rows = params.input_file?.rows || []
  const mode = (params.mode || 'current').trim().toLowerCase()

  const ENTRY_URL = 'https://seller.shopee.cn/portal/marketing'
  const VOUCHERS_ROOT_URL = 'https://seller.shopee.cn/portal/marketing/vouchers'
  const row = rows[page - 1]

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim() }
  function digitsOnly(v) { return String(v ?? '').replace(/,/g, '').trim() }
  function numericValue(v) {
    const s = digitsOnly(v)
    if (!s) return ''
    // 去掉百分号，直接取数字部分
    const stripped = s.replace(/%$/, '').trim()
    const n = Number(stripped)
    if (Number.isNaN(n)) return stripped
    return String(n)
  }
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
    if (!s) return null
    const m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:\s*[T\s-]\s*(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?)?$/)
    if (!m) return null
    const y = m[1]
    const mo = String(m[2]).padStart(2, '0')
    const d = String(m[3]).padStart(2, '0')
    const hh = m[4] != null ? String(m[4]).padStart(2, '0') : (kind === 'start' ? '00' : '23')
    const mm = m[5] != null ? String(m[5]).padStart(2, '0') : (kind === 'start' ? '00' : '59')
    return { y, mo, d, hh, mm, str: `${y}-${mo}-${d} ${hh}:${mm}` }
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

  function textKey(v) {
    return norm(v).toLowerCase()
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

  function scheduleClick(el) {
    if (!el) return false
    setTimeout(() => { try { click(el) } catch {} }, 50)
    return true
  }

  function scheduleNavigate(url) {
    setTimeout(() => { try { location.href = url } catch {} }, 50)
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

  async function focusAndType(el, value) {
    click(el)
    await sleep(120)
    try { el.focus() } catch {}
    setNativeValue(el, value)
    try { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) } catch {}
    try { el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })) } catch {}
    await sleep(200)
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
      if (required) throw new Error(`表单项"${labelText}"未找到输入框`)
      return false
    }
    click(input)
    await sleep(120)
    setNativeValue(input, value)
    await sleep(260)
    return true
  }

  // ─── 日期时间选择器：精确到分 ─────────────────────────────────────────────
  // Shopee 的日期时间选择器每个时间分量是独立的 input（或用 picker panel），
  // 需要先点击触发打开，再逐个 input 赋值，最后点确认关闭
  async function fillDatetimePicker(inputTrigger, dt) {
    // dt = { y, mo, d, hh, mm }
    // 1. 点击触发器打开 picker
    click(inputTrigger)
    await sleep(600)

    // 2. 尝试方案A：picker panel 内有独立的数字输入框（年/月/日 时:分）
    //    典型结构：.eds-react-date-picker-panel 或 .eds-picker-dropdown
    const panel = await waitFor(() => {
      return document.querySelector(
        '.eds-react-date-picker-panel, .eds-picker-dropdown, .eds-react-datepicker, [class*="date-picker"][class*="panel"], [class*="datepicker"][class*="dropdown"]'
      )
    }, 3000, 100)

    if (panel) {
      // 找 panel 内所有可编辑 input（过滤 radio/checkbox）
      const pInputs = [...panel.querySelectorAll('input:not([type="radio"]):not([type="checkbox"])')].filter(visible)
      // 典型布局：[年, 月, 日] [时, 分]  或  [年-月-日 时:分 整体 input]
      if (pInputs.length >= 5) {
        // 分散 input：年 月 日 时 分
        await focusAndType(pInputs[0], dt.y)
        await focusAndType(pInputs[1], dt.mo)
        await focusAndType(pInputs[2], dt.d)
        await focusAndType(pInputs[3], dt.hh)
        await focusAndType(pInputs[4], dt.mm)
      } else if (pInputs.length >= 2) {
        // 日期 input + 时间 input
        await focusAndType(pInputs[0], `${dt.y}-${dt.mo}-${dt.d}`)
        await focusAndType(pInputs[1], `${dt.hh}:${dt.mm}`)
      } else if (pInputs.length === 1) {
        await focusAndType(pInputs[0], dt.str)
      }

      // 点确认按钮关闭 picker
      await sleep(300)
      const okBtn = [...panel.querySelectorAll('button')].find(el => visible(el) && /^(确认|确定|OK|ok)$/.test(textOf(el)))
      if (okBtn) { click(okBtn); await sleep(300) }
      else { try { click(document.body) } catch {}; await sleep(200) }
      return
    }

    // 3. 方案B：没有弹出 panel，触发器本身就是 text input，直接赋值
    setNativeValue(inputTrigger, dt.str)
    await sleep(200)
    // 尝试关闭可能的浮层
    try { document.body.click() } catch {}
    await sleep(200)
  }

  async function setDateRange(startDt, endDt) {
    const item = getFormItemByLabel('优惠券领取期限')
    if (!item) throw new Error('未找到"优惠券领取期限"表单项')

    // 找到领取期限区域内的所有文本型 input（排除 radio/checkbox）
    const inputs = [...item.querySelectorAll('input:not([type="radio"]):not([type="checkbox"])')].filter(visible)

    if (inputs.length < 2) {
      throw new Error('未找到领取期限开始/结束输入框，当前可见 input 数量：' + inputs.length)
    }

    // inputs[0] = 开始时间触发器，inputs[1] = 结束时间触发器
    if (startDt) await fillDatetimePicker(inputs[0], startDt)
    if (endDt) await fillDatetimePicker(inputs[1], endDt)

    try { click(document.body) } catch {}
    await sleep(300)
  }

  // ─── 提前显示优惠券 checkbox ──────────────────────────────────────────────
  async function setShowEarlyCheckbox(desired) {
    // 不依赖 getFormItemByLabel，直接在整个文档内找含"提前显示优惠券"文本的 label
    const targetText = '提前显示优惠券'

    // 先找 label 元素
    const labels = [...document.querySelectorAll('label')].filter(el => visible(el) && textOf(el).includes(targetText))
    let cb = null
    let labelEl = null

    for (const lbl of labels) {
      // label 内可能直接包含 input[checkbox]
      const inner = lbl.querySelector('input[type="checkbox"]')
      if (inner) { cb = inner; labelEl = lbl; break }
      // 或者 label[for] 关联
      if (lbl.htmlFor) {
        const associated = document.getElementById(lbl.htmlFor)
        if (associated && associated.type === 'checkbox') { cb = associated; labelEl = lbl; break }
      }
    }

    // 再试：找含目标文本的 span/div 附近的 checkbox
    if (!cb) {
      const spans = [...document.querySelectorAll('span, div')].filter(el => {
        if (!visible(el)) return false
        // 精确只匹配文本本身（避免把父级大容器误匹配）
        const own = norm(el.childNodes.length === 1 && el.childNodes[0].nodeType === 3
          ? el.childNodes[0].textContent
          : el.textContent)
        return own.includes(targetText)
      })
      for (const sp of spans) {
        const container = sp.closest('label') || sp.parentElement
        const inner = container?.querySelector('input[type="checkbox"]')
        if (inner) { cb = inner; labelEl = container; break }
      }
    }

    if (!cb) {
      // 找自定义 checkbox（eds 样式的 checkbox 可能用 div 模拟）
      const customCbs = [...document.querySelectorAll('.eds-react-checkbox, [class*="checkbox"]')].filter(el => {
        return visible(el) && textOf(el).includes(targetText)
      })
      if (customCbs.length) {
        const target = customCbs[0]
        const currentChecked = target.classList.contains('eds-react-checkbox--checked') ||
          target.querySelector('input[type="checkbox"]')?.checked || false
        if (!!currentChecked !== !!desired) {
          click(target)
          await sleep(220)
        }
        return true
      }
      // 找不到 checkbox，如果 desired=false 则静默跳过，=true 则报错
      if (desired) throw new Error('未找到"提前显示优惠券"复选框')
      return false
    }

    const currentChecked = !!cb.checked
    if (currentChecked !== !!desired) {
      click(labelEl || cb)
      await sleep(220)
    }
    return true
  }

  async function setRadioByLabel(labelText) {
    const aliasesMap = {
      '折扣': ['折扣', 'discount'],
      'shopee币回扣': ['shopee币回扣', '币回扣', 'coin cashback', 'coins cashback'],
      'Shopee币回扣': ['Shopee币回扣', 'shopee币回扣', '币回扣', 'coin cashback', 'coins cashback']
    }
    const aliases = aliasesMap[labelText] || [labelText]
    const aliasKeys = aliases.map(textKey)
    const item = getFormItemByLabel('奖励类型') || document
    const label = [...item.querySelectorAll('.eds-react-radio__label, label, span, div')]
      .find(el => {
        if (!visible(el)) return false
        const t = textKey(textOf(el))
        return aliasKeys.some(a => t === a || t.includes(a) || a.includes(t))
      })
    if (!label) throw new Error(`未找到单选项：${labelText}`)
    click(label.closest('label') || label)
    await sleep(260)
  }

  // ─── 折扣类型下拉框 ───────────────────────────────────────────────────────
  async function chooseDiscountType(optionText) {
    const aliasesMap = {
      '扣除百分比': ['扣除百分比', '折扣百分比', 'percentage'],
      '折扣金额': ['折扣金额', '固定金额', 'fixed amount', 'fixed']
    }
    const aliases = aliasesMap[optionText] || [optionText]
    const aliasKeys = aliases.map(textKey)

    // 找"折扣类型"表单项；Shopee 的 label 可能叫"折扣类型 | 优惠限额"或单独"折扣类型"
    let item = getFormItemByLabel('折扣类型 | 优惠限额') || getFormItemByLabel('折扣类型')
    if (!item) throw new Error('未找到"折扣类型"表单项')

    // 找 select 触发器：eds-react-select 内的 .trigger，或带 role="combobox" 的元素
    let trigger = item.querySelector('[role="combobox"]') ||
      item.querySelector('.eds-react-select__trigger') ||
      item.querySelector('.eds-react-select .trigger') ||
      item.querySelector('.eds-react-select')

    if (!trigger || !visible(trigger)) {
      // fallback：找 item 内第一个可见的按钮/div（非 input）当做触发器
      trigger = [...item.querySelectorAll('div, button')].find(el => {
        if (!visible(el)) return false
        const role = el.getAttribute('role')
        return role === 'combobox' || el.classList.toString().includes('select')
      })
    }
    if (!trigger) throw new Error('未找到折扣类型下拉触发器')

    click(trigger)
    await sleep(500)

    // 等待 dropdown/listbox 出现（可能是 portal 挂到 body 上）
    const panel = await waitFor(() => {
      return document.querySelector(
        '.eds-react-select__dropdown, .eds-react-select-dropdown, [role="listbox"], [class*="select"][class*="dropdown"], [class*="select"][class*="panel"]'
      )
    }, 4000, 150)

    if (!panel) throw new Error('折扣类型下拉框未展开')

    const option = await waitFor(() => {
      return [...panel.querySelectorAll('[role="option"], .eds-react-select-option, li, div')]
        .find(el => {
          if (!visible(el)) return false
          const t = textKey(textOf(el))
          return aliasKeys.some(a => t === a || t.includes(a))
        })
    }, 4000, 150)

    if (!option) throw new Error(`未找到折扣类型选项：${optionText}，已展开的选项：${[...panel.querySelectorAll('[role="option"]')].map(e => textOf(e)).join(', ')}`)
    click(option)
    await sleep(400)
  }

  // ─── 最高优惠金额：独立 form-item 定位 ───────────────────────────────────
  async function fillMaxDiscount(value) {
    // 标签名可能是"最高优惠金额"，也可能嵌在折扣规则组内
    const candidates = ['最高优惠金额', '最高折扣金额', '最高优惠']
    for (const label of candidates) {
      const done = await fillFormField(label, numericValue(value), 0, false)
      if (done) return true
    }
    // fallback：在页面上找包含上述文字的 label 并找其旁边的 input
    for (const text of candidates) {
      const labelEl = [...document.querySelectorAll('label, .eds-react-form-item__label, span')]
        .find(el => visible(el) && textOf(el).includes(text))
      if (labelEl) {
        const container = labelEl.closest('.eds-react-form-item') || labelEl.parentElement
        const input = container?.querySelector('input:not([type="radio"]):not([type="checkbox"])')
        if (input && visible(input)) {
          click(input)
          await sleep(120)
          setNativeValue(input, numericValue(value))
          await sleep(260)
          return true
        }
      }
    }
    return false
  }

  // ─── 优惠限额输入框（折扣类型选好后旁边的 input）────────────────────────
  async function fillDiscountLimit(value) {
    // 先尝试通过表单项定位
    let item = getFormItemByLabel('折扣类型 | 优惠限额') || getFormItemByLabel('折扣类型')
    if (item) {
      const inputs = getEditableInputs(item)
      // inputs[0] 是折扣类型下拉（select），inputs[1] 是数值输入框
      // 但有时 select 不算 input，所以 inputs[0] 就是数值框
      const numInput = inputs.find(el => el.type !== 'hidden' && visible(el))
      if (numInput) {
        click(numInput)
        await sleep(120)
        setNativeValue(numInput, numericValue(value))
        await sleep(260)
        return true
      }
    }
    throw new Error('未找到优惠限额输入框')
  }

  // ─── 入口：确保特定买家优惠券入口可见（新买家/回购/关注礼）─────────────
  async function ensureBuyerSpecificEntriesVisible(testId) {
    // 先检查目标卡片是否已可见
    const existing = document.querySelector(`button[data-testid="${testId}"]`)
    if (existing && visible(existing)) return true

    // 找展开按钮（文本匹配，不依赖 hash class）
    const expandBtn = [...document.querySelectorAll('button')].find(el => {
      if (!visible(el)) return false
      const t = textOf(el)
      return t.includes('为特定买家提供更多种类的优惠券')
    })
    if (!expandBtn) throw new Error('未找到"为特定买家提供更多种类的优惠券"展开按钮')

    click(expandBtn)
    await sleep(800)

    // 等待目标卡片出现
    const appeared = await waitFor(() => {
      const el = document.querySelector(`button[data-testid="${testId}"]`)
      return visible(el) ? el : null
    }, 6000, 200)

    if (!appeared) throw new Error(`展开后仍未找到优惠券入口 [data-testid="${testId}"]`)
    return true
  }

  async function closeBlockingOverlays() {
    for (const el of [...document.querySelectorAll('.fullstory-modal-wrapper, .diagnosis-result-modal, .eds-modal-mask')]) {
      try { el.remove() } catch {}
    }
    for (const btn of [...document.querySelectorAll('button')]) {
      const t = textOf(btn)
      if (visible(btn) && /关闭|知道了|取消|稍后/i.test(t)) {
        try { click(btn) } catch {}
      }
    }
    await sleep(120)
  }

  function buildContext() {
    if (!row) return null
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
    const startDt = parseDateTime(row['优惠券领取期限（开始）精确到分'], 'start')
    const endDt = parseDateTime(row['优惠券领取期限（结束）精确到分'], 'end')

    if (!store) throw new Error('Excel 缺少"店铺"')
    if (!voucherType) throw new Error('Excel 缺少"优惠券品类"')

    const couponName = shared.couponName || `${store}${discountLimit}`
    const couponCode = shared.couponCode || randCode(5)

    const result = shared.result || {
      '序号': page,
      '站点': row['站点'] || '',
      '店铺': row['店铺'] || '',
      '优惠券品类': row['优惠券品类'] || '',
      '奖励类型': row['奖励类型'] || '',
      '折扣类型': row['折扣类型'] || '',
      '优惠限额': row['优惠限额'] || '',
      '生成优惠券名称': couponName,
      '生成优惠码': couponCode,
      '执行状态': '待执行',
      '错误原因': ''
    }

    return {
      store, site, voucherType, rewardType, discountType,
      discountLimit, maxDiscount, minSpend, totalCount, perBuyerLimit,
      showEarly, startDt, endDt, couponName, couponCode, result
    }
  }

  function nextPhase(nextPhase, ctx, sleepMs = 1200, extras = {}) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'next_phase',
        next_phase: nextPhase,
        sleep_ms: sleepMs,
        shared: {
          ...(shared || {}),
          ...(ctx ? {
            couponName: ctx.couponName,
            couponCode: ctx.couponCode,
            result: ctx.result,
          } : {}),
          ...extras,
        }
      }
    }
  }

  function finish(result, error = '') {
    const output = { ...(result || {}) }
    if (error) {
      output['执行状态'] = '失败'
      output['错误原因'] = error
    } else {
      output['执行状态'] = '成功'
      output['错误原因'] = ''
    }
    return {
      success: true,
      data: [output],
      meta: {
        action: 'complete',
        has_more: page < rows.length,
        page,
        total: rows.length,
        shared: {}
      }
    }
  }

  if (!row) {
    return {
      success: true,
      data: [],
      meta: { action: 'complete', has_more: false, page, total: rows.length, shared: {} }
    }
  }

  try {
    await closeBlockingOverlays()
    const ctx = buildContext()

    // ── phase: main ──────────────────────────────────────────────────────────
    if (phase === 'main') {
      if (page === 1 && mode === 'new' && !location.href.startsWith(ENTRY_URL)) {
        scheduleNavigate(ENTRY_URL)
        return nextPhase('goto_list', ctx, 2600)
      }
      return nextPhase('goto_list', ctx, 50)
    }

    // ── phase: goto_list ─────────────────────────────────────────────────────
    if (phase === 'goto_list') {
      if (location.href.includes('/portal/marketing/vouchers')) {
        return nextPhase('store_switch', ctx, 50)
      }
      scheduleNavigate(VOUCHERS_ROOT_URL)
      return nextPhase('store_switch', ctx, 2600)
    }

    // ── phase: store_switch ──────────────────────────────────────────────────
    if (phase === 'store_switch') {
      if (!location.href.includes('/portal/marketing/vouchers')) {
        scheduleNavigate(VOUCHERS_ROOT_URL)
        return nextPhase('store_switch', ctx, 2200)
      }

      const shopInfo = document.querySelector('.shop-info')
      const currentShopText = textOf(shopInfo || document.body)
      if (!(currentShopText.includes(ctx.store) && (!ctx.site || currentShopText.includes(ctx.site)) && !/没有权限/.test(currentShopText))) {
        const searchInput = await waitFor(() => {
          return [...document.querySelectorAll('input, textarea')].find(el => visible(el) && norm(el.getAttribute('placeholder')) === '搜索店铺')
        }, 8000, 250)
        if (!searchInput) throw new Error('未找到店铺搜索框')

        click(searchInput)
        await sleep(100)
        setNativeValue(searchInput, ctx.store)
        await sleep(1000)

        const candidate = await waitFor(() => {
          const items = [...document.querySelectorAll('.search-item, .username, .shop-info, li, [role="option"]')].filter(visible)
          return items.find(el => {
            const t = textOf(el)
            if (!t || !t.includes(ctx.store)) return false
            if (ctx.site && !t.includes(ctx.site) && !textOf(el.parentElement || {}).includes(ctx.site)) return false
            return true
          })
        }, 6000, 250)

        if (!candidate) throw new Error(`未找到店铺候选项：${ctx.store}`)
        const candidateText = textOf(candidate.closest('.search-item') || candidate)
        if (/没有权限|无权限/.test(candidateText) || (candidate.closest('.search-item')?.className || '').includes('disabled')) {
          throw new Error(`店铺"${ctx.store}"当前账号无权限切换`)
        }

        click(candidate.closest('.search-item') || candidate)
        await sleep(1400)
        await closeBlockingOverlays()
      }

      const verified = await waitFor(() => {
        const txt = textOf(document.querySelector('.shop-info') || document.body)
        return txt.includes(ctx.store) && (!ctx.site || txt.includes(ctx.site))
      }, 5000, 250)
      if (!verified) throw new Error(`切换店铺后校验失败：${ctx.store}`)

      return nextPhase('enter_type', ctx, 50)
    }

    // ── phase: enter_type ────────────────────────────────────────────────────
    if (phase === 'enter_type') {
      if (!location.href.includes('/portal/marketing/vouchers')) {
        scheduleNavigate(VOUCHERS_ROOT_URL)
        return nextPhase('enter_type', ctx, 2200)
      }

      const entryMap = {
        '商店优惠券': 'voucherEntry1',
        '新买家优惠券': 'voucherEntry3',
        '回购买家优惠券': 'voucherEntry4',
        '关注礼优惠券': 'voucherEntry999'
      }
      const testId = entryMap[ctx.voucherType]
      if (!testId) throw new Error(`未配置优惠券类型入口：${ctx.voucherType}`)

      // 对特定买家类型，先确保入口区域展开
      if (['voucherEntry3', 'voucherEntry4', 'voucherEntry999'].includes(testId)) {
        await ensureBuyerSpecificEntriesVisible(testId)
      }

      const cardBtn = await waitFor(() => {
        const el = document.querySelector(`button[data-testid="${testId}"]`)
        return visible(el) ? el : null
      }, 5000, 150)
      if (!cardBtn) throw new Error(`未找到优惠券类型入口：${ctx.voucherType}`)

      // 点击卡片后等待页面跳转到创建页
      click(cardBtn)
      const navigated = await waitFor(() => {
        return location.href.includes('/portal/marketing/vouchers/new') ? true : null
      }, 8000, 300)
      if (!navigated) {
        // 有些卡片需要点卡片内的"创建"按钮，再等一次
        const createBtn = [...document.querySelectorAll('button')].find(el => {
          if (!visible(el)) return false
          const t = textOf(el)
          return t === '创建' || t === '新建' || t === '+ 创建'
        })
        if (createBtn) {
          click(createBtn)
          const nav2 = await waitFor(() => location.href.includes('/portal/marketing/vouchers/new') ? true : null, 6000, 300)
          if (!nav2) throw new Error(`点击"${ctx.voucherType}"后未能进入创建页，当前URL：${location.href}`)
        } else {
          throw new Error(`点击"${ctx.voucherType}"后未能进入创建页，当前URL：${location.href}`)
        }
      }

      return nextPhase('form_fill', ctx, 800)
    }

    // ── phase: form_fill ─────────────────────────────────────────────────────
    if (phase === 'form_fill') {
      if (!location.href.includes('/portal/marketing/vouchers/new')) {
        throw new Error('未进入优惠券创建页')
      }

      // 1. 基础信息
      await fillFormField('优惠券名称', ctx.couponName)
      await fillFormField('优惠码', ctx.couponCode)

      // 2. 领取期限（精确到分钟，使用日期时间 picker）
      await setDateRange(ctx.startDt, ctx.endDt)

      // 3. 提前显示优惠券 checkbox
      await setShowEarlyCheckbox(ctx.showEarly)

      // 4. 奖励类型（radio）
      if (ctx.rewardType) await setRadioByLabel(ctx.rewardType)

      // 5. 折扣类型（下拉框），选好后再填优惠限额
      if (ctx.discountType) await chooseDiscountType(ctx.discountType)

      // 6. 优惠限额（数字，不含%符号）
      await fillDiscountLimit(ctx.discountLimit)

      // 7. 最高优惠金额
      if (ctx.maxDiscount) await fillMaxDiscount(ctx.maxDiscount)

      // 8. 最低消费金额
      if (ctx.minSpend) await fillFormField('最低消费金额', numericValue(ctx.minSpend), 0, false)

      // 9. 可使用总数
      if (ctx.totalCount) await fillFormField('可使用总数', numericValue(ctx.totalCount), 0, false)

      // 10. 每个买家可用的优惠券数量上限
      if (ctx.perBuyerLimit) await fillFormField('每个买家可用的优惠券数量上限', numericValue(ctx.perBuyerLimit), 0, false)

      return nextPhase('submit', ctx, 50)
    }

    // ── phase: submit ────────────────────────────────────────────────────────
    if (phase === 'submit') {
      // 找"确认"按钮：优先 primary 样式，文本精确匹配
      const confirmBtn = [...document.querySelectorAll('button')].find(el => {
        if (!visible(el)) return false
        const t = textOf(el)
        if (t !== '确认' && t !== '确定') return false
        const cls = el.className || ''
        // 优先 primary 按钮
        return cls.includes('primary') || cls.includes('confirm') || cls.includes('submit') || true
      })
      if (!confirmBtn) throw new Error('未找到"确认"按钮')
      scheduleClick(confirmBtn)
      return nextPhase('post_submit', ctx, 3200)
    }

    // ── phase: post_submit ───────────────────────────────────────────────────
    if (phase === 'post_submit') {
      const bodyText = norm(document.body.innerText)
      const inlineErrors = [...document.querySelectorAll('.eds-react-form-item__extra, .eds-react-form-item__help, .error, [class*="error"], [class*="Error"]')]
        .filter(el => visible(el))
        .map(el => textOf(el))
        .filter(Boolean)
      const alertTexts = [...document.querySelectorAll('[role="alert"], .eds-message, .eds-toast, .toast, .message, .alert')]
        .filter(el => visible(el))
        .map(el => textOf(el))
        .filter(Boolean)
      const combinedErrors = [...new Set([...inlineErrors, ...alertTexts].filter(Boolean))]

      if (location.href.includes('/portal/marketing/vouchers/list') || /成功|已创建|创建成功/.test(bodyText)) {
        return finish(ctx.result)
      }
      if (combinedErrors.length) {
        throw new Error(`提交后校验提示：${combinedErrors.join(' | ')}`)
      }
      if (/失败|错误|必填|请输入|不能为空|格式不正确|无权限/.test(bodyText)) {
        throw new Error('提交后页面出现校验或错误提示，请检查字段填写、权限或页面控件定位')
      }
      throw new Error('提交后未能确认创建成功或返回列表页')
    }

    throw new Error(`未知执行阶段：${phase}`)
  } catch (e) {
    const fallback = (shared && shared.result) ? shared.result : {
      '序号': page,
      '站点': row['站点'] || '',
      '店铺': row['店铺'] || '',
      '优惠券品类': row['优惠券品类'] || '',
      '奖励类型': row['奖励类型'] || '',
      '折扣类型': row['折扣类型'] || '',
      '优惠限额': row['优惠限额'] || '',
      '生成优惠券名称': shared.couponName || '',
      '生成优惠码': shared.couponCode || '',
      '执行状态': '失败',
      '错误原因': ''
    }
    return finish(fallback, e.message || String(e))
  }
})()