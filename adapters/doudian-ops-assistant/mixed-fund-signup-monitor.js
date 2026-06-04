;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

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

  function complete(data, nextShared, hasMore = false, sleepMs = 0) {
    return {
      success: true,
      data,
      meta: {
        action: 'complete',
        has_more: hasMore,
        sleep_ms: sleepMs,
        shared: nextShared,
      },
    }
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

  const MIXED_FUND_ENTRANCES = [
    {
      activityId: '7631472587859837230',
      name: '【高客单商品必报】优质用户混资货补',
      parentActivityId: '7611436032944275738',
      parentName: '【混资货品补贴-长周期】商家灵活出资，平台至高5倍对补',
      couponName: '平台老朋友惊喜券',
      entranceUrl: 'https://fxg.jinritemai.com/ffa/merchant/child-campaign-detail?id=7631472587859837230&from=operation_seller_link',
    },
    {
      activityId: '7611436032944275738',
      name: '【混资货品补贴-长周期】商家灵活出资，平台至高5倍对补',
      parentActivityId: '7611436032944275738',
      parentName: '【混资货品补贴-长周期】商家灵活出资，平台至高5倍对补',
      couponName: '平台新人首单惊喜券；平台新人首单福利券；平台限时回归礼券',
      entranceUrl: 'https://fxg.jinritemai.com/ffa/merchant/child-campaign-detail?id=7611436032944275738&from=operation_seller_link',
    },
    {
      activityId: '7554013743270347034',
      name: '必报！抖音商城混资券长期报名入口【商家出资5%】',
      parentActivityId: '7554013743270347034',
      parentName: '必报！抖音商城混资券长期报名入口【商家出资5%】',
      couponName: '平台惊喜XX折券',
      entranceUrl: 'https://fxg.jinritemai.com/ffa/merchant/child-campaign-detail?id=7554013743270347034&from=operation_seller_link',
    },
    {
      activityId: '7610636843016552714',
      name: '🔥全品类爆发！推荐卡混资活动报名入口',
      parentActivityId: '7627772015895036170',
      parentName: '🔥全品类爆发！推荐卡全资活动报名入口',
      couponName: '平台惊喜XX折券',
      entranceUrl: 'https://fxg.jinritemai.com/ffa/merchant/child-campaign-detail?applyTab=allow&id=7610636843016552714&from=campaign_square',
    },
  ]
  const MIXED_FUND_ENTRANCE_BY_ID = new Map(MIXED_FUND_ENTRANCES.map(activity => [activity.activityId, activity]))

  function defaultActivityListText() {
    return MIXED_FUND_ENTRANCES
      .map(activity => [
        activity.activityId,
        activity.name,
        activity.parentActivityId,
        activity.parentName,
        activity.couponName,
        activity.entranceUrl,
      ].join(' | '))
      .join('\n')
  }

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
      const entranceUrl = compact(item.entranceUrl || item.entrance_url || item.url || item.link)
      const activityId = compact(item.activityId || item.activity_id || item.id || item.act_id) || activityIdFromText(entranceUrl)
      if (!activityId) return null
      const name = compact(item.name || item.activityName || item.activity_name || item.title)
      const parentActivityId = compact(item.parentActivityId || item.parent_activity_id || item.parentId || item.parent_id)
      const parentName = compact(item.parentName || item.parent_name || item.parentTitle || item.parent_title)
      const couponName = compact(item.couponName || item.coupon_name || item.coupon || item.platform_coupon)
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
    const rows = customActivityRows()
    if (!rows.length && activityScope() !== 'custom') return MIXED_FUND_ENTRANCES.slice()
    const map = new Map()
    rows.forEach((row, index) => {
      const activity = normalizeActivityConfig(row, index)
      if (activity?.activityId) map.set(activity.activityId, activity)
    })
    const activities = Array.from(map.values())
    if (!activities.length) throw new Error('自定义入口清单为空，请至少保留或新增 1 个活动入口。')
    return activities
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

  function targetActivity(activity, parent, entranceKeyword, activityById = MIXED_FUND_ENTRANCE_BY_ID) {
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

  async function queryActivities() {
    const now = Math.floor(Date.now() / 1000)
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
      const pageSize = 20
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
        const total = Number(payload?.data?.total || payload?.total || 0) || 0
        fetched += list.length
        for (const raw of list) {
          const group = compactActivity(raw)
          for (const activity of group.activities) {
            const target = targetActivity(activity, group.parent, keyword, configuredById)
            if (target) seen.set(target.activityId, target)
          }
        }
        if (!list.length) break
        if (total > 0 ? fetched >= total : list.length < pageSize) break
      }
    }
    return configured.map(activity => seen.get(activity.activityId) || activity)
  }

  function productListBody(activityId, page, size) {
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

  async function queryAppliedProductPage(activity, options) {
    if (!activity.activityId) return { total: 0, rows: [], fetched: 0, note: '缺少活动ID', finished: true }
    const pageSize = options.pageSize
    const page = options.page
    const payload = await postJson('/mmc/apply/all_product_list?', productListBody(activity.activityId, page, pageSize))
    if (payload.code !== undefined && Number(payload.code) !== 0) {
      if (page === 1 && /报名主体不存在/.test(compact(payload.msg || payload.message))) {
        return { total: 0, rows: [], fetched: 0, note: compact(payload.msg || payload.message), finished: true }
      }
      throw new Error(`报名商品接口失败：${activity.name || activity.activityId} ${payload.msg || payload.message || payload.code}`)
    }
    const data = payload.data || {}
    const list = Array.isArray(data.product_list) ? data.product_list : []
    const declaredTotal = Number(data.total)
    const total = Number.isFinite(declaredTotal) && declaredTotal > 0 ? declaredTotal : 0
    const rows = list.map(item => normalizeProduct(item))
    return {
      total,
      rows,
      fetched: rows.length,
      note: '',
      finished: !list.length || (total > 0 ? options.fetchedBefore + rows.length >= total : list.length < pageSize),
    }
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
      活动链接: activity.entranceUrl || '',
      优惠券名称: activity.couponName || '',
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
    const pagesPerStep = includeDetails ? numberParam(params.detail_pages_per_step, 8, 1, 50) : 1
    const initialized = Array.isArray(shared.activities) && shared.activities.length > 0
    const shopName = compact(shared.shop_name) || compact(params.shop_name) || readShopName()
    const fallbackBrand = compact(shared.fallback_brand) || inferBrand(shopName)
    const scrapeTime = compact(shared.scrape_time) || formatTime(Date.now())
    const activities = initialized ? shared.activities : await queryActivities()
    const data = []
    let appliedProductTotal = Number(shared.applied_product_total || 0) || 0
    let detailRows = Number(shared.detail_rows || 0) || 0
    let activityIndex = Number(shared.activity_index || 0) || 0
    let productPage = Number(shared.product_page || 1) || 1
    let currentTotal = Number(shared.current_activity_total || 0) || 0
    let currentFetched = Number(shared.current_activity_fetched || 0) || 0
    let currentNote = compact(shared.current_activity_note || '')
    let apiPages = 0
    const seenProductKeysByActivity = shared.seen_product_keys_by_activity && typeof shared.seen_product_keys_by_activity === 'object'
      ? shared.seen_product_keys_by_activity
      : {}

    while (activityIndex < activities.length && apiPages < pagesPerStep) {
      const activity = activities[activityIndex]
      const brand = inferBrand(activity.name) || inferBrand(activity.parentName) || fallbackBrand
      const pageResult = await queryAppliedProductPage(activity, {
        page: productPage,
        pageSize: includeDetails ? pageSize : 1,
        fetchedBefore: currentFetched,
      })
      apiPages += 1
      if (productPage === 1) {
        currentTotal = pageResult.total || pageResult.fetched || 0
        currentNote = pageResult.note || ''
      }
      currentFetched += pageResult.fetched || 0

      if (includeDetails) {
        const appliedForRows = {
          total: currentTotal || currentFetched,
          fetched: currentTotal || currentFetched,
          note: currentNote,
        }
        const seenKeys = new Set(Array.isArray(seenProductKeysByActivity[activity.activityId]) ? seenProductKeysByActivity[activity.activityId] : [])
        for (const product of pageResult.rows) {
          const productKey = `${activity.activityId}::${product.itemId || product.productId || product.name}`
          if (seenKeys.has(productKey)) continue
          seenKeys.add(productKey)
          detailRows += 1
          data.push({
            __sheet_name: '报名商品明细',
            ...baseRow({ shopName, brand, activity, scrapeTime, applied: appliedForRows }),
            商品ID: product.itemId || product.productId,
            商品名称: product.name,
            商家编码: product.outerId,
            店铺ID: product.shopId,
            报名状态: signupStatus(product),
            报名成功时间: formatTime(product.applySuccessAt),
          })
        }
        seenProductKeysByActivity[activity.activityId] = Array.from(seenKeys)
      }

      if (pageResult.finished || !includeDetails) {
        const applied = {
          total: currentTotal || currentFetched,
          fetched: includeDetails ? currentFetched : 0,
          note: currentNote,
        }
        appliedProductTotal += applied.total || 0
        data.push({
          __sheet_name: '报名汇总',
          ...baseRow({ shopName, brand, activity, scrapeTime, applied }),
          备注: applied.note || '',
        })
        activityIndex += 1
        productPage = 1
        currentTotal = 0
        currentFetched = 0
        currentNote = ''
      } else {
        productPage += 1
      }
    }

    const hasMore = activityIndex < activities.length
    const nextShared = {
      activities,
      activity_index: activityIndex,
      product_page: productPage,
      current_activity_total: currentTotal,
      current_activity_fetched: currentFetched,
      current_activity_note: currentNote,
      seen_product_keys_by_activity: seenProductKeysByActivity,
      activity_count: new Set(activities.map(item => item.parentActivityId || item.activityId || item.parentName)).size,
      sub_activity_count: activities.length,
      applied_product_total: appliedProductTotal,
      detail_rows: detailRows,
      shop_name: shopName,
      fallback_brand: fallbackBrand,
      scrape_time: scrapeTime,
      keywords: activityKeywords().join(','),
      activity_scope: activityScope() === 'custom' ? 'custom' : 'default',
      target_activity_ids: activities.map(item => item.activityId).join(','),
      detail_fetch_scope: includeDetails ? 'all_applied_products' : 'summary_total_only',
    }
    return complete(data, nextShared, hasMore, hasMore ? 100 : 0)
  } catch (error) {
    return {
      success: false,
      error: String(error?.message || error),
      meta: { has_more: false },
    }
  }
})()
