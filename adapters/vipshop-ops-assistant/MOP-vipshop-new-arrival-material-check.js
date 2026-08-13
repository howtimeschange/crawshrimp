;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const SUMMARY_SHEET = '执行摘要'
  const DETAIL_SHEET = '上新资料检查明细'
  const VIPSHOP_ENTRY_URL = 'https://nov-admin.vip.com/admin/index.html#/normal/normalMerchandise'
  const MERCHANDISE_QUERY_URL = 'https://nov-admin.vip.com/normal/normalMerchandiseQuery'
  const PDC_PRODUCT_DETAIL_URL = 'https://pdc-portal.vip.com/product/queryVendorProductByVpIdForVc'
  const DEFAULT_PAGE_SIZE = 500
  const DEFAULT_MAX_PAGES = 100

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
    const pushRows = items => {
      for (const row of Array.isArray(items) ? items : []) {
        if (!row || typeof row !== 'object') continue
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

  function parseMoney(value) {
    const text = compact(value).replace(/[￥¥,]/g, '')
    if (!text) return null
    const match = text.match(/-?\d+(?:\.\d+)?/)
    if (!match) return null
    const number = Number(match[0])
    return Number.isFinite(number) ? number : null
  }

  function formatMoney(value) {
    if (value === undefined || value === null || compact(value) === '') return ''
    const number = Number(value)
    if (!Number.isFinite(number)) return ''
    return number.toFixed(2)
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

  function parseJobs(rawParams = params) {
    const sourceRows = collectFileRows(rawParams.input_file || rawParams.new_arrival_file || { rows: rawParams.rows || [] })
    const jobs = []
    const invalidRows = []
    const seen = new Set()
    sourceRows.forEach((row, index) => {
      const rowNo = Number(row.__row_number || row.row_number || row.行号 || index + 2)
      const styleCode = normalizeCode(rowValue(row, ['款号', '商品款号', '大货款号', 'styleCode', 'style_code', 'osn', 'sn']))
      const goodsCode = normalizeCode(rowValue(row, ['货号', '商品货号', '款色号', '色号', 'goodsCode', 'goods_code', 'msn', 'colourGSN']))
      const tagPrice = parseMoney(rowValue(row, [
        '吊牌价',
        '市场价',
        '市场价/吊牌价',
        '吊牌价/市场价',
        '牌价',
        '建议零售价',
        'tagPrice',
        'marketPrice',
      ]))
      if (!styleCode && !goodsCode) {
        invalidRows.push(buildCheckRow({ rowNo }, null, null, '输入校验', '失败', '缺少款号或货号'))
        return
      }
      const key = `${styleCode || '*'}|${goodsCode || '*'}`
      if (seen.has(key)) {
        return
      }
      seen.add(key)
      jobs.push({ rowNo, styleCode, goodsCode, expectedPrice: tagPrice, raw: row })
    })
    return { jobs, invalidRows, totalRows: sourceRows.length }
  }

  function buildMerchandiseQueryPayloadForJobs(jobs, pageNo = 1, pageSize = DEFAULT_PAGE_SIZE) {
    const goodsCodes = Array.from(new Set((jobs || []).map(job => job.goodsCode).filter(Boolean)))
    const styleCodes = Array.from(new Set((jobs || []).filter(job => !job.goodsCode).map(job => job.styleCode).filter(Boolean)))
    const param = {}
    if (goodsCodes.length) param.msnSet = goodsCodes
    if (styleCodes.length) param.osn = styleCodes
    return { pageNo, pageSize, param }
  }

  function buildProductDetailPayload(vendorProductId, vendorType = 1) {
    return new URLSearchParams({
      vendorProductId: compact(vendorProductId),
      vendorType: String(vendorType || 1),
    }).toString()
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

  async function postForm(url, formBody) {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: formBody,
    })
    const text = await response.text()
    let json
    try {
      json = JSON.parse(text)
    } catch (error) {
      throw new Error(`${url} 返回非 JSON：${text.slice(0, 160)}`)
    }
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}：${compact(json.msg || text.slice(0, 160))}`)
    if (json.code && String(json.code) !== '200') throw new Error(`${url} 返回 code=${json.code}：${compact(json.msg || json.message || '接口失败')}`)
    return json
  }

  async function queryMerchandiseRows(jobs, rawParams = params) {
    const pageSize = Math.max(1, Math.min(500, Number(rawParams.page_size || DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE))
    const maxPages = Math.max(1, Math.min(100, Number(rawParams.max_pages || DEFAULT_MAX_PAGES) || DEFAULT_MAX_PAGES))
    const rows = []
    let total = null
    for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
      const json = await postJson(MERCHANDISE_QUERY_URL, buildMerchandiseQueryPayloadForJobs(jobs, pageNo, pageSize))
      const pageRows = Array.isArray(json?.data) ? json.data : []
      const reportedTotal = Number(json?.total || 0)
      if (Number.isFinite(reportedTotal) && reportedTotal > 0 && total == null) total = reportedTotal
      rows.push(...pageRows)
      if (!pageRows.length) break
      if (total && rows.length >= total) break
      if (pageRows.length < pageSize) break
    }
    return rows
  }

  async function queryProductDetail(vendorProductId, vendorType = 1) {
    const json = await postForm(PDC_PRODUCT_DETAIL_URL, buildProductDetailPayload(vendorProductId, vendorType))
    return json.result || {}
  }

  function merchandiseRowKey(row) {
    return normalizeCode(row?.msn || row?.goodsNo || row?.货号)
  }

  function merchandiseStyleKey(row) {
    return normalizeCode(row?.osn || row?.sn || row?.styleCode || row?.款号)
  }

  function indexMerchandiseRows(rows) {
    const byGoods = new Map()
    const byStyle = new Map()
    for (const row of rows || []) {
      const goods = merchandiseRowKey(row)
      const style = merchandiseStyleKey(row)
      if (goods && !byGoods.has(goods)) byGoods.set(goods, row)
      if (style && !byStyle.has(style)) byStyle.set(style, [])
      if (style) byStyle.get(style).push(row)
    }
    return { byGoods, byStyle }
  }

  function imageSizeOf(image) {
    const direct = compact(image?.imageSize || image?.size)
    const match = direct.match(/(\d{2,5})\s*[xX*×]\s*(\d{2,5})/)
    if (match) return { width: Number(match[1]), height: Number(match[2]), text: `${Number(match[1])}x${Number(match[2])}` }
    const width = Number(image?.width || image?.imageWidth || image?.naturalWidth || 0)
    const height = Number(image?.height || image?.imageHeight || image?.naturalHeight || 0)
    return { width, height, text: width && height ? `${width}x${height}` : direct }
  }

  function imagesForColor(color, key) {
    if (!color) return []
    if (key === 'square') return Array.isArray(color.squareImages) ? color.squareImages : Array.isArray(color.squareMainImages) ? color.squareMainImages : []
    if (key === 'list') return Array.isArray(color.listImages) ? color.listImages : Array.isArray(color.listPics) ? color.listPics : []
    return []
  }

  function findMainSquare(color) {
    return imagesForColor(color, 'square').find(item => Number(item.imageIndex) === 1)
      || imagesForColor(color, 'square').find(item => item?.imageUrl)
      || null
  }

  function findListImage(color) {
    return imagesForColor(color, 'list').find(item => Number(item.imageIndex) === 50)
      || imagesForColor(color, 'square').find(item => Number(item.imageIndex) === 50)
      || imagesForColor(color, 'list').find(item => item?.imageUrl)
      || null
  }

  function mainImageIssue(color) {
    const image = findMainSquare(color)
    if (!image?.imageUrl) return '商品展示图缺失'
    const size = imageSizeOf(image)
    if (!size.width || !size.height) return `商品展示图无法识别尺寸${size.text ? `：${size.text}` : ''}`
    if (size.width !== size.height) return `商品展示图不是方图：${size.text}`
    return ''
  }

  function listImageIssue(color) {
    const image = findListImage(color)
    if (!image?.imageUrl) return '商品列表图缺失'
    const size = imageSizeOf(image)
    if (!size.width || !size.height) return `商品列表图无法识别尺寸${size.text ? `：${size.text}` : ''}`
    if (!(size.height > size.width)) return `商品列表图不是长图：${size.text}`
    return ''
  }

  function forbiddenIssue(merchandise = {}, product = {}, rawParams = params) {
    const keywords = compact(rawParams.forbidden_keywords || '禁售 禁止 不可售 停售 审核驳回 不通过')
      .split(/[\s,，、;；]+/)
      .map(compact)
      .filter(Boolean)
    const text = compact([
      merchandise.skuStatus,
      merchandise.skuStatusName,
      merchandise.status,
      merchandise.statusName,
      product.status,
      product.statusName,
      product.auditStatus,
      product.auditStatusName,
      product.rejectReason,
      product.reason,
      JSON.stringify(product.forbidInfo || product.forbiddenInfo || {}),
    ].join(' '))
    return keywords.find(keyword => text.includes(keyword)) ? `疑似涉及禁售/不可售：${text.slice(0, 160)}` : ''
  }

  function priceIssue(job, merchandise = {}, rawParams = params) {
    if (job.expectedPrice == null) return ''
    const actual = parseMoney(merchandise.marketPrice ?? merchandise.tagPrice ?? merchandise.市场价)
    if (actual == null) return '唯品市场价为空，无法比对吊牌价'
    const tolerance = Number(rawParams.price_tolerance || 0)
    if (Math.abs(actual - job.expectedPrice) <= tolerance) return ''
    return `市场价与运营表吊牌价不一致：唯品${formatMoney(actual)}，表格${formatMoney(job.expectedPrice)}`
  }

  function colorRows(job, merchandise, product, issuesPrefix = []) {
    const colors = Array.isArray(product?.itemSkuAttr) ? product.itemSkuAttr : []
    if (!colors.length) {
      return [buildCheckRow(job, merchandise, product, '颜色图片检查', '失败', [...issuesPrefix, 'PDC 未返回色号列表'].filter(Boolean).join('；'))]
    }
    return colors.map(color => {
      const issues = [
        ...issuesPrefix,
        mainImageIssue(color),
        listImageIssue(color),
      ].filter(Boolean)
      return buildCheckRow(job, merchandise, product, `图片规格检查/${compact(color.colourName || color.colourGSN)}`, issues.length ? '有问题' : '通过', issues.join('；'), color)
    })
  }

  function buildCheckRow(job = {}, merchandise = {}, product = {}, checkItem = '', result = '通过', note = '', color = {}) {
    return {
      __sheet_name: DETAIL_SHEET,
      表格行号: job.rowNo || '',
      款号: compact(job.styleCode || merchandise?.osn || product?.sn),
      货号: compact(job.goodsCode || merchandise?.msn || color?.colourGSN),
      运营表吊牌价: job.expectedPrice == null ? '' : formatMoney(job.expectedPrice),
      唯品市场价: formatMoney(parseMoney(merchandise?.marketPrice ?? merchandise?.tagPrice)),
      商品ID: compact(merchandise?.merchandiseNo),
      V_SPU: compact(merchandise?.vendorSpuId || product?.vendorProductId),
      商品名称: compact(merchandise?.name || product?.title),
      商品状态: normalizeVipshopStatus(firstPresent(product?.status, merchandise?.skuStatus)),
      色号: compact(color?.colourGSN),
      颜色: compact(color?.colourName || color?.aliasesName),
      检查项: checkItem,
      执行结果: result,
      问题说明: note,
      数据来源接口: '/normal/normalMerchandiseQuery；/product/queryVendorProductByVpIdForVc',
      备注: note,
    }
  }

  async function checkJob(job, indexed) {
    const merchandise = job.goodsCode
      ? indexed.byGoods.get(job.goodsCode)
      : (indexed.byStyle.get(job.styleCode) || [])[0]
    if (!merchandise) {
      return [buildCheckRow(job, null, null, '商品资料查询', '失败', '唯品商品资料未命中')]
    }
    const vendorProductId = compact(merchandise.vendorSpuId || merchandise.vendorProductId)
    if (!vendorProductId) {
      return [buildCheckRow(job, merchandise, null, 'PDC详情查询', '失败', '商品资料缺少 V_SPU/vendorProductId')]
    }
    let product = {}
    try {
      product = await queryProductDetail(vendorProductId, params.vendor_type || 1)
    } catch (error) {
      return [buildCheckRow(job, merchandise, null, 'PDC详情查询', '失败', error.message || String(error))]
    }
    const baseIssues = [
      priceIssue(job, merchandise, params),
      forbiddenIssue(merchandise, product, params),
    ].filter(Boolean)
    return colorRows(job, merchandise, product, baseIssues)
  }

  function summarizeRows(rows, parsed) {
    const detailRows = (rows || []).filter(row => row.__sheet_name === DETAIL_SHEET)
    const issueRows = detailRows.filter(row => row.执行结果 !== '通过')
    const problemStyles = new Set(issueRows.map(row => row.款号).filter(Boolean))
    const issueLines = buildIssueNotifyLines(issueRows)
    const body = [
      '### MOP 唯品商品上新资料检查',
      `- 输入行数：${parsed.totalRows}`,
      `- 有效检查款数：${parsed.jobs.length}`,
      `- 问题行数：${issueRows.length}`,
      `- 问题款号数：${problemStyles.size}`,
      issueRows.length ? '- 问题明细：' : '- 未发现市场价/禁售/图片规格问题',
      ...issueLines,
    ].filter(line => compact(line)).join('\n')
    return {
      __sheet_name: SUMMARY_SHEET,
      输入行数: parsed.totalRows,
      有效检查款数: parsed.jobs.length,
      问题行数: issueRows.length,
      问题款号数: problemStyles.size,
      执行结果: issueRows.length ? '发现问题' : '通过',
      备注: issueRows.length ? '有问题的款号已汇总，可通过钉钉同步运营。' : '未发现需要同步的问题。',
      __notify_title: 'MOP 唯品商品上新资料检查',
      __notify_body: body,
    }
  }

  function buildResultRows(detailRows, parsed) {
    const rows = Array.isArray(detailRows) ? detailRows : []
    return [...rows, summarizeRows(rows, parsed)]
  }

  function buildIssueNotifyLines(issueRows, limit = 12) {
    const lines = []
    const seen = new Set()
    let uniqueCount = 0
    for (const row of issueRows || []) {
      const rowNo = compact(row.表格行号)
      const styleCode = compact(row.款号) || '未填款号'
      const goodsCode = compact(row.货号)
      const checkItem = compact(row.检查项)
      const reason = compact(row.问题说明 || row.备注 || row.执行结果 || '未填写原因')
      const isRowLevelIssue = /市场价与运营表吊牌价不一致|疑似涉及禁售|输入表|缺少款号或货号|唯品商品资料未命中/.test(reason)
      const key = [rowNo, styleCode, goodsCode, isRowLevelIssue ? '' : checkItem, reason].join('|')
      if (seen.has(key)) continue
      seen.add(key)
      uniqueCount += 1

      if (lines.length >= limit) continue
      const target = goodsCode && goodsCode !== styleCode ? `${styleCode}/${goodsCode}` : styleCode
      const prefix = rowNo ? `第${rowNo}行 ${target}` : target
      const checkSuffix = checkItem && !isRowLevelIssue ? `（${checkItem}）` : ''
      lines.push(`- ${prefix}${checkSuffix}：${reason}`)
    }
    if (uniqueCount > limit) lines.push(`- 其余 ${uniqueCount - limit} 条问题详见结果表`)
    return lines
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
      parseJobs,
      buildMerchandiseQueryPayloadForJobs,
      imageSizeOf,
      mainImageIssue,
      listImageIssue,
      priceIssue,
      forbiddenIssue,
      buildCheckRow,
      summarizeRows,
      buildResultRows,
      buildIssueNotifyLines,
    })
  }

  exposeHelpers()
  if (phase === '__exports__') return complete([], shared)

  try {
    if (!/^https:\/\/nov-admin\.vip\.com\//i.test(String(location.href || ''))) return navigateTo(VIPSHOP_ENTRY_URL, 'main')
    const parsed = parseJobs(params)
    if (!parsed.totalRows) return complete(buildResultRows(parsed.invalidRows, parsed), shared)
    if (!parsed.jobs.length) return complete(buildResultRows(parsed.invalidRows, parsed), shared)
    const merchandiseRows = await queryMerchandiseRows(parsed.jobs, params)
    const indexed = indexMerchandiseRows(merchandiseRows)
    const outputRows = [...parsed.invalidRows]
    for (const job of parsed.jobs) {
      const rows = await checkJob(job, indexed)
      outputRows.push(...rows)
    }
    return complete(buildResultRows(outputRows, parsed), {
      ...shared,
      total_rows: parsed.jobs.length,
      issue_rows: outputRows.filter(row => row.执行结果 !== '通过').length,
      current_store: '唯品商品上新资料检查',
    })
  } catch (error) {
    return { success: false, error: error.message || String(error) }
  }
})()
