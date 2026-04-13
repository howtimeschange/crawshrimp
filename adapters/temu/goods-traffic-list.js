;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page = window.__CRAWSHRIMP_PAGE__ || 1
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const TARGET_URL = 'https://agentseller.temu.com/main/flux-analysis-full'
  const LIST_BUSY_RETRY_LIMIT = 30
  const LIST_PAGE_RECOVERY_LIMIT = 30
  const LIST_API_PAGE_SIZE = 100
  const LIST_API_RETRY_LIMIT = 4
  const LIST_API_RETRY_BACKOFF_MS = 800
  const LIST_API_RATE_LIMIT_BACKOFF_MS = 20000
  const LIST_API_TIMEOUT_BACKOFF_MS = 15000
  const LIST_API_REQUEST_THROTTLE_MS = 12000
  const LIST_API_SITE_SWITCH_THROTTLE_MS = 15000
  const LIST_API_RECOVERY_THROTTLE_MS = 18000
  const LIST_API_POST_RETRY_COOLDOWN_MS = 8000
  const LIST_API_PAGE_BURST_SIZE = 2
  const LIST_API_PAGE_BURST_COOLDOWN_MS = 60000
  const LIST_API_MAX_BACKOFF_MS = 60000
  const LIST_API_TIMEOUT_MS = 20000
  const LIST_READY_TIMEOUT_MS = 30000
  const SAFE_PAGE_LOOP_LIMIT = 120
  const PAGER_THROTTLE_MS = 2200
  const TEMU_REQUEST_MODULE_ID = '3204'
  const TEMU_LIST_ENDPOINT = '/api/seller/full/flow/analysis/goods/list'
  const TEMU_CATEGORY_CHILDREN_ENDPOINT = '/bg-anniston-agent-seller/category/children/list'
  const TEMU_TOO_MANY_VISITORS_CODE = 4000004

  const mode = String(params.mode || 'current').trim().toLowerCase()
  const outerSitesParam = normalizeArray(params.outer_sites)
  const listTimeRange = String(params.list_time_range || '').trim()
  const quickFilter = String(params.quick_filter || '全部').trim() || '全部'
  const productIdType = String(params.product_id_type || 'SPU').trim() || 'SPU'
  const productIdQuery = String(params.product_id_query || '').trim()
  const goodsNoType = String(params.goods_no_type || 'SKC货号').trim() || 'SKC货号'
  const goodsNoQuery = String(params.goods_no_query || '').trim()
  const categoryPath = String(params.category_path || '').trim()
  const productName = String(params.product_name || '').trim()

  const OUTER_SITE_BLACKLIST = new Set(['商家中心'])
  const QUICK_FILTER_OPTIONS = ['流量待增长', '短期增长中', '长期增长中']
  const LIST_TIME_DIMENSION_MAP = Object.freeze({
    昨日: 1,
    今日: 2,
    本周: 5,
    本月: 6,
    近7日: 3,
    近30日: 4,
  })
  const QUICK_FILTER_TYPE_MAP = Object.freeze({
    流量待增长: 1,
    短期增长中: 2,
    长期增长中: 3,
  })
  const PRODUCT_ID_FIELD_MAP = Object.freeze({
    SPU: 'productIdList',
    SKC: 'productSkcIdList',
    SKU: 'productSkuIdList',
  })
  const GOODS_NO_FIELD_MAP = Object.freeze({
    SKC货号: 'skcExtCodeList',
    SKU货号: 'skuExtCodeList',
  })
  const LIST_METRIC_COLUMN_KEYS = [
    '流量情况/曝光量',
    '流量情况/点击量',
    '流量情况/访客数',
    '流量情况/浏览量',
    '流量情况/加购人数',
    '流量情况/收藏人数',
    '流量情况/支付件数',
    '支付情况/支付订单数',
    '支付情况/买家数',
    '转化情况/转化率',
    '转化情况/点击率',
    '转化情况/点击后支付率',
    '搜索数据/曝光量',
    '搜索数据/点击量',
    '搜索数据/支付订单数',
    '搜索数据/支付件数',
    '推荐数据/曝光量',
    '推荐数据/点击量',
    '推荐数据/支付订单数',
    '推荐数据/支付件数',
    '增长潜力',
    '操作',
  ]

  function normalizeArray(value) {
    if (!Array.isArray(value)) return []
    return value.map(item => String(item || '').trim()).filter(Boolean)
  }

  function splitMultiValueText(value) {
    return String(value || '')
      .split(/[\s,\uFF0C\u3001]+/g)
      .map(item => String(item || '').trim())
      .filter(Boolean)
  }

  function parseNumericValueList(value) {
    return splitMultiValueText(value)
      .map(item => Number(item))
      .filter(item => Number.isFinite(item))
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

  function textOf(el) {
    return String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim()
  }

  function compact(value) {
    return String(value || '').replace(/\s+/g, '').trim()
  }

  function isVisible(el) {
    if (!el || typeof el.getClientRects !== 'function') return false
    return el.getClientRects().length > 0
  }

  function hasClassFragment(el, fragment) {
    return String(el?.className || '').includes(fragment)
  }

  function localNow() {
    const d = new Date()
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  function nextPhase(name, sleepMs = 1200, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: { action: 'next_phase', next_phase: name, sleep_ms: sleepMs, shared: newShared },
    }
  }

  function cdpClicks(clicks, nextPhaseName, sleepMs = 1200, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: { action: 'cdp_clicks', clicks, next_phase: nextPhaseName, sleep_ms: sleepMs, shared: newShared },
    }
  }

  function reloadPage(nextPhaseName, sleepMs = 2000, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: { action: 'reload_page', next_phase: nextPhaseName, sleep_ms: sleepMs, shared: newShared },
    }
  }

  function complete(data, hasMore = false, newShared = shared) {
    return {
      success: true,
      data,
      meta: { action: 'complete', has_more: hasMore, shared: newShared },
    }
  }

  function fail(message) {
    return { success: false, error: message }
  }

  function getTemuWebpackRequire() {
    if (window.__CRAWSHRIMP_TEMU_WEBPACK_REQUIRE__) return window.__CRAWSHRIMP_TEMU_WEBPACK_REQUIRE__
    const chunk = window.chunkLoadingGlobal_bgb_sca_main || window.webpackChunktemu_sca_container
    if (!chunk || typeof chunk.push !== 'function') return null
    try {
      chunk.push([[`crawshrimp_temu_${Date.now()}`], {}, req => {
        window.__CRAWSHRIMP_TEMU_WEBPACK_REQUIRE__ = req
      }])
    } catch (e) {}
    return window.__CRAWSHRIMP_TEMU_WEBPACK_REQUIRE__ || null
  }

  function getTemuRequestClient() {
    const req = getTemuWebpackRequire()
    if (!req) return null
    try {
      return req(TEMU_REQUEST_MODULE_ID)
    } catch (e) {
      return null
    }
  }

  function normalizeTemuApiError(error) {
    const plain = error && typeof error === 'object'
      ? { ...error }
      : { errorMsg: String(error || '') }
    const nested = plain?.response && typeof plain.response === 'object' ? plain.response : null
    const errorCode = Number(plain.errorCode || nested?.errorCode || 0) || 0
    const errorMsg = String(
      plain.errorMsg ||
      plain.message ||
      nested?.errorMsg ||
      nested?.message ||
      error ||
      '',
    ).trim()
    return {
      errorCode,
      errorMsg,
      raw: plain,
    }
  }

  function isTooManyVisitorsError(errorLike) {
    const info = normalizeTemuApiError(errorLike)
    return info.errorCode === TEMU_TOO_MANY_VISITORS_CODE || /Too many visitors/i.test(info.errorMsg)
  }

  function isNetworkTimeoutError(errorLike) {
    const info = normalizeTemuApiError(errorLike)
    return info.errorCode === 40002 || /Network Timeout/i.test(info.errorMsg)
  }

  function isRetriableListApiError(errorLike) {
    return isTooManyVisitorsError(errorLike) || isNetworkTimeoutError(errorLike)
  }

  function getListApiRetryBackoffMs(errorLike, attempt = 1) {
    const safeAttempt = Math.max(1, Number(attempt || 1))
    if (isTooManyVisitorsError(errorLike)) {
      return Math.min(LIST_API_MAX_BACKOFF_MS, LIST_API_RATE_LIMIT_BACKOFF_MS * safeAttempt)
    }
    if (isNetworkTimeoutError(errorLike)) {
      return Math.min(LIST_API_MAX_BACKOFF_MS, LIST_API_TIMEOUT_BACKOFF_MS * safeAttempt)
    }
    return LIST_API_RETRY_BACKOFF_MS * safeAttempt
  }

  function getListApiCollectDelayMs(sharedState = shared, options = {}) {
    const nextPageNo = Math.max(1, Number(options.nextPageNo || sharedState.currentPageNo || 1))
    let delayMs = LIST_API_REQUEST_THROTTLE_MS
    if (options.afterSiteSwitch || sharedState.switchedOuterSite) {
      delayMs = Math.max(delayMs, LIST_API_SITE_SWITCH_THROTTLE_MS)
    }
    if (options.afterRecovery || sharedState.recoveredListPage) {
      delayMs = Math.max(delayMs, LIST_API_RECOVERY_THROTTLE_MS)
    }
    const lastApiAttempt = Math.max(1, Number(sharedState.lastApiAttempt || 1))
    if (lastApiAttempt > 1) {
      delayMs += (lastApiAttempt - 1) * LIST_API_POST_RETRY_COOLDOWN_MS
    }
    const pendingCollectDelayMs = Math.max(0, Number(sharedState.pendingCollectDelayMs || 0))
    if (pendingCollectDelayMs > delayMs) delayMs = pendingCollectDelayMs
    if (
      LIST_API_PAGE_BURST_SIZE > 0 &&
      nextPageNo > LIST_API_PAGE_BURST_SIZE &&
      (nextPageNo - 1) % LIST_API_PAGE_BURST_SIZE === 0
    ) {
      delayMs += LIST_API_PAGE_BURST_COOLDOWN_MS
    }
    return delayMs
  }

  function getListPageRecoveryCooldownMs(sharedState = shared, reason = '') {
    if (!/Too many visitors|Network Timeout|请求超时/i.test(String(reason || ''))) return 2200
    const retryIndex = Math.max(1, Number(sharedState.listPageRetry || 0) + 1)
    return Math.min(LIST_API_MAX_BACKOFF_MS, LIST_API_RATE_LIMIT_BACKOFF_MS * retryIndex)
  }

  async function callTemuApi(endpoint, body = {}, options = {}) {
    const client = getTemuRequestClient()
    if (!client || typeof client.bE !== 'function') {
      return {
        ok: false,
        error: {
          errorCode: 0,
          errorMsg: '未找到 Temu 页面内置请求客户端，无法切换到 API 抓取',
        },
      }
    }
    try {
      const result = await Promise.race([
        client.bE(endpoint, body, options),
        new Promise((_, reject) => {
          setTimeout(() => {
            reject({
              errorCode: 0,
              errorMsg: `Temu API 请求超时（>${Math.round(LIST_API_TIMEOUT_MS / 1000)} 秒）`,
              success: false,
              result: null,
            })
          }, LIST_API_TIMEOUT_MS)
        }),
      ])
      return { ok: true, result }
    } catch (error) {
      return { ok: false, error: normalizeTemuApiError(error) }
    }
  }

  function clickLike(el) {
    if (!el) return false
    try { el.scrollIntoView({ block: 'center', inline: 'center' }) } catch (e) {}
    try { el.focus?.() } catch (e) {}
    try { el.click?.() } catch (e) {}
    for (const eventName of ['pointerenter', 'pointerdown', 'pointerup']) {
      try {
        if (typeof PointerEvent !== 'undefined') {
          el.dispatchEvent(new PointerEvent(eventName, { bubbles: true, cancelable: true }))
        }
      } catch (e) {}
    }
    for (const eventName of ['mouseenter', 'mousedown', 'mouseup', 'click']) {
      try {
        el.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true }))
      } catch (e) {}
    }
    return true
  }

  function clickPagerLike(el) {
    if (!el) return false
    try { el.scrollIntoView({ block: 'center', inline: 'center' }) } catch (e) {}
    try { el.focus?.() } catch (e) {}
    try { el.click?.() } catch (e) {}
    return true
  }

  function getCenterClick(el, delayMs = 120) {
    if (!el) return null
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      delay_ms: delayMs,
    }
  }

  async function waitFor(condition, timeout = 8000, interval = 300) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (condition()) return true
      await sleep(interval)
    }
    return false
  }

  function hasBusyWarning() {
    return /Too many visitors, please try again later\./i.test(textOf(document.body))
  }

  function getVisibleDrawer() {
    const candidates = [
      ...document.querySelectorAll('[class*="Drawer_content_"]'),
      ...document.querySelectorAll('[class*="Drawer_outerWrapper_"]'),
    ].filter(isVisible)
    return candidates.find(el => el.querySelector('table') || /商品数据分析/.test(textOf(el))) || null
  }

  function isInsideVisibleDrawer(el) {
    const drawer = getVisibleDrawer()
    return !!(drawer && el && drawer.contains(el))
  }

  function findMainButton(text) {
    return [...document.querySelectorAll('button')]
      .filter(isVisible)
      .find(btn => !isInsideVisibleDrawer(btn) && textOf(btn) === text) || null
  }

  function getOuterSiteNodes() {
    return [...document.querySelectorAll('a[class*="index-module__drItem___"]')]
      .filter(isVisible)
      .filter(node => {
        const label = textOf(node)
        return label && !OUTER_SITE_BLACKLIST.has(label)
      })
  }

  function getAvailableOuterSites() {
    return getOuterSiteNodes()
      .filter(node => !hasClassFragment(node, 'index-module__disabled___'))
      .map(node => ({
        text: textOf(node),
        active: hasClassFragment(node, 'index-module__active___'),
      }))
  }

  function getActiveOuterSite() {
    const node = getOuterSiteNodes().find(item => hasClassFragment(item, 'index-module__active___'))
    return textOf(node)
  }

  async function waitForTargetOuterSite(targetSite, timeout = 30000) {
    if (!targetSite) return true
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (getResolvedOuterSite() === targetSite) return true
      await sleep(200)
    }
    return false
  }

  function buildTargetOuterSites() {
    const available = getAvailableOuterSites().map(item => item.text)
    const requested = outerSitesParam.length ? outerSitesParam.filter(item => available.includes(item)) : available
    return { available, target: [...new Set(requested)] }
  }

  function getOuterSiteClick(siteLabel) {
    const node = getOuterSiteNodes().find(item =>
      textOf(item) === siteLabel &&
      !hasClassFragment(item, 'index-module__disabled___'),
    )
    return getCenterClick(node)
  }

  function getOuterSiteUrl(siteLabel) {
    const hostMap = {
      全球: 'agentseller.temu.com',
      美国: 'agentseller-us.temu.com',
      欧区: 'agentseller-eu.temu.com',
    }
    const host = hostMap[siteLabel]
    if (!host) return ''
    const url = new URL(TARGET_URL)
    url.hostname = host
    return url.toString()
  }

  function getOuterSiteFromHostname() {
    const host = String(location.hostname || '').trim()
    if (host === 'agentseller.temu.com') return '全球'
    if (host === 'agentseller-us.temu.com') return '美国'
    if (host === 'agentseller-eu.temu.com') return '欧区'
    return ''
  }

  function getResolvedOuterSite() {
    return getOuterSiteFromHostname() || getActiveOuterSite() || ''
  }

  function getActiveTimeRangeLabel() {
    const active = [...document.querySelectorAll('[class*="TAB_capsule_"][class*="TAB_active_"]')]
      .filter(isVisible)
      .find(el => !isInsideVisibleDrawer(el) && LIST_TIME_DIMENSION_MAP[textOf(el)])
    return textOf(active)
  }

  function resolveTimeDimensionState(sharedState = shared) {
    const explicitLabel = listTimeRange && LIST_TIME_DIMENSION_MAP[listTimeRange] ? listTimeRange : ''
    if (explicitLabel) {
      return {
        label: explicitLabel,
        value: LIST_TIME_DIMENSION_MAP[explicitLabel],
      }
    }
    const sharedLabel = String(sharedState.timeDimensionLabel || '').trim()
    const sharedValue = Number(sharedState.timeDimension || 0) || 0
    if (sharedValue > 0) {
      return {
        label: sharedLabel,
        value: sharedValue,
      }
    }
    const activeLabel = getActiveTimeRangeLabel()
    return {
      label: activeLabel,
      value: LIST_TIME_DIMENSION_MAP[activeLabel] || 0,
    }
  }

  async function waitForTargetReady(timeout = 15000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const hasSites = getAvailableOuterSites().length > 0
      const hasProductSection = /商品明细/.test(textOf(document.body))
      const hasButtons = !!findMainButton('查询') && !!findMainButton('重置')
      const hasTable = !!getMainListTable() || !!getMainListHeaderTable() || hasVisibleMainListEmpty() || hasBusyWarning()
      if (hasSites && hasProductSection && hasButtons && hasTable) return true
      await sleep(400)
    }
    return false
  }

  async function ensureProductTrafficSection() {
    if (/商品明细/.test(textOf(document.body))) return true
    const bodyReady = await waitFor(() => /商品明细/.test(textOf(document.body)), 3000, 400)
    if (bodyReady) return true
    const tab = [...document.querySelectorAll('button, a, div, span')]
      .filter(isVisible)
      .find(el => !isInsideVisibleDrawer(el) && compact(textOf(el)) === compact('商品流量'))
    if (!tab) return false
    clickLike(tab)
    return await waitFor(() => /商品明细/.test(textOf(document.body)), 5000, 400)
  }

  function countTableBodyRows(table) {
    if (!table) return 0
    return [...table.querySelectorAll('tbody tr[class*="TB_tr_"], tr[class*="TB_tr_"]')]
      .filter(row => isVisible(row) && row.querySelectorAll('td').length > 0)
      .length
  }

  function countTableHeaderCells(table) {
    if (!table) return 0
    return [...table.querySelectorAll('thead tr')]
      .filter(isVisible)
      .reduce((total, row) => {
        const cells = [...row.children].filter(cell => /^(TH|TD)$/i.test(cell.tagName))
        return total + cells.length
      }, 0)
  }

  function getVisibleMainListTables() {
    return [...document.querySelectorAll('table')]
      .filter(isVisible)
      .filter(table => !isInsideVisibleDrawer(table))
  }

  function getMainListTable() {
    const candidates = getVisibleMainListTables()
      .map(table => ({
        table,
        rowCount: countTableBodyRows(table),
        score: countTableBodyRows(table) + (/查看详情/.test(textOf(table)) ? 1000 : 0),
      }))
      .filter(item => item.rowCount > 0 || /查看详情/.test(textOf(item.table)))
      .sort((a, b) => b.score - a.score)
    return candidates[0]?.table || null
  }

  function getMainListHeaderTable() {
    const candidates = getVisibleMainListTables()
      .map(table => ({
        table,
        headerCount: countTableHeaderCells(table),
        text: textOf(table),
      }))
      .filter(item => item.headerCount > 0)
      .sort((a, b) => {
        const aScore = a.headerCount + (/商品信息|流量情况|增长潜力|操作/.test(a.text) ? 1000 : 0)
        const bScore = b.headerCount + (/商品信息|流量情况|增长潜力|操作/.test(b.text) ? 1000 : 0)
        return bScore - aScore
      })
    return candidates[0]?.table || null
  }

  function getMainListRows() {
    const table = getMainListTable()
    if (!table) return []
    return [...table.querySelectorAll('tbody tr[class*="TB_tr_"], tr[class*="TB_tr_"]')]
      .filter(row => isVisible(row) && row.querySelectorAll('td').length > 0)
  }

  function getMainPagerRoot() {
    const next = [...document.querySelectorAll('li[class*="PGT_next_"]')]
      .filter(isVisible)
      .find(el => !isInsideVisibleDrawer(el))
    return next?.closest('[class*="PGT_outerWrapper_"], [class*="PGT_pagerWrapper_"], ul, div') || document
  }

  function getVisibleMainListEmptyNode() {
    return [...document.querySelectorAll('[class*="TB_empty_"]')]
      .filter(isVisible)
      .find(node => !isInsideVisibleDrawer(node)) || null
  }

  function hasVisibleMainListEmpty() {
    return !!getVisibleMainListEmptyNode()
  }

  function getListPageNo() {
    const active = getMainPagerRoot().querySelector('li[class*="PGT_pagerItemActive_"]')
    const value = parseInt(textOf(active), 10)
    return Number.isFinite(value) && value > 0 ? value : 1
  }

  function hasNextListPage() {
    const next = getMainPagerRoot().querySelector('li[class*="PGT_next_"]')
    return !!(next && !hasClassFragment(next, 'PGT_disabled_'))
  }

  function hasPrevListPage() {
    const prev = getMainPagerRoot().querySelector('li[class*="PGT_prev_"]')
    return !!(prev && !hasClassFragment(prev, 'PGT_disabled_'))
  }

  function clickNextListPage() {
    const next = getMainPagerRoot().querySelector('li[class*="PGT_next_"]')
    if (!next || hasClassFragment(next, 'PGT_disabled_')) return false
    return clickPagerLike(next)
  }

  function clickPrevListPage() {
    const prev = getMainPagerRoot().querySelector('li[class*="PGT_prev_"]')
    if (!prev || hasClassFragment(prev, 'PGT_disabled_')) return false
    return clickPagerLike(prev)
  }

  function getListRowSampleTexts(rows, sampleSize = 3) {
    if (!rows.length) return []
    const indexes = []
    const headCount = Math.min(sampleSize, rows.length)
    const tailStart = Math.max(headCount, rows.length - sampleSize)
    for (let index = 0; index < headCount; index += 1) indexes.push(index)
    for (let index = tailStart; index < rows.length; index += 1) indexes.push(index)
    return [...new Set(indexes)]
      .map(index => compact(textOf(rows[index])).slice(0, 120))
      .filter(Boolean)
  }

  function getListPageSignature() {
    const rows = getMainListRows()
    if (!rows.length) {
      return `list:empty:${compact(textOf(getMainListTable() || getMainListHeaderTable())).slice(0, 120)}`
    }
    return `list:${rows.length}:${getListRowSampleTexts(rows).join('|')}`
  }

  async function waitForListReady(timeout = 15000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const rows = getMainListRows()
      const empty = hasVisibleMainListEmpty()
      const busy = hasBusyWarning() && rows.length === 0 && !empty
      if (rows.length > 0 || empty || busy) {
        return { ready: true, rows, empty, busy }
      }
      await sleep(500)
    }
    return {
      ready: false,
      rows: getMainListRows(),
      empty: hasVisibleMainListEmpty(),
      busy: hasBusyWarning() && getMainListRows().length === 0 && !hasVisibleMainListEmpty(),
    }
  }

  async function waitForQueryResultRefresh(baseline = {}, timeout = 30000, unchangedSettleMs = 4000) {
    const deadline = Date.now() + timeout
    let stableMarker = ''
    let stableHits = 0
    let stableSince = 0
    while (Date.now() < deadline) {
      const rows = getMainListRows()
      const empty = hasVisibleMainListEmpty()
      const busy = hasBusyWarning() && rows.length === 0 && !empty
      if (busy) {
        return { ready: true, rows, empty, busy, signatureChanged: false }
      }

      const currentPageNo = getListPageNo()
      const currentSignature = rows.length > 0 || empty ? getListPageSignature() : ''
      const signatureChanged = !!currentSignature && currentSignature !== String(baseline.signature || '')
      const pageOk = currentPageNo === 1
      const resultReady = rows.length > 0 || empty

      if (pageOk && resultReady) {
        const marker = `${currentPageNo}:${currentSignature}:${empty ? 'empty' : 'rows'}:${signatureChanged ? 'changed' : 'same'}`
        if (stableMarker === marker) {
          stableHits += 1
        } else {
          stableMarker = marker
          stableHits = 1
          stableSince = Date.now()
        }

        if (signatureChanged && stableHits >= 2) {
          return { ready: true, rows, empty, busy: false, signatureChanged: true }
        }

        if (!signatureChanged && Date.now() - stableSince >= unchangedSettleMs) {
          return { ready: true, rows, empty, busy: false, signatureChanged: false }
        }
      } else {
        stableMarker = ''
        stableHits = 0
        stableSince = 0
      }

      await sleep(400)
    }

    return {
      ready: false,
      rows: getMainListRows(),
      empty: hasVisibleMainListEmpty(),
      busy: hasBusyWarning() && getMainListRows().length === 0 && !hasVisibleMainListEmpty(),
      signatureChanged: false,
    }
  }

  async function waitListPageChange(oldSignature, oldPageNo = 0, timeout = 10000, expectedPageNo = 0) {
    const deadline = Date.now() + timeout
    let stableSignature = ''
    let stableHits = 0
    while (Date.now() < deadline) {
      const rows = getMainListRows()
      const empty = hasVisibleMainListEmpty()
      const busy = hasBusyWarning() && rows.length === 0 && !empty
      if (busy) return false

      const currentPageNo = getListPageNo()
      const currentSignature = rows.length > 0 || empty ? getListPageSignature() : ''
      const pageChanged = expectedPageNo > 0
        ? currentPageNo === expectedPageNo
        : (oldPageNo > 0 ? currentPageNo !== oldPageNo : true)
      const signatureChanged = !!currentSignature && currentSignature !== oldSignature

      if (pageChanged && signatureChanged) {
        if (stableSignature === currentSignature) {
          stableHits += 1
        } else {
          stableSignature = currentSignature
          stableHits = 1
        }
        if (stableHits >= 2) return true
      } else {
        stableSignature = ''
        stableHits = 0
      }

      await sleep(300)
    }
    return false
  }

  async function ensureListPageNo(targetPage, timeout = 30000) {
    const deadline = Date.now() + timeout
    let guard = 0
    while (Date.now() < deadline && guard < SAFE_PAGE_LOOP_LIMIT) {
      guard += 1
      const current = getListPageNo()
      if (current === targetPage) return true
      const oldSig = getListPageSignature()
      const oldPageNo = current
      const expectedPageNo = current < targetPage ? oldPageNo + 1 : oldPageNo - 1
      await sleep(PAGER_THROTTLE_MS)
      const moved = current < targetPage ? clickNextListPage() : clickPrevListPage()
      if (!moved) return false
      const changed = await waitListPageChange(oldSig, oldPageNo, 10000, expectedPageNo)
      if (!changed) return false
      const ready = await waitForListReady(12000)
      if (!ready.ready || ready.busy) return false
    }
    return getListPageNo() === targetPage
  }

  function setNativeInputValue(input, value) {
    if (!input) return false
    try { input.focus?.() } catch (e) {}
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    if (setter) setter.call(input, value)
    else input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }

  function getLabeledContainer(labelText) {
    const rowCandidates = [...document.querySelectorAll('div[class*="index-module__row___"]')]
      .filter(isVisible)
    for (const row of rowCandidates) {
      const label = [...row.querySelectorAll('div, label, span')]
        .filter(isVisible)
        .find(el => textOf(el) === labelText)
      if (label) return row
    }

    const candidates = [...document.querySelectorAll('div, label, span')]
      .filter(isVisible)
      .filter(el => textOf(el) === labelText)
    for (const label of candidates) {
      let cursor = label
      for (let depth = 0; depth < 4 && cursor; depth += 1) {
        if (cursor.querySelector?.('input, [class*="ST_outerWrapper_"], [class*="CSD_cascaderWrapper_"], [class*="RPR_inputWrapper_"]')) {
          return cursor
        }
        cursor = cursor.parentElement
      }
    }
    return null
  }

  function clickOption(optionText) {
    const options = [...document.querySelectorAll(
      '[class*="ST_option_"], [class*="ST_item_"], [class*="cIL_item_"], [role="option"], li[class*="option"]',
    )].filter(isVisible)
    const target = options.find(opt => textOf(opt) === optionText)
    if (!target) return false
    clickLike(target)
    return true
  }

  async function setMainSelectByLabel(labelText, optionLabel) {
    const container = getLabeledContainer(labelText)
    if (!container) return false
    const input = container.querySelector('input[data-testid="beast-core-select-htmlInput"]')
    if (String(input?.value || '').trim() === optionLabel) return true
    const wrapper = input?.closest('[class*="ST_outerWrapper_"]') || container.querySelector('[class*="ST_outerWrapper_"]') || container
    clickLike(wrapper)
    await sleep(600)
    if (!clickOption(optionLabel)) {
      clickLike(document.body)
      return false
    }
    return await waitFor(() => String(input?.value || '').trim() === optionLabel, 4000, 400)
  }

  function getMainTextInputByLabel(labelText) {
    const container = getLabeledContainer(labelText)
    if (!container) return null
    return [...container.querySelectorAll('input')].find(input => {
      const testId = String(input.getAttribute('data-testid') || '')
      return testId !== 'beast-core-select-htmlInput' && testId !== 'beast-core-cascader-htmlInput'
    }) || null
  }

  async function setMainTextInput(labelText, value) {
    const input = getMainTextInputByLabel(labelText)
    if (!input) return false
    return setNativeInputValue(input, value)
  }

  async function setCategoryPath(pathText) {
    if (!pathText) return true
    const input = document.querySelector('input[data-testid="beast-core-cascader-htmlInput"]')
    if (!input || isInsideVisibleDrawer(input)) return false
    clickLike(input)
    await sleep(500)
    const segments = String(pathText)
      .split(/>|\/|｜|\|/g)
      .map(item => item.trim())
      .filter(Boolean)
    if (!segments.length) return false
    for (const segment of segments) {
      const items = [...document.querySelectorAll('[class*="CSD_menuItem_"]')].filter(isVisible)
      const node = items.find(item => textOf(item) === segment)
      if (!node) {
        clickLike(document.body)
        return false
      }
      clickLike(node)
      await sleep(700)
    }
    clickLike(document.body)
    await sleep(300)
    return true
  }

  async function clickCapsule(label) {
    const capsule = [...document.querySelectorAll('[class*="TAB_capsule_"]')]
      .filter(isVisible)
      .find(el => !isInsideVisibleDrawer(el) && textOf(el) === label)
    if (!capsule) return false
    if (hasClassFragment(capsule, 'TAB_active_')) return true
    clickLike(capsule)
    await sleep(800)
    return true
  }

  function findQuickFilterCard(label) {
    const root = [...document.querySelectorAll('div, section')]
      .filter(isVisible)
      .find(el => /快速筛选/.test(textOf(el)) && QUICK_FILTER_OPTIONS.some(option => compact(textOf(el)).includes(compact(option))))
    if (!root) return null
    return [...root.querySelectorAll('div, button')]
      .filter(isVisible)
      .find(el => compact(textOf(el)).startsWith(compact(label))) || null
  }

  async function clickQuickFilter(label) {
    if (!label || label === '全部') return true
    const card = findQuickFilterCard(label)
    if (!card) return false
    clickLike(card)
    await sleep(1600)
    return true
  }

  function getTableHeaders(table) {
    if (!table) return []
    const headerRows = [...table.querySelectorAll('thead tr')].filter(isVisible)
    if (!headerRows.length) return []

    const grid = []
    headerRows.forEach((row, rowIndex) => {
      grid[rowIndex] = grid[rowIndex] || []
      let colIndex = 0
      const cells = [...row.children].filter(cell => /^(TH|TD)$/i.test(cell.tagName))
      for (const cell of cells) {
        while (grid[rowIndex][colIndex]) colIndex += 1
        const label = textOf(cell)
        const colspan = parseInt(cell.getAttribute('colspan') || '1', 10) || 1
        const rowspan = parseInt(cell.getAttribute('rowspan') || '1', 10) || 1
        for (let r = 0; r < rowspan; r += 1) {
          grid[rowIndex + r] = grid[rowIndex + r] || []
          for (let c = 0; c < colspan; c += 1) {
            grid[rowIndex + r][colIndex + c] = label
          }
        }
        colIndex += colspan
      }
    })

    const maxCols = Math.max(...grid.map(row => row.length))
    const used = Object.create(null)
    const headers = []
    for (let col = 0; col < maxCols; col += 1) {
      const path = []
      for (let row = 0; row < grid.length; row += 1) {
        const label = String(grid[row]?.[col] || '').trim()
        if (!label) continue
        if (path[path.length - 1] !== label) path.push(label)
      }
      let header = path.join('/') || `列${col + 1}`
      if (!used[header]) {
        used[header] = 1
      } else {
        used[header] += 1
        header = `${header}_${used[header]}`
      }
      headers.push(header)
    }
    return headers
  }

  function extractBackgroundImageUrl(value) {
    const matched = String(value || '').match(/url\((['"]?)(.*?)\1\)/i)
    return matched?.[2] || ''
  }

  function parseProductInfoCell(cell) {
    if (!cell) return {}
    const rawText = textOf(cell)
    const imageNode = cell.querySelector('[class*="index-module__img___"]')
    const styleValue = String(imageNode?.style?.backgroundImage || imageNode?.getAttribute('style') || '')
    const spuMatch = rawText.match(/SPU[:：]?\s*([0-9]+)/i)
    return {
      商品名称: textOf(cell.querySelector('[class*="hooks_goodsName__"]')) || rawText.split('SPU')[0].trim(),
      商品分类: textOf(cell.querySelector('[class*="hooks_category__"]')),
      SPU: textOf(cell.querySelector('[class*="hooks_spuId__"]')).replace(/^SPU[:：]?\s*/i, '') || spuMatch?.[1] || '',
      商品图片: extractBackgroundImageUrl(styleValue),
      商品信息: rawText,
    }
  }

  function getProductInfoCellIndex(cells) {
    const byContent = cells.findIndex(cell => {
      const rawText = textOf(cell)
      return (
        /SPU[:：]?\s*[0-9]+/i.test(rawText) ||
        !!cell.querySelector('[class*="index-module__img___"]') ||
        !!cell.querySelector('[class*="hooks_goodsName__"]')
      )
    })
    if (byContent >= 0) return byContent
    return cells.length > LIST_METRIC_COLUMN_KEYS.length ? cells.length - LIST_METRIC_COLUMN_KEYS.length - 1 : 0
  }

  function mapCellsToColumnKeys(cells, columnKeys) {
    const mapped = {}
    columnKeys.forEach((columnKey, index) => {
      mapped[columnKey] = textOf(cells[index])
    })
    return mapped
  }

  async function resolveCategoryLeafId(pathText) {
    const segments = String(pathText || '')
      .split(/>|\/|｜|\|/g)
      .map(item => String(item || '').trim())
      .filter(Boolean)
    if (!segments.length) return { ok: true, leafId: 0, segments: [] }

    let parentCatId = 0
    let leafId = 0
    for (const segment of segments) {
      const body = parentCatId > 0 ? { parentCatId } : {}
      const response = await callTemuApi(TEMU_CATEGORY_CHILDREN_ENDPOINT, body, {})
      if (!response.ok) return { ok: false, error: response.error }
      const nodes = Array.isArray(response.result?.categoryNodeVOS)
        ? response.result.categoryNodeVOS
        : Array.isArray(response.result)
          ? response.result
          : []
      const matched = nodes.find(item => compact(item?.catName) === compact(segment))
      if (!matched) {
        return {
          ok: false,
          error: {
            errorCode: 0,
            errorMsg: `未匹配到分类路径节点：${segment}`,
          },
        }
      }
      leafId = Number(matched.catId || 0) || 0
      parentCatId = leafId
    }

    return {
      ok: true,
      leafId,
      segments,
    }
  }

  function buildListApiRequestPayload(pageNo = 1, pageSize = LIST_API_PAGE_SIZE, sharedState = shared) {
    const payload = {
      pageSize,
      pageNum: Math.max(1, Number(pageNo || 1)),
    }

    const timeState = resolveTimeDimensionState(sharedState)
    if (timeState.value > 0) payload.timeDimension = timeState.value

    const quickFilterType = QUICK_FILTER_TYPE_MAP[quickFilter]
    if (quickFilterType) payload.quickFilterType = quickFilterType

    const productIdField = PRODUCT_ID_FIELD_MAP[productIdType]
    const productIds = parseNumericValueList(productIdQuery)
    if (productIdField && productIds.length) payload[productIdField] = productIds

    const goodsNoField = GOODS_NO_FIELD_MAP[goodsNoType]
    const goodsNos = splitMultiValueText(goodsNoQuery)
    if (goodsNoField && goodsNos.length) payload[goodsNoField] = goodsNos

    const categoryLeafId = Number(sharedState.categoryLeafId || 0) || 0
    if (categoryLeafId > 0) payload.catIdList = [categoryLeafId]

    if (productName) payload.goodsName = productName

    return payload
  }

  function formatApiCategoryPath(category) {
    if (!category || typeof category !== 'object') return ''
    const names = []
    for (let index = 1; index <= 10; index += 1) {
      const name = String(category[`cat${index}Name`] || '').trim()
      if (name && names[names.length - 1] !== name) names.push(name)
    }
    if (!names.length) {
      const fallback = String(category.catName || '').trim()
      if (fallback) names.push(fallback)
    }
    return names.join(' > ')
  }

  function formatApiPercent(value) {
    if (value == null || value === '') return ''
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return String(value)
    return `${(numeric * 100).toFixed(2)}%`
  }

  function formatApiMetric(value) {
    if (value == null || value === '') return ''
    return String(value)
  }

  async function fetchListApiPage(pageNo = 1, sharedState = shared) {
    const payload = buildListApiRequestPayload(pageNo, LIST_API_PAGE_SIZE, sharedState)
    let lastError = null
    for (let attempt = 1; attempt <= LIST_API_RETRY_LIMIT; attempt += 1) {
      const response = await callTemuApi(TEMU_LIST_ENDPOINT, payload, {})
      if (response.ok) {
        const result = response.result && typeof response.result === 'object' ? response.result : {}
        const list = Array.isArray(result.list) ? result.list : []
        return {
          ok: true,
          pageNo: Math.max(1, Number(pageNo || 1)),
          pageSize: LIST_API_PAGE_SIZE,
          payload,
          result,
          list,
          total: Math.max(0, Number(result.total || 0) || 0),
          updateAt: Number(result.updateAt || 0) || 0,
          attempt,
        }
      }

      lastError = response.error
      if (attempt < LIST_API_RETRY_LIMIT) {
        const backoffMs = getListApiRetryBackoffMs(lastError, attempt)
        await sleep(backoffMs)
      }
    }

    return {
      ok: false,
      pageNo: Math.max(1, Number(pageNo || 1)),
      pageSize: LIST_API_PAGE_SIZE,
      payload,
      error: normalizeTemuApiError(lastError),
    }
  }

  function mapApiItemToListRow(item, currentOuterSite, pageNo, index, sharedState = shared) {
    const spu = item?.productSpuId != null ? String(item.productSpuId) : ''
    const goodsNameText = String(item?.goodsName || '').trim()
    const categoryText = formatApiCategoryPath(item?.category)
    const timeLabel = String(sharedState.timeDimensionLabel || listTimeRange || '当前页面').trim() || '当前页面'
    return {
      外层站点: currentOuterSite,
      列表页码: Math.max(1, Number(pageNo || 1)),
      抓取时间: localNow(),
      列表时间范围: timeLabel,
      快速筛选: quickFilter || '全部',
      列表行号: index + 1,
      商品名称: goodsNameText,
      商品分类: categoryText,
      SPU: spu,
      商品图片: String(item?.goodsImageUrl || '').trim(),
      商品信息: [goodsNameText, spu ? `SPU: ${spu}` : ''].filter(Boolean).join(' '),
      '流量情况/曝光量': formatApiMetric(item?.exposeNum),
      '流量情况/点击量': formatApiMetric(item?.clickNum),
      '流量情况/访客数': formatApiMetric(item?.goodsDetailVisitorNum),
      '流量情况/浏览量': formatApiMetric(item?.goodsDetailVisitNum),
      '流量情况/加购人数': formatApiMetric(item?.addToCartUserNum),
      '流量情况/收藏人数': formatApiMetric(item?.collectUserNum),
      '流量情况/支付件数': formatApiMetric(item?.payGoodsNum),
      '支付情况/支付订单数': formatApiMetric(item?.payOrderNum),
      '支付情况/买家数': formatApiMetric(item?.buyerNum),
      '转化情况/转化率': formatApiPercent(item?.exposePayConversionRate),
      '转化情况/点击率': formatApiPercent(item?.exposeClickConversionRate),
      '转化情况/点击后支付率': formatApiPercent(item?.clickPayConversionRate),
      '搜索数据/曝光量': formatApiMetric(item?.searchExposeNum),
      '搜索数据/点击量': formatApiMetric(item?.searchClickNum),
      '搜索数据/支付订单数': formatApiMetric(item?.searchPayOrderNum),
      '搜索数据/支付件数': formatApiMetric(item?.searchPayGoodsNum),
      '推荐数据/曝光量': formatApiMetric(item?.recommendExposeNum),
      '推荐数据/点击量': formatApiMetric(item?.recommendClickNum),
      '推荐数据/支付订单数': formatApiMetric(item?.recommendPayOrderNum),
      '推荐数据/支付件数': formatApiMetric(item?.recommendPayGoodsNum),
      增长潜力: String(item?.growDataText || '').trim(),
      操作: spu ? '查看详情' : '',
    }
  }

  function mapApiPageToRows(apiPage, currentOuterSite, sharedState = shared) {
    const pageNo = Math.max(1, Number(apiPage?.pageNo || 1))
    const list = Array.isArray(apiPage?.list) ? apiPage.list : []
    return list.map((item, index) => mapApiItemToListRow(item, currentOuterSite, pageNo, index, sharedState))
  }

  function scrapeCurrentPage(currentOuterSite) {
    const rows = getMainListRows()
    return rows.map((row, index) => {
      const cells = [...row.querySelectorAll('td')]
      const productInfoCellIndex = getProductInfoCellIndex(cells)
      const productInfo = parseProductInfoCell(cells[productInfoCellIndex] || cells[1] || cells[0])
      const metricCells = cells.slice(productInfoCellIndex + 1)
      const data = {
        外层站点: currentOuterSite,
        列表页码: getListPageNo(),
        抓取时间: localNow(),
        列表时间范围: listTimeRange || '当前页面',
        快速筛选: quickFilter || '全部',
        列表行号: index + 1,
        ...productInfo,
        ...mapCellsToColumnKeys(metricCells, LIST_METRIC_COLUMN_KEYS),
      }
      return data
    })
  }

  function nextOuterSite(targetSites, currentSite) {
    const idx = targetSites.indexOf(currentSite)
    if (idx < 0 || idx + 1 >= targetSites.length) return ''
    return targetSites[idx + 1]
  }

  function moreOuterSitesRemain(targetSites, currentSite) {
    return !!nextOuterSite(targetSites, currentSite)
  }

  function buildBusyReload(nextPhaseName, sharedState) {
    const retry = Number(sharedState.listBusyRetry || 0)
    const currentPageNo = Math.max(1, Number(sharedState.lastCollectedPageNo || sharedState.currentPageNo || getListPageNo() || 1))
    const currentSite = sharedState.targetOuterSite || sharedState.currentOuterSite || getResolvedOuterSite() || ''
    if (retry >= LIST_BUSY_RETRY_LIMIT) {
      return fail('Temu 商品流量列表连续出现 “Too many visitors...” 空表，刷新补偿后仍未恢复')
    }
    return scheduleListPageRecovery({
      ...sharedState,
      listBusyRetry: retry + 1,
      recoverPageNo: currentPageNo,
      recoverOuterSite: currentSite,
    }, 'Temu 商品流量列表出现 “Too many visitors...” 空表', currentPageNo, currentSite)
  }

  async function prepareCurrentSite(sharedState, nextPhaseName = 'collect', extraShared = {}) {
    const currentSite = sharedState.currentOuterSite || sharedState.targetOuterSite || getResolvedOuterSite() || ''
    const currentPageNo = Math.max(1, Number(sharedState.currentPageNo || sharedState.recoverPageNo || 1))
    const productOk = await ensureProductTrafficSection()
    if (!productOk) return fail('未能切回「商品流量」tab')

    const ready = await waitForTargetReady(LIST_READY_TIMEOUT_MS)
    if (!ready) {
      return scheduleListPageRecovery(sharedState, '商品流量列表初始加载超时', currentPageNo, currentSite)
    }

    const timeState = resolveTimeDimensionState(sharedState)
    if (listTimeRange && timeState.value <= 0) {
      return fail(`列表统计时间切换失败：${listTimeRange}`)
    }

    let categoryLeafId = Number(sharedState.categoryLeafId || 0) || 0
    let categoryPathDisplay = String(sharedState.categoryPathDisplay || '').trim()
    if (categoryPath && (!categoryLeafId || sharedState.categoryPathSource !== categoryPath)) {
      const resolved = await resolveCategoryLeafId(categoryPath)
      if (!resolved.ok) {
        return fail(`商品分类设置失败：${categoryPath}${resolved.error?.errorMsg ? ` (${resolved.error.errorMsg})` : ''}`)
      }
      categoryLeafId = Number(resolved.leafId || 0) || 0
      categoryPathDisplay = resolved.segments.join(' > ')
    }

    const collectDelayMs = getListApiCollectDelayMs({
      ...sharedState,
      ...extraShared,
    }, {
      afterSiteSwitch: !!sharedState.switchedOuterSite,
      afterRecovery: !!sharedState.recoveredListPage,
    })

    return nextPhase(nextPhaseName, nextPhaseName === 'collect' ? collectDelayMs : 400, {
      ...sharedState,
      ...extraShared,
      listBusyRetry: 0,
      currentOuterSite: currentSite,
      currentPageNo: Math.max(1, Number(extraShared.currentPageNo || sharedState.currentPageNo || 1)),
      timeDimension: timeState.value,
      timeDimensionLabel: timeState.label || listTimeRange || '当前页面',
      categoryLeafId,
      categoryPathDisplay,
      categoryPathSource: categoryPath || '',
      pendingCollectDelayMs: nextPhaseName === 'collect'
        ? 0
        : Math.max(0, Number(sharedState.pendingCollectDelayMs || 0)),
      recoveredListPage: nextPhaseName === 'collect' ? false : !!sharedState.recoveredListPage,
      switchedOuterSite: nextPhaseName === 'collect' ? false : !!sharedState.switchedOuterSite,
    })
  }

  function scheduleListPageRecovery(sharedState, reason, targetPageNo, targetSite) {
    const retry = Number(sharedState.listPageRetry || 0)
    if (retry >= LIST_PAGE_RECOVERY_LIMIT) {
      return fail(`商品流量列表分页重试 ${retry} 次后仍失败：${reason}`)
    }
    const sleepMs = getListPageRecoveryCooldownMs(sharedState, reason)
    return reloadPage('recover_list_page', sleepMs, {
      ...sharedState,
      listBusyRetry: 0,
      listPageRetry: retry + 1,
      listPageRetryReason: reason,
      recoverPageNo: Math.max(1, Number(targetPageNo || 1)),
      recoverOuterSite: targetSite || sharedState.currentOuterSite || getResolvedOuterSite() || '',
      pendingCollectDelayMs: /Too many visitors|Network Timeout|请求超时/i.test(String(reason || ''))
        ? Math.max(LIST_API_RECOVERY_THROTTLE_MS, Math.round(sleepMs / 2))
        : Math.max(0, Number(sharedState.pendingCollectDelayMs || 0)),
      recoveredListPage: /Too many visitors|Network Timeout|请求超时/i.test(String(reason || '')),
    })
  }

  try {
    if (phase === 'main') {
      if (page === 1) return nextPhase('ensure_target', 0)
      return nextPhase('advance_cursor', 0)
    }

    if (phase === 'ensure_target') {
      if (!location.href.includes('/main/flux-analysis-full')) {
        location.href = TARGET_URL
        return nextPhase('ensure_target', mode === 'new' ? 3000 : 2200)
      }

      const ready = await waitForTargetReady(15000)
      if (!ready) return fail('Temu 商品流量页面未加载，请确认已登录并能打开「后台-商品流量」页面')

      const { available, target } = buildTargetOuterSites()
      if (!target.length) return fail(`未找到可抓取的外层站点，可用站点：${available.join(' / ') || '无'}`)

      const initialTimeState = resolveTimeDimensionState(shared)
      const activeSite = getResolvedOuterSite() || target[0]
      if (activeSite !== target[0]) {
        const targetUrl = getOuterSiteUrl(target[0])
        if (!targetUrl) return fail(`外层站点切换失败：${target[0]}`)
        location.href = targetUrl
        return nextPhase('after_outer_site_switch', 3600, {
          ...shared,
          targetOuterSites: target,
          targetOuterSite: target[0],
          currentPageNo: 1,
          totalPages: 1,
          switchedOuterSite: true,
          lastApiAttempt: 1,
          timeDimension: initialTimeState.value || Number(shared.timeDimension || 0) || 0,
          timeDimensionLabel: initialTimeState.label || listTimeRange || String(shared.timeDimensionLabel || '').trim(),
        })
      }

      return nextPhase('prepare_current_site', 400, {
        ...shared,
        targetOuterSites: target,
        currentPageNo: 1,
        listPageRetry: 0,
        switchedOuterSite: false,
        lastApiAttempt: 1,
        timeDimension: initialTimeState.value || Number(shared.timeDimension || 0) || 0,
        timeDimensionLabel: initialTimeState.label || listTimeRange || String(shared.timeDimensionLabel || '').trim(),
      })
    }

    if (phase === 'after_outer_site_switch') {
      const targetSite = shared.targetOuterSite || ''
      const switched = await waitForTargetOuterSite(targetSite, 30000)
      if (!switched) {
        return fail(`外层站点切换未生效：期望 ${targetSite || '未知站点'}，当前 ${getResolvedOuterSite() || '未知站点'}`)
      }
      const ready = await waitForTargetReady(15000)
      if (!ready) return fail(`切换外层站点后页面未恢复：${targetSite || '未知站点'}`)
      return nextPhase(shared.resume_phase || 'prepare_current_site', 400, {
        ...shared,
        listBusyRetry: 0,
        currentOuterSite: getResolvedOuterSite() || targetSite || '',
        resume_phase: '',
        switchedOuterSite: true,
      })
    }

    if (phase === 'prepare_current_site') {
      return await prepareCurrentSite(shared)
    }

    if (phase === 'recover_list_page') {
      const targetSite = shared.recoverOuterSite || shared.currentOuterSite || getResolvedOuterSite() || ''
      const targetUrl = getOuterSiteUrl(targetSite) || TARGET_URL
      if (location.href !== targetUrl) {
        location.href = targetUrl
        return nextPhase('recover_list_page', mode === 'new' ? 3000 : 2200, shared)
      }

      const switched = await waitForTargetOuterSite(targetSite, 30000)
      if (!switched) return fail(`商品流量页面恢复失败：未能切回站点 ${targetSite || '未知站点'}`)

      const ready = await waitForTargetReady(15000)
      if (!ready) return fail('商品流量页面恢复失败：页面未完成加载')

      return nextPhase('recover_list_page_prepare', 0, shared)
    }

    if (phase === 'recover_list_page_prepare') {
      return await prepareCurrentSite(shared, 'restore_list_page', {
        currentOuterSite: shared.recoverOuterSite || shared.currentOuterSite || getResolvedOuterSite() || '',
      })
    }

    if (phase === 'restore_list_page') {
      const targetPageNo = Math.max(1, Number(shared.recoverPageNo || 1))
      const targetSite = shared.recoverOuterSite || shared.currentOuterSite || getResolvedOuterSite() || ''
      return nextPhase('collect', getListApiCollectDelayMs(shared, { afterRecovery: true }), {
        ...shared,
        currentOuterSite: targetSite,
        currentPageNo: targetPageNo,
        recoverPageNo: 0,
        recoverOuterSite: '',
        listPageRetry: 0,
        listPageRetryReason: '',
        pendingCollectDelayMs: 0,
        recoveredListPage: false,
        switchedOuterSite: false,
      })
    }

    if (phase === 'advance_cursor') {
      const ready = await waitForTargetReady(15000)
      if (!ready) return fail('商品流量页面状态丢失，无法继续翻页')

      const { available, target } = buildTargetOuterSites()
      if (!target.length) return fail(`未找到可抓取的外层站点，可用站点：${available.join(' / ') || '无'}`)

      const currentSite = getResolvedOuterSite() || target[0]
      const currentPageNo = Math.max(1, Number(shared.currentPageNo || shared.lastCollectedPageNo || 1))
      const totalPages = Math.max(1, Number(shared.totalPages || 1))
      if (currentPageNo < totalPages) {
        return nextPhase('collect', getListApiCollectDelayMs(shared, { nextPageNo: currentPageNo + 1 }), {
          ...shared,
          targetOuterSites: target,
          currentOuterSite: currentSite,
          currentPageNo: currentPageNo + 1,
          lastCollectedPageNo: currentPageNo,
          pendingCollectDelayMs: 0,
          recoveredListPage: false,
          switchedOuterSite: false,
        })
      }

      const nextSite = nextOuterSite(target, currentSite)
      if (!nextSite) return complete([], false)

      const targetUrl = getOuterSiteUrl(nextSite)
      if (!targetUrl) return fail(`切换外层站点失败：${nextSite}`)
      location.href = targetUrl
      return nextPhase('after_outer_site_switch', 3600, {
        ...shared,
        targetOuterSites: target,
        targetOuterSite: nextSite,
        currentPageNo: 1,
        totalPages: 1,
        switchedOuterSite: true,
        lastApiAttempt: 1,
      })
    }

    if (phase === 'after_list_page_turn') {
      return nextPhase('collect', 400, {
        ...shared,
        listBusyRetry: 0,
        listPageRetry: 0,
      })
    }

    if (phase === 'collect') {
      const currentOuterSite = shared.currentOuterSite || getResolvedOuterSite()
      const targetOuterSites = shared.targetOuterSites || buildTargetOuterSites().target
      const currentPageNo = Math.max(1, Number(shared.currentPageNo || shared.recoverPageNo || 1))
      const apiPage = await fetchListApiPage(currentPageNo, shared)
      if (!apiPage.ok) {
        const errorInfo = normalizeTemuApiError(apiPage.error)
        const reason = isTooManyVisitorsError(errorInfo)
          ? `商品流量列表 API 连续重试 ${LIST_API_RETRY_LIMIT} 次后仍返回 Too many visitors`
          : `商品流量列表 API 抓取失败：${errorInfo.errorMsg || errorInfo.errorCode || '未知错误'}`
        return scheduleListPageRecovery(shared, reason, currentPageNo, currentOuterSite)
      }

      const totalPages = apiPage.total > 0
        ? Math.max(1, Math.ceil(apiPage.total / apiPage.pageSize))
        : 1
      const data = mapApiPageToRows(apiPage, currentOuterSite, {
        ...shared,
        currentPageNo,
      })
      const more = currentPageNo < totalPages || moreOuterSitesRemain(targetOuterSites, currentOuterSite)
      return complete(data, more, {
        ...shared,
        targetOuterSites,
        currentOuterSite,
        currentPageNo,
        lastCollectedPageNo: currentPageNo,
        lastApiAttempt: Math.max(1, Number(apiPage.attempt || 1)),
        totalPages,
        totalCount: apiPage.total,
        recoverPageNo: 0,
        recoverOuterSite: '',
        pendingCollectDelayMs: 0,
        recoveredListPage: false,
        switchedOuterSite: false,
        listBusyRetry: 0,
        listPageRetry: 0,
        listPageRetryReason: '',
      })
    }

    return fail(`未知 phase: ${phase}`)
  } catch (error) {
    return fail(error?.message || String(error))
  }
})()
