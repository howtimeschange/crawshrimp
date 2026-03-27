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
    try { el.focus?.() } catch {}
    const mouseOpts = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1, detail: 1 }
    try {
      if (typeof PointerEvent === 'function') {
        el.dispatchEvent(new PointerEvent('pointerdown', { ...mouseOpts, pointerType: 'mouse', isPrimary: true }))
      }
    } catch {}
    for (const ev of ['mousedown','mouseup','click']) {
      try { el.dispatchEvent(new MouseEvent(ev, mouseOpts)) } catch {}
    }
    try { el.click() } catch {}
    return true
  }

  function tap(el) {
    return click(el)
  }

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
      const t = textOf(btn)
      if (!visible(btn)) continue
      if (!/^(关闭|知道了|稍后)$/.test(t)) continue
      const scope = btn.closest('.fullstory-modal-wrapper, .diagnosis-result-modal, [role="dialog"], .eds-modal, .eds-drawer, .shopee-modal')
      if (!scope) continue
      try { click(btn) } catch {}
    }
    await sleep(100)
  }

  function getFormItem(labelText) {
    const labels = Array.isArray(labelText) ? labelText.map(norm) : [norm(labelText)]
    return [...document.querySelectorAll('.eds-react-form-item, .eds-form-item')].find(el => {
      const lbl = el.querySelector('.eds-react-form-item__label, .eds-form-item__label')
      const t = norm(lbl?.textContent)
      return t && labels.some(x => t.includes(x))
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

  function toIsoStringFromDt(dt) {
    if (!dt) return ''
    return new Date(`${dt.y}-${dt.mo}-${dt.d}T${dt.hh}:${dt.mm}:00+08:00`).toISOString()
  }

  // ─── 日期时间 Picker ─────────────────────────────────────────────────────────
  async function fillDatetimePicker(triggerInput, dt) {
    click(triggerInput)
    await sleep(600)

    // 等面板出现
    const panel = await waitFor(() =>
      document.querySelector('.eds-react-date-picker-panel, .eds-react-date-picker__panel-wrap, .eds-picker-dropdown, [class*="date-picker"][class*="panel"], [class*="datepicker"][class*="dropdown"]')
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
      } else {
        const wrap = panel.closest('.eds-react-popover, .eds-react-date-picker__popup') || panel
        const header = wrap.querySelector('.eds-react-date-picker__header')
        const btns = header?.querySelectorAll('.btn-arrow-default') || []
        const getHead = () => ({
          year: Number((wrap.querySelector('.date-box .year')?.textContent || '').replace(/\D+/g, '')),
          month: Number((wrap.querySelector('.date-box .month')?.textContent || '').replace(/\D+/g, '')),
        })
        const fire = (el) => {
          if (!el) return false
          for (const ev of ['pointerdown','mousedown','mouseup','click']) {
            try { el.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window, buttons: 1 })) } catch {}
          }
          try { el.click?.() } catch {}
          return true
        }

        const cur = getHead()
        if (cur.year && cur.month && btns.length >= 4) {
          const yearDelta = Number(dt.y) - cur.year
          const monthDelta = Number(dt.mo) - cur.month
          const dbl = yearDelta > 0 ? btns[3] : btns[0]
          const single = monthDelta > 0 ? btns[2] : btns[1]
          for (let i = 0; i < Math.abs(yearDelta); i++) {
            fire(dbl)
            await sleep(120)
          }
          for (let i = 0; i < Math.abs(monthDelta); i++) {
            fire(single)
            await sleep(120)
          }
        }

        const day = [...wrap.querySelectorAll('.eds-react-date-picker__table-cell')].find(el => {
          const t = norm(el.textContent)
          return t === String(Number(dt.d)) &&
                 !el.classList.contains('disabled') &&
                 !el.classList.contains('out-of-range')
        })
        if (day) {
          fire(day)
          await sleep(120)
        }

        const cols = wrap.querySelectorAll('.eds-react-time-picker__tp-scrollbar')
        if (cols.length >= 2) {
          const hour = [...cols[0].querySelectorAll('.time-box')].find(el => norm(el.textContent) === dt.hh)
          const minute = [...cols[1].querySelectorAll('.time-box')].find(el => norm(el.textContent) === dt.mm)
          if (hour) { fire(hour); await sleep(100) }
          if (minute) { fire(minute); await sleep(100) }
        }

        const okBtn = [...wrap.querySelectorAll('button')].find(b => /^(确认|确定|OK)$/i.test(textOf(b)))
        if (okBtn) {
          fire(okBtn)
          await sleep(250)
        }
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

  function setNativeChecked(el, checked) {
    if (!el) return false
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')
    if (desc?.set) desc.set.call(el, !!checked)
    else el.checked = !!checked
    el.dispatchEvent(new Event('input',  { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }

  function reactPropsOf(el) {
    const k = Object.keys(el || {}).find(x => x.startsWith('__reactProps'))
    return k ? el[k] : null
  }

  async function setControlledInputValue(el, value) {
    if (!el) return false
    const val = String(value ?? '')
    click(el)
    await sleep(80)
    try { el.focus() } catch {}
    const props = reactPropsOf(el)
    try { props?.onFocus?.({ target: el, currentTarget: el }) } catch {}
    setNativeValue(el, val)
    try { props?.onChange?.({ target: el, currentTarget: el, nativeEvent: { target: el } }) } catch {}
    try { props?.onBlur?.({ target: el, currentTarget: el }) } catch {}
    try { el.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: 'Enter', code: 'Enter' })) } catch {}
    await sleep(180)
    return norm(el.value).includes(norm(val))
  }

  function rangeDisplayText(item) {
    return {
      start: norm(item?.querySelector('.picker-item.start-picker, .start-picker')?.textContent),
      end: norm(item?.querySelector('.picker-item.end-picker, .end-picker')?.textContent),
    }
  }

  function parseDateTimeValue(str) {
    const m = String(str || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2})$/)
    if (!m) return null
    return {
      year: Number(m[1]), month: Number(m[2]), day: Number(m[3]),
      hour: String(Number(m[4])).padStart(2, '0'), minute: String(Number(m[5])).padStart(2, '0'),
      text: `${m[1]}-${String(Number(m[2])).padStart(2,'0')}-${String(Number(m[3])).padStart(2,'0')} ${String(Number(m[4])).padStart(2,'0')}:${String(Number(m[5])).padStart(2,'0')}`
    }
  }

  function getDatePickerPanel(item) {
    const local = item?.querySelector('.eds-react-date-picker__panel-wrap, .eds-react-popover.eds-react-date-picker__popup')
    if (local && visible(local)) return local
    return [...document.querySelectorAll('.eds-react-popover.eds-react-date-picker__popup, .eds-react-date-picker__panel-wrap')]
      .find(el => visible(el) && /确认/.test(textOf(el))) || null
  }

  // ─── 日期面板解析（EDS date-picker 新版 DOM）───────────────────────────────
  const MONTH_MAP = { january:1, february:2, march:3, april:4, may:5, june:6,
                      july:7, august:8, september:9, october:10, november:11, december:12,
                      '一月':1,'二月':2,'三月':3,'四月':4,'五月':5,'六月':6,
                      '七月':7,'八月':8,'九月':9,'十月':10,'十一月':11,'十二月':12 }

  /**
   * 读取日期面板当前显示的年月。
   * 兼容两种结构：
   *   1. 月份英文名在 [.date-default-style] 或 [.date-box] 内
   *   2. 年份在 [class*="year"] 的元素内
   */
  function getDatePickerHeader(panel) {
    if (!panel) return null
    // 找月份文本：可能是 .date-default-style 或直接包含英文月名的元素
    const headerEl = panel.querySelector('.date-default-style, .date-box, .eds-react-date-picker__header')
    if (!headerEl) return null
    const headerText = textOf(headerEl)
    // 提取英文月份
    const monthName = headerText.match(/([A-Za-z]+)/)?.[1] || ''
    const monthNum = MONTH_MAP[monthName.toLowerCase()] || null
    // 年份：4位数字
    const yearMatch = headerText.match(/(\d{4})/)
    const year = yearMatch ? Number(yearMatch[1]) : null
    if (!year || !monthNum) return null
    return { year, month: monthNum }
  }

  /**
   * 找月份导航按钮和年份选择按钮。
   * 月份导航：面板 header 区域内宽 < 60px 的按钮（包含 < > 箭头图标）
   * 年份选择：标有 ">" 或年份数字的可点击元素
   * 返回 { prevMonth, nextMonth, yearPicker }
   */
  function getPickerNavButtons(panel) {
    if (!panel) return {}
    const header = panel.querySelector('.date-default-style, .date-box, .eds-react-date-picker__header, .date-range-picker')
    if (!header) return {}
    // 找所有窄按钮（宽 < 80px），通常为导航箭头
    const allBtns = [...(header.querySelectorAll('button'))]
    const navBtns = allBtns.filter(b => {
      const r = b.getBoundingClientRect()
      return r.width > 0 && r.width < 80 && r.height < 80
    })
    // prevMonth = 第一个按钮, nextMonth = 第二个按钮（中间是月份文字）
    const prevMonth = navBtns[0] || null
    const nextMonth = navBtns[1] || null

    // 年份选择器：查找显示 "> 2026" 样式的大按钮
    const yearBtn = [...panel.querySelectorAll('button, [class*="year"]')].find(b => {
      const r = b.getBoundingClientRect()
      const txt = textOf(b)
      return r.width > 0 && r.width < 200 && r.height < 60 &&
             txt.match(/\d{4}/) && visible(b)
    }) || null

    return { prevMonth, nextMonth, yearPicker: yearBtn }
  }

  /**
   * 找时间选择 spinner。
   * 每个 spinner 有向上/向下箭头按钮，以及当前数值显示。
   * 返回 [{ upBtn, downBtn, currentVal, targetVal }, ...]
   */
  function getTimeSpinners(panel, targetHour, targetMinute) {
    if (!panel) return []
    const spinners = []
    // 找 spinner 容器：宽 < 100px，包含 up/down 图标
    const containers = [...panel.querySelectorAll('.eds-react-time-picker__tp-column, [class*="spinner"], [class*="picker-column"], .time-box')]
    const valid = containers.filter(c => {
      const r = c.getBoundingClientRect()
      return r.width > 0 && r.width < 120 && r.height > 0
    })
    // 前两个是 Hours 和 Minutes
    for (let i = 0; i < Math.min(valid.length, 2); i++) {
      const container = valid[i]
      const allBtns = [...container.querySelectorAll('button, [class*="arrow"], .eds-react-icon')]
      // upBtn = 距离 container 顶部更近的按钮，downBtn = 距离底部更近的按钮
      const upBtn = allBtns.find(b => {
        if (!visible(b)) return false
        const r = b.getBoundingClientRect()
        const cRect = container.getBoundingClientRect()
        return r.width > 0 && r.width < 80 && r.height < 80 &&
               Math.abs(r.y - cRect.y) <= Math.abs(r.y - (cRect.y + cRect.height))
      })
      const downBtn = allBtns.find(b => {
        if (!visible(b)) return false
        const r = b.getBoundingClientRect()
        const cRect = container.getBoundingClientRect()
        return r.width > 0 && r.width < 80 && r.height < 80 &&
               Math.abs(r.y - (cRect.y + cRect.height)) <= Math.abs(r.y - cRect.y)
      })
      // 当前数值
      const txt = textOf(container)
      const numMatch = txt.match(/\d+/)
      const currentVal = numMatch ? String(Number(numMatch[0])).padStart(2, '0') : null
      const targetVal = i === 0 ? String(targetHour).padStart(2, '0') : String(targetMinute).padStart(2, '0')
      spinners.push({ container, upBtn, downBtn, currentVal, targetVal })
    }
    return spinners
  }

  /**
   * 找日历日 cell（月份内的可点击日期格）
   */
  function findDayCell(panel, day) {
    if (!panel) return null
    const dayText = String(Number(day))
    // 尝试多种 cell 选择器
    const selectors = [
      '.eds-react-date-picker__table-cell-wrap',
      '.eds-react-date-picker__table-cell',
      'td',
      '[class*="table-cell"]',
    ]
    for (const sel of selectors) {
      const cells = [...panel.querySelectorAll(sel)]
      const found = cells.find(c => {
        if (!visible(c)) return false
        const txt = textOf(c)
        return txt === dayText && !/disabled|out-of-range/.test(c.className || '')
      })
      if (found) return found
    }
    return null
  }

  async function clickNavAndVerify(panel, btn, expectedDirection) {
    if (!btn) return false
    const before = getDatePickerHeader(panel)
    if (!before) return false
    click(btn)
    await sleep(180)
    const after = getDatePickerHeader(panel)
    if (!after) return false
    if (expectedDirection === 'prevYear') return after.year < before.year
    if (expectedDirection === 'nextYear') return after.year > before.year
    if (expectedDirection === 'prevMonth') return (after.year < before.year) || (after.year === before.year && after.month < before.month)
    if (expectedDirection === 'nextMonth') return (after.year > before.year) || (after.year === before.year && after.month > before.month)
    return false
  }

  async function navigateDatePicker(panel, target) {
    for (let i = 0; i < 60; i++) {
      const header = getDatePickerHeader(panel)
      if (!header) break
      if (header.year === target.year && header.month === target.month) return true
      const nav = getPickerNavButtons(panel)
      let moved = false

      // 年份不同：先导航年份
      if (header.year !== target.year) {
        if (nav.yearPicker) {
          // 年份是下拉，直接点击打开然后选择目标年份
          click(nav.yearPicker)
          await sleep(300)
          // 在打开的年份下拉列表中找目标年份
          const yearList = document.querySelector('.eds-react-select__dropdown-list, [class*="select-dropdown"], [class*="picker-option"]')
          if (yearList) {
            const yearOption = [...yearList.querySelectorAll('[class*="option"], li, div')].find(el => {
              const txt = textOf(el)
              return txt.trim() === String(target.year) && visible(el)
            })
            if (yearOption) {
              click(yearOption)
              await sleep(200)
              moved = true
            }
          }
          // 如果年份选择器是 input 类型（可编辑下拉）
          const yearInput = document.querySelector('.eds-react-select__input, [class*="year"] input')
          if (yearInput && !moved) {
            click(yearInput)
            await sleep(100)
            setNativeValue(yearInput, String(target.year))
            await sleep(200)
            try { document.body.click() } catch {}
            await sleep(300)
            moved = true
          }
        }
        if (!moved) {
          // 如果没有年份下拉，尝试多次 prevYear / nextYear（用 prevMonth 按钮的多步）
          const delta = target.year - header.year
          const btn = delta < 0 ? nav.prevMonth : nav.nextMonth
          // 每次点击prevMonth/nextMonth切1月，12次=1年（取巧方式）
          if (btn) {
            const steps = Math.abs(delta) * 12 + (delta < 0 ? (12 - header.month + 1) : (target.month - header.month))
            const dir = delta < 0 ? 'prevMonth' : 'nextMonth'
            for (let j = 0; j < Math.min(steps, 60); j++) {
              click(btn)
              await sleep(150)
              moved = true
            }
          }
        }
      }
      // 年份相同，月不同：直接导航月份
      if (header.year === target.year && header.month !== target.month) {
        const delta = target.month - header.month
        const btn = delta < 0 ? nav.prevMonth : nav.nextMonth
        if (!btn) break
        const dir = delta < 0 ? 'prevMonth' : 'nextMonth'
        // 点击直到到达目标月
        for (let j = 0; j < Math.abs(delta); j++) {
          click(btn)
          await sleep(150)
        }
        moved = true
      }
      if (!moved) break
      await sleep(100)
    }
    const header = getDatePickerHeader(panel)
    return !!header && header.year === target.year && header.month === target.month
  }

  function findCurrentMonthDayWrap(panel, day) {
    const dayText = String(Number(day))
    return [...panel.querySelectorAll('.eds-react-date-picker__table-cell-wrap')].find(wrap => {
      if (textOf(wrap) !== dayText) return false
      const cell = wrap.querySelector('.eds-react-date-picker__table-cell')
      if (!cell) return false
      return !/disabled/.test(cell.className || '')
    }) || null
  }

  // CDP 鼠标点击协议：JS 算坐标 → return cdp_clicks → Python 用真实鼠标事件点 → 继续下一 phase
  // 这是唯一能可靠触发 React 合成事件的方式（JS dispatchEvent 无效）
  function rectCenter(el) {
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return null
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }

  function nextCdpClickPhase(clicks, nextPhase, sleepMs = 300, ctx = null) {
    const sharedPayload = {
      ...(shared || {}),
      ...(ctx ? {
        couponName: ctx.couponName,
        couponCode: ctx.couponCode,
        result: ctx.result,
      } : {}),
    }
    return {
      success: true,
      meta: { action: 'cdp_clicks', clicks, next_phase: nextPhase, sleep_ms: sleepMs, shared: sharedPayload },
    }
  }

  // pick_date_open_panel：打开指定 kind(start/end) 的日期面板并切换年月
  // pick_date_select_day：选择具体日期 cell（需要 CDP 点击）
  // pick_date_select_time：选择时分（spinner 上下箭头）
  // pick_date_confirm：点确认

  async function pickDateTimeViaPanel(item, kind, dt) {
    const target = parseDateTimeValue(dt?.str)
    if (!target) throw new Error(`无法解析领取期限：${dt?.str || ''}`)
    const kindLabel = kind === 'start' ? '开始' : '结束'

    // 关闭可能已打开的面板
    const existingPanel = document.querySelector('.eds-react-popover.eds-react-date-picker__popup:not(.eds-react-popover-hidden)')
    if (existingPanel) { try { document.body.click() } catch {} ; await sleep(200) }

    // 找触发器 input
    const trigger = item.querySelector(
      `.picker-item.${kind}-picker input.eds-react-input__input, ` +
      `.picker-item.${kind}-picker input.eds-react-date-picker__input`
    )
    if (!trigger) throw new Error(`未找到${kindLabel}日期触发器`)

    try { trigger.scrollIntoView({ block: 'center' }) } catch {}
    await sleep(200)
    click(trigger)
    await sleep(800)

    const panel = await waitFor(() => getDatePickerPanel(item), 4000, 200)
    if (!panel) throw new Error(`未展开${kindLabel}日期面板`)

    // ─── 阶段一：导航到目标年月 ───────────────────────────────────────────────
    const header = getDatePickerHeader(panel)
    if (!header) throw new Error(`无法读取${kindLabel}日期面板标题年月，当前面板可能不在可见状态`)

    // 年份导航（如果有 yearPicker 下拉）
    const nav = getPickerNavButtons(panel)
    const navPhase = `pick_date_nav_${kind}`
    const ctxForShared = { couponName: shared.couponName, couponCode: shared.couponCode, result: shared.result }

    // 需要导航年 or 月时，先调用 navigateDatePicker（纯 JS click），然后再处理 cell/time/confirm CDP
    const needsYearNav = header.year !== target.year
    const needsMonthNav = header.month !== target.month

    if (needsYearNav || needsMonthNav) {
      // 导航年月（JS click，不通过 CDP），navigateDatePicker 内部处理 yearPicker 下拉和月份箭头
      const navOk = await navigateDatePicker(panel, { year: target.year, month: target.month })
      if (!navOk) throw new Error(`${kindLabel}日期导航失败`)
      await sleep(200)
    }

    // ─── 阶段二：选择日期 cell ────────────────────────────────────────────────
    const targetCell = findDayCell(panel, target.day)
    if (!targetCell) throw new Error(`未找到目标日期 cell：${target.day}`)
    const cellCenter = rectCenter(targetCell)
    if (!cellCenter) throw new Error(`目标日期 cell getBoundingClientRect 为空`)

    // ─── 阶段三：选择时分（spinner 方式）─────────────────────────────────────
    const timeClicks = []
    const spinners = getTimeSpinners(panel, target.hour, target.minute)
    for (const sp of spinners) {
      if (!sp.container || !sp.upBtn || !sp.downBtn) continue
      const current = Number(sp.currentVal)
      const dest = Number(sp.targetVal)
      if (isNaN(current) || isNaN(dest)) continue
      if (current === dest) continue
      const diff = dest - current
      const btn = diff > 0 ? sp.upBtn : sp.downBtn
      const clicks_needed = Math.abs(diff)
      const btnCenter = rectCenter(btn)
      if (!btnCenter) continue
      for (let i = 0; i < clicks_needed; i++) {
        timeClicks.push({ ...btnCenter, delay_ms: 80, label: `time_${sp.targetVal}` })
      }
    }

    // ─── 阶段四：找确认按钮 ──────────────────────────────────────────────────
    const allBtns = [...panel.querySelectorAll('button')].filter(visible)
    const okBtn = allBtns.find(b => /^(确认|确定|OK)$/i.test(textOf(b)))
    const okCenter = okBtn ? rectCenter(okBtn) : null
    if (!okCenter) throw new Error('未找到日期面板确认按钮')

    // ─── 组装完整 CDP 点击序列 ───────────────────────────────────────────────
    // cell 点击后需要等待 panel 关闭再重新打开（选择日期后自动进入时分状态）
    // 为了简单：先点 cell → 等 → 再点 spinner → 等 → 点确认
    const clicks = []

    // 1. 日期 cell
    clicks.push({ ...cellCenter, delay_ms: 300, label: `日期${target.day}` })

    // 2. spinner 时间（每步 80ms）
    timeClicks.forEach(c => clicks.push(c))

    // 3. 确认
    clicks.push({ ...okCenter, delay_ms: 400, label: '确认' })

    shared[`_pick_${kind}`] = { target: dt.str, targetCell, spinners, clicks }
    return nextCdpClickPhase(clicks, `pick_date_verify_${kind}`, 400, ctxForShared)
  }

  async function confirmDatePicker(scope = document) {
    const popover = scope?.closest?.('.eds-react-popover.eds-react-date-picker__popup') ||
      (scope?.matches?.('.eds-react-popover.eds-react-date-picker__popup') ? scope : null)
    const roots = [
      popover,
      scope,
      scope?.closest?.('.eds-react-date-picker__panel-wrap') || null,
      scope?.closest?.('.date-range-picker-container') || null,
      document,
    ].filter(Boolean)
    for (const root of roots) {
      const okBtn = [...root.querySelectorAll('.eds-react-date-picker__btn-wrap button, button')].find(b => {
        const txt = textOf(b)
        if (!/^(确认|确定|OK)$/i.test(txt)) return false
        if (root === document) {
          const popup = b.closest('.eds-react-popover.eds-react-date-picker__popup')
          return visible(b) && (!popup || visible(popup))
        }
        return visible(b)
      })
      if (okBtn) {
        click(okBtn)
        await sleep(300)
        return true
      }
    }
    return false
  }

  async function setDateRange(startDt, endDt) {
    const item = getFormItem(['优惠券领取期限', 'Claim Period'])
    if (!item) throw new Error('未找到"优惠券领取期限/Claim Period"')

    if (item.querySelector('.picker-item.start-picker, .picker-item.end-picker, .eds-react-date-picker__input')) {
      if (startDt) await pickDateTimeViaPanel(item, 'start', startDt)
      if (endDt) await pickDateTimeViaPanel(item, 'end', endDt)
      const inputs = [...item.querySelectorAll('input.eds-react-input__input')].filter(visible)
      if (startDt && inputs[0] && !norm(inputs[0].value).includes(startDt.str)) {
        throw new Error(`领取期限开始时间未写入成功，期望：${startDt.str}，实际：${inputs[0].value || '(空)'}`)
      }
      if (endDt && inputs[1] && !norm(inputs[1].value).includes(endDt.str)) {
        throw new Error(`领取期限结束时间未写入成功，期望：${endDt.str}，实际：${inputs[1].value || '(空)'}`)
      }
      return true
    }

    const rangeComp = item.querySelector('.date-range-picker-container, .date-range-picker')?.__vueParentComponent || null
    if (rangeComp?.ctx && (typeof rangeComp.ctx.handleStartChange === 'function' || typeof rangeComp.ctx.handleEndChange === 'function')) {
      if (startDt && typeof rangeComp.ctx.handleStartChange === 'function') {
        rangeComp.ctx.handleStartChange(toIsoStringFromDt(startDt))
        await sleep(250)
      }
      if (endDt && typeof rangeComp.ctx.handleEndChange === 'function') {
        rangeComp.ctx.handleEndChange(toIsoStringFromDt(endDt))
        await sleep(250)
      }
      const display1 = rangeDisplayText(item)
      if (startDt && typeof rangeComp.ctx.handleStartChange === 'function' && !display1.start.includes(startDt.str)) {
        rangeComp.ctx.handleStartChange(toIsoStringFromDt(startDt))
        await sleep(250)
      }
      if (endDt && typeof rangeComp.ctx.handleEndChange === 'function' && !display1.end.includes(endDt.str)) {
        rangeComp.ctx.handleEndChange(toIsoStringFromDt(endDt))
        await sleep(250)
      }
      try { rangeComp.ctx.validate?.() } catch {}
      try { document.body.click() } catch {}
      await sleep(150)

      const display2 = rangeDisplayText(item)
      if (startDt && !display2.start.includes(startDt.str)) {
        throw new Error(`领取期限开始时间未写入成功，期望：${startDt.str}，实际：${display2.start || '(空)'}`)
      }
      if (endDt && !display2.end.includes(endDt.str)) {
        throw new Error(`领取期限结束时间未写入成功，期望：${endDt.str}，实际：${display2.end || '(空)'}`)
      }
      return true
    }

    const visibleDateInputs = [...item.querySelectorAll('.picker-item input.eds-react-input__input, .eds-react-date-picker input.eds-react-input__input')].filter(visible)
    if (visibleDateInputs.length >= 2) {
      if (startDt) await pickDateTimeViaPanel(item, 'start', startDt)
      if (endDt)   await pickDateTimeViaPanel(item, 'end', endDt)
      try { document.body.click() } catch {}
      await sleep(300)
      if (startDt && !norm(visibleDateInputs[0].value).includes(startDt.str)) {
        throw new Error(`领取期限开始时间未写入成功，期望：${startDt.str}，实际：${visibleDateInputs[0].value || '(空)'}`)
      }
      if (endDt && !norm(visibleDateInputs[1].value).includes(endDt.str)) {
        throw new Error(`领取期限结束时间未写入成功，期望：${endDt.str}，实际：${visibleDateInputs[1].value || '(空)'}`)
      }
      return true
    }

    const inputs = getTextInputs(item)
    if (inputs.length < 2) throw new Error(`领取期限 input 数量不足: ${inputs.length}`)
    if (startDt) await fillDatetimePicker(inputs[0], startDt)
    if (endDt)   await fillDatetimePicker(inputs[1], endDt)
    try { document.body.click() } catch {}
    await sleep(200)
    if (startDt && !norm(inputs[0].value).includes(startDt.str)) {
      throw new Error(`领取期限开始时间未写入成功，期望：${startDt.str}，实际：${inputs[0].value || '(空)'}`)
    }
    if (endDt && !norm(inputs[1].value).includes(endDt.str)) {
      throw new Error(`领取期限结束时间未写入成功，期望：${endDt.str}，实际：${inputs[1].value || '(空)'}`)
    }
    return true
  }

  // ─── 提前显示优惠券 checkbox ──────────────────────────────────────────────────
  async function setShowEarly(desired) {
    // 找含"提前显示优惠券"文本的 label 或 checkbox 容器
    const target = [...document.querySelectorAll('label, .eds-react-checkbox')].find(el => {
      return visible(el) && textOf(el).includes('提前显示优惠券')
    })
    if (!target) {
      if (location.href.includes('/portal/marketing/follow-prize/new')) return false
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
        try { props?.onChange?.({ target: cb, currentTarget: cb, nativeEvent: { target: cb } }) } catch {}
        try { props?.onClick?.({ target: cb, currentTarget: cb, preventDefault(){}, stopPropagation(){} }) } catch {}
      }
      if (isChecked() !== !!desired) {
        try { click(target) } catch {}
      }
      await sleep(200)
    }
    if (isChecked() !== !!desired) {
      throw new Error(`提前显示优惠券勾选状态不符合预期，期望：${!!desired}，实际：${isChecked()}`)
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
    const desired = String(text || '').trim()
    const keys = (aliases[desired] || [desired]).map(s => s.toLowerCase())

    const item = getFormItem('折扣类型 | 优惠限额') || getFormItem('折扣类型')
    if (!item) throw new Error('未找到折扣类型表单项')

    const findOption = () => [...document.querySelectorAll('.eds-react-select-option, .eds-option')].find(el => {
      const t = textOf(el).toLowerCase()
      return keys.some(k => t === k || t.includes(k))
    }) || null

    // 优先直接点击 DOM 中已渲染的选项（即使 popover hidden 也可生效）
    let option = findOption()
    if (option) {
      click(option)
      await sleep(300)
      const selectedText = textOf(item.querySelector('.eds-react-select__inner, .eds-selector, .trigger.trigger--normal'))
      if (keys.some(k => selectedText.toLowerCase() === k || selectedText.toLowerCase().includes(k))) {
        return selectedText
      }
    }

    const trigger = item.querySelector('.trigger.trigger--normal, .eds-selector')
    if (!trigger || !visible(trigger)) throw new Error('未找到折扣类型下拉触发器')

    trigger.scrollIntoView({ block: 'center' })
    await sleep(100)
    const selectorComp = trigger.__vueParentComponent || null
    if (selectorComp?.ctx?.handlerClick && typeof selectorComp.ctx.handlerClick === 'function') {
      try { selectorComp.ctx.handlerClick() } catch {}
    }
    const props = reactPropsOf(trigger)
    try { props?.onMouseDown?.({ button: 0, buttons: 1, preventDefault(){}, stopPropagation(){}, currentTarget: trigger, target: trigger, nativeEvent: { button: 0, buttons: 1 } }) } catch {}
    try { props?.onClick?.({ preventDefault(){}, stopPropagation(){}, currentTarget: trigger, target: trigger }) } catch {}
    for (const evtName of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      try {
        trigger.dispatchEvent(new MouseEvent(evtName, { bubbles: true, cancelable: true, view: window, buttons: 1 }))
      } catch (_) {}
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
    if (!option) throw new Error(`未找到折扣类型选项：${text}（可选：${options.map(o=>textOf(o)).join('/')}）`)
    click(option)
    await sleep(300)

    const selectedText = textOf(item.querySelector('.eds-react-select__inner, .eds-selector, .trigger.trigger--normal'))
    if (!keys.some(k => selectedText.toLowerCase() === k || selectedText.toLowerCase().includes(k))) {
      throw new Error(`折扣类型选择失败，期望：${text}，实际：${selectedText || '(空)'}`)
    }
    return selectedText
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
    for (const lbl of ['最高优惠金额', '最高折扣金额', '最高优惠', '最高减免', '最高上限数额']) {
      const item = getFormItem(lbl)
      if (!item) continue

      // 若是 radio 结构，先切到“设置金额”
      const setAmount = [...item.querySelectorAll('label, .eds-react-radio__label, span')].find(el => {
        return visible(el) && textOf(el).includes('设置金额')
      })
      if (setAmount) {
        click(setAmount.closest('label') || setAmount)
        await sleep(300)
      }

      // 优先在当前 item 内找输入框
      let inp = await waitFor(() => getTextInputs(item).find(el => visible(el)) || null, 1500, 120)

      // 某些 Shopee 布局会在切换 radio 后，把金额输入框渲染到 item 邻近区域
      if (!inp) {
        const scope = item.parentElement || document
        inp = [...scope.querySelectorAll('input:not([type=radio]):not([type=checkbox]), textarea')]
          .filter(visible)
          .find(el => {
            const wrapText = textOf(el.closest('.eds-react-input, .eds-react-form-item, .eds-react-form-item__control, div'))
            return /最高优惠金额|最高折扣金额|最高优惠|最高减免|最高上限数额|设置金额/.test(wrapText)
          }) || null
      }

      if (!inp) {
        // 最后兜底：找紧随当前 item 之后的第一个可见文本输入框
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

  async function ensureVoucherEntryVisible(voucherType) {
    const meta = getVoucherEntryMeta(voucherType)
    if (!meta.testId) throw new Error(`未配置优惠券入口：${voucherType}`)
    await ensureBuyerEntries(meta.testId).catch(() => null)

    let card = document.querySelector(`button[data-testid="${meta.testId}"]`)
    if (card && visible(card)) return card

    card = [...document.querySelectorAll('button[data-testid^="voucherEntry"]')].find(el => {
      if (!visible(el)) return false
      const t = textOf(el)
      return meta.aliases.some(a => t.includes(a))
    }) || null
    if (!card) throw new Error(`未找到优惠券入口卡片：${voucherType}`)
    return card
  }

  async function openCreatePageFromListAndPrimeForm(ctx) {
    const card = await ensureVoucherEntryVisible(ctx.voucherType)
    const createBtn = [...card.querySelectorAll('button')].find(el => visible(el) && /^(创建|去创建)$/.test(textOf(el))) || card
    click(createBtn)

    const formReady = await waitFor(() => {
      const href = location.href || ''
      const onVoucherNew = href.includes('/portal/marketing/vouchers/new')
      const onFollowPrizeNew = href.includes('/portal/marketing/follow-prize/new')
      if (!onVoucherNew && !onFollowPrizeNew) return null
      const item = getFormItem(['优惠券名称'])
      return item && visible(item) ? item : null
    }, 12000, 200)
    if (!formReady) {
      throw new Error(`点击创建后未进入可填写表单，当前URL：${location.href.substring(0,100)}`)
    }

    updateProgress(ctx, 'enter_type', '进行中', { '下一阶段': 'form_fill' })
    await sleep(200)
    await fillField('优惠券名称', ctx.couponName)
    try { await fillField('优惠码', ctx.couponCode) } catch {}
    updateProgress(ctx, 'form_fill', '进行中')
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
    const usecase = getUsecaseByVoucherType(voucherType)
    const result = shared.result || {
      '序号': page, '队列总数': rows.length, '站点': site, '店铺': store, '优惠券品类': voucherType,
      '奖励类型': rewardType, '折扣类型': discountType, '优惠限额': discountLimit,
      '生成优惠券名称': couponName, '生成优惠码': couponCode, 'usecase': usecase,
      '当前阶段': 'main', '当前URL': location.href || '',
      '下一阶段': '',
      '执行状态': '待执行', '错误原因': ''
    }
    return { store, site, voucherType, rewardType, discountType, discountLimit,
             maxDiscount, minSpend, totalCount, perBuyer, showEarly,
             startDt, endDt, couponName, couponCode, usecase, result }
  }

  function updateProgress(ctx, stage, status = '进行中', extras = {}) {
    if (!ctx || !ctx.result) return ctx
    ctx.result['当前阶段'] = stage
    ctx.result['当前URL'] = location.href || ''
    ctx.result['执行状态'] = status
    for (const [k, v] of Object.entries(extras || {})) ctx.result[k] = v
    return ctx
  }

  function nextPhase(np, ctx, sleepMs = 1200, extras = {}) {
    if (ctx?.result) {
      ctx.result['当前URL'] = location.href || ''
      ctx.result['下一阶段'] = np
    }
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

  function isResumeRun() {
    return !!(shared && (shared.couponCode || shared.couponName || shared.result))
  }

  function hasCreateFormMounted() {
    return !!getFormItem(['优惠券名称'])
  }

  function isOnCreatePage() {
    return location.href.includes('/portal/marketing/vouchers/new') ||
           location.href.includes('/portal/marketing/follow-prize/new') ||
           hasCreateFormMounted()
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

  function getVoucherEntryMeta(voucherType) {
    const map = {
      '商店优惠券': { testId: 'voucherEntry1', aliases: ['商店优惠券'] },
      '新买家优惠券': { testId: 'voucherEntry3', aliases: ['新买家优惠券', '新买家'] },
      '回购买家优惠券': { testId: 'voucherEntry4', aliases: ['回购买家优惠券', '回购'] },
      '关注礼优惠券': { testId: 'voucherEntry999', aliases: ['关注礼优惠券', '关注礼'] },
    }
    return map[voucherType] || { testId: '', aliases: [voucherType] }
  }

  function buildVouchersListUrl() {
    const u = new URL('https://seller.shopee.cn/portal/marketing/vouchers/list')
    try {
      const cur = new URL(location.href)
      const shopId = cur.searchParams.get('cnsc_shop_id')
      if (shopId) u.searchParams.set('cnsc_shop_id', shopId)
    } catch {}
    return u.toString()
  }

  function buildCreateUrl(voucherType) {
    const usecase = getUsecaseByVoucherType(voucherType)
    if (!usecase) throw new Error(`未配置 usecase：${voucherType}`)
    const base = usecase === '999'
      ? 'https://seller.shopee.cn/portal/marketing/follow-prize/new'
      : 'https://seller.shopee.cn/portal/marketing/vouchers/new'
    const u = new URL(base)
    if (usecase !== '999') u.searchParams.set('usecase', usecase)
    try {
      const cur = new URL(location.href)
      const shopId = cur.searchParams.get('cnsc_shop_id')
      if (shopId) u.searchParams.set('cnsc_shop_id', shopId)
    } catch {}
    return u.toString()
  }

  function finish(result, error = '') {
    const out = { ...(result || {}) }
    out['当前URL'] = location.href || out['当前URL'] || ''
    out['下一阶段'] = ''
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
      updateProgress(ctx, 'main', '进行中')
      if (isResumeRun() && isOnCreatePage()) {
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
      updateProgress(ctx, 'store_switch', '进行中')
      // 只有同一条记录的续跑才允许直接复用已打开的创建页
      if (isResumeRun() && isOnCreatePage()) {
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

      // 店铺已匹配，进入优惠券列表页，后续从真实"创建"按钮进入
      if (!location.href.includes('/portal/marketing/vouchers/list')) {
        location.href = buildVouchersListUrl()
        return nextPhase('enter_type', ctx, 3000)
      }
      return nextPhase('enter_type', ctx, 200)
    }

    // ── enter_type ───────────────────────────────────────────────────────────
    // 从列表页真实入口卡片的"创建"按钮进入，并在同一次 evaluate 内等待表单挂载
    if (phase === 'enter_type') {
      updateProgress(ctx, 'enter_type', '进行中')
      if (!location.href.includes('/portal/marketing/vouchers/list') && !isOnCreatePage()) {
        location.href = buildVouchersListUrl()
        return nextPhase('enter_type', ctx, 3000)
      }
      if (isOnCreatePage()) {
        return nextPhase('form_fill', ctx, 80)
      }
      if (ctx.usecase === '999') {
        location.href = buildCreateUrl(ctx.voucherType)
        return nextPhase('enter_type', ctx, 3000)
      }
      await openCreatePageFromListAndPrimeForm(ctx)
      return nextPhase('form_fill', ctx, 80)
    }

    // ── await_create_page ────────────────────────────────────────────────────
    // 兼容旧 phase：统一回到 enter_type 使用真实入口重新进入
    if (phase === 'await_create_page') {
      updateProgress(ctx, 'await_create_page', '进行中')
      return nextPhase('enter_type', ctx, 80)
    }

    // ── form_fill ────────────────────────────────────────────────────────────
    if (phase === 'form_fill') {
      updateProgress(ctx, 'form_fill', '进行中')
      // enter_type 已经在同一次 evaluate 中填过前两个关键字段，这里只做兜底与剩余字段填写
      const formReady = await waitFor(() => getFormItem(['优惠券名称']) || null, 10000, 400)
      if (!formReady) throw new Error(`创建表单未出现，当前URL：${location.href.substring(0,100)}`)
      await sleep(300)

      // 兜底：若前一阶段未成功填入，则再次填写
      try { await fillField('优惠券名称', ctx.couponName) } catch {}
      try { await fillField('优惠码', ctx.couponCode) } catch {}

      // 3. 领取期限 —— 需要 CDP 真实鼠标点击，拆成独立 phase
      if (ctx.startDt || ctx.endDt) {
        const item = getFormItem(['优惠券领取期限', 'Claim Period'])
        if (item && item.querySelector('.picker-item.start-picker, .eds-react-date-picker__input')) {
          // 先处理 start
          if (ctx.startDt) {
            const cdpMeta = await pickDateTimeViaPanel(item, 'start', ctx.startDt)
            // pickDateTimeViaPanel 返回 cdp_clicks meta，直接透传给 runner
            return cdpMeta
          }
          // 没有 startDt，直接跳到 form_fill_end_date
          return nextPhase('form_fill_end_date', ctx, 80)
        }
        // 走 Vue DateRangePicker 路径（关注礼等），不需要 CDP 点击
        await setDateRange(ctx.startDt, ctx.endDt)
      }

      // 有 start 无 end 的情况，或跳过日期直接填剩余字段
      return nextPhase('form_fill_rest', ctx, 80)
    }

    // ── pick_date_nav_start / pick_date_nav_end ─────────────────────────────
    // 箭头点完后（panel 已在目标年月），计算 cell/hour/minute/确认坐标，返回第二批 cdp_clicks
    if (phase === 'pick_date_nav_start' || phase === 'pick_date_nav_end') {
      await sleep(300)
      const kind = phase === 'pick_date_nav_start' ? 'start' : 'end'
      const kindLabel = kind === 'start' ? '开始' : '结束'
      const item = getFormItem(['优惠券领取期限', 'Claim Period'])
      if (!item) throw new Error(`未找到${kindLabel}日期表单项`)
      const panel = await waitFor(() => getDatePickerPanel(item), 2000, 100)
      if (!panel) throw new Error(`${kindLabel}日期面板消失了`)

      // 验证年月已切换到位
      const hdr = getDatePickerHeader(panel)
      const saved = shared[`_pick_${kind}_target`]
      if (saved && hdr && (hdr.year !== saved.target.year || hdr.month !== saved.target.month)) {
        throw new Error(`${kindLabel}年月切换未到位：期望${saved.target.year}-${saved.target.month}，实际${hdr.year}-${hdr.month}`)
      }
      const target = saved ? saved.target : hdr
      const dtStr  = saved ? saved.dt : null

      // 找目标 cell
      const cells = [...panel.querySelectorAll('.eds-react-date-picker__table-cell')]
      const dayText = String(Number(target.day))
      const targetCell = cells.find(c =>
        norm(c.textContent) === dayText &&
        !c.classList.contains('out-of-range') &&
        !c.classList.contains('disabled')
      )
      if (!targetCell) throw new Error(`未找到目标日期 cell：${target.day}`)
      const cellCenter = rectCenter(targetCell)
      if (!cellCenter) throw new Error('目标 cell 坐标为空')

      // hour / minute
      const scrollbars = [...panel.querySelectorAll('.eds-react-time-picker__tp-scrollbar')].filter(visible)
      let hourCenter = null, minuteCenter = null
      if (scrollbars.length >= 2) {
        const hourBox   = [...scrollbars[0].querySelectorAll('.time-box')].find(el => visible(el) && textOf(el) === target.hour)
        const minuteBox = [...scrollbars[1].querySelectorAll('.time-box')].find(el => visible(el) && textOf(el) === target.minute)
        if (hourBox)   hourCenter   = rectCenter(hourBox)
        if (minuteBox) minuteCenter = rectCenter(minuteBox)
      }

      // 确认按钮
      const okBtn = [...panel.querySelectorAll('.eds-react-date-picker__btn-wrap button, button')]
        .find(b => /^(确认|确定|OK)$/i.test(textOf(b)) && visible(b))
      const okCenter = rectCenter(okBtn)
      if (!okCenter) throw new Error('未找到日期面板确认按钮')

      const clicks = [{ ...cellCenter, delay_ms: 350, label: `日期${target.day}` }]
      if (hourCenter)   clicks.push({ ...hourCenter,   delay_ms: 150, label: `小时${target.hour}` })
      if (minuteCenter) clicks.push({ ...minuteCenter, delay_ms: 150, label: `分钟${target.minute}` })
      clicks.push({ ...okCenter, delay_ms: 350, label: '确认' })

      const verifyPhase = `pick_date_verify_${kind}`
      const ctxForShared = { couponName: shared.couponName, couponCode: shared.couponCode, result: shared.result }
      return nextCdpClickPhase(clicks, verifyPhase, 400, ctxForShared)
    }

    // ── pick_date_verify_start（CDP 点击完 start 日期后，验证并继续 end）───────
    if (phase === 'pick_date_verify_start') {
      await sleep(200)
      const item = getFormItem(['优惠券领取期限', 'Claim Period'])
      const startInput = item?.querySelector('.picker-item.start-picker input.eds-react-input__input')
      const startVal = norm(startInput?.value || '')
      if (ctx.startDt && !startVal.includes(ctx.startDt.str)) {
        // 写入失败，记录实际值但不中断，继续尝试 end
        updateProgress(ctx, 'form_fill', '进行中', { 'start_date_actual': startVal, 'start_date_expected': ctx.startDt.str })
      }
      // 继续处理 end
      if (ctx.endDt && item) {
        const cdpMeta = await pickDateTimeViaPanel(item, 'end', ctx.endDt)
        return cdpMeta
      }
      return nextPhase('form_fill_rest', ctx, 80)
    }

    // ── pick_date_verify_end（CDP 点击完 end 日期后，验证并继续剩余表单）────────
    if (phase === 'pick_date_verify_end') {
      await sleep(200)
      const item = getFormItem(['优惠券领取期限', 'Claim Period'])
      const inputs = [...(item?.querySelectorAll('input.eds-react-input__input') || [])].filter(visible)
      const startVal = norm(inputs[0]?.value || '')
      const endVal   = norm(inputs[1]?.value || '')
      if (ctx.startDt && !startVal.includes(ctx.startDt.str)) {
        throw new Error(`领取期限开始时间未写入成功，期望：${ctx.startDt.str}，实际：${startVal || '(空)'}`)
      }
      if (ctx.endDt && !endVal.includes(ctx.endDt.str)) {
        throw new Error(`领取期限结束时间未写入成功，期望：${ctx.endDt.str}，实际：${endVal || '(空)'}`)
      }
      return nextPhase('form_fill_rest', ctx, 80)
    }

    // ── form_fill_end_date（只有 endDt，跳过了 start，直接处理 end）────────────
    if (phase === 'form_fill_end_date') {
      const item = getFormItem(['优惠券领取期限', 'Claim Period'])
      if (ctx.endDt && item) {
        const cdpMeta = await pickDateTimeViaPanel(item, 'end', ctx.endDt)
        return cdpMeta
      }
      return nextPhase('form_fill_rest', ctx, 80)
    }

    // ── form_fill_rest（日期填完后继续其他字段）──────────────────────────────
    if (phase === 'form_fill_rest') {
      // 4. 提前显示
      await setShowEarly(ctx.showEarly)

      // 5. 奖励类型
      if (ctx.rewardType) await setRewardType(ctx.rewardType)

      // 6. 折扣类型（下拉）
      let actualDiscountType = ctx.discountType
      if (ctx.discountType) actualDiscountType = await setDiscountType(ctx.discountType)

      // 7. 优惠限额
      if (ctx.discountLimit) {
        const limitValue = discountLimitValue(ctx.discountLimit, actualDiscountType || ctx.discountType)
        await fillDiscountLimit(limitValue)
      }

      // 8. 最高优惠金额
      if (ctx.maxDiscount) await fillMaxDiscount(ctx.maxDiscount)

      // 9. 最低消费金额
      if (ctx.minSpend) {
        const item = getFormItem('最低消费金额')
        if (item) { const inp = getTextInputs(item)[0]; if (inp) await typeInto(inp, String(toNumber(ctx.minSpend))) }
      }

      // 10. 可使用总数
      if (ctx.totalCount) {
        const item = getFormItem(['可使用总数', '优惠券可使用总数'])
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
      updateProgress(ctx, 'submit', '进行中')
      const allBtns = [...document.querySelectorAll('button')].filter(visible)
      const actionBtns = allBtns.filter(el => {
        const t = textOf(el)
        if (!/^(确认|确定)$/.test(t)) return false
        if (/取消|预览|关闭/.test(t)) return false
        const scopeText = textOf(el.closest('form, .footer, .page-footer, .voucher-footer, .footer-actions, .button-group, .actions, .eds-sticky, .sticky-footer, .footer-container'))
        return /确认|确定/.test(scopeText) || (el.className || '').includes('primary')
      })
      const confirmBtn =
        actionBtns.find(el => (el.className || '').includes('primary')) ||
        actionBtns[0] ||
        allBtns.find(el => /^(确认|确定)$/.test(textOf(el)) && (el.className || '').includes('primary')) ||
        allBtns.find(el => /^(确认|确定)$/.test(textOf(el)))

      if (!confirmBtn) throw new Error('未找到"确认"按钮')
      click(confirmBtn)
      return nextPhase('post_submit', ctx, 3500)
    }

    // ── post_submit ──────────────────────────────────────────────────────────
    if (phase === 'post_submit') {
      updateProgress(ctx, 'post_submit', '进行中')
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