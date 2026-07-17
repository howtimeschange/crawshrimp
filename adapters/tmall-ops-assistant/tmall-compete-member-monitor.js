;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const MEMBER_BASE_URL = 'https://market.m.taobao.com/app/sj/member-center-rax/pages/pages_index_index?wh_weex=true&source=ShopSelfUse&sellerId='
  const DEFAULT_WAIT_ATTEMPTS = 12
  const MIN_MEMBER_SCROLL_HEIGHT = 1600

  function compact(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  }

  function toInteger(value, fallback = 0) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.trunc(parsed)
  }

  function clampInteger(value, fallback, min, max) {
    const parsed = toInteger(value, fallback)
    return Math.max(min, Math.min(max, parsed))
  }

  function sanitizeFilename(value, fallback = 'member-page') {
    const text = compact(value)
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/[\x00-\x1f]+/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[._\s-]+|[._\s-]+$/g, '')
    return text || fallback
  }

  function formatCaptureDate(value) {
    const date = value instanceof Date ? value : (value ? new Date(value) : new Date())
    if (!Number.isFinite(date.getTime())) return formatCaptureDate()
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  function getValue(row, keys) {
    if (!row || typeof row !== 'object') return ''
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(row, key)) {
        const value = compact(row[key])
        if (value) return value
      }
    }
    const normalized = new Map(
      Object.entries(row).map(([key, value]) => [
        compact(key).toLowerCase().replace(/\s+/g, ''),
        value,
      ]),
    )
    for (const key of keys) {
      const value = compact(normalized.get(compact(key).toLowerCase().replace(/\s+/g, '')))
      if (value) return value
    }
    return ''
  }

  function parseSellerId(...values) {
    for (const value of values) {
      const text = compact(value)
      if (!text) continue
      const direct = text.match(/^\d{5,}$/)
      if (direct) return direct[0]
      const fromQuery = text.match(/[?&]sellerId=(\d{5,})/i)
      if (fromQuery) return fromQuery[1]
      const loose = text.match(/\b(\d{5,})\b/)
      if (loose) return loose[1]
    }
    return ''
  }

  function normalizeMemberUrl(rawUrl, sellerId = '') {
    const text = compact(rawUrl)
    const resolvedSellerId = parseSellerId(sellerId, text)
    if (text && /^https?:\/\//i.test(text)) {
      try {
        const url = new URL(text)
        if (!/market\.m\.taobao\.com$/i.test(url.hostname)) return ''
        if (!/member-center-rax\/pages\/pages_index_index/.test(url.pathname)) return ''
        if (resolvedSellerId && !url.searchParams.get('sellerId')) {
          url.searchParams.set('sellerId', resolvedSellerId)
        }
        return url.href
      } catch (error) {
        return ''
      }
    }
    if (resolvedSellerId) return `${MEMBER_BASE_URL}${encodeURIComponent(resolvedSellerId)}`
    return ''
  }

  function isHeaderLike(value) {
    const text = compact(value)
    return !text || ['竞品店铺', '店铺名称', '会员中心固定链接', 'seller ID', '会员中心-完整链接'].includes(text)
  }

  function normalizeMemberRows(rows) {
    const sourceRows = Array.isArray(rows) ? rows : []
    const validRows = []
    const invalidRows = []
    const seenCounts = new Map()
    for (let index = 0; index < sourceRows.length; index += 1) {
      const row = sourceRows[index] || {}
      const rowNo = toInteger(row.__row_no || row.__row_index, index + 2)
      const shopName = getValue(row, ['竞品店铺', '店铺名称', '品牌', 'shopName', 'shop_name', '店铺'])
      const rawSellerId = getValue(row, ['seller ID', 'sellerID', 'sellerId', 'seller_id', '卖家ID'])
      const rawUrl = getValue(row, ['会员中心-完整链接', '会员中心完整链接', '会员中心链接', '完整链接', 'url', 'URL', 'link'])
      const fixedUrl = getValue(row, ['会员中心固定链接', '固定链接'])
      const sellerId = parseSellerId(rawSellerId, rawUrl)
      const url = normalizeMemberUrl(rawUrl, sellerId) || normalizeMemberUrl(fixedUrl, sellerId)

      if (isHeaderLike(shopName) && !sellerId && !url) continue
      if (!sellerId || !url) {
        invalidRows.push(buildResultRow({
          rowNo,
          shopName: shopName || '未命名店铺',
          sellerId,
          url: rawUrl || fixedUrl,
        }, {
          status: '已跳过',
          note: '缺少有效 seller ID 或会员中心完整链接',
        }))
        continue
      }

      const key = `${sellerId}:${url}`
      const duplicateNo = (seenCounts.get(key) || 0) + 1
      seenCounts.set(key, duplicateNo)
      validRows.push({
        rowNo,
        shopName: shopName || `seller_${sellerId}`,
        sellerId,
        url,
        duplicateNo,
      })
    }

    return {
      rows: validRows,
      invalidRows,
    }
  }

  function parseMemberUrlLines(value) {
    const rows = []
    for (const line of String(value || '').split(/\r?\n/)) {
      const text = compact(line)
      if (!text) continue
      const urlMatch = text.match(/https?:\/\/\S+/i)
      const url = urlMatch ? urlMatch[0].replace(/[，,;；]+$/g, '') : ''
      const sellerId = parseSellerId(url, text)
      const prefix = url ? text.slice(0, text.indexOf(url)).trim() : ''
      rows.push({
        竞品店铺: prefix || (sellerId ? `seller_${sellerId}` : '会员中心'),
        'seller ID': sellerId,
        '会员中心-完整链接': url || (sellerId ? `${MEMBER_BASE_URL}${sellerId}` : ''),
      })
    }
    return rows
  }

  function collectInputRows(rawParams = params) {
    const rows = []
    const file = rawParams.input_file || rawParams.member_file || rawParams.file
    const hasTopLevelRows = Array.isArray(file?.rows) && file.rows.length > 0
    if (hasTopLevelRows) rows.push(...file.rows)
    const sheets = file?.sheets || file?.workbook_tables || file?.workbookTables
    const activeSheetName = compact(file?.sheet_name || file?.sheetName || file?.active_sheet_name)
    if (sheets && typeof sheets === 'object') {
      for (const [sheetName, sheet] of Object.entries(sheets)) {
        if (hasTopLevelRows && (
          (activeSheetName && compact(sheetName) === activeSheetName)
          || sheet?.rows === file?.rows
        )) continue
        if (Array.isArray(sheet?.rows)) rows.push(...sheet.rows)
      }
    }
    rows.push(...parseMemberUrlLines(rawParams.member_urls || rawParams.urls || rawParams.links))
    return rows
  }

  function currentPageTarget() {
    const href = String(location.href || '')
    const sellerId = parseSellerId(href)
    const url = normalizeMemberUrl(href, sellerId)
    if (!sellerId || !url) return null
    return {
      rowNo: 1,
      shopName: compact(params.current_shop_name || params.shop_name) || '当前会员页',
      sellerId,
      url,
    }
  }

  function buildScreenshotFilename(target, captureDate = formatCaptureDate()) {
    const shop = sanitizeFilename(target?.shopName || '会员中心')
    const sellerId = sanitizeFilename(target?.sellerId || 'unknown')
    const duplicateNo = toInteger(target?.duplicateNo, 1)
    const duplicateSuffix = duplicateNo > 1 ? `_${duplicateNo}` : ''
    return `${captureDate}_${shop}_${sellerId}_会员中心_fullpage${duplicateSuffix}.png`
  }

  function buildScreenshotFolderName(rawParams = params, captureDate = formatCaptureDate()) {
    const custom = compact(rawParams.screenshot_folder_name || rawParams.screenshotFolderName || rawParams.folder_name)
    return sanitizeFilename(custom || `${captureDate}_竞品会员页面监控`, `${captureDate}_竞品会员页面监控`)
  }

  function buildScreenshotRelativePath(target, captureDate, folderName) {
    const safeFolder = sanitizeFilename(folderName || `${captureDate}_竞品会员页面监控`, `${captureDate}_竞品会员页面监控`)
    return `${safeFolder}/${buildScreenshotFilename(target, captureDate)}`
  }

  function normalizePacing(rawParams = params) {
    const minSeconds = clampInteger(rawParams.pacing_min_seconds, 8, 0, 300)
    const maxSeconds = Math.max(minSeconds, clampInteger(rawParams.pacing_max_seconds, 15, 0, 300))
    return {
      minSeconds,
      maxSeconds,
      cooldownEvery: clampInteger(rawParams.cooldown_every, 8, 0, 100),
      cooldownSeconds: clampInteger(rawParams.cooldown_seconds, 120, 0, 1800),
    }
  }

  function computePacingDelayMs(rawParams, completedCount) {
    const pacing = normalizePacing(rawParams)
    let delaySeconds = 0
    if (pacing.maxSeconds > 0) {
      const spread = Math.max(0, pacing.maxSeconds - pacing.minSeconds)
      delaySeconds += pacing.minSeconds + Math.round(Math.random() * spread)
    }
    if (
      pacing.cooldownEvery > 0 &&
      pacing.cooldownSeconds > 0 &&
      completedCount > 0 &&
      completedCount % pacing.cooldownEvery === 0
    ) {
      delaySeconds += pacing.cooldownSeconds
    }
    return Math.max(0, delaySeconds * 1000)
  }

  function captureSettleMs(rawParams = params) {
    return clampInteger(rawParams.capture_settle_seconds, 3, 0, 30) * 1000
  }

  function detectBlockReason(hostname, bodyText) {
    const host = String(hostname || '')
    const text = String(bodyText || '')
    if (/login\.(taobao|tmall)\.com/i.test(host) || /亲，请登录|扫码登录|密码登录/.test(text)) {
      return '页面进入登录态，请先在 9222 浏览器完成登录后重试'
    }
    if (
      /(^|\.)?(punish|sec)\.(taobao|tmall)\.com$/i.test(host) ||
      /安全验证|访问受限|访问过于频繁|操作频繁|滑动验证|拖动滑块|验证码|验证一下|请稍后再试|风险|风控/.test(text)
    ) {
      return '检测到疑似淘宝安全验证或访问频率限制，已停止后续任务；建议等待一段时间后重试，并调慢节奏参数'
    }
    return ''
  }

  function detectPageErrorReason(bodyText) {
    const text = String(bodyText || '')
    if (/服务溜了小差|小二很忙|页面走丢|页面不存在|页面加载失败|系统繁忙|网络竟然崩溃了|哎呀.*出错|刷新试试/.test(text)) {
      return '会员中心页面异常或平台繁忙，本条未截图；建议稍后用更慢节奏重试'
    }
    return ''
  }

  function pageStatus(target) {
    const href = String(location.href || '')
    const bodyText = String(document.body?.innerText || '')
    const sellerId = compact(target?.sellerId)
    const hrefMatches = sellerId ? href.includes(`sellerId=${sellerId}`) : href === target?.url
    const blockReason = detectBlockReason(location.hostname, bodyText)
    const pageErrorReason = detectPageErrorReason(bodyText)
    const scrollHeight = Math.max(
      document.documentElement?.scrollHeight || 0,
      document.body?.scrollHeight || 0,
      0,
    )
    const viewportHeight = Math.max(
      document.documentElement?.clientHeight || 0,
      window.innerHeight || 0,
      0,
    )
    const shortPage = hrefMatches && scrollHeight > 0 && scrollHeight < Math.max(MIN_MEMBER_SCROLL_HEIGHT, viewportHeight + 300)
    return {
      href,
      title: document.title || '',
      hrefMatches,
      readyState: document.readyState || '',
      bodyTextLength: bodyText.trim().length,
      blockReason,
      pageErrorReason,
      scrollHeight,
      viewportHeight,
      shortPage,
    }
  }

  function buildResultRow(target, result = {}) {
    const item = (Array.isArray(result.screenshot?.items) ? result.screenshot.items[0] : null) || {}
    return {
      表格行号: target?.rowNo || '',
      店铺名称: target?.shopName || '',
      'seller ID': target?.sellerId || '',
      会员中心链接: target?.url || '',
      页面标题: result.pageTitle || item.pageTitle || '',
      页面URL: result.pageUrl || item.pageUrl || '',
      截图文件: item.path || result.screenshotPath || '',
      截图宽度: item.width || '',
      截图高度: item.height || '',
      执行结果: result.status || (item.success ? '已截图' : '截图失败'),
      备注: result.note || item.error || '',
    }
  }

  function buildStoppedRows(queue, startIndex, reason) {
    return (Array.isArray(queue) ? queue.slice(startIndex) : []).map(target => buildResultRow(target, {
      status: '已跳过',
      note: reason,
    }))
  }

  function nextPhase(next, sleepMs, nextShared, data = []) {
    return {
      success: true,
      data,
      meta: {
        action: 'next_phase',
        next_phase: next,
        sleep_ms: sleepMs,
        shared: nextShared,
      },
    }
  }

  function complete(data, nextShared = shared) {
    return {
      success: true,
      data,
      meta: {
        action: 'complete',
        has_more: false,
        shared: nextShared,
      },
    }
  }

  if (phase === '__exports__' && testExports) {
    Object.assign(testExports, {
      MEMBER_BASE_URL,
      sanitizeFilename,
      formatCaptureDate,
      parseSellerId,
      normalizeMemberUrl,
      normalizeMemberRows,
      parseMemberUrlLines,
      collectInputRows,
      buildScreenshotFilename,
      buildScreenshotFolderName,
      buildScreenshotRelativePath,
      buildResultRow,
      normalizePacing,
      computePacingDelayMs,
      captureSettleMs,
      detectBlockReason,
      detectPageErrorReason,
      buildStoppedRows,
    })
    return complete([])
  }

  if (phase === 'main') {
    const parsed = normalizeMemberRows(collectInputRows(params))
    const fallback = currentPageTarget()
    const queue = parsed.rows.length ? parsed.rows : (fallback ? [fallback] : [])
    const captureDate = formatCaptureDate()
    const screenshotFolderName = buildScreenshotFolderName(params, captureDate)
    const nextShared = {
      ...shared,
      queue,
      cursor: 0,
      total_rows: queue.length,
      current_exec_no: 0,
      output_dir: compact(params.output_dir),
      capture_date: captureDate,
      screenshot_folder_name: screenshotFolderName,
      wait_attempts: 0,
    }
    if (!queue.length) {
      return complete(parsed.invalidRows.length ? parsed.invalidRows : [buildResultRow({
        rowNo: '',
        shopName: '',
        sellerId: '',
        url: '',
      }, {
        status: '失败',
        note: '没有找到可截图的会员中心链接；请上传 Excel、粘贴 URL，或在当前 tab 打开会员中心页面',
      })], nextShared)
    }
    return nextPhase('open_page', 0, nextShared, parsed.invalidRows)
  }

  if (phase === 'open_page') {
    const queue = Array.isArray(shared.queue) ? shared.queue : []
    const cursor = Math.max(0, toInteger(shared.cursor, 0))
    if (cursor >= queue.length) return complete([], shared)
    const target = queue[cursor]
    const status = pageStatus(target)
    const nextShared = {
      ...shared,
      current_target: target,
      current_exec_no: cursor + 1,
      wait_attempts: 0,
      last_screenshot: null,
    }
    if (!status.hrefMatches) {
      location.href = target.url
      return nextPhase('wait_page', 2200, nextShared)
    }
    return nextPhase('wait_page', 800, nextShared)
  }

  if (phase === 'wait_page') {
    const target = shared.current_target
    const status = pageStatus(target)
    const attempts = toInteger(shared.wait_attempts, 0)
    if (status.blockReason) {
      const queue = Array.isArray(shared.queue) ? shared.queue : []
      const cursor = Math.max(0, toInteger(shared.cursor, 0))
      const row = buildResultRow(target, {
        status: '失败',
        note: status.blockReason,
        pageTitle: status.title,
        pageUrl: status.href,
      })
      return complete([row, ...buildStoppedRows(queue, cursor + 1, status.blockReason)], {
        ...shared,
        cursor: queue.length,
        wait_attempts: 0,
      })
    }
    if (status.pageErrorReason && attempts < 2) {
      location.reload()
      return nextPhase('wait_page', 4000, {
        ...shared,
        wait_attempts: attempts + 1,
      })
    }
    if (
      (!status.hrefMatches || status.readyState === 'loading' || status.bodyTextLength < 10 || status.shortPage) &&
      attempts < DEFAULT_WAIT_ATTEMPTS
    ) {
      return nextPhase('wait_page', 1000, {
        ...shared,
        wait_attempts: attempts + 1,
      })
    }
    if (status.pageErrorReason || status.shortPage) {
      const row = buildResultRow(target, {
        status: '失败',
        note: status.pageErrorReason || `页面高度异常（${status.scrollHeight}px），为避免保存错位/错误页已跳过本条`,
        pageTitle: status.title,
        pageUrl: status.href,
      })
      const completedCount = toInteger(shared.current_exec_no, toInteger(shared.cursor, 0) + 1)
      const delayMs = computePacingDelayMs(params, completedCount)
      return nextPhase('open_page', delayMs, {
        ...shared,
        cursor: toInteger(shared.cursor, 0) + 1,
        wait_attempts: 0,
      }, [row])
    }
    return {
      success: true,
      data: [],
      meta: {
        action: 'capture_screenshot',
        filename: buildScreenshotFilename(target, shared.capture_date),
        label: `${target.shopName} 会员中心整页截图`,
        full_page: true,
        scroll_before_capture: true,
        scroll_rounds: toInteger(params.scroll_rounds, 2),
        scroll_step: 480,
        scroll_delay_ms: 260,
        settle_ms: captureSettleMs(params),
        neutralize_fixed: true,
        target_dir: compact(shared.output_dir || params.output_dir),
        target_relative_path: buildScreenshotRelativePath(
          target,
          shared.capture_date || formatCaptureDate(),
          shared.screenshot_folder_name || buildScreenshotFolderName(params, shared.capture_date),
        ),
        shared_key: 'last_screenshot',
        next_phase: 'record_screenshot',
        strict: true,
        shared,
      },
    }
  }

  if (phase === 'record_screenshot') {
    const target = shared.current_target
    const screenshot = shared.last_screenshot || {}
    const item = Array.isArray(screenshot.items) ? screenshot.items[0] : null
    const status = screenshot.ok && (!item || item.success !== false) ? '已截图' : '截图失败'
    const row = buildResultRow(target, {
      screenshot,
      status,
      note: status === '已截图' ? '' : compact(screenshot.error || item?.error || '截图失败'),
    })
    const completedCount = toInteger(shared.current_exec_no, toInteger(shared.cursor, 0) + 1)
    const delayMs = computePacingDelayMs(params, completedCount)
    return nextPhase('open_page', delayMs, {
      ...shared,
      cursor: toInteger(shared.cursor, 0) + 1,
      last_screenshot: null,
    }, [row])
  }

  return complete([buildResultRow(shared.current_target || {}, {
    status: '失败',
    note: `未知阶段：${phase}`,
  })], shared)
})()
