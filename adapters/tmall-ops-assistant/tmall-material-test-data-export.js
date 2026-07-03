;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const DEFAULT_PAGE_SIZE = 20
  const OVERVIEW_SHEET = '概览'
  const DETAIL_SHEET = '明细'
  const STATUS_LABELS = {
    '-1': '已暂停',
    0: '未测试',
    1: '测试中',
    2: '已结束',
    3: '已完成',
  }
  const SOURCE_LABELS = {
    common_search: '搜索测图',
    COMMON_SEARCH: '搜索测图',
  }

  function compact(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function normalizeKey(value) {
    return compact(value).toLowerCase().replace(/[\s_./\\\-：:（）()]+/g, '')
  }

  function rowValue(row, aliases) {
    const wanted = new Set((aliases || []).map(normalizeKey))
    for (const [key, value] of Object.entries(row || {})) {
      if (wanted.has(normalizeKey(key)) && compact(value)) return compact(value)
    }
    return ''
  }

  function parseListInput(value) {
    if (Array.isArray(value)) return value.map(compact).filter(Boolean)
    return String(value || '')
      .split(/[\n,，、；;]+/)
      .map(compact)
      .filter(Boolean)
  }

  function chunkArray(items, size) {
    const rows = Array.isArray(items) ? items : []
    const chunkSize = Math.max(1, Number(size || 20) || 20)
    const chunks = []
    for (let index = 0; index < rows.length; index += chunkSize) {
      chunks.push(rows.slice(index, index + chunkSize))
    }
    return chunks
  }

  function normalizeItemId(value) {
    const match = compact(value).match(/\d{8,}/)
    return match ? match[0] : ''
  }

  function normalizeSource(value) {
    const text = compact(value).toLowerCase()
    if (!text || text === 'common_search' || text === 'commonsearch' || text === 'search') return 'common_search'
    return text
  }

  function getSourceLabel(value) {
    return SOURCE_LABELS[value] || SOURCE_LABELS[normalizeSource(value)] || compact(value) || '未知渠道'
  }

  function getStatusLabel(value) {
    const key = String(value ?? '').trim()
    return STATUS_LABELS[key] || compact(value) || ''
  }

  function normalizeRemoteUrl(value) {
    const url = compact(value)
    if (!url) return ''
    return url.startsWith('//') ? `https:${url}` : url
  }

  function normalizeStatusValue(value) {
    const text = compact(value)
    if (!text) return ''
    const labelToValue = {
      全部: '',
      未测试: '0',
      未开始: '0',
      测试中: '1',
      已结束: '2',
      已完成: '3',
      已暂停: '-1',
    }
    return Object.prototype.hasOwnProperty.call(labelToValue, text) ? labelToValue[text] : text
  }

  function formatPercent(numerator, denominator) {
    const top = Number(numerator)
    const bottom = Number(denominator)
    if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= 0) return ''
    return `${((top / bottom) * 100).toFixed(2)}%`
  }

  function mapListMetric(material, names = []) {
    const wanted = new Set((names || []).map(normalizeKey))
    for (const metric of Array.isArray(material?.metrics) ? material.metrics : []) {
      const keys = [
        metric?.metricsName,
        metric?.metricName,
        metric?.name,
        metric?.metricsCode,
        metric?.metricCode,
        metric?.code,
      ]
      if (!keys.some(key => wanted.has(normalizeKey(key)))) continue
      return compact(metric?.value ?? metric?.metricsValue ?? metric?.metricValue ?? metric?.num ?? metric?.rate)
    }
    return ''
  }

  function formatDateYYYYMMDD(date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}${month}${day}`
  }

  function defaultDateRange() {
    const end = new Date()
    const start = new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000)
    return {
      startDate: formatDateYYYYMMDD(start),
      endDate: formatDateYYYYMMDD(end),
    }
  }

  function extractArray(payload, keys = []) {
    if (Array.isArray(payload)) return payload
    for (const key of keys) {
      const value = key.split('.').reduce((target, part) => target?.[part], payload)
      if (Array.isArray(value)) return value
    }
    return []
  }

  function describeError(error, fallback = '未知错误') {
    if (!error) return fallback
    if (typeof error === 'string') return error
    if (Array.isArray(error.ret)) return error.ret.join('；')
    return error.message || error.msg || error.errorMsg || fallback
  }

  function unwrapMtopPayload(payload, api) {
    if (!payload || typeof payload !== 'object') return payload
    if (Array.isArray(payload.ret)) {
      const failed = payload.ret.find(item => !/^SUCCESS/i.test(String(item || '')))
      if (failed) throw new Error(`${api} 返回失败：${payload.ret.join('；')}`)
    }
    return payload.data !== undefined ? payload.data : payload
  }

  async function callMtop(api, data = {}, options = {}) {
    const client = window.lib?.mtop || window.mtop
    if (!client || typeof client.request !== 'function') {
      throw new Error('未找到千牛页面 MTop 客户端，请确认当前 tab 是天猫素材测试页')
    }
    const payload = await client.request({
      api,
      v: options.v || '1.0',
      type: options.type || 'POST',
      dataType: options.dataType || 'json',
      H5Request: true,
      preventFallback: true,
      data,
    })
    return unwrapMtopPayload(payload, api)
  }

  function buildSearchTasksPayload(itemId, filters = {}) {
    const paramsPayload = {
      tabCode: filters.tabCode || 'all',
      testChannel: normalizeSource(filters.testChannel || filters.source || 'common_search'),
    }
    const normalizedStatus = normalizeStatusValue(filters.testStatus)
    if (normalizedStatus !== '') {
      paramsPayload.testStatus = String(normalizedStatus)
    }
    const id = normalizeItemId(itemId)
    if (id) paramsPayload.itemIdOrName = id
    return {
      modelCode: filters.modelCode || 'image_test_mgr',
      params: JSON.stringify(paramsPayload),
      currentPage: Number(filters.currentPage || 1),
      pageSize: Number(filters.pageSize || DEFAULT_PAGE_SIZE),
    }
  }

  async function searchMaterialTestTasks(itemId, filters = {}) {
    const payload = await callMtop(
      'mtop.taobao.qn.copilot.framework.listmodel.data.search',
      buildSearchTasksPayload(itemId, filters),
    )
    const rows = extractArray(payload, ['list', 'records', 'result.list', 'data', 'data.list', 'data.records', 'data.result.list', 'modelDataList'])
    const total = Number(payload?.total || payload?.count || payload?.result?.total || payload?.result?.count || payload?.data?.total || payload?.data?.result?.total || rows.length || 0)
    return {
      total: Number.isFinite(total) ? total : rows.length,
      rows,
      raw: payload,
    }
  }

  async function collectMaterialTestTasks(filters = {}) {
    const rows = []
    const pageSize = Math.max(1, Math.min(100, Number(filters.pageSize || DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE))
    const maxPages = Math.max(1, Number(filters.maxPages || 200) || 200)
    let total = 0
    for (let currentPage = 1; currentPage <= maxPages; currentPage += 1) {
      const result = await searchMaterialTestTasks('', {
        ...filters,
        currentPage,
        pageSize,
      })
      total = Math.max(total, result.total || 0)
      const pageRows = Array.isArray(result.rows) ? result.rows : []
      rows.push(...pageRows)
      if (!pageRows.length) break
      if (total && rows.length >= total) break
      if (pageRows.length < pageSize) break
    }
    return { total: total || rows.length, rows }
  }

  function buildDownloadDataPayload(itemIds, statisticType, startDate, endDate) {
    return {
      startDate: String(startDate || ''),
      endDate: String(endDate || ''),
      itemIds: JSON.stringify(parseListInput(itemIds).map(normalizeItemId).filter(Boolean)),
      statisticType: compact(statisticType) || 'ACCUMULATE_30_DAYS',
    }
  }

  async function downloadMaterialTestData(itemIds, statisticType, startDate, endDate) {
    return callMtop(
      'mtop.taobao.qn.copilot.test.image.data.download',
      buildDownloadDataPayload(itemIds, statisticType, startDate, endDate),
    )
  }

  function resolveCaptureScope(rawParams = params) {
    const scope = compact(rawParams.capture_scope || rawParams.captureScope).toLowerCase()
    if (['full', 'ids', 'file'].includes(scope)) return scope
    return 'auto'
  }

  function normalizeSourceRows(rawParams = params) {
    const scope = resolveCaptureScope(rawParams)
    if (scope === 'full') return []
    const rows = []
    const seen = new Set()
    const seenItemIds = new Set()
    const inputRows = scope === 'ids'
      ? []
      : (Array.isArray(rawParams.input_file?.rows) ? rawParams.input_file.rows : [])
    for (const [index, row] of inputRows.entries()) {
      const itemId = normalizeItemId(rowValue(row, ['商品ID', '天猫商品ID', 'ID（用于测图的ID）', '宝贝ID', 'itemId', 'item_id']))
      const taskId = rowValue(row, ['任务ID', '测图任务ID', 'experimentTaskId', 'taskId'])
      if (!itemId) continue
      const source = {
        表格行号: index + 2,
        款号: rowValue(row, ['款号', '编码', '货号', 'styleCode', 'spu']),
        商品ID: itemId,
        任务ID: taskId,
      }
      const key = `${itemId}:${taskId}`
      if (seen.has(key)) continue
      seen.add(key)
      seenItemIds.add(itemId)
      rows.push(source)
    }
    const explicitItemIds = scope === 'file' ? [] : parseListInput(rawParams.item_ids || rawParams.item_id || rawParams.itemId)
    for (const itemId of explicitItemIds) {
      const id = normalizeItemId(itemId)
      if (!id) continue
      if (seenItemIds.has(id)) continue
      const key = `${id}:`
      if (seen.has(key)) continue
      seen.add(key)
      seenItemIds.add(id)
      rows.push({ 表格行号: '', 款号: '', 商品ID: id, 任务ID: '' })
    }
    return rows
  }

  function flattenTaskListMaterials(item, parentContext = {}) {
    const rows = []
    const metricsByRatio = item?.testImageMetrics || item?.imageMetrics || {}
    for (const [ratio, materials] of Object.entries(metricsByRatio || {})) {
      for (const material of Array.isArray(materials) ? materials : []) {
        const searchExposure = mapListMetric(material, ['搜索曝光', 'search_pv', 'searchExposure'])
        const searchClick = mapListMetric(material, ['搜索点击', 'search_click', 'searchClick'])
        const detailExposure = mapListMetric(material, ['详情曝光', 'detail_pv', 'detailExposure'])
        const detailClick = mapListMetric(material, ['详情点击', 'detail_click', 'detailClick'])
        rows.push({
          __sheet_name: DETAIL_SHEET,
          记录类型: '任务列表素材',
          表格行号: parentContext.表格行号 || '',
          款号: parentContext.款号 || '',
          商品ID: parentContext.商品ID || '',
          商品标题: parentContext.商品标题 || '',
          任务ID: parentContext.任务ID || '',
          测试状态: parentContext.测试状态 || '',
          测试渠道: parentContext.测试渠道 || '',
          测试素材数: parentContext.测试素材数 || '',
          统计口径: '',
          统计日期: '',
          图片类型: compact(material?.imageType || material?.materialType || ''),
          素材ID: compact(material?.imageId || material?.materialId || material?.id),
          素材比例: compact(material?.imageScale || material?.materialRatio || ratio),
          素材URL: normalizeRemoteUrl(material?.imageUrl || material?.materialUrl || material?.url || ''),
          素材占比: compact(material?.percent ?? material?.ratio ?? ''),
          搜索曝光: searchExposure,
          搜索点击: searchClick,
          搜索点击率: mapListMetric(material, ['搜索点击率', 'search_ctr', 'searchCtr']),
          详情曝光: detailExposure,
          详情点击: detailClick,
          详情点击率: mapListMetric(material, ['详情点击率', 'detail_ctr', 'detailCtr']),
          详情加购: mapListMetric(material, ['详情加购', 'detailAddCart', 'detail_cart']),
          详情支付转化: mapListMetric(material, ['详情支付转化', 'detailPayConversion', 'detail_pay']),
          详情支付转化率: mapListMetric(material, ['详情支付转化率', 'detail_icvr', 'detailPayConversionRate']),
          执行结果: '任务列表素材',
          备注: '数据下载接口未返回明细，已回退到任务列表素材',
        })
      }
    }
    return rows
  }

  function normalizeTmallTaskRows(inputRows, sourceRow = {}) {
    const rows = []
    for (const row of Array.isArray(inputRows) ? inputRows : []) {
      const itemId = compact(row?.domainId || row?.itemId || row?.id || sourceRow.商品ID)
      const title = compact(row?.head?.itemTitle || row?.head?.title || row?.itemTitle || row?.title)
      const testData = row?.columns?.test_data || row?.test_data || row?.testData || {}
      const dataList = Array.isArray(testData?.dataList) ? testData.dataList : Array.isArray(testData) ? testData : []
      if (!dataList.length) {
        rows.push({
          __sheet_name: OVERVIEW_SHEET,
          记录类型: '任务概览',
          表格行号: sourceRow.表格行号 || '',
          款号: sourceRow.款号 || '',
          商品ID: itemId,
          商品标题: title,
          任务ID: sourceRow.任务ID || '',
          测试状态: '未找到测图任务',
          执行结果: '未找到',
          备注: '',
        })
        continue
      }
      for (const item of dataList) {
        const metrics = item?.testImageMetrics || item?.imageMetrics || {}
        const count = Object.values(metrics).reduce((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0)
        const taskRow = {
          __sheet_name: OVERVIEW_SHEET,
          记录类型: '任务概览',
          表格行号: sourceRow.表格行号 || '',
          款号: sourceRow.款号 || '',
          商品ID: itemId,
          商品标题: title,
          任务ID: compact(item?.experimentTaskId || item?.taskId || item?.id),
          测试状态: getStatusLabel(item?.testStatus ?? item?.status),
          测试渠道: getSourceLabel(item?.imageTestSource || item?.source || item?.testChannel),
          最优素材: normalizeRemoteUrl(item?.bestTestImage?.imageUrl || item?.bestImage?.imageUrl || item?.bestTestImageUrl || ''),
          测试素材数: count,
          执行结果: '已读取任务',
          备注: '',
        }
        taskRow.__listMaterials = flattenTaskListMaterials(item, taskRow)
        rows.push(taskRow)
      }
    }
    return rows
  }

  function filterTaskRowsForExport(taskRows, filters = {}) {
    const wantedSource = getSourceLabel(filters.testChannel || filters.source || 'common_search')
    const normalizedStatus = normalizeStatusValue(filters.testStatus)
    const wantedStatus = normalizedStatus === ''
      ? ''
      : getStatusLabel(normalizedStatus)
    return (Array.isArray(taskRows) ? taskRows : []).filter(row => {
      const sourceOk = !compact(row?.测试渠道) || row.测试渠道 === wantedSource
      const statusOk = !wantedStatus || !compact(row?.测试状态) || row.测试状态 === wantedStatus
      return sourceOk && statusOk
    })
  }

  function normalizeDownloadDataRows(inputRows, statisticType = '', contextByItem = new Map()) {
    return (Array.isArray(inputRows) ? inputRows : []).map(row => {
      const itemId = compact(row?.itemId)
      const context = contextByItem.get(itemId) || {}
      const searchExposure = Number(row?.searchExposure || 0)
      const searchClick = Number(row?.searchClick || 0)
      const detailExposure = Number(row?.detailExposure || 0)
      const detailClick = Number(row?.detailClick || 0)
      const detailAddCart = Number(row?.detailAddCart || 0)
      const detailPayConversion = Number(row?.detailPayConversion || 0)
      return {
        __sheet_name: DETAIL_SHEET,
        记录类型: '数据明细',
        表格行号: context.表格行号 || '',
        款号: context.款号 || '',
        商品ID: itemId,
        商品标题: context.商品标题 || '',
        任务ID: compact(row?.experimentTaskId || row?.taskId || context.任务ID || ''),
        测试状态: context.测试状态 || '',
        测试渠道: context.测试渠道 || '',
        测试素材数: context.测试素材数 || '',
        统计口径: compact(statisticType),
        统计日期: compact(row?.statisticDate),
        图片类型: compact(row?.imageType),
        素材ID: compact(row?.materialId),
        素材比例: compact(row?.materialRatio),
        素材占比: compact(row?.materialPercent ?? row?.percent ?? ''),
        素材URL: normalizeRemoteUrl(row?.materialUrl || row?.imageUrl || ''),
        搜索曝光: searchExposure,
        搜索点击: searchClick,
        搜索点击率: formatPercent(searchClick, searchExposure),
        详情曝光: detailExposure,
        详情点击: detailClick,
        详情点击率: formatPercent(detailClick, detailExposure),
        详情加购: detailAddCart,
        详情支付转化: detailPayConversion,
        详情支付转化率: formatPercent(detailPayConversion, detailExposure),
        执行结果: '已读取数据',
        备注: '',
      }
    })
  }

  function sourceRowsFromTaskRows(taskRows) {
    const rows = []
    const seen = new Set()
    for (const row of Array.isArray(taskRows) ? taskRows : []) {
      const itemId = normalizeItemId(row?.商品ID)
      if (!itemId) continue
      const taskId = compact(row?.任务ID)
      const key = `${itemId}:${taskId}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({
        表格行号: row?.表格行号 || '',
        款号: row?.款号 || '',
        商品ID: itemId,
        商品标题: compact(row?.商品标题),
        任务ID: taskId,
        测试状态: compact(row?.测试状态),
        测试渠道: compact(row?.测试渠道),
        测试素材数: row?.测试素材数 || '',
        素材URL: normalizeRemoteUrl(row?.素材URL || row?.最优素材 || ''),
        __listMaterials: Array.isArray(row?.__listMaterials) ? row.__listMaterials : [],
      })
    }
    return rows
  }

  function addOverviewRows(targetRows, taskRows) {
    for (const row of Array.isArray(taskRows) ? taskRows : []) {
      targetRows.push({
        ...row,
        __sheet_name: OVERVIEW_SHEET,
      })
    }
  }

  function addNoDetailFallbackRows(targetRows, sourceRows, itemIdsWithDetail) {
    for (const sourceRow of Array.isArray(sourceRows) ? sourceRows : []) {
      const itemId = normalizeItemId(sourceRow?.商品ID)
      if (!itemId || itemIdsWithDetail.has(itemId)) continue
      const listMaterials = Array.isArray(sourceRow?.__listMaterials) ? sourceRow.__listMaterials : []
      if (listMaterials.length) {
        targetRows.push(...listMaterials.map(row => ({
          ...row,
          __sheet_name: DETAIL_SHEET,
          执行结果: '任务列表素材',
          备注: row.备注 || '数据下载接口未返回明细，已回退到任务列表素材',
        })))
        continue
      }
      targetRows.push({
        __sheet_name: DETAIL_SHEET,
        记录类型: '数据为空',
        表格行号: sourceRow.表格行号 || '',
        款号: sourceRow.款号 || '',
        商品ID: itemId,
        商品标题: sourceRow.商品标题 || '',
        任务ID: sourceRow.任务ID || '',
        测试状态: sourceRow.测试状态 || '',
        测试渠道: sourceRow.测试渠道 || '',
        测试素材数: sourceRow.测试素材数 || '',
        执行结果: '数据为空',
        备注: '任务列表存在匹配任务，但数据下载接口未返回该商品明细',
      })
    }
  }

  function extractDownloadRows(payload) {
    return extractArray(payload, [
      'list',
      'rows',
      'dataList',
      'data',
      'data.list',
      'data.rows',
      'data.dataList',
      'result.dataList',
      'result.list',
      'result.rows',
      'data.result.dataList',
      'data.result.list',
      'data.result.rows',
      'result',
    ])
  }

  function findDownloadUrl(payload, seen = new Set()) {
    if (!payload) return ''
    if (typeof payload === 'string') {
      const url = normalizeRemoteUrl(payload)
      return /^https?:\/\//i.test(url) ? url : ''
    }
    if (typeof payload !== 'object' || seen.has(payload)) return ''
    seen.add(payload)
    for (const key of ['url', 'downloadUrl', 'fileUrl', 'href']) {
      const found = findDownloadUrl(payload[key], seen)
      if (found) return found
    }
    if (Array.isArray(payload)) {
      for (const item of payload) {
        const found = findDownloadUrl(item, seen)
        if (found) return found
      }
    } else {
      for (const item of Object.values(payload)) {
        const found = findDownloadUrl(item, seen)
        if (found) return found
      }
    }
    return ''
  }

  function mergeSourceRows(existingRows = [], nextRows = []) {
    const rows = []
    const seen = new Set()
    for (const row of [...(Array.isArray(existingRows) ? existingRows : []), ...(Array.isArray(nextRows) ? nextRows : [])]) {
      const itemId = normalizeItemId(row?.商品ID)
      if (!itemId) continue
      const taskId = compact(row?.任务ID)
      const key = `${itemId}:${taskId}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({
        ...row,
        商品ID: itemId,
        任务ID: taskId,
        __listMaterials: Array.isArray(row?.__listMaterials) ? row.__listMaterials : [],
      })
    }
    return rows
  }

  function buildContextByItem(sourceRows) {
    const context = new Map()
    for (const sourceRow of Array.isArray(sourceRows) ? sourceRows : []) {
      const itemId = normalizeItemId(sourceRow?.商品ID)
      if (itemId) context.set(itemId, sourceRow)
    }
    return context
  }

  function mergeShared(next = {}) {
    return {
      ...shared,
      ...(next || {}),
    }
  }

  function baseProgressShared(next = {}) {
    const totalRows = Math.max(0, Number(next.total_rows ?? shared.total_rows ?? 0) || 0)
    const currentExecNo = Math.max(0, Number(next.current_exec_no ?? shared.current_exec_no ?? 0) || 0)
    return {
      total_rows: totalRows,
      current_exec_no: totalRows > 0 ? Math.min(currentExecNo, totalRows) : currentExecNo,
      current_row_no: Math.max(0, Number(next.current_row_no ?? shared.current_row_no ?? 0) || 0),
      batch_no: Math.max(0, Number(next.batch_no ?? shared.batch_no ?? 0) || 0),
      total_batches: Math.max(0, Number(next.total_batches ?? shared.total_batches ?? 0) || 0),
      current_store: compact(next.current_store ?? shared.current_store),
      detail_records_collected: Math.max(0, Number(next.detail_records_collected ?? shared.detail_records_collected ?? 0) || 0),
    }
  }

  function buildListProgressShared(next = {}) {
    const base = baseProgressShared(next)
    return {
      ...base,
      list_total_rows: Math.max(0, Number(next.list_total_rows ?? next.total_rows ?? shared.list_total_rows ?? shared.total_rows ?? 0) || 0),
      list_completed_rows: Math.max(0, Number(next.list_completed_rows ?? next.current_exec_no ?? shared.list_completed_rows ?? shared.current_exec_no ?? 0) || 0),
      list_total_batches: Math.max(0, Number(next.list_total_batches ?? next.total_batches ?? shared.list_total_batches ?? shared.total_batches ?? 0) || 0),
      list_completed_batches: Math.max(0, Number(next.list_completed_batches ?? next.batch_no ?? shared.list_completed_batches ?? shared.batch_no ?? 0) || 0),
      detail_total_targets: Math.max(0, Number(next.detail_total_targets ?? shared.detail_total_targets ?? 0) || 0),
      detail_completed_targets: Math.max(0, Number(next.detail_completed_targets ?? shared.detail_completed_targets ?? 0) || 0),
      detail_current_target_index: Math.max(0, Number(next.detail_current_target_index ?? shared.detail_current_target_index ?? 0) || 0),
      detail_current_target: compact(next.detail_current_target ?? shared.detail_current_target),
    }
  }

  function buildDownloadProgressShared(sourceRows = [], next = {}) {
    const total = Array.isArray(sourceRows) ? sourceRows.length : 0
    const completed = Math.min(Math.max(0, Number(next.detail_completed_targets ?? shared.detail_completed_targets ?? 0) || 0), total || Number.MAX_SAFE_INTEGER)
    const target = Array.isArray(sourceRows) && sourceRows[completed] ? sourceRows[completed] : {}
    return {
      ...baseProgressShared({
        total_rows: total,
        current_exec_no: completed,
        current_row_no: completed,
        current_store: '下载测图数据',
        detail_records_collected: next.detail_records_collected,
      }),
      list_total_rows: Math.max(0, Number(shared.list_total_rows || total || 0)),
      list_completed_rows: Math.max(0, Number(shared.list_completed_rows || total || 0)),
      detail_total_targets: total,
      detail_completed_targets: completed,
      detail_current_target_index: total ? Math.min(completed + 1, total) : 0,
      detail_current_target: normalizeItemId(target?.商品ID),
      detail_records_collected: Math.max(0, Number(next.detail_records_collected ?? shared.detail_records_collected ?? 0) || 0),
    }
  }

  function currentHref() {
    return String(window.location?.href || globalThis.location?.href || '')
  }

  function isTmallMaterialPage() {
    return /^https:\/\/(?:myseller|qn)\.taobao\.com\/(?:[^?#]*\/)?material-center\/material-test(?:[/?#]|$)/i.test(currentHref())
  }

  function complete(data = [], newShared = shared, hasMore = false, sleepMs = 0) {
    return {
      success: true,
      data,
      meta: {
        action: 'complete',
        has_more: !!hasMore,
        sleep_ms: sleepMs,
        shared: newShared,
      },
    }
  }

  function nextPhase(name, data = [], newShared = shared, sleepMs = 0) {
    return {
      success: true,
      data,
      meta: {
        action: 'next_phase',
        next_phase: name,
        sleep_ms: sleepMs,
        shared: newShared,
      },
    }
  }

  function exposeHelpers() {
    if (!testExports) return
    Object.assign(testExports, {
      resolveCaptureScope,
      normalizeSourceRows,
      buildSearchTasksPayload,
      buildDownloadDataPayload,
      normalizeTmallTaskRows,
      filterTaskRowsForExport,
      normalizeDownloadDataRows,
      sourceRowsFromTaskRows,
      flattenTaskListMaterials,
      addNoDetailFallbackRows,
      normalizeStatusValue,
      collectMaterialTestTasks,
      chunkArray,
      extractDownloadRows,
      findDownloadUrl,
      mergeSourceRows,
      buildListProgressShared,
      buildDownloadProgressShared,
      currentHref,
      isTmallMaterialPage,
    })
  }

  exposeHelpers()
  if (phase === '__exports__') return complete([], shared)

  try {
    if (!isTmallMaterialPage()) {
      return complete([{
        执行结果: '未在支持页面',
        备注: `请在天猫素材测试页运行；当前 ${currentHref() || 'unknown'}`,
      }], shared)
    }

    const statisticType = compact(params.statistic_type || params.download_statistic_type || 'ACCUMULATE_30_DAYS')
    const defaults = defaultDateRange()
    const startDate = compact(params.start_date || params.download_start_date || defaults.startDate)
    const endDate = compact(params.end_date || params.download_end_date || defaults.endDate)
    const testStatus = normalizeStatusValue(params.test_status === undefined ? '1' : params.test_status)
    const testChannel = params.test_channel || 'common_search'
    const pageSize = Math.max(1, Math.min(100, Number(params.page_size || DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE))
    const maxPages = Math.max(1, Number(params.max_pages || 200) || 200)
    const downloadChunkSize = Math.max(1, Number(params.download_chunk_size || 20) || 20)
    const captureScope = resolveCaptureScope(params)
    const runContext = {
      capture_scope: captureScope,
      statistic_type: statisticType,
      start_date: startDate,
      end_date: endDate,
      test_status: testStatus,
      test_channel: testChannel,
    }

    if (phase === 'main') {
      const inputSourceRows = normalizeSourceRows(params)
      if (!inputSourceRows.length) {
        return nextPhase('collect_full_list_page', [], mergeShared({
          ...runContext,
          source_rows: [],
          full_list_page: 1,
          full_raw_rows_seen: 0,
          full_list_total: 0,
          ...buildListProgressShared({
            total_rows: 0,
            current_exec_no: 0,
            current_store: '全量抓取测图任务',
          }),
        }))
      }

      return nextPhase('search_source_item', [], mergeShared({
        ...runContext,
        input_source_rows: inputSourceRows,
        source_rows: [],
        search_index: 0,
        ...buildListProgressShared({
          total_rows: inputSourceRows.length,
          current_exec_no: 0,
          current_store: captureScope === 'file' ? '按表格查询测图任务' : '按商品ID查询测图任务',
        }),
      }))
    }

    if (phase === 'collect_full_list_page') {
      const currentPage = Math.max(1, Number(shared.full_list_page || 1) || 1)
      const rows = []
      try {
        const result = await searchMaterialTestTasks('', {
          testStatus,
          testChannel,
          currentPage,
          pageSize,
        })
        const pageRows = Array.isArray(result.rows) ? result.rows : []
        const taskRows = filterTaskRowsForExport(normalizeTmallTaskRows(pageRows, {}), {
          testStatus,
          testChannel,
        })
        addOverviewRows(rows, taskRows)
        const sourceRows = mergeSourceRows(shared.source_rows, sourceRowsFromTaskRows(taskRows))
        const rawRowsSeen = Math.max(0, Number(shared.full_raw_rows_seen || 0) || 0) + pageRows.length
        const totalRows = Math.max(rawRowsSeen, Number(shared.full_list_total || 0) || 0, Number(result.total || 0) || 0)
        const totalBatches = totalRows > 0 ? Math.ceil(totalRows / pageSize) : currentPage
        const hasMoreListPages = Boolean(
          pageRows.length &&
          currentPage < maxPages &&
          (
            (totalRows > 0 && rawRowsSeen < totalRows) ||
            pageRows.length >= pageSize
          )
        )
        const nextShared = mergeShared({
          ...runContext,
          source_rows: sourceRows,
          full_list_page: currentPage + 1,
          full_raw_rows_seen: rawRowsSeen,
          full_list_total: totalRows,
          ...buildListProgressShared({
            total_rows: totalRows,
            current_exec_no: Math.min(rawRowsSeen, totalRows || rawRowsSeen),
            current_row_no: rawRowsSeen,
            total_batches: totalBatches,
            batch_no: currentPage,
            list_total_rows: totalRows,
            list_completed_rows: Math.min(rawRowsSeen, totalRows || rawRowsSeen),
            list_total_batches: totalBatches,
            list_completed_batches: Math.min(currentPage, totalBatches || currentPage),
            current_store: '全量抓取测图任务',
          }),
        })

        if (hasMoreListPages) {
          return nextPhase('collect_full_list_page', rows, nextShared)
        }

        if (!sourceRows.length && !rows.length) {
          rows.push({
            __sheet_name: OVERVIEW_SHEET,
            记录类型: '任务概览',
            测试状态: getStatusLabel(testStatus),
            执行结果: '未找到任务',
            备注: `total=${result.total}`,
          })
        }

        if (!sourceRows.length) {
          return complete(rows, {
            ...nextShared,
            total_rows: 0,
            current_exec_no: 0,
          })
        }

        return nextPhase('download_data_chunk', rows, mergeShared({
          ...nextShared,
          download_chunk_index: 0,
          item_ids_with_detail: [],
          ...buildDownloadProgressShared(sourceRows, {
            detail_completed_targets: 0,
            detail_records_collected: 0,
          }),
        }))
      } catch (error) {
        return complete([{
          __sheet_name: OVERVIEW_SHEET,
          记录类型: '任务概览',
          执行结果: '任务查询失败',
          备注: describeError(error),
        }], mergeShared({
          ...runContext,
          ...buildListProgressShared({
            total_rows: 0,
            current_exec_no: 0,
            current_store: '全量抓取测图任务',
          }),
        }))
      }
    }

    if (phase === 'search_source_item') {
      const inputSourceRows = Array.isArray(shared.input_source_rows) ? shared.input_source_rows : normalizeSourceRows(params)
      if (!inputSourceRows.length) {
        return complete([{
          __sheet_name: OVERVIEW_SHEET,
          记录类型: '任务概览',
          执行结果: '未找到任务',
          备注: '当前抓取范围没有可查询的商品 ID',
        }], mergeShared({
          ...runContext,
          total_rows: 0,
          current_exec_no: 0,
        }))
      }

      const index = Math.max(0, Number(shared.search_index || 0) || 0)
      const sourceRow = inputSourceRows[index]
      const rows = []
      let sourceRows = mergeSourceRows(shared.source_rows, [])
      try {
        const result = await searchMaterialTestTasks(sourceRow.商品ID, {
          testStatus,
          testChannel,
          pageSize,
        })
        const taskRows = filterTaskRowsForExport(normalizeTmallTaskRows(result.rows, sourceRow), {
          testStatus,
          testChannel,
        })
        if (taskRows.length) {
          addOverviewRows(rows, taskRows)
          sourceRows = mergeSourceRows(sourceRows, sourceRowsFromTaskRows(taskRows))
        } else {
          rows.push({
            __sheet_name: OVERVIEW_SHEET,
            记录类型: '任务概览',
            ...sourceRow,
            执行结果: '未找到任务',
            备注: `total=${result.total}`,
          })
        }
      } catch (error) {
        rows.push({
          __sheet_name: OVERVIEW_SHEET,
          记录类型: '任务概览',
          ...sourceRow,
          执行结果: '任务查询失败',
          备注: describeError(error),
        })
      }

      const completed = Math.min(index + 1, inputSourceRows.length)
      const nextShared = mergeShared({
        ...runContext,
        input_source_rows: inputSourceRows,
        source_rows: sourceRows,
        search_index: index + 1,
        ...buildListProgressShared({
          total_rows: inputSourceRows.length,
          current_exec_no: completed,
          current_row_no: sourceRow.表格行号 || completed,
          list_total_rows: inputSourceRows.length,
          list_completed_rows: completed,
          current_store: captureScope === 'file' ? '按表格查询测图任务' : '按商品ID查询测图任务',
          detail_total_targets: sourceRows.length,
          detail_completed_targets: 0,
        }),
      })

      if (index + 1 < inputSourceRows.length) {
        return nextPhase('search_source_item', rows, nextShared)
      }

      if (!sourceRows.length) {
        return complete(rows.length ? rows : [{
          __sheet_name: OVERVIEW_SHEET,
          记录类型: '任务概览',
          执行结果: '未找到任务',
          备注: '当前筛选条件下没有可导出的测图商品',
        }], nextShared)
      }

      return nextPhase('download_data_chunk', rows, mergeShared({
        ...nextShared,
        download_chunk_index: 0,
        item_ids_with_detail: [],
        ...buildDownloadProgressShared(sourceRows, {
          detail_completed_targets: 0,
          detail_records_collected: 0,
        }),
      }))
    }

    if (phase === 'download_data_chunk') {
      const sourceRows = mergeSourceRows(shared.source_rows, [])
      const contextByItem = buildContextByItem(sourceRows)
      const itemIdsForDownload = Array.from(new Set(sourceRows.map(row => normalizeItemId(row.商品ID)).filter(Boolean)))
      const itemIdChunks = chunkArray(itemIdsForDownload, downloadChunkSize)
      const chunkIndex = Math.max(0, Number(shared.download_chunk_index || 0) || 0)
      const itemIds = itemIdChunks[chunkIndex] || []
      if (!itemIds.length) {
        return nextPhase('finalize_fallback', [], mergeShared({
          ...runContext,
          source_rows: sourceRows,
          item_ids_with_detail: Array.isArray(shared.item_ids_with_detail) ? shared.item_ids_with_detail : [],
          ...buildDownloadProgressShared(sourceRows, {
            detail_completed_targets: sourceRows.length,
            detail_records_collected: Number(shared.detail_records_collected || 0),
          }),
        }))
      }

      const rows = []
      const itemIdsWithDetail = new Set(Array.isArray(shared.item_ids_with_detail) ? shared.item_ids_with_detail : [])
      let detailRecordsCollected = Math.max(0, Number(shared.detail_records_collected || 0) || 0)
      try {
        const payload = await downloadMaterialTestData(itemIds, statisticType, startDate, endDate)
        const dataRows = normalizeDownloadDataRows(extractDownloadRows(payload), statisticType, contextByItem)
        detailRecordsCollected += dataRows.length
        if (dataRows.length) {
          for (const row of dataRows) {
            const itemId = normalizeItemId(row?.商品ID)
            if (itemId) itemIdsWithDetail.add(itemId)
          }
          rows.push(...dataRows)
        } else if (findDownloadUrl(payload)) {
          rows.push({
            __sheet_name: DETAIL_SHEET,
            记录类型: '接口返回',
            统计口径: statisticType,
            统计日期: `${startDate}-${endDate}`,
            数据下载链接: findDownloadUrl(payload),
            执行结果: '接口已返回',
            备注: `第 ${chunkIndex + 1}/${itemIdChunks.length} 批未解析到明细行；若返回下载链接已记录在“数据下载链接”列`,
          })
        }
      } catch (error) {
        for (const itemId of itemIds) {
          const context = contextByItem.get(itemId) || {}
          rows.push({
            __sheet_name: DETAIL_SHEET,
            记录类型: '数据读取失败',
            表格行号: context.表格行号 || '',
            款号: context.款号 || '',
            商品ID: itemId,
            商品标题: context.商品标题 || '',
            任务ID: context.任务ID || '',
            测试状态: context.测试状态 || '',
            测试渠道: context.测试渠道 || '',
            测试素材数: context.测试素材数 || '',
            统计口径: statisticType,
            统计日期: `${startDate}-${endDate}`,
            执行结果: '数据读取失败',
            备注: `第 ${chunkIndex + 1}/${itemIdChunks.length} 批：${describeError(error)}`,
          })
        }
      }

      const completedTargets = Math.min((chunkIndex + 1) * downloadChunkSize, itemIdsForDownload.length || sourceRows.length)
      const nextShared = mergeShared({
        ...runContext,
        source_rows: sourceRows,
        download_chunk_index: chunkIndex + 1,
        download_chunk_total: itemIdChunks.length,
        item_ids_with_detail: Array.from(itemIdsWithDetail),
        ...buildDownloadProgressShared(sourceRows, {
          detail_completed_targets: completedTargets,
          detail_records_collected: detailRecordsCollected,
        }),
      })

      if (chunkIndex + 1 < itemIdChunks.length) {
        return nextPhase('download_data_chunk', rows, nextShared)
      }

      return nextPhase('finalize_fallback', rows, nextShared)
    }

    if (phase === 'finalize_fallback') {
      const sourceRows = mergeSourceRows(shared.source_rows, [])
      const rows = []
      addNoDetailFallbackRows(rows, sourceRows, new Set(Array.isArray(shared.item_ids_with_detail) ? shared.item_ids_with_detail : []))
      return complete(rows, mergeShared({
        ...runContext,
        source_rows: sourceRows,
        ...buildDownloadProgressShared(sourceRows, {
          detail_completed_targets: sourceRows.length,
          detail_records_collected: Number(shared.detail_records_collected || 0),
        }),
      }))
    }

    return { success: false, error: `未知执行阶段：${phase}` }
  } catch (error) {
    return { success: false, error: describeError(error, '天猫测图数据抓取导出失败') }
  }
})()
