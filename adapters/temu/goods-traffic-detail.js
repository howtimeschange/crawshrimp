;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const TARGET_URL = 'https://agentseller.temu.com/main/flux-analysis-full'
  const LIST_BUSY_RETRY_LIMIT = 30
  const DETAIL_OPEN_RETRY_LIMIT = 2
  const DETAIL_CLOSE_RETRY_LIMIT = 2
  const DETAIL_PAGE_RECOVERY_LIMIT = 12
  const SAFE_PAGE_LOOP_LIMIT = 120
  const DETAIL_PAGER_THROTTLE_MS = 2200
  const LIST_TIME_OPTIONS = ['昨日', '今日', '本周', '本月', '近7日', '近30日']
  const OUTER_SITE_BLACKLIST = new Set(['商家中心'])
  const DETAIL_GRAIN_OPTIONS = ['按日', '按周', '按月']
  const DETAIL_SITE_OPTIONS = ['全部', '加拿大', '澳大利亚', '日本', '韩国']
  const SOURCE_SHEET_PREFERENCES = ['列表数据', 'goods_traffic_list', 'SPU导入', 'spu_import', 'goods_traffic_detail_spu_import']
  const SOURCE_SPU_KEYS = ['SPU', 'spu', 'SPU ID', 'SPU_ID', 'spu_id', '款号']
  const SOURCE_OUTER_SITE_KEYS = ['外层站点', 'outer_site', 'outerSite']
  const SOURCE_PRODUCT_NAME_KEYS = ['商品名称', '商品名', 'product_name', 'productName']
  const SOURCE_LIST_TIME_RANGE_KEYS = ['列表时间范围', 'list_time_range', 'listTimeRange', '时间范围']
  const DETAIL_TABLE_COLUMN_KEYS = [
    '日期',
    '站点',
    '流量情况/曝光量',
    '流量情况/点击量',
    '流量情况/商品访问量',
    '流量情况/商详访客数',
    '流量情况/加购人数',
    '流量情况/收藏人数',
    '支付情况/支付件数',
    '支付情况/支付订单数',
    '支付情况/买家数',
    '转化情况/转化率',
    '转化情况/点击率',
    '转化情况/点击后支付率',
    '搜索数据/曝光量',
    '搜索数据/点击量',
    '搜索数据/支付单量',
    '搜索数据/支付件数',
    '推荐数据/曝光量',
    '推荐数据/点击量',
    '推荐数据/支付单量',
    '推荐数据/支付件数',
  ]

  const mode = String(params.mode || 'current').trim().toLowerCase()
  const sourceFile = params.list_result_file || {}
  const outerSitesParam = normalizeArray(params.outer_sites)
  const detailTimeRange = String(params.detail_time_range || '').trim()
  const detailSitesParam = normalizeArray(params.detail_sites)
  const detailGrainsParam = normalizeArray(params.detail_grains)
  const detailPageSize = normalizePageSizeParam(params.detail_page_size, '40')
  const detailFullPaging = String(params.detail_full_paging || 'yes').trim().toLowerCase() !== 'no'

  function normalizeArray(value) {
    if (!Array.isArray(value)) return []
    return value.map(item => String(item || '').trim()).filter(Boolean)
  }

  function parsePositiveInt(value) {
    const match = String(value || '').match(/\d+/)
    const parsed = match ? parseInt(match[0], 10) : 0
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }

  function normalizePageSizeParam(value, fallback = '40') {
    const parsed = parsePositiveInt(value)
    if (parsed > 0) return String(parsed)
    const fallbackParsed = parsePositiveInt(fallback)
    return fallbackParsed > 0 ? String(fallbackParsed) : '40'
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

  function nextPhase(name, sleepMs = 1200, newShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: { action: 'next_phase', next_phase: name, sleep_ms: sleepMs, shared: newShared },
    }
  }

  function cdpClicks(clicks, nextPhaseName, sleepMs = 1200, newShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: { action: 'cdp_clicks', clicks, next_phase: nextPhaseName, sleep_ms: sleepMs, shared: newShared },
    }
  }

  function reloadPage(nextPhaseName, sleepMs = 2000, newShared = shared, data = []) {
    return {
      success: true,
      data,
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

  function hasOwnField(row, key) {
    return !!(row && typeof row === 'object' && Object.prototype.hasOwnProperty.call(row, key))
  }

  function readFirstFilledField(row, keys) {
    for (const key of keys) {
      if (!hasOwnField(row, key)) continue
      const value = String(row[key] || '').trim()
      if (value) return value
    }
    return ''
  }

  function normalizeSourceItem(row) {
    if (!row || typeof row !== 'object') return false
    const recordType = readFirstFilledField(row, ['记录类型'])
    const hasDetailContext =
      hasOwnField(row, '详情站点筛选') ||
      hasOwnField(row, '详情时间粒度') ||
      hasOwnField(row, '详情页码') ||
      hasOwnField(row, '抽屉SPU') ||
      hasOwnField(row, '抽屉商品信息')
    if (recordType || hasDetailContext) return null

    const spu = readFirstFilledField(row, SOURCE_SPU_KEYS)
    if (!spu) return null

    const outerSite = readFirstFilledField(row, SOURCE_OUTER_SITE_KEYS)
    const hasListContext =
      hasOwnField(row, '列表页码') ||
      hasOwnField(row, '列表时间范围') ||
      hasOwnField(row, '商品信息') ||
      hasOwnField(row, '快速筛选')

    return {
      sourceType: outerSite && hasListContext ? 'list_result' : 'spu_import',
      outerSite,
      spu,
      productName: readFirstFilledField(row, SOURCE_PRODUCT_NAME_KEYS),
      listTimeRange: readFirstFilledField(row, SOURCE_LIST_TIME_RANGE_KEYS),
    }
  }

  function extractSourceItems(rows) {
    if (!Array.isArray(rows)) return []
    return rows.map(normalizeSourceItem).filter(Boolean)
  }

  function pickSourceItemsFromSheetMap(sheetMap) {
    const entries = Object.entries(sheetMap || {})
    if (!entries.length) return []

    const preferredNames = new Set(SOURCE_SHEET_PREFERENCES.map(name => compact(name).toLowerCase()))
    for (const [sheetName, table] of entries) {
      if (!preferredNames.has(compact(sheetName).toLowerCase())) continue
      const items = extractSourceItems(table?.rows)
      if (items.length) return items
    }

    for (const [, table] of entries) {
      const items = extractSourceItems(table?.rows)
      if (items.length) return items
    }

    return []
  }

  function getSourceItems() {
    let items = []
    if (sourceFile?.sheets) {
      items = pickSourceItemsFromSheetMap(sourceFile.sheets)
    }
    if (!items.length && Array.isArray(sourceFile?.rows)) {
      items = extractSourceItems(sourceFile.rows)
    }
    return Array.isArray(items) ? items.filter(Boolean) : []
  }

  function resolveRequestedOuterSites(context = {}) {
    const availableOuterSites = normalizeArray(context.availableOuterSites)
    if (outerSitesParam.length) {
      return availableOuterSites.length
        ? outerSitesParam.filter(site => availableOuterSites.includes(site))
        : outerSitesParam.slice()
    }
    const fallbackOuterSite = String(context.fallbackOuterSite || '').trim()
    return fallbackOuterSite ? [fallbackOuterSite] : []
  }

  function getSourceRows(context = {}) {
    const items = getSourceItems()
    const requestedOuterSites = resolveRequestedOuterSites(context)
    const requestedSet = outerSitesParam.length ? new Set(requestedOuterSites) : null
    const result = []
    const seen = new Set()

    for (const item of items) {
      if (item.outerSite) {
        if (requestedSet && !requestedSet.has(item.outerSite)) continue
      }

      const targetOuterSites = item.outerSite ? [item.outerSite] : requestedOuterSites
      for (const outerSite of targetOuterSites) {
        const normalizedOuterSite = String(outerSite || '').trim()
        if (!normalizedOuterSite) continue
        const key = `${normalizedOuterSite}::${item.spu}`
        if (seen.has(key)) continue
        seen.add(key)
        result.push({
          sourceType: item.sourceType,
          outerSite: normalizedOuterSite,
          spu: item.spu,
          productName: item.productName,
          listTimeRange: item.listTimeRange,
        })
      }
    }

    return result
  }

  function buildSourceRowsError(context = {}) {
    const sourceItems = getSourceItems()
    if (!sourceItems.length) {
      return '未从导入文件中读取到可用商品。可上传「后台-商品流量-列表」结果文件，或选择包含「SPU」列的 SPU 模板文件'
    }

    const requestedOuterSites = resolveRequestedOuterSites(context)
    if (!requestedOuterSites.length && sourceItems.some(item => !item.outerSite)) {
      return '已读取到 SPU，但未解析到执行外层站点。请在模板里补充「外层站点」列，或先切到目标外层站点后再运行，也可勾选“外层站点范围”展开执行。'
    }

    const sourceRows = getSourceRows(context)
    if (!sourceRows.length) {
      return `已读取到 SPU，但所选外层站点未命中当前页面可用项：${requestedOuterSites.join(' / ') || '无'}`
    }

    return '未从导入文件中读取到可用商品'
  }

  function getVisibleDrawer() {
    const candidates = [
      ...document.querySelectorAll('[class*="Drawer_content_"]'),
      ...document.querySelectorAll('[class*="Drawer_outerWrapper_"]'),
    ].filter(isVisible)
    return candidates.find(el => el.querySelector('table') || /商品数据分析/.test(textOf(el))) || null
  }

  function isDetailDrawerOpen() {
    return !!getVisibleDrawer()
  }

  function isInsideVisibleDrawer(el) {
    const drawer = getVisibleDrawer()
    return !!(drawer && el && drawer.contains(el))
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

  function getOuterSiteClick(siteLabel) {
    const node = getOuterSiteNodes().find(item =>
      textOf(item) === siteLabel &&
      !hasClassFragment(item, 'index-module__disabled___'),
    )
    return getCenterClick(node)
  }

  function findMainButton(text) {
    return [...document.querySelectorAll('button')]
      .filter(isVisible)
      .find(btn => !isInsideVisibleDrawer(btn) && textOf(btn) === text) || null
  }

  async function waitForTargetReady(timeout = 15000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const hasSites = getAvailableOuterSites().length > 0
      const hasProductSection = /商品明细/.test(textOf(document.body))
      const hasQuery = !!findMainButton('查询')
      if (hasSites && hasProductSection && hasQuery) return true
      await sleep(600)
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

  function getListPageNo() {
    const active = getMainPagerRoot().querySelector('li[class*="PGT_pagerItemActive_"]')
    const value = parseInt(textOf(active), 10)
    return Number.isFinite(value) && value > 0 ? value : 1
  }

  function hasNextListPage() {
    const next = getMainPagerRoot().querySelector('li[class*="PGT_next_"]')
    return !!(next && !hasClassFragment(next, 'PGT_disabled_'))
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

  function getListPageSignature() {
    const rows = getMainListRows()
    if (!rows.length) {
      return `list:empty:${compact(textOf(getMainListTable() || getMainListHeaderTable())).slice(0, 120)}`
    }
    const first = compact(textOf(rows[0])).slice(0, 120)
    const last = compact(textOf(rows[rows.length - 1])).slice(0, 120)
    return `list:${rows.length}:${first}:${last}`
  }

  async function waitForListReady(timeout = 15000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const rows = getMainListRows()
      const empty = !!document.querySelector('[class*="TB_empty_"]')
      const busy = hasBusyWarning() && rows.length === 0
      if (rows.length > 0 || empty || busy) {
        return { ready: true, rows, empty, busy }
      }
      await sleep(700)
    }
    return {
      ready: false,
      rows: getMainListRows(),
      empty: !!document.querySelector('[class*="TB_empty_"]'),
      busy: hasBusyWarning(),
    }
  }

  async function waitListPageChange(oldSignature, timeout = 10000) {
    return await waitFor(() => getListPageSignature() !== oldSignature, timeout, 700)
  }

  async function ensureListPageNo(targetPage, timeout = 30000) {
    const deadline = Date.now() + timeout
    let guard = 0
    while (Date.now() < deadline && guard < SAFE_PAGE_LOOP_LIMIT) {
      guard += 1
      const current = getListPageNo()
      if (current === targetPage) return true
      const oldSig = getListPageSignature()
      const moved = current < targetPage ? clickNextListPage() : clickPrevListPage()
      if (!moved) return false
      const changed = await waitListPageChange(oldSig, 10000)
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
    const candidates = [...document.querySelectorAll('div, label, span')]
      .filter(isVisible)
      .filter(el => textOf(el) === labelText)
    for (const label of candidates) {
      let cursor = label
      for (let depth = 0; depth < 4 && cursor; depth += 1) {
        if (cursor.querySelector?.('input, [class*="ST_outerWrapper_"], [class*="CSD_cascaderWrapper_"]')) {
          return cursor
        }
        cursor = cursor.parentElement
      }
    }
    return null
  }

  function getVisibleOptionNodes() {
    return [...document.querySelectorAll(
      '[class*="ST_option_"], [class*="ST_item_"], [class*="cIL_item_"], [role="option"], li[class*="option"]',
    )].filter(isVisible)
  }

  function clickOption(optionText) {
    const targetText = compact(optionText)
    const target = getVisibleOptionNodes().find(opt => compact(textOf(opt)) === targetText)
    if (!target) return false
    clickLike(target)
    return true
  }

  function clickOptionByMatcher(matcher) {
    const target = getVisibleOptionNodes().find(opt => matcher(textOf(opt), opt))
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

  async function clickListTimeCapsule(label) {
    if (!LIST_TIME_OPTIONS.includes(label)) return true
    const capsule = [...document.querySelectorAll('[class*="TAB_capsule_"]')]
      .filter(isVisible)
      .find(el => !isInsideVisibleDrawer(el) && textOf(el) === label)
    if (!capsule) return false
    if (hasClassFragment(capsule, 'TAB_active_')) return true
    clickLike(capsule)
    await sleep(800)
    return true
  }

  function findVisibleDetailAction(row) {
    if (!row) return null
    return [...row.querySelectorAll('a, button')]
      .filter(isVisible)
      .find(el => textOf(el) === '查看详情') || null
  }

  function getDetailOpenClickForSpu(spu) {
    const rows = getMainListRows()
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      const rowText = textOf(row)
      if (!rowText.includes(spu)) continue
      const action = findVisibleDetailAction(row)
      const click = getCenterClick(action)
      if (click) return click
    }
    return null
  }

  function getDetailCloseButton() {
    return document.querySelector('[data-testid="beast-core-icon-close"]')
  }

  function getDetailHeaderTable() {
    const drawer = getVisibleDrawer()
    if (!drawer) return null
    return [...drawer.querySelectorAll('table')]
      .filter(isVisible)
      .find(table => countTableHeaderCells(table) > 0) || null
  }

  function getDetailRows() {
    const drawer = getVisibleDrawer()
    if (!drawer) return []
    return [...drawer.querySelectorAll('tbody tr[class*="TB_tr_"], tr[class*="TB_tr_"]')]
      .filter(row => isVisible(row) && row.querySelectorAll('td').length > 0)
  }

  function getDetailPagerRoot() {
    const drawer = getVisibleDrawer()
    if (!drawer) return document
    const next = [...drawer.querySelectorAll('li[class*="PGT_next_"]')]
      .filter(isVisible)[0]
    return next?.closest('[class*="PGT_outerWrapper_"], [class*="PGT_pagerWrapper_"], ul, div') || drawer
  }

  function getDetailPageNo() {
    const active = getDetailPagerRoot().querySelector('li[class*="PGT_pagerItemActive_"]')
    const value = parseInt(textOf(active), 10)
    return Number.isFinite(value) && value > 0 ? value : 1
  }

  function hasNextDetailPage() {
    const next = getDetailPagerRoot().querySelector('li[class*="PGT_next_"]')
    return !!(next && !hasClassFragment(next, 'PGT_disabled_'))
  }

  function clickNextDetailPage() {
    const next = getDetailPagerRoot().querySelector('li[class*="PGT_next_"]')
    if (!next || hasClassFragment(next, 'PGT_disabled_')) return false
    return clickPagerLike(next)
  }

  function clickPrevDetailPage() {
    const prev = getDetailPagerRoot().querySelector('li[class*="PGT_prev_"]')
    if (!prev || hasClassFragment(prev, 'PGT_disabled_')) return false
    return clickPagerLike(prev)
  }

  function getDetailPageSignature() {
    const rows = getDetailRows()
    if (!rows.length) return `detail:empty:${compact(textOf(getVisibleDrawer())).slice(0, 120)}`
    const first = compact(textOf(rows[0])).slice(0, 120)
    const last = compact(textOf(rows[rows.length - 1])).slice(0, 120)
    return `detail:${rows.length}:${first}:${last}`
  }

  async function waitDetailPageChange(oldSignature, oldPageNo = 0, timeout = 10000) {
    return await waitFor(() => {
      const pageChanged = oldPageNo > 0 ? getDetailPageNo() !== oldPageNo : true
      if (!pageChanged) return false
      return getDetailPageSignature() !== oldSignature
    }, timeout, 700)
  }

  async function waitForDetailReady(timeout = 20000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const drawer = getVisibleDrawer()
      const rows = getDetailRows()
      const empty = !!drawer?.querySelector('[class*="TB_empty_"]')
      const busy = hasBusyWarning() && rows.length === 0
      if (drawer && (rows.length > 0 || empty || busy)) {
        return { ready: true, rows, empty, busy }
      }
      await sleep(900)
    }
    return { ready: false, rows: getDetailRows(), empty: false, busy: false }
  }

  async function ensureDetailPageNo(targetPage, timeout = 20000) {
    const deadline = Date.now() + timeout
    let guard = 0
    while (Date.now() < deadline && guard < SAFE_PAGE_LOOP_LIMIT) {
      guard += 1
      const current = getDetailPageNo()
      if (current === targetPage) return true
      const oldSig = getDetailPageSignature()
      await sleep(DETAIL_PAGER_THROTTLE_MS)
      const moved = current < targetPage ? clickNextDetailPage() : clickPrevDetailPage()
      if (!moved) return false
      const changed = await waitDetailPageChange(oldSig, current, 10000)
      if (!changed) return false
      const ready = await waitForDetailReady(10000)
      if (!ready.ready) return false
    }
    return getDetailPageNo() === targetPage
  }

  function getVisibleDrawerSelectInputs() {
    const drawer = getVisibleDrawer()
    if (!drawer) return []
    return [...drawer.querySelectorAll('input[data-testid="beast-core-select-htmlInput"]')]
      .filter(isVisible)
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect()
        const bRect = b.getBoundingClientRect()
        return aRect.top - bRect.top
      })
  }

  function getSelectWrapper(input) {
    if (!input) return null
    return (
      input.closest?.('[data-testid="beast-core-select"]') ||
      input.closest?.('[class*="ST_outerWrapper_"]') ||
      input.parentElement ||
      null
    )
  }

  function readSelectInputValue(input) {
    if (!input) return ''
    const inputValue = String(input.value || '').trim()
    if (inputValue) return inputValue
    return String(textOf(getSelectWrapper(input)) || '').trim()
  }

  function getDetailSiteSelectInput() {
    return getVisibleDrawerSelectInputs()
      .find(input => parsePositiveInt(readSelectInputValue(input)) === 0) || null
  }

  function getDetailSiteSelectWrapper() {
    const input = getDetailSiteSelectInput()
    return getSelectWrapper(input)
  }

  function getDetailSiteValue() {
    return readSelectInputValue(getDetailSiteSelectInput())
  }

  function getDetailPageSizeInput() {
    const inputs = getVisibleDrawerSelectInputs()
    if (!inputs.length) return null
    const numericInputs = inputs.filter(input => parsePositiveInt(readSelectInputValue(input)) > 0)
    if (numericInputs.length) return numericInputs[numericInputs.length - 1]
    return inputs.length > 1 ? inputs[inputs.length - 1] : null
  }

  function getDetailPageSizeWrapper() {
    return getSelectWrapper(getDetailPageSizeInput())
  }

  function getDetailPageSizeValue() {
    return readSelectInputValue(getDetailPageSizeInput())
  }

  function getDetailPageSizeTrigger() {
    const wrapper = getDetailPageSizeWrapper()
    if (!wrapper) return null
    return (
      wrapper.querySelector('[data-testid="beast-core-input-suffix"]') ||
      wrapper.querySelector('[data-testid="beast-core-select-header"]') ||
      wrapper.querySelector('[class*="ST_head_"]') ||
      wrapper.querySelector('svg[data-testid="beast-core-icon-down"]')?.parentElement ||
      wrapper
    )
  }

  async function openDetailPageSizeDropdown() {
    const wrapper = getDetailPageSizeWrapper()
    const candidates = [getDetailPageSizeTrigger(), wrapper].filter(Boolean)
    for (const candidate of candidates) {
      clickLike(candidate)
      const opened = await waitFor(() => getVisibleOptionNodes().length > 0, 3200, 250)
      if (opened) return true
    }
    return false
  }

  function clickDetailPageSizeOption(targetSize) {
    const wanted = String(targetSize || '').trim()
    if (!wanted) return false
    return clickOptionByMatcher(text => {
      const textValue = String(text || '').trim()
      if (!textValue) return false
      const parsed = parsePositiveInt(textValue)
      if (!parsed) return false
      return String(parsed) === wanted
    })
  }

  async function ensureDetailPageSize(targetSize = detailPageSize) {
    const wanted = normalizePageSizeParam(targetSize, detailPageSize)
    const currentValue = getDetailPageSizeValue()
    if (parsePositiveInt(currentValue) === parsePositiveInt(wanted)) return true

    const oldSig = getDetailPageSignature()
    const oldPageNo = getDetailPageNo()
    const opened = await openDetailPageSizeDropdown()
    if (!opened) return false
    if (!clickDetailPageSizeOption(wanted)) {
      clickLike(document.body)
      await sleep(300)
      return false
    }

    const inputUpdated = await waitFor(() => {
      return parsePositiveInt(getDetailPageSizeValue()) === parsePositiveInt(wanted)
    }, 5000, 300)
    if (!inputUpdated) {
      clickLike(document.body)
      await sleep(300)
      return false
    }

    await waitFor(() => {
      const pageChanged = getDetailPageNo() !== oldPageNo
      const dataChanged = getDetailPageSignature() !== oldSig
      return pageChanged || dataChanged || parsePositiveInt(getDetailPageSizeValue()) === parsePositiveInt(wanted)
    }, 5000, 400)

    const ready = await waitForDetailReady(15000)
    if (!ready.ready || ready.busy) return false
    return parsePositiveInt(getDetailPageSizeValue()) === parsePositiveInt(wanted)
  }

  function getVisibleOptionTexts(allowedOptions = []) {
    const texts = [...new Set(getVisibleOptionNodes().map(textOf).filter(Boolean))]
    if (!allowedOptions.length) return texts
    return texts.filter(text => allowedOptions.includes(text))
  }

  function getDetailRowSites() {
    const sites = getDetailRows()
      .map(row => textOf(row.querySelectorAll('td')[1]))
      .filter(Boolean)
    return [...new Set(sites)]
  }

  async function readDetailSiteOptions() {
    const wrapper = getDetailSiteSelectWrapper()
    if (!wrapper) {
      const rowSites = getDetailRowSites()
      return rowSites.length ? rowSites : [getDetailSiteValue()].filter(Boolean)
    }
    clickLike(wrapper)
    await sleep(700)
    const options = getVisibleOptionTexts(DETAIL_SITE_OPTIONS)
    clickLike(document.body)
    await sleep(400)
    if (options.length) return options
    const rowSites = getDetailRowSites()
    return rowSites.length ? rowSites : [getDetailSiteValue()].filter(Boolean)
  }

  async function ensureDetailSiteSelected(siteLabel) {
    if (!siteLabel) return true
    if (getDetailSiteValue() === siteLabel) return true
    const wrapper = getDetailSiteSelectWrapper()
    if (!wrapper) {
      const rowSites = getDetailRowSites()
      return !rowSites.length || rowSites.includes(siteLabel)
    }
    if (!wrapper) return false
    clickLike(wrapper)
    await sleep(600)
    if (!clickOption(siteLabel)) {
      clickLike(document.body)
      return false
    }
    return await waitFor(() => getDetailSiteValue() === siteLabel, 4000, 400)
  }

  async function clickDetailCapsule(label) {
    const drawer = getVisibleDrawer()
    if (!drawer) return false
    const capsule = [...drawer.querySelectorAll('[class*="TAB_capsule_"]')]
      .filter(isVisible)
      .find(el => textOf(el) === label)
    if (!capsule) return false
    if (hasClassFragment(capsule, 'TAB_active_')) return true
    clickLike(capsule)
    await sleep(800)
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

  function getDrawerHeaderInfo() {
    const drawer = getVisibleDrawer()
    if (!drawer) return {}
    const drawerText = textOf(drawer)
    const titleInfo = textOf(drawer.querySelector('[class*="index-module__goodsInfo___"], [class*="index-module__drawer-header___"], [class*="index-module__goodsTitle___"]'))
    const spuMatch = drawerText.match(/SPU ID[:：]?\s*([0-9]+)/i)
    return {
      抽屉商品信息: titleInfo,
      抽屉统计时间: (drawerText.match(/统计时间[:：]\s*([^]+?)流量明细/) || [])[1]?.trim() || '',
      抽屉SPU: spuMatch?.[1] || '',
    }
  }

  function scrapeCurrentDetailPage(sharedState) {
    const rows = getDetailRows()
    const drawerInfo = getDrawerHeaderInfo()
    return rows.map((row, index) => {
      const cells = [...row.querySelectorAll('td')]
      const obj = {
        记录类型: '明细',
        外层站点: sharedState.currentOuterSite || '',
        源列表序号: Number(sharedState.currentExecNo || 0),
        SPU: sharedState.currentSpu || '',
        商品名称: sharedState.currentProductName || '',
        详情站点筛选: sharedState.currentDetailSite || '',
        详情时间粒度: sharedState.currentDetailGrain || '',
        详情时间范围: detailTimeRange || '当前页面',
        详情页码: getDetailPageNo(),
        抓取时间: localNow(),
        ...drawerInfo,
      }
      DETAIL_TABLE_COLUMN_KEYS.forEach((columnKey, cellIndex) => {
        obj[columnKey] = textOf(cells[cellIndex])
      })
      return obj
    })
  }

  function normalizeSharedStringArray(value) {
    if (!Array.isArray(value)) return []
    return value.map(item => String(item || '').trim()).filter(Boolean)
  }

  function buildDetailBusinessKey(row) {
    const keys = [
      '记录类型',
      '外层站点',
      'SPU',
      '商品名称',
      '详情站点筛选',
      '详情时间粒度',
      '详情时间范围',
      '抽屉商品信息',
      '抽屉统计时间',
      '抽屉SPU',
      ...DETAIL_TABLE_COLUMN_KEYS,
    ]
    return keys.map(key => `${key}:${compact(row?.[key])}`).join('|')
  }

  function buildDetailPageFingerprint(rows) {
    return rows.map(buildDetailBusinessKey).join('@@')
  }

  function collectUniqueDetailRows(rows, seenKeySet) {
    const uniqueRows = []
    let duplicateCount = 0
    for (const row of rows) {
      const key = buildDetailBusinessKey(row)
      if (!key) continue
      if (seenKeySet.has(key)) {
        duplicateCount += 1
        continue
      }
      seenKeySet.add(key)
      uniqueRows.push(row)
    }
    return { uniqueRows, duplicateCount }
  }

  function isSwitchingDetailCombo(sharedState, combo) {
    const lastSite = String(sharedState.lastAppliedDetailSite || '').trim()
    const lastGrain = String(sharedState.lastAppliedDetailGrain || '').trim()
    if (!lastSite && !lastGrain) return false
    return lastSite !== String(combo.site || '').trim() || lastGrain !== String(combo.grain || '').trim()
  }

  function buildErrorRow(reason, sharedState, extra = {}) {
    return {
      记录类型: '异常',
      外层站点: sharedState.currentOuterSite || '',
      源列表序号: Number(sharedState.currentExecNo || 0),
      SPU: sharedState.currentSpu || '',
      商品名称: sharedState.currentProductName || '',
      详情站点筛选: sharedState.currentDetailSite || '',
      详情时间粒度: sharedState.currentDetailGrain || '',
      详情时间范围: detailTimeRange || '当前页面',
      错误阶段: phase,
      原因: reason,
      抓取时间: localNow(),
      ...extra,
    }
  }

  function buildBusyReload(nextPhaseName, sharedState) {
    const retry = Number(sharedState.listBusyRetry || 0)
    if (retry >= LIST_BUSY_RETRY_LIMIT) {
      return fail('Temu 商品流量页面连续出现 “Too many visitors...” 空表，刷新补偿后仍未恢复')
    }
    return reloadPage(nextPhaseName, 3000, {
      ...sharedState,
      listBusyRetry: retry + 1,
    })
  }

  function buildDetailTargetSites(availableSites) {
    if (!detailSitesParam.length) return availableSites
    return detailSitesParam.filter(item => availableSites.includes(item))
  }

  function buildDetailTargetGrains() {
    if (!detailGrainsParam.length) return DETAIL_GRAIN_OPTIONS.slice()
    return detailGrainsParam.filter(item => DETAIL_GRAIN_OPTIONS.includes(item))
  }

  async function buildDetailTargetSitesByGrain(targetGrains) {
    const map = {}
    for (const grain of targetGrains) {
      const grainOk = await clickDetailCapsule(grain)
      if (!grainOk) {
        map[grain] = []
        continue
      }
      const ready = await waitForDetailReady(12000)
      if (!ready.ready || ready.busy) {
        map[grain] = []
        continue
      }
      map[grain] = buildDetailTargetSites(await readDetailSiteOptions())
    }
    return map
  }

  function normalizeDetailSiteMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const map = {}
    Object.entries(value).forEach(([grain, sites]) => {
      const key = String(grain || '').trim()
      if (!key) return
      map[key] = normalizeArray(sites)
    })
    return map
  }

  function getDetailSitesForGrain(sharedState, grain) {
    const grainKey = String(grain || '').trim()
    const siteMap = normalizeDetailSiteMap(sharedState.targetDetailSitesByGrain)
    const mappedSites = normalizeArray(siteMap[grainKey])
    if (mappedSites.length) return mappedSites
    return normalizeArray(sharedState.targetDetailSites)
  }

  function countDetailCombos(grains, sharedState) {
    return grains.reduce((sum, grain) => sum + getDetailSitesForGrain(sharedState || {}, grain).length, 0)
  }

  function getDetailCombo(sharedState) {
    const grains = sharedState.targetDetailGrains || []
    const siteIndex = Number(sharedState.detailSiteIndex || 0)
    const grainIndex = Number(sharedState.detailGrainIndex || 0)
    const grain = grains[grainIndex] || ''
    const sites = getDetailSitesForGrain(sharedState, grain)
    return {
      site: sites[siteIndex] || '',
      grain,
      siteIndex,
      grainIndex,
      sites,
      grains,
    }
  }

  function getNextDetailCursor(sharedState) {
    const combo = getDetailCombo(sharedState)
    if (!combo.grains.length) return null
    if (combo.siteIndex + 1 < combo.sites.length) {
      return { detailSiteIndex: combo.siteIndex + 1, detailGrainIndex: combo.grainIndex }
    }
    for (let nextGrainIndex = combo.grainIndex + 1; nextGrainIndex < combo.grains.length; nextGrainIndex += 1) {
      const nextGrain = combo.grains[nextGrainIndex] || ''
      const nextSites = getDetailSitesForGrain(sharedState, nextGrain)
      if (nextSites.length) {
        return { detailSiteIndex: 0, detailGrainIndex: nextGrainIndex }
      }
    }
    return null
  }

  function advanceToNextDetailCombo(sharedState, data = []) {
    const nextCursor = getNextDetailCursor(sharedState)
    if (!nextCursor) {
      return nextPhase('close_detail', 0, sharedState, data)
    }
    return nextPhase('collect_detail_combo', 0, {
      ...sharedState,
      ...nextCursor,
      detailResumePageNo: 1,
      detailPageRetry: 0,
      detailSeenRowKeys: [],
      detailSeenPageFingerprints: [],
    }, data)
  }

  function skipCurrentDetailCombo(sharedState, reason, data = []) {
    return advanceToNextDetailCombo(sharedState, [
      ...data,
      buildErrorRow(reason, sharedState),
    ])
  }

  function scheduleDetailComboRecovery(sharedState, reason, resumePageNo, data = []) {
    const retry = Number(sharedState.detailPageRetry || 0)
    const targetPageNo = Math.max(1, Number(resumePageNo || sharedState.detailResumePageNo || getDetailPageNo() || 1))
    if (retry >= DETAIL_PAGE_RECOVERY_LIMIT) {
      return nextPhase('close_detail', 0, {
        ...sharedState,
        detailError: true,
      }, [
        ...data,
        buildErrorRow(`详情分页重试 ${retry} 次后仍失败：${reason}`, sharedState),
      ])
    }

    const nextShared = {
      ...sharedState,
      detailPageRetry: retry + 1,
      detailResumePageNo: targetPageNo,
      listBusyRetry: 0,
      detailOpenRetry: 0,
      resume_phase: 'restore_detail_combo',
    }

    if (isDetailDrawerOpen() && retry % 2 === 0) {
      return nextPhase('restore_detail_combo', 1500, nextShared, data)
    }

    return reloadPage('prepare_query', 3600, nextShared, data)
  }

  function getDetailComboProgress(sharedState) {
    const grains = sharedState.targetDetailGrains || []
    const siteIndex = Number(sharedState.detailSiteIndex || 0)
    const grainIndex = Number(sharedState.detailGrainIndex || 0)
    const total = countDetailCombos(grains, sharedState)
    let current = 0
    for (let index = 0; index < grainIndex; index += 1) {
      current += getDetailSitesForGrain(sharedState, grains[index] || '').length
    }
    if (total > 0) current += siteIndex + 1
    return { current, total }
  }

  async function collectCurrentDetailCombo(sharedState) {
    const data = []
    const seenRowKeys = new Set(normalizeSharedStringArray(sharedState.detailSeenRowKeys))
    const seenPageFingerprints = new Set(normalizeSharedStringArray(sharedState.detailSeenPageFingerprints))
    let loop = 0
    while (loop < SAFE_PAGE_LOOP_LIMIT) {
      loop += 1
      const ready = await waitForDetailReady(20000)
      if (!ready.ready) {
        return {
          ok: false,
          retryable: true,
          error: '详情表格加载超时',
          resumePageNo: Math.max(1, Number(sharedState.detailResumePageNo || getDetailPageNo() || 1)),
          data,
          seenRowKeys: [...seenRowKeys],
          seenPageFingerprints: [...seenPageFingerprints],
        }
      }
      if (ready.busy) {
        return {
          ok: false,
          retryable: true,
          error: '详情分页触发 Too many visitors',
          resumePageNo: Math.max(1, Number(sharedState.detailResumePageNo || getDetailPageNo() || 1)),
          data,
          seenRowKeys: [...seenRowKeys],
          seenPageFingerprints: [...seenPageFingerprints],
        }
      }
      const currentPageNo = getDetailPageNo()
      const pageRows = scrapeCurrentDetailPage(sharedState)
      const pageFingerprint = buildDetailPageFingerprint(pageRows)
      if (pageFingerprint && seenPageFingerprints.has(pageFingerprint)) {
        return {
          ok: false,
          retryable: true,
          error: `详情翻页疑似命中已抓取页面：第 ${currentPageNo} 页内容与历史页面重复`,
          resumePageNo: currentPageNo,
          data,
          seenRowKeys: [...seenRowKeys],
          seenPageFingerprints: [...seenPageFingerprints],
        }
      }

      const { uniqueRows, duplicateCount } = collectUniqueDetailRows(pageRows, seenRowKeys)
      if (pageRows.length && duplicateCount > 0) {
        return {
          ok: false,
          retryable: true,
          error: `详情翻页疑似读到重复内容：第 ${currentPageNo} 页有 ${duplicateCount} 条已抓取记录`,
          resumePageNo: currentPageNo,
          data,
          seenRowKeys: [...seenRowKeys],
          seenPageFingerprints: [...seenPageFingerprints],
        }
      }

      if (pageFingerprint) seenPageFingerprints.add(pageFingerprint)
      data.push(...uniqueRows)
      if (!detailFullPaging || !hasNextDetailPage()) {
        return {
          ok: true,
          data,
          seenRowKeys: [...seenRowKeys],
          seenPageFingerprints: [...seenPageFingerprints],
        }
      }
      await sleep(DETAIL_PAGER_THROTTLE_MS)
      const oldSig = getDetailPageSignature()
      if (!clickNextDetailPage()) {
        return {
          ok: false,
          retryable: true,
          error: '详情翻页失败：无法点击下一页',
          resumePageNo: currentPageNo + 1,
          data,
          seenRowKeys: [...seenRowKeys],
          seenPageFingerprints: [...seenPageFingerprints],
        }
      }
      const changed = await waitDetailPageChange(oldSig, currentPageNo, 10000)
      if (!changed) {
        return {
          ok: false,
          retryable: true,
          error: '详情翻页失败：页码变化后数据未更新',
          resumePageNo: currentPageNo + 1,
          data,
          seenRowKeys: [...seenRowKeys],
          seenPageFingerprints: [...seenPageFingerprints],
        }
      }
    }
    return {
      ok: false,
      retryable: false,
      error: '详情翻页超过安全上限',
      data,
      seenRowKeys: [...seenRowKeys],
      seenPageFingerprints: [...seenPageFingerprints],
    }
  }

  async function prepareSearchForCurrentSource(sharedState) {
    const productOk = await ensureProductTrafficSection()
    if (!productOk) return fail('未能切回「商品流量」tab')

    const listState = await waitForListReady(12000)
    if (!listState.ready) return fail('商品流量列表加载超时')
    if (listState.busy) return buildBusyReload('prepare_query', sharedState)

    if (!clickLike(findMainButton('重置'))) {
      return fail('未找到商品流量列表的「重置」按钮')
    }
    await sleep(1200)

    if (LIST_TIME_OPTIONS.includes(sharedState.currentListTimeRange || '')) {
      const timeOk = await clickListTimeCapsule(sharedState.currentListTimeRange)
      if (!timeOk) return fail(`切换源列表时间范围失败：${sharedState.currentListTimeRange}`)
    }

    const typeOk = await setMainSelectByLabel('商品ID查询', 'SPU')
    if (!typeOk) return fail('商品ID查询类型切换到 SPU 失败')

    const inputContainer = getLabeledContainer('商品ID查询')
    const input = inputContainer
      ? [...inputContainer.querySelectorAll('input')].find(node => String(node.getAttribute('data-testid') || '') !== 'beast-core-select-htmlInput')
      : null
    if (!input || !setNativeInputValue(input, sharedState.currentSpu || '')) {
      return fail(`填写 SPU 查询失败：${sharedState.currentSpu || '未知 SPU'}`)
    }

    if (!clickLike(findMainButton('查询'))) {
      return fail('未找到商品流量列表的「查询」按钮')
    }
    await sleep(1800)

    const afterQuery = await waitForListReady(15000)
    if (!afterQuery.ready) return fail('按 SPU 查询后列表加载超时')
    if (afterQuery.busy) return buildBusyReload('prepare_query', sharedState)

    const pageResetOk = await ensureListPageNo(1, 20000)
    if (!pageResetOk) return fail('SPU 查询后列表未能回到第一页')

    const click = getDetailOpenClickForSpu(sharedState.currentSpu || '')
    if (!click) {
      return nextPhase('process_source_row', 0, {
        ...sharedState,
        rowIndex: Number(sharedState.rowIndex || 0) + 1,
        listBusyRetry: 0,
      }, [
        buildErrorRow('按 SPU 查询后未找到可打开的详情行，已跳过当前商品', sharedState),
      ])
    }

    return cdpClicks([click], 'after_open_detail', 2200, {
      ...sharedState,
      detailOpenRetry: 0,
      listBusyRetry: 0,
    })
  }

  try {
    if (phase === 'main') {
      return nextPhase('ensure_target', 0)
    }

    if (phase === 'ensure_target') {
      if (!location.href.includes('/main/flux-analysis-full')) {
        location.href = TARGET_URL
        return nextPhase('ensure_target', mode === 'new' ? 3000 : 2200)
      }

      const ready = await waitForTargetReady(15000)
      if (!ready) return fail('Temu 商品流量页面未加载，请确认已登录并能打开「后台-商品流量」页面')
      const availableOuterSites = getAvailableOuterSites().map(item => item.text)
      const fallbackOuterSite = getActiveOuterSite() || availableOuterSites[0] || ''
      const sourceRows = getSourceRows({ availableOuterSites, fallbackOuterSite })
      if (!sourceRows.length) {
        return fail(buildSourceRowsError({ availableOuterSites, fallbackOuterSite }))
      }
      return nextPhase('process_source_row', 0, {
        rowIndex: 0,
        total_rows: sourceRows.length,
        processed_count: 0,
        current_exec_no: 0,
        current_row_no: 0,
        current_buyer_id: '',
        current_store: '',
        availableOuterSites,
        fallbackOuterSite,
      })
    }

    if (phase === 'process_source_row') {
      const sourceRows = getSourceRows(shared)
      const rowIndex = Number(shared.rowIndex || 0)
      if (rowIndex >= sourceRows.length) return complete([], false)

      const current = sourceRows[rowIndex]
      const nextShared = {
        ...shared,
        rowIndex,
        total_rows: sourceRows.length,
        processed_count: Number(shared.processed_count || 0),
        currentExecNo: rowIndex + 1,
        current_exec_no: rowIndex + 1,
        current_row_no: rowIndex + 1,
        current_buyer_id: current.spu || '',
        current_store: current.outerSite || '',
        currentOuterSite: current.outerSite || '',
        currentSpu: current.spu || '',
        currentProductName: current.productName || '',
        currentListTimeRange: current.listTimeRange || '',
        batch_no: 0,
        total_batches: 0,
      }

      const targetSite = current.outerSite || ''
      if (targetSite && getActiveOuterSite() !== targetSite) {
        const click = getOuterSiteClick(targetSite)
        if (!click) {
          return nextPhase('process_source_row', 0, {
            ...nextShared,
            rowIndex: rowIndex + 1,
            processed_count: rowIndex + 1,
          }, [
            buildErrorRow(`无法切换到外层站点：${targetSite}`, nextShared),
          ])
        }
        return cdpClicks([click], 'after_outer_site_switch', 3600, {
          ...nextShared,
          targetOuterSite: targetSite,
          resume_phase: 'prepare_query',
        })
      }

      return nextPhase('prepare_query', 400, nextShared)
    }

    if (phase === 'after_outer_site_switch') {
      const ready = await waitForTargetReady(15000)
      if (!ready) return fail(`切换外层站点后页面未恢复：${shared.targetOuterSite || '未知站点'}`)
      const state = await waitForListReady(12000)
      if (!state.ready) return fail(`切换外层站点后列表未加载：${shared.targetOuterSite || '未知站点'}`)
      if (state.busy) return buildBusyReload('after_outer_site_switch', shared)
      return nextPhase(shared.resume_phase || 'prepare_query', 400, {
        ...shared,
        listBusyRetry: 0,
      })
    }

    if (phase === 'prepare_query') {
      return await prepareSearchForCurrentSource(shared)
    }

    if (phase === 'after_open_detail') {
      const opened = await waitFor(() => isDetailDrawerOpen(), 10000, 500)
      if (!opened) {
        const retry = Number(shared.detailOpenRetry || 0)
        if (retry + 1 < DETAIL_OPEN_RETRY_LIMIT) {
          const click = getDetailOpenClickForSpu(shared.currentSpu || '')
          if (!click) {
            return nextPhase('process_source_row', 0, {
              ...shared,
              rowIndex: Number(shared.rowIndex || 0) + 1,
              processed_count: Number(shared.rowIndex || 0) + 1,
            }, [
              buildErrorRow('查看详情抽屉打开失败，且无法重新定位当前商品', shared),
            ])
          }
          return cdpClicks([click], 'after_open_detail', 2200, {
            ...shared,
            detailOpenRetry: retry + 1,
          })
        }
        return nextPhase('process_source_row', 0, {
          ...shared,
          rowIndex: Number(shared.rowIndex || 0) + 1,
          processed_count: Number(shared.rowIndex || 0) + 1,
        }, [
          buildErrorRow('查看详情抽屉打开失败，已跳过当前商品', shared),
        ])
      }
      return nextPhase(shared.resume_phase || 'prepare_detail', 400, {
        ...shared,
        detailOpenRetry: 0,
        resume_phase: '',
      })
    }

    if (phase === 'prepare_detail') {
      if (!isDetailDrawerOpen()) return fail('详情抽屉状态丢失，无法继续抓取')

      if (detailTimeRange) {
        const timeOk = await clickDetailCapsule(detailTimeRange)
        if (!timeOk) {
          return nextPhase('close_detail', 0, {
            ...shared,
            detailError: true,
          }, [
            buildErrorRow(`详情时间范围切换失败：${detailTimeRange}`, shared),
          ])
        }
      }

      const targetDetailGrains = buildDetailTargetGrains()
      const targetDetailSitesByGrain = await buildDetailTargetSitesByGrain(targetDetailGrains)
      const firstGrainSites = getDetailSitesForGrain({ targetDetailSitesByGrain }, targetDetailGrains[0] || '')
      const totalDetailCombos = countDetailCombos(targetDetailGrains, {
        targetDetailSitesByGrain,
        targetDetailSites: firstGrainSites,
      })

      if (!totalDetailCombos) {
        return nextPhase('close_detail', 0, {
          ...shared,
          detailError: true,
        }, [
          buildErrorRow('详情站点 / 粒度组合未命中当前页面可用项', shared),
        ])
      }

      if (!targetDetailGrains.length) {
        return nextPhase('close_detail', 0, {
          ...shared,
          detailError: true,
        }, [
          buildErrorRow('详情时间粒度未命中有效选项', shared),
        ])
      }

      return nextPhase('collect_detail_combo', 0, {
        ...shared,
        targetDetailSites: firstGrainSites,
        targetDetailSitesByGrain,
        targetDetailGrains,
        detailSiteIndex: 0,
        detailGrainIndex: 0,
        detailResumePageNo: 1,
        detailPageRetry: 0,
        batch_no: 1,
        total_batches: totalDetailCombos,
      })
    }

    if (phase === 'restore_detail_combo') {
      if (!isDetailDrawerOpen()) {
        return reloadPage('prepare_query', 3600, {
          ...shared,
          resume_phase: 'restore_detail_combo',
        })
      }

      const combo = getDetailCombo(shared)
      const comboProgress = getDetailComboProgress(shared)
      if (!combo.site || !combo.grain) {
        return scheduleDetailComboRecovery(shared, '详情组合游标异常，无法恢复抓取', 1)
      }

      if (detailTimeRange) {
        const timeOk = await clickDetailCapsule(detailTimeRange)
        if (!timeOk) {
          return scheduleDetailComboRecovery(shared, `详情时间范围切换失败：${detailTimeRange}`, 1)
        }
      }

      const grainOk = await clickDetailCapsule(combo.grain)
      if (!grainOk) {
        return scheduleDetailComboRecovery(shared, `详情时间粒度恢复失败：${combo.grain}`, Number(shared.detailResumePageNo || 1))
      }

      const grainState = await waitForDetailReady(12000)
      if (!grainState.ready) {
        return scheduleDetailComboRecovery(shared, `详情时间粒度恢复后加载超时：${combo.grain}`, Number(shared.detailResumePageNo || 1))
      }
      if (grainState.busy) {
        return scheduleDetailComboRecovery(shared, `详情时间粒度恢复后出现 Too many visitors：${combo.grain}`, Number(shared.detailResumePageNo || 1))
      }

      const availableDetailSites = await readDetailSiteOptions()
      if (!availableDetailSites.includes(combo.site)) {
        return skipCurrentDetailCombo({
          ...shared,
          currentDetailSite: combo.site,
          currentDetailGrain: combo.grain,
          batch_no: comboProgress.current,
          total_batches: comboProgress.total,
          current_store: [shared.currentOuterSite || '', combo.site || '', combo.grain || '']
            .filter(Boolean)
            .join(' / '),
          current_buyer_id: shared.currentSpu || '',
        }, `当前粒度下详情站点不可用，已跳过：${combo.site}`)
      }

      const siteOk = await ensureDetailSiteSelected(combo.site)
      if (!siteOk) {
        return scheduleDetailComboRecovery({
          ...shared,
          currentDetailSite: combo.site,
          currentDetailGrain: combo.grain,
        }, `详情站点切换失败：${combo.site}`, Number(shared.detailResumePageNo || 1))
      }

      await ensureDetailPageSize(detailPageSize)

      const resumePageNo = Math.max(1, Number(shared.detailResumePageNo || 1))
      if (resumePageNo > 1) {
        await sleep(DETAIL_PAGER_THROTTLE_MS)
        const pageResetOk = await ensureDetailPageNo(resumePageNo, 45000)
        if (!pageResetOk) {
          return scheduleDetailComboRecovery(shared, `详情恢复到第 ${resumePageNo} 页失败`, resumePageNo)
        }
      }

      const state = await waitForDetailReady(15000)
      if (!state.ready) {
        return scheduleDetailComboRecovery(shared, `详情恢复后的第 ${resumePageNo} 页加载超时`, resumePageNo)
      }
      if (state.busy) {
        return scheduleDetailComboRecovery(shared, `详情恢复后的第 ${resumePageNo} 页出现 Too many visitors`, resumePageNo)
      }

      return nextPhase('collect_detail_combo', 400, {
        ...shared,
        currentDetailSite: combo.site,
        currentDetailGrain: combo.grain,
        batch_no: comboProgress.current,
        total_batches: comboProgress.total,
        current_store: [shared.currentOuterSite || '', combo.site || '', combo.grain || '']
          .filter(Boolean)
          .join(' / '),
        current_buyer_id: shared.currentSpu || '',
      })
    }

    if (phase === 'collect_detail_combo') {
      if (!isDetailDrawerOpen()) {
        return nextPhase('process_source_row', 0, {
          ...shared,
          rowIndex: Number(shared.rowIndex || 0) + 1,
          processed_count: Number(shared.rowIndex || 0) + 1,
        }, [
          buildErrorRow('详情抽屉意外关闭，已跳过当前商品', shared),
        ])
      }

      const combo = getDetailCombo(shared)
      const comboProgress = getDetailComboProgress(shared)
      if (!combo.site || !combo.grain) {
        return nextPhase('close_detail', 0, {
          ...shared,
          detailError: true,
        }, [
          buildErrorRow('详情组合游标异常，无法继续抓取', shared),
        ])
      }

      if (isSwitchingDetailCombo(shared, combo)) {
        const preResetOk = await ensureDetailPageNo(1, 30000)
        if (!preResetOk) {
          return nextPhase('close_detail', 0, {
            ...shared,
            detailError: true,
            currentDetailSite: combo.site,
            currentDetailGrain: combo.grain,
          }, [
            buildErrorRow('切换详情组合前未能把上一轮分页重置到第一页', {
              ...shared,
              currentDetailSite: combo.site,
              currentDetailGrain: combo.grain,
            }),
          ])
        }
      }

      const grainOk = await clickDetailCapsule(combo.grain)
      if (!grainOk) {
        return nextPhase('close_detail', 0, {
          ...shared,
          detailError: true,
          currentDetailSite: combo.site,
          currentDetailGrain: combo.grain,
        }, [
          buildErrorRow(`详情时间粒度切换失败：${combo.grain}`, {
            ...shared,
            currentDetailSite: combo.site,
            currentDetailGrain: combo.grain,
          }),
        ])
      }

      const grainState = await waitForDetailReady(12000)
      if (!grainState.ready) {
        return nextPhase('close_detail', 0, {
          ...shared,
          detailError: true,
          currentDetailSite: combo.site,
          currentDetailGrain: combo.grain,
        }, [
          buildErrorRow(`详情时间粒度切换后加载超时：${combo.grain}`, {
            ...shared,
            currentDetailSite: combo.site,
            currentDetailGrain: combo.grain,
          }),
        ])
      }
      if (grainState.busy) {
        return scheduleDetailComboRecovery({
          ...shared,
          currentDetailSite: combo.site,
          currentDetailGrain: combo.grain,
        }, `详情时间粒度切换后出现 Too many visitors：${combo.grain}`, Number(shared.detailResumePageNo || 1))
      }

      const availableDetailSites = await readDetailSiteOptions()
      if (!availableDetailSites.includes(combo.site)) {
        return skipCurrentDetailCombo({
          ...shared,
          currentDetailSite: combo.site,
          currentDetailGrain: combo.grain,
          batch_no: comboProgress.current,
          total_batches: comboProgress.total,
          current_store: [shared.currentOuterSite || '', combo.site || '', combo.grain || '']
            .filter(Boolean)
            .join(' / '),
          current_buyer_id: shared.currentSpu || '',
        }, `当前粒度下详情站点不可用，已跳过：${combo.site}`)
      }

      const siteOk = await ensureDetailSiteSelected(combo.site)
      if (!siteOk) {
        const refreshedSites = await readDetailSiteOptions()
        if (!refreshedSites.includes(combo.site)) {
          return skipCurrentDetailCombo({
            ...shared,
            currentDetailSite: combo.site,
            currentDetailGrain: combo.grain,
            batch_no: comboProgress.current,
            total_batches: comboProgress.total,
            current_store: [shared.currentOuterSite || '', combo.site || '', combo.grain || '']
              .filter(Boolean)
              .join(' / '),
            current_buyer_id: shared.currentSpu || '',
          }, `当前粒度下详情站点不可用，已跳过：${combo.site}`)
        }
        return nextPhase('close_detail', 0, {
          ...shared,
          detailError: true,
          currentDetailSite: combo.site,
          currentDetailGrain: combo.grain,
        }, [
          buildErrorRow(`详情站点切换失败：${combo.site}`, {
            ...shared,
            currentDetailSite: combo.site,
            currentDetailGrain: combo.grain,
          }),
        ])
      }

      await ensureDetailPageSize(detailPageSize)

      const pageResetOk = await ensureDetailPageNo(1, 20000)
      if (!pageResetOk) {
        return nextPhase('close_detail', 0, {
          ...shared,
          detailError: true,
          currentDetailSite: combo.site,
          currentDetailGrain: combo.grain,
        }, [
          buildErrorRow('详情过滤后未能回到第一页', {
            ...shared,
            currentDetailSite: combo.site,
            currentDetailGrain: combo.grain,
          }),
        ])
      }

      const comboState = {
        ...shared,
        currentDetailSite: combo.site,
        currentDetailGrain: combo.grain,
        detailResumePageNo: Math.max(1, Number(shared.detailResumePageNo || 1)),
        detailSeenRowKeys: normalizeSharedStringArray(shared.detailSeenRowKeys),
        detailSeenPageFingerprints: normalizeSharedStringArray(shared.detailSeenPageFingerprints),
        batch_no: comboProgress.current,
        total_batches: comboProgress.total,
        current_store: [shared.currentOuterSite || '', combo.site || '', combo.grain || '']
          .filter(Boolean)
          .join(' / '),
        current_buyer_id: shared.currentSpu || '',
        lastAppliedDetailSite: combo.site,
        lastAppliedDetailGrain: combo.grain,
      }
      const result = await collectCurrentDetailCombo(comboState)
      const comboStateWithCollected = {
        ...comboState,
        detailSeenRowKeys: normalizeSharedStringArray(result.seenRowKeys),
        detailSeenPageFingerprints: normalizeSharedStringArray(result.seenPageFingerprints),
      }
      if (!result.ok) {
        if (result.retryable) {
          return scheduleDetailComboRecovery(
            comboStateWithCollected,
            result.error || '详情抓取失败',
            Number(result.resumePageNo || comboStateWithCollected.detailResumePageNo || 1),
            result.data || [],
          )
        }
        return nextPhase('close_detail', 0, {
          ...comboStateWithCollected,
          detailError: true,
        }, [
          ...(result.data || []),
          buildErrorRow(result.error || '详情抓取失败', comboStateWithCollected),
        ])
      }

      return advanceToNextDetailCombo(comboStateWithCollected, result.data)
    }

    if (phase === 'close_detail') {
      if (!isDetailDrawerOpen()) {
        return nextPhase('process_source_row', 300, {
          ...shared,
          rowIndex: Number(shared.rowIndex || 0) + 1,
          processed_count: Number(shared.rowIndex || 0) + 1,
          detailCloseRetry: 0,
        })
      }

      const closeBtn = getDetailCloseButton()
      if (!closeBtn) return fail('详情抽屉关闭失败：未找到关闭按钮')
      clickLike(closeBtn)
      const closed = await waitFor(() => !isDetailDrawerOpen(), 6000, 400)
      if (!closed) {
        const retry = Number(shared.detailCloseRetry || 0)
        if (retry + 1 < DETAIL_CLOSE_RETRY_LIMIT) {
          return nextPhase('close_detail', 600, {
            ...shared,
            detailCloseRetry: retry + 1,
          })
        }
        return reloadPage('process_source_row', 3600, {
          ...shared,
          rowIndex: Number(shared.rowIndex || 0) + 1,
          processed_count: Number(shared.rowIndex || 0) + 1,
          detailCloseRetry: 0,
          listBusyRetry: 0,
        }, [
          buildErrorRow('关闭详情抽屉失败，已刷新当前页面后继续后续商品', shared),
        ])
      }

      return nextPhase('process_source_row', 300, {
        ...shared,
        rowIndex: Number(shared.rowIndex || 0) + 1,
        processed_count: Number(shared.rowIndex || 0) + 1,
        detailCloseRetry: 0,
      })
    }

    return fail(`未知 phase: ${phase}`)
  } catch (error) {
    return fail(error?.message || String(error))
  }
})()
