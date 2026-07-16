;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const MEMBER_BASE_URL = 'https://market.m.taobao.com/app/sj/member-center-rax/pages/pages_index_index?wh_weex=true&source=ShopSelfUse&sellerId='
  const DEFAULT_WAIT_ATTEMPTS = 12

  function compact(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  }

  function toInteger(value, fallback = 0) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.trunc(parsed)
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
    if (Array.isArray(file?.rows)) rows.push(...file.rows)
    const sheets = file?.sheets || file?.workbook_tables || file?.workbookTables
    if (sheets && typeof sheets === 'object') {
      for (const sheet of Object.values(sheets)) {
        if (Array.isArray(sheet?.rows) && sheet.rows !== file?.rows) rows.push(...sheet.rows)
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

  function buildScreenshotFilename(target) {
    const shop = sanitizeFilename(target?.shopName || '会员中心')
    const sellerId = sanitizeFilename(target?.sellerId || 'unknown')
    const duplicateNo = toInteger(target?.duplicateNo, 1)
    const duplicateSuffix = duplicateNo > 1 ? `_${duplicateNo}` : ''
    return `${shop}_${sellerId}_会员中心_fullpage${duplicateSuffix}.png`
  }

  function pageStatus(target) {
    const href = String(location.href || '')
    const bodyText = String(document.body?.innerText || '')
    const sellerId = compact(target?.sellerId)
    const hrefMatches = sellerId ? href.includes(`sellerId=${sellerId}`) : href === target?.url
    const loginBlocked = /login\.(taobao|tmall)\.com/i.test(location.hostname || '') || /亲，请登录|扫码登录|密码登录/.test(bodyText)
    return {
      href,
      title: document.title || '',
      hrefMatches,
      readyState: document.readyState || '',
      bodyTextLength: bodyText.trim().length,
      loginBlocked,
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
      parseSellerId,
      normalizeMemberUrl,
      normalizeMemberRows,
      parseMemberUrlLines,
      collectInputRows,
      buildScreenshotFilename,
      buildResultRow,
    })
    return complete([])
  }

  if (phase === 'main') {
    const parsed = normalizeMemberRows(collectInputRows(params))
    const fallback = currentPageTarget()
    const queue = parsed.rows.length ? parsed.rows : (fallback ? [fallback] : [])
    const nextShared = {
      ...shared,
      queue,
      cursor: 0,
      total_rows: queue.length,
      current_exec_no: 0,
      output_dir: compact(params.output_dir),
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
    if (status.loginBlocked) {
      const row = buildResultRow(target, {
        status: '失败',
        note: '页面进入登录态，请先在 9222 浏览器完成登录后重试',
        pageTitle: status.title,
        pageUrl: status.href,
      })
      return nextPhase('open_page', 0, {
        ...shared,
        cursor: toInteger(shared.cursor, 0) + 1,
      }, [row])
    }
    if ((!status.hrefMatches || status.readyState === 'loading' || status.bodyTextLength < 10) && attempts < DEFAULT_WAIT_ATTEMPTS) {
      return nextPhase('wait_page', 1000, {
        ...shared,
        wait_attempts: attempts + 1,
      })
    }
    return {
      success: true,
      data: [],
      meta: {
        action: 'capture_screenshot',
        filename: buildScreenshotFilename(target),
        label: `${target.shopName} 会员中心整页截图`,
        full_page: true,
        scroll_before_capture: true,
        scroll_rounds: toInteger(params.scroll_rounds, 2),
        settle_ms: 800,
        target_dir: compact(shared.output_dir || params.output_dir),
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
    return nextPhase('open_page', 0, {
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
