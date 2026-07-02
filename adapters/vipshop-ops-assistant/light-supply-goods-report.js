;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const INFO_SHEET = '商品信息-轻供'
  const DETAIL_SHEET = '商品明细-轻供'
  const SUMMARY_SHEET = '执行摘要'
  const MERCHANDISE_INFO_URL = 'https://nov-admin.vip.com/normal/normalMerchandiseQuery'
  const GOODS_DETAIL_URL = '/product/detail/getGoodsList'
  const DEFAULT_PAGE_SIZE = 500
  const DEFAULT_MAX_PAGES = 200
  const DEFAULT_DELAY_MS = 80

  function compact(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim()
  }

  function normalizeStyleCode(value) {
    return compact(value).replace(/[\s"'`]+/g, '').toUpperCase()
  }

  function normalizeHeader(value) {
    return normalizeStyleCode(value).replace(/[：:（）()\-_./\\]/g, '')
  }

  function rowValue(row, aliases) {
    const wanted = new Set((aliases || []).map(normalizeHeader))
    for (const [key, value] of Object.entries(row || {})) {
      if (wanted.has(normalizeHeader(key)) && compact(value)) return compact(value)
    }
    return ''
  }

  function normalizeDateValue(value) {
    const text = compact(value)
    if (!text) return ''
    const match = text.match(/(20\d{2})[-/.年]?\s*(\d{1,2})[-/.月]?\s*(\d{1,2})/)
    if (!match) return ''
    const [, year, month, day] = match
    return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`
  }

  function formatDate(value) {
    const ymd = normalizeDateValue(value)
    if (!ymd || ymd.length !== 8) return compact(value)
    return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
  }

  function collectFileRows(file) {
    const rows = []
    const seen = new Set()
    const pushRows = (items) => {
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

  function buildMatchLookup(file, targetCategory = '轻供') {
    const allRows = collectFileRows(file)
    const categoryByStyle = new Map()
    let targetRows = 0
    let invalidRows = 0
    const target = compact(targetCategory || '轻供')

    for (const row of allRows) {
      const styleCode = normalizeStyleCode(rowValue(row, ['大货款号', '款号', '货号', 'styleCode', 'style_code', 'osn']))
      const category = compact(rowValue(row, ['类别', '区分', '分类', 'category']))
      if (!styleCode || !category) {
        invalidRows += 1
        continue
      }
      categoryByStyle.set(styleCode, category)
      if (category === target) targetRows += 1
    }

    return {
      categoryByStyle,
      target,
      totalRows: allRows.length,
      targetRows,
      invalidRows,
    }
  }

  function deriveStyleFromSku(value) {
    const sku = normalizeStyleCode(value)
    if (!sku) return ''
    if (/^[A-Z0-9]{8,}\d{3}$/.test(sku)) return sku.slice(0, -3)
    return sku
  }

  function inferStyleCode(row) {
    const direct = [
      row?.osn,
      row?.styleCode,
      row?.style_code,
      row?.styleNo,
      row?.大货款号,
      row?.款号,
    ]
    for (const value of direct) {
      const normalized = normalizeStyleCode(value)
      if (normalized) return normalized
    }
    for (const value of [row?.msn, row?.goodsNo, row?.货号]) {
      const derived = deriveStyleFromSku(value)
      if (derived) return derived
    }
    return ''
  }

  function joinList(value) {
    if (Array.isArray(value)) return value.map(compact).filter(Boolean).join('、')
    if (value && typeof value === 'object') {
      return Object.entries(value)
        .filter(([, enabled]) => Boolean(enabled))
        .map(([key]) => key)
        .join('、')
    }
    return compact(value)
  }

  function formatSellChannel(value) {
    const text = compact(value)
    if (text === '1000') return '特卖会主站'
    if (text === '1') return '特卖会主站'
    return text
  }

  function normalizeStatus(value) {
    const text = compact(value)
    if (text === '0') return '可售'
    if (text === '1') return '在售'
    return text
  }

  function hasScope(scope, key) {
    if (!scope || (Array.isArray(scope) && scope.length === 0)) return true
    if (Array.isArray(scope)) return scope.includes(key)
    return String(scope).split(/[,，、\s]+/).includes(key)
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
    if (!response.ok) {
      throw new Error(`${url} HTTP ${response.status}：${compact(json.message || text.slice(0, 160))}`)
    }
    if (json.code && String(json.code) !== '200') {
      throw new Error(`${url} 返回 code=${json.code}：${compact(json.message || json.msg || '接口失败')}`)
    }
    return json
  }

  function extractCompassDateRange(rawParams = params) {
    const explicitStart = normalizeDateValue(rawParams.start_date || rawParams.date_start || rawParams.startDt)
    const explicitEnd = normalizeDateValue(rawParams.end_date || rawParams.date_end || rawParams.endDt)
    if (explicitStart) {
      return { startDt: explicitStart, endDt: explicitEnd || explicitStart, source: '参数' }
    }

    const bodyText = compact(document?.body?.innerText || '')
    const statMatch = bodyText.match(/统计日期[\s\S]{0,120}?(20\d{2}[-/.年]\s*\d{1,2}[-/.月]\s*\d{1,2})/)
    const pageDate = normalizeDateValue(statMatch?.[1] || '')
    if (pageDate) return { startDt: pageDate, endDt: pageDate, source: '页面统计日期' }

    const firstDate = normalizeDateValue(bodyText)
    if (firstDate) return { startDt: firstDate, endDt: firstDate, source: '页面首个日期' }
    throw new Error('未能从当前罗盘页读取统计日期，请填写商品明细开始日期')
  }

  function buildMerchandiseInfoPayload(pageNo, pageSize) {
    return {
      pageNo,
      pageSize,
      param: {},
    }
  }

  function buildGoodsDetailPayload(pageNo, pageSize, dateRange) {
    return {
      brandStoreSn: compact(params.brand_store_sn || 'all') || 'all',
      dtType: 0,
      calType: 1,
      startDt: dateRange.startDt,
      endDt: dateRange.endDt,
      queryHll: false,
      pageNo,
      pageSize,
      dimType: 0,
      channelType: 1,
    }
  }

  async function collectPagedRows(options) {
    const pageSize = getPageSize()
    const maxPages = getMaxPages()
    const rows = []
    let total = null
    let pages = 0
    for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
      const json = await postJson(options.url, options.buildPayload(pageNo, pageSize))
      const pageRows = options.extractRows(json)
      const reportedTotal = Number(options.extractTotal(json))
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

  function sourceCategoryForRow(row, lookup) {
    const styleCode = inferStyleCode(row)
    const category = lookup.categoryByStyle.get(styleCode) || ''
    return { styleCode, category }
  }

  function shouldKeepRow(row, lookup) {
    const { category } = sourceCategoryForRow(row, lookup)
    return category === lookup.target
  }

  function normalizeMerchandiseInfoRow(row, lookup) {
    const { styleCode, category } = sourceCategoryForRow(row, lookup)
    return {
      __sheet_name: INFO_SHEET,
      报表来源: '商品信息',
      区分: category,
      款号: styleCode,
      货号: compact(row.msn),
      商品ID: compact(row.merchandiseNo),
      商品名称: compact(row.name),
      品牌编码: compact(row.brandStoreSn),
      品牌名称: compact(row.brandName),
      一级品类: compact(row.newCategory1stName),
      二级品类: compact(row.newCategory2ndName),
      三级品类: compact(row.newCategory3rdName),
      售卖渠道: formatSellChannel(row.sellChannel),
      统计日期: '',
      市场价: compact(row.marketPrice),
      唯品价: compact(row.vipshopPrice),
      到手价: compact(row.strikePrice ?? row.promoPrice),
      销售额: compact(row.nearly30DaysSellMoney),
      销售数量: compact(row.nearly30DaysAvgSale),
      客户数: compact(row.customerNumberCount),
      商详UV: compact(row.nearly30DaysUv ?? row.uvCount),
      在售库存: compact(row.merLeavingNum ?? row.bindMerLeavingNum),
      库存天数: compact(row.canSellStockDay),
      售龄: compact(row.productSellAge),
      商品状态: normalizeStatus(row.skuStatus),
      商品标签: joinList(row.merTagMap) || joinList(row.visTagMap),
      图片链接: compact(row.imageUrl),
      数据来源接口: '/normal/normalMerchandiseQuery',
      执行结果: '已匹配轻供',
      备注: '',
    }
  }

  function normalizeGoodsDetailRow(row, lookup) {
    const { styleCode, category } = sourceCategoryForRow(row, lookup)
    return {
      __sheet_name: DETAIL_SHEET,
      报表来源: '商品明细',
      区分: category,
      款号: styleCode,
      货号: compact(row.goodsNo),
      商品ID: compact(row.merchandiseNo),
      商品名称: compact(row.goodsName),
      品牌编码: compact(row.brandStoreSn),
      品牌名称: compact(row.brandStoreName),
      一级品类: compact(row.firstCateName),
      二级品类: compact(row.secCateName),
      三级品类: compact(row.thirdCateName),
      售卖渠道: formatSellChannel(row.channelType || row.channelName),
      统计日期: formatDate(row.dt),
      市场价: compact(row.minMarketPrice),
      唯品价: compact(row.minVipshopPrice),
      到手价: compact(row.minPayPrice),
      销售额: compact(row.goodsActureAmt),
      销售数量: compact(row.goodsActureNum),
      客户数: compact(row.userNum),
      商详UV: compact(row.uv),
      在售库存: compact(row.onSellLeavingNum ?? row.leavingNum),
      库存天数: '',
      售龄: compact(row.productSellAge),
      商品状态: normalizeStatus(row.status),
      商品标签: joinList(row.merTypeList),
      图片链接: compact(row.imgUrl),
      数据来源接口: '/product/detail/getGoodsList',
      执行结果: '已匹配轻供',
      备注: '',
    }
  }

  function summaryRow(message, status = '完成') {
    return {
      __sheet_name: SUMMARY_SHEET,
      报表来源: '执行摘要',
      执行结果: status,
      备注: message,
    }
  }

  function isCompassPage() {
    return /^https:\/\/compass\.vip\.com\//i.test(String(location.href || ''))
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
    if (!testExports) return
    Object.assign(testExports, {
      compact,
      normalizeStyleCode,
      rowValue,
      buildMatchLookup,
      deriveStyleFromSku,
      inferStyleCode,
      extractCompassDateRange,
      buildMerchandiseInfoPayload,
      buildGoodsDetailPayload,
      normalizeMerchandiseInfoRow,
      normalizeGoodsDetailRow,
      shouldKeepRow,
      hasScope,
    })
  }

  exposeHelpers()
  if (phase === '__exports__') return complete([], shared)

  try {
    const scope = params.report_scope || ['merchandise_info', 'goods_detail']
    const wantsInfo = hasScope(scope, 'merchandise_info')
    const wantsDetail = hasScope(scope, 'goods_detail')
    if (wantsDetail && !isCompassPage()) {
      return complete([summaryRow('商品明细接口只能从罗盘商品明细页调用；请打开「魔方罗盘 - 商品明细」后运行。', '未在支持页面')], shared)
    }

    const lookup = buildMatchLookup(params.input_file || params.match_file, params.target_category || '轻供')
    if (!lookup.totalRows) {
      return { success: false, error: '货品匹配表为空，请上传包含「大货款号」「类别」两列的 Excel。' }
    }
    if (!lookup.targetRows) {
      return { success: false, error: `货品匹配表中没有找到类别为「${lookup.target}」的款号。` }
    }

    const outputRows = []
    const scanStats = {
      match_total_rows: lookup.totalRows,
      match_target_rows: lookup.targetRows,
      match_invalid_rows: lookup.invalidRows,
      merchandise_info_scanned: 0,
      merchandise_info_matched: 0,
      goods_detail_scanned: 0,
      goods_detail_matched: 0,
    }

    if (wantsInfo) {
      try {
        const result = await collectPagedRows({
          url: MERCHANDISE_INFO_URL,
          buildPayload: buildMerchandiseInfoPayload,
          extractRows: json => Array.isArray(json?.data) ? json.data : [],
          extractTotal: json => json?.total,
        })
        scanStats.merchandise_info_scanned = result.rows.length
        const matchedRows = result.rows.filter(row => shouldKeepRow(row, lookup)).map(row => normalizeMerchandiseInfoRow(row, lookup))
        scanStats.merchandise_info_matched = matchedRows.length
        outputRows.push(...matchedRows)
      } catch (error) {
        outputRows.push(summaryRow(`商品信息读取失败：${error.message || error}`, '部分失败'))
      }
    }

    if (wantsDetail) {
      try {
        const dateRange = extractCompassDateRange(params)
        const result = await collectPagedRows({
          url: GOODS_DETAIL_URL,
          buildPayload: (pageNo, pageSize) => buildGoodsDetailPayload(pageNo, pageSize, dateRange),
          extractRows: json => Array.isArray(json?.data?.goodsList) ? json.data.goodsList : [],
          extractTotal: json => json?.data?.total,
        })
        scanStats.goods_detail_scanned = result.rows.length
        scanStats.goods_detail_date_range = `${dateRange.startDt}-${dateRange.endDt}`
        scanStats.goods_detail_date_source = dateRange.source
        const matchedRows = result.rows.filter(row => shouldKeepRow(row, lookup)).map(row => normalizeGoodsDetailRow(row, lookup))
        scanStats.goods_detail_matched = matchedRows.length
        outputRows.push(...matchedRows)
      } catch (error) {
        outputRows.push(summaryRow(`商品明细读取失败：${error.message || error}`, '部分失败'))
      }
    }

    const summary = [
      `匹配表 ${scanStats.match_total_rows} 行，其中「${lookup.target}」${scanStats.match_target_rows} 行`,
      wantsInfo ? `商品信息扫描 ${scanStats.merchandise_info_scanned} 行，命中 ${scanStats.merchandise_info_matched} 行` : '',
      wantsDetail ? `商品明细扫描 ${scanStats.goods_detail_scanned} 行，命中 ${scanStats.goods_detail_matched} 行` : '',
      scanStats.goods_detail_date_range ? `商品明细日期 ${scanStats.goods_detail_date_range}（${scanStats.goods_detail_date_source}）` : '',
    ].filter(Boolean).join('；')

    if (!outputRows.some(row => row.区分 === lookup.target)) {
      outputRows.unshift(summaryRow(`${summary}；未匹配到可导出的轻供报表行`, '未匹配到轻供'))
    } else {
      outputRows.unshift(summaryRow(summary, outputRows.some(row => row.执行结果 === '部分失败') ? '部分完成' : '完成'))
    }

    return complete(outputRows, {
      ...shared,
      ...scanStats,
      target_category: lookup.target,
    })
  } catch (error) {
    return { success: false, error: error.message || String(error) }
  }
})()
