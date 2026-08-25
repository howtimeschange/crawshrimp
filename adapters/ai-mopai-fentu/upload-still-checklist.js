(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const IMAGE_EXTENSIONS = /\.(?:jpe?g|png|webp|psd)$/i
  const CLOUD_FILE_EXTENSIONS = /\.(?:jpe?g|png|webp|psd)$/i
  const LIST_PAGE_SIZE = 500
  const SEARCH_SCOPE = '["filename", "tag"]'
  const MAX_UPLOAD_BATCH_FILES = 4
  const PHOTOGRAPHY_MOUNT_NAME = '摄影'

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

  function duplicateFileNames(files) {
    const counts = new Map()
    const displayNames = new Map()
    for (const filePath of files || []) {
      const key = fileNameKey(filePath)
      counts.set(key, Number(counts.get(key) || 0) + 1)
      if (!displayNames.has(key)) displayNames.set(key, basename(filePath))
    }
    return [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => displayNames.get(key))
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

  function fileChooserUpload(click, files, job, newShared = shared) {
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
        next_phase: 'after_file_selection',
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
      if (match) return { code: match[1], code_type: 'color', folder_name: parts[index] }
    }
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const match = parts[index].match(/(?<!\d)(\d{12})(?!\d)/)
      if (match) return { code: match[1], code_type: 'style', folder_name: parts[index] }
    }
    return null
  }

  function indexSourceFiles(listing) {
    const byCode = {}
    for (const filePath of listing.paths) {
      const folder = codedFolderForPath(filePath)
      if (!folder) continue
      if (!byCode[folder.code]) {
        byCode[folder.code] = { folder_name: folder.folder_name, code_type: folder.code_type, files: [] }
      }
      byCode[folder.code].files.push(filePath)
    }
    for (const entry of Object.values(byCode)) entry.files = unique(entry.files)
    return byCode
  }

  function normalizeCloudSourceFile(item) {
    return {
      filename: compact(item?.filename || item?.name || item?.file_name || basename(item?.fullpath || item?.path)),
      fullpath: slashPath(item?.fullpath || item?.full_path || item?.path),
      filesize: Number(item?.filesize || item?.size || item?.file_size || 0),
      filehash: compact(item?.filehash || item?.file_hash || item?.md5),
      mtime: item?.mtime || item?.modified_at || item?.updated_at || '',
    }
  }

  function indexCloudSourceFiles(files) {
    const byCode = {}
    for (const rawFile of files || []) {
      const file = normalizeCloudSourceFile(rawFile)
      if (!file.fullpath || !CLOUD_FILE_EXTENSIONS.test(file.filename)) continue
      const folder = codedFolderForPath(file.fullpath)
      if (!folder) continue
      if (!byCode[folder.code]) {
        byCode[folder.code] = { folder_name: folder.folder_name, code_type: folder.code_type, files: [] }
      }
      byCode[folder.code].files.push(file)
    }
    for (const entry of Object.values(byCode)) {
      const seen = new Set()
      entry.files = entry.files.filter(file => {
        const key = file.fullpath.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
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

  function normalizeAuditSourcePaths(rawValue) {
    const source = Array.isArray(rawValue) ? rawValue.join('\n') : String(rawValue || '')
    const values = source.split(/[\r\n]+/).map(compact).filter(Boolean)
    const result = []
    const seen = new Set()
    for (const value of values) {
      const parsed = parseCloudTarget(value)
      if (parsed.mountName !== PHOTOGRAPHY_MOUNT_NAME) {
        throw new Error(`摄影源路径必须位于“${PHOTOGRAPHY_MOUNT_NAME}”库：${value}`)
      }
      const key = parsed.relativePath.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      result.push(parsed.relativePath)
    }
    return result
  }

  function mergeSummary(job) {
    const count = Number(job?.source_folder_count || 0)
    return count > 1
      ? `多个已审核款色来源合并（${count} 个文件夹，共 ${job.files.length} 个文件）`
      : `单个已审核摄影文件夹，共 ${job?.files?.length || 0} 个文件`
  }

  function resultRow(job, status, cloudCount, note) {
    const colorCodes = unique([
      ...(Array.isArray(job?.color_codes) ? job.color_codes : []),
      job?.color_code,
    ])
    const markerJpgNames = unique([
      ...(Array.isArray(job?.marker_jpg_names) ? job.marker_jpg_names : []),
      job?.marker_jpg_name,
    ])
    const selectionNotes = unique([
      ...(Array.isArray(job?.selection_notes) ? job.selection_notes : []),
      job?.selection_note,
    ])
    return {
      '款色号': colorCodes.join('\n'),
      '款号': job?.style_code || '',
      '对应JPG文件名': markerJpgNames.join('\n'),
      '摄影源路径': Array.isArray(job?.source_folder_paths)
        ? job.source_folder_paths.map(path => `${PHOTOGRAPHY_MOUNT_NAME}//${path}`).join('\n')
        : '',
      '摄影文件夹数': Number(job?.source_folder_count || 0),
      '源文件数': Array.isArray(job?.files) ? job.files.length : 0,
      '云盘目标路径': job?.cloud_target || '',
      '云盘文件数': Number.isFinite(Number(cloudCount)) ? Number(cloudCount) : '',
      '上传状态': status,
      '备注': unique([...selectionNotes, compact(note)]).join('；'),
    }
  }

  function buildJobs(rows, sourceIndex, sourceKind = 'local') {
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
      const base = { style_code: styleCode, color_code: colorCode, cloud_target: cloudTarget, files: [] }

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
      const source = sourceIndex[sourceCode]
      if (!source?.files?.length) {
        results.push(resultRow(base, '需复核', '', `没有找到${colorCode ? '款色号' : '款号'} ${sourceCode} 对应的${sourceKind === 'cloud' ? '云盘' : '本地'}图片文件夹`))
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
          color_codes: [],
          cloud_target: target.raw,
          mount_name: target.mountName,
          relative_path: target.relativePath,
          parent_path: target.parentPath,
          folder_name: target.folderName,
          source_kind: sourceKind,
          files: [],
        })
      }
      const job = groups.get(key)
      if (colorCode) job.color_codes.push(colorCode)
      job.files.push(...source.files)
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
      jobs.push(job)
    }
    return { jobs, results }
  }

  async function buildChecklistJobs(rows, photographyMountId) {
    const results = []
    const rowJobs = []
    const allowedStatuses = new Set(['待审核', '审核通过', '通过', '已审核'])
    const colorCounts = new Map()
    for (const row of rows) {
      const colorCode = compact(row?.['款色号'])
      if (allowedStatuses.has(compact(row?.['状态'])) && /^\d{17}$/.test(colorCode)) {
        colorCounts.set(colorCode, Number(colorCounts.get(colorCode) || 0) + 1)
      }
    }

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex]
      const status = compact(row?.['状态'])
      const styleCode = compact(row?.['款号'])
      const colorCode = compact(row?.['款色号'])
      const expectedMarkerJpgName = /^\d{17}$/.test(colorCode)
        ? `${colorCode.slice(0, 12)}-${colorCode.slice(-5)}.jpg`
        : ''
      const markerJpgName = compact(row?.['对应JPG文件名'])
      const selectionNote = Number(row?.['命中款色文件夹数'] || 0) > 1
        || compact(row?.['备注']).includes('多个文件夹包含该款色')
        ? '多个文件夹包含该款色，已选图片多的上传'
        : ''
      const base = {
        style_code: styleCode,
        color_code: colorCode,
        marker_jpg_name: markerJpgName || expectedMarkerJpgName,
        selection_note: selectionNote,
        files: [],
        structured_files: [],
        directories: [],
        copy_entries: [],
        source_folder_paths: [],
        source_folder_count: 0,
      }
      if (!allowedStatuses.has(status)) {
        results.push(resultRow(base, '跳过', '', `审核表第 ${rowIndex + 2} 行状态为“${status || '空'}”`))
        continue
      }
      if (!/^\d{12}$/.test(styleCode) || !/^\d{17}$/.test(colorCode) || colorCode.slice(0, 12) !== styleCode) {
        results.push(resultRow(base, '需复核', '', `审核表第 ${rowIndex + 2} 行款号/款色号不合法`))
        continue
      }
      if (markerJpgName.toLowerCase() !== expectedMarkerJpgName.toLowerCase()) {
        results.push(resultRow(base, '需复核', '', `对应JPG文件名应为 ${expectedMarkerJpgName}，审核表记录为 ${markerJpgName || '空'}`))
        continue
      }
      if (Number(colorCounts.get(colorCode) || 0) !== 1) {
        results.push(resultRow(base, '需复核', '', `款色号 ${colorCode} 在审核表中出现多条可执行记录；为避免重复复制，未执行`))
        continue
      }

      let sourcePaths
      try {
        sourcePaths = normalizeAuditSourcePaths(row?.['摄影源路径'])
      } catch (error) {
        results.push(resultRow(base, '需复核', '', `审核表第 ${rowIndex + 2} 行：${compact(error?.message || error)}`))
        continue
      }
      base.source_folder_paths = sourcePaths
      base.source_folder_count = sourcePaths.length
      if (!sourcePaths.length) {
        results.push(resultRow(base, '需复核', '', '审核表没有记录摄影源路径'))
        continue
      }
      if (sourcePaths.length !== 1) {
        results.push(resultRow(base, '需复核', '', `每个款色号只能选择一个摄影文件夹，审核表记录了 ${sourcePaths.length} 条路径`))
        continue
      }
      const invalidSource = sourcePaths.find(path => basename(path).slice(0, 12) !== styleCode)
      if (invalidSource) {
        results.push(resultRow(base, '需复核', '', `摄影源文件夹名前12位与款号不一致：${invalidSource}`))
        continue
      }
      const auditFolderCount = Number(row?.['摄影文件夹数'])
      if (Number.isFinite(auditFolderCount) && auditFolderCount > 0 && auditFolderCount !== sourcePaths.length) {
        results.push(resultRow(base, '需复核', '', `审核表记录摄影文件夹数为 ${auditFolderCount}，实际路径为 ${sourcePaths.length} 条`))
        continue
      }

      const files = []
      const structuredFiles = []
      const directories = []
      const copyEntries = []
      try {
        for (const sourcePath of sourcePaths) {
          const tree = await collectCloudSourceTree(photographyMountId, sourcePath)
          files.push(...tree.files)
          structuredFiles.push(...tree.structured_files)
          directories.push(...tree.directories)
          copyEntries.push(...tree.copy_entries)
        }
      } catch (error) {
        results.push(resultRow(base, '需复核', '', `重新读取摄影源路径失败：${compact(error?.message || error)}`))
        continue
      }
      const seenFiles = new Set()
      base.files = files.filter(file => {
        const key = slashPath(file?.fullpath).toLowerCase()
        if (!key || seenFiles.has(key)) return false
        seenFiles.add(key)
        return true
      })
      for (const [key, values] of [['structured_files', structuredFiles], ['copy_entries', copyEntries]]) {
        const seen = new Set()
        base[key] = values.filter(item => {
          const path = slashPath(item?.fullpath).toLowerCase()
          if (!path || seen.has(path)) return false
          seen.add(path)
          return true
        })
      }
      base.directories = unique(directories)
      if (!base.files.length) {
        results.push(resultRow(base, '需复核', '', '摄影源路径中没有可复制的 JPG/JPEG/PNG/WEBP/PSD 文件'))
        continue
      }
      const matchedMarker = base.files.find(file => compact(file?.filename).toLowerCase() === expectedMarkerJpgName.toLowerCase())
      if (!matchedMarker) {
        results.push(resultRow(base, '需复核', '', `摄影源路径中已找不到对应JPG：${expectedMarkerJpgName}，请重新生成审核表`))
        continue
      }
      const auditFileCount = Number(row?.['文件数'])
      if (Number.isFinite(auditFileCount) && auditFileCount > 0 && auditFileCount !== base.files.length) {
        results.push(resultRow(base, '需复核', '', `摄影源文件已变化：审核时 ${auditFileCount} 个，当前 ${base.files.length} 个，请重新生成审核表`))
        continue
      }

      let target
      try {
        target = parseCloudTarget(row?.['云盘目标路径'])
      } catch (error) {
        results.push(resultRow(base, '需复核', '', `审核表第 ${rowIndex + 2} 行目标路径无效：${compact(error?.message || error)}`))
        continue
      }
      const folderName = compact(row?.['最终文件夹名'])
      if (!folderName || folderName !== target.folderName) {
        results.push(resultRow(base, '需复核', '', '最终文件夹名与云盘目标路径末级不一致'))
        continue
      }
      rowJobs.push({
        ...base,
        marker_jpg_name: matchedMarker.filename,
        cloud_target: target.raw,
        mount_name: target.mountName,
        relative_path: target.relativePath,
        parent_path: target.parentPath,
        folder_name: target.folderName,
        source_kind: 'cloud',
        source_mount_id: photographyMountId,
      })
    }

    const targetsByStyle = new Map()
    for (const job of rowJobs) {
      if (!targetsByStyle.has(job.style_code)) targetsByStyle.set(job.style_code, new Set())
      targetsByStyle.get(job.style_code).add(job.cloud_target)
    }
    const groups = new Map()
    for (const job of rowJobs) {
      const targets = targetsByStyle.get(job.style_code) || new Set()
      if (targets.size !== 1) continue
      const key = `${job.style_code}\n${job.cloud_target}`
      if (!groups.has(key)) {
        groups.set(key, {
          ...job,
          color_codes: [],
          marker_jpg_names: [],
          selection_notes: [],
          source_folder_paths: [],
          files: [],
          structured_files: [],
          directories: [],
          copy_entries: [],
        })
      }
      const group = groups.get(key)
      group.color_codes.push(job.color_code)
      group.marker_jpg_names.push(job.marker_jpg_name)
      if (job.selection_note) group.selection_notes.push(job.selection_note)
      group.source_folder_paths.push(...job.source_folder_paths)
      group.files.push(...job.files)
      group.structured_files.push(...job.structured_files)
      group.directories.push(...job.directories)
      group.copy_entries.push(...job.copy_entries)
    }
    for (const [styleCode, targets] of targetsByStyle.entries()) {
      if (targets.size === 1) continue
      const affected = rowJobs.filter(job => job.style_code === styleCode)
      results.push(resultRow({
        style_code: styleCode,
        color_codes: affected.map(job => job.color_code),
        marker_jpg_names: affected.map(job => job.marker_jpg_name),
        selection_notes: affected.map(job => job.selection_note),
        source_folder_paths: affected.flatMap(job => job.source_folder_paths),
        source_folder_count: unique(affected.flatMap(job => job.source_folder_paths)).length,
        files: affected.flatMap(job => job.files),
      }, '需复核', '', `同一款号在审核表中出现 ${targets.size} 个不同云盘目标路径，整款未执行`))
    }

    const jobs = []
    for (const job of groups.values()) {
      job.color_codes = unique(job.color_codes)
      job.marker_jpg_names = unique(job.marker_jpg_names)
      job.selection_notes = unique(job.selection_notes)
      job.source_folder_paths = unique(job.source_folder_paths)
      job.source_folder_count = job.source_folder_paths.length
      const seenFiles = new Set()
      job.files = job.files.filter(file => {
        const key = slashPath(file?.fullpath).toLowerCase()
        if (!key || seenFiles.has(key)) return false
        seenFiles.add(key)
        return true
      })
      for (const key of ['structured_files', 'copy_entries']) {
        const seenPaths = new Set()
        job[key] = job[key].filter(item => {
          const path = slashPath(item?.fullpath).toLowerCase()
          if (!path || seenPaths.has(path)) return false
          seenPaths.add(path)
          return true
        })
      }
      job.directories = unique(job.directories)
      jobs.push(job)
    }
    return { jobs, results }
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, { credentials: 'include', ...options })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText || url}`)
    const payload = await response.json()
    if (payload?.code != null && ![0, 200].includes(Number(payload.code))) {
      throw new Error(compact(payload.message || payload.msg || `接口返回 ${payload.code}`))
    }
    return payload?.data ?? payload
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

  function extractFolderTotal(payload, fallback) {
    const values = [payload?.total, payload?.count, payload?.data?.total, payload?.data?.count]
    const found = values.map(Number).find(Number.isFinite)
    return found == null ? fallback : found
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
    for (const [method, endpoint] of attempts) {
      try {
        const all = []
        let start = 0
        while (true) {
          const payload = await fetchFolderPage(mountId, fullpath, start, method, endpoint)
          const rawItems = extractFolderItems(payload)
          if (!Array.isArray(rawItems)) throw new Error(`${method} ${endpoint} 未返回列表`)
          const items = rawItems.map(item => normalizeListedItem(item, fullpath))
          all.push(...items)
          start += items.length
          if (!items.length || start >= extractFolderTotal(payload, start)) break
        }
        return { ok: true, items: all }
      } catch (error) {
        errors.push(compact(error?.message || error))
      }
    }
    return { ok: false, items: [], error: errors[0] || '列目录失败' }
  }

  function relativePathWithin(fullpath, rootPath) {
    const full = slashPath(fullpath)
    const root = slashPath(rootPath)
    if (full.toLowerCase() === root.toLowerCase()) return ''
    return full.toLowerCase().startsWith(`${root.toLowerCase()}/`)
      ? full.slice(root.length + 1)
      : basename(full)
  }

  async function collectCloudSourceTree(mountId, sourcePath) {
    const rootPath = slashPath(sourcePath)
    const queue = [{ fullpath: rootPath, depth: 0 }]
    const visited = new Set()
    const files = []
    const structuredFiles = []
    const directories = []
    const copyEntries = []
    while (queue.length) {
      const current = queue.shift()
      const key = slashPath(current.fullpath).toLowerCase()
      if (!key || visited.has(key)) continue
      visited.add(key)
      const listed = await listFolderItems(mountId, current.fullpath)
      if (!listed.ok) throw new Error(`${current.fullpath}：${listed.error}`)
      for (const item of listed.items) {
        const relativePath = relativePathWithin(item.fullpath, rootPath)
        if (current.depth === 0) copyEntries.push(item)
        if (isDirectory(item)) {
          directories.push(relativePath)
          if (current.depth < 16) queue.push({ fullpath: item.fullpath, depth: current.depth + 1 })
          continue
        }
        if (!CLOUD_FILE_EXTENSIONS.test(item.filename)) continue
        const file = { ...normalizeCloudSourceFile(item), source_relative_path: relativePath }
        files.push(file)
        structuredFiles.push(file)
        if (files.length > 10000) throw new Error('云盘源路径文件超过10000个，请缩小扫描范围')
      }
    }
    return {
      files,
      structured_files: structuredFiles,
      directories: unique(directories),
      copy_entries: copyEntries,
    }
  }

  async function collectCloudSourceFiles(mountId, sourcePath) {
    return (await collectCloudSourceTree(mountId, sourcePath)).files
  }

  async function collectCloudTargetTree(mountId, rootPath) {
    const root = slashPath(rootPath)
    const queue = [{ fullpath: root, depth: 0 }]
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
        const relativePath = relativePathWithin(item.fullpath, root)
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
    if (sourceRelative && targetRelative && sourceRelative !== targetRelative) return false
    if (source.filehash && target.filehash) return source.filehash === target.filehash
    if (source.filename.toLowerCase() !== target.filename.toLowerCase()) return false
    if (source.filesize > 0 && target.filesize > 0) return source.filesize === target.filesize
    return true
  }

  function cloudCopyState(job, tree) {
    const available = [...(tree.files || [])]
    const missing = []
    let matched = 0
    const sourceFiles = job.structured_files?.length ? job.structured_files : job.files || []
    for (const sourceFile of sourceFiles) {
      const index = available.findIndex(item => cloudSourceMatchesItem(sourceFile, item))
      if (index >= 0) {
        available.splice(index, 1)
        matched += 1
      } else {
        missing.push({ ...normalizeCloudSourceFile(sourceFile), source_relative_path: sourceFile.source_relative_path || '' })
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
    let start = 0
    while (true) {
      const body = new URLSearchParams({
        size: String(LIST_PAGE_SIZE),
        start: String(start),
        keyword: compact(keyword),
        mount_id: String(mountId || ''),
        scope: SEARCH_SCOPE,
      })
      const payload = await fetchJson('/fengcloud/2/file/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
      const items = Array.isArray(payload?.list) ? payload.list : []
      const total = Number(payload?.total || 0)
      all.push(...items)
      start += items.length
      if (!items.length || start >= total) break
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
    const availableNames = new Map()
    for (const item of cloudFiles) {
      const key = compact(item.filename).toLocaleLowerCase()
      availableNames.set(key, Number(availableNames.get(key) || 0) + 1)
    }
    const cloudNameCounts = new Map(availableNames)
    const localNameCounts = new Map()
    const displayNames = new Map()
    for (const filePath of job.files) {
      const name = basename(filePath)
      const key = name.toLocaleLowerCase()
      localNameCounts.set(key, Number(localNameCounts.get(key) || 0) + 1)
      if (!displayNames.has(key)) displayNames.set(key, name)
    }
    const ambiguousKeys = new Set([...localNameCounts.entries()]
      .filter(([key, count]) => count > 1 && Number(cloudNameCounts.get(key) || 0) < count)
      .map(([key]) => key))
    const missingFiles = []
    for (const filePath of job.files) {
      const key = basename(filePath).toLocaleLowerCase()
      const available = Number(availableNames.get(key) || 0)
      if (available > 0) availableNames.set(key, available - 1)
      else missingFiles.push(filePath)
    }
    const missingSet = new Set(missingFiles)
    const retryFiles = job.files.filter(filePath => {
      const key = basename(filePath).toLocaleLowerCase()
      return ambiguousKeys.has(key) || missingSet.has(filePath)
    })
    return {
      ok: true,
      count: cloudFiles.length,
      missing_files: unique(retryFiles),
      ambiguous_names: [...ambiguousKeys].map(key => displayNames.get(key)),
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
          if (isDirectory(item) || !IMAGE_EXTENSIONS.test(item.filename) || !isWithinPath(item.fullpath, job.relative_path)) continue
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
    const selectors = [
      '[class*="breadcrumb"]', '[class*="Breadcrumb"]',
      '[class*="crumb"]', '[class*="Crumb"]',
      '[aria-label*="breadcrumb"]', '[aria-label*="Breadcrumb"]',
    ].join(',')
    return [...document.querySelectorAll(selectors)]
      .filter(visible)
      .some(element => textOf(element).toLocaleLowerCase().includes(target))
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
    }
    return next.job_index >= (next.jobs || []).length ? complete(next) : nextPhase('navigate_parent', 200, next)
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

    let mounts
    try {
      mounts = await fetchMounts()
    } catch (error) {
      return fail(`读取森马云盘挂载点失败：${compact(error?.message || error)}`)
    }
    const mountMap = new Map(mounts.map(item => [compact(item?.org_name || item?.name), item?.mount_id]))
    const photographyMountId = mountMap.get(PHOTOGRAPHY_MOUNT_NAME)
    if (photographyMountId == null || photographyMountId === '') {
      return fail(`未找到首级摄影库：${PHOTOGRAPHY_MOUNT_NAME}`)
    }

    const built = await buildChecklistJobs(rows, photographyMountId)
    const runnable = []
    for (const job of built.jobs) {
      const mountId = mountMap.get(job.mount_name)
      if (mountId == null || mountId === '') {
        built.results.push(resultRow(job, '需复核', '', `未找到云盘目标挂载点：${job.mount_name}`))
      } else {
        runnable.push({ ...job, mount_id: mountId })
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
      source_mode: 'cloud',
      source_mount_name: PHOTOGRAPHY_MOUNT_NAME,
    }
    return runnable.length ? nextPhase('navigate_parent', 100, initialized) : complete(initialized)
  }

  const job = currentJob()
  if (!job) return complete(shared)

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
      const inspected = await inspectCloudFiles(job)
      if (!inspected.ok) {
        return appendAndAdvance(job, '跳过', '', `云盘已存在同名目标文件夹；无法可靠识别缺少文件，未追加：${inspected.error}`)
      }
      if (!inspected.missing_files.length) {
        return appendAndAdvance(job, '跳过', inspected.count, '云盘已存在同名目标文件夹且图片数量完整；按流程不覆盖、不重复上传')
      }
      return nextPhase('observe_existing_incomplete', 1500, {
        ...shared,
        phase_retries: 0,
        resume_existing: true,
        last_cloud_count: inspected.count,
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
      return appendAndAdvance(job, '跳过', inspected.count, '云盘已有目录在观察期间自动补齐；未执行补传')
    }
    const now = Date.now()
    const previousCount = Number(shared.last_cloud_count ?? inspected.count)
    if (inspected.count !== previousCount) {
      return nextPhase('observe_existing_incomplete', 1500, {
        ...shared,
        phase_retries: 0,
        last_cloud_count: inspected.count,
        last_progress_at: now,
      })
    }
    const stableSince = Number(shared.last_progress_at || now)
    if (now - stableSince < 60000) {
      return nextPhase('observe_existing_incomplete', 1500, {
        ...shared,
        phase_retries: 0,
        last_cloud_count: inspected.count,
        last_progress_at: stableSince,
      })
    }
    const openedName = openFolderByName(job.folder_name)
    if (!openedName) {
      return retryOrReview('observe_existing_incomplete', `已有目录稳定 1 分钟后仍缺少 ${inspected.missing_files.length} 张图片，但页面没有找到该文件夹`, 8)
    }
    return nextPhase('verify_target_folder', 900, {
      ...shared,
      phase_retries: 0,
      pending_upload_files: inspected.missing_files,
      resume_existing: true,
      resume_missing_count: inspected.missing_files.length,
      ambiguous_duplicate_names: inspected.ambiguous_names,
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
    const existingBatches = Array.isArray(shared.upload_batches) ? shared.upload_batches : []
    if (existingBatches.length) return nextPhase('open_upload_menu', 200, { ...shared, phase_retries: 0 })
    const uploadFiles = Array.isArray(shared.pending_upload_files) && shared.pending_upload_files.length
      ? shared.pending_upload_files
      : job.files
    const batches = buildUploadBatches(uploadFiles)
    if (!batches.length) return appendAndAdvance(job, '需复核', '', '没有可提交到云盘的图片')
    const inspected = await inspectCloudFiles(job)
    if (!inspected.ok) return retryOrReview('verify_target_folder', `上传前无法读取云盘目录：${inspected.error}`, 8)
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
    if (unexpectedItems.length) {
      const names = unique(unexpectedItems.map(item => item.filename)).slice(0, 8)
      return appendAndAdvance(job, '需复核', inspected.count,
        `${mergeSummary(job)}；目标目录存在 ${unexpectedItems.length} 个不属于本次审核源文件结构的文件或文件夹（${names.join('、')}），为避免覆盖或混入文件，未执行复制`)
    }
    if (!inspected.missing_files.length && !(inspected.missing_directories || []).length) {
      return appendAndAdvance(job, '跳过', inspected.count,
        `${mergeSummary(job)}；目标目录已包含完整源文件夹结构，已按相对路径及 filehash/文件大小校验；未重复复制`)
    }
    if (inspected.has_partial_existing_structure) {
      return appendAndAdvance(job, '需复核', inspected.count,
        `${mergeSummary(job)}；目标目录已有同名子文件夹但内部结构不完整；为避免覆盖或拆散目录，未自动追加复制`)
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
      return appendAndAdvance(job, '复制成功', inspected.count,
        `${mergeSummary(job)}；已在森马云盘服务器端复制并按原相对路径保留完整文件夹结构；目标文件按相对路径及 filehash/文件大小校验通过，源文件未下载到本地`)
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
    const expectedCloudCount = Number(shared.upload_expected_cloud_count || job.files.length)
    const now = Date.now()
    if (counted.ok && cloudFileCount >= expectedCloudCount) {
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
        ? `；已有目录稳定 1 分钟后补传 ${Number(shared.resume_missing_count || 0)} 张图片`
        : ''
      const batchNote = batches.length > 1 ? `；已拆分为 ${batches.length} 批上传（每批最多 ${MAX_UPLOAD_BATCH_FILES} 张且批内无同名文件）` : ''
      return appendAndAdvance(job, '上传成功', cloudFileCount, `已校验云盘文件数不少于本地图片数；${sourceNote}${repairNote}${batchNote}`)
    }
    const startedAt = Number(shared.wait_started_at || Date.now())
    const previousCount = Number(shared.last_cloud_count ?? -1)
    if (now - startedAt > Number(shared.upload_wait_seconds || 300) * 1000) {
      if (counted.ok && batches.length && Number(shared.batch_retry_count || 0) < 1) {
        const currentBatch = Array.isArray(shared.current_upload_files) && shared.current_upload_files.length
          ? shared.current_upload_files
          : (batches[batchIndex] || [])
        const globalNameCounts = new Map()
        for (const filePath of job.files) {
          const key = fileNameKey(filePath)
          globalNameCounts.set(key, Number(globalNameCounts.get(key) || 0) + 1)
        }
        const missingSet = new Set((counted.missing_files || []).map(slashPath))
        const unambiguousMissing = currentBatch.filter(filePath => missingSet.has(slashPath(filePath))
          && Number(globalNameCounts.get(fileNameKey(filePath)) || 0) === 1)
        const ambiguousFiles = currentBatch.filter(filePath => Number(globalNameCounts.get(fileNameKey(filePath)) || 0) > 1)
        const retryFiles = unique(unambiguousMissing.length ? unambiguousMissing : ambiguousFiles)
        if (retryFiles.length) {
          const ambiguousNames = duplicateFileNames(job.files)
            .filter(name => retryFiles.some(filePath => fileNameKey(filePath) === name.toLocaleLowerCase()))
          return nextPhase('open_upload_menu', 1000, {
            ...shared,
            phase_retries: 0,
            batch_retry_files: retryFiles,
            batch_retry_count: 1,
            batch_retry_ambiguous: ambiguousNames.length > 0,
            ambiguous_duplicate_names: unique([...(shared.ambiguous_duplicate_names || []), ...ambiguousNames]),
            ambiguous_retry_file_count: Number(shared.ambiguous_retry_file_count || 0) + (ambiguousNames.length ? retryFiles.length : 0),
            wait_started_at: 0,
            last_cloud_count: cloudFileCount,
            last_progress_at: now,
          })
        }
      }
      const waitNote = shared.resume_existing
        ? '；已有目录稳定 1 分钟后已执行一次补传，本次不再重复补传'
        : (Number(shared.batch_retry_count || 0) > 0
          ? '；已自动补传 1 次，本次不再重复补传'
          : '；没有可安全识别的缺图，未执行自动补传')
      return appendAndAdvance(job, '需复核', counted.ok ? cloudFileCount : '', counted.ok
        ? `等待上传超时：云盘 ${cloudFileCount} 个，本地 ${job.files.length} 个${waitNote}`
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
