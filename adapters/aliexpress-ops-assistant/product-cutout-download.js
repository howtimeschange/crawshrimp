;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const DEFAULT_CHANNEL_ID = '125417'
  const PUBLISH_URL = 'https://csp.aliexpress.com/ait/cn_pop/item_product/product_publish'
  const CUTOUT_API = 'mtop.csp.merchant.media.file.cutout'
  const MTOP_APP_KEY = '30267743'
  const DEFAULT_REQUEST_DELAY_MS = 1500
  const DEFAULT_MAX_ATTEMPTS = 5
  const DEFAULT_PAGE_RELOAD_EVERY = 120
  const DEFAULT_COOLDOWN_EVERY = 100
  const DEFAULT_COOLDOWN_MS = 15000
  const MAX_PAGE_RECOVERY_ATTEMPTS = 2

  function compact(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function positiveInt(value, fallback = 0) {
    const number = Number.parseInt(value, 10)
    return Number.isFinite(number) && number > 0 ? number : fallback
  }

  function clampNumber(value, fallback, min, max) {
    const number = Number(value)
    const candidate = Number.isFinite(number) ? number : fallback
    return Math.max(min, Math.min(max, candidate))
  }

  function normalizeProductIds(rawValue) {
    const text = String(rawValue || '').replace(/[，、；;, \t]+/g, '\n')
    const ids = []
    const seen = new Set()
    for (const line of text.split(/\r?\n/)) {
      const value = compact(line)
      const found = value.match(/\d{10,}/g) || []
      for (const id of found) {
        if (!id || seen.has(id)) continue
        seen.add(id)
        ids.push(id)
      }
    }
    return ids
  }

  function normalizeHeader(value) {
    return compact(value).toLowerCase().replace(/[\s_/\-:：|（）()]+/g, '')
  }

  function columnValue(row, names = []) {
    if (!row || typeof row !== 'object') return ''
    const normalizedNames = names.map(normalizeHeader)
    for (const [key, value] of Object.entries(row)) {
      const normalizedKey = normalizeHeader(key)
      if (normalizedNames.includes(normalizedKey)) return compact(value)
    }
    return ''
  }

  function excelRowNumber(row, index) {
    const explicit = positiveInt(
      row?.__row_number || row?.__row_no || row?.row_no || row?.行号 || row?.源表行号 || row?.表格行号,
      0,
    )
    return explicit || index + 2
  }

  function productIdFromRow(row) {
    const directValue = columnValue(row, [
      '款号',
      '商品款号',
      '商品ID',
      '商品id',
      'productId',
      'product_id',
      'itemId',
      'item_id',
      '产品ID',
      '产品id',
      '链接',
      '商品链接',
      '商品发布页',
    ])
    const ids = normalizeProductIds(directValue)
    if (ids.length) return ids[0]

    const fullRowText = Object.values(row || {}).map(value => compact(value)).filter(Boolean).join('\n')
    return normalizeProductIds(fullRowText)[0] || ''
  }

  function rowsFromExcelFile(file) {
    const rows = Array.isArray(file?.rows) ? file.rows : []
    return rows.map((row, index) => {
      const productId = productIdFromRow(row)
      return productId ? {
        product_id: productId,
        row_no: excelRowNumber(row, index),
        source: 'Excel',
      } : null
    }).filter(Boolean)
  }

  function rowsFromTextarea(rawValue, startExecNo = 1) {
    return normalizeProductIds(rawValue).map((productId, index) => ({
      product_id: productId,
      row_no: startExecNo + index,
      source: '文本',
    }))
  }

  function dedupeJobs(jobs) {
    const seen = new Set()
    const result = []
    for (const job of jobs || []) {
      const productId = compact(job?.product_id || job?.productId || job)
      if (!productId || seen.has(productId)) continue
      seen.add(productId)
      result.push({
        product_id: productId,
        row_no: positiveInt(job?.row_no, result.length + 1),
        source: compact(job?.source) || '输入',
      })
    }
    return result
  }

  function applyExecutionRange(jobs) {
    const startRow = positiveInt(params.start_row, 1)
    const rawEndRow = positiveInt(params.end_row, 0)
    const startIndex = Math.max(startRow - 1, 0)
    const endIndex = rawEndRow > 0 ? Math.min(jobs.length, rawEndRow) : jobs.length
    if (!jobs.length || startIndex >= jobs.length || endIndex <= startIndex) return []
    return jobs.slice(startIndex, endIndex).map((job, index) => ({
      ...job,
      exec_no: index + 1,
    }))
  }

  function buildProductJobs() {
    const excelJobs = rowsFromExcelFile(params.product_file)
    const textJobs = rowsFromTextarea(params.product_ids, excelJobs.length + 1)
    return dedupeJobs(applyExecutionRange([...excelJobs, ...textJobs]))
      .map((job, index) => ({
        ...job,
        exec_no: index + 1,
      }))
  }

  function currentUrl() {
    return String(location.href || '')
  }

  function readUrlParam(name, href = currentUrl()) {
    try {
      return new URL(href).searchParams.get(name) || ''
    } catch (error) {
      return ''
    }
  }

  function normalizeChannelId(rawValue, href = currentUrl()) {
    return compact(rawValue) || compact(readUrlParam('channelId', href)) || DEFAULT_CHANNEL_ID
  }

  function buildPublishUrl(productId, channelId = DEFAULT_CHANNEL_ID) {
    const query = new URLSearchParams({
      productId: compact(productId),
      channelId: normalizeChannelId(channelId),
    })
    return `${PUBLISH_URL}?${query.toString()}`
  }

  function getCurrentProductId(href = currentUrl()) {
    return compact(readUrlParam('productId', href))
  }

  function isCurrentPublishPage(productId, channelId, href = currentUrl()) {
    const expectedProductId = compact(productId)
    if (!expectedProductId || !/\/product_publish(?:\?|$)/.test(href)) return false
    if (getCurrentProductId(href) !== expectedProductId) return false
    const currentChannelId = compact(readUrlParam('channelId', href))
    return !channelId || !currentChannelId || currentChannelId === compact(channelId)
  }

  function nextPhase(name, sleepMs = 600, newShared = shared, data = []) {
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

  function getProductContext(state = shared) {
    const ids = Array.isArray(state.target_product_ids) ? state.target_product_ids : []
    const jobs = Array.isArray(state.target_product_jobs) ? state.target_product_jobs : []
    const index = Number(state.product_index || 0)
    const job = jobs[index] || {
      product_id: compact(ids[index]),
      row_no: index + 1,
      exec_no: index + 1,
      source: '输入',
    }
    return {
      ids,
      index,
      job,
      productId: compact(job.product_id || ids[index]),
      channelId: normalizeChannelId(state.channel_id),
    }
  }

  function firstMainImageFromForm() {
    const form = window.__form__
    const values = form?.values || form?.getState?.()?.values || {}
    const candidates = []
    const mainImage = Array.isArray(values?.mainImage)
      ? values.mainImage
      : (Array.isArray(form?.getValuesIn?.('mainImage')) ? form.getValuesIn('mainImage') : [])

    for (const item of mainImage || []) {
      if (typeof item === 'string') candidates.push(item)
      candidates.push(item?.url, item?.src, item?.imageUrl, item?.image_url)
    }

    return candidates.map(compact).find(Boolean) || ''
  }

  function firstMainImageFromDom() {
    const images = [...document.querySelectorAll('#mainImage img')]
      .map(img => compact(img.currentSrc || img.src || img.getAttribute('src')))
      .filter(src => /^(https?:)?\/\/.+/i.test(src))
      .filter(src => /ae-pic|aliexpress-media|alicdn\.com|mrvcdn/i.test(src))
    const preferred = images.find(src => /ae-pic|aliexpress-media/i.test(src))
    return preferred || images[0] || ''
  }

  function getFirstMainImageUrl() {
    return firstMainImageFromForm() || firstMainImageFromDom()
  }

  function getMtopClient() {
    const mtop = window?.lib?.mtop
    if (!mtop || typeof mtop.request !== 'function') return null
    return mtop
  }

  function getPayloadError(payload) {
    if (!payload || typeof payload !== 'object') return ''
    const ret = Array.isArray(payload.ret) ? payload.ret.join(';') : compact(payload.ret)
    if (/SUCCESS/i.test(ret)) return ''
    if (/FAIL|ERROR|DENY|LOGIN|验证|风控/i.test(ret)) return ret
    const text = JSON.stringify(payload).slice(0, 500)
    if (/FAIL|ERROR|DENY|LOGIN|验证|风控/i.test(text)) return text
    return ''
  }

  function isSessionExpiredError(error) {
    const text = compact(error?.message || error)
    return /FAIL_SYS_SESSION_EXPIRED|SESSION失效/i.test(text)
  }

  function isTransientCutoutError(error) {
    const text = compact(error?.message || error)
    return isSessionExpiredError(error) ||
      /FAIL_SYS_(TOKEN_EMPTY|ILLEGAL_ACCESS|SERVICE_FAULT|NETWORK|TIMEOUT|RETRY|TRAFFIC_LIMIT)/i.test(text) ||
      /请求超时|网络|timeout|timed?\s*out|temporar|暂不可用|服务繁忙|稍后再试|system error/i.test(text)
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(Number(ms) || 0, 0)))
  }

  function extractCutoutUrl(payload) {
    const candidates = [
      payload?.data?.data,
      payload?.data?.url,
      payload?.data?.result,
      payload?.result?.url,
      payload?.url,
    ]
    for (const value of candidates) {
      if (typeof value === 'string' && /^https?:\/\//i.test(value.trim())) return value.trim()
      if (value && typeof value === 'object') {
        const nested = extractCutoutUrl(value)
        if (nested) return nested
      }
    }
    return ''
  }

  function buildCutoutRequest(productId, channelId, sourceUrl) {
    return {
      api: CUTOUT_API,
      v: '1.0',
      appKey: MTOP_APP_KEY,
      type: 'GET',
      dataType: 'json',
      valueType: 'original',
      timeout: 30000,
      H5Request: true,
      data: {
        _timezone: -8,
        productId: compact(productId),
        channelId: compact(channelId),
        entityType: 99,
        fileStorageType: 2,
        sourceCode: 'product-manage',
        url: compact(sourceUrl),
        cspSite: '',
      },
    }
  }

  async function callCutoutMtopOnce(productId, channelId, sourceUrl) {
    const mtop = getMtopClient()
    if (!mtop) throw new Error('当前页面未找到 window.lib.mtop.request，请在已登录的速卖通商品发布页运行')
    const request = buildCutoutRequest(productId, channelId, sourceUrl)
    return await new Promise((resolve, reject) => {
      let finished = false
      const timer = setTimeout(() => {
        if (finished) return
        finished = true
        reject(new Error('速卖通抠图接口请求超时'))
      }, 45000)

      function finish(payload) {
        if (finished) return
        finished = true
        clearTimeout(timer)
        const error = getPayloadError(payload)
        if (error) {
          reject(new Error(error))
          return
        }
        const cutoutUrl = extractCutoutUrl(payload)
        if (!cutoutUrl) {
          reject(new Error(`抠图接口未返回图片地址：${JSON.stringify(payload).slice(0, 300)}`))
          return
        }
        resolve({ cutoutUrl, payload, request })
      }

      function fail(error) {
        if (finished) return
        finished = true
        clearTimeout(timer)
        reject(new Error(compact(error?.message) || getPayloadError(error) || JSON.stringify(error) || String(error)))
      }

      try {
        mtop.request(request, finish, fail)
      } catch (error) {
        fail(error)
      }
    })
  }

  function resolveMaxAttempts() {
    return Math.floor(clampNumber(params.max_attempts, DEFAULT_MAX_ATTEMPTS, 1, 10))
  }

  function requestDelayMs() {
    return Math.floor(clampNumber(params.request_delay_ms, DEFAULT_REQUEST_DELAY_MS, 0, 30000))
  }

  function retryDelayMs(attempt) {
    const base = Math.min(12000, 900 * Math.max(attempt, 1))
    const jitter = ((attempt * 137) % 350)
    return base + jitter
  }

  async function callCutoutMtop(productId, channelId, sourceUrl) {
    const maxAttempts = resolveMaxAttempts()
    let lastError = null
    let retries = 0
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await callCutoutMtopOnce(productId, channelId, sourceUrl)
        return {
          ...result,
          attempts: attempt,
          retries,
        }
      } catch (error) {
        lastError = error
        if (!isTransientCutoutError(error) || attempt >= maxAttempts) break
        retries += 1
        await sleep(retryDelayMs(attempt))
      }
    }
    if (lastError && typeof lastError === 'object') {
      try {
        lastError.attempts = retries + 1
        lastError.retries = retries
      } catch (error) {}
    }
    throw lastError
  }

  function currentStoreText(state = shared) {
    const successCount = Number(state.success_count || 0)
    const failedCount = Number(state.failed_count || 0)
    const retryCount = Number(state.retry_count || 0)
    const parts = ['速卖通商品抠图下载']
    if (successCount || failedCount || retryCount) {
      parts.push(`成功 ${successCount} / 失败 ${failedCount} / 重试 ${retryCount}`)
    }
    return parts.join(' · ')
  }

  function buildRow(jobOrProductId, index, sourceUrl, cutoutUrl, result, note = '', retryTimes = 0) {
    const job = typeof jobOrProductId === 'object' && jobOrProductId
      ? jobOrProductId
      : { product_id: jobOrProductId, row_no: index + 1, exec_no: index + 1, source: '输入' }
    const productId = compact(job.product_id || job.productId)
    const channelId = normalizeChannelId(shared.channel_id)
    return {
      序号: Number(job.exec_no || index + 1),
      源表行号: Number(job.row_no || index + 1),
      款号: compact(productId),
      商品发布页: buildPublishUrl(productId, channelId),
      原主图地址: compact(sourceUrl),
      抠图后图片地址: compact(cutoutUrl),
      执行结果: result,
      重试次数: Number(retryTimes || 0),
      备注: compact(note),
    }
  }

  function shouldCooldownAfter(state) {
    const every = positiveInt(state.cooldown_every, DEFAULT_COOLDOWN_EVERY)
    if (!every) return false
    const completed = Number(state.completed_count || 0)
    const total = Number(state.total_rows || 0)
    return completed > 0 && completed < total && completed % every === 0
  }

  function advanceShared(state, emittedRow = null, extras = {}) {
    const jobs = Array.isArray(state.target_product_jobs) ? state.target_product_jobs : []
    const ids = Array.isArray(state.target_product_ids) ? state.target_product_ids : jobs.map(job => job.product_id)
    const nextIndex = Number(state.product_index || 0) + 1
    const nextJob = jobs[nextIndex] || { product_id: compact(ids[nextIndex]), row_no: nextIndex + 1, exec_no: nextIndex + 1 }
    const nextProductId = compact(nextJob.product_id || ids[nextIndex])
    const successCount = Number(state.success_count || 0) + (emittedRow?.执行结果 === '成功' ? 1 : 0)
    const failedCount = Number(state.failed_count || 0) + (emittedRow?.执行结果 === '失败' ? 1 : 0)
    const retryCount = Number(state.retry_count || 0) + Number(extras.retryIncrement || 0)
    const completedCount = Number(state.completed_count || 0) + (emittedRow ? 1 : 0)
    const nextState = {
      ...state,
      ...extras,
      product_index: nextIndex,
      completed_count: completedCount,
      success_count: successCount,
      failed_count: failedCount,
      retry_count: retryCount,
      current_exec_no: nextProductId ? Number(nextJob.exec_no || nextIndex + 1) : ids.length,
      current_row_no: nextProductId ? Number(nextJob.row_no || nextIndex + 1) : Number(state.current_row_no || ids.length),
      current_buyer_id: nextProductId || '',
      batch_no: 0,
      total_batches: 0,
      wait_count: 0,
      cutout_recover_count: 0,
      product_retry_count: 0,
    }
    nextState.current_store = nextProductId ? currentStoreText(nextState) : `${currentStoreText(nextState)} / 已完成`
    delete nextState.result_rows
    delete nextState.retryIncrement
    return nextState
  }

  function refreshCurrentShared(state, extras = {}) {
    const { job, productId } = getProductContext(state)
    return {
      ...state,
      ...extras,
      current_exec_no: Number(job.exec_no || Number(state.product_index || 0) + 1),
      current_row_no: Number(job.row_no || Number(state.product_index || 0) + 1),
      current_buyer_id: productId,
      current_store: currentStoreText({ ...state, ...extras }),
      batch_no: 0,
      total_batches: 0,
    }
  }

  function exposeHelpers() {
    if (!testExports) return
    Object.assign(testExports, {
      normalizeProductIds,
      normalizeChannelId,
      buildPublishUrl,
      isCurrentPublishPage,
      getCurrentProductId,
      extractCutoutUrl,
      buildCutoutRequest,
      getPayloadError,
      buildProductJobs,
      isTransientCutoutError,
    })
  }

  exposeHelpers()

  if (phase === '__exports__') {
    return complete([], shared)
  }

  try {
    if (phase === 'main' || phase === 'init') {
      const jobs = buildProductJobs()
      if (!jobs.length) throw new Error('请上传 Excel 模板或输入至少一个速卖通商品款号 / productId；如设置了起止行，请确认范围内有可执行款号')
      const productIds = jobs.map(job => job.product_id)
      const channelId = normalizeChannelId(params.channel_id)
      const firstJob = jobs[0]
      return nextPhase('ensure_publish_page', 0, {
        target_product_ids: productIds,
        target_product_jobs: jobs,
        channel_id: channelId,
        product_index: 0,
        completed_count: 0,
        success_count: 0,
        failed_count: 0,
        retry_count: 0,
        request_delay_ms: requestDelayMs(),
        max_attempts: resolveMaxAttempts(),
        page_reload_every: positiveInt(params.page_reload_every, DEFAULT_PAGE_RELOAD_EVERY),
        cooldown_every: positiveInt(params.cooldown_every, DEFAULT_COOLDOWN_EVERY),
        cooldown_ms: Math.floor(clampNumber(params.cooldown_ms, DEFAULT_COOLDOWN_MS, 0, 120000)),
        total_rows: productIds.length,
        current_exec_no: 1,
        current_row_no: Number(firstJob.row_no || 1),
        current_buyer_id: productIds[0],
        current_store: '速卖通商品抠图下载',
        batch_no: 0,
        total_batches: 0,
      })
    }

    if (phase === 'ensure_publish_page') {
      const { productId, channelId, index } = getProductContext(shared)
      if (!productId) return complete([], shared)
      const targetUrl = buildPublishUrl(productId, channelId)
      const shouldReload = index > 0 &&
        positiveInt(shared.page_reload_every, DEFAULT_PAGE_RELOAD_EVERY) > 0 &&
        index % positiveInt(shared.page_reload_every, DEFAULT_PAGE_RELOAD_EVERY) === 0 &&
        !shared.reload_done_for_index
      const nextShared = refreshCurrentShared(shared, {
        target_url: targetUrl,
        wait_count: 0,
      })
      if (shouldReload || !isCurrentPublishPage(productId, channelId)) {
        location.assign?.(targetUrl)
        if (location.href !== targetUrl) location.href = targetUrl
        return nextPhase('wait_publish_page', 3600, {
          ...nextShared,
          reload_done_for_index: shouldReload ? index : shared.reload_done_for_index,
        })
      }
      return nextPhase('wait_publish_page', 300, nextShared)
    }

    if (phase === 'wait_publish_page') {
      const { productId, channelId, job, index } = getProductContext(shared)
      if (!productId) return complete([], shared)
      const waitCount = Number(shared.wait_count || 0)
      const hasImageSignal = !!getFirstMainImageUrl() || !!document.querySelector('#mainImage')
      const ready = isCurrentPublishPage(productId, channelId) &&
        document.readyState === 'complete' &&
        (!!window.__form__ || hasImageSignal)
      if (!ready && waitCount < 20) {
        return nextPhase('wait_publish_page', 1500, {
          ...shared,
          wait_count: waitCount + 1,
        })
      }
      if (!ready) {
        const recoverCount = Number(shared.page_recover_count || 0)
        if (recoverCount < MAX_PAGE_RECOVERY_ATTEMPTS) {
          const targetUrl = buildPublishUrl(productId, channelId)
          location.assign?.(targetUrl)
          if (location.href !== targetUrl) location.href = targetUrl
          return nextPhase('wait_publish_page', 4500, refreshCurrentShared(shared, {
            wait_count: 0,
            page_recover_count: recoverCount + 1,
            target_url: targetUrl,
          }))
        }
        const row = buildRow(job, index, '', '', '失败', '商品发布页加载超时', 0)
        return nextPhase('advance_product', 0, advanceShared(shared, row), [row])
      }
      return nextPhase('cutout_current', 500, {
        ...shared,
        wait_count: 0,
        page_recover_count: 0,
      })
    }

    if (phase === 'cutout_current') {
      const { productId, channelId, index, job } = getProductContext(shared)
      if (!productId) return complete([], shared)
      const sourceUrl = getFirstMainImageUrl()
      if (!sourceUrl) {
        const row = buildRow(job, index, '', '', '失败', '未找到第一张主图地址', 0)
        return nextPhase('advance_product', 0, advanceShared(shared, row), [row])
      }

      try {
        const result = await callCutoutMtop(productId, channelId, sourceUrl)
        const productRetries = Number(shared.product_retry_count || 0) + Number(result.retries || 0)
        const row = buildRow(job, index, sourceUrl, result.cutoutUrl, '成功', '', productRetries)
        return nextPhase('advance_product', requestDelayMs(), advanceShared(shared, row, {
          retryIncrement: productRetries,
        }), [row])
      } catch (error) {
        const retries = Number(error?.retries || 0)
        const productRetries = Number(shared.product_retry_count || 0) + retries
        const recoverCount = Number(shared.cutout_recover_count || 0)
        if (isTransientCutoutError(error) && recoverCount < MAX_PAGE_RECOVERY_ATTEMPTS) {
          const targetUrl = buildPublishUrl(productId, channelId)
          location.assign?.(targetUrl)
          if (location.href !== targetUrl) location.href = targetUrl
          return nextPhase('wait_publish_page', Math.max(3000, requestDelayMs()), refreshCurrentShared(shared, {
            cutout_recover_count: recoverCount + 1,
            product_retry_count: productRetries,
            target_url: targetUrl,
          }))
        }
        const row = buildRow(job, index, sourceUrl, '', '失败', error?.message || error, productRetries)
        return nextPhase('advance_product', requestDelayMs(), advanceShared(shared, row, {
          retryIncrement: productRetries,
        }), [row])
      }
    }

    if (phase === 'advance_product') {
      const ids = Array.isArray(shared.target_product_ids) ? shared.target_product_ids : []
      const jobs = Array.isArray(shared.target_product_jobs) ? shared.target_product_jobs : []
      const index = Number(shared.product_index || 0)
      if (index >= ids.length) {
        return complete([], shared)
      }
      const job = jobs[index] || { product_id: ids[index], row_no: index + 1, exec_no: index + 1 }
      const nextShared = refreshCurrentShared({
        ...shared,
        reload_done_for_index: shared.reload_done_for_index === index ? shared.reload_done_for_index : '',
      })
      const cooldownMs = Number(shared.cooldown_ms || DEFAULT_COOLDOWN_MS)
      return nextPhase('ensure_publish_page', shouldCooldownAfter(shared) ? cooldownMs : requestDelayMs(), {
        ...nextShared,
        current_exec_no: Number(job.exec_no || index + 1),
        current_row_no: Number(job.row_no || index + 1),
        current_buyer_id: compact(job.product_id || ids[index]),
        current_store: currentStoreText(nextShared),
      })
    }

    return { success: false, error: `未知 phase: ${phase}` }
  } catch (error) {
    return {
      success: false,
      error: String(error?.message || error),
      meta: {
        action: 'complete',
        has_more: false,
        shared,
      },
    }
  }
})()
