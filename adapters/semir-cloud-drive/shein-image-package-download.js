;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'init'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const SEARCH_SCOPE = '["filename", "tag"]'
  const PAGE_SIZE = 100
  const MAX_FOLDER_DEPTH = 20
  const MAX_TOTAL_FILES = 10000
  const DOWNLOAD_CONCURRENCY = 8
  const DOWNLOAD_RETRY_ATTEMPTS = 3
  const DOWNLOAD_RETRY_DELAY_MS = 1200

  function compact(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function toSafeFilename(value, fallback = 'file') {
    const text = compact(value).replace(/[\\/:*?"<>|]+/g, '_').replace(/^_+|_+$/g, '')
    return text || fallback
  }

  function normalizePath(value) {
    return String(value || '')
      .replace(/\\/g, '/')
      .split('/')
      .map(compact)
      .filter(Boolean)
      .join('/')
  }

  function parseCloudPath(rawValue) {
    const raw = String(rawValue || '').trim()
    if (!raw) throw new Error('请填写森马云盘搜索范围')

    if (/^https?:\/\//i.test(raw)) {
      let parsed
      try {
        parsed = new URL(raw)
      } catch (_error) {
        throw new Error('森马云盘地址格式不正确')
      }

      const hash = String(parsed.hash || '')
      const mountMatch = hash.match(/\/mount\/([^/?#]+)/)
      const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
      const hashParams = new URLSearchParams(hashQuery)
      const mountId = decodeURIComponent(String(
        mountMatch?.[1] || hashParams.get('mount_id') || parsed.searchParams.get('mount_id') || '',
      )).trim()
      const relativePath = normalizePath(hashParams.get('path') || parsed.searchParams.get('path') || '')
      if (!mountId) throw new Error('森马云盘地址缺少 mount_id，请复制目标文件夹地址')

      return { raw, mountId, mountName: '', relativePath }
    }

    const divider = raw.indexOf('//')
    if (divider < 0) throw new Error('云盘路径格式不正确，需要使用“挂载点//目录/子目录”')
    let mountName = compact(raw.slice(0, divider))
    if (mountName.startsWith('森马云盘-')) mountName = compact(mountName.slice('森马云盘-'.length))
    if (!mountName) throw new Error('云盘路径缺少挂载点名称')

    return {
      raw,
      mountId: '',
      mountName,
      relativePath: normalizePath(raw.slice(divider + 2)),
    }
  }

  function normalizeStyleCodes(rawValue) {
    const values = Array.isArray(rawValue) ? rawValue : String(rawValue || '').split(/[\n\r,，、；;\t ]+/)
    const result = []
    const seen = new Set()
    for (const value of values) {
      const code = compact(value)
      if (!code || seen.has(code)) continue
      seen.add(code)
      result.push(code)
    }
    return result
  }

  function isDirectoryItem(item) {
    return item?.dir === 1 || item?.dir === '1' || item?.dir === true
  }

  function isWithinPath(fullpath, relativePath) {
    const path = normalizePath(fullpath)
    const root = normalizePath(relativePath)
    return !root || path === root || path.startsWith(`${root}/`)
  }

  function relativeToRoot(fullpath, rootPath) {
    const path = normalizePath(fullpath)
    const root = normalizePath(rootPath)
    if (root && path === root) return ''
    if (root && path.startsWith(`${root}/`)) return path.slice(root.length + 1)
    return path
  }

  function buildFolderHashRoute(mountId, relativePath) {
    const base = `#/home/file/mount/${encodeURIComponent(String(mountId || '').trim())}`
    const path = normalizePath(relativePath)
    return path ? `${base}?path=${encodeURIComponent(path)}` : base
  }

  function extractItems(payload) {
    if (Array.isArray(payload)) return payload
    for (const key of ['list', 'items', 'files']) {
      if (Array.isArray(payload?.[key])) return payload[key]
    }
    if (Array.isArray(payload?.data?.list)) return payload.data.list
    if (Array.isArray(payload?.result?.list)) return payload.result.list
    return []
  }

  function extractTotal(payload, fallback) {
    for (const key of ['total', 'count', 'total_count', 'totalCount']) {
      const value = Number(payload?.[key])
      if (Number.isFinite(value) && value >= 0) return value
    }
    const nested = Number(payload?.data?.total || payload?.result?.total)
    return Number.isFinite(nested) && nested >= 0 ? nested : fallback
  }

  function normalizeListedItem(item, parentPath) {
    const filename = compact(item?.filename || item?.name || '')
    const fullpath = normalizePath(item?.fullpath || item?.path || '')
    if (fullpath || !filename || !parentPath) return { ...item, filename, fullpath }
    return { ...item, filename, fullpath: `${normalizePath(parentPath)}/${filename}` }
  }

  async function fetchJson(url, init = {}) {
    const response = await fetch(url, { credentials: 'include', ...init })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 240) || response.statusText}`)
    }
    return response.json()
  }

  async function fetchMounts() {
    return extractItems(await fetchJson('/fengcloud/1/account/mount'))
  }

  async function resolveMount(cloud) {
    const mounts = await fetchMounts()
    const expectedId = String(cloud?.mountId || '').trim()
    if (expectedId) {
      const target = mounts.find(item => String(item?.mount_id || item?.id || '').trim() === expectedId)
      return {
        mountId: expectedId,
        mountName: compact(target?.org_name || target?.name || cloud?.mountName || `mount-${expectedId}`),
      }
    }

    const expectedName = compact(cloud?.mountName)
    const target = mounts.find(item => compact(item?.org_name || item?.name) === expectedName)
    if (!target) throw new Error(`未找到挂载点：${expectedName}`)
    return {
      mountId: String(target?.mount_id || target?.id || ''),
      mountName: compact(target?.org_name || target?.name || expectedName),
    }
  }

  async function searchFiles(mountId, keyword) {
    const all = []
    let start = 0
    while (all.length < MAX_TOTAL_FILES) {
      const body = new URLSearchParams({
        size: String(PAGE_SIZE),
        start: String(start),
        keyword: String(keyword || ''),
        mount_id: String(mountId || ''),
        scope: SEARCH_SCOPE,
      })
      const payload = await fetchJson('/fengcloud/2/file/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
      const items = extractItems(payload)
      const total = extractTotal(payload, start + items.length)
      all.push(...items)
      if (!items.length || all.length >= total) break
      start += items.length
    }
    return all
  }

  async function listFolderItems(mountId, fullpath) {
    const all = []
    let start = 0
    while (all.length < MAX_TOTAL_FILES) {
      const query = new URLSearchParams({
        order: 'filename asc',
        size: String(PAGE_SIZE),
        start: String(start),
        fullpath: String(fullpath || ''),
        mount_id: String(mountId || ''),
        current: '1',
      })
      const payload = await fetchJson(`/fengcloud/1/file/ls?${query.toString()}`)
      const items = extractItems(payload).map(item => normalizeListedItem(item, fullpath))
      const total = extractTotal(payload, start + items.length)
      all.push(...items)
      if (!items.length || all.length >= total) break
      start += items.length
    }
    return all
  }

  async function fetchFileInfo(mountId, fullpath) {
    const query = new URLSearchParams({ fullpath: String(fullpath || ''), mount_id: String(mountId || '') })
    return fetchJson(`/fengcloud/2/file/info?${query.toString()}`)
  }

  function selectStyleFolder(searchItems, styleCode, relativePath) {
    const matches = (Array.isArray(searchItems) ? searchItems : [])
      .filter(isDirectoryItem)
      .filter(item => compact(item?.filename || item?.name) === compact(styleCode))
      .filter(item => isWithinPath(item?.fullpath || item?.path, relativePath))
      .sort((left, right) => {
        const leftPath = normalizePath(left?.fullpath || left?.path)
        const rightPath = normalizePath(right?.fullpath || right?.path)
        const depthDiff = leftPath.split('/').length - rightPath.split('/').length
        return depthDiff || leftPath.localeCompare(rightPath, 'zh-CN')
      })
    return { folder: matches[0] || null, matchCount: matches.length }
  }

  async function collectFolderTree(mountId, rootFolder) {
    const rootPath = normalizePath(rootFolder?.fullpath || rootFolder?.path)
    if (!rootPath) throw new Error('命中的款号文件夹缺少云盘路径')

    const queue = [{ path: rootPath, depth: 1 }]
    const visited = new Set()
    const files = []
    let folderCount = 0

    while (queue.length) {
      const current = queue.shift()
      if (!current?.path || visited.has(current.path)) continue
      if (current.depth > MAX_FOLDER_DEPTH) throw new Error(`文件夹层级超过安全上限 ${MAX_FOLDER_DEPTH}：${current.path}`)
      visited.add(current.path)
      folderCount += 1

      const items = await listFolderItems(mountId, current.path)
      for (const item of items) {
        if (isDirectoryItem(item)) {
          queue.push({ path: normalizePath(item?.fullpath || item?.path), depth: current.depth + 1 })
        } else {
          files.push(item)
          if (files.length > MAX_TOTAL_FILES) throw new Error(`文件总数超过安全上限 ${MAX_TOTAL_FILES}`)
        }
      }
    }

    return { rootPath, folderCount, files }
  }

  function buildRuntimeFilename(styleCode, fileIndex, item) {
    const filename = toSafeFilename(item?.filename || `file-${fileIndex}`, `file-${fileIndex}`)
    return `${toSafeFilename(styleCode, 'style')}__${String(fileIndex).padStart(5, '0')}__${filename}`
  }

  async function buildStylePlan(styleCode, cloud, mount, counters) {
    const searchItems = await searchFiles(mount.mountId, styleCode)
    const selected = selectStyleFolder(searchItems, styleCode, cloud.relativePath)
    if (!selected.folder) {
      return {
        rows: [{
          '款号': styleCode,
          '款号文件夹': '',
          '文件名': '',
          '云盘路径': '',
          'ZIP内路径': '',
          '文件大小': '',
          '下载结果': '未找到款号文件夹',
          '本地文件': '',
          '备注': `搜索结果 ${searchItems.length} 条，指定范围内精确同名文件夹 0 个`,
        }],
        downloadItems: [],
      }
    }

    const tree = await collectFolderTree(mount.mountId, selected.folder)
    if (!tree.files.length) {
      return {
        rows: [{
          '款号': styleCode,
          '款号文件夹': tree.rootPath,
          '文件名': '',
          '云盘路径': tree.rootPath,
          'ZIP内路径': styleCode,
          '文件大小': '',
          '下载结果': '款号文件夹为空',
          '本地文件': '',
          '备注': `已扫描 ${tree.folderCount} 个文件夹`,
        }],
        downloadItems: [],
      }
    }

    const rows = []
    const downloadItems = []
    for (const item of tree.files) {
      counters.fileIndex += 1
      const relativePath = relativeToRoot(item?.fullpath || item?.path, tree.rootPath)
      const packagePath = normalizePath(`${styleCode}/${relativePath || item?.filename || `file-${counters.fileIndex}`}`)
      const runtimeFilename = buildRuntimeFilename(styleCode, counters.fileIndex, item)
      const baseRow = {
        '款号': styleCode,
        '款号文件夹': tree.rootPath,
        '文件名': compact(item?.filename || item?.name || ''),
        '云盘路径': normalizePath(item?.fullpath || item?.path),
        'ZIP内路径': packagePath,
        '文件大小': item?.filesize || item?.size || '',
        '下载结果': '',
        '本地文件': '',
        '备注': selected.matchCount > 1 ? `命中 ${selected.matchCount} 个同名文件夹，采用路径层级最浅的文件夹` : '',
        __package_relative_path: packagePath,
        __runtime_filename: runtimeFilename,
      }

      try {
        const info = await fetchFileInfo(mount.mountId, item?.fullpath || item?.path || '')
        const downloadUrl = String(info?.uri || (Array.isArray(info?.uris) ? info.uris[0] : '') || '').trim()
        if (!downloadUrl) {
          rows.push({ ...baseRow, '下载结果': '获取下载链接失败', '备注': 'file/info 未返回 uri' })
          continue
        }
        rows.push(baseRow)
        downloadItems.push({
          url: downloadUrl,
          filename: runtimeFilename,
          label: `${styleCode} / ${relativePath || item?.filename || runtimeFilename}`,
          no_proxy: true,
        })
      } catch (error) {
        rows.push({ ...baseRow, '下载结果': '获取下载链接失败', '备注': String(error?.message || error) })
      }
    }

    return { rows, downloadItems }
  }

  async function buildSheinPackagePlan(options = {}) {
    const cloud = parseCloudPath(options.cloud_path)
    const styleCodes = normalizeStyleCodes(options.style_codes)
    if (!styleCodes.length) throw new Error('请至少输入一个款号')
    const mount = await resolveMount(cloud)
    const rows = []
    const downloadItems = []
    const counters = { fileIndex: 0 }

    for (const styleCode of styleCodes) {
      const plan = await buildStylePlan(styleCode, cloud, mount, counters)
      rows.push(...plan.rows)
      downloadItems.push(...plan.downloadItems)
    }

    return {
      cloud,
      mount,
      styleCodes,
      rows,
      downloadItems,
      folderHash: buildFolderHashRoute(mount.mountId, cloud.relativePath),
    }
  }

  function finalizeRows(plannedRows, downloadResult) {
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
        '备注': result?.success ? row['备注'] : String(result?.error || '下载失败'),
      }
    })
  }

  function nextPhase(name, sleepMs = 0, newShared = shared, data = []) {
    return { success: true, data, meta: { action: 'next_phase', next_phase: name, sleep_ms: sleepMs, shared: newShared } }
  }

  function downloadUrls(items, nextPhaseName, newShared) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'download_urls',
        items,
        shared_key: 'download_result',
        strict: false,
        concurrency: DOWNLOAD_CONCURRENCY,
        retry_attempts: DOWNLOAD_RETRY_ATTEMPTS,
        retry_delay_ms: DOWNLOAD_RETRY_DELAY_MS,
        recovery_retry_attempts: 2,
        recovery_retry_delay_ms: 1800,
        recovery_concurrency: 2,
        progress_total: items.length,
        next_phase: nextPhaseName,
        sleep_ms: 0,
        shared: newShared,
      },
    }
  }

  function complete(data = [], newShared = shared) {
    return { success: true, data, meta: { action: 'complete', has_more: false, shared: newShared } }
  }

  function exposeHelpers() {
    if (!testExports || typeof testExports !== 'object') return
    Object.assign(testExports, {
      parseCloudPath,
      normalizeStyleCodes,
      isWithinPath,
      relativeToRoot,
      buildFolderHashRoute,
      selectStyleFolder,
      collectFolderTree,
      buildSheinPackagePlan,
      finalizeRows,
    })
  }

  exposeHelpers()
  if (phase === '__exports__') return complete([], shared)

  try {
    if (phase === 'init' || phase === 'main') {
      const cloud = parseCloudPath(params.cloud_path)
      const styleCodes = normalizeStyleCodes(params.style_codes)
      if (!styleCodes.length) throw new Error('请至少输入一个款号')
      const mount = await resolveMount(cloud)
      const folderHash = buildFolderHashRoute(mount.mountId, cloud.relativePath)
      return nextPhase('ensure_folder', 0, {
        cloud,
        mount,
        style_codes: styleCodes,
        folder_hash: folderHash,
        total_rows: styleCodes.length,
        current_exec_no: 1,
        current_buyer_id: styleCodes[0],
        current_store: cloud.relativePath || mount.mountName,
      })
    }

    if (phase === 'ensure_folder') {
      const targetHash = String(shared.folder_hash || '')
      if (targetHash && location.hash !== targetHash) {
        location.hash = targetHash
        return nextPhase('plan_downloads', 1200, shared)
      }
      return nextPhase('plan_downloads', 0, shared)
    }

    if (phase === 'plan_downloads') {
      const plan = await buildSheinPackagePlan({
        cloud_path: shared.cloud?.raw || params.cloud_path,
        style_codes: shared.style_codes || params.style_codes,
      })
      const nextShared = {
        ...shared,
        planned_rows: plan.rows,
        pending_download_count: plan.downloadItems.length,
        total_rows: plan.styleCodes.length,
        current_exec_no: plan.styleCodes.length,
        current_buyer_id: plan.styleCodes[plan.styleCodes.length - 1] || '',
      }
      if (!plan.downloadItems.length) return complete(plan.rows, nextShared)
      return downloadUrls(plan.downloadItems, 'finalize_downloads', nextShared)
    }

    if (phase === 'finalize_downloads') {
      const rows = finalizeRows(shared.planned_rows, shared.download_result)
      return complete(rows, {
        ...shared,
        planned_rows: rows,
        pending_download_count: 0,
      })
    }

    return { success: false, error: `未知 phase: ${phase}` }
  } catch (error) {
    return { success: false, error: String(error?.message || error) }
  }
})()
