;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const DEFAULT_WEIMOB_LIST_URL = 'https://master.weimob.com/bos/products/ecGoodsmanage/4000547814432/4diuahndgX5o74sooX4di628kby/goods/list'
  const DEFAULT_MDM_URL = 'https://mdm.semirapp.com/demdm/336912503927767040/application/application-custom/712740841071886336?name=goodsManage'
  const TARGET_SALE_CHANNEL_TYPE = 3
  const TARGET_MERCHANT_DELIVERY = {
    deliveryId: 207476,
    deliveryType: 1,
    deliveryTypeName: '商家配送',
    templateId: 10003147950,
    checked: true,
  }
  const TARGET_PICKUP_DELIVERY = {
    deliveryId: 214669,
    deliveryType: 3,
    deliveryTypeName: '到店自提',
    templateId: 40870,
    checked: true,
  }
  const WAREHOUSE_GOODS_SALE_STATUS = '2'
  const MAX_GOODS_INFO_READ_ATTEMPTS = 12
  const MAX_MDM_TOKEN_READ_ATTEMPTS = 12
  const MAX_WEIMOB_HEADER_READ_ATTEMPTS = 12
  const GOODS_RECORD_PREFERENCE_ONLINE_OFFLINE = 'online_offline'
  const GOODS_RECORD_PREFERENCE_WAREHOUSE = 'warehouse'

  function compact(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  }

  function unique(values) {
    const seen = new Set()
    const result = []
    for (const value of values) {
      const text = compact(value)
      if (!text || seen.has(text)) continue
      seen.add(text)
      result.push(text)
    }
    return result
  }

  function parseStyleCodes(value) {
    const raw = Array.isArray(value) ? value.join(';') : String(value || '')
    return unique(raw.split(/[;；,，、\n\r\t ]+/).map(item => item.trim()).filter(Boolean))
  }

  function requestedStyleCodes() {
    return parseStyleCodes(
      params.style_codes ||
      params.goods_codes ||
      params.styleCodes ||
      params.outer_goods_codes ||
      params.input ||
      shared.style_codes ||
      shared.styleCodes
    )
  }

  function executeMode() {
    const mode = compact(params.execute_mode || shared.execute_mode || 'plan').toLowerCase()
    return mode === 'update' ? 'update' : 'plan'
  }

  function goodsRecordPreference() {
    const mode = compact(params.goods_record_preference || shared.goods_record_preference || 'warehouse').toLowerCase()
    return mode === GOODS_RECORD_PREFERENCE_ONLINE_OFFLINE ? GOODS_RECORD_PREFERENCE_ONLINE_OFFLINE : GOODS_RECORD_PREFERENCE_WAREHOUSE
  }

  function mergeShared(next = {}) {
    return {
      ...shared,
      ...next,
      execute_mode: executeMode(),
      goods_record_preference: goodsRecordPreference(),
    }
  }

  function nextPhase(name, sleepMs = 1000, next = {}) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'next_phase',
        next_phase: name,
        sleep_ms: sleepMs,
        shared: mergeShared(next),
      },
    }
  }

  function complete(data = [], next = {}) {
    return {
      success: true,
      data,
      meta: {
        action: 'complete',
        has_more: false,
        shared: mergeShared(next),
      },
    }
  }

  function fail(message, next = {}) {
    return {
      success: false,
      error: compact(message) || '微盟商品上新自动化执行失败',
      meta: { shared: mergeShared(next) },
    }
  }

  function isWeimobHost() {
    return /(^|\.)weimob\.com$/i.test(String(location.hostname || ''))
  }

  function isMdmHost() {
    return /(^|\.)semirapp\.com$/i.test(String(location.hostname || ''))
  }

  function currentGoodsId() {
    try {
      return new URL(String(location.href || '')).searchParams.get('id') || ''
    } catch (error) {
      return ''
    }
  }

  function navigate(url, phaseName, next = {}, sleepMs = 1800) {
    const target = String(url || '')
    if (target && String(location.href || '') !== target) {
      if (typeof location.assign === 'function') location.assign(target)
      else location.href = target
    }
    return nextPhase(phaseName, sleepMs, next)
  }

  function editUrlForGoodsId(goodsId, saleChannelType = 1) {
    const id = compact(goodsId)
    const channelType = compact(saleChannelType) || '1'
    return `${DEFAULT_WEIMOB_LIST_URL.replace(/\/goods\/list.*$/, '/goods/editNoMenu')}?id=${encodeURIComponent(id)}&type=sale&saleChannelType=${encodeURIComponent(channelType)}`
  }

  function weimobHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      Apiclient: 'saas-pc',
    }
    try {
      const core = window.wm?.getCurrentWOSCoreInfoSync?.() || {}
      if (core.bosId != null) headers['weimob-bosId'] = String(core.bosId)
      if (core.vid != null) headers['weimob-vid'] = String(core.vid)
      if (core.productId != null) headers['weimob-productId'] = String(core.productId)
    } catch (error) {}
    try {
      const token = window.wm?.getMemoryState?.('saas-token')
      if (token) headers.Authorization = /^Bearer\s+/i.test(String(token)) ? String(token) : `Bearer ${token}`
    } catch (error) {}
    return headers
  }

  function mdmHeaders() {
    const headers = { 'Content-Type': 'application/json' }
    try {
      const raw = localStorage.getItem('__vuex__local') || '{}'
      const token = JSON.parse(raw)?.authModule?.token
      if (token) headers.demdmtoken = token
    } catch (error) {}
    return headers
  }

  function hasWeimobSessionHeaders(headers) {
    return Boolean(headers?.Authorization && headers?.['weimob-bosId'])
  }

  async function waitForWeimobHeaders() {
    for (let attempt = 0; attempt <= MAX_WEIMOB_HEADER_READ_ATTEMPTS; attempt += 1) {
      const headers = weimobHeaders()
      if (hasWeimobSessionHeaders(headers) || attempt === MAX_WEIMOB_HEADER_READ_ATTEMPTS) return headers
      await sleep(600)
    }
    return weimobHeaders()
  }

  function hasMdmToken(headers) {
    return Boolean(headers?.demdmtoken)
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async function waitForMdmHeaders() {
    for (let attempt = 0; attempt <= MAX_MDM_TOKEN_READ_ATTEMPTS; attempt += 1) {
      const headers = mdmHeaders()
      if (hasMdmToken(headers) || attempt === MAX_MDM_TOKEN_READ_ATTEMPTS) return headers
      await sleep(600)
    }
    return mdmHeaders()
  }

  async function postJson(url, payload, headers) {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(payload || {}),
    })
    const json = await response.json()
    if (!response.status || response.status >= 400) {
      throw new Error(`接口请求失败 ${response.status || ''}`.trim())
    }
    return json
  }

  async function callWeimob(path, payload) {
    const url = path.startsWith('/api3/') ? path : `/api3${path.startsWith('/') ? path : `/${path}`}`
    return postJson(url, payload, await waitForWeimobHeaders())
  }

  function goodsRowScore(row, requestedCode, preference = goodsRecordPreference()) {
    let score = 0
    if (compact(row.outerGoodsCode) === compact(requestedCode)) score += 1000
    const saleChannelType = Number(row.saleChannelType)
    if (preference === GOODS_RECORD_PREFERENCE_ONLINE_OFFLINE) {
      if (saleChannelType === TARGET_SALE_CHANNEL_TYPE) score += 200
      else if (saleChannelType === 1) score += 100
      else if (saleChannelType === 2) score += 20
    } else {
      if (saleChannelType === 2) score += 200
      else if (saleChannelType === 1) score += 100
      else if (saleChannelType === TARGET_SALE_CHANNEL_TYPE) score += 60
    }
    if (row.isCanSell === true) score += 20
    if (row.isOnline === true) score += 20
    if (row.goodsId != null && !Number.isNaN(Number(row.goodsId))) score += Math.min(Number(row.goodsId) / 1000000000000, 10)
    return score
  }

  function selectBestGoodsRow(rows, requestedCode, preference = goodsRecordPreference()) {
    const exactRows = (Array.isArray(rows) ? rows : []).filter(row => compact(row.outerGoodsCode) === compact(requestedCode))
    if (!exactRows.length) return null
    return exactRows.slice().sort((left, right) => goodsRowScore(right, requestedCode, preference) - goodsRowScore(left, requestedCode, preference))[0]
  }

  async function queryWeimobGoodsRows(styleCode, goodsSaleStatus = '') {
    const queryParameter = {
      searchType: 2,
      search: styleCode,
      searchList: [styleCode],
      searchOptionType: 1,
    }
    if (goodsSaleStatus) queryParameter.goodsSaleStatus = String(goodsSaleStatus)
    const payload = {
      pageNum: 1,
      pageSize: 20,
      queryParameter,
    }
    const json = await callWeimob('/mall/goods/queryGoodsListWithPageForManagement', payload)
    return Array.isArray(json?.data?.pageList) ? json.data.pageList : []
  }

  async function searchWeimobGoods(styleCodes) {
    const products = []
    const seenGoodsIds = new Set()
    const preference = goodsRecordPreference()
    for (const styleCode of styleCodes) {
      let row = null
      if (preference === GOODS_RECORD_PREFERENCE_WAREHOUSE) {
        const warehouseRows = await queryWeimobGoodsRows(styleCode, WAREHOUSE_GOODS_SALE_STATUS)
        row = selectBestGoodsRow(warehouseRows, styleCode, preference)
        if (!row) {
          const rows = await queryWeimobGoodsRows(styleCode)
          row = selectBestGoodsRow(rows, styleCode, preference)
        }
      } else {
        const rows = await queryWeimobGoodsRows(styleCode)
        row = selectBestGoodsRow(rows, styleCode, preference)
        if (!row) {
          const warehouseRows = await queryWeimobGoodsRows(styleCode, WAREHOUSE_GOODS_SALE_STATUS)
          row = selectBestGoodsRow(warehouseRows, styleCode, preference)
        }
      }
      const goodsId = compact(row?.goodsId)
      if (!row || !goodsId || seenGoodsIds.has(goodsId)) continue
      seenGoodsIds.add(goodsId)
      products.push({
        styleCode: compact(row.outerGoodsCode),
        goodsId: row.goodsId,
        title: compact(row.title || row.goodsTitle || row.itemTitle),
        saleChannelType: row.saleChannelType,
        isCanSell: row.isCanSell,
        isOnline: row.isOnline,
        editUrl: editUrlForGoodsId(row.goodsId, row.saleChannelType),
        skuRows: [],
      })
    }
    return products
  }

  function findReactFiber(element) {
    if (!element) return null
    for (const key in element) {
      if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
        return element[key]
      }
    }
    return null
  }

  function extractGoodsInfoFromReact() {
    const inputs = Array.from(document.querySelectorAll('input') || [])
    for (const input of inputs) {
      let fiber = findReactFiber(input)
      let depth = 0
      while (fiber && depth < 120) {
        const props = fiber.memoizedProps || {}
        if (props.goodsInfo && Array.isArray(props.goodsInfo.skuList)) {
          return props.goodsInfo
        }
        fiber = fiber.return
        depth += 1
      }
    }
    return null
  }

  function extractSkuRowsFromReact() {
    const goodsInfo = extractGoodsInfoFromReact()
    if (goodsInfo) return normalizeSkuRows(goodsInfo.skuList)

    const inputs = Array.from(document.querySelectorAll('input') || [])
    const candidates = []
    for (const input of inputs) {
      let fiber = findReactFiber(input)
      let depth = 0
      while (fiber && depth < 80) {
        const props = fiber.memoizedProps || {}
        if (Array.isArray(props.dataSource)) candidates.push(...props.dataSource)
        if (Array.isArray(props.skuList)) candidates.push(...props.skuList)
        if (props.sku) candidates.push(props.sku)
        fiber = fiber.return
        depth += 1
      }
    }
    return normalizeSkuRows(candidates)
  }

  function normalizeSkuRows(rows) {
    const result = []
    const seen = new Set()
    for (const row of Array.isArray(rows) ? rows : []) {
      const key = compact(row.itemSkuId || row.skuId || row.key || row.outerSkuCode)
      if (!key || seen.has(key)) continue
      seen.add(key)
      result.push({
        key: row.key,
        itemId: row.itemId,
        itemSkuId: row.itemSkuId,
        skuId: row.skuId,
        outerSkuCode: compact(row.outerSkuCode),
        skuBarCode: compact(row.skuBarCode),
        title: compact(row.title),
      })
    }
    return result
  }

  function detectEan(row) {
    const outer = compact(row?.outerSkuCode)
    const bar = compact(row?.skuBarCode)
    if (/^\d{8,14}$/.test(outer)) return outer
    if (/^\d{8,14}$/.test(bar)) return bar
    return outer || bar
  }

  function collectEans(products) {
    return unique((products || []).flatMap(product => (product.skuRows || []).map(detectEan)).filter(Boolean))
  }

  async function queryMdmRows(eanCodes) {
    if (!eanCodes.length) return []
    let json = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        json = await postJson(
          `/demdm-api/sku/getSkuInfoList?timestamp=${Date.now()}`,
          { pageNum: 1, pageSize: Math.max(50, eanCodes.length), eanCodes },
          await waitForMdmHeaders()
        )
        break
      } catch (error) {
        if (!/401/.test(String(error?.message || error)) || attempt >= 2) throw error
        await sleep(1200)
      }
    }
    if (Array.isArray(json?.data)) return json.data
    if (Array.isArray(json?.data?.list)) return json.data.list
    if (Array.isArray(json?.data?.records)) return json.data.records
    if (Array.isArray(json?.data?.pageList)) return json.data.pageList
    return []
  }

  function buildMdmMapping(rows) {
    const mapping = {}
    for (const row of rows || []) {
      const ean = compact(row.eanCode || row.internationalCode || row.intlCode || row.barCode || row.barcode)
      if (!ean) continue
      mapping[ean] = {
        skuCode: compact(row.skuCode),
        eanCode: ean,
        mdmCode: compact(row.mdmCode),
        skcCode: compact(row.skcCode),
        colorDesc: compact(row.colorDesc),
        sizeDesc: compact(row.sizeDesc),
        skuName: compact(row.skuName),
      }
    }
    return mapping
  }

  function buildPreviewRows(products, mapping, mode = 'plan', savedProductIds = new Set()) {
    const rows = []
    for (const product of products || []) {
      for (const sku of product.skuRows || []) {
        const ean = detectEan(sku)
        const mdm = mapping?.[ean]
        const saved = savedProductIds.has(compact(product.goodsId))
        rows.push({
          款号: product.styleCode || '',
          商品ID: product.goodsId || '',
          商品名称: product.title || '',
          规格ID: sku.skuId || sku.itemSkuId || '',
          原规格编码: sku.outerSkuCode || '',
          目标规格编码: mdm?.skuCode || '',
          原规格条码: sku.skuBarCode || '',
          目标规格条码: mdm?.eanCode || ean || '',
          MDM_SKC编码: mdm?.skcCode || '',
          MDM颜色: mdm?.colorDesc || '',
          MDM尺码: mdm?.sizeDesc || '',
          执行结果: mdm ? (saved ? '已保存' : '待更新') : '缺少MDM映射',
          备注: mdm ? (mode === 'update' ? (saved ? '已调用微盟保存接口' : '等待保存微盟') : '预演模式，未保存微盟') : '未在 MDM 国际码中找到对应 SKU',
        })
      }
    }
    return rows
  }

  function supportedDeliveryOption(list, deliveryType) {
    return (Array.isArray(list) ? list : []).find(item => Number(item.deliveryType) === Number(deliveryType) && Number(item.isSupported) !== 0)
  }

  async function queryDefaultMerchantFreightTemplate() {
    const json = await callWeimob('/mall/mgr/fulfill/goodsTemplate/findMerchantTemplateList', {})
    const data = json?.data || {}
    const found = data.defaultFreightTemplate || (Array.isArray(data.freightTemplateList) ? data.freightTemplateList[0] : null)
    if (!found) return {}
    return {
      templateId: found.templateId,
      templateName: found.templateName,
    }
  }

  async function queryDefaultPickupTemplate() {
    const json = await callWeimob('/mall/mgr/fulfill/pickup/delivery/findNodeTemplateList', {})
    const data = json?.data || {}
    const found = data.defaultTemplate || (Array.isArray(data.templateList) ? data.templateList[0] : null)
    if (!found) return {}
    return {
      templateId: found.id || found.templateId,
      templateName: found.templateName,
    }
  }

  async function queryTargetDeliveryOptions() {
    const json = await callWeimob('/mall/mgr/fulfill/merchant/node/registration/queryNodeSupportDeliveryType', {})
    const list = Array.isArray(json?.data?.nodeDeliveryDtoList) ? json.data.nodeDeliveryDtoList : []
    const merchantSupport = supportedDeliveryOption(list, 1) || TARGET_MERCHANT_DELIVERY
    const pickupSupport = supportedDeliveryOption(list, 3) || TARGET_PICKUP_DELIVERY
    let merchantTemplate = {}
    let pickupTemplate = {}
    try {
      merchantTemplate = await queryDefaultMerchantFreightTemplate()
    } catch (error) {}
    try {
      pickupTemplate = await queryDefaultPickupTemplate()
    } catch (error) {}
    return {
      merchant: {
        id: merchantSupport.id,
        deliveryId: merchantSupport.deliveryId || TARGET_MERCHANT_DELIVERY.deliveryId,
        deliveryType: 1,
        deliveryTypeName: merchantSupport.deliveryTypeName || TARGET_MERCHANT_DELIVERY.deliveryTypeName,
        isSupported: merchantSupport.isSupported,
        isDefault: merchantSupport.isDefault,
        deliveryNodeShipId: merchantSupport.id || 0,
        templateId: merchantTemplate.templateId || TARGET_MERCHANT_DELIVERY.templateId,
        templateName: merchantTemplate.templateName,
        checked: true,
      },
      pickup: {
        id: pickupSupport.id,
        deliveryId: pickupSupport.deliveryId || TARGET_PICKUP_DELIVERY.deliveryId,
        deliveryType: 3,
        deliveryTypeName: pickupSupport.deliveryTypeName || TARGET_PICKUP_DELIVERY.deliveryTypeName,
        isSupported: pickupSupport.isSupported,
        isDefault: pickupSupport.isDefault,
        deliveryNodeShipId: pickupSupport.id || 0,
        templateId: pickupTemplate.templateId || TARGET_PICKUP_DELIVERY.templateId,
        templateName: pickupTemplate.templateName,
        checked: true,
      },
    }
  }

  function skuIdentity(row) {
    return compact(row?.itemSkuId || row?.skuId || row?.key)
  }

  function deliveryTypeMap(deliveryOptions) {
    const map = {}
    if (Array.isArray(deliveryOptions)) {
      for (const option of deliveryOptions) {
        if (option?.deliveryType != null) map[Number(option.deliveryType)] = option
      }
      return map
    }
    if (deliveryOptions?.merchant) map[1] = deliveryOptions.merchant
    if (deliveryOptions?.pickup) map[3] = deliveryOptions.pickup
    if (deliveryOptions?.deliveryType != null) map[Number(deliveryOptions.deliveryType)] = deliveryOptions
    return map
  }

  function buildDeliveryEntry(existingEntry, option, fallback) {
    const source = existingEntry || option || fallback
    const deliveryType = Number(fallback.deliveryType)
    const templateId = existingEntry?.templateId || option?.templateId || fallback.templateId
    const entry = {
      ...(source || {}),
      deliveryId: source?.deliveryId || option?.deliveryId || fallback.deliveryId,
      deliveryType,
      deliveryTypeName: source?.deliveryTypeName || option?.deliveryTypeName || fallback.deliveryTypeName,
      deliveryNodeShipId: existingEntry?.deliveryNodeShipId ?? option?.deliveryNodeShipId ?? option?.id ?? source?.id ?? 0,
      templateId,
      checked: true,
    }
    delete entry.templateName
    return entry
  }

  function buildTargetDeliveryList(goodsInfo, deliveryOptions) {
    const currentList = Array.isArray(goodsInfo?.performanceWay?.deliveryList) ? goodsInfo.performanceWay.deliveryList : []
    const currentByType = deliveryTypeMap(currentList)
    const targetByType = deliveryTypeMap(deliveryOptions)
    return [
      buildDeliveryEntry(currentByType[1], targetByType[1], TARGET_MERCHANT_DELIVERY),
      buildDeliveryEntry(currentByType[3], targetByType[3], TARGET_PICKUP_DELIVERY),
    ]
  }

  function patchGoodsInfoForUpdate(goodsInfo, product, mapping, deliveryOptions) {
    const skuRows = product?.skuRows || []
    const skuByIdentity = new Map()
    for (const sku of skuRows) {
      const key = skuIdentity(sku)
      if (key) skuByIdentity.set(key, sku)
    }

    const patchedSkuList = (goodsInfo.skuList || []).map(row => {
      const sharedSku = skuByIdentity.get(skuIdentity(row)) || row
      const ean = detectEan(sharedSku)
      const mdm = mapping?.[ean]
      if (!mdm?.skuCode) return { ...row }
      return {
        ...row,
        outerSkuCode: mdm.skuCode,
        skuBarCode: mdm.eanCode || ean,
      }
    })

    return {
      ...goodsInfo,
      saleChannelType: TARGET_SALE_CHANNEL_TYPE,
      isCanSell: true,
      isOnline: true,
      goodsDeliveryMode: 0,
      performanceWay: {
        ...(goodsInfo.performanceWay || {}),
        deliveryList: buildTargetDeliveryList(goodsInfo, deliveryOptions),
      },
      skuList: patchedSkuList,
    }
  }

  function isWeimobUpdateSuccess(response) {
    if (!response || typeof response !== 'object') return false
    if (response.errcode != null) return String(response.errcode) === '0'
    if (response.code != null) {
      const code = String(response.code).toLowerCase()
      return code === '0' || code === 'ok' || code === 'success'
    }
    if (response.data && typeof response.data === 'object') {
      if (response.data.success === false) return false
      if (response.data.success === true) return true
      if (response.data.goodsId != null) return true
    }
    return response.success === true
  }

  function weimobErrorMessage(response) {
    return compact(response?.errmsg || response?.message || response?.msg || response?.error) || '接口未返回成功'
  }

  async function runMainPhase() {
    const styleCodes = requestedStyleCodes()
    if (!styleCodes.length) return fail('请先粘贴需要上新的商品款号，多个款号可用分号、逗号或换行分隔')
    if (!isWeimobHost()) {
      return navigate(params.weimob_list_url || DEFAULT_WEIMOB_LIST_URL, 'main', { styleCodes, style_codes: styleCodes })
    }
    const products = await searchWeimobGoods(styleCodes)
    const foundStyleSet = new Set(products.map(item => item.styleCode).filter(Boolean))
    const missingStyleCodes = styleCodes.filter(code => !foundStyleSet.has(code))
    if (!products.length) {
      return complete(styleCodes.map(code => ({
        款号: code,
        商品ID: '',
        商品名称: '',
        规格ID: '',
        原规格编码: '',
        目标规格编码: '',
        原规格条码: '',
        目标规格条码: '',
        MDM_SKC编码: '',
        MDM颜色: '',
        MDM尺码: '',
        执行结果: '未找到商品',
        备注: '微盟商品编码搜索无结果',
      })), { styleCodes, missingStyleCodes })
    }
    const next = { styleCodes, style_codes: styleCodes, missingStyleCodes, products, product_index: 0 }
    return navigate(products[0].editUrl, 'read_weimob_sku', next)
  }

  async function runReadWeimobSkuPhase() {
    const products = Array.isArray(shared.products) ? shared.products : []
    const index = Number(shared.product_index || 0)
    const product = products[index]
    if (!product) return navigate(params.mdm_url || DEFAULT_MDM_URL, 'mdm_lookup', { products, product_index: index })
    if (!isWeimobHost() || compact(currentGoodsId()) !== compact(product.goodsId)) {
      return navigate(product.editUrl || editUrlForGoodsId(product.goodsId), 'read_weimob_sku', { products, product_index: index })
    }

    const skuRows = extractSkuRowsFromReact()
    if (!skuRows.length) {
      const attempts = Number(shared.read_sku_attempts || 0)
      if (attempts < MAX_GOODS_INFO_READ_ATTEMPTS) {
        return nextPhase('read_weimob_sku', 1200, { products, product_index: index, read_sku_attempts: attempts + 1 })
      }
      return fail(`未能从微盟编辑页读取规格明细：${product.styleCode || product.goodsId}`, { products, product_index: index })
    }

    const goodsInfo = extractGoodsInfoFromReact()
    const updated = products.slice()
    updated[index] = {
      ...product,
      title: product.title || compact(goodsInfo?.title),
      styleCode: product.styleCode || compact(goodsInfo?.outerGoodsCode),
      skuRows,
    }
    if (index + 1 < updated.length) {
      const nextProduct = updated[index + 1]
      return navigate(nextProduct.editUrl || editUrlForGoodsId(nextProduct.goodsId), 'read_weimob_sku', {
        products: updated,
        product_index: index + 1,
        read_sku_attempts: 0,
      })
    }
    return navigate(params.mdm_url || DEFAULT_MDM_URL, 'mdm_lookup', {
      products: updated,
      product_index: updated.length,
      read_sku_attempts: 0,
    }, 2200)
  }

  async function runMdmLookupPhase() {
    const products = Array.isArray(shared.products) ? shared.products : []
    if (!products.length) return fail('缺少微盟商品读取结果，无法查询 MDM 映射')
    if (!isMdmHost()) {
      return navigate(params.mdm_url || DEFAULT_MDM_URL, 'mdm_lookup', { products })
    }
    const eanCodes = collectEans(products)
    const mdmRows = await queryMdmRows(eanCodes)
    const mdmMapping = buildMdmMapping(mdmRows)
    const previewRows = buildPreviewRows(products, mdmMapping, executeMode())
    const next = { products, mdmMapping, previewRows, eanCodes }
    if (executeMode() === 'update') {
      const product = products[0]
      return navigate(product.editUrl || editUrlForGoodsId(product.goodsId), 'update_weimob', { ...next, update_index: 0, savedRows: [] }, 2200)
    }
    return complete(previewRows, next)
  }

  async function runUpdateWeimobPhase() {
    if (executeMode() !== 'update') return fail('当前不是更新模式，已停止保存微盟')
    const products = Array.isArray(shared.products) ? shared.products : []
    const mdmMapping = shared.mdmMapping || {}
    const index = Number(shared.update_index || 0)
    const product = products[index]
    const savedRows = Array.isArray(shared.savedRows) ? shared.savedRows : []
    if (!product) {
      return complete(savedRows.length ? savedRows : buildPreviewRows(products, mdmMapping, 'update'), {
        products,
        mdmMapping,
        savedRows,
      })
    }
    if (!isWeimobHost() || compact(currentGoodsId()) !== compact(product.goodsId)) {
      return navigate(product.editUrl || editUrlForGoodsId(product.goodsId), 'update_weimob', {
        products,
        mdmMapping,
        update_index: index,
        savedRows,
      })
    }

    const missing = (product.skuRows || []).filter(row => !mdmMapping[detectEan(row)]?.skuCode)
    if (missing.length) {
      const rows = buildPreviewRows([product], mdmMapping, 'update')
      return fail(`商品 ${product.styleCode || product.goodsId} 有 ${missing.length} 个规格缺少 MDM 映射，已停止保存`, {
        products,
        mdmMapping,
        update_index: index,
        savedRows: savedRows.concat(rows),
      })
    }

    const goodsInfo = extractGoodsInfoFromReact()
    if (!goodsInfo) {
      const attempts = Number(shared.update_read_attempts || 0)
      if (attempts < MAX_GOODS_INFO_READ_ATTEMPTS) {
        return nextPhase('update_weimob', 1200, { products, mdmMapping, update_index: index, savedRows, update_read_attempts: attempts + 1 })
      }
      return fail(`未能从微盟编辑页读取保存 payload：${product.styleCode || product.goodsId}`, { products, mdmMapping, update_index: index, savedRows })
    }

    const deliveryOptions = shared.deliveryOptions || shared.deliveryOption || await queryTargetDeliveryOptions()
    const payload = patchGoodsInfoForUpdate(goodsInfo, product, mdmMapping, deliveryOptions)
    const response = await callWeimob('/mall/goods/update', payload)
    if (!isWeimobUpdateSuccess(response)) {
      return fail(`微盟保存失败：${weimobErrorMessage(response)}`, {
        products,
        mdmMapping,
        update_index: index,
        savedRows,
        deliveryOptions,
      })
    }
    const savedSet = new Set([compact(product.goodsId)])
    const nextSavedRows = savedRows.concat(buildPreviewRows([product], mdmMapping, 'update', savedSet))
    if (index + 1 < products.length) {
      const nextProduct = products[index + 1]
      return navigate(nextProduct.editUrl || editUrlForGoodsId(nextProduct.goodsId), 'update_weimob', {
        products,
        mdmMapping,
        update_index: index + 1,
        savedRows: nextSavedRows,
        deliveryOptions,
        update_read_attempts: 0,
      }, 1800)
    }
    return complete(nextSavedRows, { products, mdmMapping, savedRows: nextSavedRows, deliveryOptions })
  }

  try {
    if (phase === 'main' || phase === 'search_weimob') return await runMainPhase()
    if (phase === 'read_weimob_sku') return await runReadWeimobSkuPhase()
    if (phase === 'mdm_lookup') return await runMdmLookupPhase()
    if (phase === 'update_weimob') return await runUpdateWeimobPhase()
    return fail(`未知阶段：${phase}`)
  } catch (error) {
    return fail(error?.message || error)
  }
})()
