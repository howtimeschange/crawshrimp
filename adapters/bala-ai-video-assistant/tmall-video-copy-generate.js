;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'init'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const SELLER_LIST_URL = 'https://myseller.taobao.com/home.htm/SellManage/on_sale?current=1&pageSize=20'
  const TMALL_EDIT_URL = 'https://sell.publish.tmall.com/tmall/publish.htm'
  const READY_RETRY_LIMIT = 30
  const READY_RETRY_MS = 2000

  function compact(value) {
    return String(value == null ? '' : value).trim()
  }

  function normalizeKey(value) {
    return compact(value).replace(/[\s_\-./（）()]+/g, '').toLowerCase()
  }

  function columnValue(row, names) {
    const wanted = names.map(normalizeKey)
    for (const [key, value] of Object.entries(row || {})) {
      if (wanted.includes(normalizeKey(key))) return compact(value)
    }
    return ''
  }

  function excelRowNumber(row, index) {
    const value = Number(row?.__row_number || row?.__row_no || row?.行号 || row?.表格行号)
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : index + 2
  }

  function normalizeItemId(value) {
    const text = compact(value)
    const query = text.match(/(?:[?&]|^)(?:id|itemId|item_id)=([0-9]{8,})/i)
    if (query) return query[1]
    const direct = text.match(/[0-9]{8,}/)
    return direct ? direct[0] : ''
  }

  function outputRow(styleCode, itemId, extras = {}) {
    return {
      '款号': compact(styleCode),
      'ID': compact(itemId),
      '视频标题': '',
      '视频描述': '',
      '参与活动': '',
      '定时/日': '',
      '定时/具体时间': '',
      '上传情况': '',
      '内容ID': '',
      ...extras,
    }
  }

  function failureRow(styleCode, itemId, message) {
    return outputRow(styleCode, itemId, {
      '上传情况': `生成失败：${compact(message) || '未知错误'}`,
    })
  }

  function normalizeJobs(rawParams = params) {
    const rows = Array.isArray(rawParams.input_file?.rows) ? rawParams.input_file.rows : []
    const jobs = []
    const invalidRows = []
    const seen = new Set()
    rows.forEach((row, index) => {
      const styleCode = columnValue(row, ['款号', '商品款号', '商品编码', '商家编码', 'style_code', 'styleCode'])
      const itemId = normalizeItemId(columnValue(row, ['ID', '商品ID', '天猫商品ID', '宝贝ID', '商品链接', 'item_id', 'itemId']))
      const rowNo = excelRowNumber(row, index)
      if (!itemId) {
        invalidRows.push(failureRow(styleCode, itemId, `模板第${rowNo}行缺少商品ID`))
        return
      }
      const key = itemId
      if (seen.has(key)) {
        invalidRows.push(failureRow(styleCode, itemId, `模板第${rowNo}行与前面任务重复`))
        return
      }
      seen.add(key)
      jobs.push({
        row_no: rowNo,
        style_code: styleCode,
        item_id: itemId,
        exec_no: jobs.length + 1,
      })
    })
    return { jobs, invalidRows }
  }

  function nextPhase(name, sleepMs = 0, newShared = shared, data = []) {
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

  function currentJob(state = shared) {
    const jobs = Array.isArray(state.jobs) ? state.jobs : []
    const index = Math.max(0, Number(state.job_index || 0))
    return { jobs, index, job: jobs[index] || null }
  }

  function targetEditUrl(itemId) {
    return `${TMALL_EDIT_URL}?id=${encodeURIComponent(compact(itemId))}`
  }

  function listEditUrl(itemId) {
    const id = compact(itemId)
    if (!id) return ''
    const links = Array.from(document.querySelectorAll?.('a[href]') || [])
    const found = links.find(link => {
      const text = compact(link.textContent)
      const href = compact(link.href)
      return text.includes('编辑商品') && (
        href.includes(`itemId=${id}`) ||
        href.includes(`item_id=${id}`) ||
        href.includes(`id=${id}`)
      )
    })
    return compact(found?.href)
  }

  function getSellState() {
    try {
      return window.__SELL_STATE__ && typeof window.__SELL_STATE__.getState === 'function'
        ? window.__SELL_STATE__.getState()
        : null
    } catch (error) {
      return null
    }
  }

  function getComponentValue(name) {
    const state = getSellState()
    if (!state || typeof state.getComponentValue !== 'function') return undefined
    try {
      return state.getComponentValue(name)
    } catch (error) {
      return undefined
    }
  }

  function normalizeImageUrl(value) {
    let url = compact(value)
    if (url.startsWith('//')) url = `https:${url}`
    return url.replace(/_\d+x\d+q\d+_\.webp(?:\?.*)?$/i, '')
  }

  function extractTitle() {
    const value = getComponentValue('title')
    const candidates = [
      ...(Array.isArray(value?.title) ? value.title : []),
      value?.title,
      value?.value,
      document.querySelector?.('#sell-field-title input')?.value,
      document.querySelector?.('input[name="title"]')?.value,
    ]
    return candidates.map(compact).find(Boolean) || ''
  }

  function extractStyleCode() {
    const outerId = getComponentValue('outerId')
    const skus = getComponentValue('sku')
    const candidates = [
      outerId?.outerId,
      outerId?.value,
      outerId,
      ...(Array.isArray(skus) ? skus.map(item => item?.productCode) : []),
    ]
    return candidates.map(compact).find(Boolean) || ''
  }

  function extractMainImages() {
    const value = getComponentValue('mainImagesGroup')
    const stateImages = Array.isArray(value?.images) ? value.images : []
    const urls = stateImages
      .map(item => normalizeImageUrl(item?.url || item?.src))
      .filter(Boolean)
    if (urls.length) return [...new Set(urls)].slice(0, 5)
    return [...new Set(Array.from(
      document.querySelectorAll?.('#struct-mainImagesGroup img.image-item, #sell-field-mainImagesGroup img') || [],
    ).map(image => normalizeImageUrl(image.currentSrc || image.src)).filter(Boolean))].slice(0, 5)
  }

  function pageItemId() {
    return normalizeItemId(location.href)
  }

  function editorReady(itemId) {
    return location.href.startsWith(TMALL_EDIT_URL) &&
      pageItemId() === compact(itemId) &&
      Boolean(extractTitle()) &&
      extractMainImages().length > 0
  }

  function loginExpired() {
    const href = compact(location.href)
    const text = compact(document.body?.innerText)
    return /login\.(taobao|tmall)\.com/i.test(href) || /亲，请登录|扫码登录|密码登录/.test(text)
  }

  function collectProductMaterial(job) {
    const title = extractTitle()
    const images = extractMainImages()
    const styleCode = compact(job.style_code) || extractStyleCode()
    if (!title) throw new Error('商品编辑页未读取到商品标题')
    if (!images.length) throw new Error('商品编辑页未读取到1:1主图')
    return outputRow(styleCode, job.item_id, {
      '__generate_video_copy': true,
      '__source_row_no': job.row_no,
      '__product_title': title,
      '__main_image_urls': images,
      '__image_count': images.length,
    })
  }

  function advance(rows, state = shared) {
    const { jobs, index } = currentJob(state)
    const resultRows = [...(Array.isArray(state.result_rows) ? state.result_rows : []), ...rows]
    const nextIndex = index + 1
    if (nextIndex >= jobs.length) {
      return complete(resultRows, {
        ...state,
        result_rows: resultRows,
        job_index: nextIndex,
        current_store: '商品素材读取完成，准备生成视频文案',
      })
    }
    return nextPhase('navigate_item', 0, {
      ...state,
      result_rows: resultRows,
      job_index: nextIndex,
      ready_attempts: 0,
      current_exec_no: nextIndex + 1,
      current_row_no: jobs[nextIndex]?.row_no || 0,
      current_buyer_id: jobs[nextIndex]?.style_code || '',
      current_store: `准备读取商品 ${nextIndex + 1}/${jobs.length}`,
    })
  }

  if (testExports) {
    Object.assign(testExports, {
      normalizeJobs,
      normalizeItemId,
      targetEditUrl,
      extractTitle,
      extractStyleCode,
      extractMainImages,
      collectProductMaterial,
      failureRow,
    })
  }
  if (phase === '__exports__') return complete([])

  if (phase === 'init' || phase === 'main') {
    const { jobs, invalidRows } = normalizeJobs(params)
    if (!jobs.length) {
      return complete(invalidRows.length ? invalidRows : [failureRow('', '', '请上传至少包含“ID”列的短视频模板')], {
        jobs: [],
        result_rows: invalidRows,
        total_rows: 0,
      })
    }
    return nextPhase('navigate_item', 0, {
      jobs,
      result_rows: invalidRows,
      job_index: 0,
      ready_attempts: 0,
      total_rows: jobs.length,
      current_exec_no: 1,
      current_row_no: jobs[0].row_no,
      current_buyer_id: jobs[0].style_code,
      current_store: `准备读取商品 1/${jobs.length}`,
      source_list_url: SELLER_LIST_URL,
    })
  }

  if (phase === 'navigate_item') {
    const { job } = currentJob(shared)
    if (!job) return complete(shared.result_rows || [], shared)
    if (loginExpired()) return advance([failureRow(job.style_code, job.item_id, '千牛登录已失效，请重新登录后再运行')], shared)
    if (editorReady(job.item_id)) return nextPhase('collect_item', 0, shared)
    const target = listEditUrl(job.item_id) || targetEditUrl(job.item_id)
    if (compact(location.href) !== target) location.href = target
    return nextPhase('wait_item', READY_RETRY_MS, {
      ...shared,
      ready_attempts: 0,
      current_store: `进入商品 ${job.item_id} 编辑页`,
    })
  }

  if (phase === 'wait_item') {
    const { job } = currentJob(shared)
    if (!job) return complete(shared.result_rows || [], shared)
    if (loginExpired()) return advance([failureRow(job.style_code, job.item_id, '千牛登录已失效，请重新登录后再运行')], shared)
    if (editorReady(job.item_id)) return nextPhase('collect_item', 0, shared)
    const attempts = Math.max(0, Number(shared.ready_attempts || 0))
    if (attempts >= READY_RETRY_LIMIT) {
      return advance([failureRow(job.style_code, job.item_id, '等待商品编辑页标题和主图超时')], shared)
    }
    if (!location.href.startsWith(TMALL_EDIT_URL) || pageItemId() !== job.item_id) {
      location.href = targetEditUrl(job.item_id)
    }
    return nextPhase('wait_item', READY_RETRY_MS, {
      ...shared,
      ready_attempts: attempts + 1,
      current_store: `等待商品编辑页 ${attempts + 1}/${READY_RETRY_LIMIT}`,
    })
  }

  if (phase === 'collect_item') {
    const { job, jobs, index } = currentJob(shared)
    if (!job) return complete(shared.result_rows || [], shared)
    try {
      const row = collectProductMaterial(job)
      return advance([row], {
        ...shared,
        current_store: `已读取 ${index + 1}/${jobs.length}：${row.__image_count} 张主图`,
      })
    } catch (error) {
      return advance([failureRow(job.style_code, job.item_id, error?.message || error)], shared)
    }
  }

  return {
    success: false,
    error: `未知执行阶段：${phase}`,
    data: shared.result_rows || [],
  }
})()
