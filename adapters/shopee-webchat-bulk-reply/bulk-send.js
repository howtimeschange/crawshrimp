;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const page = Number(window.__CRAWSHRIMP_PAGE__ || 1)

  const runMode = String(params.run_mode || 'preview').trim().toLowerCase()
  const previewOnly = runMode !== 'send'
  const WEBCHAT_URL = 'https://seller.shopee.cn/webchat/conversations'
  const LEFT_PANE_MAX_X = 380
  const FILTER_TRIGGER_ID = 'regionShopSelector'
  const DEFAULT_BATCH_SIZE = 200
  const MIN_BATCH_SIZE = 20
  const MAX_BATCH_SIZE = 500
  const MAX_SEARCH_WAIT_RETRY = 6
  const MAX_OPEN_RETRY = 2
  const TEXT = {
    selectAll: '选择全部',
    confirm: '确认',
    edit: '编辑',
    send: '发送',
    restartConversation: '重新启动对话',
    duplicateMessageTitle: '检测到重复消息',
    searchStore: '搜索店铺用户名',
    searchBuyerPrefixA: '搜寻',
    searchBuyerPrefixB: '搜索',
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value))
  }

  function parseOptionalPositiveInt(value) {
    const num = Number(value)
    if (!Number.isFinite(num) || num <= 0) return null
    return Math.floor(num)
  }

  function readText(el) {
    return (el?.textContent || '').replace(/\s+/g, ' ').trim()
  }

  function visible(el) {
    if (!el || !el.getClientRects().length) return false
    const style = getComputedStyle(el)
    return style.visibility !== 'hidden' && style.display !== 'none'
  }

  function boxOf(el) {
    const rect = el?.getBoundingClientRect?.()
    if (!rect) return null
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    }
  }

  function rectCenter(el) {
    const rect = el?.getBoundingClientRect?.()
    if (!rect) return null
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    }
  }

  function compact(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[\s()（）._-]/g, '')
  }

  function stripTrailingBadge(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\d+\s*$/, '')
      .trim()
  }

  function nextPhase(name, sleepMs = 800, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'next_phase',
        next_phase: name,
        sleep_ms: sleepMs,
        shared: newShared,
      },
    }
  }

  function completePage(data, hasMore) {
    return {
      success: true,
      data,
      meta: {
        action: 'complete',
        has_more: hasMore,
        shared: {},
      },
    }
  }

  function cdpPhase(clicks, nextPhaseName, sleepMs = 800, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'cdp_clicks',
        clicks,
        next_phase: nextPhaseName,
        sleep_ms: sleepMs,
        shared: newShared,
      },
    }
  }

  function fail(message) {
    return { success: false, error: message }
  }

  function columnValue(row, aliases) {
    const aliasSet = aliases.map(compact)
    for (const key of Object.keys(row || {})) {
      if (aliasSet.includes(compact(key))) {
        return row[key]
      }
    }
    return ''
  }

  function normalizeSiteCode(raw) {
    const normalized = compact(raw)
    const candidates = {
      BR: ['br', 'brazil'],
      CL: ['cl', 'chile'],
      CO: ['co', 'colombia'],
      MY: ['my', 'malaysia'],
      PH: ['ph', 'philippines'],
      SG: ['sg', 'singapore'],
      TH: ['th', 'thailand'],
      TW: ['tw', 'taiwan'],
      VN: ['vn', 'vietnam'],
    }

    for (const [code, aliases] of Object.entries(candidates)) {
      if (aliases.some(alias => normalized === compact(alias) || normalized.startsWith(compact(alias)))) {
        return code
      }
    }

    return String(raw || '').trim().toUpperCase()
  }

  function normalizeRows() {
    const rows = Array.isArray(params?.input_file?.rows) ? params.input_file.rows : []
    return rows.map((row, index) => {
      const site = String(columnValue(row, ['站点', 'site', 'Site', 'siteCode']) || '').trim()
      const store = String(columnValue(row, ['店铺', '店铺名称', 'store', 'Store', 'shop']) || '').trim()
      const buyerId = String(columnValue(row, ['买家ID', '买家Id', '买家id', 'buyer_id', 'buyerId', 'Buyer ID', 'buyer']) || '').trim()
      const message = String(columnValue(row, ['发送话术', '发送消息', '消息', '话术', 'message', 'Message', 'msg']) || '').trim()

      return {
        row_no: index + 1,
        site,
        site_code: normalizeSiteCode(site),
        store,
        buyer_id: buyerId,
        message,
      }
    })
  }

  function buildExecutionRows() {
    const rows = normalizeRows()
    const rawStart = parseOptionalPositiveInt(params.start_row) || 1
    const rawEnd = parseOptionalPositiveInt(params.end_row)
    const startIndex = rawStart - 1
    const endIndex = rawEnd ? Math.min(rows.length, rawEnd) : rows.length

    if (!rows.length || startIndex >= rows.length || endIndex <= startIndex) return []

    return rows.slice(startIndex, endIndex).map((row, index) => ({
      ...row,
      exec_no: index + 1,
    }))
  }

  function getRows() {
    const runToken = String(window.__CRAWSHRIMP_RUN_TOKEN__ || '')
    if (window.__CRAWSHRIMP_ROWS_RUN_TOKEN__ === runToken && Array.isArray(window.__CRAWSHRIMP_ROWS__)) {
      return window.__CRAWSHRIMP_ROWS__
    }
    const rows = buildExecutionRows()
    window.__CRAWSHRIMP_ROWS__ = rows
    window.__CRAWSHRIMP_ROWS_RUN_TOKEN__ = runToken
    return rows
  }

  function getBatchSize() {
    const raw = parseOptionalPositiveInt(params.batch_size) || DEFAULT_BATCH_SIZE
    return clamp(raw, MIN_BATCH_SIZE, MAX_BATCH_SIZE)
  }

  function getChunk(rows) {
    const batchSize = getBatchSize()
    const totalBatches = Math.max(1, Math.ceil(rows.length / batchSize))
    const chunkStart = (page - 1) * batchSize
    const chunkEnd = Math.min(rows.length, chunkStart + batchSize)
    return {
      batch_size: batchSize,
      batch_no: page,
      total_batches: totalBatches,
      chunk_start: chunkStart,
      chunk_end: chunkEnd,
      has_rows: chunkStart < rows.length,
      has_more: chunkEnd < rows.length,
    }
  }

  function buildResult(row, status, reason, extras = {}) {
    const batchOffset = Number(shared.index || 0) - Number(shared.chunk_start || 0) + 1
    return {
      执行序号: row?.exec_no ?? '',
      源表行号: row?.row_no ?? '',
      批次: shared.batch_no ?? page,
      批次内序号: Number.isFinite(batchOffset) && batchOffset > 0 ? batchOffset : '',
      站点: row?.site || '',
      店铺: row?.store || '',
      买家ID: row?.buyer_id || '',
      发送话术: row?.message || '',
      运行方式: previewOnly ? '预览' : '实际发送',
      状态: status,
      原因: reason,
      ...extras,
    }
  }

  function emitRowAndAdvance(row, status, reason, extras = {}) {
    return {
      success: true,
      data: [buildResult(row, status, reason, extras)],
      meta: {
        action: 'next_phase',
        next_phase: 'advance_row',
        sleep_ms: 300,
        shared,
      },
    }
  }

  function setNativeValue(el, value) {
    const prototype = Object.getPrototypeOf(el)
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    if (setter) setter.call(el, value)
    else el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function hasReactClick(el) {
    if (!el) return false
    const propKey = Object.keys(el).find(key => key.startsWith('__reactProps'))
    return !!(propKey && typeof el[propKey]?.onClick === 'function')
  }

  function findClickableAncestor(el) {
    let node = el
    for (let i = 0; i < 6 && node; i += 1) {
      if (hasReactClick(node)) return node
      if (typeof node.click === 'function' && /^(BUTTON|LABEL|A)$/i.test(node.tagName || '')) return node
      if (String(node.getAttribute?.('role') || '').toLowerCase() === 'button') return node
      node = node.parentElement
    }
    return null
  }

  function findClickableDescendant(el) {
    if (!el?.querySelectorAll) return null
    return [...el.querySelectorAll('button,label,a,[role="button"],i,span,div')]
      .filter(visible)
      .find(node => hasReactClick(node) || /^(BUTTON|LABEL|A)$/i.test(node.tagName || '') || String(node.getAttribute('role') || '').toLowerCase() === 'button') || null
  }

  function activateElement(el) {
    const target = findClickableAncestor(el) || findClickableDescendant(el) || el
    if (!target) return false

    try {
      target.scrollIntoView({ block: 'center', inline: 'center' })
    } catch {}

    const center = rectCenter(target) || rectCenter(el)
    const eventInit = center
      ? { bubbles: true, cancelable: true, composed: true, view: window, clientX: center.x, clientY: center.y, button: 0 }
      : { bubbles: true, cancelable: true, composed: true, view: window, button: 0 }

    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      try {
        const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent
        target.dispatchEvent(new Ctor(type, eventInit))
      } catch {}
    }

    try {
      if (typeof target.click === 'function') target.click()
    } catch {}

    return true
  }

  function makeFilterKey(row) {
    return `${row?.site_code || ''}|${compact(row?.store || '')}`
  }

  function findRegionShopTrigger() {
    const direct = document.getElementById(FILTER_TRIGGER_ID)
    if (visible(direct)) return direct

    return [...document.querySelectorAll('div,button,span')]
      .filter(visible)
      .find(el => {
        const box = boxOf(el)
        if (!box) return false
        if (box.y < 40 || box.y > 95 || box.x < 320 || box.x > 840 || box.w < 180) return false
        const text = readText(el)
        return text.includes('店铺') || text.includes('Store') || text.includes('Official')
      }) || null
  }

  function getCurrentFilterText() {
    return readText(findRegionShopTrigger())
  }

  function triggerMatchesRow(row) {
    const text = compact(stripTrailingBadge(getCurrentFilterText()))
    const siteOk = !row?.site_code || text.includes(compact(row.site_code))
    const storeOk = !row?.store || text.includes(compact(row.store))
    return siteOk && storeOk
  }

  function looksLikeFilterPopover(el) {
    const box = boxOf(el)
    if (!box) return false
    if (box.w < 600 || box.h < 220) return false
    if (box.y < 70 || box.y > 180) return false

    const hasCheckbox = !!el.querySelector?.('input[type="checkbox"]')
    if (!hasCheckbox) return false

    const inputs = [...el.querySelectorAll?.('input') || []].filter(visible)
    const nodes = [...el.querySelectorAll?.('button,div,span') || []].filter(visible)
    const boxX = box.x
    const boxY = box.y
    const boxW = box.w
    const boxH = box.h

    const hasStoreSearch = inputs.some(input => {
      const placeholder = String(input.getAttribute('placeholder') || '')
      const inputBox = boxOf(input)
      if (!inputBox) return false
      return placeholder.includes(TEXT.searchStore) || placeholder.toLowerCase().includes('store') || (inputBox.x <= boxX + 260 && inputBox.w >= 140)
    })

    const hasConfirm = nodes.some(node => {
      const text = readText(node)
      const nodeBox = boxOf(node)
      if (!nodeBox) return false
      return text === TEXT.confirm || (nodeBox.x >= boxX + boxW - 180 && nodeBox.y >= boxY + boxH - 100 && text.includes(TEXT.confirm))
    })

    const hasSiteTab = nodes.some(node => {
      const text = stripTrailingBadge(readText(node))
      const nodeBox = boxOf(node)
      if (!nodeBox) return false
      if (nodeBox.y < boxY || nodeBox.y > boxY + 80) return false
      return ['BR', 'CL', 'CO', 'MY', 'PH', 'SG', 'TH', 'TW', 'VN'].some(code => text === code || text.startsWith(code))
    })

    return hasConfirm && (hasStoreSearch || hasSiteTab)
  }

  function findVisibleFilterPopover() {
    return [...document.querySelectorAll('.shopee-react-popover, [role="dialog"], div, section')]
      .filter(visible)
      .filter(looksLikeFilterPopover)
      .sort((a, b) => (boxOf(b)?.w || 0) - (boxOf(a)?.w || 0))[0] || null
  }

  function findSiteTab(popover, siteCode) {
    if (!siteCode) return null

    const scopes = [popover, document].filter(Boolean)
    for (const scope of scopes) {
      const match = [...scope.querySelectorAll('div,span,button')]
        .filter(visible)
        .map(el => ({ el, text: stripTrailingBadge(readText(el)), box: boxOf(el) }))
        .filter(item => item.box && item.box.y >= 60 && item.box.y <= 120 && item.box.x <= 980)
        .find(item => item.text === siteCode || item.text.startsWith(siteCode))
      if (match?.el) return match.el
    }

    return null
  }

  function findStoreSearchInput(popover) {
    if (!popover) return null
    return [...popover.querySelectorAll('input')]
      .filter(visible)
      .find(el => String(el.getAttribute('placeholder') || '').includes(TEXT.searchStore) || String(el.getAttribute('placeholder') || '').toLowerCase().includes('store')) ||
      [...popover.querySelectorAll('input')]
        .filter(visible)
        .map(el => ({ el, box: boxOf(el) }))
        .filter(item => item.box && item.box.w >= 140)
        .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)[0]?.el || null
  }

  function findSelectAllControl(popover) {
    if (!popover) return null
    const popoverBox = boxOf(popover)
    if (!popoverBox) return null

    const candidate = [...popover.querySelectorAll('label,div,span')]
      .filter(visible)
      .map(el => ({
        el,
        text: readText(el),
        box: boxOf(el),
        checked: !!el.querySelector?.('input[type="checkbox"]:checked'),
      }))
      .filter(item => item.text.includes(TEXT.selectAll))
      .filter(item => item.box && item.box.y >= popoverBox.y + popoverBox.h - 70 && item.box.y <= popoverBox.y + popoverBox.h + 20)
      .filter(item => item.box && item.box.x >= popoverBox.x && item.box.x <= popoverBox.x + 320)
      .sort((a, b) => ((a.box.w || 0) * (a.box.h || 0)) - ((b.box.w || 0) * (b.box.h || 0)))[0]

    if (!candidate) return null

    return {
      el: candidate.el,
      box: candidate.box,
      checked: candidate.checked,
      text: candidate.text,
    }
  }

  function collectStoreOptions(popover) {
    if (!popover) return []

    return [...popover.querySelectorAll('label.shopee-react-checkbox')]
      .filter(visible)
      .map(label => {
        const text = readText(label)
        return {
          label,
          text,
          normalizedText: compact(stripTrailingBadge(text)),
          checked: !!label.querySelector('input[type="checkbox"]:checked'),
          box: boxOf(label),
        }
      })
      .filter(item => item.text && !item.text.includes(TEXT.selectAll))
      .filter(item => item.box && item.box.y >= 180 && item.box.y <= 330 && item.box.w >= 120)
  }

  function matchesStoreOption(row, optionText) {
    const normalized = compact(stripTrailingBadge(optionText))
    const storeOk = !row?.store || normalized.includes(compact(row.store))
    const siteOk = !row?.site_code || normalized.includes(compact(row.site_code))
    return storeOk && siteOk
  }

  function findConfirmButton(popover) {
    if (!popover) return null
    return [...popover.querySelectorAll('button,div,span')]
      .filter(visible)
      .find(el => readText(el) === TEXT.confirm) ||
      [...popover.querySelectorAll('button,div,span')]
        .filter(visible)
        .map(el => ({ el, text: readText(el), box: boxOf(el) }))
        .filter(item => item.box)
        .filter(item => item.text.includes(TEXT.confirm))
        .sort((a, b) => b.box.x - a.box.x || b.box.y - a.box.y)[0]?.el || null
  }

  function isDuplicateMessageText(text) {
    return /检测到重复消息|消息可能重复或不当|请检查并编辑您?的消息/.test(String(text || ''))
  }

  function findDuplicateMessageDialog() {
    return [...document.querySelectorAll('[role="dialog"], .shopee-react-popover, .shopee-modal, .eds-modal, .eds-react-modal, div, section')]
      .filter(visible)
      .map(el => ({
        el,
        text: readText(el),
        box: boxOf(el),
      }))
      .filter(item => item.box && item.box.x >= LEFT_PANE_MAX_X - 40 && item.box.w >= 260 && item.box.h >= 140)
      .filter(item => isDuplicateMessageText(item.text))
      .filter(item => item.text.includes(TEXT.edit) && item.text.includes(TEXT.send))
      .sort((a, b) => ((a.box.w || 0) * (a.box.h || 0)) - ((b.box.w || 0) * (b.box.h || 0)) || b.box.y - a.box.y)[0]?.el || null
  }

  function findDialogActionButton(dialog, label) {
    if (!dialog) return null
    return [...dialog.querySelectorAll('button,div,span,a')]
      .filter(visible)
      .map(el => ({
        el,
        text: readText(el),
        box: boxOf(el),
      }))
      .filter(item => item.box && compact(item.text) === compact(label))
      .sort((a, b) => ((a.box.w || 0) * (a.box.h || 0)) - ((b.box.w || 0) * (b.box.h || 0)) || b.box.x - a.box.x)[0]?.el || null
  }

  function findConversationSearchInput() {
    const candidates = [...document.querySelectorAll('input,textarea')]
      .filter(visible)
      .map(el => ({
        el,
        box: boxOf(el),
        placeholder: String(el.getAttribute('placeholder') || ''),
      }))
      .filter(item => item.box)
      .filter(item => item.box.x >= 60 && item.box.x <= 340)
      .filter(item => item.box.y >= 40 && item.box.y <= 180)
      .filter(item => item.box.w >= 160)
      .filter(item => item.placeholder.includes(TEXT.searchBuyerPrefixA) || item.placeholder.includes(TEXT.searchBuyerPrefixB))
      .filter(item => !item.placeholder.includes('店铺'))
      .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)

    return candidates[0]?.el || null
  }

  function parseBuyerResultCard(section) {
    const card = section.querySelector('div.SW7LUhQFDH') || section
    const nameEl = section.querySelector('div.RWr1KSlda2')
    const labelEl = section.querySelector('div.VDgFLd0Nkb')
    const name = readText(nameEl)
    const label = readText(labelEl)
    const labelMatch = String(label || '').match(/^\(([^)]+)\)\s*(.+)$/)
    const siteCode = labelMatch ? normalizeSiteCode(labelMatch[1]) : ''
    const store = labelMatch ? labelMatch[2].trim() : label

    return {
      section,
      card,
      name,
      label,
      site_code: siteCode,
      store,
      summary: [name, label].filter(Boolean).join(' '),
      text: compact(section.textContent),
      box: boxOf(card) || boxOf(section),
    }
  }

  function collectBuyerResultCards() {
    return [...document.querySelectorAll('section.Cd1_lkQxa5')]
      .filter(visible)
      .map(parseBuyerResultCard)
      .filter(item => item.box && item.box.x <= LEFT_PANE_MAX_X && item.box.y >= 120 && item.box.w >= 180)
  }

  function textMatchesNeedle(value, needle) {
    const haystack = compact(value)
    const target = compact(needle)
    if (!target) return true
    if (!haystack) return false
    return haystack.includes(target) || target.includes(haystack)
  }

  function cardMatchesRow(row, item) {
    const buyerNeedle = row?.buyer_id || ''
    const storeNeedle = row?.store || ''
    const siteNeedle = row?.site_code || ''

    const buyerOk =
      textMatchesNeedle(item.name, buyerNeedle) ||
      textMatchesNeedle(item.summary, buyerNeedle) ||
      textMatchesNeedle(item.text, buyerNeedle)

    const storeOk =
      !storeNeedle ||
      textMatchesNeedle(item.store, storeNeedle) ||
      textMatchesNeedle(item.label, storeNeedle) ||
      textMatchesNeedle(item.summary, storeNeedle) ||
      textMatchesNeedle(item.text, storeNeedle)

    const siteOk =
      !siteNeedle ||
      compact(item.site_code) === compact(siteNeedle) ||
      textMatchesNeedle(item.label, `(${siteNeedle})`) ||
      textMatchesNeedle(item.summary, `(${siteNeedle})`) ||
      textMatchesNeedle(item.text, `(${siteNeedle})`)

    return buyerOk && storeOk && siteOk
  }

  function matchConversationCard(row) {
    const buyerNeedle = row?.buyer_id || ''
    const storeNeedle = row?.store || ''
    const siteNeedle = row?.site_code || ''
    const cards = collectBuyerResultCards().filter(item =>
      textMatchesNeedle(item.name, buyerNeedle) ||
      textMatchesNeedle(item.summary, buyerNeedle) ||
      textMatchesNeedle(item.text, buyerNeedle)
    )

    if (!cards.length) {
      return { match: null, cards }
    }

    if (cards.length > 1 && !storeNeedle && !siteNeedle) {
      return { match: null, cards }
    }

    const scored = cards
      .map(item => {
        let score = 0
        if (textMatchesNeedle(item.name, buyerNeedle)) score += 120
        if (textMatchesNeedle(item.summary, buyerNeedle)) score += 80
        if (storeNeedle) {
          if (textMatchesNeedle(item.store, storeNeedle) || textMatchesNeedle(item.label, storeNeedle) || textMatchesNeedle(item.summary, storeNeedle)) {
            score += 70
          } else {
            score -= 120
          }
        }
        if (siteNeedle) {
          if (compact(item.site_code) === compact(siteNeedle) || textMatchesNeedle(item.label, `(${siteNeedle})`) || textMatchesNeedle(item.summary, `(${siteNeedle})`)) {
            score += 50
          } else {
            score -= 80
          }
        }
        if (hasReactClick(item.card)) score += 80
        if (item.box.w >= 240 && item.box.w <= 380) score += 10
        if (item.box.h >= 45 && item.box.h <= 120) score += 20
        return { ...item, score }
      })
      .sort((a, b) => b.score - a.score || a.box.y - b.box.y)

    const strongest = scored[0] || null
    if (!strongest || !cardMatchesRow(row, strongest)) {
      return { match: null, cards: scored }
    }

    return { match: strongest, cards: scored }
  }

  function findRestartButton() {
    const candidates = [...document.querySelectorAll('button,div,span')]
      .filter(visible)
      .map(el => {
        const box = boxOf(el)
        const text = readText(el)
        const clickable = hasReactClick(el) || /^(BUTTON|LABEL|A)$/i.test(el.tagName || '') || String(el.getAttribute?.('role') || '').toLowerCase() === 'button'
        return { el, box, text, clickable }
      })
      .filter(item => item.box && item.box.x > LEFT_PANE_MAX_X && item.box.y >= 500)
      .filter(item => compact(item.text).includes(compact(TEXT.restartConversation)))

    const preferred = candidates.filter(item => item.clickable)
    const pool = preferred.length ? preferred : candidates
    return pool.sort((a, b) => (a.box.w * a.box.h) - (b.box.w * b.box.h) || a.box.x - b.box.x || a.box.y - b.box.y)[0]?.el || null
  }

  function findMessageTextarea() {
    return [...document.querySelectorAll('textarea')]
      .filter(visible)
      .map(el => ({ el, box: boxOf(el) }))
      .filter(item => item.box && item.box.x > LEFT_PANE_MAX_X && item.box.y >= 620 && item.box.w >= 300)
      .sort((a, b) => (b.box.w || 0) - (a.box.w || 0) || (b.box.y || 0) - (a.box.y || 0))[0]?.el || null
  }

  function findSendIcon() {
    const textarea = findMessageTextarea()
    if (!textarea) return null

    const rect = textarea.getBoundingClientRect()
    const probes = [
      { x: Math.max(0, rect.right - 8), y: Math.min(window.innerHeight - 4, rect.bottom + 4) },
      { x: Math.max(0, rect.right - 16), y: Math.min(window.innerHeight - 4, rect.bottom) },
      { x: Math.max(0, rect.right - 24), y: Math.min(window.innerHeight - 4, rect.bottom + 12) },
    ]

    for (const probe of probes) {
      const raw = document.elementFromPoint(probe.x, probe.y)
      const node = raw?.closest?.('i,button,div,span') || raw
      if (!node || !visible(node)) continue
      if (hasReactClick(node)) return node
    }

    return [...document.querySelectorAll('i,button,div,span')]
      .filter(visible)
      .find(el => {
        const box = boxOf(el)
        if (!box) return false
        if (box.x < rect.right - 60 || box.x > rect.right + 10) return false
        if (box.y < rect.bottom - 5 || box.y > rect.bottom + 40) return false
        return hasReactClick(el)
      }) || null
  }

  function findOutgoingMessage(text) {
    const needle = compact(text)
    const textarea = findMessageTextarea()
    const textareaY = textarea ? boxOf(textarea)?.y ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY

    return [...document.querySelectorAll('div,span')]
      .filter(visible)
      .find(el => {
        const box = boxOf(el)
        if (!box || box.x <= LEFT_PANE_MAX_X || box.y < 150) return false
        if (box.y >= textareaY - 24) return false
        return compact(readText(el)).includes(needle)
      }) || null
  }

  function availableTexts(items) {
    return items
      .slice(0, 6)
      .map(item => item.summary || item.text)
      .filter(Boolean)
      .join(' | ')
  }

  function collectRightPaneTexts(maxY = 260) {
    return [...document.querySelectorAll('div,span,h1,h2,h3,p')]
      .filter(visible)
      .map(el => ({ text: readText(el), box: boxOf(el) }))
      .filter(item => item.box && item.box.x > LEFT_PANE_MAX_X && item.box.y >= 40 && item.box.y <= maxY && item.text)
      .map(item => item.text)
      .join(' ')
  }

  function getConversationState(row) {
    const headerText = collectRightPaneTexts(200)
    const contextText = collectRightPaneTexts(320)
    const combinedText = compact(`${headerText} ${contextText}`)
    const matchedName = String(shared.last_match_name || '').trim()
    const matchedStore = String(shared.last_match_store || '').trim()

    const buyerCandidates = [row?.buyer_id, matchedName]
      .map(value => compact(value))
      .filter(Boolean)
    const storeCandidates = [row?.store, matchedStore]
      .map(value => compact(value))
      .filter(Boolean)
    const siteCandidate = compact(row?.site_code || '')

    const buyerOk = buyerCandidates.some(value => combinedText.includes(value))
    const storeOk = !storeCandidates.length || storeCandidates.some(value => combinedText.includes(value))
    const siteOk = !siteCandidate || combinedText.includes(siteCandidate)

    return {
      buyerOk,
      storeOk,
      siteOk,
      matched: buyerOk && storeOk && siteOk,
      headerText,
      contextText,
    }
  }

  try {
    const rows = getRows()
    const chunk = getChunk(rows)
    const index = Number(shared.index ?? chunk.chunk_start)
    const row = rows[index]

    if (phase === 'main') {
      if (!rows.length) {
        return fail('Excel 中没有可执行的行；请检查数据或起止行设置')
      }
      if (!location.href.startsWith(WEBCHAT_URL)) {
        location.href = WEBCHAT_URL
        return nextPhase('main', 2200, shared)
      }
      if (!chunk.has_rows) {
        return completePage([], false)
      }
      return nextPhase('prepare_row', 100, {
        batch_no: chunk.batch_no,
        total_batches: chunk.total_batches,
        batch_size: chunk.batch_size,
        total_rows: rows.length,
        chunk_start: chunk.chunk_start,
        chunk_end: chunk.chunk_end,
        index: chunk.chunk_start,
        last_filter_key: '',
        filter_retry: 0,
        wait_retry: 0,
        send_retry: 0,
        composer_retry: 0,
        search_retry: 0,
        search_retype_retry: 0,
        search_signature: '',
        open_retry: 0,
        duplicate_retry: 0,
      })
    }

    if (phase === 'prepare_row') {
      if (index >= Number(shared.chunk_end || 0)) {
        return completePage([], !!chunk.has_more)
      }
      if (!row?.buyer_id || !row?.message) {
        return emitRowAndAdvance(row || { row_no: index + 1 }, 'failed', '缺少必填列：买家ID或发送话术')
      }

      return nextPhase('search_buyer', 100, {
        ...shared,
        total_rows: rows.length,
        current_exec_no: row.exec_no,
        current_row_no: row.row_no,
        current_buyer_id: row.buyer_id,
        current_store: row.store,
        current_site: row.site_code,
        wait_retry: 0,
        send_retry: 0,
        composer_retry: 0,
        search_retry: 0,
        search_retype_retry: 0,
        search_signature: '',
        open_retry: 0,
        duplicate_retry: 0,
        last_match_name: '',
        last_match_store: '',
        last_match_text: '',
      })
    }

    if (phase === 'open_filter') {
      const popover = findVisibleFilterPopover()
      if (popover) {
        return nextPhase('select_site_tab', 100, shared)
      }

      const trigger = findRegionShopTrigger()
      if (!trigger) {
        return emitRowAndAdvance(row, 'failed', '未找到站点/店铺切换入口')
      }
      const coord = rectCenter(trigger)
      if (!coord) {
        return emitRowAndAdvance(row, 'failed', '站点/店铺切换入口坐标为空')
      }

      return cdpPhase([{ ...coord, delay_ms: 120, label: '打开站点店铺筛选器' }], 'select_site_tab', 900, shared)
    }

    if (phase === 'select_site_tab') {
      const popover = findVisibleFilterPopover()
      if (!popover) {
        const retry = Number(shared.filter_retry || 0)
        if (retry < 2) {
          return nextPhase('open_filter', 500, {
            ...shared,
            filter_retry: retry + 1,
          })
        }
        return emitRowAndAdvance(row, 'failed', '站点/店铺筛选面板未成功打开')
      }

      if (!row.site_code) {
        return nextPhase('clear_select_all', 100, shared)
      }

      const siteTab = findSiteTab(popover, row.site_code)
      if (!siteTab) {
        const optionSiteOk = collectStoreOptions(popover).some(item => compact(item.text).includes(compact(`(${row.site_code})`)) || compact(item.text).includes(compact(row.site_code)))
        if (optionSiteOk) {
          return nextPhase('clear_select_all', 100, shared)
        }
        return emitRowAndAdvance(row, 'failed', `未找到站点 Tab：${row.site_code}`)
      }
      const coord = rectCenter(siteTab)
      if (!coord) {
        return emitRowAndAdvance(row, 'failed', `站点 Tab 坐标为空：${row.site_code}`)
      }

      return cdpPhase([{ ...coord, delay_ms: 120, label: `选择站点 ${row.site_code}` }], 'clear_select_all', 1100, shared)
    }

    if (phase === 'clear_select_all') {
      const popover = findVisibleFilterPopover()
      if (!popover) {
        return emitRowAndAdvance(row, 'failed', '选择站点后筛选面板丢失')
      }

      const visibleSiteOptions = collectStoreOptions(popover)
      const siteReady = !row.site_code || visibleSiteOptions.some(item => compact(item.text).includes(compact(`(${row.site_code})`)) || compact(item.text).includes(compact(row.site_code)))
      if (!siteReady) {
        const retry = Number(shared.site_retry || 0)
        if (retry < 3) {
          return nextPhase('select_site_tab', 500, {
            ...shared,
            site_retry: retry + 1,
          })
        }
        return emitRowAndAdvance(row, 'failed', `站点切换未生效；当前可见店铺：${availableTexts(visibleSiteOptions)}`)
      }

      const selectAll = findSelectAllControl(popover)
      if (!selectAll && row.store) {
        return emitRowAndAdvance(row, 'failed', '未找到“选择全部店铺”复选框')
      }
      if (selectAll?.checked) {
        const coord = rectCenter(selectAll.el)
        if (!coord) {
          return emitRowAndAdvance(row, 'failed', '“选择全部店铺”复选框坐标为空')
        }
        return cdpPhase([{ ...coord, delay_ms: 120, label: '取消全选店铺' }], 'verify_select_all_cleared', 700, {
          ...shared,
          store_retry: 0,
        })
      }

      return nextPhase('search_store_option', 100, shared)
    }

    if (phase === 'verify_select_all_cleared') {
      const popover = findVisibleFilterPopover()
      if (!popover) {
        return emitRowAndAdvance(row, 'failed', '取消“选择全部店铺”后筛选面板丢失')
      }

      const selectAll = findSelectAllControl(popover)
      if (selectAll?.checked) {
        const retry = Number(shared.store_retry || 0)
        if (retry < 3) {
          return nextPhase('clear_select_all', 400, {
            ...shared,
            store_retry: retry + 1,
          })
        }
        return emitRowAndAdvance(row, 'failed', '未能取消“选择全部店铺”勾选')
      }

      return nextPhase('search_store_option', 100, {
        ...shared,
        store_retry: 0,
      })
    }

    if (phase === 'search_store_option') {
      const popover = findVisibleFilterPopover()
      if (!popover) {
        return emitRowAndAdvance(row, 'failed', '搜索店铺前筛选面板丢失')
      }

      if (!row.store) {
        return nextPhase('choose_store_option', 100, shared)
      }

      const searchInput = findStoreSearchInput(popover)
      if (!searchInput) {
        return nextPhase('choose_store_option', 100, shared)
      }

      searchInput.focus()
      setNativeValue(searchInput, '')
      setNativeValue(searchInput, row.store)
      searchInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: row.store.slice(-1) || 'e' }))
      return nextPhase('choose_store_option', 700, shared)
    }

    if (phase === 'choose_store_option') {
      const popover = findVisibleFilterPopover()
      if (!popover) {
        return emitRowAndAdvance(row, 'failed', '选择店铺时筛选面板丢失')
      }

      const options = collectStoreOptions(popover)
      const target = options.find(item => matchesStoreOption(row, item.text)) || null

      if (!target) {
        return emitRowAndAdvance(row, 'failed', `未找到目标店铺：${row.store || '(空)'}；可见店铺：${availableTexts(options)}`)
      }

      const otherChecked = options.filter(item => item.checked && item !== target)
      if (otherChecked.length) {
        const coord = rectCenter(otherChecked[0].label)
        if (!coord) {
          return emitRowAndAdvance(row, 'failed', `店铺坐标为空：${stripTrailingBadge(otherChecked[0].text)}`)
        }
        return cdpPhase([{ ...coord, delay_ms: 120, label: `取消店铺 ${stripTrailingBadge(otherChecked[0].text)}` }], 'verify_single_store_selected', 700, {
          ...shared,
          store_retry: 0,
        })
      }

      if (!target.checked) {
        const coord = rectCenter(target.label)
        if (!coord) {
          return emitRowAndAdvance(row, 'failed', `目标店铺坐标为空：${stripTrailingBadge(target.text)}`)
        }
        return cdpPhase([{ ...coord, delay_ms: 120, label: `勾选店铺 ${stripTrailingBadge(target.text)}` }], 'verify_single_store_selected', 700, {
          ...shared,
          store_retry: 0,
        })
      }

      return nextPhase('confirm_filter', 100, shared)
    }

    if (phase === 'verify_single_store_selected') {
      const popover = findVisibleFilterPopover()
      if (!popover) {
        return emitRowAndAdvance(row, 'failed', '选择单一店铺后筛选面板丢失')
      }

      const options = collectStoreOptions(popover)
      const target = options.find(item => matchesStoreOption(row, item.text)) || null
      const otherChecked = options.filter(item => item.checked && item !== target)
      const ready = !!target?.checked && otherChecked.length === 0
      if (ready) {
        return nextPhase('confirm_filter', 100, {
          ...shared,
          store_retry: 0,
        })
      }

      const retry = Number(shared.store_retry || 0)
      if (retry < 4) {
        return nextPhase('choose_store_option', 400, {
          ...shared,
          store_retry: retry + 1,
        })
      }

      return emitRowAndAdvance(row, 'failed', `未能完成单店铺选择；当前店铺：${availableTexts(options.filter(item => item.checked))}`)
    }

    if (phase === 'confirm_filter') {
      const popover = findVisibleFilterPopover()
      if (!popover) {
        return nextPhase('wait_filter_applied', 400, shared)
      }

      const confirm = findConfirmButton(popover)
      if (!confirm) {
        return emitRowAndAdvance(row, 'failed', '未找到筛选确认按钮')
      }

      const coord = rectCenter(confirm)
      if (!coord) {
        return emitRowAndAdvance(row, 'failed', '筛选确认按钮坐标为空')
      }

      return cdpPhase([{ ...coord, delay_ms: 120, label: '确认站点店铺筛选' }], 'wait_filter_applied', 900, shared)
    }

    if (phase === 'wait_filter_applied') {
      const popover = findVisibleFilterPopover()
      const retry = Number(shared.filter_retry || 0)
      if (popover && retry < 4) {
        return nextPhase('wait_filter_applied', 500, {
          ...shared,
          filter_retry: retry + 1,
        })
      }

      if (!triggerMatchesRow(row)) {
        if (retry < 4) {
          return nextPhase('wait_filter_applied', 500, {
            ...shared,
            filter_retry: retry + 1,
          })
        }
        return emitRowAndAdvance(row, 'failed', `站点/店铺切换未生效：${getCurrentFilterText()}`)
      }

      return nextPhase('search_buyer', 600, {
        ...shared,
        last_filter_key: makeFilterKey(row),
        filter_retry: 0,
        wait_retry: 0,
      })
    }

    if (phase === 'search_buyer') {
      const input = findConversationSearchInput()
      if (!input) {
        return emitRowAndAdvance(row, 'failed', '未找到买家搜索框')
      }
      input.focus()
      setNativeValue(input, '')
      await sleep(120)
      setNativeValue(input, row.buyer_id)
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: row.buyer_id.slice(-1) || '0' }))
      return nextPhase('wait_search_results', 900, {
        ...shared,
        search_retry: 0,
        search_signature: '',
      })
    }

    if (phase === 'wait_search_results') {
      const input = findConversationSearchInput()
      if (!input) {
        return emitRowAndAdvance(row, 'failed', '未找到买家搜索框')
      }

      const inputValue = compact(input.value || '')
      if (inputValue !== compact(row.buyer_id)) {
        const retry = Number(shared.search_retype_retry || 0)
        if (retry < 2) {
          return nextPhase('search_buyer', 300, {
            ...shared,
            search_retype_retry: retry + 1,
          })
        }
        return emitRowAndAdvance(row, 'failed', `买家搜索框值异常：${input.value || '(空)'}`)
      }

      const cards = collectBuyerResultCards()
      const buyerCards = cards.filter(item =>
        textMatchesNeedle(item.name, row.buyer_id) ||
        textMatchesNeedle(item.summary, row.buyer_id) ||
        textMatchesNeedle(item.text, row.buyer_id)
      )

      const retry = Number(shared.search_retry || 0)
      if (!buyerCards.length) {
        if (cards.length && retry < 2) {
          return nextPhase('search_buyer', 350, {
            ...shared,
            search_retry: retry + 1,
          })
        }
        if (retry < MAX_SEARCH_WAIT_RETRY) {
          return nextPhase('wait_search_results', 650, {
            ...shared,
            search_retry: retry + 1,
          })
        }
        return emitRowAndAdvance(row, 'failed', cards.length ? `搜索结果未匹配到当前买家：${availableTexts(cards)}` : `未搜索到买家：${row.buyer_id}`)
      }

      const signature = buyerCards.slice(0, 4).map(item => compact(item.summary || item.text)).join('|')
      if (shared.search_signature !== signature && retry < MAX_SEARCH_WAIT_RETRY) {
        return nextPhase('wait_search_results', 350, {
          ...shared,
          search_retry: retry + 1,
          search_signature: signature,
        })
      }

      return nextPhase('pick_buyer', 100, {
        ...shared,
        search_retry: 0,
        search_signature: signature,
      })
    }

    if (phase === 'pick_buyer') {
      const { match, cards } = matchConversationCard(row)
      if (!match) {
        const reason = cards.length
          ? `搜索到买家但未找到匹配店铺/站点的会话：${availableTexts(cards)}`
          : `未搜索到买家：${row.buyer_id}`
        return emitRowAndAdvance(row, 'failed', reason)
      }

      const coord = rectCenter(match.card) || (match.box ? { x: match.box.x + match.box.w / 2, y: match.box.y + match.box.h / 2 } : null)
      if (coord) {
        return cdpPhase([
          {
            ...coord,
            delay_ms: 150,
            label: `打开买家会话 ${row.buyer_id}`,
          }
        ], 'wait_conversation', 1400, {
          ...shared,
          last_match_name: match.name,
          last_match_store: match.store,
          last_match_text: match.summary,
          wait_retry: 0,
        })
      }

      if (activateElement(match.card)) {
        return nextPhase('wait_conversation', 1400, {
          ...shared,
          last_match_name: match.name,
          last_match_store: match.store,
          last_match_text: match.summary,
          wait_retry: 0,
        })
      }

      return emitRowAndAdvance(row, 'failed', '未能点击目标买家会话')
    }

    if (phase === 'wait_conversation') {
      const state = getConversationState(row)
      if (!state.matched) {
        const retryCount = Number(shared.wait_retry || 0)
        if (retryCount < 2) {
          return nextPhase('wait_conversation', 900, {
            ...shared,
            wait_retry: retryCount + 1,
          })
        }

        const openRetry = Number(shared.open_retry || 0)
        if (openRetry < MAX_OPEN_RETRY) {
          return nextPhase('pick_buyer', 350, {
            ...shared,
            open_retry: openRetry + 1,
            wait_retry: 0,
          })
        }

        return emitRowAndAdvance(row, 'failed', `会话未稳定打开；头部信息：${state.headerText || state.contextText || '(空)'}`)
      }

      const restartButton = findRestartButton()
      if (restartButton) {
        const coord = rectCenter(restartButton)
        if (coord) {
          return cdpPhase([{ ...coord, delay_ms: 150, label: '重新启动对话' }], 'wait_composer', 1200, {
            ...shared,
            send_retry: Number(shared.send_retry || 0),
            composer_retry: 0,
          })
        }
        if (activateElement(restartButton)) {
          return nextPhase('wait_composer', 1200, {
            ...shared,
            send_retry: Number(shared.send_retry || 0),
            composer_retry: 0,
          })
        }
        return emitRowAndAdvance(row, 'failed', '找到“重新启动对话”，但按钮无法点击')
      }

      return nextPhase('prepare_message', 100, shared)
    }

    if (phase === 'wait_composer') {
      const state = getConversationState(row)
      if (!state.matched) {
        return emitRowAndAdvance(row, 'failed', `重新启动对话后会话上下文异常：${state.headerText || state.contextText || '(空)'}`)
      }

      const textarea = findMessageTextarea()
      if (!textarea) {
        const retry = Number(shared.composer_retry || 0)
        if (retry < 4) {
          return nextPhase('wait_composer', 1000, {
            ...shared,
            composer_retry: retry + 1,
          })
        }
        return emitRowAndAdvance(row, 'failed', '点击“重新启动对话”后未出现发送输入框')
      }
      return nextPhase('prepare_message', 100, {
        ...shared,
        send_retry: Number(shared.send_retry || 0),
        composer_retry: 0,
      })
    }

    if (phase === 'prepare_message') {
      const state = getConversationState(row)
      if (!state.matched) {
        return emitRowAndAdvance(row, 'failed', `准备发送前会话校验失败：${state.headerText || state.contextText || '(空)'}`)
      }

      const textarea = findMessageTextarea()
      if (!textarea) {
        return emitRowAndAdvance(row, 'failed', '未找到消息输入框')
      }

      textarea.focus()
      setNativeValue(textarea, row.message)
      textarea.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'v' }))
      await sleep(300)

      if (String(textarea.value || '') !== row.message) {
        return emitRowAndAdvance(row, 'failed', '消息输入回读不一致')
      }

      if (previewOnly) {
        setNativeValue(textarea, '')
        return emitRowAndAdvance(row, 'success', '预演成功：已验证站点切换、店铺选择、买家搜索、会话打开和消息输入，未实际发送')
      }

      return nextPhase('send_message', 150, shared)
    }

    if (phase === 'send_message') {
      const state = getConversationState(row)
      if (!state.matched) {
        return emitRowAndAdvance(row, 'failed', `发送前会话目标不一致：${state.headerText || state.contextText || '(空)'}`)
      }

      const sendIcon = findSendIcon()
      if (!sendIcon) {
        return emitRowAndAdvance(row, 'failed', '未定位到发送按钮/图标')
      }

      const coord = rectCenter(sendIcon)
      if (coord) {
        return cdpPhase([{ ...coord, delay_ms: 150, label: '发送消息' }], 'post_send', 900, shared)
      }

      if (activateElement(sendIcon)) {
        return nextPhase('post_send', 900, shared)
      }

      return emitRowAndAdvance(row, 'failed', '发送按钮坐标为空')
    }

    if (phase === 'post_send') {
      const state = getConversationState(row)
      if (!state.matched) {
        return emitRowAndAdvance(row, 'failed', `发送后会话目标异常：${state.headerText || state.contextText || '(空)'}`)
      }

      const restartButton = findRestartButton()
      if (restartButton) {
        const retry = Number(shared.send_retry || 0)
        if (retry < 1) {
          const coord = rectCenter(restartButton)
          if (coord) {
            return cdpPhase([{ ...coord, delay_ms: 150, label: '重新启动对话' }], 'wait_composer', 1200, {
              ...shared,
              send_retry: retry + 1,
              composer_retry: 0,
            })
          }
          if (activateElement(restartButton)) {
            return nextPhase('wait_composer', 1200, {
              ...shared,
              send_retry: retry + 1,
              composer_retry: 0,
            })
          }
        }
        return emitRowAndAdvance(row, 'failed', '发送后需要重新启动对话，但重试后仍未恢复')
      }

      const duplicateDialog = findDuplicateMessageDialog()
      if (duplicateDialog) {
        const editButton = findDialogActionButton(duplicateDialog, TEXT.edit)
        if (!editButton) {
          return emitRowAndAdvance(row, 'failed', `检测到${TEXT.duplicateMessageTitle}弹窗，但未找到“${TEXT.edit}”按钮`)
        }

        const coord = rectCenter(editButton)
        if (coord) {
          return cdpPhase([{ ...coord, delay_ms: 150, label: `关闭${TEXT.duplicateMessageTitle}弹窗（${TEXT.edit}）` }], 'verify_duplicate_message_dismissed', 700, {
            ...shared,
            duplicate_retry: 0,
          })
        }

        if (activateElement(editButton)) {
          return nextPhase('verify_duplicate_message_dismissed', 700, {
            ...shared,
            duplicate_retry: 0,
          })
        }

        return emitRowAndAdvance(row, 'failed', `检测到${TEXT.duplicateMessageTitle}弹窗，但“${TEXT.edit}”按钮无法点击`)
      }

      const textarea = findMessageTextarea()
      const cleared = textarea ? String(textarea.value || '') === '' : false
      const echoed = !!findOutgoingMessage(row.message)
      if (cleared || echoed) {
        return emitRowAndAdvance(row, 'success', '发送成功')
      }

      return emitRowAndAdvance(row, 'failed', '点击发送后未观察到成功信号')
    }

    if (phase === 'verify_duplicate_message_dismissed') {
      const state = getConversationState(row)
      if (!state.matched) {
        return emitRowAndAdvance(row, 'failed', `关闭重复消息弹窗后会话目标异常：${state.headerText || state.contextText || '(空)'}`)
      }

      const duplicateDialog = findDuplicateMessageDialog()
      if (!duplicateDialog) {
        return emitRowAndAdvance(row, 'success', '检测到重复消息弹窗，已点击“编辑”关闭并跳过重复发送')
      }

      const retry = Number(shared.duplicate_retry || 0)
      const editButton = findDialogActionButton(duplicateDialog, TEXT.edit)
      if (editButton && retry < 2) {
        const coord = rectCenter(editButton)
        if (coord) {
          return cdpPhase([{ ...coord, delay_ms: 150, label: `重试关闭${TEXT.duplicateMessageTitle}弹窗（${TEXT.edit}）` }], 'verify_duplicate_message_dismissed', 700, {
            ...shared,
            duplicate_retry: retry + 1,
          })
        }

        if (activateElement(editButton)) {
          return nextPhase('verify_duplicate_message_dismissed', 700, {
            ...shared,
            duplicate_retry: retry + 1,
          })
        }
      }

      return emitRowAndAdvance(row, 'failed', `检测到${TEXT.duplicateMessageTitle}弹窗，但关闭失败`)
    }

    if (phase === 'advance_row') {
      const nextIndex = index + 1
      if (nextIndex >= Number(shared.chunk_end || 0)) {
        return completePage([], !!chunk.has_more)
      }
      return nextPhase('prepare_row', 200, {
        ...shared,
        index: nextIndex,
        wait_retry: 0,
        send_retry: 0,
        composer_retry: 0,
        search_retry: 0,
        search_retype_retry: 0,
        search_signature: '',
        open_retry: 0,
        duplicate_retry: 0,
      })
    }

    return fail(`未知阶段：${phase}`)
  } catch (e) {
    return fail(e.message)
  }
})()
