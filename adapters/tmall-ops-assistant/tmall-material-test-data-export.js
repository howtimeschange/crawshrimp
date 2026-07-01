;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const DEFAULT_PAGE_SIZE = 20
  const STATUS_LABELS = {
    '-1': '已暂停',
    0: '未开始',
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

  function formatPercent(numerator, denominator) {
    const top = Number(numerator)
    const bottom = Number(denominator)
    if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= 0) return ''
    return `${((top / bottom) * 100).toFixed(2)}%`
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
    if (filters.testStatus !== undefined && filters.testStatus !== null && filters.testStatus !== '') {
      paramsPayload.testStatus = String(filters.testStatus)
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

  function normalizeSourceRows(rawParams = params) {
    const rows = []
    const seen = new Set()
    const seenItemIds = new Set()
    const inputRows = Array.isArray(rawParams.input_file?.rows) ? rawParams.input_file.rows : []
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
    for (const itemId of parseListInput(rawParams.item_ids || rawParams.item_id || rawParams.itemId)) {
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

  function normalizeTmallTaskRows(inputRows, sourceRow = {}) {
    const rows = []
    for (const row of Array.isArray(inputRows) ? inputRows : []) {
      const itemId = compact(row?.domainId || row?.itemId || row?.id || sourceRow.商品ID)
      const title = compact(row?.head?.itemTitle || row?.head?.title || row?.itemTitle || row?.title)
      const testData = row?.columns?.test_data || row?.test_data || row?.testData || {}
      const dataList = Array.isArray(testData?.dataList) ? testData.dataList : Array.isArray(testData) ? testData : []
      if (!dataList.length) {
        rows.push({
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
        rows.push({
          表格行号: sourceRow.表格行号 || '',
          款号: sourceRow.款号 || '',
          商品ID: itemId,
          商品标题: title,
          任务ID: compact(item?.experimentTaskId || item?.taskId || item?.id),
          测试状态: getStatusLabel(item?.testStatus || item?.status),
          测试渠道: getSourceLabel(item?.imageTestSource || item?.source || item?.testChannel),
          素材URL: normalizeRemoteUrl(item?.bestTestImage?.imageUrl || item?.bestImage?.imageUrl || item?.bestTestImageUrl || ''),
          测试素材数: count,
          执行结果: '已读取任务',
          备注: '',
        })
      }
    }
    return rows
  }

  function filterTaskRowsForExport(taskRows, filters = {}) {
    const wantedSource = getSourceLabel(filters.testChannel || filters.source || 'common_search')
    const wantedStatus = filters.testStatus === undefined || filters.testStatus === null || filters.testStatus === ''
      ? ''
      : getStatusLabel(filters.testStatus)
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
      return {
        表格行号: context.表格行号 || '',
        款号: context.款号 || '',
        商品ID: itemId,
        商品标题: context.商品标题 || '',
        任务ID: compact(row?.experimentTaskId || row?.taskId || context.任务ID || ''),
        统计口径: compact(statisticType),
        统计日期: compact(row?.statisticDate),
        图片类型: compact(row?.imageType),
        素材ID: compact(row?.materialId),
        素材比例: compact(row?.materialRatio),
        素材URL: normalizeRemoteUrl(row?.materialUrl || row?.imageUrl || ''),
        搜索曝光: searchExposure,
        搜索点击: searchClick,
        搜索点击率: formatPercent(searchClick, searchExposure),
        详情曝光: detailExposure,
        详情点击: detailClick,
        详情点击率: formatPercent(detailClick, detailExposure),
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
      })
    }
    return rows
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

  function isTmallMaterialPage() {
    return /^https:\/\/myseller\.taobao\.com\//i.test(String(window.location?.href || globalThis.location?.href || ''))
  }

  function complete(data = [], newShared = shared) {
    return {
      success: true,
      data,
      meta: {
        action: 'complete',
        has_more: false,
        shared: newShared,
      },
    }
  }

  function exposeHelpers() {
    if (!testExports) return
    Object.assign(testExports, {
      normalizeSourceRows,
      buildSearchTasksPayload,
      buildDownloadDataPayload,
      normalizeTmallTaskRows,
      filterTaskRowsForExport,
      normalizeDownloadDataRows,
      sourceRowsFromTaskRows,
      collectMaterialTestTasks,
      chunkArray,
      extractDownloadRows,
      findDownloadUrl,
    })
  }

  exposeHelpers()
  if (phase === '__exports__') return complete([], shared)

  try {
    if (!isTmallMaterialPage()) {
      return complete([{
        执行结果: '未在支持页面',
        备注: '请在天猫素材测试页运行',
      }], shared)
    }

    const statisticType = compact(params.statistic_type || params.download_statistic_type || 'ACCUMULATE_30_DAYS')
    const defaults = defaultDateRange()
    const startDate = compact(params.start_date || params.download_start_date || defaults.startDate)
    const endDate = compact(params.end_date || params.download_end_date || defaults.endDate)
    const testStatus = params.test_status === undefined ? '1' : params.test_status
    const rows = []
    const contextByItem = new Map()
    let sourceRows = normalizeSourceRows(params)

    if (!sourceRows.length) {
      try {
        const result = await collectMaterialTestTasks({
          testStatus,
          testChannel: params.test_channel || 'common_search',
          pageSize: params.page_size || DEFAULT_PAGE_SIZE,
          maxPages: params.max_pages || 200,
        })
        const taskRows = filterTaskRowsForExport(normalizeTmallTaskRows(result.rows, {}), {
          testStatus,
          testChannel: params.test_channel || 'common_search',
        })
        sourceRows = sourceRowsFromTaskRows(taskRows)
        if (taskRows.length) rows.push(...taskRows)
        else rows.push({
          测试状态: getStatusLabel(testStatus),
          执行结果: '未找到任务',
          备注: `total=${result.total}`,
        })
      } catch (error) {
        rows.push({
          执行结果: '任务查询失败',
          备注: describeError(error),
        })
      }
    } else {
      for (const sourceRow of sourceRows) {
        contextByItem.set(sourceRow.商品ID, sourceRow)
        try {
          const result = await searchMaterialTestTasks(sourceRow.商品ID, {
            testStatus,
            testChannel: params.test_channel || 'common_search',
            pageSize: params.page_size || DEFAULT_PAGE_SIZE,
          })
          const taskRows = filterTaskRowsForExport(normalizeTmallTaskRows(result.rows, sourceRow), {
            testStatus,
            testChannel: params.test_channel || 'common_search',
          })
          if (taskRows.length) rows.push(...taskRows)
          else rows.push({
            ...sourceRow,
            执行结果: '未找到任务',
            备注: `total=${result.total}`,
          })
        } catch (error) {
          rows.push({
            ...sourceRow,
            执行结果: '任务查询失败',
            备注: describeError(error),
          })
        }
      }
    }

    for (const sourceRow of sourceRows) {
      if (!contextByItem.has(sourceRow.商品ID)) contextByItem.set(sourceRow.商品ID, sourceRow)
    }

    if (!sourceRows.length) {
      return complete(rows.length ? rows : [{
        执行结果: '未找到任务',
        备注: '当前筛选条件下没有可导出的测图商品',
      }], {
        ...shared,
        total_rows: 0,
        statistic_type: statisticType,
        start_date: startDate,
        end_date: endDate,
      })
    }

    const itemIdChunks = chunkArray(sourceRows.map(row => row.商品ID), params.download_chunk_size || 20)
    for (const [chunkIndex, itemIds] of itemIdChunks.entries()) {
      try {
        const payload = await downloadMaterialTestData(itemIds, statisticType, startDate, endDate)
        const dataRows = normalizeDownloadDataRows(extractDownloadRows(payload), statisticType, contextByItem)
        if (dataRows.length) {
          rows.push(...dataRows)
        } else {
          rows.push({
            统计口径: statisticType,
            统计日期: `${startDate}-${endDate}`,
            数据下载链接: findDownloadUrl(payload),
            执行结果: '接口已返回',
            备注: `第 ${chunkIndex + 1}/${itemIdChunks.length} 批未解析到明细行；若返回下载链接已记录在“数据下载链接”列`,
          })
        }
      } catch (error) {
        rows.push({
          统计口径: statisticType,
          统计日期: `${startDate}-${endDate}`,
          执行结果: '数据读取失败',
          备注: `第 ${chunkIndex + 1}/${itemIdChunks.length} 批：${describeError(error)}`,
        })
      }
    }

    return complete(rows, {
      ...shared,
      total_rows: sourceRows.length,
      statistic_type: statisticType,
      start_date: startDate,
      end_date: endDate,
    })
  } catch (error) {
    return { success: false, error: describeError(error, '天猫测图数据抓取导出失败') }
  }
})()
