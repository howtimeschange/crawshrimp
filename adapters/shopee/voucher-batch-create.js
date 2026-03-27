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
                      'jan':1,'feb':2,'mar':3,'apr':4,'may':5,'jun':6,
                      'jul':7,'aug':8,'sep':9,'oct':10,'nov':11,'dec':12,
                      '一月':1,'二月':2,'三月':3,'四月':4,'五月':5,'六月':6,
                      '七月':7,'八月':8,'九月':9,'十月':10,'十一月':11,'十二月':12 }

  function getDatePickerHeader(panel) {
    if (!panel) return null
    const headerEl = panel.querySelector('.eds-react-date-picker__header, .date-box, .date-default-style')
    if (!headerEl) return null
    
    // 很多时候 year 和 month 被包在单独的 span/button 里
    const texts = [...headerEl.querySelectorAll('button, span, i')]
      .filter(visible)
      .map(el => textOf(el))
      .filter(t => t.length > 0)
      
    // 也能整体当作一句 text
    const headerText = textOf(headerEl)
    
    let year = null, month = null
    
    // 1. 尝试从分块文本提取
    for (const t of texts) {
      if (/^\d{4}年?$/.test(t)) year = Number(t.replace('年', ''))
      else if (/^\d{1,2}月$/.test(t)) month = Number(t.replace('月', ''))
      else {
        const enMatch = t.match(/([A-Za-z]+)/)
        if (enMatch && MONTH_MAP[enMatch[1].toLowerCase()]) {
          month = MONTH_MAP[enMatch[1].toLowerCase()]
        }
      }
    }
    
    // 2. 备用：从整体文本提取
    if (!year) {
      const ym = headerText.match(/(\d{4})/)
      if (ym) year = Number(ym[1])
    }
    if (!month) {
      // 中文 3月
      const mm = headerText.match(/(\d{1,2})\s*月/)
      if (mm) month = Number(mm[1])
      else {
        const enMatch = headerText.match(/([A-Za-z]+)/)
        if (enMatch && MONTH_MAP[enMatch[1].toLowerCase()]) {
          month = MONTH_MAP[enMatch[1].toLowerCase()]
        }
      }
    }
    
    if (year && month && month >= 1 && month <= 12) return { year, month }
    return null
  }

  /**
   * 找月份导航按钮和年份选择按钮。
   * 月份导航：面板 header 区域内宽 < 80px 的可点击元素（按钮或 SVG 箭头）
   * 年份选择：标有年份数字的可点击元素
   * 返回 { prevMonth, nextMonth, yearPicker }
   */
  /**
   * 找月份导航按钮和年份选择器。
   *
   * 导航按钮结构（根据真实 DOM 确认）：
   *   <div class="btn-arrow-default double"> << </div>   ← prevYear  (x 最左)
   *   <div class="btn-arrow-default">        <       </div>   ← prevMonth
   *   <div class="btn-arrow-default">        >       </div>   ← nextMonth
   *   <div class="btn-arrow-default double"> >> </div>   ← nextYear (x 最右)
   *
   * 年份选择器：<span class="date-default-style year">2028年</span>
   * 点击该 span 打开年份下拉列表
   */
  function getPickerNavButtons(panel) {
    if (!panel) return {}
    const header = panel.querySelector('.eds-react-date-picker__header')
    if (!header) return {}

    // 找 .btn-arrow-default div（可点击容器，内含 SVG），按 x 坐标从左到右排序
    const allArrowDivs = [...header.querySelectorAll('.btn-arrow-default')]
      .filter(b => {
        const r = b.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && visible(b)
      })
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)

    // allArrowDivs 从左到右：[prevYear, prevMonth, nextMonth, nextYear]
    let prevYear = null, prevMonth = null, nextMonth = null, nextYear = null
    if (allArrowDivs.length === 4) {
      [prevYear, prevMonth, nextMonth, nextYear] = allArrowDivs
    } else if (allArrowDivs.length === 2) {
      [prevMonth, nextMonth] = allArrowDivs
    } else if (allArrowDivs.length >= 3) {
      prevYear = allArrowDivs[0]
      nextYear = allArrowDivs[allArrowDivs.length - 1]
      prevMonth = allArrowDivs[Math.floor(allArrowDivs.length / 2 - 1)]
      nextMonth = allArrowDivs[Math.floor(allArrowDivs.length / 2)]
    }

    // 年份选择器：<span class="date-default-style year">2028年</span>
    const yearSpan = panel.querySelector('.date-default-style.year, [class*="date-default-style"][class*="year"]')
    const yearPicker = (yearSpan && visible(yearSpan)) ? yearSpan : null

    return { prevMonth, nextMonth, prevYear, nextYear, yearPicker }
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
        // 优先方案 1：年份 span 下拉（点击 span 打开下拉列表）
        if (nav.yearPicker) {
          click(nav.yearPicker)
          await sleep(300)
          const yearList = document.querySelector('.eds-react-select__dropdown-list, [class*="select-dropdown"], [class*="year-option"], [class*="picker-option"], [class*="option-list"]')
          if (yearList) {
            const yearOption = [...yearList.querySelectorAll('[class*="option"], li, div, [class*="year"]')].find(el => {
              const txt = textOf(el)
              return txt.trim() === String(target.year) && visible(el)
            })
            if (yearOption) {
              click(yearOption)
              await sleep(200)
              moved = true
            }
          }
          // 如果下拉是 input 类型（可编辑下拉）
          if (!moved) {
            const yearInput = document.querySelector('.eds-react-select__input, [class*="year"] input')
            if (yearInput) {
              click(yearInput)
              await sleep(100)
              setNativeValue(yearInput, String(target.year))
              await sleep(200)
              try { document.body.click() } catch {}
              await sleep(300)
              moved = true
            }
          }
        }
        // 优先方案 2：直接用 prevYear/nextYear 箭头按钮（4 箭头布局）
        if (!moved && (nav.prevYear || nav.nextYear)) {
          const delta = target.year - header.year
          const btn = delta < 0 ? nav.prevYear : nav.nextYear
          if (btn) {
            // 年份箭头每次跳转 1 年
            const steps = Math.abs(delta)
            for (let j = 0; j < Math.min(steps, 60); j++) {
              click(btn)
              await sleep(150)
              moved = true
            }
          }
        }
        // 最终 fallback：每月箭头 12 次跳转 1 年
        if (!moved) {
          const delta = target.year - header.year
          const btn = delta < 0 ? nav.prevMonth : nav.nextMonth
          if (btn) {
            const steps = Math.abs(delta) * 12 + (delta < 0 ? (12 - header.month + 1) : (target.month - header.month))
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

    // 找触发器 input — 多重 fallback 兼容不同 Shopee 页面
    const dateId = kind === 'start' ? 'startDate' : 'endDate'
    const trigger = (
      item.querySelector(`.picker-item.${kind}-picker input.eds-react-input__input`) ||
      item.querySelector(`.picker-item.${kind}-picker input.eds-react-date-picker__input`) ||
      item.querySelector(`.picker-item.${kind}-picker #${dateId}`) ||
      item.querySelector(`.picker-item.${kind}-picker input`) ||
      item.querySelector(`#${dateId}`) ||
      [...item.querySelectorAll('.eds-react-date-picker input, .eds-react-input input')].filter(visible)[kind === 'start' ? 0 : 1] ||
      null
    )
    if (!trigger) throw new Error(`未找到${kindLabel}日期触发器（选择器均未命中，item.innerHTML长度=${item?.innerHTML?.length}）`)

    try { trigger.scrollIntoView({ block: 'center' }) } catch {}
    await sleep(200)

    const triggerCenter = rectCenter(trigger)
    if (!triggerCenter) throw new Error(`${kindLabel}日期触发器坐标为空`)

    const clicks = [
      { ...triggerCenter, delay_ms: 100, label: `${kindLabel}触发器` }
    ]

    shared[`_pick_${kind}_target`] = { dt: dt.str, target }
    const ctxForShared = { couponName: shared.couponName, couponCode: shared.couponCode, result: shared.result }

    return nextCdpClickPhase(clicks, `pick_date_open_${kind}`, 400, ctxForShared)
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
      const curUrl = location.href || ''
      // 如果已经在营销中心的凭证相关页面（包括 /vouchers/list 或 /vouchers/new），
      // 不要重新跳转到营销中心主页，避免与 store_switch 形成 ping-pong 循环
      const onVoucherPage = curUrl.includes('/portal/marketing/vouchers')
      if (mode === 'new' || (!curUrl.startsWith(MARKETING_URL) && !onVoucherPage)) {
        location.href = MARKETING_URL
        return nextPhase('store_switch', ctx, 3000)
      }
      // 已在营销中心域内（包括凭证列表页），直接进入 store_switch 做店铺校验
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

      const curUrl = location.href || ''

      // 获取当前 URL 中的 shopId（从 vouchers/list 或营销中心主页的 ?cnsc_shop_id= 参数读取）
      function getUrlShopId() {
        try {
          const u = new URL(curUrl)
          return u.searchParams.get('cnsc_shop_id') || ''
        } catch { return '' }
      }

      // 从 DOM 读取当前显示的店铺名
      function getStoreText() {
        const el = document.querySelector('.shop-switcher, .shop-switcher-container, .shop-select, .shop-info, .shop-label')
        if (el && visible(el)) return textOf(el.closest('.shop-info') || el.parentElement || el)
        const all = [...document.querySelectorAll('div, span')].filter(e => visible(e) && textOf(e).startsWith('当前店铺'))
        return all.length ? textOf(all[0]) : ''
      }

      const storeText = getStoreText()
      // matched 基于 DOM 显示的店铺名判断（DOM 更可靠，URL 可能未更新）
      const matched = storeText.includes(ctx.store) && (!ctx.site || storeText.includes(ctx.site))

      // 如果当前不在 /portal/marketing 域，先导航到营销中心主页
      if (!curUrl.includes('/portal/marketing')) {
        location.href = MARKETING_URL
        return nextPhase('store_switch', ctx, 3000)
      }

      // 已在营销中心域（包括 vouchers/list）。如果店铺已匹配，不需要搜索切换。
      if (matched) {
        // 已在本店凭证列表页，直接进入 enter_type
        if (curUrl.includes('/portal/marketing/vouchers/list')) {
          return nextPhase('enter_type', ctx, 200)
        }
        // 已在本店但不在凭证列表页，导航过去
        location.href = buildVouchersListUrl()
        return nextPhase('enter_type', ctx, 3000)
      }

      // 店铺未匹配：需要搜索切换。
      // 注意：此时页面可能在 vouchers/list（错误的店铺），也可能刚导航到新的店铺，需要用 DOM 确认
      const currentStoreText = getStoreText()
      const nowMatched = currentStoreText.includes(ctx.store) && (!ctx.site || currentStoreText.includes(ctx.site))
      if (nowMatched) {
        // 切换完成，直接进入凭证列表
        if (!curUrl.includes('/portal/marketing/vouchers/list')) {
          location.href = buildVouchersListUrl()
          return nextPhase('enter_type', ctx, 3000)
        }
        return nextPhase('enter_type', ctx, 200)
      }

      // 确实需要搜索切换。找搜索框
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

      // 店铺已切换，进入优惠券列表页
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
      // 如果已经在创建页，直接进入表单填写
      if (isOnCreatePage()) {
        return nextPhase('form_fill', ctx, 80)
      }
      // 不在凭证列表页，先导航到列表页
      if (!location.href.includes('/portal/marketing/vouchers/list')) {
        location.href = buildVouchersListUrl()
        return nextPhase('enter_type', ctx, 3000)
      }
      // 在凭证列表页
      // 关注礼优惠券（usecase=999）没有标准入口卡片，需要直接构建 URL 跳转。
      // 为避免当前 URL 中 shopId 不正确，先导航到营销中心主页（主页 URL 会带正确 shopId）再跳转。
      if (ctx.usecase === '999') {
        location.href = MARKETING_URL
        return nextPhase('follow_prize_nav', ctx, 2000)
      }
      await openCreatePageFromListAndPrimeForm(ctx)
      return nextPhase('form_fill', ctx, 80)
    }

    // ── follow_prize_nav ─────────────────────────────────────────────────────
    // 关注礼：从营销中心主页拿到正确 shopId 后，再跳转到 follow-prize/new
    if (phase === 'follow_prize_nav') {
      updateProgress(ctx, 'follow_prize_nav', '进行中')
      if (isOnCreatePage()) {
        return nextPhase('form_fill', ctx, 80)
      }
      location.href = buildCreateUrl(ctx.voucherType)
      return nextPhase('enter_type', ctx, 3000)
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
      return nextPhase('form_fill_rest', { ...ctx, _datesChecked: true }, 80)
    }

    // ── submit_form ═══════════════════════════════════════════════════════════════════════
    //  多阶段日期选择状态机（每 CDP click 之后重新进入 phase，重新读 DOM）
    //  流程：open → nav(循环) → day → time → confirm → verify
    // ═══════════════════════════════════════════════════════════════════════

    // ── pick_date_open_{kind}：点击触发器打开面板 ────────────────────────
    if (phase === 'pick_date_open_start' || phase === 'pick_date_open_end') {
      await sleep(600)
      const kind = phase.includes('start') ? 'start' : 'end'
      const kindLabel = kind === 'start' ? '开始' : '结束'
      const item = getFormItem(['优惠券领取期限', 'Claim Period'])
      if (!item) throw new Error(`${kindLabel}日期表单项`)
      const saved = shared[`_pick_${kind}_target`]
      if (!saved) throw new Error(`丢失 ${kind} 目标日期数据`)
      const target = saved.target
      console.log(`[DATE] ${kindLabel}日期目标: ${target.year}-${target.month}-${target.day} ${target.hour}:${target.minute}`)

      // 触发器 CDP click
      const trigger = (
        item.querySelector(`.picker-item.${kind}-picker input.eds-react-input__input`) ||
        item.querySelector(`.picker-item.${kind}-picker input`) ||
        [...item.querySelectorAll('.eds-react-date-picker input, .eds-react-input input')].filter(visible)[kind === 'start' ? 0 : 1] ||
        null
      )
      if (!trigger) throw new Error(`未找到${kindLabel}日期触发器`)
      const tc = rectCenter(trigger)
      if (!tc) throw new Error(`${kindLabel}触发器坐标为空`)
      console.log(`[DATE] 触发器 clicked，切换到 nav`)
      return nextCdpClickPhase([{ ...tc, delay_ms: 100, label: `${kindLabel}触发器` }],
        `pick_date_nav_${kind}`, 500)
    }

    // ── pick_date_nav_{kind}：逐月导航（> 和 < 可跨年），年份不同优先用年份箭头 ───
    if (phase === 'pick_date_nav_start' || phase === 'pick_date_nav_end') {
      const kind = phase.includes('start') ? 'start' : 'end'
      const kindLabel = kind === 'start' ? '开始' : '结束'
      const item = getFormItem(['优惠券领取期限', 'Claim Period'])
      if (!item) throw new Error(`${kindLabel}日期表单项`)
      const saved = shared[`_pick_${kind}_target`]
      if (!saved) throw new Error(`丢失 ${kind} 目标日期数据`)
      const target = saved.target

      const panel = getDatePickerPanel(item)
      if (!panel) {
        console.log(`[DATE] 面板未找到，重新触发`)
        const trigger = item.querySelector(`.picker-item.${kind}-picker input`)
        if (trigger) {
          const tc = rectCenter(trigger)
          if (tc) return nextCdpClickPhase([{ ...tc, delay_ms: 200, label: '重新触发' }], phase, 500)
        }
        throw new Error(`${kindLabel}日期面板消失`)
      }

      const header = getDatePickerHeader(panel)
      if (!header) {
        console.log(`[DATE] 无法读取 header，等待后重试`)
        return nextCdpClickPhase([], phase, 500)
      }
      console.log(`[DATE] 当前: ${header.year}-${header.month}，目标: ${target.year}-${target.month}`)

      if (header.year === target.year && header.month === target.month) {
        console.log(`[DATE] 年月匹配，进入 day 选择`)
        return nextCdpClickPhase([], `pick_date_day_${kind}`, 300)
      }

      const nav = getPickerNavButtons(panel)
      const deltaY = target.year - header.year
      const deltaM = target.month - header.month

      // 直接用 prevMonth / nextMonth（可跨年）：逐月前进/后退直到目标年月
      const totalClicks = deltaY * 12 + deltaM
      const btn = totalClicks >= 0 ? nav.nextMonth : nav.prevMonth
      if (!btn) throw new Error(`${kindLabel}日期导航按钮未找到（prevMonth=${!!nav.prevMonth}）`)
      const bc = rectCenter(btn)
      if (!bc) throw new Error(`${kindLabel}导航按钮坐标为空`)
      console.log(`[DATE] 月份导航（${totalClicks >= 0 ? '>' : '<'}），总差: ${totalClicks} 次`)
      return nextCdpClickPhase([{ ...bc, delay_ms: 200, label: '月份导航' }], phase, 100)
    }

    // ── pick_date_day_{kind}：点击日期格 ──────────────────────────────────
    if (phase === 'pick_date_day_start' || phase === 'pick_date_day_end') {
      const kind = phase.includes('start') ? 'start' : 'end'
      const kindLabel = kind === 'start' ? '开始' : '结束'
      const item = getFormItem(['优惠券领取期限', 'Claim Period'])
      if (!item) throw new Error(`${kindLabel}日期表单项`)
      const saved = shared[`_pick_${kind}_target`]
      if (!saved) throw new Error(`丢失 ${kind} 目标日期数据`)
      const target = saved.target

      const panel = getDatePickerPanel(item)
      if (!panel) throw new Error(`${kindLabel}日期面板消失`)

      const header = getDatePickerHeader(panel)
      if (header && (header.year !== target.year || header.month !== target.month)) {
        console.log(`[DATE] 年月不匹配，退回 nav`)
        return nextCdpClickPhase([], `pick_date_nav_${kind}`, 200)
      }

      const cells = [...panel.querySelectorAll('.eds-react-date-picker__table-cell')]
      const targetCell = cells.find(c =>
        norm(c.textContent) === String(Number(target.day)) &&
        !/disabled|out-of-range/.test(c.className || '')
      )
      if (!targetCell) throw new Error(`未找到目标日期 cell：${target.day}`)
      const cc = rectCenter(targetCell)
      if (!cc) throw new Error('目标 cell 坐标为空')
      console.log(`[DATE] 点击日期格 ${target.day}`)
      return nextCdpClickPhase([{ ...cc, delay_ms: 200, label: `日期${target.day}` }],
        `pick_date_time_${kind}`, 100)
    }

    // ── pick_date_time_{kind}：选择时分 ─────────────────────────────────
    if (phase === 'pick_date_time_start' || phase === 'pick_date_time_end') {
      const kind = phase.includes('start') ? 'start' : 'end'
      const kindLabel = kind === 'start' ? '开始' : '结束'
      const item = getFormItem(['优惠券领取期限', 'Claim Period'])
      if (!item) throw new Error(`${kindLabel}日期表单项`)
      const saved = shared[`_pick_${kind}_target`]
      if (!saved) throw new Error(`丢失 ${kind} 目标日期数据`)
      const target = saved.target

      const panel = getDatePickerPanel(item)
      const clicks = []
      if (panel) {
        const scrollbars = [...panel.querySelectorAll('.eds-react-time-picker__tp-scrollbar')].filter(visible)
        if (scrollbars.length >= 2) {
          const hourBox = [...scrollbars[0].querySelectorAll('.time-box')]
            .find(el => visible(el) && norm(el.textContent) === target.hour)
          const minBox = [...scrollbars[1].querySelectorAll('.time-box')]
            .find(el => visible(el) && norm(el.textContent) === target.minute)
          if (hourBox) { const c = rectCenter(hourBox); if (c) clicks.push({ ...c, delay_ms: 150, label: `小时${target.hour}` }) }
          if (minBox)  { const c = rectCenter(minBox);  if (c) clicks.push({ ...c, delay_ms: 150, label: `分钟${target.minute}` }) }
        }
      }
      console.log(`[DATE] 时分 clicks: ${clicks.length} 个`)
      return nextCdpClickPhase(clicks, `pick_date_confirm_${kind}`, 100)
    }

    // ── pick_date_confirm_{kind}：点确认 ─────────────────────────────────
    if (phase === 'pick_date_confirm_start' || phase === 'pick_date_confirm_end') {
      const kind = phase.includes('start') ? 'start' : 'end'
      const kindLabel = kind === 'start' ? '开始' : '结束'
      const item = getFormItem(['优惠券领取期限', 'Claim Period'])
      if (!item) throw new Error(`${kindLabel}日期表单项`)

      const panel = getDatePickerPanel(item)
      if (!panel) {
        console.log(`[DATE] 面板已关闭，直接验证`)
        return nextCdpClickPhase([], `pick_date_verify_${kind}`, 300)
      }

      const okBtn = [...panel.querySelectorAll('button')]
        .find(b => /^确认$|^确定$|^OK$/i.test(norm(b.textContent)) && visible(b))
      if (!okBtn) {
        console.log(`[DATE] 未找到确认按钮，点击空白关闭`)
        const bodyC = rectCenter(document.body)
        if (bodyC) {
          return nextCdpClickPhase([{ ...bodyC, delay_ms: 300, label: '点击空白' }],
            `pick_date_verify_${kind}`, 200)
        }
        throw new Error(`${kindLabel}日期确认按钮未找到`)
      }
      const oc = rectCenter(okBtn)
      if (!oc) throw new Error(`${kindLabel}确认按钮坐标为空`)
      console.log(`[DATE] 点击确认按钮`)
      return nextCdpClickPhase([{ ...oc, delay_ms: 400, label: '确认' }],
        `pick_date_verify_${kind}`, 400)
    }

    // ── pick_date_verify_{kind}：验证日期已写入 ─────────────────────────
    if (phase === 'pick_date_verify_start') {
      await sleep(300)
      const item = getFormItem(['优惠券领取期限', 'Claim Period'])
      const startInput = item?.querySelector('.picker-item.start-picker input.eds-react-input__input')
      const startVal = norm(startInput?.value || '')
      console.log(`[DATE] verify_start: 期望「${ctx.startDt?.str}」，实际「${startVal}」`)
      if (!startVal.includes(ctx.startDt?.str)) {
        throw new Error(`领取期限开始时间未写入成功，期望：${ctx.startDt?.str}，实际：${startVal || '(空)'}`)
      }
      if (ctx.endDt && item) {
        const cdpMeta = await pickDateTimeViaPanel(item, 'end', ctx.endDt)
        return cdpMeta
      }
      return nextPhase('form_fill_rest', ctx, 80)
    }

    if (phase === 'pick_date_verify_end') {
      await sleep(300)
      const item = getFormItem(['优惠券领取期限', 'Claim Period'])
      const inputs = [...(item?.querySelectorAll('input.eds-react-input__input') || [])].filter(visible)
      const startVal = norm(inputs[0]?.value || '')
      const endVal   = norm(inputs[1]?.value || '')
      console.log(`[DATE] verify_end: start="${startVal}" end="${endVal}"`)
      if (ctx.startDt && !startVal.includes(ctx.startDt.str)) {
        throw new Error(`领取期限开始时间未写入成功，期望：${ctx.startDt?.str}，实际：${startVal || '(空)'}`)
      }
      if (ctx.endDt && !endVal.includes(ctx.endDt.str)) {
        throw new Error(`领取期限结束时间未写入成功，期望：${ctx.endDt?.str}，实际：${endVal || '(空)'}`)
      }
      return nextPhase('form_fill_rest', ctx, 80)
    }

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
      return nextPhase('form_fill_rest', { ...ctx, _datesChecked: true }, 80)
    }

    // ── submit_form ── form_fill_end_date（只有 endDt，跳过了 start，直接处理 end）────────────
    if (phase === 'form_fill_end_date') {
      const item = getFormItem(['优惠券领取期限', 'Claim Period'])
      if (ctx.endDt && item) {
        const cdpMeta = await pickDateTimeViaPanel(item, 'end', ctx.endDt)
        return cdpMeta
      }
      return nextPhase('form_fill_rest', { ...ctx, _datesChecked: true }, 80)
    }

    // ── submit_form ── form_fill_rest（日期填完后继续其他字段）──────────────────────────────
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