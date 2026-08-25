;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const PLM_HOME_URL = 'http://plm.balabala.com/WebAccess/home.html'
  const STAGE_PRIORITY = ['大货', '订货', '试销单', '内评', '初版']
  const SEARCH_TIMEOUT_MS = 10_000
  const PAGE_TIMEOUT_MS = 20_000
  const PDF_TIMEOUT_MS = 120_000
  const PHASE_POLL_MS = 250
  const MAX_TRANSIENT_RETRIES = 1
  const MAX_SEARCH_RETRIES = 1
  const SEARCH_RETRY_DELAY_MS = 1_500
  const RUN_PAGE_BATCH_SIZE = 10
  const DETAIL_CLICK_WAIT_MS = 4_000
  const PDF_READ_RETRY_MS = 1_200
  const PDF_READ_MAX_ATTEMPTS = 6
  const PDF_READ_DEADLINE_MS = 30_000

  function compact(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim()
  }

  function normalizeToken(value) {
    return compact(value).replace(/[\s_：:（）()\[\]【】\-/]+/g, '').toLowerCase()
  }

  function uniqueValues(values) {
    const seen = new Set()
    return (values || []).map(compact).filter(value => value && !seen.has(value) && seen.add(value))
  }

  function normalizeStyleCodes(rawValue) {
    const text = String(rawValue || '').replace(/[，、；;,\t ]+/g, '\n')
    const codes = []
    for (const line of text.split(/\r?\n/)) {
      const cleaned = compact(line).replace(/^款号[:：]?/, '')
      if (!cleaned) continue
      const matches = cleaned.match(/[A-Za-z0-9][A-Za-z0-9_-]{5,}/g)
      codes.push(...(matches || [cleaned]))
    }
    return uniqueValues(codes)
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function extractProductCode(text, styleCode = '') {
    const source = compact(text)
    if (!source) return ''
    if (styleCode) {
      const match = source.match(new RegExp('([A-Za-z0-9][A-Za-z0-9_-]{2,})\\s*[/／]\\s*' + escapeRegExp(styleCode), 'i'))
      if (match) return match[1]
    }
    const slashPart = source.split(/[/／]/)[0]
    const tokens = slashPart.match(/[A-Za-z0-9][A-Za-z0-9_-]{2,}/g) || []
    return tokens[tokens.length - 1] || ''
  }

  function safeFilePart(value) {
    return compact(value).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/g, '')
  }

  function buildPdfFilename(productCode, styleCode) {
    const style = safeFilePart(styleCode) || '款号未知'
    return `货号${style} 尺码表.pdf`
  }

  function buildDirectPdfUrl(fileUrl, fileName, origin = location.origin) {
    const source = compact(fileUrl)
    if (!source) return ''
    if (!/^cf:/i.test(source)) return new URL(source, origin).href
    let title = compact(fileName)
      .replace(/:/g, '-')
      .replace(/</g, '-')
      .replace(/>/g, '-')
      .replace(/\*/g, '-')
      .replace(/\?/g, '-')
      .replace(/%/g, '-')
      .replace(/\+/g, '-')
      .replace(/\s+$/g, '')
      .replace(/\\/g, '-')
      .replace(/&/g, '-')
      .replace(/\./g, '-')
      .replace(/#/g, '-')
    title = encodeURIComponent(title || 'size-chart').replace(/%2F/gi, '-')
    const query = new URLSearchParams({
      URL: source,
      Module: 'Publisher',
      Operation: 'GetDirect',
      OutputJSON: '1',
      Title: `/${decodeURIComponent(title)}`,
    })
    return `${String(origin).replace(/\/$/, '')}/csi-requesthandler/RequestHandler/${title}?${query.toString().replace(/\+/g, '%20')}`
  }

  function uniqueUrls(values) {
    const seen = new Set()
    return (values || []).map(compact).filter(value => value && !seen.has(value) && seen.add(value))
  }

  function buildPdfUrlCandidates(result, origin = location.origin) {
    const directUrl = buildDirectPdfUrl(result?.file, result?.fileName, origin)
    return uniqueUrls([directUrl, result?.openedUrl])
  }

  function usableNavigationUrl(href, dataUrl, origin = location.origin) {
    const directHref = compact(href)
    if (directHref && !/^(javascript:|#?$)/i.test(directHref)) {
      try { return new URL(directHref, `${String(origin).replace(/\/$/, '')}/WebAccess/home.html`).href } catch (error) {}
    }
    const target = compact(dataUrl)
    if (!target) return ''
    if (/^https?:/i.test(target)) return target
    const hashValue = target.startsWith('#') ? target.slice(1) : `URL=${encodeURIComponent(target)}&RURL=-`
    return `${String(origin).replace(/\/$/, '')}/WebAccess/home.html#${hashValue}`
  }

  function textOf(element) {
    return compact(element?.innerText || element?.textContent || '')
  }

  function isVisible(element) {
    if (!element || typeof element.getBoundingClientRect !== 'function') return false
    const rect = element.getBoundingClientRect()
    if (rect.width <= 1 || rect.height <= 1) return false
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(element) : null
    return !style || (style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0)
  }

  function clickableTarget(element) {
    return element?.closest?.('a, button, [role="button"], input[type="button"], input[type="submit"], [onclick]') || element
  }

  function pointOf(element) {
    const target = clickableTarget(element)
    if (!target || !isVisible(target)) return null
    try { target.scrollIntoView({ block: 'center', inline: 'center' }) } catch (error) {}
    const rect = target.getBoundingClientRect()
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      delay_ms: 120,
    }
  }

  function setNativeValue(input, value) {
    const prototype = Object.getPrototypeOf(input)
    const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, 'value') : null
    if (descriptor?.set) descriptor.set.call(input, value)
    else input.value = value
    for (const eventName of ['input', 'change', 'keyup']) {
      input.dispatchEvent(new Event(eventName, { bubbles: true }))
    }
  }

  function findHeaderSearchInput() {
    const direct = document.querySelector('#headerSearchText')
    if (direct && isVisible(direct)) return direct
    const inputs = [...document.querySelectorAll('input[type="text"], input:not([type])')].filter(isVisible)
    return inputs.find(input => {
      const haystack = compact([
        input.id,
        input.name,
        input.placeholder,
        input.getAttribute('aria-label'),
        input.className,
      ].join(' '))
      return /header.*search|search.*text|搜索|款式/i.test(haystack)
    }) || null
  }

  function findSearchButton(input) {
    if (!input) return null
    const scopes = [input.closest('form'), input.parentElement, input.parentElement?.parentElement].filter(Boolean)
    for (const scope of scopes) {
      const candidates = [...scope.querySelectorAll('button, a, [role="button"], [onclick], input[type="submit"]')]
        .filter(isVisible)
      const explicit = candidates.find(element => {
        const haystack = compact([
          textOf(element),
          element.title,
          element.getAttribute('aria-label'),
          element.id,
          element.className,
          element.innerHTML,
        ].join(' '))
        return /搜索|search|magnif|放大镜|icon-search|fa-search/i.test(haystack)
      })
      if (explicit) return explicit
    }
    const inputRect = input.getBoundingClientRect()
    return [...document.querySelectorAll('button, a, [role="button"], [onclick]')]
      .filter(isVisible)
      .map(element => ({ element, rect: element.getBoundingClientRect() }))
      .filter(item => item.rect.left >= inputRect.right - 8 && item.rect.left <= inputRect.right + 90)
      .filter(item => Math.abs((item.rect.top + item.rect.height / 2) - (inputRect.top + inputRect.height / 2)) <= 24)
      .sort((a, b) => a.rect.left - b.rect.left)[0]?.element || null
  }

  function findStyleResultLink(styleCode) {
    const needle = normalizeToken(styleCode)
    const resultRows = [...document.querySelectorAll(
      '#searchResultsGrid .csi-card.dgrid-row, .csi-header-search-results .dgrid-row[data-csi-url]',
    )].filter(isVisible)

    for (const row of resultRows) {
      const anchor = row.querySelector('a.csi-card-anchor, a[href]')
      const titleNode = row.querySelector('.csi-card-name-section, [data-csi-heading="___Name:"]')
      const displayText = compact(textOf(titleNode) || anchor?.title || textOf(row))
      const searchableText = compact(`${displayText} ${anchor?.title || ''} ${textOf(row)}`)
      if (!normalizeToken(searchableText).includes(needle)) continue
      return {
        element: titleNode || row,
        row,
        href: compact(anchor?.href || anchor?.getAttribute?.('href') || ''),
        text: displayText || textOf(row),
        dataUrl: compact(row.getAttribute('data-csi-url') || titleNode?.getAttribute?.('data-csi-url') || ''),
      }
    }

    const anchors = [...document.querySelectorAll('a[href], a[onclick], [role="link"]')]
    for (const anchor of anchors) {
      const searchableText = compact(`${textOf(anchor)} ${anchor.title || ''} ${anchor.getAttribute('aria-label') || ''}`)
      if (!normalizeToken(searchableText).includes(needle)) continue
      return {
        element: anchor,
        row: anchor.closest('.dgrid-row, [role="row"]') || anchor,
        href: compact(anchor.href || anchor.getAttribute('href') || ''),
        text: compact(textOf(anchor) || anchor.title),
        dataUrl: compact(anchor.getAttribute('data-csi-url') || ''),
      }
    }
    return null
  }

  function findTextControl(exactText) {
    const target = normalizeToken(exactText)
    const candidates = [...document.querySelectorAll('a, button, [role="tab"], [role="button"], li, td, span, div')]
      .filter(isVisible)
      .filter(element => normalizeToken(textOf(element)) === target)
      .sort((a, b) => a.children.length - b.children.length)
    return candidates.map(clickableTarget).find(isVisible) || null
  }

  function stageOfRowText(rowText) {
    const normalized = normalizeToken(rowText)
    return STAGE_PRIORITY.find(stage => normalized.includes(normalizeToken(stage))) || ''
  }

  function pickBestStageRow(rows) {
    const normalizedRows = (rows || []).map(row => ({
      row,
      text: compact(row?.text ?? textOf(row)),
    }))
    for (const stage of STAGE_PRIORITY) {
      const stageToken = normalizeToken(stage)
      const match = normalizedRows.find(item => normalizeToken(item.text).includes(stageToken))
      if (match) return { row: match.row, stage }
    }
    return null
  }

  function findBestSizeChartLink() {
    const anchors = [...document.querySelectorAll('a[href], a[onclick]')]
      .filter(isVisible)
      .filter(anchor => /尺寸表|尺码表/i.test(textOf(anchor)))
    const candidates = anchors.map(anchor => {
      const row = anchor.closest('tr, [role="row"]') || anchor.parentElement
      const combinedText = compact(`${textOf(row)} ${textOf(anchor)}`)
      return { anchor, row, text: combinedText }
    })
    const picked = pickBestStageRow(candidates)
    if (!picked) return null
    return {
      link: picked.row.anchor,
      stage: picked.stage || stageOfRowText(picked.row.text),
      text: picked.row.text,
      href: compact(picked.row.anchor?.href || picked.row.anchor?.getAttribute?.('href') || ''),
      dataUrl: compact(
        picked.row.anchor?.getAttribute?.('data-csi-url')
        || picked.row.row?.getAttribute?.('data-csi-url')
        || '',
      ),
    }
  }

  function findPdfButton() {
    const centricButton = [
      ...document.querySelectorAll(
        '[data-csi-automation="plugin-SizeChartRevision-TDS-pdf"], .csi-toolbar-btn-pdf[data-csi-act="ViewPdf"]',
      ),
    ].find(isVisible)
    if (centricButton) return centricButton
    const selectors = [
      'a[title*="PDF" i]',
      'button[title*="PDF" i]',
      '[aria-label*="PDF" i]',
      'a[href*="GetDirect" i]',
      'a[href*="Publisher" i]',
      'img[src*="pdf" i]',
      'img[alt*="pdf" i]',
    ]
    for (const selector of selectors) {
      const found = [...document.querySelectorAll(selector)].map(clickableTarget).find(isVisible)
      if (found) return found
    }
    const candidates = [...document.querySelectorAll('a, button, [role="button"], [onclick]')]
      .filter(isVisible)
      .filter(element => {
        const haystack = compact([
          textOf(element),
          element.title,
          element.getAttribute('aria-label'),
          element.getAttribute('href'),
          element.getAttribute('onclick'),
          element.className,
          element.innerHTML,
        ].join(' '))
        return /pdf|publisher|GetDirect|输出.*文档|导出.*PDF/i.test(haystack)
      })
    return candidates[0] || null
  }

  function findLoadErrorDialog() {
    return [...document.querySelectorAll('[role="dialog"], .dijitDialog, .csi-dialog, .modal')]
      .filter(isVisible)
      .find(element => /Failed to load the page!/i.test(textOf(element))) || null
  }

  function dismissLoadErrorDialog() {
    const dialog = findLoadErrorDialog()
    if (!dialog) return false
    const button = [...dialog.querySelectorAll('button, input[type="button"], [role="button"], .dijitButtonNode, a')]
      .filter(isVisible)
      .find(element => /^(OK|确定|关闭)$/i.test(textOf(element) || element.value || ''))
    const target = clickableTarget(button)
    try { target?.click?.() } catch (error) {}
    try {
      target?.dispatchEvent?.(new MouseEvent('click', { bubbles: true, cancelable: true }))
    } catch (error) {}
    return true
  }

  function deadlineAt(currentValue, timeoutMs, now = Date.now()) {
    const current = Number(currentValue || 0)
    return current > 0 ? current : now + timeoutMs
  }

  function deadlineExpired(value, now = Date.now()) {
    const deadline = Number(value || 0)
    return deadline > 0 && now >= deadline
  }

  function nextPhase(name, sleepMs = 0, nextShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: { action: 'next_phase', next_phase: name, sleep_ms: sleepMs, shared: nextShared },
    }
  }

  function cdpClick(point, name, sleepMs, nextShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: { action: 'cdp_clicks', clicks: [point], next_phase: name, sleep_ms: sleepMs, shared: nextShared },
    }
  }

  async function armPdfCompletionListener() {
    const previous = window.__CRAWSHRIMP_PDF_RESULT__
    try { previous?.handle?.remove?.() } catch (error) {}
    const state = {
      installed: false,
      done: false,
      ok: false,
      file: '',
      fileName: '',
      status: '',
      message: '',
      openedUrl: '',
      popupWindow: null,
      handle: null,
    }
    window.__CRAWSHRIMP_PDF_RESULT__ = state
    const amdRequire = window.require || (typeof require === 'function' ? require : null)
    if (!amdRequire) throw new Error('页面未加载 Dojo 模块系统')
    await new Promise((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new Error('订阅 PDF 完成事件超时'))
      }, 3000)
      try {
        amdRequire(['dojo/topic'], topic => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          state.handle = topic.subscribe('/csi/pdf/complete', (node, ok) => {
            Object.assign(state, {
              done: true,
              ok: Boolean(ok),
              file: compact(node?.File || ''),
              fileName: compact(node?.FileName || ''),
              status: compact(node?.Status || ''),
              message: compact(node?.StatusMessage || ''),
            })
          })
          state.installed = true
          resolve()
        }, error => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(error)
        })
      } catch (error) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      }
    })
    return state
  }

  function installPdfPopupGuard(state) {
    restorePdfPopupGuard()
    const originalOpen = window.open
    const guard = { originalOpen, popupWindow: null }
    window.__CRAWSHRIMP_PDF_OPEN_GUARD__ = guard
    window.open = function guardedPdfOpen(url, ...args) {
      const href = compact(url)
      if (/csi-requesthandler|GetDirect|Module=Publisher/i.test(href)) {
        state.openedUrl = href
        let popupWindow = null
        try {
          popupWindow = typeof originalOpen === 'function'
            ? originalOpen.call(window, 'about:blank', ...args)
            : null
        } catch (error) {}
        guard.popupWindow = popupWindow
        state.popupWindow = popupWindow
        return popupWindow
      }
      return typeof originalOpen === 'function' ? originalOpen.call(window, url, ...args) : null
    }
  }

  function closePdfPopupWindow(state) {
    const popupWindow = state?.popupWindow
    try {
      if (popupWindow && !popupWindow.closed) popupWindow.close()
    } catch (error) {}
    if (state) state.popupWindow = null
  }

  function restorePdfPopupGuard(closePopup = true) {
    const guard = window.__CRAWSHRIMP_PDF_OPEN_GUARD__
    if (!guard) return
    window.open = guard.originalOpen
    if (closePopup) closePdfPopupWindow(guard)
    delete window.__CRAWSHRIMP_PDF_OPEN_GUARD__
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer)
    const chunks = []
    const chunkSize = 0x8000
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)))
    }
    return btoa(chunks.join(''))
  }

  async function fetchPdfDataUrl(url, timeoutMs = PDF_TIMEOUT_MS) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
    try {
      const response = await fetch(url, {
        credentials: 'include',
        cache: 'no-store',
        signal: controller?.signal,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const buffer = await response.arrayBuffer()
      const signature = new TextDecoder('ascii').decode(new Uint8Array(buffer, 0, Math.min(5, buffer.byteLength)))
      if (signature !== '%PDF-') throw new Error('返回内容不是 PDF 文件')
      return `data:application/pdf;base64,${arrayBufferToBase64(buffer)}`
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async function activatePdfButton(element) {
    const root = element?.closest?.(
      '[data-csi-automation="plugin-SizeChartRevision-TDS-pdf"], .csi-toolbar-btn-pdf[widgetid]',
    ) || element
    const widget = window.dijit?.registry?.byNode?.(root)
      || window.dijit?.byId?.(root?.getAttribute?.('widgetid') || root?.id)
    const state = await armPdfCompletionListener()
    installPdfPopupGuard(state)
    if (widget?.disabled && typeof widget.onClick === 'function') {
      widget.onClick()
      return true
    }
    if (widget?.valueNode && typeof widget.valueNode.click === 'function') {
      widget.valueNode.click()
      return true
    }
    if (widget && typeof widget.onClick === 'function') {
      widget.onClick()
      return true
    }
    if (typeof root?.click === 'function') {
      root.click()
      return true
    }
    return false
  }

  function downloadPdf(url, filename, nextShared) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'download_urls',
        items: [{
          url,
          filename,
          label: nextShared.current_style_code || filename,
          browser_session: !/^data:application\/pdf/i.test(url),
          target_dir: compact(params.output_dir || nextShared.output_dir || ''),
          timeout_seconds: 120,
          retry_attempts: 1,
        }],
        shared_key: 'pdf_download',
        strict: false,
        concurrency: 1,
        timeout_seconds: 120,
        next_phase: 'finish_pdf_download',
        sleep_ms: 0,
        shared: nextShared,
      },
    }
  }

  function desiredOutputPath(filename) {
    const outputDir = compact(params.output_dir || shared.output_dir || '')
    if (!outputDir) return ''
    return `${outputDir.replace(/[\\/]+$/g, '')}\\${filename}`
  }

  function resultRow(success, details = {}) {
    const styleCode = compact(details.styleCode || shared.current_style_code || '')
    const productCode = compact(details.productCode || shared.current_product_code || '')
    const filename = compact(details.filename || shared.current_filename || '')
    return {
      款号: styleCode,
      货号: productCode,
      尺码表阶段: compact(details.stage || shared.current_stage || ''),
      下载状态: success ? '已下载' : '未下载',
      文件名: filename,
      保存路径: success ? desiredOutputPath(filename) : '',
      运行时路径: success ? compact(details.runtimePath || '') : '',
      备注: compact(details.remark || (success ? '' : '未下载')),
      处理时间: new Date().toLocaleString('zh-CN', { hour12: false }),
    }
  }

  function complete(data, nextShared, hasMore = false) {
    return {
      success: true,
      data,
      meta: {
        action: 'complete',
        has_more: hasMore,
        sleep_ms: hasMore ? 500 : 0,
        shared: nextShared,
      },
    }
  }

  function shouldContinueNextPage(done, batchCompletedCount) {
    return !done && Math.max(0, Number(batchCompletedCount || 0)) >= RUN_PAGE_BATCH_SIZE
  }

  function retryCurrentAfterTransientError(remark) {
    restorePdfPopupGuard()
    const retryCount = Math.max(0, Number(shared.transient_retry_count || 0))
    if (retryCount >= MAX_TRANSIENT_RETRIES) {
      return finishCurrent(false, { remark })
    }
    try { location.assign(PLM_HOME_URL) } catch (error) {}
    return nextPhase('search_style', 1200, {
      ...shared,
      transient_retry_count: retryCount + 1,
      current_product_code: '',
      current_stage: '',
      current_filename: '',
      search_result_href: '',
      direct_navigation_attempted: false,
      selected_chart_href: '',
      selected_chart_data_url: '',
      chart_direct_navigation_attempted: false,
      pdf_page_reload_attempted: false,
      search_input_deadline_at: 0,
      search_deadline_at: 0,
      size_tab_deadline_at: 0,
      size_chart_deadline_at: 0,
      pdf_button_deadline_at: 0,
      pdf_deadline_at: 0,
      pdf_read_candidates: [],
      pdf_read_attempt_count: 0,
      pdf_read_deadline_at: 0,
      pdf_read_last_error: '',
      pdf_download: null,
      last_transient_error: compact(remark),
    })
  }

  function retryCurrentSearchAfterTimeout() {
    const retryCount = Math.max(0, Number(shared.search_retry_count || 0))
    if (retryCount >= MAX_SEARCH_RETRIES) {
      return finishCurrent(false, { remark: '搜索已完整等待 10 秒，自动刷新重试 1 次后仍未出现对应产品链接' })
    }
    try { location.assign(PLM_HOME_URL) } catch (error) {}
    return nextPhase('search_style', SEARCH_RETRY_DELAY_MS, {
      ...shared,
      search_retry_count: retryCount + 1,
      search_input_deadline_at: 0,
      search_deadline_at: 0,
    })
  }

  function finishCurrent(success, details = {}) {
    restorePdfPopupGuard()
    const codes = shared.target_style_codes || normalizeStyleCodes(params.style_codes)
    const index = Math.max(0, Number(shared.current_index || 0))
    const row = resultRow(success, details)
    const nextIndex = index + 1
    const done = nextIndex >= codes.length
    const batchCompletedCount = Math.max(0, Number(shared.page_batch_completed_count || 0)) + 1
    const nextShared = {
      ...shared,
      run_initialized: true,
      current_index: nextIndex,
      completed_count: nextIndex,
      page_batch_completed_count: batchCompletedCount,
      success_count: Number(shared.success_count || 0) + (success ? 1 : 0),
      failed_count: Number(shared.failed_count || 0) + (success ? 0 : 1),
      current_style_code: done ? '' : codes[nextIndex],
      current_product_code: '',
      current_stage: '',
      current_filename: '',
      search_result_href: '',
      direct_navigation_attempted: false,
      selected_chart_href: '',
      selected_chart_data_url: '',
      chart_direct_navigation_attempted: false,
      pdf_page_reload_attempted: false,
      transient_retry_count: 0,
      search_retry_count: 0,
      search_input_deadline_at: 0,
      search_deadline_at: 0,
      size_tab_deadline_at: 0,
      size_chart_deadline_at: 0,
      pdf_button_deadline_at: 0,
      pdf_deadline_at: 0,
      pdf_read_candidates: [],
      pdf_read_attempt_count: 0,
      pdf_read_deadline_at: 0,
      pdf_read_last_error: '',
      pdf_download: null,
      last_result: success ? '已下载' : '未下载',
      last_remark: row.备注,
    }
    if (done) return complete([row], nextShared)
    if (!findHeaderSearchInput()) {
      try { location.assign(PLM_HOME_URL) } catch (error) {}
    }
    if (shouldContinueNextPage(done, batchCompletedCount)) {
      return complete([row], {
        ...nextShared,
        page_batch_completed_count: 0,
      }, true)
    }
    return nextPhase('search_style', 1200, nextShared, [row])
  }

  function firstDownloadItem(downloadResult) {
    if (Array.isArray(downloadResult)) {
      for (const group of downloadResult) {
        if (Array.isArray(group?.items) && group.items[0]) return group.items[0]
      }
      return null
    }
    return Array.isArray(downloadResult?.items) ? downloadResult.items[0] || null : null
  }

  function prepareRun() {
    const codes = normalizeStyleCodes(params.style_codes)
    if (!codes.length) throw new Error('请至少输入一个款号')
    if (!compact(params.output_dir)) throw new Error('请选择 PDF 和结果 Excel 的保存文件夹')
    return {
      ...shared,
      run_initialized: true,
      target_style_codes: codes,
      output_dir: compact(params.output_dir),
      current_index: 0,
      completed_count: 0,
      success_count: 0,
      failed_count: 0,
      page_batch_completed_count: 0,
      current_style_code: codes[0],
      current_product_code: '',
      current_stage: '',
      current_filename: '',
      search_result_href: '',
      direct_navigation_attempted: false,
      selected_chart_href: '',
      selected_chart_data_url: '',
      chart_direct_navigation_attempted: false,
      pdf_page_reload_attempted: false,
      transient_retry_count: 0,
      search_retry_count: 0,
      search_input_deadline_at: 0,
      search_deadline_at: 0,
      size_tab_deadline_at: 0,
      size_chart_deadline_at: 0,
      pdf_button_deadline_at: 0,
      pdf_deadline_at: 0,
      pdf_read_candidates: [],
      pdf_read_attempt_count: 0,
      pdf_read_deadline_at: 0,
      pdf_read_last_error: '',
      pdf_download: null,
    }
  }

  if (testExports) {
    Object.assign(testExports, {
      STAGE_PRIORITY,
      normalizeStyleCodes,
      extractProductCode,
      safeFilePart,
      buildPdfFilename,
      buildDirectPdfUrl,
      buildPdfUrlCandidates,
      usableNavigationUrl,
      arrayBufferToBase64,
      stageOfRowText,
      pickBestStageRow,
      firstDownloadItem,
      deadlineAt,
      deadlineExpired,
      RUN_PAGE_BATCH_SIZE,
      complete,
      shouldContinueNextPage,
    })
    return { success: true, data: [], meta: { has_more: false } }
  }

  try {
    if (phase === 'main') {
      if (shared.run_initialized && shared.current_style_code) {
        return nextPhase('search_style', 0, shared)
      }
      return nextPhase('search_style', 0, prepareRun())
    }

    if (findLoadErrorDialog()) {
      dismissLoadErrorDialog()
      return retryCurrentAfterTransientError('Failed to load the page!')
    }

    if (phase === 'search_style') {
      const styleCode = compact(shared.current_style_code)
      const inputDeadline = deadlineAt(shared.search_input_deadline_at, PAGE_TIMEOUT_MS)
      const input = findHeaderSearchInput()
      if (!input) {
        if (!deadlineExpired(inputDeadline)) {
          return nextPhase('search_style', PHASE_POLL_MS, {
            ...shared,
            search_input_deadline_at: inputDeadline,
          })
        }
        return finishCurrent(false, { remark: '未找到页面顶部款式搜索框' })
      }
      setNativeValue(input, styleCode)
      const button = findSearchButton(input)
      const point = pointOf(button)
      if (!point) return finishCurrent(false, { remark: '未找到搜索框右侧的放大镜按钮' })
      return cdpClick(point, 'wait_search_result', 200, {
        ...shared,
        search_input_deadline_at: 0,
        search_started_at: 0,
        search_deadline_at: 0,
      })
    }

    if (phase === 'wait_search_result') {
      const styleCode = compact(shared.current_style_code)
      const searchDeadline = deadlineAt(shared.search_deadline_at, SEARCH_TIMEOUT_MS)
      const result = findStyleResultLink(styleCode)
      if (!result) {
        if (!deadlineExpired(searchDeadline)) {
          return nextPhase('wait_search_result', PHASE_POLL_MS, {
            ...shared,
            search_started_at: Number(shared.search_started_at || 0) || Date.now(),
            search_deadline_at: searchDeadline,
          })
        }
        return retryCurrentSearchAfterTimeout()
      }
      const productCode = extractProductCode(result.text, styleCode)
      const point = pointOf(result.element || result.row)
      if (!point) return finishCurrent(false, { productCode, remark: '产品链接出现，但无法点击' })
      return cdpClick(point, 'open_size_chart_tab', 700, {
        ...shared,
        search_deadline_at: 0,
        current_product_code: productCode,
        product_link_text: result.text,
        search_result_href: result.href,
        search_result_data_url: result.dataUrl,
        direct_navigation_attempted: false,
      })
    }

    if (phase === 'open_size_chart_tab') {
      const firstWait = shared.direct_navigation_attempted ? PAGE_TIMEOUT_MS : 8_000
      const tabDeadline = deadlineAt(shared.size_tab_deadline_at, firstWait)
      const tab = findTextControl('尺寸表单')
      if (!tab) {
        if (!deadlineExpired(tabDeadline)) {
          return nextPhase('open_size_chart_tab', PHASE_POLL_MS, {
            ...shared,
            size_tab_deadline_at: tabDeadline,
          })
        }
        if (shared.search_result_href && !shared.direct_navigation_attempted) {
          try { location.assign(shared.search_result_href) } catch (error) {}
          return nextPhase('open_size_chart_tab', 1200, {
            ...shared,
            direct_navigation_attempted: true,
            size_tab_deadline_at: Date.now() + PAGE_TIMEOUT_MS,
          })
        }
        return finishCurrent(false, { remark: '进入产品后未找到“尺寸表单”页签' })
      }
      const point = pointOf(tab)
      if (!point) return finishCurrent(false, { remark: '“尺寸表单”页签无法点击' })
      return cdpClick(point, 'choose_best_size_chart', 800, {
        ...shared,
        size_tab_deadline_at: 0,
      })
    }

    if (phase === 'choose_best_size_chart') {
      const chartDeadline = deadlineAt(shared.size_chart_deadline_at, PAGE_TIMEOUT_MS)
      const best = findBestSizeChartLink()
      if (!best) {
        if (!deadlineExpired(chartDeadline)) {
          return nextPhase('choose_best_size_chart', PHASE_POLL_MS, {
            ...shared,
            size_chart_deadline_at: chartDeadline,
          })
        }
        return finishCurrent(false, { remark: '未找到大货、订货、试销单、内评或初版尺码表链接' })
      }
      const productCode = shared.current_product_code || extractProductCode(best.text, shared.current_style_code)
      const point = pointOf(best.link)
      if (!point) return finishCurrent(false, { productCode, stage: best.stage, remark: '最优尺码表链接无法点击' })
      return cdpClick(point, 'open_pdf', 900, {
        ...shared,
        size_chart_deadline_at: 0,
        current_product_code: productCode,
        current_stage: best.stage,
        selected_chart_text: best.text,
        selected_chart_href: best.href,
        selected_chart_data_url: best.dataUrl,
        chart_direct_navigation_attempted: false,
        pdf_button_deadline_at: Date.now() + DETAIL_CLICK_WAIT_MS,
      })
    }

    if (phase === 'open_pdf') {
      const buttonDeadline = deadlineAt(shared.pdf_button_deadline_at, PAGE_TIMEOUT_MS)
      const button = findPdfButton()
      if (!button) {
        if (!deadlineExpired(buttonDeadline)) {
          return nextPhase('open_pdf', PHASE_POLL_MS, {
            ...shared,
            pdf_button_deadline_at: buttonDeadline,
          })
        }
        if (!shared.chart_direct_navigation_attempted) {
          const targetUrl = usableNavigationUrl(shared.selected_chart_href, shared.selected_chart_data_url)
          if (targetUrl) {
            try { location.assign(targetUrl) } catch (error) {}
            return nextPhase('open_pdf', 1200, {
              ...shared,
              chart_direct_navigation_attempted: true,
              pdf_button_deadline_at: Date.now() + PAGE_TIMEOUT_MS,
            })
          }
        }
        return finishCurrent(false, { remark: '尺码表详情页未找到右上角 PDF 图标' })
      }
      const root = button.closest?.(
        '[data-csi-automation="plugin-SizeChartRevision-TDS-pdf"], .csi-toolbar-btn-pdf[widgetid]',
      ) || button
      const widget = window.dijit?.registry?.byNode?.(root)
        || window.dijit?.byId?.(root?.getAttribute?.('widgetid') || root?.id)
      if (widget?.disabled && !shared.pdf_page_reload_attempted) {
        try { location.reload() } catch (error) {}
        return nextPhase('open_pdf', 2000, {
          ...shared,
          pdf_page_reload_attempted: true,
          pdf_button_deadline_at: Date.now() + PAGE_TIMEOUT_MS,
        })
      }
      try {
        if (!await activatePdfButton(button)) {
          return finishCurrent(false, { remark: 'PDF 图标出现，但无法触发真实点击动作' })
        }
      } catch (error) {
        restorePdfPopupGuard()
        return finishCurrent(false, { remark: `PDF 图标点击失败：${compact(error?.message || error)}` })
      }
      return nextPhase('wait_pdf_result', 1000, {
        ...shared,
        pdf_button_deadline_at: 0,
        pdf_deadline_at: Date.now() + PDF_TIMEOUT_MS,
      })
    }

    if (phase === 'wait_pdf_result') {
      const result = window.__CRAWSHRIMP_PDF_RESULT__ || {}
      if (!result.done) {
        if (Date.now() >= Number(shared.pdf_deadline_at || 0)) {
          return finishCurrent(false, { remark: '点击 PDF 后等待 2 分钟，仍未生成 PDF 页面' })
        }
        return nextPhase('wait_pdf_result', 1000, shared)
      }
      if (!result.ok || !result.file) {
        return finishCurrent(false, { remark: result.message || result.status || 'PDF 生成失败' })
      }
      restorePdfPopupGuard(false)
      const pdfCandidates = buildPdfUrlCandidates(result)
      if (!pdfCandidates.length) {
        closePdfPopupWindow(result)
        return finishCurrent(false, { remark: 'PDF 已生成，但未取得下载地址' })
      }
      const filename = buildPdfFilename(shared.current_product_code, shared.current_style_code)
      closePdfPopupWindow(result)
      return nextPhase('read_pdf_content', 600, {
        ...shared,
        current_filename: filename,
        pdf_read_candidates: pdfCandidates,
        pdf_read_attempt_count: 0,
        pdf_read_deadline_at: Date.now() + PDF_READ_DEADLINE_MS,
        pdf_read_last_error: '',
        pdf_download: null,
      })
    }

    if (phase === 'read_pdf_content') {
      const candidates = uniqueUrls(shared.pdf_read_candidates)
      const attempt = Math.max(0, Number(shared.pdf_read_attempt_count || 0))
      if (!candidates.length) {
        return finishCurrent(false, {
          filename: shared.current_filename,
          remark: 'PDF 已生成，但没有可读取的下载地址',
        })
      }
      const candidate = candidates[attempt % candidates.length]
      let pdfDataUrl = ''
      try {
        pdfDataUrl = await fetchPdfDataUrl(candidate, Math.min(20_000, PDF_TIMEOUT_MS))
      } catch (error) {
        const lastError = compact(error?.message || error)
        const nextAttempt = attempt + 1
        const expired = Date.now() >= Number(shared.pdf_read_deadline_at || 0)
        if (nextAttempt < PDF_READ_MAX_ATTEMPTS && !expired) {
          return nextPhase('read_pdf_content', PDF_READ_RETRY_MS, {
            ...shared,
            pdf_read_attempt_count: nextAttempt,
            pdf_read_last_error: lastError,
          })
        }
        return downloadPdf(candidates[0], shared.current_filename, {
          ...shared,
          pdf_url: candidates[0],
          pdf_read_last_error: lastError,
          pdf_download: null,
        })
      }
      return downloadPdf(pdfDataUrl, shared.current_filename, {
        ...shared,
        pdf_url: candidate,
        pdf_download: null,
      })
    }

    if (phase === 'finish_pdf_download') {
      const item = firstDownloadItem(shared.pdf_download)
      if (!item?.success) {
        return finishCurrent(false, {
          filename: shared.current_filename,
          remark: compact(
            item?.error
            || (shared.pdf_read_last_error
              ? `PDF 地址已生成，但文件下载失败；读取错误：${shared.pdf_read_last_error}`
              : 'PDF 地址已生成，但文件下载失败'),
          ),
        })
      }
      return finishCurrent(true, {
        filename: item.filename || shared.current_filename,
        runtimePath: item.path || '',
      })
    }

    return finishCurrent(false, { remark: `未知执行阶段：${phase}` })
  } catch (error) {
    if (shared.current_style_code) {
      return finishCurrent(false, { remark: compact(error?.message || error || '未知异常') })
    }
    return { success: false, data: [], error: compact(error?.message || error || '尺码表 PDF 下载失败') }
  }
})()
