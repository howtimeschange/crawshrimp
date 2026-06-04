;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}

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
    if (!Number.isFinite(raw) || raw <= 0) return ''
    const ms = raw > 10_000_000_000 ? raw : raw * 1000
    const date = new Date(ms)
    if (Number.isNaN(date.getTime())) return ''
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
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

  function safeJson(value) {
    if (!value) return null
    if (typeof value === 'object') return value
    try {
      return JSON.parse(String(value))
    } catch (error) {
      return null
    }
  }

  function readShopName() {
    const local = typeof localStorage !== 'undefined' ? localStorage : null
    const session = typeof sessionStorage !== 'undefined' ? sessionStorage : null
    const candidates = [
      safeJson(session?.getItem?.('storeGetters'))?.shopInfo?.shop_name,
      safeJson(local?.getItem?.('initialUserInfo'))?.shop_name,
      safeJson(session?.getItem?.('initialUserInfo'))?.shop_name,
    ].map(compact).filter(Boolean)
    if (candidates.length) return candidates[0]

    const lines = String(document.body?.innerText || '')
      .split(/\n+/)
      .map(compact)
      .filter(Boolean)
      .slice(0, 80)
    const exactShop = lines.find(line => /旗舰店|专卖店|专营店/.test(line) && !/申请关店|抖店/.test(line) && line.length <= 40)
    if (exactShop) return exactShop
    return lines.find(line => /店$/.test(line) && !/申请关店|抖店|返回首页/.test(line) && line.length <= 40) || ''
  }

  function inferBrand(value) {
    const text = compact(value)
    if (/巴拉巴拉|balabala/i.test(text)) return '巴拉巴拉'
    if (/迷你巴拉|minibala/i.test(text)) return '迷你巴拉'
    if (/森马|semir/i.test(text)) return '森马'
    return ''
  }

  function activityKeywords() {
    const values = splitValues(params.activity_keywords || params.keywords || '')
    return values.length ? values : ['混资']
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    })
  }

  function feedActivityList(payload) {
    const data = payload?.data
    if (Array.isArray(data?.data)) return data.data
    if (Array.isArray(data?.list)) return data.list
    if (Array.isArray(data)) return data
    return []
  }

  function compactActivity(item) {
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

  async function queryActivities() {
    const now = Math.floor(Date.now() / 1000)
    const seen = new Map()
    for (const keyword of activityKeywords()) {
      const body = {
        page: 1,
        page_size: 20,
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
      for (const raw of feedActivityList(payload)) {
        const group = compactActivity(raw)
        for (const activity of group.activities) {
          const id = compact(activity.activityId || activity.name)
          if (!id) continue
          const key = `${group.parent.activityId || group.parent.name}::${id}`
          if (!seen.has(key)) {
            seen.set(key, {
              ...activity,
              parentActivityId: group.parent.activityId || activity.activityId || '',
              parentName: group.parent.name || activity.name || '',
              entranceKeyword: keyword,
            })
          }
        }
      }
    }
    return Array.from(seen.values())
  }

  function productListBody(activityId, page, size) {
    return {
      activity_id: activityId,
      product_list_type: 1,
      product_cond: {
        status_type: 1,
        status_list: [200],
        only_bargain: true,
      },
      filter_condition: {
        filter_applied: true,
        not_need_control_price: false,
        not_need_estimate_price: true,
        not_need_left_stock: true,
        not_need_low_price: true,
        not_need_total_stock: true,
      },
      page,
      size,
    }
  }

  function normalizeProduct(row) {
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
      raw: info,
    }
  }

  function signupStatus(product) {
    if (product.applySuccessAt) return '已报名'
    if (['200', '3', 'success'].includes(compact(product.status).toLowerCase())) return '已报名'
    return product.status || ''
  }

  async function queryAppliedProducts(activity, options) {
    if (!activity.activityId) return { total: 0, rows: [], fetched: 0, note: '缺少活动ID' }
    const pageSize = options.pageSize
    const maxPages = options.maxPages
    const rows = []
    let total = 0
    let fetched = 0
    for (let page = 1; page <= maxPages; page += 1) {
      const payload = await postJson('/mmc/apply/all_product_list?', productListBody(activity.activityId, page, pageSize))
      if (payload.code !== undefined && Number(payload.code) !== 0) {
        if (page === 1 && /报名主体不存在/.test(compact(payload.msg || payload.message))) {
          return { total: 0, rows: [], fetched: 0, note: compact(payload.msg || payload.message) }
        }
        throw new Error(`报名商品接口失败：${activity.name || activity.activityId} ${payload.msg || payload.message || payload.code}`)
      }
      const data = payload.data || {}
      const list = Array.isArray(data.product_list) ? data.product_list : []
      if (page === 1) total = Number(data.total || list.length || 0) || 0
      for (const item of list) rows.push(normalizeProduct(item))
      fetched += list.length
      if (!list.length || fetched >= total || list.length < pageSize) break
    }
    return { total, rows, fetched, note: '' }
  }

  function baseRow({ shopName, brand, activity, scrapeTime, applied }) {
    return {
      平台名称: '抖店',
      品牌: brand,
      店铺名称: shopName,
      父活动ID: activity.parentActivityId || '',
      父活动名称: activity.parentName || '',
      活动ID: activity.activityId || '',
      活动名称: activity.name || '',
      活动入口: activity.entranceKeyword || '',
      活动开始时间: formatTime(activity.startTime),
      活动结束时间: formatTime(activity.endTime),
      报名商品数: applied.total || 0,
      已拉取明细数: applied.fetched || 0,
      抓取时间: scrapeTime,
    }
  }

  try {
    const includeDetails = checkboxEnabled(params.include_details, true)
    const pageSize = numberParam(params.detail_page_size || params.page_size, 50, 1, 100)
    const maxPages = numberParam(params.max_detail_pages, 20, 1, 200)
    const shopName = compact(params.shop_name) || readShopName()
    const fallbackBrand = inferBrand(shopName)
    const scrapeTime = formatTime(Date.now())
    const activities = await queryActivities()
    const data = []
    let appliedProductTotal = 0
    let detailRows = 0

    for (const activity of activities) {
      const applied = await queryAppliedProducts(activity, { pageSize, maxPages })
      appliedProductTotal += applied.total || 0
      const brand = inferBrand(activity.name) || inferBrand(activity.parentName) || fallbackBrand
      data.push({
        __sheet_name: '报名汇总',
        ...baseRow({ shopName, brand, activity, scrapeTime, applied }),
        备注: applied.note || '',
      })

      if (includeDetails) {
        const seenProducts = new Set()
        for (const product of applied.rows) {
          const productKey = `${activity.activityId}::${product.itemId || product.productId || product.name}`
          if (seenProducts.has(productKey)) continue
          seenProducts.add(productKey)
          detailRows += 1
          data.push({
            __sheet_name: '报名商品明细',
            ...baseRow({ shopName, brand, activity, scrapeTime, applied }),
            商品ID: product.itemId || product.productId,
            商品名称: product.name,
            商家编码: product.outerId,
            店铺ID: product.shopId,
            报名状态: signupStatus(product),
            报名成功时间: formatTime(product.applySuccessAt),
          })
        }
      }
    }

    return {
      success: true,
      data,
      meta: {
        has_more: false,
        shared: {
          activity_count: new Set(activities.map(item => item.parentActivityId || item.activityId || item.parentName)).size,
          sub_activity_count: activities.length,
          applied_product_total: appliedProductTotal,
          detail_rows: detailRows,
          shop_name: shopName,
          keywords: activityKeywords().join(','),
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
