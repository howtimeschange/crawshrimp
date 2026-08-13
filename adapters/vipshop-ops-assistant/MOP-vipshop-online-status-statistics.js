;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const SUMMARY_SHEET = '执行摘要'
  const DETAIL_SHEET = '商品状态明细'
  const VIPSHOP_ENTRY_URL = 'https://nov-admin.vip.com/admin/index.html#/normal/normalMerchandise'
  const MERCHANDISE_QUERY_URL = 'https://nov-admin.vip.com/normal/normalMerchandiseQuery'
  const DEFAULT_PAGE_SIZE = 500
  const DEFAULT_MAX_PAGES = 200
  const DEFAULT_DELAY_MS = 80

  function compact(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim()
  }

  function normalizeCode(value) {
    return compact(value).replace(/[\s"'`]+/g, '').toUpperCase()
  }

  function normalizeHeader(value) {
    return normalizeCode(value).replace(/[：:（）()\-_./\\]/g, '')
  }

  function rowValue(row, aliases) {
    const wanted = new Set((aliases || []).map(normalizeHeader))
    for (const [key, value] of Object.entries(row || {})) {
      if (wanted.has(normalizeHeader(key)) && compact(value)) return compact(value)
    }
    return ''
  }

  function collectFileRows(file) {
    const rows = []
    const seen = new Set()
    const pushRows = items => {
      for (const row of Array.isArray(items) ? items : []) {
        if (!row || typeof row !== 'object') continue
        const key = JSON.stringify(row)
        if (seen.has(key)) continue
        seen.add(key)
        rows.push(row)
      }
    }
    const sheets = file?.sheets && typeof file.sheets === 'object' ? file.sheets : null
    if (sheets && Object.keys(sheets).length) {
      for (const sheet of Object.values(sheets)) pushRows(sheet?.rows)
    } else {
      pushRows(file?.rows)
    }
    return rows
  }

  function parseList(value) {
    if (Array.isArray(value)) return value.map(normalizeCode).filter(Boolean)
    return compact(value).split(/[\n,，、;；\s]+/).map(normalizeCode).filter(Boolean)
  }

  function normalizeVipshopStatus(value) {
    const text = compact(value)
    if (text === '0') return '已下架'
    if (text === '1') return '上架中'
    if (text === '2') return '部分上架'
    if (text === '11') return '草稿/可编辑'
    if (text === '12') return '审核通过'
    if (text === '13') return '已提交审核'
    if (text === '14') return '审核驳回/可编辑'
    return text
  }

  function firstPresent(...values) {
    for (const value of values) {
      if (value !== undefined && value !== null && compact(value) !== '') return value
    }
    return ''
  }

  function statusCategory(value, row = {}) {
    const text = compact(firstPresent(value, row.商品状态, row.skuStatus, row.status, row.statusName))
    const normalized = normalizeVipshopStatus(text)
    const haystack = compact([
      normalized,
      row.saleStatus,
      row.sellStatus,
      row.shelvesStatus,
      row.onlineStatus,
      row.skuStatusName,
      row.auditStatusName,
    ].join(' '))
    if (/下线|下架|不可售|停售|已关闭|已删除|禁售|审核驳回|草稿/.test(haystack)) return 'offline'
    if (/上线|上架|在售|可售|售卖中|审核通过|部分上架/.test(haystack)) return 'online'
    if (['1', '2', '12'].includes(text)) return 'online'
    if (['11', '13', '14'].includes(text)) return 'offline'
    return 'other'
  }

  function countStatus(rows) {
    const counts = { total: 0, online: 0, offline: 0, other: 0 }
    for (const row of Array.isArray(rows) ? rows : []) {
      counts.total += 1
      const category = statusCategory(firstPresent(row.商品状态, row.skuStatus, row.status), row)
      if (category === 'online') counts.online += 1
      else if (category === 'offline') counts.offline += 1
      else counts.other += 1
    }
    return counts
  }

  function parsePreviousCounts(rawParams = params) {
    const previousRows = collectFileRows(rawParams.previous_file || rawParams.last_file || rawParams.baseline_file)
    if (previousRows.length) {
      const counted = countStatus(previousRows)
      return { ...counted, source: '上次商品信息表' }
    }
    const online = Number(rawParams.previous_online_count || rawParams.last_online_count || '')
    const offline = Number(rawParams.previous_offline_count || rawParams.last_offline_count || '')
    const hasOnline = Number.isFinite(online)
    const hasOffline = Number.isFinite(offline)
    if (hasOnline || hasOffline) {
      return {
        total: '',
        online: hasOnline ? online : 0,
        offline: hasOffline ? offline : 0,
        other: '',
        source: '手填上次数量',
      }
    }
    return { total: '', online: '', offline: '', other: '', source: '无上次数据' }
  }

  function formatRatio(current, previous) {
    const now = Number(current)
    const prev = Number(previous)
    if (!Number.isFinite(prev)) return '无上次数据'
    if (prev === 0) return now === 0 ? '0.00%' : '上次为0，无法计算'
    return `${(((now / prev) - 1) * 100).toFixed(2)}%`
  }

  function getPageSize(rawParams = params) {
    return Math.max(20, Math.min(500, Number(rawParams.page_size || DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE))
  }

  function getMaxPages(rawParams = params) {
    return Math.max(1, Math.min(1000, Number(rawParams.max_pages || DEFAULT_MAX_PAGES) || DEFAULT_MAX_PAGES))
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  function buildMerchandiseQueryPayload(pageNo, pageSize, rawParams = params) {
    const param = {}
    const goodsCodes = parseList(rawParams.goods_codes || rawParams.msn_set)
    const styleCodes = parseList(rawParams.style_codes || rawParams.osn_set)
    if (goodsCodes.length) param.msnSet = goodsCodes
    if (styleCodes.length) param.osn = styleCodes
    return { pageNo, pageSize, param }
  }

  async function postJson(url, payload) {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify(payload),
    })
    const text = await response.text()
    let json
    try {
      json = JSON.parse(text)
    } catch (error) {
      throw new Error(`${url} 返回非 JSON：${text.slice(0, 160)}`)
    }
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}：${compact(json.message || json.msg || text.slice(0, 160))}`)
    if (json.code && String(json.code) !== '200') throw new Error(`${url} 返回 code=${json.code}：${compact(json.message || json.msg || '接口失败')}`)
    return json
  }

  async function collectMerchandiseRows(rawParams = params) {
    const pageSize = getPageSize(rawParams)
    const maxPages = getMaxPages(rawParams)
    const rows = []
    let total = null
    let pages = 0
    for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
      const json = await postJson(MERCHANDISE_QUERY_URL, buildMerchandiseQueryPayload(pageNo, pageSize, rawParams))
      const pageRows = Array.isArray(json?.data) ? json.data : []
      const reportedTotal = Number(json?.total || 0)
      if (Number.isFinite(reportedTotal) && reportedTotal > 0 && total == null) total = reportedTotal
      pages = pageNo
      rows.push(...pageRows)
      if (!pageRows.length) break
      if (total && rows.length >= total) break
      if (pageRows.length < pageSize) break
      await sleep(DEFAULT_DELAY_MS)
    }
    return { rows, total: total || rows.length, pages }
  }

  function normalizeDetailRow(row) {
    const rawStatus = row.skuStatus ?? row.status ?? row.商品状态
    const status = normalizeVipshopStatus(rawStatus)
    const category = statusCategory(status, row)
    return {
      __sheet_name: DETAIL_SHEET,
      商品ID: compact(row.merchandiseNo || row.商品ID),
      款号: normalizeCode(row.osn || row.styleCode || row.款号),
      货号: normalizeCode(row.msn || row.goodsNo || row.货号),
      商品名称: compact(row.name || row.goodsName || row.商品名称),
      品牌编码: compact(row.brandStoreSn || row.品牌编码),
      品牌名称: compact(row.brandName || row.brandStoreName || row.品牌名称),
      商品状态: status,
      状态分类: category === 'online' ? '上线' : category === 'offline' ? '下线' : '其他',
      市场价: compact(row.marketPrice || row.市场价),
      唯品价: compact(row.vipshopPrice || row.唯品价),
      在售库存: compact(row.merLeavingNum ?? row.bindMerLeavingNum ?? row.在售库存),
      图片链接: compact(row.imageUrl || row.图片链接),
      数据来源接口: '/normal/normalMerchandiseQuery',
      执行结果: '已统计',
      备注: '',
    }
  }

  function buildSummaryRows(counts, previous, meta = {}) {
    const onlineRatio = formatRatio(counts.online, previous.online)
    const offlineRatio = formatRatio(counts.offline, previous.offline)
    const body = [
      '### MOP 唯品商品在线情况统计',
      `- 本次商品总数：${counts.total}`,
      `- 本次商品上线数量：${counts.online}`,
      `- 本次商品下线数量：${counts.offline}`,
      `- 上线数量环比：${onlineRatio}`,
      `- 下线数量环比：${offlineRatio}`,
      `- 上次数据来源：${previous.source}`,
      meta.pages ? `- 接口分页：${meta.pages} 页` : '',
    ].filter(Boolean).join('\n')
    return [{
      __sheet_name: SUMMARY_SHEET,
      统计口径: '唯品商品在线情况',
      本次商品总数: counts.total,
      本次商品上线数量: counts.online,
      本次商品下线数量: counts.offline,
      本次其他状态数量: counts.other,
      上次商品上线数量: previous.online,
      上次商品下线数量: previous.offline,
      上线数量环比: onlineRatio,
      下线数量环比: offlineRatio,
      上次数据来源: previous.source,
      数据来源接口: '/normal/normalMerchandiseQuery',
      执行结果: '完成',
      备注: meta.note || '',
      __notify_title: 'MOP 唯品商品在线情况统计',
      __notify_body: body,
    }]
  }

  function buildResultRows(detailRows, summaryRows) {
    return [
      ...(Array.isArray(detailRows) ? detailRows : []),
      ...(Array.isArray(summaryRows) ? summaryRows : []),
    ]
  }

  function isNovPage() {
    return /^https:\/\/nov-admin\.vip\.com\//i.test(String(location.href || ''))
  }

  function navigateTo(url, nextPhaseName, sleepMs = 1800, nextShared = shared) {
    if (String(location.href || '') !== String(url || '')) location.href = url
    return {
      success: true,
      data: [],
      meta: {
        action: 'next_phase',
        next_phase: nextPhaseName,
        sleep_ms: sleepMs,
        shared: nextShared,
      },
    }
  }

  function complete(data = [], nextShared = shared) {
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

  function exposeHelpers() {
    if (!testExports || typeof testExports !== 'object') return
    Object.assign(testExports, {
      buildMerchandiseQueryPayload,
      statusCategory,
      countStatus,
      parsePreviousCounts,
      formatRatio,
      normalizeDetailRow,
      buildSummaryRows,
      buildResultRows,
    })
  }

  exposeHelpers()
  if (phase === '__exports__') return complete([], shared)

  try {
    if (!isNovPage()) return navigateTo(VIPSHOP_ENTRY_URL, 'main')
    const result = await collectMerchandiseRows(params)
    const detailRows = result.rows.map(normalizeDetailRow)
    const counts = countStatus(detailRows)
    const previous = parsePreviousCounts(params)
    const summaryRows = buildSummaryRows(counts, previous, { pages: result.pages })
    return complete(buildResultRows(detailRows, summaryRows), {
      ...shared,
      total_rows: counts.total,
      online_count: counts.online,
      offline_count: counts.offline,
      other_status_count: counts.other,
      current_store: '唯品商品在线情况统计',
    })
  } catch (error) {
    return { success: false, error: error.message || String(error) }
  }
})()
