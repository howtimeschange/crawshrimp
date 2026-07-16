;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const SUMMARY_SHEET = '汇总'
  const TOOL_SHEET = '工具汇总'
  const DETAIL_SHEET = '明细'
  const SHOP_SHEET = '店铺解析'
  const LOG_SHEET = '采集日志'
  const GATEWAY_ORIGIN = 'https://dmp.advgateway.taobao.com'
  const DEFAULT_BATCH_SIZE = 3

  const SELF_SHOP_NAME = '巴拉巴拉官方旗舰'
  const DEFAULT_MONITOR_SHOPS = [
    { shopName: SELF_SHOP_NAME, position: '本品', isSelf: true },
    { shopName: 'davebella旗舰店', position: '常规竞争', aliases: ['戴维贝拉旗舰店'] },
    { shopName: '左西旗舰店', position: '常规竞争' },
    { shopName: 'moodytiger旗舰店', position: '常规竞争' },
    { shopName: 'anta安踏童装旗舰店', position: '销售头部', aliases: ['安踏童装旗舰店'] },
    { shopName: 'FILA童装旗舰店', position: '销售头部', aliases: ['fila童装旗舰店'] },
    { shopName: '泰兰尼斯童鞋旗舰店', position: '销售头部' },
    { shopName: '贝肽斯官方旗舰店', position: '同比高增' },
    { shopName: '班喜迪旗舰店', position: '同比高增' },
    { shopName: '子瑞巴巴旗舰店', position: '同比高增' },
  ]

  const CONTROL_METRICS = [
    { code: 'click', name: '点击量控比', valueType: 'rate' },
    { code: 'cartCnt', name: '加购量控比', valueType: 'rate' },
    { code: 'alipayCnt', name: '成交笔数控比', valueType: 'rate' },
  ]
  const BASE_SHOP_METRICS = [
    { code: 'click', name: '整体IPV', group: '流量转化', valueType: 'num' },
    { code: 'cartRate', name: '整体加购率', group: '流量转化', valueType: 'rate' },
    { code: 'alipayConversion', name: '整体成交转化率', group: '流量转化', valueType: 'rate' },
    { code: 'alipayCnt', name: '整体成交笔数', group: '成交表现', valueType: 'num' },
    { code: 'averageOrderValue', name: '整体笔单价', group: '成交表现', valueType: 'currency' },
    { code: 'buyCrowdGmvRate', name: '新客成交占比', group: '成交表现', valueType: 'rate' },
  ]
  const BASE_AD_METRICS = [
    { code: 'click', name: '付费点击量', group: '推广表现', valueType: 'num' },
    { code: 'clickCost', name: '单次点击成本', group: '推广表现', valueType: 'currency' },
    { code: 'roi1d', name: '当天引导ROI', group: '推广表现', valueType: 'float' },
    { code: 'alipayCnt1d', name: '当天引导成交笔数', group: '推广表现', valueType: 'num' },
  ]
  const FLOW_METRICS = [
    { code: 'click', name: '点击量', valueType: 'num' },
    { code: 'alipayCnt1d', name: '当天引导成交笔数', valueType: 'num' },
    { code: 'cartRate1d', name: '当天引导加购率', valueType: 'rate' },
    { code: 'alipayConversion1d', name: '当天引导成交转化率', valueType: 'rate' },
    { code: 'clickRate', name: '广告点击率', valueType: 'rate' },
    { code: 'roi1d', name: '广告当天引导ROI', valueType: 'float' },
  ]
  const CROWD_METRICS = [
    { code: 'alipayCnt', name: '成交笔数', valueType: 'num' },
    { code: 'click', name: '点击量', valueType: 'num' },
    { code: 'alipayConversion', name: '成交转化率', valueType: 'rate' },
  ]
  const CROWD_TYPES = {
    1: '购买新客',
    2: '购买老客',
  }

  function compact(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim()
  }

  function normalizeShopName(value) {
    return compact(value)
      .toLowerCase()
      .replace(/[（）()【】\[\]\s_./\\\-：:·]/g, '')
      .replace(/官方/g, '')
  }

  function normalizeDate(value) {
    const text = compact(value)
    const match = text.match(/^(\d{4})[-/.]?(\d{1,2})[-/.]?(\d{1,2})$/)
    if (!match) return ''
    return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`
  }

  function formatDate(date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  function addDays(date, days) {
    const next = new Date(date.getTime())
    next.setDate(next.getDate() + days)
    return next
  }

  function startOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
  }

  function mondayOfWeek(date) {
    const start = startOfLocalDay(date)
    const offset = (start.getDay() + 6) % 7
    return addDays(start, -offset)
  }

  function readPageText() {
    if (typeof document === 'undefined' || !document?.body) return ''
    return compact(document.body.innerText || document.body.textContent || '')
  }

  function resolveRelativeDateToken(value, referenceDate = new Date()) {
    const token = compact(value)
    if (token === '今日' || token === '今天') return formatDate(referenceDate)
    if (token === '昨日' || token === '昨天') return formatDate(addDays(referenceDate, -1))
    if (token === '前日' || token === '前天') return formatDate(addDays(referenceDate, -2))
    return normalizeDate(token)
  }

  function dateTokensFromText(text) {
    return (compact(text).match(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|今日|今天|昨日|昨天|前日|前天/g) || [])
  }

  function extractPageDateRanges(pageText = readPageText(), referenceDate = new Date()) {
    const text = compact(pageText)
    const analysisIndex = text.indexOf('分析周期')
    const compareIndex = text.indexOf('对比周期')
    if (analysisIndex < 0 || compareIndex < 0 || compareIndex <= analysisIndex) return null
    const analysisTokens = dateTokensFromText(text.slice(analysisIndex, compareIndex))
    const compareTokens = dateTokensFromText(text.slice(compareIndex, compareIndex + 120))
    const beginDate = resolveRelativeDateToken(analysisTokens[0], referenceDate)
    const endDate = resolveRelativeDateToken(analysisTokens[1], referenceDate)
    const peerBeginDate = resolveRelativeDateToken(compareTokens[0], referenceDate)
    const peerEndDate = resolveRelativeDateToken(compareTokens[1], referenceDate)
    if (!beginDate || !endDate || !peerBeginDate || !peerEndDate) return null
    return {
      beginDate,
      endDate,
      peerBeginDate,
      peerEndDate,
      mode: 'page_current',
      weekLabel: `${beginDate}~${peerEndDate}`,
    }
  }

  function mergeExplicitDates(baseRanges, explicit, mode) {
    const ranges = {
      beginDate: explicit.beginDate || baseRanges.beginDate,
      endDate: explicit.endDate || baseRanges.endDate,
      peerBeginDate: explicit.peerBeginDate || baseRanges.peerBeginDate,
      peerEndDate: explicit.peerEndDate || baseRanges.peerEndDate,
    }
    if (!ranges.beginDate || !ranges.endDate || !ranges.peerBeginDate || !ranges.peerEndDate) return null
    return {
      ...ranges,
      mode,
      weekLabel: `${ranges.beginDate}~${ranges.peerEndDate}`,
    }
  }

  function resolveWeekDateRanges(mode, referenceDate = new Date()) {
    const monday = mode === 'current_week'
      ? mondayOfWeek(referenceDate)
      : addDays(mondayOfWeek(referenceDate), -7)
    const beginDate = formatDate(monday)
    const endDate = formatDate(addDays(monday, 2))
    const peerBeginDate = formatDate(addDays(monday, 3))
    const peerEndDate = formatDate(addDays(monday, 6))
    return {
      beginDate,
      endDate,
      peerBeginDate,
      peerEndDate,
      mode,
      weekLabel: `${beginDate}~${peerEndDate}`,
    }
  }

  function resolveDateRanges(rawParams = params, referenceDate = new Date(), pageText = readPageText()) {
    const explicit = {
      beginDate: normalizeDate(rawParams.analysis_start_date || rawParams.beginDate),
      endDate: normalizeDate(rawParams.analysis_end_date || rawParams.endDate),
      peerBeginDate: normalizeDate(rawParams.compare_start_date || rawParams.peerBeginDate),
      peerEndDate: normalizeDate(rawParams.compare_end_date || rawParams.peerEndDate),
    }
    if (explicit.beginDate && explicit.endDate && explicit.peerBeginDate && explicit.peerEndDate) {
      return {
        ...explicit,
        mode: 'custom',
        weekLabel: `${explicit.beginDate}~${explicit.peerEndDate}`,
      }
    }

    const mode = compact(rawParams.stat_week_mode || rawParams.week_mode || 'page_current')
    if (mode === 'current_week' || mode === 'last_completed_week') {
      return mergeExplicitDates(resolveWeekDateRanges(mode, referenceDate), explicit, mode)
    }
    const pageRanges = extractPageDateRanges(pageText, referenceDate)
    if (pageRanges) {
      const hasAnyExplicit = Object.values(explicit).some(Boolean)
      return mergeExplicitDates(pageRanges, explicit, hasAnyExplicit ? 'page_current_with_overrides' : 'page_current')
    }
    return mergeExplicitDates(resolveWeekDateRanges('last_completed_week', referenceDate), explicit, 'fallback_last_completed_week')
  }

  function parseMonitorShopRows(value) {
    if (!compact(value)) return DEFAULT_MONITOR_SHOPS.map(item => ({ ...item }))
    const rows = []
    for (const line of String(value).split(/\r?\n/)) {
      const raw = String(line || '').trim()
      const text = compact(raw)
      if (!text || /店铺名称/.test(text) || /监控名单/.test(text)) continue
      const parts = raw.split(/\t|,|，|;|；|\s+/).map(compact).filter(Boolean)
      const shopName = parts[0]
      if (!shopName) continue
      const defaultShop = findDefaultMonitorShop(shopName)
      const position = parts[1] || defaultShop?.position || ''
      const row = {
        shopName,
        position,
        isSelf: normalizeShopName(shopName) === normalizeShopName(SELF_SHOP_NAME) || position === '本品',
      }
      if (defaultShop?.aliases?.length) row.aliases = [...defaultShop.aliases]
      rows.push(row)
    }
    return rows.length ? rows : DEFAULT_MONITOR_SHOPS.map(item => ({ ...item }))
  }

  function findDefaultMonitorShop(shopName) {
    const wanted = normalizeShopName(shopName)
    if (!wanted) return null
    return DEFAULT_MONITOR_SHOPS.find(item => {
      return normalizeShopName(item.shopName) === wanted
        || (Array.isArray(item.aliases) && item.aliases.some(alias => normalizeShopName(alias) === wanted))
    }) || null
  }

  function chunkArray(items, size = DEFAULT_BATCH_SIZE) {
    const rows = Array.isArray(items) ? items : []
    const chunkSize = Math.max(1, Math.min(DEFAULT_BATCH_SIZE, Number(size || DEFAULT_BATCH_SIZE) || DEFAULT_BATCH_SIZE))
    const chunks = []
    for (let index = 0; index < rows.length; index += chunkSize) {
      chunks.push(rows.slice(index, index + chunkSize))
    }
    return chunks
  }

  function getUnitMultiplier(unit) {
    if (unit === '亿') return 100000000
    if (unit === '万') return 10000
    return 1
  }

  function parseMetricNumber(value, options = {}) {
    if (value === null || value === undefined || value === '') return null
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    const percentAsRatio = options.percentAsRatio !== false
    const text = compact(value).replace(/,/g, '')
    if (!text || text === '-' || text === '--' || text === '暂无数据') return null
    const range = text.match(/([+-]?\d+(?:\.\d+)?)\s*(%|％|万|亿)?\s*(?:-|~|—|–|至|到)\s*([+-]?\d+(?:\.\d+)?)\s*(%|％|万|亿)?/)
    if (range) {
      const unit = range[4] || range[2] || ''
      let number = ((Number(range[1]) + Number(range[3])) / 2) * getUnitMultiplier(unit)
      if ((unit === '%' || unit === '％') && percentAsRatio) number /= 100
      return Number.isFinite(number) ? number : null
    }
    const single = text.match(/([+-]?\d+(?:\.\d+)?)\s*(%|％|万|亿)?/)
    if (!single) return null
    const unit = single[2] || ''
    let number = Number(single[1]) * getUnitMultiplier(unit)
    if ((unit === '%' || unit === '％') && percentAsRatio) number /= 100
    return Number.isFinite(number) ? number : null
  }

  function safeDivide(numerator, denominator) {
    if (numerator === null || numerator === undefined || numerator === '') return null
    if (denominator === null || denominator === undefined || denominator === '') return null
    const top = Number(numerator)
    const bottom = Number(denominator)
    if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom === 0) return null
    return top / bottom
  }

  function roundMetric(value, digits = 4) {
    if (value === null || value === undefined || value === '') return ''
    const number = Number(value)
    if (!Number.isFinite(number)) return ''
    const factor = 10 ** digits
    return Math.round(number * factor) / factor
  }

  function describeError(error, fallback = '未知错误') {
    if (!error) return fallback
    if (typeof error === 'string') return error
    return error.message || error.msg || error.errorMsg || fallback
  }

  function extractArray(payload, paths = []) {
    if (Array.isArray(payload)) return payload
    for (const path of paths) {
      const value = path.split('.').reduce((target, part) => target?.[part], payload)
      if (Array.isArray(value)) return value
    }
    return []
  }

  function gatewayQueryParams(extra = {}) {
    const entries = typeof performance !== 'undefined' && performance.getEntriesByType
      ? performance.getEntriesByType('resource')
      : []
    const resource = Array.from(entries)
      .reverse()
      .map(item => item?.name || '')
      .find(url => /^https:\/\/dmp\.advgateway\.taobao\.com\/api\//.test(url))
    const query = new URLSearchParams()
    if (resource) {
      const parsed = new URL(resource)
      for (const key of ['bizCode', '_tb_token_', '_csrf', 'csrfId']) {
        const val = parsed.searchParams.get(key)
        if (val) query.set(key, val)
      }
    }
    if (!query.has('bizCode')) query.set('bizCode', 'dmp')
    for (const [key, val] of Object.entries(extra || {})) {
      if (val !== undefined && val !== null && val !== '') query.set(key, String(val))
    }
    return query
  }

  function buildGatewayUrl(path, query = {}) {
    const url = new URL(path, GATEWAY_ORIGIN)
    url.search = gatewayQueryParams(query).toString()
    return url.toString()
  }

  async function callGateway(path, payload = {}, options = {}) {
    const method = options.method || 'POST'
    const url = buildGatewayUrl(path, options.query)
    const response = await fetch(url, {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify(payload || {}) } : {}),
    })
    const text = await response.text()
    let data = {}
    try {
      data = text ? JSON.parse(text) : {}
    } catch (error) {
      throw new Error(`${path} 返回非 JSON：${text.slice(0, 120)}`)
    }
    if (!response.ok) throw new Error(`${path} HTTP ${response.status}`)
    if (data?.info && data.info.ok === false) {
      throw new Error(data.info.message || `${path} 返回失败`)
    }
    return data
  }

  function shopAliases(shop) {
    return [shop.shopName, ...(Array.isArray(shop.aliases) ? shop.aliases : [])].filter(Boolean)
  }

  function findBestShopMatch(list, shop, options = {}) {
    const wanted = new Set(shopAliases(shop).map(normalizeShopName))
    const candidates = (Array.isArray(list) ? list : []).map(item => {
      const info = item?.competitorInfo || item || {}
      return {
        raw: item,
        shopName: compact(info.shop_name || info.shopName || item?.competitorName || item?.shopName),
        shopId: compact(info.shop_id || info.shopId || item?.shopId),
        token: compact(info.token || item?.token || item?.competitorId),
      }
    }).filter(item => item.shopName && item.token)

    let match = candidates.find(item => wanted.has(normalizeShopName(item.shopName)))
    if (match) return match
    match = candidates.find(item => {
      const normalized = normalizeShopName(item.shopName)
      return Array.from(wanted).some(name => normalized.includes(name) || name.includes(normalized))
    })
    return match || (options.allowFirstFallback ? candidates[0] : null) || null
  }

  async function fetchMonitorList() {
    const payload = await callGateway('/api/competition/monitor/list', {}, {
      method: 'GET',
      query: { competitionType: '1', pageSize: 100 },
    })
    return extractArray(payload, ['data.list', 'list'])
  }

  async function searchShop(shop) {
    for (const keyword of shopAliases(shop)) {
      const payload = await callGateway('/api/shop/benchmark/shoplist', {}, {
        method: 'GET',
        query: { keyword, type: 3 },
      })
      const match = findBestShopMatch(extractArray(payload, ['data.list', 'list']), shop, {
        allowFirstFallback: true,
      })
      if (match) return { ...match, source: '搜索接口', keyword }
    }
    return null
  }

  async function resolveMonitorShops(monitorShops) {
    let monitorList = []
    try {
      monitorList = await fetchMonitorList()
    } catch (error) {
      monitorList = []
    }

    const resolved = []
    for (const shop of monitorShops) {
      if (shop.isSelf) {
        resolved.push({
          ...shop,
          resolvedName: shop.shopName,
          source: '本店',
          status: '已解析',
        })
        continue
      }
      try {
        const monitorMatch = findBestShopMatch(monitorList, shop)
        const match = monitorMatch
          ? { ...monitorMatch, source: '已关注列表' }
          : await searchShop(shop)
        if (!match?.token) {
          resolved.push({
            ...shop,
            status: '未找到',
            source: '',
            note: '店铺搜索接口未返回可用 token',
          })
          continue
        }
        resolved.push({
          ...shop,
          token: match.token,
          shopId: match.shopId,
          resolvedName: match.shopName,
          source: match.source,
          status: '已解析',
          note: match.keyword ? `keyword=${match.keyword}` : '',
        })
      } catch (error) {
        resolved.push({
          ...shop,
          status: '解析失败',
          source: '',
          note: describeError(error),
        })
      }
    }
    return resolved
  }

  function makeShopRows(resolvedShops, dateRanges) {
    return resolvedShops.map(shop => ({
      __sheet_name: SHOP_SHEET,
      统计周: dateRanges.weekLabel,
      店铺名称: shop.shopName,
      店铺定位: shop.position || '',
      页面匹配名称: shop.resolvedName || '',
      店铺ID: shop.shopId || '',
      解析来源: shop.source || '',
      执行结果: shop.status || '',
      备注: shop.note || '',
    }))
  }

  function makeLogRow(dateRanges, stage, result, note = '') {
    return {
      __sheet_name: LOG_SHEET,
      统计周: dateRanges.weekLabel,
      阶段: stage,
      执行结果: result,
      备注: note,
    }
  }

  function buildAnalysisPayload(dateRanges, competitorIds = {}, extra = {}) {
    const ids = Array.isArray(competitorIds) ? competitorIds : []
    return {
      competitorIds: ids,
      beginDate: dateRanges.beginDate,
      endDate: dateRanges.endDate,
      peerBeginDate: dateRanges.peerBeginDate,
      peerEndDate: dateRanges.peerEndDate,
      competitionType: '1',
      ...extra,
    }
  }

  function indexMetric(target, shop, key, item) {
    const token = shop.token || shop.shopName
    if (!target[token]) target[token] = {}
    target[token][key] = {
      base: parseMetricNumber(item?.base),
      basePeriod: parseMetricNumber(item?.basePeriod),
      growthRate: parseMetricNumber(item?.growthRate),
    }
  }

  function resolveShopFromToken(token, context) {
    const normalized = compact(token)
    if (normalized && context.tokenToShop.has(normalized)) return context.tokenToShop.get(normalized)
    const self = context.selfShop
    if (normalized && !context.requestedTokens.has(normalized)) {
      self.token = self.token || normalized
      context.tokenToShop.set(normalized, self)
      return self
    }
    return {
      shopName: normalized ? `未知店铺(${normalized.slice(0, 8)})` : '未知店铺',
      position: '',
      token: normalized,
      status: '未知',
    }
  }

  function addDetailRow(context, row) {
    const key = [
      row.数据模块,
      row.表格名称,
      row.父级维度,
      row.维度名称,
      row.店铺名称,
      row.指标编码,
      row.数据来源,
    ].map(compact).join('|')
    if (context.seenDetailKeys.has(key)) return
    context.seenDetailKeys.add(key)
    context.detailRows.push(row)
  }

  function addMetricMapRows(context, response, options) {
    const data = response?.data || {}
    for (const metric of options.metrics) {
      const box = data?.[metric.code]
      const list = Array.isArray(box?.competitorList) ? box.competitorList : []
      for (const item of list) {
        const shop = resolveShopFromToken(item?.competitorId, context)
        const baseNumber = parseMetricNumber(item?.base)
        const basePeriodNumber = parseMetricNumber(item?.basePeriod)
        addDetailRow(context, {
          __sheet_name: DETAIL_SHEET,
          统计周: context.dateRanges.weekLabel,
          分析周期: `${context.dateRanges.beginDate} 至 ${context.dateRanges.endDate}`,
          对比周期: `${context.dateRanges.peerBeginDate} 至 ${context.dateRanges.peerEndDate}`,
          店铺名称: shop.shopName,
          店铺定位: shop.position || '',
          数据模块: options.module,
          表格名称: options.tableName,
          父级维度: options.parentDimension || metric.group || '',
          维度名称: options.dimensionName || '',
          指标编码: metric.code,
          指标名称: metric.name,
          指标类型: metric.valueType || '',
          本周期值: item?.base ?? '',
          对比周期值: item?.basePeriod ?? '',
          变化率: item?.growthRate ?? '',
          本周期数值: baseNumber ?? '',
          对比周期数值: basePeriodNumber ?? '',
          数据来源: options.source,
          执行结果: '已采集',
          备注: '',
        })
        if (options.metricPrefix) {
          indexMetric(context.metricIndex, shop, `${options.metricPrefix}.${metric.code}`, item)
        }
      }
    }
  }

  function addNestedChannelMetricRows(context, response, options) {
    const list = extractArray(response, ['data.list', 'list'])
    const walk = (rows, parentName = '') => {
      for (const channel of Array.isArray(rows) ? rows : []) {
        const channelName = compact(channel?.channelName || channel?.e_scene_first_level || channel?.channelId)
        for (const metric of options.metrics) {
          const metricBox = channel?.[metric.code]
          const competitors = Array.isArray(metricBox?.competitorList) ? metricBox.competitorList : []
          for (const item of competitors) {
            const shop = resolveShopFromToken(item?.competitorId, context)
            const baseNumber = parseMetricNumber(item?.base)
            addDetailRow(context, {
              __sheet_name: DETAIL_SHEET,
              统计周: context.dateRanges.weekLabel,
              分析周期: `${context.dateRanges.beginDate} 至 ${context.dateRanges.endDate}`,
              对比周期: `${context.dateRanges.peerBeginDate} 至 ${context.dateRanges.peerEndDate}`,
              店铺名称: shop.shopName,
              店铺定位: shop.position || '',
              数据模块: options.module,
              表格名称: options.tableName,
              父级维度: parentName,
              维度名称: channelName,
              指标编码: metric.code,
              指标名称: metric.name,
              指标类型: metric.valueType || '',
              本周期值: item?.base ?? '',
              对比周期值: item?.basePeriod ?? '',
              变化率: item?.growthRate ?? '',
              本周期数值: baseNumber ?? '',
              对比周期数值: parseMetricNumber(item?.basePeriod) ?? '',
              数据来源: options.source,
              执行结果: '已采集',
              备注: '',
            })
            if (metric.code === 'click' && channelName) {
              const token = shop.token || shop.shopName
              if (!context.channelClickIndex[token]) context.channelClickIndex[token] = {}
              context.channelClickIndex[token][channelName] = baseNumber
            }
          }
        }
        if (Array.isArray(channel?.subChannels) && channel.subChannels.length) {
          walk(channel.subChannels, channelName || parentName)
        }
      }
    }
    walk(list)
  }

  function addCrowdRows(context, response, crowdBuyType) {
    const data = response?.data || {}
    for (const metric of CROWD_METRICS) {
      const competitors = Array.isArray(data?.[metric.code]?.competitorList) ? data[metric.code].competitorList : []
      for (const item of competitors) {
        const shop = resolveShopFromToken(item?.competitorId, context)
        addDetailRow(context, {
          __sheet_name: DETAIL_SHEET,
          统计周: context.dateRanges.weekLabel,
          分析周期: `${context.dateRanges.beginDate} 至 ${context.dateRanges.endDate}`,
          对比周期: `${context.dateRanges.peerBeginDate} 至 ${context.dateRanges.peerEndDate}`,
          店铺名称: shop.shopName,
          店铺定位: shop.position || '',
          数据模块: '客群分析',
          表格名称: '新老客结构',
          父级维度: CROWD_TYPES[crowdBuyType] || `crowdBuyType=${crowdBuyType}`,
          维度名称: '',
          指标编码: metric.code,
          指标名称: metric.name,
          指标类型: metric.valueType || '',
          本周期值: item?.base ?? '',
          对比周期值: item?.basePeriod ?? '',
          变化率: item?.growthRate ?? '',
          本周期数值: parseMetricNumber(item?.base) ?? '',
          对比周期数值: parseMetricNumber(item?.basePeriod) ?? '',
          数据来源: '/api/competition/analysis/crowd/structural',
          执行结果: '已采集',
          备注: '',
        })
      }
    }
  }

  function addScalarStructureRows(context, response, options) {
    const shop = options.shop
    const token = shop.token || shop.shopName
    const rows = extractArray(response, ['data.list', 'list'])
    for (const item of rows) {
      const channelName = compact(item?.channelName || item?.e_scene_first_level || item?.channelId)
      const value = parseMetricNumber(item?.[options.metric.code])
      addDetailRow(context, {
        __sheet_name: DETAIL_SHEET,
        统计周: context.dateRanges.weekLabel,
        分析周期: `${context.dateRanges.beginDate} 至 ${context.dateRanges.endDate}`,
        对比周期: `${context.dateRanges.peerBeginDate} 至 ${context.dateRanges.peerEndDate}`,
        店铺名称: shop.shopName,
        店铺定位: shop.position || '',
        数据模块: '流量分析',
        表格名称: options.tableName,
        父级维度: '',
        维度名称: channelName,
        指标编码: options.metric.code,
        指标名称: options.metric.name,
        指标类型: options.metric.valueType,
        本周期值: item?.[options.metric.code] ?? '',
        对比周期值: '',
        变化率: '',
        本周期数值: value ?? '',
        对比周期数值: '',
        数据来源: options.source,
        执行结果: '已采集',
        备注: '',
      })
      if (options.metric.code === 'costRate' && channelName) {
        if (!context.toolCostRateIndex[token]) context.toolCostRateIndex[token] = {}
        context.toolCostRateIndex[token][channelName] = value
      }
    }
  }

  function metricValue(metricIndex, shop, key) {
    const token = shop.token || shop.shopName
    return metricIndex[token]?.[key]?.base ?? null
  }

  function buildSummaryRows(resolvedShops, metricIndex, dateRanges) {
    const rows = []
    for (const shop of resolvedShops) {
      if (shop.status && shop.status !== '已解析') {
        rows.push({
          __sheet_name: SUMMARY_SHEET,
          统计周: dateRanges.weekLabel,
          分析周期: `${dateRanges.beginDate} 至 ${dateRanges.endDate}`,
          对比周期: `${dateRanges.peerBeginDate} 至 ${dateRanges.peerEndDate}`,
          店铺名称: shop.shopName,
          店铺定位: shop.position || '',
          执行结果: shop.status,
          备注: shop.note || '',
        })
        continue
      }
      const paidClicks = metricValue(metricIndex, shop, 'baseAd.click')
      const ppc = metricValue(metricIndex, shop, 'baseAd.clickCost')
      const roi = metricValue(metricIndex, shop, 'baseAd.roi1d')
      const totalOrders = metricValue(metricIndex, shop, 'baseShop.alipayCnt')
      const averageOrderValue = metricValue(metricIndex, shop, 'baseShop.averageOrderValue')
      const spend = Number.isFinite(paidClicks) && Number.isFinite(ppc) ? paidClicks * ppc : null
      const estimatedGmv = Number.isFinite(totalOrders) && Number.isFinite(averageOrderValue)
        ? totalOrders * averageOrderValue
        : null
      const paidGmv = Number.isFinite(spend) && Number.isFinite(roi) ? spend * roi : null
      rows.push({
        __sheet_name: SUMMARY_SHEET,
        统计周: dateRanges.weekLabel,
        分析周期: `${dateRanges.beginDate} 至 ${dateRanges.endDate}`,
        对比周期: `${dateRanges.peerBeginDate} 至 ${dateRanges.peerEndDate}`,
        店铺名称: shop.shopName,
        店铺定位: shop.position || '',
        付费点击量: paidClicks ?? '',
        整体PPC: ppc ?? '',
        当天引导ROI: roi ?? '',
        整体成交笔数: totalOrders ?? '',
        整体笔单价: averageOrderValue ?? '',
        投放费用: roundMetric(spend, 2),
        估算成交GMV: roundMetric(estimatedGmv, 2),
        投放费比: roundMetric(safeDivide(spend, estimatedGmv), 6),
        付费成交GMV: roundMetric(paidGmv, 2),
        付费渗透率: roundMetric(safeDivide(paidGmv, estimatedGmv), 6),
        执行结果: '已汇总',
        备注: '',
      })
    }
    return rows
  }

  function buildToolRows(resolvedShops, metricIndex, channelClickIndex, toolCostRateIndex, dateRanges) {
    const rows = []
    for (const shop of resolvedShops.filter(item => !item.status || item.status === '已解析')) {
      const token = shop.token || shop.shopName
      const paidClicks = metricValue(metricIndex, shop, 'baseAd.click')
      const ppc = metricValue(metricIndex, shop, 'baseAd.clickCost')
      const totalSpend = Number.isFinite(paidClicks) && Number.isFinite(ppc) ? paidClicks * ppc : null
      const rates = toolCostRateIndex[token] || {}
      const clicks = channelClickIndex[token] || {}
      const names = Array.from(new Set([...Object.keys(rates), ...Object.keys(clicks)])).filter(Boolean)
      for (const name of names) {
        const rate = rates[name]
        const click = clicks[name]
        const toolSpend = Number.isFinite(totalSpend) && Number.isFinite(rate) ? totalSpend * rate : null
        rows.push({
          __sheet_name: TOOL_SHEET,
          统计周: dateRanges.weekLabel,
          分析周期: `${dateRanges.beginDate} 至 ${dateRanges.endDate}`,
          店铺名称: shop.shopName,
          店铺定位: shop.position || '',
          工具名称: name,
          工具结构占比: rate ?? '',
          分工具点击量: click ?? '',
          总投放费用: roundMetric(totalSpend, 2),
          分工具费用: roundMetric(toolSpend, 2),
          分工具PPC: roundMetric(safeDivide(toolSpend, click), 4),
          执行结果: '已汇总',
          备注: Number.isFinite(rate) && Number.isFinite(click) ? '' : '缺少工具结构占比或渠道点击量',
        })
      }
    }
    return rows
  }

  async function collectCompetitionData(rawParams = params) {
    const dateRanges = resolveDateRanges(rawParams)
    const monitorShops = parseMonitorShopRows(rawParams.shop_list)
    const resolvedShops = await resolveMonitorShops(monitorShops)
    const selfShop = resolvedShops.find(shop => shop.isSelf) || { shopName: SELF_SHOP_NAME, position: '本品', isSelf: true, status: '已解析' }
    const competitorShops = resolvedShops.filter(shop => !shop.isSelf && shop.token)
    const requestedTokens = new Set(competitorShops.map(shop => shop.token).filter(Boolean))
    const tokenToShop = new Map(competitorShops.map(shop => [shop.token, shop]))
    const context = {
      dateRanges,
      selfShop,
      requestedTokens,
      tokenToShop,
      detailRows: [],
      seenDetailKeys: new Set(),
      metricIndex: {},
      channelClickIndex: {},
      toolCostRateIndex: {},
    }

    const batchSize = rawParams.max_competitors_per_batch || DEFAULT_BATCH_SIZE
    const chunks = chunkArray(competitorShops, batchSize)
    const batches = chunks.length ? chunks : [[]]
    const logRows = [
      makeLogRow(dateRanges, '准备', '已开始', `店铺=${monitorShops.length}；竞店批次=${batches.length}；每批最多3家`),
    ]

    for (const [index, batch] of batches.entries()) {
      const competitorIds = batch.map(shop => shop.token).filter(Boolean)
      const payload = buildAnalysisPayload(dateRanges, competitorIds)
      try {
        const control = await callGateway('/api/competition/analysis/base/control/ratio', payload)
        addMetricMapRows(context, control, {
          module: '基础分析',
          tableName: '竞争控比分析',
          source: '/api/competition/analysis/base/control/ratio',
          metrics: CONTROL_METRICS,
          metricPrefix: 'baseControl',
        })
        const shopIndicator = await callGateway('/api/competition/analysis/base/shop/indicator', payload)
        addMetricMapRows(context, shopIndicator, {
          module: '基础分析',
          tableName: '经营指标对比',
          source: '/api/competition/analysis/base/shop/indicator',
          metrics: BASE_SHOP_METRICS,
          metricPrefix: 'baseShop',
        })
        const adIndicator = await callGateway('/api/competition/analysis/base/indicator', payload)
        addMetricMapRows(context, adIndicator, {
          module: '基础分析',
          tableName: '推广指标对比',
          source: '/api/competition/analysis/base/indicator',
          metrics: BASE_AD_METRICS,
          metricPrefix: 'baseAd',
        })
        const flowIndicator = await callGateway('/api/competition/analysis/flow/indicator', {
          ...payload,
          attributionScale: '2',
          attributionMode: 1,
        })
        addNestedChannelMetricRows(context, flowIndicator, {
          module: '流量分析',
          tableName: '核心指标对比',
          source: '/api/competition/analysis/flow/indicator',
          metrics: FLOW_METRICS,
        })
        for (const crowdBuyType of [1, 2]) {
          const crowd = await callGateway('/api/competition/analysis/crowd/structural', {
            ...payload,
            crowdBuyType,
          })
          addCrowdRows(context, crowd, crowdBuyType)
        }
        logRows.push(makeLogRow(dateRanges, `基础/流量/客群批次 ${index + 1}`, '已采集', `竞店数=${competitorIds.length}`))
      } catch (error) {
        logRows.push(makeLogRow(dateRanges, `基础/流量/客群批次 ${index + 1}`, '采集失败', describeError(error)))
      }
    }

    const structureShops = [selfShop, ...competitorShops].filter(shop => shop.token)
    for (const shop of structureShops) {
      const payload = buildAnalysisPayload(dateRanges, [shop.token])
      try {
        const paidFree = await callGateway('/api/competition/analysis/flow/paid_free/structural', payload)
        addScalarStructureRows(context, paidFree, {
          shop,
          tableName: '渠道结构-付免流量结构',
          source: '/api/competition/analysis/flow/paid_free/structural',
          metric: { code: 'clickRate', name: '点击量占比', valueType: 'rate' },
        })
        const investor = await callGateway('/api/competition/analysis/flow/investor/structural', payload)
        addScalarStructureRows(context, investor, {
          shop,
          tableName: '渠道结构-无界投资结构',
          source: '/api/competition/analysis/flow/investor/structural',
          metric: { code: 'costRate', name: '工具结构占比', valueType: 'rate' },
        })
        logRows.push(makeLogRow(dateRanges, `渠道结构 ${shop.shopName}`, '已采集', ''))
      } catch (error) {
        logRows.push(makeLogRow(dateRanges, `渠道结构 ${shop.shopName}`, '采集失败', describeError(error)))
      }
    }

    const allRows = [
      ...buildSummaryRows(resolvedShops, context.metricIndex, dateRanges),
      ...buildToolRows(resolvedShops, context.metricIndex, context.channelClickIndex, context.toolCostRateIndex, dateRanges),
      ...context.detailRows,
      ...makeShopRows(resolvedShops, dateRanges),
      ...logRows,
    ]
    return allRows
  }

  function complete(data = [], newShared = shared, hasMore = false, sleepMs = 0) {
    return {
      success: true,
      data,
      meta: {
        has_more: hasMore,
        sleep_ms: sleepMs,
      },
      shared: newShared,
    }
  }

  if (testExports) {
    Object.assign(testExports, {
      SUMMARY_SHEET,
      TOOL_SHEET,
      DETAIL_SHEET,
      SHOP_SHEET,
      LOG_SHEET,
      DEFAULT_MONITOR_SHOPS,
      chunkArray,
      parseMetricNumber,
      resolveDateRanges,
      extractPageDateRanges,
      parseMonitorShopRows,
      buildSummaryRows,
      buildToolRows,
      normalizeShopName,
      findBestShopMatch,
    })
  }

  if (phase === '__exports__') return complete([], shared)

  try {
    const href = window.location?.href || location.href || ''
    if (!/https:\/\/dmp\.taobao\.com\/index_new\.html/.test(href) || !/#!\/compete\/compete-situation/.test(href)) {
      return complete([{
        __sheet_name: LOG_SHEET,
        阶段: '页面检查',
        执行结果: '页面不匹配',
        备注: '请在达摩盘「竞争态势分析」页面运行该任务',
      }])
    }
    const rows = await collectCompetitionData(params)
    return complete(rows.length ? rows : [{
      __sheet_name: LOG_SHEET,
      阶段: '采集',
      执行结果: '无数据',
      备注: '接口未返回可导出的表格数据',
    }])
  } catch (error) {
    return {
      success: false,
      error: describeError(error, '天猫竞品付费投放数据监控采集失败'),
    }
  }
})()
