;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page = window.__CRAWSHRIMP_PAGE__ || 1
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const rows = params.input_file?.rows || []
  const mode = (params.mode || 'current').trim().toLowerCase()

  const MARKETING_URL = 'https://seller.shopee.cn/portal/marketing'
  const VOUCHERS_URL  = 'https://seller.shopee.cn/portal/marketing/vouchers/'
  const row = rows[page - 1]

  // ─── 工具函数 ────────────────────────────────────────────────────────────────
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim() }
  function textOf(el) { return norm(el?.innerText || el?.textContent || el?.value || '') }

  function digitsOnly(v) { return String(v ?? '').replace(/,/g, '').trim() }

  function toNumber(v) {
    const s = digitsOnly(v).replace(/%$/, '').trim()
    const n = Number(s)
    return Number.isNaN(n) ? s : n
  }

  // 优惠限额：扣除百分比时 0.05 => 5，折扣金额时原值
  function discountLimitValue(raw, discountType) {
    const n = toNumber(raw)
    if (typeof n === 'number' && /百分比|percentage/i.test(discountType || '') && n > 0 && n <= 1) {
      return String(Math.round(n * 100))
    }
    return String(n)
  }

  function boolLike(v) {
    return String(v || '').trim() === '1' || /^(是|true|yes|y)$/i.test(String(v || '').trim())
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
    const m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[T\s-](\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?)?$/)
    if (!m) return null
    const y = m[1], mo = String(m[2]).padStart(2,'0'), d = String(m[3]).padStart(2,'0')
    const hh = m[4] != null ? String(m[4]).padStart(2,'0') : (kind==='start' ? '00' : '23')
    const mm = m[5] != null ? String(m[5]).padStart(2,'0') : (kind==='start' ? '00' : '59')
    return { y, mo, d, hh, mm, str: `${y}-${mo}-${d} ${hh}:${mm}` }
  }

  function visible(el) {
    if (!el) return false
    const st = getComputedStyle(el)
    const r = el.getBoundingClientRect()
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

  function click(el) {
    if (!el) return false
    try { el.scrollIntoView({ block: 'center' }) } catch {}
    for (const ev of ['pointerdown','mousedown','mouseup','click']) {
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
    el.dispatchEvent(new Event('input',  { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.dispatchEvent(new Event('blur',   { bubbles: true }))
    return true
  }

  async function typeInto(el, value) {
    click(el)
    await sleep(80)
    try { el.focus() } catch {}
    setNativeValue(el, value)
    await sleep(200)
  }

  async function closeBlockingOverlays() {
    for (const el of [...document.querySelectorAll('.fullstory-modal-wrapper, .diagnosis-result-modal')]) {
      try { el.remove() } catch {}
    }
    for (const btn of [...document.querySelectorAll('button')]) {
      if (visible(btn) && /^(关闭|知道了|稍后|取消)$/.test(textOf(btn))) {
        try { click(btn) } catch {}
      }
    }
    await sleep(100)
  }

  // 找 .eds-react-form-item 表单项（按 label 文本）
  function getFormItem(labelText) {
    return [...document.querySelectorAll('.eds-react-form-item')].find(el => {
      const lbl = el.querySelector('.eds-react-form-item__label')
      return lbl && norm(lbl.textContent).includes(labelText)
    }) || null
  }

  function getTextInputs(container) {
    return [...(container || document).querySelectorAll('input:not([type=radio]):not([type=checkbox]),textarea')]
      .filter(visible)
  }

  async function fillField(labelText, value, inputIndex = 0) {
    const item = getFormItem(labelText)
    if (!item) throw new Error(`未找到表单项：${labelText}`)
    const inputs = getTextInputs(item)
    const el = inputs[inputIndex]
    if (!el) throw new Error(`表单项"${labelText}"没有可编辑 input`)
    await typeInto(el, value)
    return true
  }

  // ─── 日期时间 Picker ─────────────────────────────────────────────────────────
  async function fillDatetimePicker(triggerInput, dt) {
    click(triggerInput)
    await sleep(600)

    // 等面板出现
    const panel = await waitFor(() =>
      document.querySelector('.eds-react-date-picker-panel, .eds-picker-dropdown, [class*="date-picker"][class*="panel"], [class*="datepicker"][class*="dropdown"]')
    , 3000, 100)

    if (panel) {
      const pInputs = [...panel.querySelectorAll('input:not([type=radio]):not([type=checkbox])')].filter(visible)
      if (pInputs.length >= 5) {
        for (const [i, v] of [[0,dt.y],[1,dt.mo],[2,dt.d],[3,dt.hh],[4,dt.mm]]) {
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
      if (okBtn) { click(okBtn); await sleep(300) }
      else { try { document.body.click() } catch {}; await sleep(200) }
    } else {
      // 没有面板，直接填 input
      setNativeValue(triggerInput, dt.str)
      await sleep(200)
      try { document.body.click() } catch {}
    }
  }

  async function setDateRange(startDt, endDt) {
    const item = getFormItem('优惠券领取期限')
    if (!item) throw new Error('未找到"优惠券领取期限"')
    const inputs = getTextInputs(item)
    if (inputs.length < 2) throw new Error(`领取期限 input 数量不足: ${inputs.length}`)
    if (startDt) await fillDatetimePicker(inputs[0], startDt)
    if (endDt)   await fillDatetimePicker(inputs[1], endDt)
    try { document.body.click() } catch {}
    await sleep(200)
  }

  // ─── 提前显示优惠券 checkbox ──────────────────────────────────────────────────
  async function setShowEarly(desired) {
    // 找含"提前显示优惠券"文本的 label 或 checkbox 容器
    const target = [...document.querySelectorAll('label, .eds-react-checkbox')].find(el => {
      return visible(el) && textOf(el).includes('提前显示优惠券')
    })
    if (!target) {
      if (desired) throw new Error('未找到"提前显示优惠券"复选框')
      return false
    }
    const cb = target.querySelector?.('input[type=checkbox]') ||
               (target.tagName === 'INPUT' ? target : null)
    const isChecked = () => {
      if (cb) return cb.checked
      return target.classList.contains('eds-react-checkbox--checked') ||
             target.getAttribute('aria-checked') === 'true'
    }
    if (isChecked() !== !!desired) {
      click(target)
      await sleep(200)
    }
    return true
  }

  // ─── 奖励类型 radio ───────────────────────────────────────────────────────────
  async function setRewardType(text) {
    const aliases = {
      '折扣':      ['折扣', 'discount'],
      'shopee币回扣': ['shopee币回扣','Shopee币回扣','币回扣','coin cashback'],
    }
    const keys = (aliases[text] || [text]).map(s => s.toLowerCase())
    const item = getFormItem('奖励类型') || document
    const label = [...item.querySelectorAll('.eds-react-radio__label, label, span')].find(el => {
      if (!visible(el)) return false
      const t = textOf(el).toLowerCase()
      return keys.some(k => t === k || t.includes(k))
    })
    if (!label) throw new Error(`未找到奖励类型：${text}`)
    click(label.closest('label') || label)
    await sleep(200)
  }

  // ─── 折扣类型下拉 ──────────────────────────────────────────────────────────────
  // Shopee EDS Select 组件：
  //   触发器 = .trigger.trigger--normal（必须派发 pointerdown+mousedown+mouseup+click）
  //   选项   = .eds-react-select-option（可见时直接 click）
  async function setDiscountType(text) {
    const aliases = {
      '扣除百分比': ['扣除百分比','折扣百分比','percentage'],
      '折扣金额':   ['折扣金额','固定金额','fixed amount'],
    }
    const keys = (aliases[text] || [text]).map(s => s.toLowerCase())

    const item = getFormItem('折扣类型 | 优惠限额') || getFormItem('折扣类型')
    if (!item) throw new Error('未找到折扣类型表单项')

    // 触发器是 .trigger.trigger--normal，必须用完整事件序列
    const trigger = item.querySelector('.trigger.trigger--normal')
    if (!trigger || !visible(trigger)) throw new Error('未找到折扣类型下拉触发器(.trigger.trigger--normal)')

    trigger.scrollIntoView({ block: 'center' })
    await sleep(100)
    for (const evtName of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      try {
        trigger.dispatchEvent(new MouseEvent(evtName, { bubbles: true, cancelable: true, view: window, buttons: 1 }))
      } catch (_) {}
    }
    await sleep(600)

    // 等选项出现（.eds-react-select-option）
    const options = await waitFor(() => {
      const opts = [...document.querySelectorAll('.eds-react-select-option')].filter(visible)
      return opts.length > 0 ? opts : null
    }, 4000, 150)
    if (!options) throw new Error('折扣类型下拉未展开（未找到 .eds-react-select-option）')

    const option = options.find(el => {
      const t = textOf(el).toLowerCase()
      return keys.some(k => t === k || t.includes(k))
    })
    if (!option) throw new Error(`未找到折扣类型选项：${text}（可选：${options.map(o=>textOf(o)).join('/')}）`)
    click(option)
    await sleep(400)
  }

  // ─── 优惠限额（折扣类型旁边的数字框）────────────────────────────────────────
  // 只有选了折扣类型后才出现在 DOM 里（同一个 .eds-react-form-item__control 内）
  async function fillDiscountLimit(value) {
    const item = getFormItem('折扣类型 | 优惠限额') || getFormItem('折扣类型')
    if (item) {
      const inputs = getTextInputs(item)
      const inp = inputs.find(el => visible(el) && el.tagName === 'INPUT')
      if (inp) { await typeInto(inp, value); return }
    }
    throw new Error('未找到优惠限额输入框')
  }

  // ─── 最高优惠金额（条件字段：选了"扣除百分比"后才出现）────────────────────────
  async function fillMaxDiscount(value) {
    for (const lbl of ['最高优惠金额', '最高折扣金额', '最高优惠', '最高减免']) {
      const item = getFormItem(lbl)
      if (item) {
        const inp = getTextInputs(item)[0]
        if (inp && visible(inp)) { await typeInto(inp, String(toNumber(value))); return true }
      }
    }
    // 字段不存在时不抛错（可能是折扣金额类型，不需要这个字段）
    return false
  }

  // ─── 确保特定买家入口展开 ─────────────────────────────────────────────────────
  async function ensureBuyerEntries(testId) {
    let btn = document.querySelector(`button[data-testid="${testId}"]`)
    if (btn && visible(btn)) return true
    // 找展开按钮
    const expandBtn = [...document.querySelectorAll('button, a')].find(el =>
      visible(el) && textOf(el).includes('为特定买家提供更多种类的优惠券')
    )
    if (!expandBtn) throw new Error('未找到展开特定买家入口按钮')
    click(expandBtn)
    await sleep(800)
    btn = await waitFor(() => {
      const el = document.querySelector(`button[data-testid="${testId}"]`)
      return visible(el) ? el : null
    }, 5000, 200)
    if (!btn) throw new Error(`展开后仍未找到 ${testId}`)
    return true
  }

  // ─── buildContext ─────────────────────────────────────────────────────────────
  function buildContext() {
    if (!row) return null
    const store       = norm(row['店铺'])
    const site        = norm(row['站点'])
    const voucherType = norm(row['优惠券品类'])
    const rewardType  = norm(row['奖励类型'])
    const discountType= norm(row['折扣类型'])
    const rawLimit    = digitsOnly(row['优惠限额'])
    const discountLimit = discountLimitValue(rawLimit, discountType)
    const maxDiscount = digitsOnly(row['最高优惠金额'])
    const minSpend    = digitsOnly(row['最低消费金额'])
    const totalCount  = digitsOnly(row['可使用总数'])
    const perBuyer    = digitsOnly(row['每个买家可用的优惠券数量上限'])

    // 提前显示字段名可能含换行符
    const showEarlyKey = Object.keys(row).find(k => k.replace(/\s+/g,'').includes('是否提前显示'))
    const showEarly   = boolLike(showEarlyKey ? row[showEarlyKey] : '')

    const startDt = parseDateTime(row['优惠券领取期限（开始）精确到分'], 'start')
    const endDt   = parseDateTime(row['优惠券领取期限（结束）精确到分'], 'end')

    if (!store)       throw new Error('Excel 缺少"店铺"')
    if (!voucherType) throw new Error('Excel 缺少"优惠券品类"')

    const couponName = shared.couponName || (store + discountLimit)
    const couponCode = shared.couponCode || randCode(5)
    const result = shared.result || {
      '序号': page, '站点': site, '店铺': store, '优惠券品类': voucherType,
      '奖励类型': rewardType, '折扣类型': discountType, '优惠限额': discountLimit,
      '生成优惠券名称': couponName, '生成优惠码': couponCode,
      '执行状态': '待执行', '错误原因': ''
    }
    return { store, site, voucherType, rewardType, discountType, discountLimit,
             maxDiscount, minSpend, totalCount, perBuyer, showEarly,
             startDt, endDt, couponName, couponCode, result }
  }

  function nextPhase(np, ctx, sleepMs = 1200, extras = {}) {
    return {
      success: true, data: [],
      meta: {
        action: 'next_phase', next_phase: np, sleep_ms: sleepMs,
        shared: {
          ...(shared || {}),
          couponName: ctx.couponName, couponCode: ctx.couponCode, result: ctx.result,
          ...extras
        }
      }
    }
  }

  function hasCreateFormMounted() {
    return !![...document.querySelectorAll('.eds-react-form-item')].find(el => {
      const lbl = el.querySelector('.eds-react-form-item__label')
      return lbl && norm(lbl.textContent).includes('优惠券名称')
    })
  }

  function isOnCreatePage() {
    return location.href.includes('/portal/marketing/vouchers/new') || hasCreateFormMounted()
  }

  function finish(result, error = '') {
    const out = { ...(result || {}) }
    out['执行状态'] = error ? '失败' : '成功'
    out['错误原因'] = error || ''
    return {
      success: true, data: [out],
      meta: { action: 'complete', has_more: page < rows.length, page, total: rows.length, shared: {} }
    }
  }

  if (!row) {
    return { success: true, data: [], meta: { action: 'complete', has_more: false, page, total: rows.length, shared: {} } }
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  PHASES
  // ════════════════════════════════════════════════════════════════════════════
  try {
    await closeBlockingOverlays()
    const ctx = buildContext()

    // ── main ─────────────────────────────────────────────────────────────────
    // 入口：确保在营销中心页面（用于搜索店铺）
    if (phase === 'main') {
      if (isOnCreatePage()) {
        return nextPhase('form_fill', ctx, 80)
      }
      if (mode === 'new' || !location.href.startsWith(MARKETING_URL)) {
        // 需要导航到营销中心
        location.href = MARKETING_URL
        return nextPhase('store_switch', ctx, 3000)
      }
      // 已在营销中心域内，直接切换店铺
      return nextPhase('store_switch', ctx, 200)
    }

    // ── store_switch ─────────────────────────────────────────────────────────
    // 在营销中心搜索并切换到目标店铺
    if (phase === 'store_switch') {
      // 如果已经进入创建页且表单已挂载，不要再拉回营销主页
      if (isOnCreatePage()) {
        return nextPhase('form_fill', ctx, 80)
      }

      // 确保在营销中心主页（/portal/marketing 精确匹配，不是 /vouchers）
      const url = location.href
      if (!url.includes('/portal/marketing') ||
          url.includes('/portal/marketing/vouchers')) {
        location.href = MARKETING_URL
        return nextPhase('store_switch', ctx, 3000)
      }

      // 检查当前店铺是否已匹配
      function getStoreText() {
        const el = document.querySelector('.shop-switcher, .shop-switcher-container, .shop-select, .shop-info, .shop-label')
        if (el && visible(el)) return textOf(el.closest('.shop-info') || el.parentElement || el)
        // fallback：找页面内含"当前店铺"的区域
        const all = [...document.querySelectorAll('div, span')].filter(e => visible(e) && textOf(e).startsWith('当前店铺'))
        return all.length ? textOf(all[0]) : ''
      }

      const storeText = getStoreText()
      const matched = storeText.includes(ctx.store) && (!ctx.site || storeText.includes(ctx.site))

      if (!matched) {
        // 找搜索框
        const searchInput = await waitFor(() =>
          [...document.querySelectorAll('input')].find(el =>
            visible(el) && (
              norm(el.placeholder).includes('搜索') ||
              el.closest('.shop-switcher, .shop-select, [class*="shopSwitch"], [class*="shop-switch"]')
            )
          )
        , 8000, 300)
        if (!searchInput) throw new Error('未找到店铺搜索框，请确认已打开营销中心主页')

        click(searchInput)
        await sleep(200)
        setNativeValue(searchInput, ctx.store)
        await sleep(1200)

        // 找候选项
        const candidate = await waitFor(() =>
          [...document.querySelectorAll('li, [role=option], .search-item, [class*="shopItem"], [class*="shop-item"]')]
            .filter(visible)
            .find(el => {
              const t = textOf(el)
              if (!t.includes(ctx.store)) return false
              if (ctx.site && !t.includes(ctx.site)) return false
              return true
            })
        , 6000, 250)
        if (!candidate) throw new Error(`搜索后未找到店铺：${ctx.store}`)
        if (/没有权限|无权限/.test(textOf(candidate))) throw new Error(`店铺"${ctx.store}"无权限`)

        click(candidate)
        await sleep(2000)
        await closeBlockingOverlays()

        // 等待店铺名更新
        await waitFor(() => {
          const t = getStoreText()
          return t.includes(ctx.store) ? t : null
        }, 5000, 300)

        const verifyText = getStoreText()
        if (!verifyText.includes(ctx.store)) {
          const full = document.body.innerText
          if (!full.includes(ctx.store)) throw new Error(`切换店铺后未能确认：${verifyText.substring(0,80)}`)
        }
      }

      // 店铺已匹配，进入优惠券菜单
      // 方式一：侧边栏点"优惠券"菜单
      const sidebarVoucherLink = [...document.querySelectorAll('a, [role=menuitem], li')].find(el =>
        visible(el) && /^优惠券$/.test(textOf(el))
      )
      if (sidebarVoucherLink) {
        click(sidebarVoucherLink)
        return nextPhase('enter_type', ctx, 2000)
      }
      // 方式二：直接导航
      location.href = VOUCHERS_URL
      return nextPhase('enter_type', ctx, 2500)
    }

    // ── enter_type ───────────────────────────────────────────────────────────
    // 在优惠券列表页找到对应类型入口，点"创建"，等待表单出现
    if (phase === 'enter_type') {
      // 已在创建页时直接续跑表单填写，避免再次点击入口造成状态重置
      if (isOnCreatePage()) {
        return nextPhase('form_fill', ctx, 80)
      }

      // 确保在优惠券列表页
      if (!location.href.includes('/portal/marketing/vouchers')) {
        location.href = VOUCHERS_URL
        return nextPhase('enter_type', ctx, 2500)
      }

      const entryMap = {
        '商店优惠券':   'voucherEntry1',
        '新买家优惠券': 'voucherEntry3',
        '回购买家优惠券':'voucherEntry4',
        '关注礼优惠券': 'voucherEntry999',
      }
      const testId = entryMap[ctx.voucherType]
      if (!testId) throw new Error(`未配置入口：${ctx.voucherType}`)

      // 特定买家类型需要展开
      if (['voucherEntry3','voucherEntry4','voucherEntry999'].includes(testId)) {
        await ensureBuyerEntries(testId)
      }

      // 找入口卡片
      const card = await waitFor(() => {
        const el = document.querySelector(`button[data-testid="${testId}"]`)
        return visible(el) ? el : null
      }, 5000, 200)
      if (!card) throw new Error(`未找到优惠券入口卡片：${ctx.voucherType}`)

      // 找卡片内的"创建"子按钮（必须点这个，不是点整张卡片）
      const createBtn = [...card.querySelectorAll('button')].find(el =>
        visible(el) && /^(创建|新建)$/.test(textOf(el))
      )
      const clickTarget = createBtn || card

      // ★ 关键：同一次 evaluate 里 click 后 waitFor 等表单出现
      // 不能 return nextPhase，因为 SPA 导航后旧 context 失效
      // 但是：只要 evaluate 还在跑（awaitPromise=true），导航后 context 依然有效！
      click(clickTarget)

      // 等待创建表单出现（最多 12s）
      const formItem = await waitFor(() => {
        const items = document.querySelectorAll('.eds-react-form-item')
        // 找"优惠券名称"这个 item 确认是创建页表单
        return [...items].find(el => {
          const lbl = el.querySelector('.eds-react-form-item__label')
          return lbl && norm(lbl.textContent).includes('优惠券名称')
        }) || null
      }, 12000, 400)

      if (!formItem) {
        throw new Error(`点击"创建"后等待表单超时，当前URL：${location.href.substring(0,100)}`)
      }

      // 表单已出现，继续在当前 context 填写
      await sleep(300)
      return nextPhase('form_fill', ctx, 100)
    }

    // ── form_fill ────────────────────────────────────────────────────────────
    if (phase === 'form_fill') {
      // 等表单确实可用（evaluate 在新 context 里，应该能直接找到）
      const formReady = await waitFor(() => {
        const items = [...document.querySelectorAll('.eds-react-form-item')]
        return items.find(el => {
          const lbl = el.querySelector('.eds-react-form-item__label')
          return lbl && norm(lbl.textContent).includes('优惠券名称')
        }) || null
      }, 10000, 400)
      if (!formReady) throw new Error(`创建表单未出现，当前URL：${location.href.substring(0,100)}`)
      await sleep(300)

      // 1. 优惠券名称
      await fillField('优惠券名称', ctx.couponName)

      // 2. 优惠码
      await fillField('优惠码', ctx.couponCode)

      // 3. 领取期限
      if (ctx.startDt || ctx.endDt) await setDateRange(ctx.startDt, ctx.endDt)

      // 4. 提前显示
      await setShowEarly(ctx.showEarly)

      // 5. 奖励类型
      if (ctx.rewardType) await setRewardType(ctx.rewardType)

      // 6. 折扣类型（下拉）
      if (ctx.discountType) await setDiscountType(ctx.discountType)

      // 7. 优惠限额（折扣类型旁的数字框）
      if (ctx.discountLimit) await fillDiscountLimit(ctx.discountLimit)

      // 8. 最高优惠金额
      if (ctx.maxDiscount) await fillMaxDiscount(ctx.maxDiscount)

      // 9. 最低消费金额
      if (ctx.minSpend) {
        const item = getFormItem('最低消费金额')
        if (item) { const inp = getTextInputs(item)[0]; if (inp) await typeInto(inp, String(toNumber(ctx.minSpend))) }
      }

      // 10. 可使用总数
      if (ctx.totalCount) {
        const item = getFormItem('可使用总数')
        if (item) { const inp = getTextInputs(item)[0]; if (inp) await typeInto(inp, String(toNumber(ctx.totalCount))) }
      }

      // 11. 每个买家可用数量上限
      if (ctx.perBuyer) {
        const item = getFormItem('每个买家可用的优惠券数量上限') || getFormItem('每个买家')
        if (item) { const inp = getTextInputs(item)[0]; if (inp) await typeInto(inp, String(toNumber(ctx.perBuyer))) }
      }

      return nextPhase('submit', ctx, 50)
    }

    // ── submit ───────────────────────────────────────────────────────────────
    if (phase === 'submit') {
      const allBtns = [...document.querySelectorAll('button')].filter(visible)
      // 优先 primary 样式的"确认/确定"
      const confirmBtn =
        allBtns.find(el => {
          const t = textOf(el)
          if (t !== '确认' && t !== '确定') return false
          return (el.className || '').includes('primary')
        }) ||
        allBtns.find(el => textOf(el) === '确认' || textOf(el) === '确定')

      if (!confirmBtn) throw new Error('未找到"确认"按钮')
      click(confirmBtn)
      return nextPhase('post_submit', ctx, 3500)
    }

    // ── post_submit ──────────────────────────────────────────────────────────
    if (phase === 'post_submit') {
      // 等待成功信号：跳回列表页 或 出现成功 toast
      const ok = await waitFor(() => {
        if (location.href.includes('/portal/marketing/vouchers/list') ||
            location.href.includes('/portal/marketing/vouchers/') &&
            !location.href.includes('/new')) return 'url'
        const bt = norm(document.body.innerText)
        if (/创建成功|设置成功|已创建/.test(bt)) return 'toast'
        const alerts = [...document.querySelectorAll('[role=alert],.eds-toast,.eds-message,.eds-notification')]
          .filter(visible).map(e => textOf(e)).join(' ')
        if (/成功/.test(alerts)) return 'toast'
        return null
      }, 8000, 300)

      if (ok) return finish(ctx.result)

      // 没有成功信号，检查错误
      const inlineErrors = [...document.querySelectorAll(
        '.eds-react-form-item__extra,.eds-react-form-item__help,[class*="error-msg"],[class*="errorMsg"]'
      )].filter(visible).map(e => textOf(e)).filter(Boolean)

      const toastErrors = [...document.querySelectorAll('[role=alert],.eds-toast,.eds-message')
      ].filter(visible).map(e => textOf(e)).filter(Boolean)

      const errors = [...new Set([...inlineErrors, ...toastErrors])]
      if (errors.length) throw new Error(`提交校验：${errors.join(' | ')}`)

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
      if (ok2) return finish(ctx.result)

      throw new Error(`提交后未能确认成功，当前URL：${location.href.substring(0,100)}`)
    }

    throw new Error(`未知 phase：${phase}`)

  } catch (e) {
    const fallback = (shared?.result) || {
      '序号': page, '站点': row['站点'] || '', '店铺': row['店铺'] || '',
      '优惠券品类': row['优惠券品类'] || '', '奖励类型': row['奖励类型'] || '',
      '折扣类型': row['折扣类型'] || '', '优惠限额': '',
      '生成优惠券名称': shared?.couponName || '', '生成优惠码': shared?.couponCode || '',
      '执行状态': '失败', '错误原因': ''
    }
    return finish(fallback, e.message || String(e))
  }
})()