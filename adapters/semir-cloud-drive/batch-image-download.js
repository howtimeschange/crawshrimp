;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'init'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const SEARCH_SCOPE = '["filename", "tag"]'
  const SEARCH_PAGE_SIZE = 100
  const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff'])
  const DOWNLOAD_CONCURRENCY = 10
  const DOWNLOAD_RETRY_ATTEMPTS = 3
  const DOWNLOAD_RETRY_DELAY_MS = 1200

  function compact(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function toSafeFilename(value, fallback = 'file') {
    const text = String(value || '').trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ')
    return text.replace(/^_+|_+$/g, '') || fallback
  }

  function parseCloudPath(rawValue) {
    const raw = String(rawValue || '').trim()
    if (!raw) throw new Error('请填写云盘路径')

    const divider = raw.indexOf('//')
    if (divider < 0) throw new Error('云盘路径格式不正确，需要使用“挂载点//目录/子目录”')

    const mountName = compact(raw.slice(0, divider))
    const relativeRaw = raw.slice(divider + 2).replace(/\\/g, '/')
    const relativePath = relativeRaw.split('/').map(compact).filter(Boolean).join('/')

    if (!mountName) throw new Error('云盘路径缺少挂载点名称')

    return {
      mountName,
      relativePath,
      relativePrefix: relativePath ? `${relativePath}/` : '',
      raw,
    }
  }

  function normalizeCodes(rawValue) {
    const text = String(rawValue || '').replace(/[，、；;]/g, '\n')
    const deduped = []
    const seen = new Set()
    for (const line of text.split(/\r?\n/)) {
      const value = compact(line)
      if (!value || seen.has(value)) continue
      seen.add(value)
      deduped.push(value)
    }
    return deduped
  }

  function classifyCode(code) {
    return String(code || '').includes('-') ? 'skc' : 'spu'
  }

  function isImageItem(item) {
    const ext = String(item?.ext || '').trim().toLowerCase()
    return IMAGE_EXTS.has(ext)
  }

  function isDirectoryItem(item) {
    const dir = item?.dir
    return dir === 1 || dir === '1' || dir === true
  }

  function getFileStem(filename) {
    const name = String(filename || '').trim()
    if (!name) return ''
    const index = name.lastIndexOf('.')
    return index > 0 ? name.slice(0, index) : name
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function normalizeDuplicateMode(rawValue) {
    return String(rawValue || '').trim().toLowerCase() === 'all' ? 'all' : 'first_per_stem'
  }

  function normalizeSpuMatchMode(rawValue) {
    return String(rawValue || '').trim().toLowerCase() === 'representative' ? 'representative' : 'color_skc_all'
  }

  function buildFolderHashRoute(mountId, relativePath) {
    const base = `#/home/file/mount/${encodeURIComponent(String(mountId || '').trim())}`
    const normalized = String(relativePath || '').trim()
    return normalized ? `${base}?path=${encodeURIComponent(normalized)}` : base
  }

  function buildSearchHashRoute(mountId, keyword) {
    const mount = encodeURIComponent(String(mountId || '').trim())
    const query = new URLSearchParams({
      keyword: String(keyword || '').trim(),
      mount_id: String(mountId || '').trim(),
      scope: SEARCH_SCOPE,
    })
    return `#/home/file/mount/${mount}/search?${query.toString()}`
  }

  function isSkcLikeStemForSpu(stem, code) {
    const target = String(code || '').trim()
    if (!target) return false
    const matcher = new RegExp(`^${escapeRegExp(target)}-\\d{5}$`, 'i')
    return matcher.test(String(stem || '').trim())
  }

  function matchesCode(filename, code) {
    const stem = getFileStem(filename)
    if (!stem) return false
    const target = String(code || '').trim()
    if (!target) return false

    if (classifyCode(target) === 'skc') {
      return stem.toLowerCase() === target.toLowerCase()
    }

    return isSkcLikeStemForSpu(stem, target)
  }

  function pickRepresentativeSpuItem(items, code) {
    const candidates = Array.isArray(items) ? items : []
    const colorItems = candidates.filter(item => isSkcLikeStemForSpu(getFileStem(item?.filename || ''), code))
    if (!colorItems.length) return []
    const index = Math.min(colorItems.length - 1, Math.floor(Math.random() * colorItems.length))
    return [colorItems[index]]
  }

  function isWithinRelativePath(fullpath, relativePath) {
    const target = String(relativePath || '').trim()
    if (!target) return true
    const normalized = String(fullpath || '').replace(/\\/g, '/')
    return normalized === target || normalized.startsWith(`${target}/`)
  }

  function dedupeMatchedItems(items, duplicateMode) {
    if (normalizeDuplicateMode(duplicateMode) === 'all') {
      return Array.isArray(items) ? items.slice() : []
    }

    const deduped = []
    const seen = new Set()
    for (const item of Array.isArray(items) ? items : []) {
      const key = getFileStem(item?.filename || '').toLowerCase() || String(item?.filename || '').trim().toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      deduped.push(item)
    }
    return deduped
  }

  function filterSearchResults(items, code, relativePath, options = {}) {
    const scopedItems = (Array.isArray(items) ? items : [])
      .filter(item => !isDirectoryItem(item))
      .filter(isImageItem)
      .filter(item => isWithinRelativePath(item?.fullpath, relativePath))

    if (classifyCode(code) === 'spu' && normalizeSpuMatchMode(options.spuMatchMode) === 'representative') {
      return pickRepresentativeSpuItem(scopedItems, code)
    }

    const matched = scopedItems
      .filter(item => matchesCode(item?.filename, code))
    return dedupeMatchedItems(matched, options.duplicateMode)
  }

  function buildRuntimeFilename(code, item, itemIndex) {
    const ext = String(item?.ext || '').trim().toLowerCase()
    const suffix = ext ? `.${ext}` : ''
    const itemId = String(item?.id || item?.hash || itemIndex + 1)
    const stem = toSafeFilename(`${toSafeFilename(code, 'code')}__${itemId}__${getFileStem(item?.filename || '')}`, 'download')
    return suffix && !stem.toLowerCase().endsWith(suffix) ? `${stem}${suffix}` : stem
  }

  function buildSpuPackageFilename(code, item) {
    const ext = String(item?.ext || '').trim().toLowerCase()
    const safeCode = toSafeFilename(code, 'code')
    return ext ? `${safeCode}.${ext}` : safeCode
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

  function downloadUrls(items, nextPhaseName, options = {}, newShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: {
        action: 'download_urls',
        items,
        shared_key: options.shared_key || 'downloadResults',
        shared_append: !!options.shared_append,
        strict: !!options.strict,
        concurrency: Number(options.concurrency || 1),
        retry_attempts: Number(options.retry_attempts || 1),
        retry_delay_ms: Number(options.retry_delay_ms || 0),
        next_phase: nextPhaseName,
        sleep_ms: options.sleep_ms || 0,
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

  async function fetchJson(url, init = {}) {
    const response = await fetch(url, {
      credentials: 'include',
      ...init,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 240) || response.statusText}`)
    }
    return response.json()
  }

  async function fetchMounts() {
    const payload = await fetchJson('/fengcloud/1/account/mount')
    if (Array.isArray(payload)) return payload
    if (Array.isArray(payload?.list)) return payload.list
    return []
  }

  async function resolveMountId(mountName) {
    const mounts = await fetchMounts()
    const target = mounts.find(item => compact(item?.org_name) === compact(mountName))
    if (!target) throw new Error(`未找到挂载点：${mountName}`)
    return {
      mountId: String(target.mount_id || ''),
      mountName: compact(target.org_name),
    }
  }

  async function searchFiles(mountId, keyword) {
    const all = []
    let start = 0
    let total = null

    while (true) {
      const body = new URLSearchParams({
        size: String(SEARCH_PAGE_SIZE),
        start: String(start),
        keyword: String(keyword || ''),
        mount_id: String(mountId || ''),
        scope: SEARCH_SCOPE,
      })

      const payload = await fetchJson('/fengcloud/2/file/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      })

      const items = Array.isArray(payload?.list) ? payload.list : []
      const pageTotal = Number(payload?.total || 0)
      if (total == null) total = pageTotal
      all.push(...items)

      if (!items.length) break
      start += items.length
      if (start >= pageTotal) break
    }

    return all
  }

  async function fetchFileInfo(mountId, fullpath) {
    const query = new URLSearchParams({
      fullpath: String(fullpath || ''),
      mount_id: String(mountId || ''),
    })
    return fetchJson(`/fengcloud/2/file/info?${query.toString()}`)
  }

  async function buildCodePlan(inputCode, mountId, relativePath, codeIndex, totalCodes, options = {}) {
    const codeType = classifyCode(inputCode)
    const searchItems = await searchFiles(mountId, inputCode)
    const matchedItems = filterSearchResults(searchItems, inputCode, relativePath, options)

    const rows = []
    const downloadItems = []

    if (!matchedItems.length) {
      rows.push({
        '输入编码': inputCode,
        '匹配类型': codeType === 'skc' ? '款色编码' : '款号',
        '文件名': '',
        '云盘路径': '',
        '下载结果': '未匹配到图片',
        '本地文件': '',
        '备注': `搜索结果 ${searchItems.length} 条，过滤后 0 条`,
      })
      return { rows, downloadItems }
    }

    for (let index = 0; index < matchedItems.length; index += 1) {
      const item = matchedItems[index]
      const representativeSpu = codeType === 'spu' && normalizeSpuMatchMode(options.spuMatchMode) === 'representative'
      const sourceFilename = String(item?.filename || '')
      const packageFilename = representativeSpu ? buildSpuPackageFilename(inputCode, item) : ''
      const baseRow = {
        '输入编码': inputCode,
        '匹配类型': codeType === 'skc' ? '款色编码' : '款号',
        '文件名': packageFilename || sourceFilename,
        '云盘路径': String(item?.fullpath || ''),
        '下载结果': '',
        '本地文件': '',
        '备注': packageFilename && packageFilename !== sourceFilename ? `代表图来源：${sourceFilename}` : '',
      }

      try {
        const info = await fetchFileInfo(mountId, item?.fullpath || '')
        const downloadUrl = String(info?.uri || (Array.isArray(info?.uris) ? info.uris[0] : '') || '').trim()
        if (!downloadUrl) {
          rows.push({
            ...baseRow,
            '下载结果': '获取下载链接失败',
            '备注': 'file/info 未返回 uri',
          })
          continue
        }

        const runtimeFilename = packageFilename || buildRuntimeFilename(inputCode, item, index)
        rows.push({
          ...baseRow,
          '__runtime_filename': runtimeFilename,
          ...(packageFilename ? { '__package_filename': packageFilename } : {}),
          '__code_index': codeIndex,
          '__total_codes': totalCodes,
        })
        downloadItems.push({
          url: downloadUrl,
          filename: runtimeFilename,
          label: `${inputCode} / ${item?.filename || runtimeFilename}`,
        })
      } catch (error) {
        rows.push({
          ...baseRow,
          '下载结果': '获取下载链接失败',
          '备注': String(error?.message || error),
        })
      }
    }

    return { rows, downloadItems }
  }

  function finalizeCodeRows(plannedRows, downloadResult) {
    const items = Array.isArray(downloadResult?.items) ? downloadResult.items : []
    let downloadIndex = 0

    return (Array.isArray(plannedRows) ? plannedRows : []).map(row => {
      if (row['下载结果']) return row

      const result = items[downloadIndex] || {}
      downloadIndex += 1
      return {
        ...row,
        '下载结果': result?.success ? '已下载' : '下载失败',
        '本地文件': String(result?.path || ''),
        '备注': result?.success ? '' : String(result?.error || '下载失败'),
      }
    })
  }

  function exposeHelpers() {
    if (!testExports || typeof testExports !== 'object') return
    Object.assign(testExports, {
      parseCloudPath,
      normalizeCodes,
      classifyCode,
      isImageItem,
      normalizeDuplicateMode,
      normalizeSpuMatchMode,
      buildFolderHashRoute,
      buildSearchHashRoute,
      isSkcLikeStemForSpu,
      matchesCode,
      pickRepresentativeSpuItem,
      isWithinRelativePath,
      dedupeMatchedItems,
      filterSearchResults,
      buildRuntimeFilename,
      buildSpuPackageFilename,
      finalizeCodeRows,
    })
  }

  exposeHelpers()

  if (phase === '__exports__') {
    return complete([], shared)
  }

  try {
    if (phase === 'init' || phase === 'main') {
      const cloudConfig = parseCloudPath(params.cloud_path)
      const codes = normalizeCodes(params.item_codes)
      if (!codes.length) throw new Error('请至少输入一个款号或款色编码')
      const duplicateMode = normalizeDuplicateMode(params.duplicate_mode)
      const spuMatchMode = normalizeSpuMatchMode(params.spu_match_mode)

      const mount = await resolveMountId(cloudConfig.mountName)

      return nextPhase('ensure_folder', 0, {
        mount_id: mount.mountId,
        mount_name: mount.mountName,
        cloud_path: cloudConfig.raw,
        relative_path: cloudConfig.relativePath,
        folder_hash: buildFolderHashRoute(mount.mountId, cloudConfig.relativePath),
        duplicate_mode: duplicateMode,
        spu_match_mode: spuMatchMode,
        target_codes: codes,
        code_index: 0,
        result_rows: [],
        pending_download_items: [],
        total_rows: codes.length,
        current_exec_no: 1,
        current_buyer_id: codes[0] || '',
        current_store: cloudConfig.relativePath || mount.mountName,
      })
    }

    if (phase === 'ensure_folder') {
      const targetHash = String(shared.folder_hash || buildFolderHashRoute(shared.mount_id, shared.relative_path || ''))
      if (targetHash && location.hash !== targetHash) {
        location.hash = targetHash
        return nextPhase('plan_code', 1500, {
          ...shared,
          folder_hash: targetHash,
        })
      }
      return nextPhase('plan_code', 0, shared)
    }

    if (phase === 'plan_code') {
      const codes = Array.isArray(shared.target_codes) ? shared.target_codes : []
      const codeIndex = Number(shared.code_index || 0)
      const currentCode = String(codes[codeIndex] || '')

      if (!currentCode) {
        return complete(Array.isArray(shared.result_rows) ? shared.result_rows : [], shared)
      }

      return nextPhase('ensure_search', 0, {
        ...shared,
        current_code: currentCode,
      })
    }

    if (phase === 'ensure_search') {
      const currentCode = String(shared.current_code || '')
      if (!currentCode) {
        return nextPhase('plan_code', 0, shared)
      }

      const targetHash = buildSearchHashRoute(shared.mount_id, currentCode)
      if (targetHash && location.hash !== targetHash) {
        location.hash = targetHash
        return nextPhase('collect_code', 1500, {
          ...shared,
          search_hash: targetHash,
        })
      }

      return nextPhase('collect_code', 0, {
        ...shared,
        search_hash: targetHash,
      })
    }

    if (phase === 'collect_code') {
      const codes = Array.isArray(shared.target_codes) ? shared.target_codes : []
      const codeIndex = Number(shared.code_index || 0)
      const currentCode = String(shared.current_code || codes[codeIndex] || '')

      const plan = await buildCodePlan(
        currentCode,
        shared.mount_id,
        shared.relative_path,
        codeIndex + 1,
        codes.length,
        {
          duplicateMode: shared.duplicate_mode,
          spuMatchMode: shared.spu_match_mode,
        },
      )

      const baseShared = {
        ...shared,
        current_exec_no: codeIndex + 1,
        current_buyer_id: currentCode,
        current_store: shared.relative_path || shared.mount_name || '',
      }

      const allRows = [...(Array.isArray(shared.result_rows) ? shared.result_rows : []), ...plan.rows]
      const allDownloadItems = [...(Array.isArray(shared.pending_download_items) ? shared.pending_download_items : []), ...plan.downloadItems]
      const nextIndex = codeIndex + 1
      const nextCode = String(codes[nextIndex] || '')

      if (nextCode) {
        return nextPhase('plan_code', 0, {
          ...baseShared,
          code_index: nextIndex,
          result_rows: allRows,
          pending_download_items: allDownloadItems,
          current_code: '',
          search_hash: '',
          current_exec_no: nextIndex + 1,
          current_buyer_id: nextCode,
        })
      }

      if (!allDownloadItems.length) {
        return complete(allRows, {
          ...baseShared,
          result_rows: allRows,
          pending_download_items: [],
          current_code: currentCode,
          current_exec_no: codes.length,
          current_buyer_id: currentCode,
        })
      }

      return downloadUrls(
        allDownloadItems,
        'finalize_all',
        {
          shared_key: 'last_download_result',
          strict: false,
          concurrency: DOWNLOAD_CONCURRENCY,
          retry_attempts: DOWNLOAD_RETRY_ATTEMPTS,
          retry_delay_ms: DOWNLOAD_RETRY_DELAY_MS,
        },
        {
          ...baseShared,
          result_rows: allRows,
          pending_download_items: allDownloadItems,
          current_code: currentCode,
          current_exec_no: codes.length,
          current_buyer_id: currentCode,
        },
      )
    }

    if (phase === 'finalize_all') {
      const allRows = finalizeCodeRows(shared.result_rows, shared.last_download_result)
      return complete(allRows, {
        ...shared,
        result_rows: allRows,
        pending_download_items: [],
      })
    }

    return { success: false, error: `未知 phase: ${phase}` }
  } catch (error) {
    return {
      success: false,
      error: String(error?.message || error),
    }
  }
})()
