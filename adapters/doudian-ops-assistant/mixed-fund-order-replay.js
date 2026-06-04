;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'

  const OFFICIAL_EXPORT_FIELDS = [
    'pid',
    'order_id',
    'create_time',
    'pay_time',
    'product_id',
    'product_name',
    'sku_code',
    'combo_amount',
    'platform_discount',
    'content_type',
    'compass_entrance_code',
    'c_biz',
    'ad_mark',
  ]

  const ACTIVITIES = {
    high_value: {
      id: '7631472587859837230',
      name: '【高客单商品必报】优质用户混资货补',
      couponMatchers: [/平台老朋友惊喜券/],
    },
    long_cycle: {
      id: '7611436032944275738',
      name: '【混资货品补贴-长周期】商家灵活出资，平台至高5倍对补',
      couponMatchers: [/平台新人首单惊喜券/, /平台新人首单福利券/, /平台限时回归礼券/],
    },
    mall_long_term: {
      id: '7554013743270347034',
      name: '必报！抖音商城混资券长期报名入口【商家出资5%】',
      couponMatchers: [/平台惊喜.*折券/],
    },
    recommendation_card: {
      id: '7610636843016552714',
      name: '🔥全品类爆发！推荐卡混资活动报名入口',
      couponMatchers: [/平台惊喜.*折券/],
    },
  }

  function compact(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  }

  function checkboxEnabled(value, defaultValue = true) {
    if (Array.isArray(value)) {
      if (!value.length) return false
      return value.some(item => /^(1|true|yes|是|开启)$/i.test(compact(item)))
    }
    const text = compact(value)
    if (!text) return defaultValue
    return /^(1|true|yes|是|开启)$/i.test(text)
  }

  function numberParam(value, fallback, min, max) {
    const num = Number(value)
    if (!Number.isFinite(num)) return fallback
    return Math.max(min, Math.min(max, Math.floor(num)))
  }

  function pad(value) {
    return String(value).padStart(2, '0')
  }

  function formatTime(value) {
    const raw = Number(value)
    if (!Number.isFinite(raw) || raw <= 0) return compact(value)
    const ms = raw > 10_000_000_000 ? raw : raw * 1000
    const date = new Date(ms)
    if (Number.isNaN(date.getTime())) return ''
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }

  function dateToUnix(dateText, endOfDay = false) {
    const text = compact(dateText)
    if (!text) return 0
    if (/^\d{10}$/.test(text)) return Number(text)
    if (/^\d{13}$/.test(text)) return Math.floor(Number(text) / 1000)
    const normalized = text.replace(/\//g, '-')
    const timePart = endOfDay ? '23:59:59' : '00:00:00'
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
      ? `${normalized}T${timePart}+08:00`
      : normalized.includes('T')
        ? normalized
        : `${normalized.replace(' ', 'T')}+08:00`
    const ms = Date.parse(iso)
    if (!Number.isFinite(ms)) return 0
    return Math.floor(ms / 1000)
  }

  function today() {
    return formatTime(Date.now())
  }

  function normalizeHeader(value) {
    return compact(value).replace(/[（(].*?[）)]/g, '').replace(/[:：]/g, '').toLowerCase()
  }

  function getCell(row, aliases) {
    if (!row || typeof row !== 'object') return ''
    for (const alias of aliases) {
      if (row[alias] !== undefined && compact(row[alias]) !== '') return row[alias]
    }
    const normalized = new Map()
    for (const [key, value] of Object.entries(row)) normalized.set(normalizeHeader(key), value)
    for (const alias of aliases) {
      const value = normalized.get(normalizeHeader(alias))
      if (value !== undefined && compact(value) !== '') return value
    }
    return ''
  }

  function csvRows(text) {
    const source = String(text || '').replace(/^\uFEFF/, '')
    const records = []
    let row = []
    let cell = ''
    let quoted = false

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index]
      const next = source[index + 1]
      if (quoted) {
        if (char === '"' && next === '"') {
          cell += '"'
          index += 1
        } else if (char === '"') {
          quoted = false
        } else {
          cell += char
        }
        continue
      }

      if (char === '"') {
        quoted = true
      } else if (char === ',') {
        row.push(cell)
        cell = ''
      } else if (char === '\n') {
        row.push(cell)
        records.push(row)
        row = []
        cell = ''
      } else if (char !== '\r') {
        cell += char
      }
    }

    if (cell || row.length) {
      row.push(cell)
      records.push(row)
    }

    const [headers = [], ...body] = records
    return body
      .filter(items => items.some(item => compact(item)))
      .map(items => {
        const record = {}
        headers.forEach((header, index) => {
          const key = compact(header)
          if (key) record[key] = items[index] == null ? '' : items[index]
        })
        return record
      })
  }

  function parseAmount(value) {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return 0
      return value
    }
    const text = compact(value)
    if (!text) return 0
    const cleaned = text.replace(/[,，￥¥元]/g, '')
    const match = cleaned.match(/-?\d+(?:\.\d+)?/)
    if (!match) return 0
    const num = Number(match[0])
    return Number.isFinite(num) ? num : 0
  }

  function fromCents(value) {
    const num = Number(value)
    if (!Number.isFinite(num)) return 0
    return Math.round((num / 100) * 10000) / 10000
  }

  function roundMoney(value) {
    const num = Number(value)
    if (!Number.isFinite(num)) return 0
    return Math.round(num * 100) / 100
  }

  function roundRatio(value) {
    const num = Number(value)
    if (!Number.isFinite(num)) return 0
    return Math.round(num * 10000) / 10000
  }

  function readShopName() {
    const lines = String(document.body?.innerText || '')
      .split(/\n+/)
      .map(compact)
      .filter(Boolean)
      .slice(0, 120)
    const exactShop = lines.find(line => /旗舰店|专卖店|专营店/.test(line) && !/申请关店|抖店/.test(line) && line.length <= 40)
    return exactShop || compact(params.shop_name) || ''
  }

  function inferBrand(value) {
    const text = compact(value)
    if (/巴拉巴拉|balabala/i.test(text)) return '巴拉巴拉'
    if (/迷你巴拉|minibala/i.test(text)) return '迷你巴拉'
    if (/森马|semir/i.test(text)) return '森马'
    return ''
  }

  function allInputRows(file) {
    const rows = []
    if (Array.isArray(file?.rows)) rows.push(...file.rows)
    if (file?.sheets && typeof file.sheets === 'object') {
      for (const sheet of Object.values(file.sheets)) {
        if (Array.isArray(sheet?.rows) && sheet.rows !== file.rows) rows.push(...sheet.rows)
      }
    }
    return rows.filter(row => row && typeof row === 'object')
  }

  function orderFile() {
    return params.order_file || params.input_file || params.export_file || params.file
  }

  function signupFile() {
    return params.signup_file || params.signup_monitor_file || params.activity_file || params.signup_result_file
  }

  function resolveSurpriseActivity() {
    const raw = compact(params.surprise_coupon_activity || params.surprise_activity || '')
    if (/recommend|推荐卡|7610636843016552714/i.test(raw)) return ACTIVITIES.recommendation_card
    return ACTIVITIES.mall_long_term
  }

  function activityById(activityId) {
    const id = compact(activityId)
    if (!id) return null
    return Object.values(ACTIVITIES).find(activity => activity.id === id) || null
  }

  function activityByName(activityName) {
    const name = compact(activityName)
    if (!name) return null
    return Object.values(ACTIVITIES).find(activity => name === activity.name || name.includes(activity.name) || activity.name.includes(name)) || null
  }

  function matchActivity(couponText) {
    const text = compact(couponText)
    if (!text) return null
    for (const key of ['high_value', 'long_cycle']) {
      const activity = ACTIVITIES[key]
      if (activity.couponMatchers.some(pattern => pattern.test(text))) return activity
    }
    if (/平台惊喜.*折券/.test(text)) return resolveSurpriseActivity()
    return null
  }

  function addSignupActivity(map, key, activity) {
    const safeKey = compact(key)
    if (!safeKey || !activity) return
    if (!map.has(safeKey)) map.set(safeKey, [])
    const list = map.get(safeKey)
    if (!list.some(item => item.id === activity.id)) list.push(activity)
  }

  function buildSignupActivityIndex() {
    const rows = allInputRows(signupFile())
    const byProductId = new Map()
    const bySkuCode = new Map()
    let usableRows = 0

    for (const row of rows) {
      const sheetName = compact(row.__sheet_name || row.sheet_name || row.Sheet || row.sheet)
      if (sheetName && !/报名商品明细|signup|detail/i.test(sheetName)) continue
      const activity = activityById(getCell(row, ['活动ID', 'activity_id'])) || activityByName(getCell(row, ['活动名称', 'activity_name']))
      if (!activity) continue
      const productId = compact(getCell(row, ['商品ID', '商品id', '商品编号', 'product_id', 'item_id']))
      const skuCode = compact(getCell(row, ['商家编码', '商家SKU编码', 'sku_code', 'merchant_sku_code', '货号', 'outer_id']))
      if (!productId && !skuCode) continue
      usableRows += 1
      addSignupActivity(byProductId, productId, activity)
      addSignupActivity(bySkuCode, skuCode, activity)
    }

    return {
      rows: usableRows,
      byProductId,
      bySkuCode,
      keyCount: byProductId.size + bySkuCode.size,
    }
  }

  function uniqueActivities(items) {
    const map = new Map()
    for (const item of items || []) {
      if (item?.id) map.set(item.id, item)
    }
    return Array.from(map.values())
  }

  function lookupSignupActivity(row, signupIndex) {
    if (!signupIndex || !signupIndex.rows) return null
    const candidates = [
      ...(signupIndex.byProductId.get(compact(row.productId)) || []),
      ...(signupIndex.bySkuCode.get(compact(row.skuCode)) || []),
    ]
    const matched = uniqueActivities(candidates)
    if (!matched.length) return null
    if (matched.length === 1) {
      return {
        activity: matched[0],
        ambiguous: false,
      }
    }
    return {
      activity: null,
      ambiguous: true,
      activityIds: matched.map(item => item.id),
    }
  }

  function matchOrderActivity(row, signupIndex, stats) {
    const text = compact(row.couponText)
    if (!text) return null
    for (const key of ['high_value', 'long_cycle']) {
      const activity = ACTIVITIES[key]
      if (activity.couponMatchers.some(pattern => pattern.test(text))) {
        return {
          activity,
          reason: '平台优惠券名匹配',
        }
      }
    }
    if (!/平台惊喜.*折券/.test(text)) return null

    const signupMatched = lookupSignupActivity(row, signupIndex)
    if (signupMatched?.activity) {
      stats.surpriseSignupMatched += 1
      return {
        activity: signupMatched.activity,
        reason: '平台惊喜折券 + 报名商品匹配',
      }
    }
    if (signupMatched?.ambiguous) stats.surpriseAmbiguous += 1
    stats.surpriseDefaulted += 1
    return {
      activity: resolveSurpriseActivity(),
      reason: signupMatched?.ambiguous ? '平台惊喜折券报名商品多活动，按默认归属' : '平台惊喜折券默认归属',
    }
  }

  function firstPromotionName(rawPromotionDetail) {
    if (!rawPromotionDetail) return ''
    const raw = typeof rawPromotionDetail === 'object' ? rawPromotionDetail : safeJson(rawPromotionDetail)
    const texts = []
    const seen = new Set()
    const stack = [raw]
    while (stack.length) {
      const current = stack.shift()
      if (!current || typeof current !== 'object' || seen.has(current)) continue
      seen.add(current)
      for (const [key, value] of Object.entries(current)) {
        if (/name|title|coupon|promotion|discount/i.test(key) && typeof value !== 'object') {
          const text = compact(value)
          if (text) texts.push(text)
        }
        if (value && typeof value === 'object') stack.push(value)
      }
    }
    return texts.join('；')
  }

  function safeJson(value) {
    try {
      return JSON.parse(String(value))
    } catch (error) {
      return null
    }
  }

  function normalizeExportRow(row, index) {
    const orderId = compact(getCell(row, ['主订单编号', '订单编号', '订单号', '父订单号', 'shop_order_id', '主订单ID', 'pid']))
    const itemOrderId = compact(getCell(row, ['子订单编号', '子订单号', '商品订单编号', 'item_order_id', 'order_id']))
    const shopName = compact(getCell(row, ['店铺名称', '店铺', 'shop_name'])) || compact(params.shop_name) || readShopName()
    const couponText = compact(getCell(row, ['平台优惠', '平台优惠券', '优惠券名称', '平台优惠名称', '平台优惠明细', 'promotion_detail', 'platform_discount']))
    const trafficContent = compact(getCell(row, ['流量体裁', '内容体裁', 'content_type']))
    const trafficChannel = compact(getCell(row, ['流量渠道', '成交渠道', '渠道', 'traffic_channel', 'compass_entrance_code', 'c_biz']))
    const trafficSource = compact(getCell(row, ['流量来源', 'c_biz']))
    const trafficType = compact(getCell(row, ['流量类型', 'ad_mark']))
    const productId = compact(getCell(row, ['商品ID', '商品id', '商品编号', 'product_id']))
    const productName = compact(getCell(row, ['商品名称', '选购商品', 'product_name', '商品']))
    const skuCode = compact(getCell(row, ['商家编码', '商家SKU编码', 'sku_code', 'merchant_sku_code', '货号']))
    const createTime = compact(getCell(row, ['下单时间', '订单创建时间', 'create_time', '支付时间']))
    const amount = parseAmount(getCell(row, ['成交金额', '支付金额', '订单应付金额', '商品成交金额', '商品实付金额', 'combo_amount', 'pay_amount']))
    return {
      source: 'export',
      index,
      shopName,
      orderId: orderId || itemOrderId || `ROW-${index + 1}`,
      itemOrderId,
      createTime,
      productId,
      productName,
      skuCode,
      amount,
      couponText,
      trafficContent,
      trafficChannel,
      trafficSource,
      trafficType,
      raw: row,
    }
  }

  function normalizeApiOrder(order, index) {
    const products = Array.isArray(order?.product_item) && order.product_item.length ? order.product_item : [{}]
    const amount = fromCents(order?.promotion_pay_amount || order?.pay_amount || order?.pay_amount_text)
    return products.map((product, productIndex) => ({
      source: 'api',
      index: index + productIndex / 1000,
      shopName: compact(params.shop_name) || readShopName(),
      orderId: compact(order?.shop_order_id || order?.order_id || order?.id) || `API-${index + 1}`,
      itemOrderId: compact(product?.item_order_id || product?.order_id || ''),
      createTime: formatTime(order?.create_time || order?.pay_time),
      productId: compact(product?.product_id || product?.pid || ''),
      productName: compact(product?.product_name || product?.name || ''),
      skuCode: compact(product?.merchant_sku_code || product?.sku_code || ''),
      amount: products.length > 1 ? roundMoney(amount / products.length) : amount,
      couponText: firstPromotionName(order?.promotion_detail),
      trafficContent: '',
      trafficChannel: compact(order?.c_biz || order?.c_biz_desc || ''),
      trafficSource: compact(order?.c_biz || order?.c_biz_desc || ''),
      trafficType: compact(order?.ad_mark || order?.ad_mark_desc || ''),
      raw: order,
    }))
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options)
    const text = await response.text()
    let payload
    try {
      payload = JSON.parse(text)
    } catch (error) {
      throw new Error(`接口返回不是 JSON：${url}`)
    }
    if (!response.ok) throw new Error(`接口 HTTP ${response.status}：${url}`)
    return payload
  }

  async function postJson(url, body) {
    return fetchJson(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    })
  }

  async function fetchText(url, options = {}) {
    const response = await fetch(url, { credentials: 'include', ...options })
    const text = await response.text()
    if (!response.ok) throw new Error(`接口 HTTP ${response.status}：${url}`)
    return {
      text,
      contentType: response.headers?.get?.('content-type') || '',
    }
  }

  async function queryOrdersFromApi() {
    const pageSize = numberParam(params.page_size, 50, 1, 100)
    const maxPages = numberParam(params.max_pages, 1, 1, 200)
    const rows = []
    for (let page = 0; page < maxPages; page += 1) {
      const query = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        order_by: 'create_time',
        order: 'desc',
        tab: compact(params.tab) || 'all',
        appid: '1',
        _bid: 'ffa_order',
        aid: '4272',
      })
      if (params.start_time) query.set('create_time_start', compact(params.start_time))
      if (params.end_time) query.set('create_time_end', compact(params.end_time))
      const payload = await fetchJson(`/api/order/searchlist?${query.toString()}`, { credentials: 'include' })
      if (payload.code !== undefined && Number(payload.code) !== 0) {
        throw new Error(`订单列表接口失败：${payload.msg || payload.message || payload.code}`)
      }
      const list = Array.isArray(payload.data) ? payload.data : Array.isArray(payload?.data?.data) ? payload.data.data : []
      for (let i = 0; i < list.length; i += 1) rows.push(...normalizeApiOrder(list[i], page * pageSize + i))
      const total = Number(payload.total || payload?.data?.total || list.length || 0)
      if (!list.length || list.length < pageSize || rows.length >= total) break
    }
    return rows
  }

  function flattenExportFields(payload) {
    const rows = []
    function walk(value, group) {
      if (!value) return
      if (Array.isArray(value)) {
        value.forEach(item => walk(item, group))
        return
      }
      if (typeof value !== 'object') return
      const nextGroup = compact(value.type_value || value.type_key || group)
      if (value.key || value.value) {
        rows.push({
          key: compact(value.key),
          value: compact(value.value),
          group: nextGroup,
        })
      }
      for (const childKey of ['children_fields', 'children', 'fields']) {
        if (Array.isArray(value[childKey])) walk(value[childKey], nextGroup)
      }
    }
    walk(payload?.data?.CUSTOM || payload?.data?.custom_fields || [], '')
    return rows
  }

  async function resolveOfficialExportFields() {
    const payload = await fetchJson('/order/torder/queryExportFields', { credentials: 'include' })
    if (payload.code !== undefined && Number(payload.code) !== 0) {
      throw new Error(`导出字段接口失败：${payload.msg || payload.message || payload.code}`)
    }
    const keys = new Set(flattenExportFields(payload).map(item => item.key).filter(Boolean))
    const missing = OFFICIAL_EXPORT_FIELDS.filter(key => !keys.has(key))
    if (missing.length) throw new Error(`官方导出缺少必要字段：${missing.join(', ')}`)
    return OFFICIAL_EXPORT_FIELDS.slice()
  }

  function officialExportBody(fields) {
    const start = dateToUnix(params.start_date || params.start_time, false)
    const end = dateToUnix(params.end_date || params.end_time, true)
    if (!start || !end) throw new Error('官方导出 API 模式需要填写数据开始日期和结束日期。')
    if (end < start) throw new Error('数据结束日期不能早于开始日期。')
    return {
      b_type: -1,
      order: '',
      order_by: '',
      order_status: compact(params.order_status || ''),
      page: 0,
      pageSize: 0,
      sub_shop_id: Number(params.sub_shop_id || 0) || 0,
      stress_tag: '',
      create_time_start: start,
      create_time_end: end,
      file_type: 'csv',
      task_id: '',
      report_type: 'CUSTOM',
      report_dimension: compact(params.report_dimension || params.official_export_dimension || 'PRODUCT_ORDER'),
      custom_export_fields: fields,
      remember_choice: false,
      export_scene: '',
      search_record_request: null,
      priority_delivery_search_record_request: null,
      verify_code: '',
      verify_type: '',
      verify_account: '',
    }
  }

  async function checkOfficialExportAllowed(body) {
    const query = new URLSearchParams()
    query.set('come_from', 'pc')
    query.set('aid', '4272')
    for (const [key, value] of Object.entries(body)) {
      if (Array.isArray(value) || value == null || typeof value === 'object') continue
      query.set(key, String(value))
    }
    query.set('compact_time[select]', 'create_time_start,create_time_end')
    const payload = await fetchJson(`/order/torder/checkIsAllowExport?${query.toString()}`, { credentials: 'include' })
    if (payload.code !== undefined && Number(payload.code) !== 0) {
      throw new Error(`导出前置校验失败：${payload.msg || payload.message || payload.code}`)
    }
    const data = payload.data || {}
    if (data.is_allow === false) throw new Error(data.reject_reason || '当前筛选条件不允许导出。')
    return data
  }

  async function createOfficialExportTask() {
    const fields = await resolveOfficialExportFields()
    const body = officialExportBody(fields)
    await checkOfficialExportAllowed(body)
    const payload = await postJson('/order/torder/export', body)
    if (payload.code !== undefined && Number(payload.code) !== 0) {
      throw new Error(`创建官方订单导出失败：${payload.msg || payload.message || payload.code}`)
    }
    const taskId = compact(payload?.data?.task_id || payload?.data?.taskId || payload?.task_id || '')
    return {
      success: true,
      data: [],
      meta: {
        action: 'next_phase',
        next_phase: 'wait_official_export',
        sleep_ms: numberParam(params.export_poll_ms, 10000, 1000, 60000),
        has_more: true,
        shared: {
          ...shared,
          official_export_task_id: taskId,
          official_export_fields: fields,
          official_export_dimension: body.report_dimension,
          official_export_started_at: Math.floor(Date.now() / 1000),
          official_export_wait_count: 0,
          official_export_query: body,
          data_source: 'official_export_api',
        },
      },
    }
  }

  function exportTaskReady(status) {
    const text = compact(status)
    return text === '2' || /处理成功|成功|完成/.test(text)
  }

  function exportTaskFailed(status) {
    const text = compact(status)
    return text === '3' || /处理失败|失败/.test(text)
  }

  async function downloadOfficialCsv(taskId) {
    const baseUrl = `/order/torder/exportHistory/downloadfile?task_id=${encodeURIComponent(taskId)}&come_from=pc`
    const first = await fetchText(baseUrl)
    const firstJson = safeJson(first.text)
    if (firstJson && typeof firstJson === 'object') {
      const data = firstJson.data || {}
      if (data.verify_type) {
        throw new Error(`官方导出下载需要${data.verify_type === 'email' ? '邮箱' : ''}验证码，请在抖店“导出记录”中完成验证后下载订单导出文件，再用“官方订单导出文件”模式复盘。`)
      }
      if (data.file_name) {
        const second = await fetchText(`${baseUrl}&file_name=${encodeURIComponent(data.file_name)}`)
        const secondJson = safeJson(second.text)
        if (secondJson?.data?.verify_type) {
          throw new Error('官方导出下载需要验证码，请在抖店“导出记录”中完成验证后下载订单导出文件，再用“官方订单导出文件”模式复盘。')
        }
        return second.text
      }
      throw new Error(firstJson.msg || firstJson.message || '官方导出下载没有返回 CSV 文件。')
    }
    return first.text
  }

  async function waitOfficialExportAndReplay() {
    const taskId = compact(shared.official_export_task_id || params.official_export_task_id)
    if (!taskId) throw new Error('缺少官方导出任务 ID。')
    const statusPayload = await fetchJson(`/order/torder/queryDownloadStatus?task_id_list=${encodeURIComponent(taskId)}`, { credentials: 'include' })
    if (statusPayload.code !== undefined && Number(statusPayload.code) !== 0) {
      throw new Error(`查询官方导出状态失败：${statusPayload.msg || statusPayload.message || statusPayload.code}`)
    }
    const task = (statusPayload?.data?.task_list || []).find(item => compact(item.task_id) === taskId) || statusPayload?.data?.task_list?.[0] || {}
    const status = task.status
    if (exportTaskFailed(status)) throw new Error(`官方订单导出失败：${task.fail_reason || task.reason || status}`)
    if (!exportTaskReady(status)) {
      const waitCount = Number(shared.official_export_wait_count || 0)
      return {
        success: true,
        data: [],
        meta: {
          action: 'next_phase',
          next_phase: 'wait_official_export',
          sleep_ms: numberParam(params.export_poll_ms, 10000, 1000, 60000),
          has_more: true,
          shared: {
            ...shared,
            official_export_wait_count: waitCount + 1,
            official_export_last_status: status,
            data_source: 'official_export_api',
          },
        },
      }
    }

    const csv = await downloadOfficialCsv(taskId)
    const rows = csvRows(csv).map((row, index) => normalizeExportRow(row, index))
    if (!rows.length) throw new Error('官方导出 CSV 没有可复盘的订单数据。')
    const result = replay(rows)
    return {
      success: true,
      data: result.data,
      meta: {
        has_more: false,
        shared: {
          ...shared,
          ...result.shared,
          official_export_task_id: taskId,
          official_export_status: status,
          data_source: 'official_export_api',
          surprise_coupon_activity: resolveSurpriseActivity().id,
        },
      },
    }
  }

  function uniqueRows(rows) {
    const seen = new Set()
    const output = []
    for (const row of rows) {
      const key = [row.orderId, row.itemOrderId, row.productId, row.amount, row.couponText].map(compact).join('::')
      if (seen.has(key)) continue
      seen.add(key)
      output.push(row)
    }
    return output
  }

  function addMetric(map, key, amount, extra = {}) {
    const safeKey = compact(key) || '未识别'
    if (!map.has(safeKey)) map.set(safeKey, { key: safeKey, amount: 0, count: 0, ...extra })
    const item = map.get(safeKey)
    item.amount += amount
    item.count += 1
    return item
  }

  function makeDetailRow(row, activity, scrapeTime, matchReason) {
    return {
      __sheet_name: '混资订单明细',
      平台名称: '抖店',
      品牌: inferBrand(row.shopName || row.productName),
      店铺名称: row.shopName,
      订单号: row.orderId,
      子订单号: row.itemOrderId,
      下单时间: row.createTime,
      商品ID: row.productId,
      商品名称: row.productName,
      商家编码: row.skuCode,
      成交金额: roundMoney(row.amount),
      平台优惠: row.couponText,
      匹配活动ID: activity.id,
      匹配活动名称: activity.name,
      匹配依据: matchReason || '平台优惠券名匹配',
      流量体裁: row.trafficContent,
      流量渠道: row.trafficChannel,
      流量来源: row.trafficSource,
      流量类型: row.trafficType,
      抓取时间: scrapeTime,
    }
  }

  function replay(rows) {
    const scrapeTime = today()
    const data = []
    const allRows = uniqueRows(rows)
    const mixedRows = []
    const activityMap = new Map()
    const productCardChannelMap = new Map()
    const productMap = new Map()
    let allAmount = 0
    let mixedAmount = 0
    let productCardAmount = 0
    let exportFieldsPresent = false
    const signupIndex = buildSignupActivityIndex()
    const matchStats = {
      surpriseSignupMatched: 0,
      surpriseDefaulted: 0,
      surpriseAmbiguous: 0,
    }

    for (const row of allRows) {
      allAmount += row.amount
      if (row.source === 'export' && (row.couponText || row.trafficContent || row.trafficChannel)) exportFieldsPresent = true
      const matched = matchOrderActivity(row, signupIndex, matchStats)
      if (!matched?.activity) continue
      const activity = matched.activity
      mixedRows.push(row)
      mixedAmount += row.amount
      const activityMetric = addMetric(activityMap, activity.id, row.amount, {
        id: activity.id,
        name: activity.name,
        productCardAmount: 0,
      })
      if (/商品卡/.test(row.trafficContent)) {
        productCardAmount += row.amount
        activityMetric.productCardAmount += row.amount
        addMetric(productCardChannelMap, row.trafficChannel, row.amount, { content: row.trafficContent })
      }
      const productKey = row.productId || row.productName || row.skuCode || '未识别商品'
      addMetric(productMap, productKey, row.amount, {
        productId: row.productId,
        productName: row.productName,
        skuCode: row.skuCode,
      })
      data.push(makeDetailRow(row, activity, scrapeTime, matched.reason))
    }

    data.unshift({
      __sheet_name: '复盘总览',
      平台名称: '抖店',
      品牌: inferBrand(params.shop_name || allRows[0]?.shopName || ''),
      店铺名称: compact(params.shop_name) || allRows[0]?.shopName || readShopName(),
      数据周期: [compact(params.start_date), compact(params.end_date)].filter(Boolean).join(' 至 '),
      全店引导成交金额: roundMoney(allAmount),
      混资成交金额: roundMoney(mixedAmount),
      混资成交订单数: mixedRows.length,
      商品卡成交金额: roundMoney(productCardAmount),
      商品卡成交占比: roundRatio(mixedAmount ? productCardAmount / mixedAmount : 0),
      抓取时间: scrapeTime,
      备注: exportFieldsPresent ? '' : '订单列表 API 未返回平台优惠/流量体裁/流量渠道；请使用官方订单导出文件补齐归因字段。',
    })

    for (const item of Array.from(activityMap.values()).sort((a, b) => b.amount - a.amount)) {
      data.push({
        __sheet_name: '活动汇总',
        平台名称: '抖店',
        活动ID: item.id,
        活动名称: item.name,
        成交订单数: item.count,
        成交金额: roundMoney(item.amount),
        商品卡成交金额: roundMoney(item.productCardAmount || 0),
        商品卡成交占比: roundRatio(item.amount ? (item.productCardAmount || 0) / item.amount : 0),
        抓取时间: scrapeTime,
      })
    }

    Array.from(productCardChannelMap.values())
      .sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key, 'zh-Hans-CN'))
      .slice(0, 3)
      .forEach((item, index) => {
        data.push({
          __sheet_name: '商品卡渠道Top3',
          排名: index + 1,
          流量体裁: item.content || '商品卡',
          流量渠道: item.key,
          成交订单数: item.count,
          成交金额: roundMoney(item.amount),
          抓取时间: scrapeTime,
        })
      })

    Array.from(productMap.values())
      .sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key, 'zh-Hans-CN'))
      .slice(0, 3)
      .forEach((item, index) => {
        data.push({
          __sheet_name: '成交单品Top3',
          排名: index + 1,
          商品ID: item.productId || item.key,
          商品名称: item.productName,
          商家编码: item.skuCode,
          成交订单数: item.count,
          成交金额: roundMoney(item.amount),
          抓取时间: scrapeTime,
        })
      })

    return {
      data,
      shared: {
        order_rows: allRows.length,
        mixed_fund_rows: mixedRows.length,
        mixed_fund_amount: roundMoney(mixedAmount),
        product_card_amount: roundMoney(productCardAmount),
        export_fields_present: exportFieldsPresent,
        signup_match_rows: signupIndex.rows,
        signup_match_keys: signupIndex.keyCount,
        surprise_signup_matched_rows: matchStats.surpriseSignupMatched,
        surprise_defaulted_rows: matchStats.surpriseDefaulted,
        surprise_ambiguous_rows: matchStats.surpriseAmbiguous,
        field_note: exportFieldsPresent ? '' : '缺少平台优惠/流量体裁/流量渠道，无法完成混资活动和流量归因。',
      },
    }
  }

  try {
    const source = compact(params.data_source || '')
    if (phase === 'wait_official_export') return await waitOfficialExportAndReplay()
    if (source === 'official_export_api') return await createOfficialExportTask()

    const file = orderFile()
    const useApi = source === 'api' || (!file && checkboxEnabled(params.use_api_fallback, false))
    const inputRows = useApi
      ? await queryOrdersFromApi()
      : allInputRows(file).map((row, index) => normalizeExportRow(row, index))
    if (!inputRows.length) {
      return {
        success: false,
        error: useApi ? '订单列表接口未返回订单数据。' : '请上传抖店官方订单导出 Excel/CSV，或选择 API fallback。',
        meta: { has_more: false },
      }
    }

    const result = replay(inputRows)
    return {
      success: true,
      data: result.data,
      meta: {
        has_more: false,
        shared: {
          ...result.shared,
          data_source: useApi ? 'api_searchlist' : 'official_export_file',
          surprise_coupon_activity: resolveSurpriseActivity().id,
        },
      },
    }
  } catch (error) {
    return {
      success: false,
      error: String(error?.message || error),
      meta: { has_more: false },
    }
  }
})()
