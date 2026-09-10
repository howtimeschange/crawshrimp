(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const IMAGE_EXTENSIONS = /\.(?:jpe?g|png|webp|psd)$/i
  const CLOUD_FILE_EXTENSIONS = /\.(?:jpe?g|png|webp|psd)$/i
  const LIST_PAGE_SIZE = 500
  const SEARCH_SCOPE = '["filename", "tag"]'
  const SEARCH_REQUEST_TIMEOUT_MS = 10000
  const SEARCH_TOTAL_TIMEOUT_MS = 20000
  const SEARCH_MAX_PAGES = 8
  const MAX_UPLOAD_BATCH_FILES = 4
  const STYLE_SEARCH_MOUNT_NAME = '巴拉营运BU-商品'
  const STYLE_SEARCH_PATH_SEGMENT = '模拍原图'
  const HASH_INPUT_ID = 'crawshrimp-local-content-check'

  // Semir filehash is full-file SHA-1 (confirmed against existing uploaded files).
  // Stream 4 MiB slices so large PSDs do not need to be loaded in full.
  async function localFileHash(file) {
    const state = [0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476, 0xc3d2e1f0 | 0]
    const words = new Int32Array(80)
    function blocks(bytes, length) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      for (let offset = 0; offset < length; offset += 64) {
        for (let i = 0; i < 16; i += 1) words[i] = view.getInt32(offset + i * 4)
        for (let i = 16; i < 80; i += 1) {
          const word = words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16]
          words[i] = (word << 1) | (word >>> 31)
        }
        let [a, b, c, d, e] = state
        for (let i = 0; i < 80; i += 1) {
          const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d
          const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6
          const next = (((a << 5) | (a >>> 27)) + f + e + k + words[i]) | 0
          e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = next
        }
        state[0] = (state[0] + a) | 0
        state[1] = (state[1] + b) | 0
        state[2] = (state[2] + c) | 0
        state[3] = (state[3] + d) | 0
        state[4] = (state[4] + e) | 0
      }
    }
    let tail = new Uint8Array(0)
    for (let offset = 0; offset < file.size; offset += 4 * 1024 * 1024) {
      const bytes = new Uint8Array(await file.slice(offset, offset + 4 * 1024 * 1024).arrayBuffer())
      const length = bytes.length - bytes.length % 64
      blocks(bytes, length)
      tail = bytes.slice(length)
    }
    const padding = new Uint8Array(Math.ceil((tail.length + 9) / 64) * 64)
    padding.set(tail)
    padding[tail.length] = 0x80
    const view = new DataView(padding.buffer)
    view.setUint32(padding.length - 8, Math.floor(file.size / 0x20000000))
    view.setUint32(padding.length - 4, (file.size * 8) >>> 0)
    blocks(padding, padding.length)
    const digest = new DataView(new ArrayBuffer(20))
    state.forEach((value, i) => digest.setInt32(i * 4, value))
    return Array.from(new Uint8Array(digest.buffer), byte => byte.toString(16).padStart(2, '0')).join('')
  }

  function localContentMatches(source, target) {
    const sourceHash = compact(source?.filehash).toLowerCase()
    const targetHash = compact(target?.filehash || target?.file_hash || target?.sha1).toLowerCase()
    return /^[a-f0-9]{40}$/.test(sourceHash) && sourceHash === targetHash
      && Number(source?.filesize) > 0 && Number(source.filesize) === Number(target?.filesize || target?.size || target?.file_size)
  }

  function localUploadNameMatches(source, target) {
    const expected = basename(source).toLowerCase()
    const actual = basename(target).toLowerCase()
    if (actual === expected) return true
    const dot = expected.lastIndexOf('.')
    if (dot < 0 || !actual.endsWith(expected.slice(dot))) return false
    // The cloud's "keep both" action produces 1-AI(2).jpg / 1-AI (2).jpg.
    const stem = actual.slice(0, actual.length - expected.slice(dot).length)
    return stem.startsWith(expected.slice(0, dot)) && /^\s*\(\d+\)$/.test(stem.slice(dot))
  }

  function compact(value) {
    return String(value == null ? '' : value).trim()
  }

  function slashPath(value) {
    return compact(value).replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '')
  }

  function basename(value) {
    const parts = slashPath(value).split('/')
    return parts[parts.length - 1] || ''
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))]
  }

  function fileNameKey(filePath) {
    return basename(filePath).toLocaleLowerCase()
  }

  function missingFileSignature(inspected) {
    return (inspected?.missing_files || [])
      .map(file => slashPath(typeof file === 'string' ? file : (file?.local_path || file?.fullpath || file?.source_relative_path)))
      .filter(Boolean)
      .map(path => path.toLocaleLowerCase())
      .sort()
      .join('|')
  }

  function buildUploadBatches(files) {
    const batches = []
    for (const filePath of unique(files || [])) {
      const key = fileNameKey(filePath)
      let batch = batches.find(candidate => candidate.length < MAX_UPLOAD_BATCH_FILES
        && !candidate.some(existing => fileNameKey(existing) === key))
      if (!batch) {
        batch = []
        batches.push(batch)
      }
      batch.push(filePath)
    }
    return batches
  }

  function nextPhase(name, sleepMs, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: {
        has_more: true,
        action: 'next_phase',
        next_phase: name,
        sleep_ms: sleepMs,
        shared: newShared,
      },
    }
  }

  function cdpClicks(clicks, nextPhaseName, sleepMs, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: {
        has_more: true,
        action: 'cdp_clicks',
        clicks,
        next_phase: nextPhaseName,
        sleep_ms: sleepMs,
        shared: newShared,
      },
    }
  }

  function complete(newShared = shared) {
    return {
      success: true,
      data: newShared.results || [],
      meta: {
        has_more: false,
        action: 'complete',
        shared: newShared,
        summary: {
          audit_rows: Number(newShared.audit_rows || 0),
          upload_jobs: Array.isArray(newShared.jobs) ? newShared.jobs.length : 0,
          result_rows: Array.isArray(newShared.results) ? newShared.results.length : 0,
        },
      },
    }
  }

  function fail(message, data = []) {
    return { success: false, data, error: message, message, meta: { has_more: false } }
  }

  function fileChooserUpload(click, files, job, newShared = shared, nextPhaseName = 'after_file_selection') {
    const batchIndex = Number(newShared.upload_batch_index || 0)
    const batchCount = Array.isArray(newShared.upload_batches) && newShared.upload_batches.length
      ? newShared.upload_batches.length
      : 1
    return {
      success: true,
      data: [],
      meta: {
        has_more: true,
        action: 'file_chooser_upload',
        strict: false,
        shared_key: 'last_upload',
        items: [{
          label: `${job.style_code} ${job.folder_name}（第 ${batchIndex + 1}/${batchCount} 批，共 ${files.length} 个文件）`,
          clicks: [click],
          files,
          timeout_ms: 15000,
          settle_ms: 1200,
        }],
        next_phase: nextPhaseName,
        sleep_ms: 1500,
        shared: newShared,
      },
    }
  }

  function normalizeListing(input) {
    const root = compact(input?.root || params.source_root || '')
    const rawPaths = Array.isArray(input?.paths) ? input.paths : []
    return {
      root,
      paths: rawPaths.map(item => compact(
        typeof item === 'string' ? item : (item?.path || item?.fullPath || item?.full_path || ''),
      )).filter(path => IMAGE_EXTENSIONS.test(path)),
    }
  }

  function codedFolderForPath(filePath) {
    const parts = slashPath(filePath).split('/')
    parts.pop()
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const match = parts[index].match(/(?<!\d)(\d{17})(?!\d)/)
      if (match) return { code: match[1], code_type: 'color', folder_name: parts[index], folder_path: parts.slice(0, index + 1).join('/') }
    }
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const match = parts[index].match(/(?<!\d)(\d{12})(?!\d)/)
      if (match) return { code: match[1], code_type: 'style', folder_name: parts[index], folder_path: parts.slice(0, index + 1).join('/') }
    }
    return null
  }

  function sourceFolderEntry(byCode, folder, root) {
    const entries = byCode[folder.code] || (byCode[folder.code] = [])
    let entry = entries.find(item => pathEquals(item.folder_path, folder.folder_path))
    if (!entry) {
      const relative = relativePathWithin(folder.folder_path, root).split('/')
      entry = {
        folder_path: folder.folder_path, folder_name: folder.folder_name, code_type: folder.code_type,
        source_folder: relative.length > 1 ? relative[0] : basename(root),
        files: [], root_files: [], upload_folders: [], copy_entries: [], structured_files: [], directories: [],
      }
      entries.push(entry)
    }
    return entry
  }

  function indexSourceFiles(listing) {
    const byCode = {}
    for (const filePath of listing.paths) {
      const folder = codedFolderForPath(filePath)
      if (!folder) continue
      const entry = sourceFolderEntry(byCode, folder, listing.root)
      const fullpath = slashPath(filePath)
      const relativePath = fullpath.slice(folder.folder_path.length).replace(/^\/+/, '')
      const parts = relativePath.split('/').filter(Boolean)
      entry.files.push(filePath)
      entry.structured_files.push({ filename: basename(filePath), local_path: filePath, source_relative_path: relativePath })
      if (parts.length <= 1) entry.root_files.push(filePath)
      else {
        entry.upload_folders.push(`${folder.folder_path}/${parts[0]}`)
        for (let index = 1; index < parts.length; index += 1) {
          entry.directories.push(parts.slice(0, index).join('/'))
        }
      }
    }
    for (const entry of Object.values(byCode).flat()) {
      for (const key of ['files', 'root_files', 'upload_folders', 'directories']) entry[key] = unique(entry[key])
    }
    return byCode
  }

  function normalizeCloudSourceFile(item) {
    return {
      filename: compact(item?.filename || item?.name || item?.file_name || basename(item?.fullpath || item?.path)),
      fullpath: slashPath(item?.fullpath || item?.full_path || item?.path),
      filesize: Number(item?.filesize || item?.size || item?.file_size || 0),
      filehash: compact(item?.filehash || item?.file_hash || item?.sha1).toLowerCase(),
      mtime: item?.mtime || item?.modified_at || item?.updated_at || '',
    }
  }

  function indexCloudSourceFiles(files, root) {
    const byCode = {}
    for (const rawFile of files || []) {
      const file = normalizeCloudSourceFile(rawFile)
      if (!file.fullpath || !CLOUD_FILE_EXTENSIONS.test(file.filename)) continue
      const folder = codedFolderForPath(file.fullpath)
      if (!folder) continue
      const entry = sourceFolderEntry(byCode, folder, root)
      const relativePath = file.fullpath.slice(folder.folder_path.length).replace(/^\/+/, '')
      const parts = relativePath.split('/').filter(Boolean)
      const structuredFile = { ...file, source_relative_path: relativePath }
      entry.files.push(structuredFile)
      entry.structured_files.push(structuredFile)
      if (parts.length <= 1) entry.copy_entries.push(structuredFile)
      else {
        entry.copy_entries.push({ filename: parts[0], fullpath: `${folder.folder_path}/${parts[0]}`, dir: 1 })
        for (let index = 1; index < parts.length; index += 1) {
          entry.directories.push(parts.slice(0, index).join('/'))
        }
      }
    }
    for (const entry of Object.values(byCode).flat()) {
      const seen = new Set()
      entry.files = entry.files.filter(file => {
        const key = file.fullpath.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      for (const key of ['copy_entries', 'structured_files']) {
        const seenPaths = new Set()
        entry[key] = entry[key].filter(item => {
          const path = slashPath(item?.fullpath || item?.local_path).toLowerCase()
          if (!path || seenPaths.has(path)) return false
          seenPaths.add(path)
          return true
        })
      }
      entry.directories = unique(entry.directories)
    }
    return byCode
  }

  function parseCloudTarget(value) {
    const raw = compact(value).replace(/\\/g, '/')
    const divider = raw.indexOf('//')
    if (divider <= 0 || raw.indexOf('//', divider + 2) >= 0) {
      throw new Error('云盘目标路径必须且只能包含一个 //')
    }
    const mountName = compact(raw.slice(0, divider))
    const relativePath = slashPath(raw.slice(divider + 2))
    const folderName = basename(relativePath)
    const parentPath = slashPath(relativePath.slice(0, Math.max(0, relativePath.length - folderName.length)))
    if (!mountName || !relativePath || !folderName) throw new Error('云盘目标路径不完整')
    return { raw, mountName, relativePath, parentPath, folderName }
  }

  function parentPathOf(fullpath) {
    const path = slashPath(fullpath)
    const name = basename(path)
    return slashPath(path.slice(0, Math.max(0, path.length - name.length)))
  }

  function runDateText(value = new Date()) {
    return `${value.getMonth() + 1}.${value.getDate()}`
  }

  function resultRow(job, status, cloudCount, note) {
    return {
      '日期': compact(job?.result_date || shared.result_date) || runDateText(),
      '源文件夹': unique(job?.source_folders || []).join('；'),
      '款号': job?.style_code || '',
      '产品线': unique(job?.product_lines || []).join('；'),
      '款色号': Array.isArray(job?.color_codes) ? job.color_codes.join('、') : compact(job?.color_code),
      '批次': unique(job?.batches || []).join('；'),
      '导购': unique(job?.guide_infos || []).join('；'),
      '本地图片数': Array.isArray(job?.files) ? job.files.length : 0,
      '云盘文件数': Number.isFinite(Number(cloudCount)) ? Number(cloudCount) : '',
      '上传状态': status,
      '云盘目标路径': job?.cloud_target || job?.requested_cloud_target || '',
      '备注': compact(note),
    }
  }

  function buildJobs(rows, sourceIndex, sourceKind = 'local', resultDate = runDateText()) {
    const results = []
    const groups = new Map()
    const styleTargets = new Map()
    const blockedStyles = new Set()
    const allowedStatuses = new Set(['待审核', '审核通过', '通过', '已审核'])

    rows.forEach((row, rowIndex) => {
      const status = compact(row?.['状态'])
      const styleCode = compact(row?.['款号']).match(/\d{12}/)?.[0] || ''
      const colorCode = compact(row?.['款色号']).match(/\d{17}/)?.[0] || ''
      const cloudTarget = compact(row?.['云盘目标路径'])
      const folderName = compact(row?.['最终文件夹名'])
      const base = {
        style_code: styleCode, color_code: colorCode, cloud_target: cloudTarget, files: [],
        result_date: resultDate,
        source_folders: [compact(row?.['源文件夹'])],
        product_lines: [compact(row?.['产品线'])],
        batches: [compact(row?.['批次'])],
        guide_infos: [compact(row?.['导购'])],
      }

      if (!allowedStatuses.has(status)) {
        results.push(resultRow(base, '跳过', '', `审核表第 ${rowIndex + 2} 行状态为“${status || '空'}”`))
        if (status === '需复核' && styleCode) blockedStyles.add(styleCode)
        return
      }
      if (!styleCode || (colorCode && colorCode.slice(0, 12) !== styleCode)) {
        results.push(resultRow(base, '需复核', '', `审核表第 ${rowIndex + 2} 行款号/款色号不合法`))
        if (styleCode) blockedStyles.add(styleCode)
        return
      }
      const sourceCode = colorCode || styleCode
      const candidates = (sourceIndex[sourceCode] || []).filter(source =>
        (!compact(row?.['源文件夹']) || source.source_folder === compact(row['源文件夹']))
        && (!compact(row?.['款式文件夹']) || source.folder_name === compact(row['款式文件夹'])))
      if (candidates.length > 1) {
        results.push(resultRow(base, '需复核', '', `审核表第 ${rowIndex + 2} 行对应多个来源文件夹，无法唯一定位；请缩小源目录范围并重新生成审核表`))
        blockedStyles.add(styleCode)
        return
      }
      const source = candidates[0]
      if (!source?.files?.length) {
        results.push(resultRow(base, '需复核', '', `没有找到${colorCode ? '款色号' : '款号'} ${sourceCode} 对应的${sourceKind === 'cloud' ? '云盘' : '本地'}图片文件夹`))
        blockedStyles.add(styleCode)
        return
      }
      const auditCountText = compact(row?.['图片数'])
      if (auditCountText && (!Number.isInteger(Number(auditCountText)) || Number(auditCountText) !== source.files.length)) {
        results.push(resultRow(base, '需复核', '', `来源图片数与审核表不一致：审核时 ${auditCountText} 个，当前 ${source.files.length} 个，请重新生成审核表`))
        blockedStyles.add(styleCode)
        return
      }
      let target
      try {
        target = parseCloudTarget(cloudTarget)
      } catch (error) {
        results.push(resultRow(base, '需复核', '', `审核表第 ${rowIndex + 2} 行：${error.message}`))
        blockedStyles.add(styleCode)
        return
      }
      if (folderName && folderName !== target.folderName) {
        results.push(resultRow(base, '需复核', '', `最终文件夹名与云盘目标路径末级不一致`))
        blockedStyles.add(styleCode)
        return
      }

      if (!styleTargets.has(styleCode)) styleTargets.set(styleCode, new Set())
      styleTargets.get(styleCode).add(target.raw)
      const key = `${styleCode}\n${target.raw}`
      if (!groups.has(key)) {
        groups.set(key, {
          style_code: styleCode,
          result_date: resultDate,
          color_codes: [],
          source_folders: [],
          product_lines: [],
          batches: [],
          guide_infos: [],
          cloud_target: target.raw,
          mount_name: target.mountName,
          relative_path: target.relativePath,
          parent_path: target.parentPath,
          folder_name: target.folderName,
          source_kind: sourceKind,
          files: [],
          root_files: [],
          upload_folders: [],
          copy_entries: [],
          structured_files: [],
          directories: [],
        })
      }
      const job = groups.get(key)
      if (colorCode) job.color_codes.push(colorCode)
      for (const key of ['source_folders', 'product_lines', 'batches', 'guide_infos']) job[key].push(...base[key])
      job.files.push(...source.files)
      for (const key of ['root_files', 'upload_folders', 'copy_entries', 'structured_files', 'directories']) {
        job[key].push(...(source[key] || []))
      }
    })

    const jobs = []
    for (const job of groups.values()) {
      const targets = styleTargets.get(job.style_code) || new Set()
      if (blockedStyles.has(job.style_code)) {
        results.push(resultRow(job, '需复核', '', `同款存在需复核或无${sourceKind === 'cloud' ? '云盘' : '本地'}图片的款色；为避免形成不完整款号文件夹，${sourceKind === 'cloud' ? '整款不复制' : '整款不上传'}`))
        continue
      }
      if (targets.size !== 1) {
        results.push(resultRow(job, '需复核', '', `同一款号在审核表中出现 ${targets.size} 个不同云盘目标路径`))
        continue
      }
      job.color_codes = unique(job.color_codes)
      if (sourceKind === 'cloud') {
        const seen = new Set()
        job.files = job.files.filter(file => {
          const key = slashPath(file?.fullpath).toLowerCase()
          if (!key || seen.has(key)) return false
          seen.add(key)
          return true
        })
      } else {
        job.files = unique(job.files)
      }
      for (const key of ['root_files', 'upload_folders', 'directories']) job[key] = unique(job[key])
      for (const key of ['copy_entries', 'structured_files']) {
        const seenPaths = new Set()
        job[key] = job[key].filter(item => {
          const path = slashPath(item?.fullpath || item?.local_path).toLowerCase()
          if (!path || seenPaths.has(path)) return false
          seenPaths.add(path)
          return true
        })
      }
      jobs.push(job)
    }
    return { jobs, results }
  }

  async function fetchJson(url, options = {}) {
    // Copy submission must not be retried after an ambiguous request timeout.
    const controller = !options.signal && !String(url).endsWith('/file/copy')
      && typeof AbortController !== 'undefined' ? new AbortController() : null
    const timeout = controller ? setTimeout(() => controller.abort(), SEARCH_REQUEST_TIMEOUT_MS) : null
    try {
      const response = await fetch(url, { credentials: 'include', ...options,
        ...(controller ? { signal: controller.signal } : {}) })
      if (!response.ok) throw new Error(response.status + ' ' + (response.statusText || url))
      const payload = await response.json()
      if (payload?.code != null && ![0, 200].includes(Number(payload.code))) {
        throw new Error(compact(payload.message || payload.msg || ('接口返回 ' + payload.code)))
      }
      return payload?.data ?? payload
    } catch (error) {
      if (controller?.signal.aborted) throw new Error('云盘读取请求超时（10秒）')
      throw error
    } finally {
      if (timeout != null) clearTimeout(timeout)
    }
  }

  async function fetchMounts() {
    const payload = await fetchJson('/fengcloud/1/account/mount')
    if (Array.isArray(payload)) return payload
    return payload?.list || payload?.rows || []
  }

  function normalizeListedItem(item, parentPath) {
    const filename = compact(item?.filename || item?.name || item?.file_name)
    const fullpath = slashPath(item?.fullpath || item?.full_path || item?.path || [parentPath, filename].filter(Boolean).join('/'))
    return { ...item, filename, fullpath }
  }

  function extractFolderItems(payload) {
    const candidates = [payload, payload?.list, payload?.rows, payload?.files, payload?.items,
      payload?.data, payload?.data?.list, payload?.data?.rows, payload?.data?.files, payload?.data?.items]
    return candidates.find(Array.isArray)
  }

  function extractFolderTotal(payload) {
    const values = [payload?.total, payload?.count, payload?.data?.total, payload?.data?.count]
    const found = values.filter(value => value != null && compact(value) !== '').map(Number)
      .find(value => Number.isInteger(value) && value >= 0)
    return found == null ? null : found
  }

  async function fetchFolderPage(mountId, fullpath, start, method, endpoint) {
    const query = new URLSearchParams({
      order: 'filename asc', size: String(LIST_PAGE_SIZE), start: String(start),
      mount_id: String(mountId), fullpath: String(fullpath || ''), path: String(fullpath || ''), current: '1',
    })
    if (method === 'GET') return fetchJson(`${endpoint}?${query.toString()}`)
    return fetchJson(endpoint, {
      method,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: query.toString(),
    })
  }

  async function listFolderItems(mountId, fullpath) {
    const attempts = [
      ['GET', '/fengcloud/1/file/ls'], ['GET', '/fengcloud/2/file/list'],
      ['POST', '/fengcloud/2/file/list'], ['GET', '/fengcloud/1/file/list'],
      ['POST', '/fengcloud/1/file/list'],
    ]
    const errors = []
    const startedAt = Date.now()
    for (const [method, endpoint] of attempts) {
      try {
        const all = []
        const seenPages = new Set()
        let start = 0
        while (true) {
          if (seenPages.size >= 40) throw new Error('列目录超过40页，请缩小处理范围')
          if (Date.now() - startedAt >= SEARCH_TOTAL_TIMEOUT_MS) throw new Error('列目录总等待超过20秒')
          const payload = await fetchFolderPage(mountId, fullpath, start, method, endpoint)
          const rawItems = extractFolderItems(payload)
          if (!Array.isArray(rawItems)) throw new Error(`${method} ${endpoint} 未返回列表`)
          const items = rawItems.map(item => normalizeListedItem(item, fullpath))
          const signature = JSON.stringify(items.map(item => item.fullpath).sort())
          if (items.length && seenPages.has(signature)) throw new Error('列目录返回重复分页，无法确认完整内容')
          if (items.length) seenPages.add(signature)
          all.push(...items)
          start += items.length
          const total = extractFolderTotal(payload)
          if (!items.length && total != null && start < total) throw new Error('列目录提前返回空页，内容不完整')
          if (!items.length || (total != null ? start >= total : items.length < LIST_PAGE_SIZE)) break
        }
        return { ok: true, items: all }
      } catch (error) {
        errors.push(compact(error?.message || error))
      }
    }
    return { ok: false, items: [], error: errors[0] || '列目录失败' }
  }

  async function collectCloudSourceFiles(mountId, sourcePath) {
    const queue = [{ fullpath: slashPath(sourcePath), depth: 0 }]
    const visited = new Set()
    const files = []
    while (queue.length) {
      const current = queue.shift()
      const key = slashPath(current.fullpath).toLowerCase()
      if (!key || visited.has(key)) continue
      visited.add(key)
      const listed = await listFolderItems(mountId, current.fullpath)
      if (!listed.ok) throw new Error(`${current.fullpath}：${listed.error}`)
      for (const item of listed.items) {
        if (isDirectory(item)) {
          if (current.depth < 16) queue.push({ fullpath: item.fullpath, depth: current.depth + 1 })
          continue
        }
        if (!CLOUD_FILE_EXTENSIONS.test(item.filename)) continue
        files.push(normalizeCloudSourceFile(item))
        if (files.length > 10000) throw new Error('云盘源路径文件超过10000个，请缩小扫描范围')
      }
    }
    return files
  }

  function relativePathWithin(fullpath, rootPath) {
    const full = slashPath(fullpath)
    const root = slashPath(rootPath)
    if (full.toLowerCase() === root.toLowerCase()) return ''
    return full.toLowerCase().startsWith(`${root.toLowerCase()}/`)
      ? full.slice(root.length + 1)
      : basename(full)
  }

  async function collectCloudTargetTree(mountId, rootPath) {
    const queue = [{ fullpath: slashPath(rootPath), depth: 0 }]
    const visited = new Set()
    const files = []
    const directories = []
    while (queue.length) {
      const current = queue.shift()
      const key = slashPath(current.fullpath).toLowerCase()
      if (!key || visited.has(key)) continue
      visited.add(key)
      const listed = await listFolderItems(mountId, current.fullpath)
      if (!listed.ok) throw new Error(`${current.fullpath}：${listed.error}`)
      for (const item of listed.items) {
        const relativePath = relativePathWithin(item.fullpath, rootPath)
        if (isDirectory(item)) {
          directories.push({ ...item, target_relative_path: relativePath })
          if (current.depth < 16) queue.push({ fullpath: item.fullpath, depth: current.depth + 1 })
          continue
        }
        if (!CLOUD_FILE_EXTENSIONS.test(item.filename)) continue
        files.push({ ...normalizeCloudSourceFile(item), target_relative_path: relativePath })
      }
      if (files.length > 10000) throw new Error('云盘目标路径文件超过10000个，请缩小范围')
    }
    return { files, directories }
  }

  function cloudSourceMatchesItem(sourceFile, targetItem) {
    const source = normalizeCloudSourceFile(sourceFile)
    const target = normalizeCloudSourceFile(targetItem)
    const sourceRelative = slashPath(sourceFile?.source_relative_path).toLowerCase()
    const targetRelative = slashPath(targetItem?.target_relative_path).toLowerCase()
    if (sourceRelative && sourceRelative !== targetRelative) return false
    if (sourceFile?.local_path) return localContentMatches(sourceFile, targetItem)
    return /^[a-f0-9]{40}$/.test(source.filehash) && source.filehash === target.filehash
      && source.filesize > 0 && source.filesize === target.filesize
      && source.filename.toLowerCase() === target.filename.toLowerCase()
  }

  function cloudCopyState(job, tree) {
    const available = [...(tree.files || [])]
    const missing = []
    let matched = 0
    const sourceFiles = job.structured_files?.length ? job.structured_files : job.files || []
    for (const sourceFile of sourceFiles) {
      const source = normalizeCloudSourceFile(sourceFile)
      if (!/^[a-f0-9]{40}$/.test(source.filehash) || !(source.filesize > 0)) {
        throw new Error('源文件缺少有效SHA-1指纹或大小，无法核验：' + source.filename)
      }
      const index = available.findIndex(item => cloudSourceMatchesItem(sourceFile, item))
      if (index >= 0) {
        available.splice(index, 1)
        matched += 1
      } else {
        missing.push(normalizeCloudSourceFile(sourceFile))
        missing[missing.length - 1].source_relative_path = sourceFile.source_relative_path || ''
      }
    }
    const targetDirectories = new Set((tree.directories || []).map(item => slashPath(item.target_relative_path).toLowerCase()))
    const missingDirectories = (job.directories || []).filter(path => !targetDirectories.has(slashPath(path).toLowerCase()))
    const expectedDirectories = new Set((job.directories || []).map(path => slashPath(path).toLowerCase()))
    const unexpectedDirectories = (tree.directories || []).filter(item => !expectedDirectories.has(slashPath(item.target_relative_path).toLowerCase()))
    const targetTopEntries = new Set([
      ...(tree.files || []).filter(item => !slashPath(item.target_relative_path).includes('/')).map(item => `f:${item.filename.toLowerCase()}`),
      ...(tree.directories || []).filter(item => !slashPath(item.target_relative_path).includes('/')).map(item => `d:${item.filename.toLowerCase()}`),
    ])
    const copyEntries = job.copy_entries?.length ? job.copy_entries : sourceFiles
    const missingCopyEntries = copyEntries.filter(item => {
      const type = isDirectory(item) ? 'd' : 'f'
      return !targetTopEntries.has(`${type}:${compact(item.filename).toLowerCase()}`)
    })
    const missingTopNames = new Set(missingCopyEntries.map(item => compact(item.filename).toLowerCase()))
    const hasPartialExistingStructure = [...missing, ...missingDirectories.map(path => ({ source_relative_path: path }))]
      .some(item => {
        const topName = slashPath(item.source_relative_path).split('/')[0].toLowerCase()
        return topName && !missingTopNames.has(topName)
      })
    return {
      ok: true,
      count: (tree.files || []).length,
      matched,
      missing_files: missing,
      missing_directories: missingDirectories,
      missing_copy_entries: missingCopyEntries,
      has_partial_existing_structure: hasPartialExistingStructure,
      unexpected_files: available.map(normalizeCloudSourceFile),
      unexpected_directories: unexpectedDirectories,
    }
  }

  async function inspectCloudCopy(job) {
    try {
      return cloudCopyState(job, await collectCloudTargetTree(job.mount_id, job.relative_path))
    } catch (error) {
      return { ok: false, count: 0, matched: 0, missing_files: [], missing_directories: [], unexpected_files: [], unexpected_directories: [], error: compact(error?.message || error) }
    }
  }

  function hasLocalSubfolders(job) {
    return job?.source_kind === 'local' && Array.isArray(job.upload_folders) && job.upload_folders.length > 0
  }

  function buildStructuredUploadPlan(job, inspected = null) {
    if (inspected) {
      const missingRelativePaths = new Set((inspected.missing_files || [])
        .map(item => slashPath(item.source_relative_path).toLocaleLowerCase()))
      const missingRootFiles = (job.structured_files || [])
        .filter(item => {
          const relativePath = slashPath(item.source_relative_path)
          return relativePath && !relativePath.includes('/')
            && missingRelativePaths.has(relativePath.toLocaleLowerCase())
        })
        .map(item => item.local_path)
      const missingTopDirectories = new Set((inspected.missing_directories || [])
        .map(path => slashPath(path).split('/')[0].toLocaleLowerCase()))
      const missingFolders = (job.upload_folders || [])
        .filter(folderPath => missingTopDirectories.has(basename(folderPath).toLocaleLowerCase()))
      return [
        ...buildUploadBatches(missingRootFiles).map(files => ({ kind: 'files', files })),
        ...missingFolders.map(folderPath => ({ kind: 'folder', folder_path: folderPath })),
      ]
    }
    return [
      ...buildUploadBatches(job.root_files || []).map(files => ({ kind: 'files', files })),
      ...(job.upload_folders || []).map(folderPath => ({ kind: 'folder', folder_path: folderPath })),
    ]
  }

  async function copyCloudFiles(job, files) {
    const fullpaths = (files || []).map(file => encodeURIComponent(slashPath(file?.fullpath))).filter(Boolean).join('|')
    if (!fullpaths) throw new Error('没有可提交复制的云盘源文件')
    return fetchJson('/fengcloud/1/file/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mount_id: job.source_mount_id,
        target_mount_id: job.mount_id,
        target_fullpath: job.relative_path,
        fullpaths,
      }),
    })
  }

  async function searchCloudItems(mountId, keyword) {
    const all = []
    const seenPages = new Set()
    const startedAt = Date.now()
    let start = 0
    let pageCount = 0
    while (true) {
      if (pageCount >= SEARCH_MAX_PAGES) {
        throw new Error(`搜索款号“${compact(keyword)}”超过 ${SEARCH_MAX_PAGES} 页，已停止异常分页`)
      }
      const remainingMs = SEARCH_TOTAL_TIMEOUT_MS - (Date.now() - startedAt)
      if (remainingMs <= 0) {
        throw new Error(`搜索款号“${compact(keyword)}”总耗时超过 ${SEARCH_TOTAL_TIMEOUT_MS / 1000} 秒`)
      }
      const body = new URLSearchParams({
        size: String(LIST_PAGE_SIZE),
        start: String(start),
        keyword: compact(keyword),
        mount_id: String(mountId || ''),
        scope: SEARCH_SCOPE,
      })
      const controller = typeof AbortController === 'undefined' ? null : new AbortController()
      const requestTimeoutMs = Math.min(SEARCH_REQUEST_TIMEOUT_MS, remainingMs)
      const timeout = controller
        ? setTimeout(() => controller.abort(), requestTimeoutMs)
        : null
      let payload
      try {
        payload = await fetchJson('/fengcloud/2/file/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
          ...(controller ? { signal: controller.signal } : {}),
        })
      } catch (error) {
        if (controller?.signal?.aborted) {
          throw new Error(`搜索款号“${compact(keyword)}”单页等待超过 ${Math.ceil(requestTimeoutMs / 1000)} 秒`)
        }
        throw error
      } finally {
        if (timeout != null) clearTimeout(timeout)
      }
      const items = extractFolderItems(payload)
      if (!Array.isArray(items)) throw new Error('云盘搜索接口未返回列表')
      const total = extractFolderTotal(payload)
      const pageSignature = items.map(item => slashPath(
        item?.fullpath || item?.full_path || item?.path || `${item?.filename || item?.name || ''}:${item?.id || ''}`,
      ).toLocaleLowerCase()).join('\n')
      if (items.length && seenPages.has(pageSignature)) {
        throw new Error(`搜索款号“${compact(keyword)}”返回重复分页，已停止循环`)
      }
      if (items.length) seenPages.add(pageSignature)
      all.push(...items)
      start += items.length
      pageCount += 1
      if (!items.length && total != null && start < total) throw new Error('搜索提前返回空页，内容不完整')
      if (!items.length || (total != null ? start >= total : items.length < LIST_PAGE_SIZE)) break
      if (Date.now() - startedAt >= SEARCH_TOTAL_TIMEOUT_MS) {
        throw new Error(`搜索款号“${compact(keyword)}”总耗时超过 ${SEARCH_TOTAL_TIMEOUT_MS / 1000} 秒`)
      }
    }
    return all
  }

  function isDirectory(item) {
    const flags = [item?.dir, item?.is_dir, item?.is_directory, item?.directory]
    return flags.some(value => value === true || value === 1 || value === '1')
      || ['dir', 'folder'].includes(compact(item?.type).toLowerCase())
  }

  function findChildFolder(items, name) {
    return items.find(item => item.filename === name && (isDirectory(item) || !CLOUD_FILE_EXTENSIONS.test(item.filename)))
  }

  function pathEquals(left, right) {
    return slashPath(left).toLowerCase() === slashPath(right).toLowerCase()
  }

  function isWithinPath(fullpath, parentPath) {
    const full = slashPath(fullpath).toLowerCase()
    const parent = slashPath(parentPath).toLowerCase()
    return !parent || full === parent || full.startsWith(`${parent}/`)
  }

  function isExactStyleFolderName(name, styleCode) {
    const text = compact(name)
    return text.startsWith(styleCode) && !/^\d$/.test(text.slice(styleCode.length, styleCode.length + 1))
  }

  function hasExactPathSegment(fullpath, segment) {
    return slashPath(fullpath).split('/').some(part => compact(part) === segment)
  }

  function styleFolderCandidates(job, items) {
    const byPath = new Map()
    for (const rawItem of items || []) {
      const item = normalizeListedItem(rawItem, '')
      if (!isDirectory(item) || !isExactStyleFolderName(item.filename, job.style_code)) continue
      if (!hasExactPathSegment(parentPathOf(item.fullpath), STYLE_SEARCH_PATH_SEGMENT)) continue
      const key = slashPath(item.fullpath).toLocaleLowerCase()
      if (key && !byPath.has(key)) byPath.set(key, item)
    }
    return [...byPath.values()]
  }

  function preservedReturnFolderName(existingFolderName, requestedFolderName, styleCode) {
    const existing = compact(existingFolderName)
    const requested = compact(requestedFolderName)
    if (!styleCode || !isExactStyleFolderName(requested, styleCode)) {
      return { error: '本次目标名称不是准确款号开头，无法安全提取需要追加的命名内容' }
    }
    const types = ['AI新回图', '导购回图'].filter(type => requested.includes(type))
    if (types.length > 1) return { error: '本次目标名称包含多个回图类型，无法唯一确定要更新的日期' }
    const type = types[0]
    if (type && existing.includes(type)) {
      if (existing.split(type).length !== 2 || requested.split(type).length !== 2) {
        return { error: `旧名称或本次目标名称存在多个“${type}”记录，无法唯一确定要更新的日期` }
      }
      const pattern = new RegExp(`(${type}\\s*)(\\d{1,2}\\.\\d{1,2})(?!\\d)`)
      const existingDate = existing.match(pattern)?.[2]
      const requestedDate = requested.match(pattern)?.[2]
      if (!existingDate || !requestedDate) {
        return { error: `旧文件夹“${existing}”含“${type}”，但无法同时识别旧日期和本次日期` }
      }
      return {
        folderName: existing.replace(pattern, (_, prefix) => `${prefix}${requestedDate}`),
        note: `仅更新“${type}”后的日期，保留原名称其他内容`,
      }
    }
    const suffix = compact(requested.slice(styleCode.length))
    if (!suffix) return { folderName: existing, note: '本次目标名称没有新增内容，保留旧名称' }
    if (` ${existing} `.includes(` ${suffix} `)) {
      return { folderName: existing, note: `本次命名内容“${suffix}”已存在，未重复追加` }
    }
    return { folderName: `${existing} ${suffix}`, note: `完整保留旧名称，追加本次命名内容“${suffix}”` }
  }

  function updateCurrentJob(updatedJob, newShared = shared) {
    const index = Number(newShared.job_index || 0)
    const jobs = [...(newShared.jobs || [])]
    jobs[index] = updatedJob
    return { ...newShared, jobs }
  }

  function prepareExistingFolderJob(job, folder, options = {}) {
    const existingParentPath = parentPathOf(folder.fullpath)
    const overriddenFolderName = compact(options.intendedFolderName)
    const intendedFolderName = overriddenFolderName || job.intended_folder_name || job.folder_name
    const intendedRelativePath = overriddenFolderName
      ? slashPath(`${existingParentPath}/${intendedFolderName}`)
      : job.intended_relative_path || job.relative_path
    const intendedCloudTarget = overriddenFolderName
      ? `${job.mount_name}//${intendedRelativePath}`
      : job.requested_cloud_target || job.cloud_target
    return {
      ...job,
      intended_folder_name: intendedFolderName,
      intended_relative_path: intendedRelativePath,
      requested_cloud_target: intendedCloudTarget,
      intended_parent_path: job.intended_parent_path || job.parent_path,
      existing_folder_name: folder.filename,
      existing_folder_path: slashPath(folder.fullpath),
      parent_path: existingParentPath,
      relative_path: slashPath(folder.fullpath),
      folder_name: folder.filename,
      cloud_target: `${job.mount_name}//${slashPath(folder.fullpath)}`,
      reuse_existing_folder: true,
      allow_existing_extras: true,
      rename_after_upload: Boolean(options.renameAfterUpload),
      fast_existing_reuse: Boolean(options.fastReuse),
      force_review_after_success: Boolean(options.forceReview),
      existing_folder_note: compact(options.note),
    }
  }

  async function findCloudFolder(mountId, parentPath, folderName) {
    const listed = await listFolderItems(mountId, parentPath)
    if (listed.ok) return { ok: true, folder: findChildFolder(listed.items, folderName) || null }
    try {
      const targetPath = slashPath([parentPath, folderName].filter(Boolean).join('/'))
      const items = await searchCloudItems(mountId, folderName)
      const folder = items
        .map(item => normalizeListedItem(item, parentPath))
        .find(item => isDirectory(item) && pathEquals(item.fullpath, targetPath)) || null
      return { ok: true, folder }
    } catch (error) {
      return { ok: false, folder: null, error: `${listed.error}；搜索接口：${compact(error?.message || error)}` }
    }
  }

  function cloudFileState(job, items) {
    const cloudFiles = items.filter(item => !isDirectory(item) && IMAGE_EXTENSIONS.test(item.filename))
    const metadata = new Map((job.local_file_meta || []).map(file => [slashPath(file.local_path).toLowerCase(), file]))
    const available = [...cloudFiles]
    const missingFiles = []
    const unverified = []
    const conflicts = []
    for (const filePath of job.files) {
      const source = metadata.get(slashPath(filePath).toLowerCase())
      if (!source || !/^[a-f0-9]{40}$/i.test(source.filehash) || !(Number(source.filesize) > 0)) {
        return { ok: false, count: cloudFiles.length, missing_files: [], ambiguous_names: [], error: `本地图片未完成内容指纹校验：${basename(filePath)}` }
      }
      // Content identity also accepts the cloud's keep-both renamed copy, one-to-one.
      const index = available.findIndex(item => localUploadNameMatches(filePath, item.filename) && localContentMatches(source, item))
      if (index >= 0) available.splice(index, 1)
      else {
        missingFiles.push(filePath)
        const sameName = cloudFiles.filter(item => fileNameKey(item.filename) === fileNameKey(filePath))
        if (sameName.length) conflicts.push(basename(filePath))
        if (sameName.some(item => !/^[a-f0-9]{40}$/i.test(compact(item.filehash || item.file_hash || item.sha1)))) unverified.push(basename(filePath))
      }
    }
    return {
      ok: !unverified.length,
      count: cloudFiles.length,
      missing_files: unique(missingFiles),
      ambiguous_names: [],
      same_name_conflicts: unique(conflicts),
      unverified_names: unique(unverified),
      error: unverified.length ? `云盘同名文件缺少可验证的内容指纹，不能判定已上传：${unique(unverified).join('、')}` : '',
    }
  }

  async function inspectCloudFiles(job) {
    const listed = await listFolderItems(job.mount_id, job.relative_path)
    if (listed.ok) return cloudFileState(job, listed.items)
    try {
      const found = new Map()
      const keywords = unique(job.files.map(filePath => basename(filePath).replace(/\.[^.]+$/, '')))
      for (const keyword of keywords) {
        const items = await searchCloudItems(job.mount_id, keyword)
        for (const item of items.map(value => normalizeListedItem(value, job.relative_path))) {
          if (isDirectory(item) || !IMAGE_EXTENSIONS.test(item.filename) || !pathEquals(parentPathOf(item.fullpath), job.relative_path)) continue
          found.set(slashPath(item.fullpath).toLowerCase(), item)
        }
      }
      return cloudFileState(job, [...found.values()])
    } catch (error) {
      return { ok: false, count: 0, missing_files: [], ambiguous_names: [], error: `${listed.error}；搜索接口：${compact(error?.message || error)}` }
    }
  }

  function buildFolderHashRoute(mountId, relativePath) {
    const base = `#/home/file/mount/${encodeURIComponent(String(mountId || ''))}`
    const path = slashPath(relativePath)
    return path ? `${base}?path=${encodeURIComponent(path)}` : base
  }

  function visible(element) {
    if (!element) return false
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
  }

  function textOf(element) {
    return compact(element?.innerText || element?.textContent)
  }

  function center(element) {
    if (!visible(element)) return null
    const rect = element.getBoundingClientRect()
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
  }

  function textElement(pattern, exact = false) {
    const candidates = [...document.querySelectorAll('button,[role="button"],li,[role="menuitem"],a,span,div')]
      .filter(visible)
      .filter(element => {
        const text = textOf(element)
        return exact ? text === pattern : text.includes(pattern)
      })
      .sort((a, b) => (a.children.length - b.children.length) || (textOf(a).length - textOf(b).length))
    return candidates[0] || null
  }

  function uploadButtonElement() {
    const candidates = [...document.querySelectorAll('button,[role="button"]')]
      .filter(visible)
      .filter(element => {
        const text = textOf(element)
        return text === '上传' || /^上传\s*[▼▽▾⌄]?$/.test(text)
      })
      .filter(element => !element.closest?.(
        '[role="dialog"],[role="menu"],[class*="dialog"],[class*="Dialog"],[class*="upload-list"],[class*="uploadList"],[class*="progress"],[class*="Progress"]',
      ))
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect()
        const bRect = b.getBoundingClientRect()
        return (aRect.top - bRect.top) || (aRect.left - bRect.left)
      })
    return candidates[0] || null
  }

  function dismissTransientMenu() {
    if (typeof document.dispatchEvent !== 'function' || typeof KeyboardEvent === 'undefined') return
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
      bubbles: true, cancelable: true,
    }))
  }

  function breadcrumbContains(name) {
    const target = compact(name).toLocaleLowerCase()
    if (!target) return false
    const routeHash = compact(location?.hash)
    const queryIndex = routeHash.indexOf('?')
    if (queryIndex >= 0) {
      try {
        const routePath = slashPath(new URLSearchParams(routeHash.slice(queryIndex + 1)).get('path') || '')
        if (routePath.split('/').some(segment => compact(segment).toLocaleLowerCase() === target)) return true
      } catch (_) {}
    }
    const selectors = [
      '[class*="breadcrumb"]', '[class*="Breadcrumb"]',
      '[class*="crumb"]', '[class*="Crumb"]',
      '[aria-label*="breadcrumb"]', '[aria-label*="Breadcrumb"]',
    ].join(',')
    return [...document.querySelectorAll(selectors)]
      .filter(visible)
      .some(element => {
        const text = textOf(element).toLocaleLowerCase()
        if (text === target) return true
        return text.split(/\s*(?:\/|>|›|»|→)\s*/)
          .some(segment => compact(segment).toLocaleLowerCase() === target)
      })
  }

  function folderEntryElement(name) {
    const target = compact(name)
    const candidates = [...document.querySelectorAll('span,div,p')]
      .filter(visible)
      .filter(element => !element.closest?.(
        '[class*="breadcrumb"],[class*="Breadcrumb"],[class*="crumb"],[class*="Crumb"],button,[role="button"],[role="menuitem"]',
      ))
    const matches = candidates.filter(element => textOf(element) === target)
    const caseInsensitiveMatches = matches.length
      ? matches
      : candidates.filter(element => textOf(element).toLocaleLowerCase() === target.toLocaleLowerCase())
    return caseInsensitiveMatches.sort((a, b) => (a.children.length - b.children.length))[0] || null
  }

  function folderListScroller() {
    const preferredSelectors = [
      '.el-scrollbar__wrap', '.ant-table-body',
      '[class*="file-list"]', '[class*="fileList"]',
      '[class*="list-body"]', '[class*="listBody"]',
      '[class*="scroll"]', '[style*="overflow"]',
    ].join(',')
    const candidates = unique([
      ...document.querySelectorAll(preferredSelectors),
      ...document.querySelectorAll('main,section,div'),
      document.scrollingElement,
    ]).filter(element => {
      if (!element || !visible(element)) return false
      const rect = element.getBoundingClientRect()
      return element.scrollHeight > element.clientHeight + 20
        && rect.width >= Math.min(420, window.innerWidth * 0.45)
        && rect.height >= 160
    }).sort((a, b) => {
      const aRect = a.getBoundingClientRect()
      const bRect = b.getBoundingClientRect()
      return (bRect.width * bRect.height) - (aRect.width * aRect.height)
    })
    return candidates[0] || null
  }

  function resetFolderListScroll() {
    const scroller = folderListScroller()
    if (!scroller) return false
    scroller.scrollTop = 0
    if (typeof Event !== 'undefined') scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
    return true
  }

  function scrollFolderList() {
    const scroller = folderListScroller()
    if (!scroller) return false
    const current = Number(scroller.scrollTop || 0)
    const maximum = Math.max(0, Number(scroller.scrollHeight || 0) - Number(scroller.clientHeight || 0))
    const next = Math.min(maximum, current + Math.max(240, Math.round(Number(scroller.clientHeight || 0) * 0.72)))
    if (next <= current + 1) return false
    scroller.scrollTop = next
    if (typeof Event !== 'undefined') scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
    return true
  }

  function openFolderByName(name) {
    const element = folderEntryElement(name)
    if (!element) return false
    try { element.scrollIntoView({ block: 'center', inline: 'center' }) } catch (_) {}
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, detail: 1 }))
    element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window, detail: 2 }))
    return textOf(element)
  }

  function parentSegments(job) {
    return slashPath(job?.parent_path).split('/').map(compact).filter(Boolean)
  }

  function dialogElement() {
    return [...document.querySelectorAll('[role="dialog"],.el-dialog,.dialog')].filter(visible).pop() || null
  }

  function folderNameInput(dialog) {
    if (dialog) return [...dialog.querySelectorAll('input')].find(visible) || null
    const active = document.activeElement
    if (active && compact(active.tagName).toLowerCase() === 'input' && visible(active)) return active
    const inputs = [...document.querySelectorAll('input')].filter(visible)
    return inputs.find(input => /新建文件夹/.test(compact(input.value)))
      || inputs.find(input => /文件夹|名称/.test(compact(input.placeholder)) && !/搜索/.test(compact(input.placeholder)))
      || null
  }

  function submitInlineFolderName(input) {
    for (const type of ['keydown', 'keypress', 'keyup']) {
      input.dispatchEvent(new KeyboardEvent(type, {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true,
      }))
    }
    input.blur?.()
  }

  function fillNewFolderName(name, retryPhaseName, nextPhaseName) {
    const dialog = dialogElement()
    const input = folderNameInput(dialog)
    if (!input) return retryOrReview(retryPhaseName, '新建文件夹窗口没有可填写的名称输入框')
    input.focus?.()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (setter) setter.call(input, name)
    else input.value = name
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    if (!dialog) {
      submitInlineFolderName(input)
      return nextPhase(nextPhaseName, 900, { ...shared, phase_retries: 0 })
    }
    const buttons = [...dialog.querySelectorAll('button,[role="button"]')].filter(visible)
    const confirm = buttons.find(element => /^(确定|创建)$/.test(textOf(element)))
    const click = center(confirm)
    if (!click) return retryOrReview(retryPhaseName, '新建文件夹窗口没有“确定/创建”按钮')
    return cdpClicks([click], nextPhaseName, 900, { ...shared, phase_retries: 0 })
  }

  function renameFolderInput() {
    // 只认本款旧名称，不能复用上一款残留输入框或当前搜索框。
    const matches = [...document.querySelectorAll('input')].filter(input =>
      visible(input) && !input.disabled && !input.readOnly
      && !/搜索|search/i.test(`${input.type || ''} ${input.placeholder || ''}`)
      && compact(input.value) === compact(currentJob().folder_name))
    return matches.length === 1 ? matches[0] : null
  }

  function retryRenameSelection(reason) {
    const retries = Number(shared.phase_retries || 0) + 1
    if (retries > 8) {
      const pending = shared.pending_completion || {}
      return appendAndAdvance(currentJob(), '需复核', pending.cloud_count,
        `${compact(pending.note)}；本次源文件已核验完成，但重命名未完成：${reason}；保留原目录“${currentJob().folder_name}”，预期名称“${currentJob().intended_folder_name}”`)
    }
    return nextPhase('select_rename_folder', 600, {
      ...shared, phase_retries: retries, rename_input_waits: 0, rename_last_error: reason,
    })
  }

  function renameFolderClick(folder) {
    const click = center(folder)
    if (!click) return null
    const hit = document.elementFromPoint(click.x, click.y)
    // 有遮挡或不在可视区域时，不把坐标点到其他行/上传浮层。
    return hit && (hit === folder || folder.contains(hit)) ? click : null
  }

  function fillRenameFolderName(name, nextPhaseName) {
    const input = renameFolderInput()
    if (!input) {
      const waits = Number(shared.rename_input_waits || 0) + 1
      if (waits < 4) {
        return nextPhase('fill_rename_folder_name', 500, { ...shared, rename_input_waits: waits })
      }
      return retryRenameSelection('按 F2 后未找到与本款旧名称一致的重命名输入框')
    }
    const dialog = input.closest('[role="dialog"],.el-dialog,.dialog')
    input.focus?.()
    if (typeof input.select === 'function') input.select()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (setter) setter.call(input, name)
    else input.value = name
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    if (!dialog) {
      submitInlineFolderName(input)
      return nextPhase(nextPhaseName, 900, { ...shared, phase_retries: 0 })
    }
    const buttons = [...dialog.querySelectorAll('button,[role="button"]')].filter(visible)
    const confirm = buttons.find(element => /^(确定|保存|重命名)$/.test(textOf(element)))
    const click = center(confirm)
    if (!click) {
      const retries = Number(shared.phase_retries || 0) + 1
      if (retries > 8) {
        const renameJob = currentJob()
        const pending = shared.pending_completion || {}
        return appendAndAdvance(renameJob, '需复核', pending.cloud_count,
          `${compact(pending.note)}；已通过 F2 打开重命名窗口，但没有找到“确定/保存”按钮，未自动改名`)
      }
      return nextPhase('select_rename_folder', 600, { ...shared, phase_retries: retries })
    }
    return cdpClicks([click], nextPhaseName, 900, { ...shared, phase_retries: 0 })
  }

  function appendAndAdvance(job, status, cloudCount, note) {
    const next = {
      ...shared,
      results: [...(shared.results || []), resultRow(job, status, cloudCount, note)],
      job_index: Number(shared.job_index || 0) + 1,
      phase_retries: 0,
      wait_started_at: 0,
      last_upload: null,
      resolved_parent_segments: [],
      pending_parent_segment: '',
      pending_parent_index: -1,
      pending_upload_files: [],
      upload_batches: [],
      upload_batch_index: 0,
      upload_expected_cloud_count: 0,
      current_upload_files: [],
      batch_retry_files: [],
      batch_retry_count: 0,
      batch_retry_ambiguous: false,
      upload_retry_count: 0,
      last_cloud_count: -1,
      last_progress_at: 0,
      resume_existing: false,
      resume_missing_count: 0,
      ambiguous_duplicate_names: [],
      ambiguous_retry_file_count: 0,
      pending_cloud_files: [],
      cloud_copy_response: null,
      pending_completion: null,
      rename_input_waits: 0,
      rename_last_error: '',
      structure_upload_plan: [],
      structure_upload_index: 0,
      current_structure_entry: null,
      last_missing_signature: '',
      stable_snapshot_count: 0,
      local_hash_index: 0,
      local_hash_pending: [],
      same_name_conflicts: [],
    }
    return next.job_index >= (next.jobs || []).length ? complete(next) : nextPhase('screen_style_folder', 200, next)
  }

  function finishVerifiedJob(job, status, cloudCount, note) {
    const notes = [job.existing_folder_note, note].map(compact).filter(Boolean)
    if (job.rename_after_upload && job.folder_name !== job.intended_folder_name) {
      return nextPhase('navigate_rename_parent', 200, {
        ...shared,
        phase_retries: 0,
        pending_completion: { status, cloud_count: cloudCount, note: notes.join('；') },
      })
    }
    const finalStatus = job.force_review_after_success ? '需复核' : status
    return appendAndAdvance(job, finalStatus, cloudCount, notes.join('；'))
  }

  function currentJob() {
    const job = (shared.jobs || [])[Number(shared.job_index || 0)]
    if (!job || !Array.isArray(shared.resolved_parent_segments) || !shared.resolved_parent_segments.length) return job
    const segments = parentSegments(job).map((segment, index) => compact(shared.resolved_parent_segments[index]) || segment)
    const parentPath = segments.join('/')
    const relativePath = slashPath(`${parentPath}/${job.folder_name}`)
    return {
      ...job,
      parent_path: parentPath,
      relative_path: relativePath,
      cloud_target: job.mount_name ? `${job.mount_name}//${relativePath}` : job.cloud_target,
    }
  }

  function retryOrReview(nextPhaseName, message, maxRetries = 12) {
    const retries = Number(shared.phase_retries || 0) + 1
    if (retries > maxRetries) return appendAndAdvance(currentJob(), '需复核', '', message)
    return nextPhase(nextPhaseName, 600, { ...shared, phase_retries: retries })
  }

  if (phase === 'main') {
    if (compact(params.approval_confirmed).toLowerCase() !== 'yes') {
      return fail('未获得上传授权：请先完成人工审核，再选择“审核通过，允许上传”')
    }
    const rows = Array.isArray(params.review_file?.rows) ? params.review_file.rows : []
    if (!rows.length) return fail('审核表没有可读取的数据行')
    const sourceMode = compact(params.source_mode || 'local').toLowerCase()
    const resultDate = runDateText()
    if (!['local', 'cloud'].includes(sourceMode)) return fail(`未知文件来源：${sourceMode}`)
    let built
    let sourceMountId = ''
    if (sourceMode === 'local') {
      const listing = normalizeListing(params.source_root_files)
      if (!listing.paths.length) return fail('源目录没有可读取的 JPG/JPEG/PNG/WEBP/PSD 文件')
      built = buildJobs(rows, indexSourceFiles(listing), 'local', resultDate)
    }
    let mounts
    try {
      mounts = await fetchMounts()
    } catch (error) {
      return fail(`读取森马云盘挂载点失败：${compact(error?.message || error)}`, built?.results || [])
    }
    const mountMap = new Map(mounts.map(item => [compact(item?.org_name || item?.name), item?.mount_id]))
    if (sourceMode === 'cloud') {
      let source
      try {
        source = parseCloudTarget(params.cloud_source_path)
      } catch (error) {
        return fail(`森马云盘源路径无效：${compact(error?.message || error)}`)
      }
      sourceMountId = mountMap.get(source.mountName)
      if (sourceMountId == null || sourceMountId === '') return fail(`未找到云盘源挂载点：${source.mountName}`)
      let sourceFiles
      try {
        sourceFiles = await collectCloudSourceFiles(sourceMountId, source.relativePath)
      } catch (error) {
        return fail(`读取森马云盘源路径失败：${compact(error?.message || error)}`)
      }
      if (!sourceFiles.length) return fail('森马云盘源路径没有可读取的 JPG/JPEG/PNG/WEBP/PSD 文件')
      built = buildJobs(rows, indexCloudSourceFiles(sourceFiles, source.relativePath), 'cloud', resultDate)
    }
    const runnable = []
    for (const job of built.jobs) {
      const mountId = mountMap.get(job.mount_name)
      if (mountId == null || mountId === '') {
        built.results.push(resultRow(job, '需复核', '', `未找到云盘挂载点：${job.mount_name}`))
      } else {
        runnable.push({ ...job, mount_id: mountId, source_mount_id: sourceMode === 'cloud' ? sourceMountId : '' })
      }
    }
    const initialized = {
      audit_rows: rows.length,
      jobs: runnable,
      results: built.results,
      job_index: 0,
      phase_retries: 0,
      wait_started_at: 0,
      upload_wait_seconds: Math.max(30, Math.min(900, Number(params.upload_wait_seconds || 300))),
      source_mode: sourceMode,
      result_date: resultDate,
    }
    return runnable.length ? nextPhase('screen_style_folder', 100, initialized) : complete(initialized)
  }

  const job = currentJob()
  if (!job) return complete(shared)

  if (phase === 'screen_style_folder') {
    if (job.source_kind === 'local' && !job.local_hashes_ready) {
      return nextPhase('prepare_local_hashes', 0, { ...shared, local_hash_index: 0, phase_retries: 0 })
    }
    if (job.mount_name !== STYLE_SEARCH_MOUNT_NAME) {
      return nextPhase('navigate_parent', 100, { ...shared, phase_retries: 0 })
    }
    let candidates
    try {
      candidates = styleFolderCandidates(job, await searchCloudItems(job.mount_id, job.style_code))
    } catch (error) {
      return retryOrReview('screen_style_folder', `在“${STYLE_SEARCH_MOUNT_NAME}”全库筛查款号 ${job.style_code} 失败：${compact(error?.message || error)}`, 6)
    }
    const sameParent = candidates.filter(item => pathEquals(parentPathOf(item.fullpath), job.parent_path))
    const otherParents = candidates.filter(item => !pathEquals(parentPathOf(item.fullpath), job.parent_path))
    if (otherParents.length) {
      const foundPaths = otherParents.map(item => slashPath(item.fullpath)).slice(0, 5)
      return appendAndAdvance(job, '需复核', '',
        `在“${STYLE_SEARCH_MOUNT_NAME}”全库发现同款文件夹位于其他业务路径：${foundPaths.join('；')}；本次推导路径：${job.cloud_target}；未上传、未重命名`)
    }
    const exact = sameParent.filter(item => item.filename === job.folder_name)
    const oldFolders = sameParent.filter(item => item.filename !== job.folder_name)
    if (exact.length > 1) {
      return appendAndAdvance(job, '需复核', '', `同一目标父目录发现 ${exact.length} 个准确最终名称文件夹，未上传`)
    }
    if (exact.length === 1) {
      const note = oldFolders.length
        ? `准确最终名称已存在，同时发现其他同款文件夹：${oldFolders.map(item => item.filename).join('、')}；已把本次文件放入准确最终名称，其他文件夹未处理`
        : '准确最终名称已存在，已复用该文件夹'
      const updatedJob = prepareExistingFolderJob(job, exact[0], {
        fastReuse: true,
        forceReview: oldFolders.length > 0,
        note,
      })
      return nextPhase('navigate_existing_parent', 100, updateCurrentJob(updatedJob, { ...shared, phase_retries: 0 }))
    }
    if (oldFolders.length > 1) {
      return appendAndAdvance(job, '需复核', '',
        `同一目标父目录发现多个旧同款文件夹：${oldFolders.map(item => item.filename).join('、')}；无法唯一确定，未上传、未重命名`)
    }
    if (oldFolders.length === 1) {
      const oldFolder = oldFolders[0]
      const renameTarget = preservedReturnFolderName(oldFolder.filename, job.folder_name, job.style_code)
      if (renameTarget.error) {
        return appendAndAdvance(job, '需复核', '', `${renameTarget.error}；为确保旧名称其他内容不被改动，本次未上传、未重命名`)
      }
      const renameNeeded = renameTarget.folderName !== oldFolder.filename
      const updatedJob = prepareExistingFolderJob(job, oldFolder, {
        renameAfterUpload: renameNeeded,
        fastReuse: true,
        intendedFolderName: renameTarget.folderName,
        note: `发现唯一旧同款文件夹“${oldFolder.filename}”，已复用${renameNeeded ? `并将在本次源文件核验通过后重命名为“${renameTarget.folderName}”` : '，无需重命名'}${renameTarget.note ? `；${renameTarget.note}` : ''}`,
      })
      return nextPhase('navigate_existing_parent', 100, updateCurrentJob(updatedJob, { ...shared, phase_retries: 0 }))
    }
    const direct = await findCloudFolder(job.mount_id, job.parent_path, job.folder_name)
    if (direct.ok && direct.folder) {
      const updatedJob = prepareExistingFolderJob(job, direct.folder, {
        fastReuse: true,
        note: '最终名称文件夹已通过目标父路径接口确认，已复用该文件夹',
      })
      return nextPhase('navigate_existing_parent', 100, updateCurrentJob(updatedJob, { ...shared, phase_retries: 0 }))
    }
    return nextPhase('navigate_parent', 100, { ...shared, phase_retries: 0 })
  }

  if (phase === 'prepare_local_hashes') {
    const index = Number(shared.local_hash_index || 0)
    const files = job.files.slice(index, index + MAX_UPLOAD_BATCH_FILES)
    if (!files.length) {
      const metadata = new Map((job.local_file_meta || []).map(file => [slashPath(file.local_path).toLowerCase(), file]))
      const updated = { ...job, local_hashes_ready: true,
        structured_files: (job.structured_files || []).map(file => ({ ...file, ...metadata.get(slashPath(file.local_path).toLowerCase()) })),
      }
      return nextPhase('screen_style_folder', 0, updateCurrentJob(updated, { ...shared, local_hash_pending: [] }))
    }
    document.getElementById(HASH_INPUT_ID)?.remove()
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.id = HASH_INPUT_ID
    input.hidden = true
    input.addEventListener('input', event => event.stopPropagation())
    input.addEventListener('change', event => event.stopPropagation())
    document.body.appendChild(input)
    return { success: true, data: [], meta: {
      has_more: true, action: 'inject_files', items: [{ selector: `#${HASH_INPUT_ID}`, files }],
      next_phase: 'read_local_hashes', sleep_ms: 0, shared: { ...shared, local_hash_pending: files },
    } }
  }

  if (phase === 'read_local_hashes') {
    const input = document.getElementById(HASH_INPUT_ID)
    try {
      const paths = shared.local_hash_pending || []
      const files = Array.from(input?.files || [])
      if (!paths.length || files.length !== paths.length) throw new Error('本地文件校验输入不完整')
      const metadata = []
      for (let i = 0; i < files.length; i += 1) {
        if (files[i].name !== basename(paths[i]) || !files[i].size) throw new Error(`本地文件读取异常：${basename(paths[i])}`)
        metadata.push({ local_path: paths[i], filename: files[i].name, filesize: files[i].size,
          filehash: await localFileHash(files[i]) })
      }
      const updated = { ...job, local_file_meta: [...(job.local_file_meta || []), ...metadata] }
      return nextPhase('prepare_local_hashes', 0, updateCurrentJob(updated, {
        ...shared, local_hash_index: Number(shared.local_hash_index || 0) + files.length, local_hash_pending: [],
      }))
    } catch (error) {
      return appendAndAdvance(job, '需复核', '', `无法确认本地源文件内容，未上传、未改名：${compact(error?.message || error)}`)
    } finally {
      input?.remove()
    }
  }

  if (phase === 'navigate_existing_parent') {
    if (!job.fast_existing_reuse || !job.reuse_existing_folder) {
      return nextPhase('navigate_parent', 100, { ...shared, phase_retries: 0 })
    }
    const targetHash = buildFolderHashRoute(job.mount_id, job.parent_path)
    if (location.hash !== targetHash) location.hash = targetHash
    return nextPhase('check_parent', 900, { ...shared, phase_retries: 0 })
  }

  if (phase === 'navigate_rename_parent') {
    if (!job.rename_after_upload || !job.intended_folder_name) {
      return appendAndAdvance(job, '需复核', '', '上传核验完成，但缺少待重命名文件夹信息')
    }
    const pending = shared.pending_completion || {}
    const finalFolder = await findCloudFolder(job.mount_id, job.parent_path, job.intended_folder_name)
    if (!finalFolder.ok) {
      const retries = Number(shared.phase_retries || 0) + 1
      if (retries > 8) {
        return appendAndAdvance(job, '需复核', pending.cloud_count,
          `${compact(pending.note)}；本次源文件已核验完成，但改名前无法确认最终名称是否已存在：${finalFolder.error || '未知错误'}；未执行改名`)
      }
      return nextPhase('navigate_rename_parent', 600, { ...shared, phase_retries: retries })
    }
    if (finalFolder.folder) {
      return appendAndAdvance(job, '需复核', pending.cloud_count,
        `${compact(pending.note)}；准备重命名时发现最终名称文件夹“${job.intended_folder_name}”已经存在，为避免目录冲突，未执行改名`)
    }
    const targetHash = buildFolderHashRoute(job.mount_id, job.parent_path)
    if (location.hash !== targetHash) location.hash = targetHash
    return nextPhase('select_rename_folder', 1200, {
      ...shared, phase_retries: 0, rename_input_waits: 0, rename_last_error: '',
    })
  }

  if (['select_rename_folder', 'click_rename_folder', 'press_rename_f2', 'fill_rename_folder_name'].includes(phase)
    && location.hash !== buildFolderHashRoute(job.mount_id, job.parent_path)) {
    return retryRenameSelection('重命名时页面不在预期父目录')
  }

  if (phase === 'select_rename_folder') {
    if (renameFolderInput()) return nextPhase('fill_rename_folder_name', 0, shared)
    const folder = folderEntryElement(job.folder_name)
    const click = center(folder)
    if (!click) {
      const scrolled = scrollFolderList()
      if (!scrolled && Number(shared.phase_retries || 0) >= 8) {
        const pending = shared.pending_completion || {}
        return appendAndAdvance(job, '需复核', pending.cloud_count,
          `${compact(pending.note)}；本次源文件已核验完成，但页面没有找到旧文件夹“${job.folder_name}”，未能重命名为“${job.intended_folder_name}”`)
      }
      return retryOrReview('select_rename_folder', `正在查找待重命名文件夹“${job.folder_name}”`, 40)
    }
    folder.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    return nextPhase('click_rename_folder', 250, shared)
  }

  if (phase === 'click_rename_folder') {
    const folder = folderEntryElement(job.folder_name)
    const click = renameFolderClick(folder)
    if (!click) return retryRenameSelection('旧目录不在可点击位置或被其他窗口遮挡')
    return cdpClicks([click], 'press_rename_f2', 600, shared)
  }

  if (phase === 'press_rename_f2') {
    if (renameFolderInput()) return nextPhase('fill_rename_folder_name', 0, shared)
    const target = folderEntryElement(job.folder_name)
    if (!renameFolderClick(target)) return retryRenameSelection('点击后旧目录位置已变化或被遮挡')
    const selected = target.closest('[aria-selected="true"],[data-selected="true"],.selected,.is-selected,.current-row,.active')
    if (!selected || selected === document.body || selected === document.documentElement) {
      return retryRenameSelection('无法确认旧目录已选中，未发送 F2')
    }
    // 前一款提交后焦点可能留在旧输入框；从当前目录派发，确保事件进入当前页面。
    document.activeElement?.blur?.()
    const previousTabIndex = target.getAttribute('tabindex')
    target.setAttribute('tabindex', '-1')
    target.focus({ preventScroll: true })
    if (document.activeElement !== target) {
      if (previousTabIndex === null) target.removeAttribute('tabindex')
      else target.setAttribute('tabindex', previousTabIndex)
      return retryRenameSelection('无法把键盘焦点移到旧目录，未发送 F2')
    }
    const eventInit = {
      key: 'F2', code: 'F2', keyCode: 113, which: 113,
      bubbles: true, cancelable: true,
    }
    target.dispatchEvent(new KeyboardEvent('keydown', eventInit))
    target.dispatchEvent(new KeyboardEvent('keyup', eventInit))
    if (previousTabIndex === null) target.removeAttribute('tabindex')
    else target.setAttribute('tabindex', previousTabIndex)
    return nextPhase('fill_rename_folder_name', 500, { ...shared, rename_input_waits: 0 })
  }

  if (phase === 'fill_rename_folder_name') {
    return fillRenameFolderName(job.intended_folder_name, 'verify_renamed_folder')
  }

  if (phase === 'verify_renamed_folder') {
    const finalFolder = await findCloudFolder(job.mount_id, job.parent_path, job.intended_folder_name)
    const oldFolder = await findCloudFolder(job.mount_id, job.parent_path, job.folder_name)
    if (finalFolder.ok && finalFolder.folder && oldFolder.ok && !oldFolder.folder) {
      const pending = shared.pending_completion || {}
      const outputJob = {
        ...job,
        folder_name: job.intended_folder_name,
        relative_path: job.intended_relative_path,
        cloud_target: job.requested_cloud_target,
        rename_after_upload: false,
      }
      return appendAndAdvance(outputJob, pending.status || '上传成功', pending.cloud_count,
        `${compact(pending.note)}；旧文件夹已核验后重命名：${job.existing_folder_name} → ${job.intended_folder_name}`)
    }
    if ((!finalFolder.ok || !oldFolder.ok) && Number(shared.phase_retries || 0) >= 8) {
      const pending = shared.pending_completion || {}
      return appendAndAdvance(job, '需复核', pending.cloud_count,
        `${compact(pending.note)}；本次源文件已核验完成，但重命名结果无法确认：${finalFolder.error || oldFolder.error || '未知错误'}`)
    }
    if (Number(shared.phase_retries || 0) >= 12) {
      const pending = shared.pending_completion || {}
      return appendAndAdvance(job, '需复核', pending.cloud_count,
        `${compact(pending.note)}；本次源文件已核验完成，但旧名称仍存在或新名称尚未出现，请人工确认重命名结果`)
    }
    return nextPhase('verify_renamed_folder', 1200, {
      ...shared,
      phase_retries: Number(shared.phase_retries || 0) + 1,
    })
  }

  if (phase === 'navigate_parent') {
    const targetHash = buildFolderHashRoute(job.mount_id, '')
    if (location.hash !== targetHash) location.hash = targetHash
    return nextPhase('open_parent_segment', 1200, {
      ...shared, phase_retries: 0, nav_path_index: 0, nav_scroll_index: -1,
      resolved_parent_segments: [], pending_parent_segment: '', pending_parent_index: -1,
    })
  }

  if (phase === 'open_parent_segment') {
    const segments = parentSegments(job)
    const index = Number(shared.nav_path_index || 0)
    if (index >= segments.length) {
      const last = segments[segments.length - 1] || ''
      if (last && !breadcrumbContains(last)) {
        return appendAndAdvance(job, '需复核', '', `尚未确认进入云盘目标父目录“${job.parent_path}”，已禁止新建文件夹`)
      }
      return nextPhase('check_parent', 200, { ...shared, phase_retries: 0 })
    }
    const segment = segments[index]
    if (Number(shared.nav_scroll_index ?? -1) !== index) {
      resetFolderListScroll()
      return nextPhase('open_parent_segment', 250, {
        ...shared, nav_scroll_index: index, phase_retries: 0,
      })
    }
    if (breadcrumbContains(segment)) {
      return nextPhase('open_parent_segment', 100, {
        ...shared, nav_path_index: index + 1, nav_scroll_index: -1, phase_retries: 0,
      })
    }
    const openedName = openFolderByName(segment)
    if (!openedName) {
      const scrolled = scrollFolderList()
      if (!scrolled && Number(shared.phase_retries || 0) >= 3) {
        const autoCreateFromIndex = Math.max(0, segments.length - 2)
        if (index < autoCreateFromIndex) {
          return appendAndAdvance(job, '需复核', '', `已滚动到底，当前云盘目录仍没有找到上级文件夹“${segment}”；为避免路径拼写错误，未自动新建`)
        }
        const createButton = textElement('新建', true) || textElement('新建')
        const click = center(createButton)
        if (!click) return retryOrReview('open_parent_segment', `当前目录缺少“${segment}”，且页面没有找到“新建”按钮`, 8)
        return cdpClicks([click], 'choose_create_parent_segment', 500, {
          ...shared, phase_retries: 0, pending_parent_segment: segment, pending_parent_index: index,
        })
      }
      return retryOrReview('open_parent_segment', `正在滚动查找下一级文件夹“${segment}”`, 40)
    }
    const resolved = [...(shared.resolved_parent_segments || [])]
    resolved[index] = openedName
    return nextPhase('verify_parent_segment', 900, {
      ...shared, resolved_parent_segments: resolved, phase_retries: 0,
    })
  }

  if (phase === 'choose_create_parent_segment') {
    const menuItem = textElement('文件夹', true) || textElement('新建文件夹', true)
    const click = center(menuItem)
    if (!click) return retryOrReview('choose_create_parent_segment', '“新建”菜单没有出现“文件夹”')
    return cdpClicks([click], 'fill_parent_segment_name', 500, { ...shared, phase_retries: 0 })
  }

  if (phase === 'fill_parent_segment_name') {
    return fillNewFolderName(shared.pending_parent_segment, 'fill_parent_segment_name', 'open_created_parent_segment')
  }

  if (phase === 'open_created_parent_segment') {
    const index = Number(shared.pending_parent_index)
    const segment = compact(shared.pending_parent_segment)
    if (!segment || index < 0) return appendAndAdvance(job, '需复核', '', '新建中间目录时丢失了目录名称')
    if (Number(shared.nav_scroll_index ?? -1) !== index) {
      resetFolderListScroll()
      return nextPhase('open_created_parent_segment', 250, {
        ...shared, nav_scroll_index: index, phase_retries: 0,
      })
    }
    const openedName = openFolderByName(segment)
    if (!openedName) {
      const scrolled = scrollFolderList()
      if (!scrolled && Number(shared.phase_retries || 0) >= 8) {
        return appendAndAdvance(job, '需复核', '', `已新建中间文件夹“${segment}”，但页面没有找到该文件夹`)
      }
      return retryOrReview('open_created_parent_segment', `正在查找新建的中间文件夹“${segment}”`, 40)
    }
    const resolved = [...(shared.resolved_parent_segments || [])]
    resolved[index] = openedName
    return nextPhase('verify_parent_segment', 900, {
      ...shared, resolved_parent_segments: resolved, phase_retries: 0,
    })
  }

  if (phase === 'verify_parent_segment') {
    const segments = parentSegments(job)
    const index = Number(shared.nav_path_index || 0)
    const segment = segments[index] || ''
    if (segment && breadcrumbContains(segment)) {
      return nextPhase('open_parent_segment', 100, {
        ...shared, nav_path_index: index + 1, nav_scroll_index: -1, phase_retries: 0,
      })
    }
    return retryOrReview('open_parent_segment', `双击后未进入云盘文件夹“${segment}”`, 8)
  }

  if (phase === 'check_parent') {
    const segments = parentSegments(job)
    const last = segments[segments.length - 1] || ''
    if (last && !breadcrumbContains(last)) {
      return appendAndAdvance(job, '需复核', '', `尚未确认进入云盘目标父目录“${job.parent_path}”，已禁止新建文件夹`)
    }
    const checked = await findCloudFolder(job.mount_id, job.parent_path, job.folder_name)
    if (!checked.ok) return retryOrReview('check_parent', `无法读取云盘父目录：${checked.error}`, 6)
    if (checked.folder) {
      if (job.source_kind === 'cloud') {
        return nextPhase('copy_cloud_files', 100, { ...shared, phase_retries: 0 })
      }
      if (hasLocalSubfolders(job)) {
        const structured = await inspectCloudCopy(job)
        if (!structured.ok) return appendAndAdvance(job, '需复核', '', `云盘已存在同名目标文件夹，但无法校验子目录结构：${structured.error}`)
        const unexpected = structured.unexpected_files.length + (structured.unexpected_directories || []).length
        if (!structured.missing_files.length && !(structured.missing_directories || []).length && (!unexpected || job.allow_existing_extras)) {
          return finishVerifiedJob(job, '跳过', structured.count, '云盘已存在目标文件夹且本次源文件的相对目录结构完整；未重复上传')
        }
        if (unexpected && !job.allow_existing_extras) {
          return appendAndAdvance(job, '需复核', structured.count, '云盘已存在同名目标文件夹且包含额外内容；为避免混入文件，未自动补传')
        }
        if (structured.has_partial_existing_structure) {
          return appendAndAdvance(job, '需复核', structured.count, '云盘已有同名子文件夹但内部结构不完整；为避免覆盖、拆散目录，未自动补传')
        }
        const uploadPlan = buildStructuredUploadPlan(job, structured)
        if (!uploadPlan.length) return appendAndAdvance(job, '需复核', structured.count, '目标目录结构不完整，但无法生成安全的补传计划')
        if (!openFolderByName(job.folder_name)) {
          return retryOrReview('check_parent', `页面没有找到待补传的目标文件夹“${job.folder_name}”`, 8)
        }
        return nextPhase('verify_target_folder', 900, {
          ...shared,
          phase_retries: 0,
          resume_existing: true,
          structure_upload_plan: uploadPlan,
          structure_upload_index: 0,
        })
      }
      const inspected = await inspectCloudFiles(job)
      if (!inspected.ok) {
        return appendAndAdvance(job, '需复核', '', `云盘已存在同名目标文件夹；无法可靠识别缺少文件，未追加：${inspected.error}`)
      }
      if (!inspected.missing_files.length) {
        return finishVerifiedJob(job, '跳过', inspected.count, '云盘已存在目标文件夹且本次源图片完整；未重复上传')
      }
      return nextPhase('observe_existing_incomplete', 1500, {
        ...shared,
        phase_retries: 0,
        resume_existing: true,
        last_cloud_count: inspected.count,
        last_missing_signature: missingFileSignature(inspected),
        stable_snapshot_count: 1,
        last_progress_at: Date.now(),
      })
    }
    const createButton = textElement('新建', true) || textElement('新建')
    const click = center(createButton)
    if (!click) return retryOrReview('check_parent', '云盘页面没有找到“新建”按钮')
    return cdpClicks([click], 'choose_create_folder', 500, { ...shared, phase_retries: 0 })
  }

  if (phase === 'observe_existing_incomplete') {
    const inspected = await inspectCloudFiles(job)
    if (!inspected.ok) {
      return retryOrReview('observe_existing_incomplete', `观察已有目录时无法读取云盘文件：${inspected.error}`, 10)
    }
    if (!inspected.missing_files.length) {
      return finishVerifiedJob(job, '跳过', inspected.count, '云盘已有目录在观察期间自动补齐；未执行补传')
    }
    const now = Date.now()
    const previousCount = Number(shared.last_cloud_count ?? inspected.count)
      const signature = missingFileSignature(inspected)
      const previousSignature = compact(shared.last_missing_signature)
      const hasPreviousSignature = Object.prototype.hasOwnProperty.call(shared, 'last_missing_signature')
      if (inspected.count !== previousCount || (hasPreviousSignature && signature !== previousSignature)) {
        return nextPhase('observe_existing_incomplete', 1500, {
          ...shared,
          phase_retries: 0,
          last_cloud_count: inspected.count,
          last_missing_signature: signature,
          stable_snapshot_count: 1,
          last_progress_at: now,
        })
      }
    const stableSince = Number(shared.last_progress_at || now)
    const stableSnapshots = Number(shared.stable_snapshot_count || 1) + 1
    const stableWaitMs = job.fast_existing_reuse ? 5000 : 60000
    const minimumSnapshots = job.fast_existing_reuse ? 3 : 1
    if (now - stableSince < stableWaitMs || stableSnapshots < minimumSnapshots) {
      return nextPhase('observe_existing_incomplete', 1500, {
        ...shared,
        phase_retries: 0,
        last_cloud_count: inspected.count,
        last_missing_signature: signature,
        stable_snapshot_count: stableSnapshots,
        last_progress_at: stableSince,
      })
    }
    const openedName = openFolderByName(job.folder_name)
    if (!openedName) {
      const stableNote = job.fast_existing_reuse ? '连续核验至少 3 次且稳定约 5 秒' : '稳定 1 分钟'
      return retryOrReview('observe_existing_incomplete', `已有目录${stableNote}后仍缺少 ${inspected.missing_files.length} 张图片，但页面没有找到该文件夹`, 8)
    }
    return nextPhase('verify_target_folder', 900, {
      ...shared,
      phase_retries: 0,
      pending_upload_files: inspected.missing_files,
      resume_existing: true,
      resume_missing_count: inspected.missing_files.length,
      ambiguous_duplicate_names: inspected.ambiguous_names,
      same_name_conflicts: inspected.same_name_conflicts || [],
      wait_started_at: now,
      last_cloud_count: inspected.count,
      last_progress_at: now,
    })
  }

  if (phase === 'choose_create_folder') {
    const menuItem = textElement('文件夹', true) || textElement('新建文件夹', true)
    const click = center(menuItem)
    if (!click) return retryOrReview('choose_create_folder', '“新建”菜单没有出现“文件夹”')
    return cdpClicks([click], 'fill_folder_name', 500, { ...shared, phase_retries: 0 })
  }

  if (phase === 'fill_folder_name') {
    return fillNewFolderName(job.folder_name, 'fill_folder_name', 'verify_created_folder')
  }

  if (phase === 'verify_created_folder') {
    const checked = await findCloudFolder(job.mount_id, job.parent_path, job.folder_name)
    if (!checked.ok || !checked.folder) {
      return retryOrReview('verify_created_folder', checked.error || '创建后未在父目录发现目标文件夹', 10)
    }
    return nextPhase('open_created_folder', 200, { ...shared, phase_retries: 0 })
  }

  if (phase === 'open_created_folder') {
    if (!openFolderByName(job.folder_name)) {
      return retryOrReview('open_created_folder', `创建后页面没有找到目标文件夹“${job.folder_name}”`, 8)
    }
    return nextPhase('verify_target_folder', 900, { ...shared, phase_retries: 0 })
  }

  if (phase === 'verify_target_folder') {
    if (!breadcrumbContains(job.folder_name)) {
      return retryOrReview(shared.resume_existing ? 'open_existing_folder' : 'open_created_folder', `双击后未进入目标文件夹“${job.folder_name}”`, 8)
    }
    if (job.source_kind === 'cloud') {
      return nextPhase('copy_cloud_files', 100, { ...shared, phase_retries: 0 })
    }
    if (hasLocalSubfolders(job)) {
      const existingPlan = Array.isArray(shared.structure_upload_plan) && shared.structure_upload_plan.length
        ? shared.structure_upload_plan
        : null
      const uploadPlan = existingPlan || buildStructuredUploadPlan(job)
      if (!uploadPlan.length) return appendAndAdvance(job, '需复核', '', '没有可提交到云盘的本地文件或文件夹')
      return nextPhase('open_structure_upload_menu', 200, {
        ...shared,
        phase_retries: 0,
        structure_upload_plan: uploadPlan,
        structure_upload_index: existingPlan ? Number(shared.structure_upload_index || 0) : 0,
        wait_started_at: 0,
      })
    }
    const existingBatches = Array.isArray(shared.upload_batches) ? shared.upload_batches : []
    if (existingBatches.length) return nextPhase('open_upload_menu', 200, { ...shared, phase_retries: 0 })
    let uploadFiles = Array.isArray(shared.pending_upload_files) && shared.pending_upload_files.length
      ? shared.pending_upload_files
      : job.files
    const inspected = await inspectCloudFiles(job)
    if (!inspected.ok) return retryOrReview('verify_target_folder', `上传前无法读取云盘目录：${inspected.error}`, 8)
    if (shared.resume_existing) {
      uploadFiles = inspected.missing_files
      if (!uploadFiles.length) {
        return finishVerifiedJob(job, '跳过', inspected.count, '上传前二次核对发现本次源图片已全部存在；未重复上传')
      }
    }
    const batches = buildUploadBatches(uploadFiles)
    if (!batches.length) return appendAndAdvance(job, '需复核', '', '没有可提交到云盘的图片')
    return nextPhase('open_upload_menu', 200, {
      ...shared,
      phase_retries: 0,
      pending_upload_files: [],
      upload_batches: batches,
      upload_batch_index: 0,
      upload_expected_cloud_count: inspected.count + batches[0].length,
      current_upload_files: [],
      batch_retry_files: [],
      batch_retry_count: 0,
      batch_retry_ambiguous: false,
      ambiguous_duplicate_names: inspected.ambiguous_names,
      same_name_conflicts: inspected.same_name_conflicts || [],
      resume_missing_count: shared.resume_existing ? uploadFiles.length : 0,
      last_cloud_count: inspected.count,
      last_progress_at: Date.now(),
      wait_started_at: 0,
    })
  }

  if (phase === 'open_existing_folder') {
    if (!openFolderByName(job.folder_name)) {
      return retryOrReview('open_existing_folder', `页面没有找到待补传的目标文件夹“${job.folder_name}”`, 8)
    }
    return nextPhase('verify_target_folder', 900, { ...shared, phase_retries: 0 })
  }

  if (phase === 'copy_cloud_files') {
    const inspected = await inspectCloudCopy(job)
    if (!inspected.ok) return retryOrReview('copy_cloud_files', `复制前无法读取云盘目标目录：${inspected.error}`, 8)
    const unexpectedItems = [...inspected.unexpected_files, ...(inspected.unexpected_directories || [])]
    if (unexpectedItems.length && !job.allow_existing_extras) {
      const names = unique(unexpectedItems.map(item => item.filename)).slice(0, 8)
      return appendAndAdvance(job, '需复核', inspected.count,
        `目标目录存在 ${unexpectedItems.length} 个不属于本次审核源文件结构的文件或文件夹（${names.join('、')}），为避免覆盖或混入文件，未执行复制`)
    }
    if (!inspected.missing_files.length && !(inspected.missing_directories || []).length) {
      return finishVerifiedJob(job, '跳过', inspected.count, '目标目录已包含完整源文件夹结构，已按相对路径及 filehash/文件大小校验；未重复复制')
    }
    if (inspected.has_partial_existing_structure) {
      return appendAndAdvance(job, '需复核', inspected.count, '目标目录已有同名子文件夹但内部结构不完整；为避免覆盖或拆散目录，未自动追加复制')
    }
    try {
      const response = await copyCloudFiles(job, inspected.missing_copy_entries)
      return nextPhase('verify_cloud_copy', 1200, {
        ...shared,
        phase_retries: 0,
        pending_cloud_files: inspected.missing_copy_entries,
        cloud_copy_response: response || null,
        wait_started_at: Date.now(),
        last_cloud_count: inspected.count,
      })
    } catch (error) {
      return appendAndAdvance(job, '需复核', inspected.count, `森马云盘服务器端复制失败：${compact(error?.message || error)}`)
    }
  }

  if (phase === 'verify_cloud_copy') {
    const inspected = await inspectCloudCopy(job)
    if (inspected.ok && !inspected.missing_files.length && !(inspected.missing_directories || []).length) {
      return finishVerifiedJob(job, '复制成功', inspected.count,
        `已在森马云盘服务器端复制并按原相对路径保留完整文件夹结构；目标文件按相对路径及 filehash/文件大小校验通过，源文件未下载到本地`)
    }
    const startedAt = Number(shared.wait_started_at || Date.now())
    const now = Date.now()
    if (now - startedAt > Number(shared.upload_wait_seconds || 300) * 1000) {
      return appendAndAdvance(job, '需复核', inspected.ok ? inspected.count : '', inspected.ok
        ? `等待服务器端复制超时：仍有 ${inspected.missing_files.length} 个源文件和 ${(inspected.missing_directories || []).length} 个子文件夹未按原相对路径通过校验；不会自动重复提交复制`
        : `等待服务器端复制超时且无法读取目标目录：${inspected.error}`)
    }
    return nextPhase('verify_cloud_copy', 1500, {
      ...shared,
      wait_started_at: startedAt,
      last_cloud_count: inspected.ok ? inspected.count : Number(shared.last_cloud_count || 0),
    })
  }

  if (phase === 'open_structure_upload_menu') {
    const uploadButton = uploadButtonElement()
    const click = center(uploadButton)
    if (!click) return retryOrReview('open_structure_upload_menu', '目标文件夹页面没有找到“上传”按钮')
    return cdpClicks([click], 'choose_structure_upload', 700, shared)
  }

  if (phase === 'choose_structure_upload') {
    const plan = Array.isArray(shared.structure_upload_plan) ? shared.structure_upload_plan : []
    const index = Number(shared.structure_upload_index || 0)
    const entry = plan[index]
    if (!entry) return nextPhase('verify_local_structure_upload', 1200, { ...shared, wait_started_at: Date.now(), phase_retries: 0 })
    const label = entry.kind === 'folder' ? '上传文件夹' : '上传文件'
    const menuItem = textElement(label, true)
    const click = center(menuItem)
    if (!click) {
      dismissTransientMenu()
      return retryOrReview('open_structure_upload_menu', `上传菜单没有出现“${label}”`)
    }
    const paths = entry.kind === 'folder' ? [entry.folder_path] : entry.files
    return fileChooserUpload(click, paths, job, {
      ...shared,
      phase_retries: 0,
      current_structure_entry: entry,
    }, 'after_structure_selection')
  }

  if (phase === 'after_structure_selection') {
    const uploadPayload = shared.last_upload
    const uploadItems = Array.isArray(uploadPayload) ? uploadPayload : (Array.isArray(uploadPayload?.items) ? uploadPayload.items : [])
    const failed = uploadItems.find(item => item && item.success === false)
    if (failed) return appendAndAdvance(job, '需复核', '', `保留目录结构上传失败：${compact(failed.error || '未捕获到原生文件选择器')}`)
    const plan = Array.isArray(shared.structure_upload_plan) ? shared.structure_upload_plan : []
    const nextIndex = Number(shared.structure_upload_index || 0) + 1
    if (nextIndex < plan.length) {
      return nextPhase('open_structure_upload_menu', 800, {
        ...shared, structure_upload_index: nextIndex, current_structure_entry: null, phase_retries: 0,
      })
    }
    return nextPhase('verify_local_structure_upload', 1200, {
      ...shared, structure_upload_index: nextIndex, current_structure_entry: null,
      wait_started_at: Date.now(), phase_retries: 0,
    })
  }

  if (phase === 'verify_local_structure_upload') {
    const inspected = await inspectCloudCopy(job)
    const unexpected = inspected.ok ? inspected.unexpected_files.length + (inspected.unexpected_directories || []).length : 0
    if (inspected.ok && !inspected.missing_files.length && !(inspected.missing_directories || []).length && (!unexpected || job.allow_existing_extras)) {
      return finishVerifiedJob(job, '上传成功', inspected.count, '本地款式文件夹已按原相对路径完整上传，子文件夹结构校验通过')
    }
    const startedAt = Number(shared.wait_started_at || Date.now())
    if (Date.now() - startedAt > Number(shared.upload_wait_seconds || 300) * 1000) {
      return appendAndAdvance(job, '需复核', inspected.ok ? inspected.count : '', inspected.ok
        ? `等待结构化上传超时：仍缺少 ${inspected.missing_files.length} 个文件、${(inspected.missing_directories || []).length} 个子文件夹，额外内容 ${unexpected} 项`
        : `等待结构化上传超时且无法读取目标目录：${inspected.error}`)
    }
    return nextPhase('verify_local_structure_upload', 1500, { ...shared, wait_started_at: startedAt })
  }

  if (phase === 'open_upload_menu') {
    const uploadButton = uploadButtonElement()
    const click = center(uploadButton)
    if (!click) return retryOrReview('open_upload_menu', '目标文件夹页面没有找到“上传”按钮')
    return cdpClicks([click], 'choose_upload_files', 900, shared)
  }

  if (phase === 'choose_upload_files') {
    const menuItem = textElement('上传文件', true)
    const click = center(menuItem)
    if (!click) {
      dismissTransientMenu()
      return retryOrReview('open_upload_menu', '上传菜单没有出现“上传文件”')
    }
    const batches = Array.isArray(shared.upload_batches) ? shared.upload_batches : []
    const batchIndex = Number(shared.upload_batch_index || 0)
    const retryFiles = Array.isArray(shared.batch_retry_files) ? shared.batch_retry_files : []
    const pendingFiles = retryFiles.length
      ? retryFiles
      : (batches[batchIndex] || (Array.isArray(shared.pending_upload_files) && shared.pending_upload_files.length
        ? shared.pending_upload_files
        : job.files))
    return fileChooserUpload(click, pendingFiles, job, {
      ...shared,
      phase_retries: 0,
      current_upload_files: pendingFiles,
      batch_retry_files: [],
      wait_started_at: Date.now(),
    })
  }

  if (phase === 'after_file_selection') {
    const uploadPayload = shared.last_upload
    const uploadItems = Array.isArray(uploadPayload) ? uploadPayload : (Array.isArray(uploadPayload?.items) ? uploadPayload.items : [])
    const failed = uploadItems.find(item => item && item.success === false)
    if (!uploadPayload || uploadPayload?.ok === false || failed) {
      return appendAndAdvance(job, '需复核', '', `本地文件选择失败：${compact(failed?.error || '未收到成功结果')}`)
    }
    return nextPhase('handle_conflict_or_verify', 1200, {
      ...shared,
      phase_retries: 0,
      pending_upload_files: [],
      last_progress_at: Date.now(),
    })
  }

  if (phase === 'handle_conflict_or_verify') {
    const dialog = dialogElement()
    const dialogText = textOf(dialog)
    if (dialog && /保留两者|文件已存在|同名/.test(dialogText)) {
      const candidates = [...dialog.querySelectorAll('button,[role="button"],label,.el-checkbox')].filter(visible)
      const applyAll = candidates.find(element => /全部应用|应用到全部/.test(textOf(element)))
      const keepBoth = candidates.find(element => /保留两者/.test(textOf(element)))
      const clicks = [center(applyAll), center(keepBoth)].filter(Boolean)
      if (!center(keepBoth)) return retryOrReview('handle_conflict_or_verify', '检测到重名冲突，但没有找到“保留两者”按钮', 6)
      return cdpClicks(clicks, 'handle_conflict_or_verify', 900, shared)
    }

    const counted = await inspectCloudFiles(job)
    const cloudFileCount = counted.ok ? counted.count : 0
    const batches = Array.isArray(shared.upload_batches) ? shared.upload_batches : []
    const batchIndex = Number(shared.upload_batch_index || 0)
    const now = Date.now()
    const missingPaths = new Set((counted.missing_files || []).map(filePath => slashPath(filePath).toLowerCase()))
    const currentBatch = (shared.current_upload_files || []).length ? shared.current_upload_files : (batches[batchIndex] || job.files)
    const batchComplete = counted.ok && currentBatch.every(filePath => !missingPaths.has(slashPath(filePath).toLowerCase()))
    const finalBatch = batchIndex + 1 >= batches.length
    if (batchComplete && (!finalBatch || !counted.missing_files.length)) {
      if (shared.batch_retry_ambiguous) {
        const previousCount = Number(shared.last_cloud_count ?? -1)
        const stableSince = cloudFileCount !== previousCount ? now : Number(shared.last_progress_at || now)
        if (cloudFileCount !== previousCount || now - stableSince < 60000) {
          return nextPhase('handle_conflict_or_verify', 1500, {
            ...shared,
            last_cloud_count: cloudFileCount,
            last_progress_at: stableSince,
          })
        }
      }
      const nextBatchIndex = batchIndex + 1
      if (nextBatchIndex < batches.length) {
        const nextBatch = batches[nextBatchIndex]
        return nextPhase('open_upload_menu', 1000, {
          ...shared,
          phase_retries: 0,
          upload_batch_index: nextBatchIndex,
          upload_expected_cloud_count: cloudFileCount + nextBatch.length,
          current_upload_files: [],
          batch_retry_files: [],
          batch_retry_count: 0,
          batch_retry_ambiguous: false,
          wait_started_at: 0,
          last_cloud_count: cloudFileCount,
          last_progress_at: now,
        })
      }
      const ambiguousNames = Array.isArray(shared.ambiguous_duplicate_names)
        ? shared.ambiguous_duplicate_names.filter(Boolean)
        : []
      if (ambiguousNames.length) {
        const ambiguousKeys = new Set(ambiguousNames.map(name => compact(name).toLocaleLowerCase()))
        const uploadedSameNameCount = Number(shared.ambiguous_retry_file_count || 0)
          || job.files.filter(filePath => ambiguousKeys.has(basename(filePath).toLocaleLowerCase())).length
        return appendAndAdvance(job, '需复核', cloudFileCount,
          `出现缺图补传；不同款色文件夹存在同名图片“${ambiguousNames.join('、')}”，无法判断缺少哪一张，已将 ${uploadedSameNameCount} 张同名图片全部补传，请人工核对云盘文件`)
      }
      const sourceNote = job.color_codes.length
        ? `${job.color_codes.length} 个款色合并到同一款号文件夹`
        : '按12位款号文件夹上传'
      const repairNote = shared.resume_existing
        ? `；已有目录${job.fast_existing_reuse ? '连续核验至少 3 次且稳定约 5 秒' : '稳定 1 分钟'}后补传 ${Number(shared.resume_missing_count || 0)} 张图片`
        : ''
      const batchNote = batches.length > 1 ? `；已拆分为 ${batches.length} 批上传（每批最多 ${MAX_UPLOAD_BATCH_FILES} 张且批内无同名文件）` : ''
      const conflictNote = (shared.same_name_conflicts || []).length ? `；同名旧图未当作本次源图，已保留两者并逐张核验：${shared.same_name_conflicts.join('、')}` : ''
      return finishVerifiedJob(job, '上传成功', cloudFileCount, `本次全部源图片已按完整内容指纹及文件大小逐张核验通过；${sourceNote}${repairNote}${batchNote}${conflictNote}`)
    }
    const startedAt = Number(shared.wait_started_at || Date.now())
    const previousCount = Number(shared.last_cloud_count ?? -1)
    if (now - startedAt > Number(shared.upload_wait_seconds || 300) * 1000) {
      if (counted.ok && batches.length && Number(shared.batch_retry_count || 0) < 1) {
        const currentBatch = Array.isArray(shared.current_upload_files) && shared.current_upload_files.length
          ? shared.current_upload_files
          : (batches[batchIndex] || [])
        const retryFiles = unique(currentBatch.filter(filePath => missingPaths.has(slashPath(filePath).toLowerCase())))
        if (retryFiles.length) {
          return nextPhase('open_upload_menu', 1000, {
            ...shared,
            phase_retries: 0,
            batch_retry_files: retryFiles,
            batch_retry_count: 1,
            batch_retry_ambiguous: false,
            wait_started_at: 0,
            last_cloud_count: cloudFileCount,
            last_progress_at: now,
          })
        }
      }
      const waitNote = shared.resume_existing
        ? `；已有目录${job.fast_existing_reuse ? '连续核验至少 3 次且稳定约 5 秒' : '稳定 1 分钟'}后已执行一次补传，本次不再重复补传`
        : (Number(shared.batch_retry_count || 0) > 0
          ? '；已自动补传 1 次，本次不再重复补传'
          : '；没有可安全识别的缺图，未执行自动补传')
      return appendAndAdvance(job, '需复核', counted.ok ? cloudFileCount : '', counted.ok
          ? `等待上传超时：本次仍有 ${counted.missing_files.length} 张源图片未通过内容校验（${counted.missing_files.map(basename).join('、')}）；云盘总数 ${cloudFileCount} 不代表源图片完整${waitNote}`
        : `等待上传超时且无法读取云盘目录：${counted.error}`)
    }
    return nextPhase('handle_conflict_or_verify', 1500, {
      ...shared,
      wait_started_at: startedAt,
      last_cloud_count: counted.ok ? cloudFileCount : previousCount,
      last_progress_at: counted.ok && cloudFileCount !== previousCount ? now : Number(shared.last_progress_at || startedAt),
    })
  }

  return fail(`未知运行阶段：${phase}`, shared.results || [])
})()
