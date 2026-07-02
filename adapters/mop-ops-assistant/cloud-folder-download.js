;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'init'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const FOLDER_PAGE_SIZE = 100
  const DEFAULT_MAX_DEPTH = 12
  const DEFAULT_DOWNLOAD_CONCURRENCY = 6
  const DOWNLOAD_RETRY_ATTEMPTS = 3
  const DOWNLOAD_RETRY_DELAY_MS = 1200
  const TASK_MODES = new Set(['relationship_only', 'selected_styles', 'full_download'])

  function compact(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function toSafeFilename(value, fallback = 'file') {
    const text = compact(value).replace(/[\\/:*?"<>|]+/g, '_').replace(/^_+|_+$/g, '')
    return text || fallback
  }

  function parseCloudPath(rawValue) {
    const raw = String(rawValue || '').trim()
    if (!raw) throw new Error('请填写云盘路径')

    if (/^https?:\/\//i.test(raw)) {
      let parsed
      try {
        parsed = new URL(raw)
      } catch (_error) {
        throw new Error('云盘地址格式不正确')
      }

      const hash = String(parsed.hash || '')
      const mountMatch = hash.match(/\/mount\/([^/?#]+)/)
      const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
      const hashParams = new URLSearchParams(hashQuery)
      const mountId = decodeURIComponent(String(mountMatch?.[1] || hashParams.get('mount_id') || parsed.searchParams.get('mount_id') || '')).trim()
      const relativePath = String(hashParams.get('path') || parsed.searchParams.get('path') || '')
        .replace(/\\/g, '/')
        .split('/')
        .map(compact)
        .filter(Boolean)
        .join('/')

      if (!mountId) throw new Error('云盘地址缺少 mount_id，请复制森马云盘文件夹地址或使用“挂载点//目录”格式')

      return {
        raw,
        mountId,
        mountName: '',
        relativePath,
        relativePrefix: relativePath ? `${relativePath}/` : '',
      }
    }

    const divider = raw.indexOf('//')
    if (divider < 0) throw new Error('云盘路径格式不正确，需要使用“挂载点//目录/子目录”')

    const mountName = compact(raw.slice(0, divider))
    const relativePath = raw.slice(divider + 2).replace(/\\/g, '/').split('/').map(compact).filter(Boolean).join('/')
    if (!mountName) throw new Error('云盘路径缺少挂载点名称')

    return {
      raw,
      mountId: '',
      mountName,
      relativePath,
      relativePrefix: relativePath ? `${relativePath}/` : '',
    }
  }

  function buildFolderHashRoute(mountId, relativePath) {
    const base = `#/home/file/mount/${encodeURIComponent(String(mountId || '').trim())}`
    const normalized = String(relativePath || '').trim()
    return normalized ? `${base}?path=${encodeURIComponent(normalized)}` : base
  }

  function isDirectoryItem(item) {
    const dir = item?.dir
    return dir === 1 || dir === '1' || dir === true
  }

  function stripDuplicateFolderSuffix(folderName) {
    return compact(folderName).replace(/\s*\(\d+\)\s*$/, '').trim()
  }

  function splitStyleCodesFromFolderName(folderName) {
    return stripDuplicateFolderSuffix(folderName)
      .split('+')
      .map(compact)
      .filter(Boolean)
  }

  function normalizeTaskMode(value) {
    const normalized = String(value || 'relationship_only').trim().toLowerCase()
    return TASK_MODES.has(normalized) ? normalized : 'relationship_only'
  }

  function normalizeStyleCode(value) {
    return compact(value).toUpperCase()
  }

  function parseStyleCodeInput(value) {
    if (Array.isArray(value)) {
      return [...new Set(value.map(normalizeStyleCode).filter(Boolean))]
    }
    return [...new Set(
      String(value || '')
        .split(/[\n\r,，、；;\t ]+/)
        .map(normalizeStyleCode)
        .filter(Boolean),
    )]
  }

  function folderMatchesStyleCodes(folderItem, requestedCodes) {
    const codes = new Set(
      splitStyleCodesFromFolderName(folderItem?.filename || folderItem?.name || '')
        .map(normalizeStyleCode),
    )
    const folderName = normalizeStyleCode(stripDuplicateFolderSuffix(folderItem?.filename || folderItem?.name || ''))
    return requestedCodes.some(code => codes.has(code) || folderName === code)
  }

  function buildUnmatchedStyleRows(unmatchedCodes) {
    return unmatchedCodes.map((code, index) => ({
      __sheet_name: '下载明细',
      '序号': '',
      '顶层文件夹': code,
      '文件名': '',
      '云盘路径': '',
      '本地目录内路径': '',
      '文件大小': '',
      '下载结果': '未找到匹配文件夹',
      '备注': `指定款号未匹配到顶层文件夹：${code}`,
      __selected_style_miss: index + 1,
    }))
  }

  function buildRelationshipRows(folderItems) {
    return (Array.isArray(folderItems) ? folderItems : []).map((item, index) => {
      const folderName = compact(item?.filename || item?.name || '')
      const styleCodes = splitStyleCodesFromFolderName(folderName)
      const row = {
        __sheet_name: '搭配关系',
        '序号': index + 1,
        '文件夹名': folderName,
        '云盘路径': String(item?.fullpath || ''),
        '搭配款数': styleCodes.length || 1,
        '备注': styleCodes.length ? '' : '未拆出款号',
      }
      styleCodes.forEach((code, codeIndex) => {
        row[`款号${codeIndex + 1}`] = code
      })
      return row
    })
  }

  function extractFolderItems(payload) {
    if (Array.isArray(payload)) return payload
    for (const key of ['list', 'items', 'data', 'files']) {
      if (Array.isArray(payload?.[key])) return payload[key]
    }
    if (Array.isArray(payload?.data?.list)) return payload.data.list
    if (Array.isArray(payload?.result?.list)) return payload.result.list
    return []
  }

  function extractFolderTotal(payload, fallback) {
    for (const key of ['total', 'count', 'total_count', 'totalCount']) {
      const value = Number(payload?.[key])
      if (Number.isFinite(value) && value >= 0) return value
    }
    const nested = Number(payload?.data?.total || payload?.result?.total)
    if (Number.isFinite(nested) && nested >= 0) return nested
    return fallback
  }

  function normalizeListedItem(item, parentFullpath) {
    const filename = compact(item?.filename || item?.name || '')
    const fullpath = compact(item?.fullpath || item?.path || '')
    if (fullpath || !filename || !parentFullpath) return item
    return {
      ...item,
      filename,
      fullpath: `${String(parentFullpath || '').replace(/\/+$/, '')}/${filename}`,
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
    return resolveMount({ mountName })
  }

  async function resolveMount(cloud) {
    const mounts = await fetchMounts()
    const expectedMountId = String(cloud?.mountId || '').trim()
    if (expectedMountId) {
      const targetById = mounts.find(item => String(item?.mount_id || item?.id || '').trim() === expectedMountId)
      return {
        mountId: expectedMountId,
        mountName: compact(targetById?.org_name || targetById?.name || cloud?.mountName || `mount-${expectedMountId}`),
      }
    }

    const mountName = compact(cloud?.mountName)
    const target = mounts.find(item => compact(item?.org_name || item?.name) === mountName)
    if (!target) throw new Error(`未找到挂载点：${mountName}`)
    return {
      mountId: String(target.mount_id || target.id || ''),
      mountName: compact(target.org_name || target.name),
    }
  }

  async function fetchFolderPage(mountId, fullpath, start) {
    const query = new URLSearchParams({
      order: 'filename asc',
      size: String(FOLDER_PAGE_SIZE),
      start: String(start),
      fullpath: String(fullpath || ''),
      mount_id: String(mountId || ''),
      current: '1',
    })
    return fetchJson(`/fengcloud/1/file/ls?${query.toString()}`)
  }

  async function listFolderItems(mountId, fullpath) {
    const all = []
    let start = 0
    let total = null

    while (true) {
      const payload = await fetchFolderPage(mountId, fullpath, start)
      const items = extractFolderItems(payload).map(item => normalizeListedItem(item, fullpath))
      all.push(...items)
      const pageTotal = extractFolderTotal(payload, start + items.length)
      if (total == null) total = pageTotal
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

  function relativeToRoot(fullpath, rootPath) {
    const normalized = String(fullpath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    const root = String(rootPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    if (root && normalized === root) return ''
    if (root && normalized.startsWith(`${root}/`)) return normalized.slice(root.length + 1)
    return normalized
  }

  function buildPackagePath(fullpath, rootPath, fallbackFilename) {
    const relative = relativeToRoot(fullpath, rootPath)
    const parts = relative.split('/').map(compact).filter(Boolean)
    if (parts.length) return parts.join('/')
    return toSafeFilename(fallbackFilename, 'file')
  }

  function buildRuntimeFilename(fileIndex, item) {
    const filename = toSafeFilename(item?.filename || `file-${fileIndex}`, `file-${fileIndex}`)
    return `${String(fileIndex).padStart(5, '0')}__${filename}`
  }

  function formatLocalTimestamp(date = new Date()) {
    const pad = value => String(value).padStart(2, '0')
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
      '_',
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds()),
    ].join('')
  }

  function buildDirectPackageRoot(options = {}) {
    const exportFolder = String(options.export_folder || '').trim()
    if (!exportFolder) return ''
    const packageBase = toSafeFilename(
      options.package_name || `MOP云盘模拍图包_${formatLocalTimestamp()}`,
      'MOP云盘模拍图包',
    )
    return `${exportFolder.replace(/[\\/]+$/g, '')}/${packageBase}`
  }

  function normalizePositiveInt(value, fallback, min = 1, max = 100000) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(min, Math.min(max, Math.floor(parsed)))
  }

  async function appendFilePlan({
    rows,
    downloadItems,
    mountId,
    item,
    rootPath,
    topFolderName,
    counters,
    directPackageRoot,
  }) {
    counters.fileIndex += 1
    const packagePath = buildPackagePath(item?.fullpath || '', rootPath, item?.filename || `file-${counters.fileIndex}`)
    const runtimeFilename = buildRuntimeFilename(counters.fileIndex, item)
    const baseRow = {
      __sheet_name: '下载明细',
      '序号': counters.fileIndex,
      '顶层文件夹': topFolderName || (packagePath.split('/')[0] || ''),
      '文件名': compact(item?.filename || ''),
      '云盘路径': String(item?.fullpath || ''),
      '本地目录内路径': packagePath,
      '文件大小': item?.filesize || item?.size || '',
      '下载结果': '',
      '备注': '',
      __mop_package_path: packagePath,
      __runtime_filename: runtimeFilename,
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
        return
      }
      rows.push(baseRow)
      downloadItems.push({
        url: downloadUrl,
        filename: runtimeFilename,
        target_dir: directPackageRoot || '',
        target_dir_unique: Boolean(directPackageRoot),
        target_relative_path: directPackageRoot ? packagePath : '',
        label: `${topFolderName || '根目录'} / ${item?.filename || runtimeFilename}`,
        no_proxy: true,
      })
    } catch (error) {
      rows.push({
        ...baseRow,
        '下载结果': '获取下载链接失败',
        '备注': String(error?.message || error),
      })
    }
  }

  async function collectFolderFiles({
    mountId,
    folderItem,
    rootPath,
    topFolderName,
    rows,
    downloadItems,
    counters,
    depth,
    maxDepth,
    maxFiles,
    directPackageRoot,
  }) {
    if (depth > maxDepth || counters.fileIndex >= maxFiles) return
    const folderPath = String(folderItem?.fullpath || '').trim()
    if (!folderPath) return

    let items = []
    try {
      items = await listFolderItems(mountId, folderPath)
    } catch (error) {
      rows.push({
        __sheet_name: '下载明细',
        '序号': '',
        '顶层文件夹': topFolderName,
        '文件名': '',
        '云盘路径': folderPath,
        '本地目录内路径': '',
        '文件大小': '',
        '下载结果': '列目录失败',
        '本地文件': '',
        '备注': String(error?.message || error),
      })
      return
    }

    for (const item of items) {
      if (counters.fileIndex >= maxFiles) break
      if (isDirectoryItem(item)) {
        await collectFolderFiles({
          mountId,
          folderItem: item,
          rootPath,
          topFolderName,
          rows,
          downloadItems,
          counters,
          depth: depth + 1,
          maxDepth,
          maxFiles,
          directPackageRoot,
        })
      } else {
        await appendFilePlan({
          rows,
          downloadItems,
          mountId,
          item,
          rootPath,
          topFolderName,
          counters,
          directPackageRoot,
        })
      }
    }
  }

  async function buildCloudFolderPlan(options = {}) {
    const cloud = parseCloudPath(options.cloud_path)
    const mount = await resolveMount(cloud)
    const rootItems = await listFolderItems(mount.mountId, cloud.relativePath)
    const topFolders = rootItems.filter(isDirectoryItem)
    const relationshipRows = buildRelationshipRows(topFolders)
    const detailRows = []
    const downloadItems = []
    const counters = { fileIndex: 0 }
    const taskMode = normalizeTaskMode(options.task_mode)
    const selectedStyleCodes = parseStyleCodeInput(options.style_codes)
    const maxDepth = normalizePositiveInt(options.max_depth, DEFAULT_MAX_DEPTH, 1, 50)
    const maxFiles = normalizePositiveInt(options.max_files, 10000, 1, 100000)
    const directPackageRoot = buildDirectPackageRoot(options)

    if (taskMode === 'relationship_only') {
      return {
        mount,
        cloud,
        rootItems,
        relationshipRows,
        detailRows,
        downloadItems,
        taskMode,
        selectedStyleCodes,
        matchedFolders: [],
        unmatchedStyleCodes: [],
        directPackageRoot: '',
        folderHash: buildFolderHashRoute(mount.mountId, cloud.relativePath),
      }
    }

    if (taskMode === 'selected_styles' && !selectedStyleCodes.length) {
      throw new Error('指定款号模式请填写至少一个款号')
    }

    const foldersForDownload = taskMode === 'selected_styles'
      ? topFolders.filter(folderItem => folderMatchesStyleCodes(folderItem, selectedStyleCodes))
      : topFolders
    const matchedStyleCodes = new Set()
    if (taskMode === 'selected_styles') {
      for (const folderItem of foldersForDownload) {
        for (const code of selectedStyleCodes) {
          if (folderMatchesStyleCodes(folderItem, [code])) matchedStyleCodes.add(code)
        }
      }
      detailRows.push(...buildUnmatchedStyleRows(selectedStyleCodes.filter(code => !matchedStyleCodes.has(code))))
    }

    for (const folderItem of foldersForDownload) {
      await collectFolderFiles({
        mountId: mount.mountId,
        folderItem,
        rootPath: cloud.relativePath,
        topFolderName: compact(folderItem?.filename || ''),
        rows: detailRows,
        downloadItems,
        counters,
        depth: 1,
        maxDepth,
        maxFiles,
        directPackageRoot,
      })
    }

    if (taskMode === 'full_download') {
      for (const item of rootItems.filter(item => !isDirectoryItem(item))) {
        if (counters.fileIndex >= maxFiles) break
        await appendFilePlan({
          rows: detailRows,
          downloadItems,
          mountId: mount.mountId,
          item,
          rootPath: cloud.relativePath,
          topFolderName: '根目录',
          counters,
          directPackageRoot,
        })
      }
    }

    return {
      mount,
      cloud,
      rootItems,
      relationshipRows,
      detailRows,
      downloadItems,
      taskMode,
      selectedStyleCodes,
      matchedFolders: foldersForDownload,
      unmatchedStyleCodes: selectedStyleCodes.filter(code => !matchedStyleCodes.has(code)),
      directPackageRoot,
      folderHash: buildFolderHashRoute(mount.mountId, cloud.relativePath),
    }
  }

  function finalizeRows(plannedRows, downloadResult) {
    const items = Array.isArray(downloadResult?.items) ? downloadResult.items : []
    let downloadIndex = 0

    return (Array.isArray(plannedRows) ? plannedRows : []).map(row => {
      if (row?.__sheet_name !== '下载明细') return row
      if (row['下载结果']) return row

      const result = items[downloadIndex] || {}
      downloadIndex += 1
      return {
        ...row,
        '下载结果': result?.success ? '已下载' : '下载失败',
        '备注': result?.success ? '' : String(result?.error || '下载失败'),
        __runtime_local_path: String(result?.path || ''),
      }
    })
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
        shared_key: options.shared_key || 'download_result',
        strict: false,
        concurrency: normalizePositiveInt(options.concurrency, DEFAULT_DOWNLOAD_CONCURRENCY, 1, 20),
        retry_attempts: DOWNLOAD_RETRY_ATTEMPTS,
        retry_delay_ms: DOWNLOAD_RETRY_DELAY_MS,
        next_phase: nextPhaseName,
        sleep_ms: 0,
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

  function exposeHelpers() {
    if (!testExports || typeof testExports !== 'object') return
    Object.assign(testExports, {
      parseCloudPath,
      buildFolderHashRoute,
      splitStyleCodesFromFolderName,
      parseStyleCodeInput,
      normalizeTaskMode,
      folderMatchesStyleCodes,
      buildRelationshipRows,
      buildPackagePath,
      buildDirectPackageRoot,
      buildCloudFolderPlan,
      finalizeRows,
    })
  }

  exposeHelpers()

  if (phase === '__exports__') {
    return complete([], shared)
  }

  try {
    if (phase === 'init' || phase === 'main') {
      const plan = await buildCloudFolderPlan(params)
      const plannedRows = [...plan.relationshipRows, ...plan.detailRows]
      const baseShared = {
        ...shared,
        mount_id: plan.mount.mountId,
        mount_name: plan.mount.mountName,
        cloud_path: plan.cloud.raw,
        relative_path: plan.cloud.relativePath,
        folder_hash: plan.folderHash,
        planned_rows: plannedRows,
        download_item_total: plan.downloadItems.length,
        total_rows: Math.max(1, plan.rootItems.length),
        current_exec_no: 1,
        current_buyer_id: plan.relationshipRows[0]?.['文件夹名'] || '',
        current_store: plan.cloud.relativePath || plan.mount.mountName,
      }

      if (plan.folderHash && location.hash !== plan.folderHash) {
        location.hash = plan.folderHash
      }

      if (!plan.downloadItems.length) {
        return complete(plannedRows, baseShared)
      }

      return downloadUrls(
        plan.downloadItems,
        'finalize_all',
        {
          shared_key: 'last_download_result',
          concurrency: params.download_concurrency,
        },
        baseShared,
      )
    }

    if (phase === 'finalize_all') {
      const rows = finalizeRows(shared.planned_rows, shared.last_download_result)
      return complete(rows, {
        ...shared,
        planned_rows: rows,
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
