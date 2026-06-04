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
  const MIXED_FUND_ENTRANCES = [
    {
      activityId: ACTIVITIES.high_value.id,
      name: ACTIVITIES.high_value.name,
      parentActivityId: ACTIVITIES.long_cycle.id,
      parentName: ACTIVITIES.long_cycle.name,
      couponName: '平台老朋友惊喜券',
      entranceUrl: 'https://fxg.jinritemai.com/ffa/merchant/child-campaign-detail?id=7631472587859837230&from=operation_seller_link',
    },
    {
      activityId: ACTIVITIES.long_cycle.id,
      name: ACTIVITIES.long_cycle.name,
      parentActivityId: ACTIVITIES.long_cycle.id,
      parentName: ACTIVITIES.long_cycle.name,
      couponName: '平台新人首单惊喜券；平台新人首单福利券；平台限时回归礼券',
      entranceUrl: 'https://fxg.jinritemai.com/ffa/merchant/child-campaign-detail?id=7611436032944275738&from=operation_seller_link',
    },
    {
      activityId: ACTIVITIES.mall_long_term.id,
      name: ACTIVITIES.mall_long_term.name,
      parentActivityId: ACTIVITIES.mall_long_term.id,
      parentName: ACTIVITIES.mall_long_term.name,
      couponName: '平台惊喜XX折券',
      entranceUrl: 'https://fxg.jinritemai.com/ffa/merchant/child-campaign-detail?id=7554013743270347034&from=operation_seller_link',
    },
    {
      activityId: ACTIVITIES.recommendation_card.id,
      name: ACTIVITIES.recommendation_card.name,
      parentActivityId: '7627772015895036170',
      parentName: '🔥全品类爆发！推荐卡全资活动报名入口',
      couponName: '平台惊喜XX折券',
      entranceUrl: 'https://fxg.jinritemai.com/ffa/merchant/child-campaign-detail?applyTab=allow&id=7610636843016552714&from=campaign_square',
    },
  ]
  const MIXED_FUND_ENTRANCE_BY_ID = new Map(MIXED_FUND_ENTRANCES.map(activity => [activity.activityId, activity]))

  function activityScope() {
    return compact(params.activity_scope || params.activity_mode || 'default').toLowerCase()
  }

  function splitActivityLine(line) {
    const text = compact(line)
    if (text.includes('|')) return text.split('|').map(compact)
    if (text.includes('\t')) return text.split('\t').map(compact)
    if (text.includes(',')) return text.split(',').map(compact)
    if (text.includes('，')) return text.split('，').map(compact)
    return [text]
  }

  function activityIdFromText(text) {
    const source = compact(text)
    const queryMatch = source.match(/(?:activity_id|activityId|act_id|id)=([0-9]{8,})/i)
    if (queryMatch) return queryMatch[1]
    const match = source.match(/[0-9]{8,}/)
    return match ? match[0] : ''
  }

  function normalizeActivityConfig(item, index) {
    if (!item) return null
    if (typeof item === 'object' && !Array.isArray(item)) {
      const activityId = compact(item.activityId || item.activity_id || item.id || item.act_id)
      if (!activityId) return null
      const name = compact(item.name || item.activityName || item.activity_name || item.title)
      const parentActivityId = compact(item.parentActivityId || item.parent_activity_id || item.parentId || item.parent_id)
      const parentName = compact(item.parentName || item.parent_name || item.parentTitle || item.parent_title)
      const couponName = compact(item.couponName || item.coupon_name || item.coupon || item.platform_coupon)
      const entranceUrl = compact(item.entranceUrl || item.entrance_url || item.url || item.link)
      return {
        activityId,
        name: name || `自定义活动${index + 1}`,
        parentActivityId: parentActivityId || activityId,
        parentName: parentName || name || `自定义活动${index + 1}`,
        couponName,
        entranceUrl: entranceUrl || `https://fxg.jinritemai.com/ffa/merchant/child-campaign-detail?id=${activityId}`,
        entranceKeyword: '自定义入口',
      }
    }

    const fields = splitActivityLine(item)
    const activityId = activityIdFromText(fields[0])
    if (!activityId) return null
    const name = compact(fields[1])
    const parentActivityId = compact(fields[2])
    const parentName = compact(fields[3])
    const couponName = compact(fields[4])
    const entranceUrl = compact(fields[5]) || (String(item).match(/https?:\/\/\S+/) || [])[0] || ''
    return {
      activityId,
      name: name || `自定义活动${index + 1}`,
      parentActivityId: parentActivityId || activityId,
      parentName: parentName || name || `自定义活动${index + 1}`,
      couponName,
      entranceUrl: entranceUrl || `https://fxg.jinritemai.com/ffa/merchant/child-campaign-detail?id=${activityId}`,
      entranceKeyword: '自定义入口',
    }
  }

  function customActivityRows() {
    const raw = params.custom_activities || params.activity_list || ''
    if (Array.isArray(raw)) return raw
    if (raw && typeof raw === 'object') {
      if (Array.isArray(raw.rows)) return raw.rows
      if (Array.isArray(raw.activities)) return raw.activities
    }
    return String(raw || '')
      .split(/\n+/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && !line.startsWith('//'))
  }

  function configuredActivities() {
    if (activityScope() !== 'custom') return MIXED_FUND_ENTRANCES.slice()
    const map = new Map()
    customActivityRows().forEach((row, index) => {
      const activity = normalizeActivityConfig(row, index)
      if (activity?.activityId) map.set(activity.activityId, activity)
    })
    const activities = Array.from(map.values())
    if (!activities.length) throw new Error('自定义入口清单为空，请至少保留或新增 1 个活动入口。')
    return activities
  }

  function configuredActivityById() {
    return new Map(configuredActivities().map(activity => [activity.activityId, activity]))
  }

  function configuredActivityCatalog() {
    const configured = configuredActivityById()
    const catalog = {}
    for (const [key, activity] of Object.entries(ACTIVITIES)) {
      if (activityScope() === 'custom' && !configured.has(activity.id)) continue
      catalog[key] = {
        ...activity,
        name: configured.get(activity.id)?.name || activity.name,
      }
    }
    for (const activity of configured.values()) {
      if (Object.values(catalog).some(item => item.id === activity.activityId)) continue
      catalog[`custom_${activity.activityId}`] = {
        id: activity.activityId,
        name: activity.name,
        couponMatchers: [],
      }
    }
    return catalog
  }

  function firstConfiguredCatalogActivity() {
    const activity = configuredActivities()[0]
    if (!activity) return null
    return {
      id: activity.activityId,
      name: activity.name,
      couponMatchers: [],
    }
  }

  function compact(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  }

  function splitValues(value) {
    if (Array.isArray(value)) return value.map(item => compact(item)).filter(Boolean)
    return compact(value)
      .split(/[\s,，;；、]+/)
      .map(item => compact(item))
      .filter(Boolean)
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

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  function retryableFetchError(error) {
    const text = String(error?.message || error || '')
    return /Failed to fetch|Load failed|NetworkError|fetch|timeout|HTTP 429|HTTP 5\d\d/i.test(text)
  }

  function deepPick(obj, keys) {
    const seen = new Set()
    const stack = [obj]
    while (stack.length) {
      const current = stack.shift()
      if (!current || typeof current !== 'object' || seen.has(current)) continue
      seen.add(current)
      for (const key of keys) {
        const value = current[key]
        if (value !== undefined && value !== null && compact(value)) return compact(value)
      }
      for (const value of Object.values(current).slice(0, 100)) {
        if (value && typeof value === 'object') stack.push(value)
      }
    }
    return ''
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
    const rawId = activityIdFromText(raw)
    const explicit = (rawId ? activityById(rawId) : null) || activityByName(raw)
    if (explicit) return explicit
    if (/recommend|推荐卡|7610636843016552714/i.test(raw)) {
      return activityById(ACTIVITIES.recommendation_card.id)
        || activityById(ACTIVITIES.mall_long_term.id)
        || firstConfiguredCatalogActivity()
    }
    return activityById(ACTIVITIES.mall_long_term.id)
      || activityById(ACTIVITIES.recommendation_card.id)
      || firstConfiguredCatalogActivity()
  }

  function activityById(activityId) {
    const id = compact(activityId)
    if (!id) return null
    return Object.values(configuredActivityCatalog()).find(activity => activity.id === id) || null
  }

  function activityByName(activityName) {
    const name = compact(activityName)
    if (!name) return null
    return Object.values(configuredActivityCatalog()).find(activity => name === activity.name || name.includes(activity.name) || activity.name.includes(name)) || null
  }

  function activityCouponTokens(activity) {
    return splitValues(activity?.couponName || '')
      .filter(token => token && token !== '平台惊喜XX折券' && !/平台惊喜.*折券/.test(token))
  }

  function matchConfiguredCouponActivity(couponText) {
    const text = compact(couponText)
    if (!text) return null
    return configuredActivities().find(activity =>
      activityCouponTokens(activity).some(token => text.includes(token))
    ) || null
  }

  function toCatalogActivity(activity) {
    if (!activity) return null
    return activityById(activity.activityId || activity.id) || {
      id: activity.activityId || activity.id,
      name: activity.name,
      couponMatchers: [],
    }
  }

  function matchActivity(couponText) {
    const text = compact(couponText)
    if (!text) return null
    const activities = configuredActivityCatalog()
    for (const key of ['high_value', 'long_cycle']) {
      const activity = activities[key]
      if (!activity) continue
      if (activity.couponMatchers.some(pattern => pattern.test(text))) return activity
    }
    const configuredMatch = matchConfiguredCouponActivity(text)
    if (configuredMatch) return toCatalogActivity(configuredMatch)
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

  function buildSignupActivityIndex(extraRows = []) {
    const rows = [
      ...allInputRows(signupFile()),
      ...(Array.isArray(extraRows) ? extraRows : []),
    ]
    const byProductId = new Map()
    const bySkuCode = new Map()
    let usableRows = 0

    for (const row of rows) {
      const sheetName = compact(row.__sheet_name || row.sheet_name || row.Sheet || row.sheet)
      if (sheetName && !/报名商品明细|signup|detail/i.test(sheetName)) continue
      const activity = activityById(getCell(row, ['活动ID', 'activity_id'])) || activityByName(getCell(row, ['活动名称', 'activity_name']))
      if (!activity) continue
      const productKeys = Array.from(new Set([
        getCell(row, ['商品ID', '商品id', '商品编号']),
        getCell(row, ['product_id', 'productId']),
        getCell(row, ['item_id', 'itemId']),
      ].map(compact).filter(Boolean)))
      const skuKeys = Array.from(new Set([
        getCell(row, ['商家编码', '商家SKU编码', '货号']),
        getCell(row, ['sku_code', 'merchant_sku_code', 'outer_id']),
      ].map(compact).filter(Boolean)))
      if (!productKeys.length && !skuKeys.length) continue
      usableRows += 1
      productKeys.forEach(key => addSignupActivity(byProductId, key, activity))
      skuKeys.forEach(key => addSignupActivity(bySkuCode, key, activity))
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
    const activities = configuredActivityCatalog()
    for (const key of ['high_value', 'long_cycle']) {
      const activity = activities[key]
      if (!activity) continue
      if (activity.couponMatchers.some(pattern => pattern.test(text))) {
        return {
          activity,
          reason: '平台优惠券名匹配',
        }
      }
    }
    const configuredMatch = matchConfiguredCouponActivity(text)
    if (configuredMatch) {
      return {
        activity: toCatalogActivity(configuredMatch),
        reason: '自定义优惠券名匹配',
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

  function addUniqueText(list, value) {
    const text = compact(value)
    if (text && !list.includes(text)) list.push(text)
  }

  function promotionItemText(item) {
    if (!item || typeof item !== 'object') return ''
    return [item.name, item.label, item.type_desc, item.hover, item.amount_desc || item.value]
      .map(compact)
      .filter(Boolean)
      .join(' ')
  }

  function collectPlatformPromotionText(data) {
    const texts = []
    const roots = [
      data?.promotion_detail,
      data?.order?.promotion_detail,
      data?.product?.promotion_detail,
    ]
    for (const detail of roots) {
      if (!detail || typeof detail !== 'object') continue
      for (const item of detail.platform_discount || []) addUniqueText(texts, promotionItemText(item))
    }

    for (const item of data?.promotion || []) {
      const creator = compact(item?.extra_info_map?.activity_creator_desc || item?.activity_creator_desc)
      if (/平台优惠/.test(creator) || /平台|券|补贴|惊喜|新人|折券/.test(compact(item?.label))) {
        addUniqueText(texts, promotionItemText(item))
      }
    }

    for (const item of data?.product?.promotion || []) {
      const creator = compact(item?.extra_info_map?.activity_creator_desc || item?.activity_creator_desc)
      if (/平台优惠/.test(creator) || /平台|券|补贴|惊喜|新人|折券/.test(compact(item?.label))) {
        addUniqueText(texts, promotionItemText(item))
      }
    }

    const discountDetails = data?.product?.amount_detail_map?.discount_amount
    if (Array.isArray(discountDetails)) {
      for (const item of discountDetails) {
        if (/平台|券|补贴|惊喜|新人|折券/.test(compact(item?.label || item?.hover))) addUniqueText(texts, promotionItemText(item))
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

  function detailProducts(data) {
    if (Array.isArray(data?.order?.product_item) && data.order.product_item.length) return data.order.product_item
    if (Array.isArray(data?.product?.sku) && data.product.sku.length) return data.product.sku
    if (Array.isArray(data?.product?.sku_order_list) && data.product.sku_order_list.length) return data.product.sku_order_list
    return [{}]
  }

  function detailAmount(product, orderData, productCount) {
    const textAmount = compact(product?.pay_amount_desc || product?.combo_amount_desc || product?.total_amount_desc)
    if (textAmount) return parseAmount(textAmount)
    const centValue = product?.pay_amount ?? product?.combo_amount ?? product?.total_amount ?? product?.sku_pay_amount
    if (centValue !== undefined && centValue !== null && compact(centValue) !== '') return fromCents(centValue)
    const orderAmount = orderData?.order?.pay_amount ?? orderData?.order_base?.pay_amount ?? orderData?.product?.pay_amount
    const amount = fromCents(orderAmount)
    return productCount > 1 ? roundMoney(amount / productCount) : amount
  }

  function detailTraffic(data, listOrder) {
    const order = data?.order || {}
    const base = data?.order_base || {}
    const product = detailProducts(data)[0] || {}
    return {
      content: compact(order.content_type_desc || order.content_type || base.content_type_desc || base.content_type || product.content_type_desc || product.content_type || ''),
      channel: compact(order.compass_entrance_name || order.compass_entrance_code || base.compass_entrance_name || base.compass_entrance_code || product.compass_entrance_name || product.compass_entrance_code || ''),
      source: compact(order.c_biz_desc || base.c_biz_desc || listOrder?.c_biz_desc || order.c_biz || base.c_biz || listOrder?.c_biz || ''),
      type: compact(order.b_type_desc || base.b_type_desc || listOrder?.b_type_desc || order.b_type || base.b_type || listOrder?.b_type || ''),
    }
  }

  function normalizeDetailApiOrder(listOrder, payload, index, endpoint) {
    const data = payload?.data || {}
    const order = data.order || data.order_base || listOrder || {}
    const products = detailProducts(data)
    const couponText = collectPlatformPromotionText(data) || firstPromotionName(order?.promotion_detail || data?.promotion_detail)
    const traffic = detailTraffic(data, listOrder)
    return products.map((product, productIndex) => ({
      source: 'detail_api',
      index: index + productIndex / 1000,
      shopName: compact(params.shop_name) || readShopName(),
      orderId: compact(order?.shop_order_id || order?.order_id || data?.order_id || listOrder?.shop_order_id || listOrder?.order_id || listOrder?.id) || `DETAIL-${index + 1}`,
      itemOrderId: compact(product?.item_order_id || product?.sku_order_id || product?.order_id || ''),
      createTime: formatTime(order?.create_time || order?.pay_time || listOrder?.create_time || listOrder?.pay_time),
      productId: compact(product?.product_id || product?.pid || product?.item_id || ''),
      productName: compact(product?.product_name || product?.name || product?.title || ''),
      skuCode: compact(product?.merchant_sku_code || product?.sku_code || product?.outer_id || ''),
      amount: detailAmount(product, data, products.length),
      couponText,
      trafficContent: traffic.content,
      trafficChannel: traffic.channel,
      trafficSource: traffic.source,
      trafficType: traffic.type,
      raw: { list: listOrder, detail: data, endpoint },
    }))
  }

  function hasListPromotion(order) {
    if (!order || typeof order !== 'object') return false
    const values = [order.promotion_amount, order.envelope_promotion_amount]
    if (values.some(value => Number(value) !== 0 && Number.isFinite(Number(value)))) return true
    if (firstPromotionName(order.promotion_detail)) return true
    const orderPay = Number(order.pay_amount ?? order.actual_pay_amount ?? 0)
    const orderOriginal = Number(order.total_price ?? order.total_goods_amount ?? order.total_pay_amount ?? 0)
    if (Number.isFinite(orderPay) && Number.isFinite(orderOriginal) && orderOriginal > orderPay) return true
    const products = Array.isArray(order.product_item) ? order.product_item : []
    return products.some(product => {
      if (firstPromotionName(product?.promotion_detail) || firstPromotionName(product?.campain_detail)) return true
      const pay = Number(product?.pay_amount ?? 0)
      const original = Number(product?.combo_amount ?? product?.total_amount ?? 0)
      return Number.isFinite(pay) && Number.isFinite(original) && original > pay
    })
  }

  function listOrderAmount(order) {
    return fromCents(order?.promotion_pay_amount || order?.pay_amount || order?.pay_amount_text)
  }

  function listOrderRowCount(order) {
    const products = Array.isArray(order?.product_item) && order.product_item.length ? order.product_item : [{}]
    return products.length
  }

  function appendUnique(existing, incoming) {
    const seen = new Set((existing || []).map(compact).filter(Boolean))
    for (const value of incoming || []) {
      const text = compact(value)
      if (text) seen.add(text)
    }
    return Array.from(seen)
  }

  function signupKeysForProducts(products) {
    const productIds = []
    const skuCodes = []
    for (const product of products || []) {
      productIds.push(product.itemId, product.productId)
      skuCodes.push(product.outerId)
    }
    return {
      productIds: Array.from(new Set(productIds.map(compact).filter(Boolean))),
      skuCodes: Array.from(new Set(skuCodes.map(compact).filter(Boolean))),
    }
  }

  function shouldFetchListOrderDetail(order) {
    if (checkboxEnabled(params.include_zero_promotion_details, false)) return true
    if (!hasListPromotion(order)) return false
    return true
  }

  async function fetchJson(url, options = {}) {
    const attempts = numberParam(params.fetch_retry_attempts, 3, 1, 5)
    let lastError
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
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
      } catch (error) {
        lastError = error
        if (attempt >= attempts || !retryableFetchError(error)) break
        await sleep(300 * attempt)
      }
    }
    throw lastError
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
    const attempts = numberParam(params.fetch_retry_attempts, 3, 1, 5)
    let lastError
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetch(url, { credentials: 'include', ...options })
        const text = await response.text()
        if (!response.ok) throw new Error(`接口 HTTP ${response.status}：${url}`)
        return {
          text,
          contentType: response.headers?.get?.('content-type') || '',
        }
      } catch (error) {
        lastError = error
        if (attempt >= attempts || !retryableFetchError(error)) break
        await sleep(300 * attempt)
      }
    }
    throw lastError
  }

  function stripOrderRow(row) {
    return {
      source: row.source,
      index: row.index,
      shopName: row.shopName,
      orderId: row.orderId,
      itemOrderId: row.itemOrderId,
      createTime: row.createTime,
      productId: row.productId,
      productName: row.productName,
      skuCode: row.skuCode,
      amount: row.amount,
      couponText: row.couponText,
      trafficContent: row.trafficContent,
      trafficChannel: row.trafficChannel,
      trafficSource: row.trafficSource,
      trafficType: row.trafficType,
      detailApiError: row.detailApiError,
    }
  }

  function stripListOrder(order) {
    const products = Array.isArray(order?.product_item) ? order.product_item : []
    return {
      shop_order_id: order?.shop_order_id,
      order_id: order?.order_id,
      id: order?.id,
      create_time: order?.create_time,
      pay_time: order?.pay_time,
      pay_amount: order?.pay_amount,
      promotion_pay_amount: order?.promotion_pay_amount,
      promotion_amount: order?.promotion_amount,
      envelope_promotion_amount: order?.envelope_promotion_amount,
      total_price: order?.total_price,
      total_goods_amount: order?.total_goods_amount,
      total_pay_amount: order?.total_pay_amount,
      actual_pay_amount: order?.actual_pay_amount,
      promotion_detail: order?.promotion_detail,
      b_type_desc: order?.b_type_desc,
      c_biz_desc: order?.c_biz_desc,
      ad_mark_desc: order?.ad_mark_desc,
      b_type: order?.b_type,
      c_biz: order?.c_biz,
      ad_mark: order?.ad_mark,
      product_item: products.map(product => ({
        item_order_id: product?.item_order_id,
        order_id: product?.order_id,
        product_id: product?.product_id,
        pid: product?.pid,
        product_name: product?.product_name,
        name: product?.name,
        merchant_sku_code: product?.merchant_sku_code,
        sku_code: product?.sku_code,
        pay_amount: product?.pay_amount,
        combo_amount: product?.combo_amount,
        total_amount: product?.total_amount,
        promotion_detail: product?.promotion_detail,
        campain_detail: product?.campain_detail,
      })),
    }
  }

  function stripSignupProduct(product) {
    return {
      itemId: product.itemId,
      productId: product.productId,
      name: product.name,
      outerId: product.outerId,
      shopId: product.shopId,
      applySuccessAt: product.applySuccessAt,
      status: product.status,
    }
  }

  function activityKeywords() {
    const values = splitValues(params.activity_keywords || params.keywords || '')
    return values.length ? values : ['混资']
  }

  function feedActivityList(payload) {
    const data = payload?.data
    if (Array.isArray(data?.data)) return data.data
    if (Array.isArray(data?.list)) return data.list
    if (Array.isArray(data)) return data
    return []
  }

  function compactSignupActivity(item) {
    const main = {
      activityId: deepPick(item, ['activity_id', 'act_id', 'id']),
      name: deepPick(item, ['activity_name', 'act_name', 'main_act_name', 'name', 'title']),
      startTime: deepPick(item, ['start_time', 'activity_start_time', 'apply_start_time']),
      endTime: deepPick(item, ['end_time', 'activity_end_time', 'apply_end_time']),
      status: deepPick(item, ['status', 'apply_status', 'act_status', 'button_text', 'apply_status_text']),
    }
    const rawSubActs = Array.isArray(item?.sub_acts)
      ? item.sub_acts
      : Array.isArray(item?.feed_act?.sub_acts)
        ? item.feed_act.sub_acts
        : []
    const subActs = rawSubActs.map(sub => ({
      activityId: deepPick(sub, ['activity_id', 'act_id', 'id']) || main.activityId,
      name: deepPick(sub, ['activity_name', 'act_name', 'name', 'title']) || main.name,
      startTime: deepPick(sub, ['start_time', 'activity_start_time', 'apply_start_time']) || main.startTime,
      endTime: deepPick(sub, ['end_time', 'activity_end_time', 'apply_end_time']) || main.endTime,
      status: deepPick(sub, ['status', 'apply_status', 'act_status', 'button_text', 'apply_status_text']) || main.status,
    })).filter(activity => activity.activityId || activity.name)

    const activities = subActs.length ? subActs : [main]
    return {
      parent: main,
      activities: activities.filter(activity => activity.activityId || activity.name),
    }
  }

  function targetSignupActivity(activity, parent, entranceKeyword, activityById = MIXED_FUND_ENTRANCE_BY_ID) {
    const id = compact(activity.activityId || activity.id)
    const target = activityById.get(id)
    if (!target) return null
    return {
      activityId: target.activityId,
      name: compact(activity.name) || target.name,
      parentActivityId: compact(activity.parentActivityId || parent?.activityId) || target.parentActivityId,
      parentName: compact(activity.parentName || parent?.name) || target.parentName,
      startTime: activity.startTime || target.startTime || '',
      endTime: activity.endTime || target.endTime || '',
      status: activity.status || target.status || '',
      entranceKeyword: compact(entranceKeyword) || '固定入口',
      couponName: target.couponName,
      entranceUrl: target.entranceUrl,
    }
  }

  async function querySignupActivities() {
    const now = Math.floor(Date.now() / 1000)
    const pageSize = 20
    const configured = configuredActivities()
    const configuredById = new Map(configured.map(activity => [activity.activityId, activity]))
    const seen = new Map()
    for (const activity of configured) {
      seen.set(activity.activityId, {
        ...activity,
        entranceKeyword: activity.entranceKeyword || '固定入口',
      })
    }
    for (const keyword of activityKeywords()) {
      let fetched = 0
      for (let page = 1; ; page += 1) {
        const body = {
          page,
          page_size: pageSize,
          condition: {
            participate_tab: 1,
            is_collection: false,
            intro_industry_items: [],
            keyword_ids: [],
            activity_name: keyword,
            act_time_period: { end_time_lower: now },
            apply_time_period: { start_time_upper: now },
          },
        }
        const payload = await postJson('/mmc/activity/seller_activity_feed?', body)
        if (!payload || (payload.code !== undefined && Number(payload.code) !== 0) || (payload.st !== undefined && Number(payload.st) !== 0)) {
          throw new Error(`活动列表接口失败：${payload?.msg || payload?.message || keyword}`)
        }
        const list = feedActivityList(payload)
        const total = Number(payload?.data?.total || payload?.total || list.length || 0)
        fetched += list.length
        for (const raw of list) {
          const group = compactSignupActivity(raw)
          for (const activity of group.activities) {
            const target = targetSignupActivity(activity, group.parent, keyword, configuredById)
            if (target) seen.set(target.activityId, target)
          }
        }
        if (!list.length) break
        if (total > 0 ? fetched >= total : list.length < pageSize) break
      }
    }
    return configured.map(activity => seen.get(activity.activityId) || activity)
  }

  async function querySignupActivityPage(keyword, page, pageSize) {
    const now = Math.floor(Date.now() / 1000)
    const body = {
      page,
      page_size: pageSize,
      condition: {
        participate_tab: 1,
        is_collection: false,
        intro_industry_items: [],
        keyword_ids: [],
        activity_name: keyword,
        act_time_period: { end_time_lower: now },
        apply_time_period: { start_time_upper: now },
      },
    }
    const payload = await postJson('/mmc/activity/seller_activity_feed?', body)
    if (!payload || (payload.code !== undefined && Number(payload.code) !== 0) || (payload.st !== undefined && Number(payload.st) !== 0)) {
      throw new Error(`活动列表接口失败：${payload?.msg || payload?.message || keyword}`)
    }
    const list = feedActivityList(payload)
    return {
      list,
      total: Number(payload?.data?.total || payload?.total || list.length || 0),
    }
  }

  function targetActivitiesFromFeed(list, keyword) {
    const targets = []
    for (const raw of list || []) {
      const group = compactSignupActivity(raw)
      for (const activity of group.activities) {
        const target = targetSignupActivity(activity, group.parent, keyword, configuredActivityById())
        if (target) targets.push(target)
      }
    }
    return targets
  }

  function signupProductListBody(activityId, page, size) {
    return {
      activity_id: activityId,
      product_list_type: 1,
      product_cond: {
        status_type: 1,
        status_list: [8],
      },
      filter_condition: {
        filter_applied: false,
        filter_not_applied: true,
        not_need_control_price: true,
        not_need_estimate_price: true,
        not_need_left_stock: true,
        not_need_low_price: true,
        not_need_past_act_indicator: true,
        not_need_item_indicator: true,
        not_need_project_related_info: true,
        not_need_summary_desc_info: true,
        not_need_data_codes: ['overlap_list'],
        need_product_stock_warning_info: true,
      },
      channel_prod_condition: {},
      page,
      size,
    }
  }

  function normalizeSignupProduct(row) {
    const info = row?.applied_product_info || row?.product_info || row || {}
    const item = info.item_info || info.product_info || {}
    const itemId = compact(info.item_id || info.product_id || item.item_id || item.product_id || item.id)
    return {
      itemId,
      productId: compact(item.product_id || info.product_id || itemId),
      name: compact(info.item_name || info.product_name || item.product_name || item.name || item.title),
      outerId: compact(info.outer_id || info.merchant_sku_code || item.outer_id || item.merchant_sku_code || item.code),
      shopId: compact(info.shop_id || row?.shop_id),
      applySuccessAt: info.apply_success_at || info.apply_time || info.create_time || '',
      status: compact(info.status || info.apply_status || info.bargain_status || ''),
      businessStatus: compact(info.status_for_business || ''),
      raw: info,
    }
  }

  function signupStatus(product) {
    if (compact(product.businessStatus) === '8') return '报名成功'
    if (product.applySuccessAt) return '报名成功'
    if (['200', '3', 'success'].includes(compact(product.status).toLowerCase())) return '已报名'
    return product.status || ''
  }

  async function queryAppliedProducts(activity, options) {
    if (!activity.activityId) return { total: 0, rows: [], fetched: 0, note: '缺少活动ID' }
    const pageSize = options.pageSize
    const rows = []
    let total = 0
    let fetched = 0
    for (let page = 1; ; page += 1) {
      const payload = await postJson('/mmc/apply/all_product_list?', signupProductListBody(activity.activityId, page, pageSize))
      if (payload.code !== undefined && Number(payload.code) !== 0) {
        if (page === 1 && /报名主体不存在/.test(compact(payload.msg || payload.message))) {
          return { total: 0, rows: [], fetched: 0, note: compact(payload.msg || payload.message) }
        }
        throw new Error(`报名商品接口失败：${activity.name || activity.activityId} ${payload.msg || payload.message || payload.code}`)
      }
      const data = payload.data || {}
      const list = Array.isArray(data.product_list) ? data.product_list : []
      if (page === 1) total = Number(data.total || list.length || 0) || 0
      for (const item of list) rows.push(normalizeSignupProduct(item))
      fetched += list.length
      if (!list.length) break
      if (total > 0 ? fetched >= total : list.length < pageSize) break
    }
    return { total, rows, fetched, note: '' }
  }

  async function queryAppliedProductsPage(activity, page, pageSize) {
    if (!activity.activityId) return { total: 0, rows: [], fetched: 0, note: '缺少活动ID' }
    const payload = await postJson('/mmc/apply/all_product_list?', signupProductListBody(activity.activityId, page, pageSize))
    if (payload.code !== undefined && Number(payload.code) !== 0) {
      if (page === 1 && /报名主体不存在/.test(compact(payload.msg || payload.message))) {
        return { total: 0, rows: [], fetched: 0, note: compact(payload.msg || payload.message) }
      }
      throw new Error(`报名商品接口失败：${activity.name || activity.activityId} ${payload.msg || payload.message || payload.code}`)
    }
    const data = payload.data || {}
    const list = Array.isArray(data.product_list) ? data.product_list : []
    return {
      total: Number(data.total || list.length || 0) || 0,
      rows: list.map(item => stripSignupProduct(normalizeSignupProduct(item))),
      fetched: list.length,
      note: '',
    }
  }

  function signupBaseRow({ shopName, brand, activity, scrapeTime, applied }) {
    return {
      平台名称: '抖店',
      品牌: brand,
      店铺名称: shopName,
      父活动ID: activity.parentActivityId || '',
      父活动名称: activity.parentName || '',
      活动ID: activity.activityId || '',
      活动名称: activity.name || '',
      活动入口: activity.entranceKeyword || '',
      活动链接: activity.entranceUrl || '',
      优惠券名称: activity.couponName || '',
      活动开始时间: formatTime(activity.startTime),
      活动结束时间: formatTime(activity.endTime),
      报名商品数: applied.total || 0,
      已拉取明细数: applied.fetched || 0,
      抓取时间: scrapeTime,
    }
  }

  async function collectSignupSnapshot() {
    const pageSize = numberParam(params.detail_page_size || params.signup_detail_page_size, 50, 1, 100)
    const shopName = compact(params.shop_name) || readShopName()
    const fallbackBrand = inferBrand(shopName)
    const scrapeTime = today()
    const activities = await querySignupActivities()
    const data = []
    const detailRows = []
    let appliedProductTotal = 0

    for (const activity of activities) {
      const applied = await queryAppliedProducts(activity, { pageSize })
      appliedProductTotal += applied.total || 0
      const brand = inferBrand(activity.name) || inferBrand(activity.parentName) || fallbackBrand
      const base = signupBaseRow({ shopName, brand, activity, scrapeTime, applied })
      data.push({
        __sheet_name: '报名汇总',
        ...base,
        备注: applied.note || '',
      })

      const seenProducts = new Set()
      for (const product of applied.rows) {
        const productKey = `${activity.activityId}::${product.itemId || product.productId || product.name}`
        if (seenProducts.has(productKey)) continue
        seenProducts.add(productKey)
        const detailRow = {
          __sheet_name: '报名商品明细',
          ...base,
          商品ID: product.itemId || product.productId,
          商品名称: product.name,
          商家编码: product.outerId,
          店铺ID: product.shopId,
          报名状态: signupStatus(product),
          报名成功时间: formatTime(product.applySuccessAt),
          activity_id: activity.activityId || '',
          activity_name: activity.name || '',
          product_id: product.productId,
          item_id: product.itemId,
          sku_code: product.outerId,
          outer_id: product.outerId,
        }
        detailRows.push(detailRow)
        data.push(detailRow)
      }
    }

    return {
      data,
      detailRows,
      shared: {
        signup_auto_collected: true,
        signup_activity_count: new Set(activities.map(item => item.parentActivityId || item.activityId || item.parentName)).size,
        signup_sub_activity_count: activities.length,
        signup_applied_product_total: appliedProductTotal,
        signup_auto_detail_rows: detailRows.length,
        signup_activity_scope: activityScope() === 'custom' ? 'custom' : 'default',
        signup_target_activity_ids: activities.map(item => item.activityId).join(','),
        signup_keywords: activityKeywords().join(','),
      },
    }
  }

  function signupRowsForActivity(activity, products, applied, context) {
    const rows = []
    const detailRows = []
    const brand = inferBrand(activity.name) || inferBrand(activity.parentName) || context.fallbackBrand
    const base = signupBaseRow({
      shopName: context.shopName,
      brand,
      activity,
      scrapeTime: context.scrapeTime,
      applied,
    })
    rows.push({
      __sheet_name: '报名汇总',
      ...base,
      备注: applied.note || '',
    })

    const seenProducts = new Set()
    for (const product of products || []) {
      const productKey = `${activity.activityId}::${product.itemId || product.productId || product.name}`
      if (seenProducts.has(productKey)) continue
      seenProducts.add(productKey)
      const detailRow = {
        __sheet_name: '报名商品明细',
        ...base,
        商品ID: product.itemId || product.productId,
        商品名称: product.name,
        商家编码: product.outerId,
        店铺ID: product.shopId,
        报名状态: signupStatus(product),
        报名成功时间: formatTime(product.applySuccessAt),
        activity_id: activity.activityId || '',
        activity_name: activity.name || '',
        product_id: product.productId,
        item_id: product.itemId,
        sku_code: product.outerId,
        outer_id: product.outerId,
      }
      detailRows.push(detailRow)
      rows.push(detailRow)
    }
    return { rows, detailRows }
  }

  function searchlistTimeRange() {
    const start = compact(params.start_time) || (params.start_date ? String(dateToUnix(params.start_date, false)) : '')
    const end = compact(params.end_time) || (params.end_date ? String(dateToUnix(params.end_date, true)) : '')
    return { start, end }
  }

  function splitTimeRange(range, parts) {
    const start = Number(range?.start || 0)
    const end = Number(range?.end || 0)
    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0 || end < start || parts <= 1) {
      return [range]
    }
    const output = []
    const span = end - start + 1
    const step = Math.ceil(span / parts)
    for (let cursor = start; cursor <= end; cursor += step) {
      output.push({
        start: String(cursor),
        end: String(Math.min(end, cursor + step - 1)),
      })
    }
    return output
  }

  function orderTimeWindows() {
    const range = searchlistTimeRange()
    const start = Number(range.start || 0)
    const end = Number(range.end || 0)
    if (!start || !end || end < start) return [range]
    if (!params.order_window_days) return [range]
    const windowDays = numberParam(params.order_window_days, 31, 1, 31)
    const seconds = windowDays * 86400
    const windows = []
    for (let cursor = start; cursor <= end; cursor += seconds) {
      windows.push({
        start: String(cursor),
        end: String(Math.min(end, cursor + seconds - 1)),
      })
    }
    return windows
  }

  async function queryOrderListRaw() {
    const pageSize = numberParam(params.page_size, 50, 1, 100)
    const orders = []
    const timeRange = searchlistTimeRange()
    for (let page = 0; ; page += 1) {
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
      if (timeRange.start) query.set('create_time_start', timeRange.start)
      if (timeRange.end) query.set('create_time_end', timeRange.end)
      const payload = await fetchJson(`/api/order/searchlist?${query.toString()}`, { credentials: 'include' })
      if (payload.code !== undefined && Number(payload.code) !== 0) {
        throw new Error(`订单列表接口失败：${payload.msg || payload.message || payload.code}`)
      }
      const list = Array.isArray(payload.data) ? payload.data : Array.isArray(payload?.data?.data) ? payload.data.data : []
      orders.push(...list)
      const total = Number(payload.total || payload?.data?.total || list.length || 0)
      if (!list.length) break
      if (total > 0 ? orders.length >= total : list.length < pageSize) break
    }
    return orders
  }

  async function queryOrderListPage(page, pageSize, timeRange = searchlistTimeRange(), filters = {}) {
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
    if (timeRange.start) query.set('create_time_start', timeRange.start)
    if (timeRange.end) query.set('create_time_end', timeRange.end)
    if (compact(filters.product)) query.set('product', compact(filters.product))
    if (compact(filters.artNo)) query.set('art_no', compact(filters.artNo))
    const payload = await fetchJson(`/api/order/searchlist?${query.toString()}`, { credentials: 'include' })
    if (payload.code !== undefined && Number(payload.code) !== 0) {
      throw new Error(`订单列表接口失败：${payload.msg || payload.message || payload.code}`)
    }
    const list = Array.isArray(payload.data) ? payload.data : Array.isArray(payload?.data?.data) ? payload.data.data : []
    return {
      list,
      total: Number(payload.total || payload?.data?.total || list.length || 0),
    }
  }

  async function queryOrdersFromApi() {
    const list = await queryOrderListRaw()
    const rows = []
    list.forEach((order, index) => rows.push(...normalizeApiOrder(order, index)))
    return rows
  }

  async function fetchOrderDetail(orderId) {
    const id = compact(orderId)
    if (!id) return null
    const urls = [
      `/api/order/detail?order_id=${encodeURIComponent(id)}&shop_order_id=${encodeURIComponent(id)}&orderId=${encodeURIComponent(id)}&appid=1&_bid=ffa_order&aid=4272`,
      `/api/order/orderDetail?order_id=${encodeURIComponent(id)}&appid=1&_bid=ffa_order&aid=4272`,
    ]
    let lastError = ''
    for (const url of urls) {
      try {
        const payload = await fetchJson(url, { credentials: 'include' })
        if (payload.code !== undefined && Number(payload.code) !== 0) {
          lastError = payload.msg || payload.message || String(payload.code)
          continue
        }
        return { payload, endpoint: url.split('?')[0] }
      } catch (error) {
        lastError = String(error?.message || error)
      }
    }
    throw new Error(`订单详情接口失败：${id} ${lastError}`)
  }

  async function queryOrdersFromDetailApi() {
    const list = await queryOrderListRaw()
    const includeZeroPromotion = checkboxEnabled(params.include_zero_promotion_details, false)
    const rows = []
    let detailApiOrders = 0
    let detailApiErrors = 0

    for (let index = 0; index < list.length; index += 1) {
      const order = list[index]
      const orderId = compact(order?.shop_order_id || order?.order_id || order?.id)
      const shouldFetchDetail = orderId && (includeZeroPromotion || hasListPromotion(order))
      if (!shouldFetchDetail) {
        rows.push(...normalizeApiOrder(order, index))
        continue
      }

      try {
        const detail = await fetchOrderDetail(orderId)
        detailApiOrders += 1
        rows.push(...normalizeDetailApiOrder(order, detail.payload, index, detail.endpoint))
      } catch (error) {
        detailApiErrors += 1
        const fallbackRows = normalizeApiOrder(order, index)
        fallbackRows.forEach(row => {
          row.detailApiError = String(error?.message || error)
        })
        rows.push(...fallbackRows)
      }
    }

    return {
      rows,
      shared: {
        detail_api_orders: detailApiOrders,
        detail_api_errors: detailApiErrors,
      },
    }
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

  function replay(rows, options = {}) {
    const scrapeTime = today()
    const data = []
    const prefixRows = Array.isArray(options.prefixRows) ? options.prefixRows : []
    const allRows = uniqueRows(rows)
    const mixedRows = []
    const activityMap = new Map()
    const productCardChannelMap = new Map()
    const productMap = new Map()
    const hasPrecomputedAll = Number.isFinite(Number(options.orderAmountSum)) || Number.isFinite(Number(options.orderRowCount))
    let allAmount = hasPrecomputedAll ? Number(options.orderAmountSum || 0) : 0
    let mixedAmount = 0
    let productCardAmount = 0
    let exportFieldsPresent = false
    let couponFieldsPresent = false
    let trafficFieldsPresent = false
    const signupIndex = buildSignupActivityIndex(options.signupRows)
    const matchStats = {
      surpriseSignupMatched: 0,
      surpriseDefaulted: 0,
      surpriseAmbiguous: 0,
    }

    for (const row of allRows) {
      if (!hasPrecomputedAll) allAmount += row.amount
      if (row.source === 'export' && (row.couponText || row.trafficContent || row.trafficChannel)) exportFieldsPresent = true
      if (row.couponText) couponFieldsPresent = true
      if (row.trafficContent || (row.source !== 'api' && row.trafficChannel)) trafficFieldsPresent = true
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
      备注: outputFieldNote(exportFieldsPresent, couponFieldsPresent, trafficFieldsPresent),
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
      data: prefixRows.length ? [...prefixRows, ...data] : data,
      shared: {
        order_rows: hasPrecomputedAll ? Number(options.orderRowCount || allRows.length) : allRows.length,
        mixed_fund_rows: mixedRows.length,
        mixed_fund_amount: roundMoney(mixedAmount),
        product_card_amount: roundMoney(productCardAmount),
        export_fields_present: exportFieldsPresent,
        coupon_fields_present: couponFieldsPresent,
        traffic_fields_present: trafficFieldsPresent,
        signup_match_rows: signupIndex.rows,
        signup_match_keys: signupIndex.keyCount,
        surprise_signup_matched_rows: matchStats.surpriseSignupMatched,
        surprise_defaulted_rows: matchStats.surpriseDefaulted,
        surprise_ambiguous_rows: matchStats.surpriseAmbiguous,
        field_note: outputFieldNote(exportFieldsPresent, couponFieldsPresent, trafficFieldsPresent),
      },
    }
  }

  function outputFieldNote(exportFieldsPresent, couponFieldsPresent, trafficFieldsPresent) {
    if (exportFieldsPresent && trafficFieldsPresent) return ''
    if (couponFieldsPresent && !trafficFieldsPresent) {
      return '订单详情 API 已返回平台优惠，可完成混资订单归因；流量体裁/流量渠道未在订单详情中返回，商品卡渠道指标需后续接入罗盘聚合接口补齐。'
    }
    return '订单列表 API 未返回平台优惠/流量体裁/流量渠道；请选择订单详情 API 模式或上传官方订单导出文件补齐归因字段。'
  }

  function nextPhaseResult(nextPhase, nextShared, sleepMs = 80) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'next_phase',
        next_phase: nextPhase,
        sleep_ms: sleepMs,
        has_more: true,
        shared: nextShared,
      },
    }
  }

  function stableActivities(activities) {
    return (activities || []).map(activity => ({
      activityId: activity.activityId || '',
      name: activity.name || '',
      startTime: activity.startTime || '',
      endTime: activity.endTime || '',
      status: activity.status || '',
      parentActivityId: activity.parentActivityId || '',
      parentName: activity.parentName || '',
      entranceKeyword: activity.entranceKeyword || '',
      couponName: activity.couponName || '',
      entranceUrl: activity.entranceUrl || '',
    }))
  }

  function upsertActivities(existing, incoming) {
    const map = new Map()
    for (const activity of existing || []) {
      const key = compact(activity.activityId || activity.name)
      if (compact(key.replace('::', ''))) map.set(key, activity)
    }
    for (const activity of incoming || []) {
      const key = compact(activity.activityId || activity.name)
      if (compact(key.replace('::', ''))) map.set(key, { ...(map.get(key) || {}), ...activity })
    }
    return Array.from(map.values())
  }

  function oneFlowBaseShared() {
    const shopName = compact(params.shop_name) || readShopName()
    const signupActivities = configuredActivities()
    return {
      ...shared,
      one_flow: true,
      data_source: 'detail_api',
      current_source_filename: '一体化订单详情API',
      shop_name: shopName,
      signup_context: {
        shopName,
        fallbackBrand: inferBrand(shopName),
        scrapeTime: today(),
      },
      signup_keywords_list: activityKeywords(),
      signup_keyword_index: 0,
      signup_activity_page: 1,
      signup_activity_page_size: 20,
      signup_activity_scope: activityScope() === 'custom' ? 'custom' : 'default',
      signup_target_activity_ids: signupActivities.map(activity => activity.activityId).join(','),
      signup_activities: stableActivities(signupActivities.map(activity => ({
        ...activity,
        entranceKeyword: activity.entranceKeyword || '固定入口',
      }))),
      signup_activity_total_fetched: 0,
      signup_product_activity_index: 0,
      signup_product_page: 1,
      signup_data_rows: [],
      signup_detail_rows: [],
      signup_applied_product_total: 0,
      signup_product_ids: [],
      signup_sku_codes: [],
      order_search_items: [],
      order_search_index: 0,
      order_time_windows: orderTimeWindows(),
      order_window_index: 0,
      order_window_done_count: 0,
      order_window_fetched: 0,
      order_page: 0,
      order_page_size: numberParam(params.page_size, 50, 1, 100),
      order_total: 0,
      order_list_fetched: 0,
      order_row_count: 0,
      order_amount_sum: 0,
      order_aggregate_ids: [],
      order_rows: [],
      detail_candidates: [],
      detail_candidate_ids: [],
      detail_cursor: 0,
      detail_api_orders: 0,
      detail_api_errors: 0,
      list_total_rows: 0,
      list_completed_rows: 0,
      detail_total_targets: 0,
      detail_completed_targets: 0,
    }
  }

  async function oneFlowInitPhase() {
    const initial = oneFlowBaseShared()
    if (checkboxEnabled(params.auto_signup_match, true)) return nextPhaseResult('collect_signup_activity_page', initial)
    return nextPhaseResult('collect_order_list_page', {
      ...initial,
      signup_auto_collected: false,
      signup_skipped: true,
    })
  }

  async function collectSignupActivityPagePhase() {
    const keywords = Array.isArray(shared.signup_keywords_list) && shared.signup_keywords_list.length ? shared.signup_keywords_list : activityKeywords()
    const keywordIndex = Number(shared.signup_keyword_index || 0)
    const keyword = keywords[keywordIndex]
    if (!keyword) {
      return nextPhaseResult('collect_signup_products_page', {
        ...shared,
        signup_product_activity_index: 0,
        signup_product_page: 1,
        signup_sub_activity_count: (shared.signup_activities || []).length,
      })
    }
    const page = Number(shared.signup_activity_page || 1)
    const pageSize = Number(shared.signup_activity_page_size || 20)
    const result = await querySignupActivityPage(keyword, page, pageSize)
    const activities = upsertActivities(shared.signup_activities || [], stableActivities(targetActivitiesFromFeed(result.list, keyword)))
    const fetched = Number(shared.signup_activity_total_fetched || 0) + result.list.length
    const keywordDone = !result.list.length || (result.total > 0 ? fetched >= result.total : result.list.length < pageSize)
    return nextPhaseResult('collect_signup_activity_page', {
      ...shared,
      signup_activities: activities,
      signup_activity_total_fetched: keywordDone ? 0 : fetched,
      signup_keyword_index: keywordDone ? keywordIndex + 1 : keywordIndex,
      signup_activity_page: keywordDone ? 1 : page + 1,
      signup_activity_count: new Set(activities.map(item => item.parentActivityId || item.activityId || item.parentName)).size,
      signup_sub_activity_count: activities.length,
    })
  }

  async function collectSignupProductsPagePhase() {
    const activities = Array.isArray(shared.signup_activities) ? shared.signup_activities : []
    const activityIndex = Number(shared.signup_product_activity_index || 0)
    const activity = activities[activityIndex]
    if (!activity) {
      return nextPhaseResult('collect_order_list_page', {
        ...shared,
        signup_auto_collected: true,
        signup_auto_detail_rows: (shared.signup_detail_rows || []).length,
        signup_keywords: activityKeywords().join(','),
        order_search_items: [],
        order_search_item_count: 0,
        order_search_scope: 'date_range',
      })
    }

    const page = Number(shared.signup_product_page || 1)
    const pageSize = numberParam(params.detail_page_size || params.signup_detail_page_size, 50, 1, 100)
    const appliedPage = await queryAppliedProductsPage(activity, page, pageSize)
    const pendingProducts = [
      ...((shared.signup_current_products || []).map(stripSignupProduct)),
      ...appliedPage.rows,
    ]
    const fetched = Number(shared.signup_current_fetched || 0) + appliedPage.fetched
    const total = Number(appliedPage.total || shared.signup_current_total || 0)
    const done = !appliedPage.fetched || (total > 0 ? fetched >= total : appliedPage.fetched < pageSize)

    if (!done) {
      return nextPhaseResult('collect_signup_products_page', {
        ...shared,
        signup_current_products: pendingProducts,
        signup_current_fetched: fetched,
        signup_current_total: total,
        signup_product_page: page + 1,
      })
    }

    const context = shared.signup_context || {}
    const applied = {
      total,
      fetched,
      note: appliedPage.note || '',
    }
    const rows = signupRowsForActivity(activity, pendingProducts, applied, {
      shopName: context.shopName || readShopName(),
      fallbackBrand: context.fallbackBrand || inferBrand(context.shopName || ''),
      scrapeTime: context.scrapeTime || today(),
    })
    const keys = signupKeysForProducts(pendingProducts)
    return nextPhaseResult('collect_signup_products_page', {
      ...shared,
      signup_data_rows: [...(shared.signup_data_rows || []), ...rows.rows],
      signup_detail_rows: [...(shared.signup_detail_rows || []), ...rows.detailRows],
      signup_applied_product_total: Number(shared.signup_applied_product_total || 0) + total,
      signup_product_ids: appendUnique(shared.signup_product_ids || [], keys.productIds),
      signup_sku_codes: appendUnique(shared.signup_sku_codes || [], keys.skuCodes),
      signup_product_activity_index: activityIndex + 1,
      signup_product_page: 1,
      signup_current_products: [],
      signup_current_fetched: 0,
      signup_current_total: 0,
    })
  }

  async function collectOrderListPagePhase() {
    let nextShared = { ...shared }
    const startedAt = Date.now()
    const maxRequests = numberParam(params.order_list_phase_requests, 20, 1, 50)
    const maxMs = numberParam(params.order_list_phase_ms, 8000, 1000, 15000)
    const pageSize = Number(nextShared.order_page_size || numberParam(params.page_size, 50, 1, 100))
    const rows = []
    const candidates = []
    const seenCandidateIds = new Set((nextShared.detail_candidate_ids || []).map(compact).filter(Boolean))
    const seenAggregateIds = new Set((nextShared.order_aggregate_ids || []).map(compact).filter(Boolean))
    let windows = Array.isArray(nextShared.order_time_windows) && nextShared.order_time_windows.length ? nextShared.order_time_windows : orderTimeWindows()
    let processed = 0

    while (processed < maxRequests && Date.now() - startedAt < maxMs) {
      let windowIndex = Number(nextShared.order_window_index || 0)
      let currentWindow = windows[windowIndex]
      if (!currentWindow) break

      const page = Number(nextShared.order_page || 0)
      const result = await queryOrderListPage(page, pageSize, currentWindow)
      processed += 1
      const listOrders = result.list.map(stripListOrder)
      let amountSum = Number(nextShared.order_amount_sum || 0)
      let rowCount = Number(nextShared.order_row_count || 0)
      const baseFetched = Number(nextShared.order_list_fetched || 0)

      for (let index = 0; index < listOrders.length; index += 1) {
        const order = listOrders[index]
        const globalIndex = baseFetched + index
        const orderId = compact(order?.shop_order_id || order?.order_id || order?.id)
        const productRowCount = listOrderRowCount(order)
        const aggregateKey = orderId || `all:${currentWindow.start}:${currentWindow.end}:${page}:${index}`
        if (!seenAggregateIds.has(aggregateKey)) {
          seenAggregateIds.add(aggregateKey)
          rowCount += productRowCount
          amountSum += listOrderAmount(order)
        }
        if (orderId && shouldFetchListOrderDetail(order)) {
          if (!seenCandidateIds.has(orderId)) {
            seenCandidateIds.add(orderId)
            candidates.push({ order, index: globalIndex, orderId })
          }
        } else {
          rows.push(...normalizeApiOrder(order, globalIndex).map(stripOrderRow))
        }
      }

      const windowFetched = Number(nextShared.order_window_fetched || 0) + listOrders.length
      const fetched = baseFetched + listOrders.length
      const total = Number(result.total || nextShared.order_total || 0)
      if (page === 0 && total > 0) {
        const maxWindowRows = numberParam(params.order_window_max_rows, 20000, 1000, 50000)
        if (total > maxWindowRows) {
          const splitParts = Math.ceil(total / maxWindowRows)
          const replacement = splitTimeRange(currentWindow, splitParts)
          if (replacement.length > 1) {
            windows = [
              ...windows.slice(0, windowIndex),
              ...replacement,
              ...windows.slice(windowIndex + 1),
            ]
            nextShared = {
              ...nextShared,
              order_time_windows: windows,
              order_page: 0,
              order_total: 0,
              order_window_fetched: 0,
            }
            continue
          }
        }
      }

      const done = !listOrders.length || (total > 0 ? windowFetched >= total : listOrders.length < pageSize)
      windowIndex = done ? windowIndex + 1 : windowIndex
      nextShared = {
        ...nextShared,
        order_time_windows: windows,
        order_search_index: 0,
        order_search_item_count: 0,
        order_search_scope: 'date_range',
        order_current_search_type: '',
        order_current_search_value: '',
        order_window_index: windowIndex,
        order_window_done_count: done ? Number(nextShared.order_window_done_count || 0) + 1 : Number(nextShared.order_window_done_count || 0),
        order_current_window_start: currentWindow.start,
        order_current_window_end: currentWindow.end,
        order_total: total,
        order_list_fetched: fetched,
        order_window_fetched: done ? 0 : windowFetched,
        order_page: done ? 0 : page + 1,
        order_row_count: rowCount,
        order_amount_sum: roundMoney(amountSum),
        list_total_rows: Number(nextShared.order_row_count || 0) + (total || listOrders.length || 0),
        list_completed_rows: rowCount,
      }
    }

    const complete = Boolean(!windows[Number(nextShared.order_window_index || 0)])
    return nextPhaseResult(complete ? 'collect_order_detail_batch' : 'collect_order_list_page', {
      ...nextShared,
      order_aggregate_ids: Array.from(seenAggregateIds),
      order_rows: [...(nextShared.order_rows || []), ...rows],
      detail_candidates: [...(nextShared.detail_candidates || []), ...candidates],
      detail_candidate_ids: Array.from(seenCandidateIds),
      list_total_rows: Number(nextShared.list_total_rows || nextShared.order_row_count || nextShared.order_list_fetched || 0),
      list_completed_rows: Number(nextShared.order_row_count || nextShared.order_list_fetched || 0),
      detail_total_targets: (nextShared.detail_candidates || []).length + candidates.length,
    })
  }

  async function collectOrderDetailBatchPhase() {
    const candidates = Array.isArray(shared.detail_candidates) ? shared.detail_candidates : []
    const cursor = Number(shared.detail_cursor || 0)
    const batchSize = numberParam(params.detail_batch_size, 50, 1, 50)
    const end = Math.min(cursor + batchSize, candidates.length)
    const rows = []
    let detailApiOrders = Number(shared.detail_api_orders || 0)
    let detailApiErrors = Number(shared.detail_api_errors || 0)

    for (let index = cursor; index < end; index += 1) {
      const candidate = candidates[index]
      try {
        const detail = await fetchOrderDetail(candidate.orderId)
        detailApiOrders += 1
        rows.push(...normalizeDetailApiOrder(candidate.order, detail.payload, candidate.index, detail.endpoint).map(stripOrderRow))
      } catch (error) {
        detailApiErrors += 1
        const fallbackRows = normalizeApiOrder(candidate.order, candidate.index)
        fallbackRows.forEach(row => {
          row.detailApiError = String(error?.message || error)
        })
        rows.push(...fallbackRows.map(stripOrderRow))
      }
    }

    const nextCursor = end
    return nextPhaseResult(nextCursor >= candidates.length ? 'finalize_one_flow' : 'collect_order_detail_batch', {
      ...shared,
      order_rows: [...(shared.order_rows || []), ...rows],
      detail_cursor: nextCursor,
      detail_api_orders: detailApiOrders,
      detail_api_errors: detailApiErrors,
      detail_total_targets: candidates.length,
      detail_completed_targets: nextCursor,
      detail_current_target_index: nextCursor,
      detail_current_target: candidates[nextCursor]?.orderId || '',
    })
  }

  async function finalizeOneFlowPhase() {
    const rows = Array.isArray(shared.order_rows) ? shared.order_rows : []
    if (!rows.length && !Number(shared.order_row_count || 0)) {
      return {
        success: false,
        error: '订单列表接口未返回订单数据。',
        meta: { has_more: false },
      }
    }
    const result = replay(rows, {
      signupRows: shared.signup_detail_rows || [],
      prefixRows: checkboxEnabled(params.include_signup_snapshot, true) ? (shared.signup_data_rows || []) : [],
      orderRowCount: shared.order_row_count,
      orderAmountSum: shared.order_amount_sum,
    })
    return {
      success: true,
      data: result.data,
      meta: {
        has_more: false,
        shared: {
          ...shared,
          ...result.shared,
          signup_auto_collected: Boolean(shared.signup_auto_collected),
          signup_activity_count: shared.signup_activity_count || 0,
          signup_sub_activity_count: shared.signup_sub_activity_count || 0,
          signup_applied_product_total: shared.signup_applied_product_total || 0,
          signup_auto_detail_rows: (shared.signup_detail_rows || []).length,
          signup_activity_scope: shared.signup_activity_scope || (activityScope() === 'custom' ? 'custom' : 'default'),
          signup_target_activity_ids: shared.signup_target_activity_ids || (shared.signup_activities || []).map(item => item.activityId).filter(Boolean).join(','),
          detail_api_orders: shared.detail_api_orders || 0,
          detail_api_errors: shared.detail_api_errors || 0,
          data_source: 'detail_api',
          surprise_coupon_activity: resolveSurpriseActivity().id,
        },
      },
    }
  }

  async function runOneFlowPhase() {
    if (phase === 'main') return oneFlowInitPhase()
    if (phase === 'collect_signup_activity_page') return collectSignupActivityPagePhase()
    if (phase === 'collect_signup_products_page') return collectSignupProductsPagePhase()
    if (phase === 'collect_order_list_page') return collectOrderListPagePhase()
    if (phase === 'collect_order_detail_batch') return collectOrderDetailBatchPhase()
    if (phase === 'finalize_one_flow') return finalizeOneFlowPhase()
    return null
  }

  try {
    if (phase === 'wait_official_export') return await waitOfficialExportAndReplay()
    const file = orderFile()
    const source = compact(params.data_source || '') || (file ? 'export_file' : 'detail_api')
    if (source === 'official_export_api') return await createOfficialExportTask()

    const useDetailApi = source === 'detail_api' || source === 'one_flow'
    const useApi = source === 'api' || (!file && checkboxEnabled(params.use_api_fallback, false))
    if (useDetailApi) {
      const oneFlowResult = await runOneFlowPhase()
      if (oneFlowResult) return oneFlowResult
    }
    let inputRows = []
    let extraShared = {}
    let signupSnapshot = { data: [], detailRows: [], shared: {} }
    if (useDetailApi && checkboxEnabled(params.auto_signup_match, true)) {
      try {
        signupSnapshot = await collectSignupSnapshot()
      } catch (error) {
        signupSnapshot = {
          data: [],
          detailRows: [],
          shared: {
            signup_auto_collected: false,
            signup_auto_error: String(error?.message || error),
          },
        }
      }
    }
    if (useDetailApi) {
      const detailResult = await queryOrdersFromDetailApi()
      inputRows = detailResult.rows
      extraShared = detailResult.shared
    } else if (useApi) {
      inputRows = await queryOrdersFromApi()
    } else {
      inputRows = allInputRows(file).map((row, index) => normalizeExportRow(row, index))
    }
    if (!inputRows.length) {
      return {
        success: false,
        error: useApi || useDetailApi ? '订单列表接口未返回订单数据。' : '请上传抖店官方订单导出 Excel/CSV，或选择 API fallback。',
        meta: { has_more: false },
      }
    }

    const result = replay(inputRows, {
      signupRows: signupSnapshot.detailRows,
      prefixRows: checkboxEnabled(params.include_signup_snapshot, true) ? signupSnapshot.data : [],
    })
    return {
      success: true,
      data: result.data,
      meta: {
        has_more: false,
        shared: {
          ...result.shared,
          ...extraShared,
          ...signupSnapshot.shared,
          data_source: useDetailApi ? 'detail_api' : useApi ? 'api_searchlist' : 'official_export_file',
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
