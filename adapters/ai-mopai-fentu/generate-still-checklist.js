;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const SEMIR_CLOUD_URL = 'https://fmp.semirapp.com/'
  const PHOTOGRAPHY_MOUNT_NAME = '摄影'

  const compact = value => String(value ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim()
  const slashPath = value => compact(value).replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  const basename = value => slashPath(value).split('/').filter(Boolean).pop() || ''
  const unique = values => [...new Set(values)]

  const PLAN_INPUTS = {
    plan1: '__ai_mop_plan1_file__',
    plan2: '__ai_mop_plan2_file__',
  }

  function planPath(value, folder, fileName) {
    if (typeof value === 'string') return compact(value)
    if (Array.isArray(value?.paths)) return compact(value.paths[0])
    const legacyPath = compact(value?.path)
    if (legacyPath) return legacyPath
    const base = compact(folder).replace(/[\\/]+$/, '')
    const name = compact(fileName).replace(/^[\\/]+/, '')
    if (!base || !name) return ''
    return `${base}${base.includes('\\') ? '\\' : '/'}${name}`
  }

  function center(element) {
    const rect = element?.getBoundingClientRect?.()
    if (!rect || rect.width <= 0 || rect.height <= 0) return null
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
  }

  function preparePlanFileInputs(paths) {
    document.body.innerHTML = ''
    Object.assign(document.body.style, {
      margin: '0', padding: '32px', fontFamily: 'Arial, Microsoft YaHei, sans-serif',
      background: '#f7f8fa', color: '#1f2937',
    })
    const title = document.createElement('h2')
    title.textContent = '上新运营助手：正在读取上市计划表'
    document.body.appendChild(title)
    const items = []
    paths.forEach(({ key, path, label }) => {
      const row = document.createElement('div')
      row.style.margin = '18px 0'
      const input = document.createElement('input')
      input.type = 'file'
      input.id = PLAN_INPUTS[key]
      input.accept = '.xlsx,.xlsm'
      Object.assign(input.style, {
        display: 'block', width: '460px', padding: '12px', border: '1px solid #d1d5db',
        borderRadius: '8px', background: '#fff', fontSize: '15px', cursor: 'pointer',
      })
      const caption = document.createElement('div')
      caption.textContent = `读取${label}：${basename(path)}`
      caption.style.marginBottom = '8px'
      row.append(caption, input)
      document.body.appendChild(row)
      const click = center(input)
      if (!click) throw new Error(`${label}文件输入框创建失败`)
      items.push({ label, clicks: [click], files: [path], timeout_ms: 15000, settle_ms: 300 })
    })
    return items
  }

  function nextPhase(next, shared = {}) {
    return {
      success: true,
      data: [],
      meta: { action: 'next_phase', has_more: true, next_phase: next, sleep_ms: 0, shared },
    }
  }

  function cloudNextPhase(next, cloudShared = {}, sleepMs = 1500) {
    return {
      success: true,
      data: [],
      meta: { action: 'next_phase', has_more: true, next_phase: next, sleep_ms: sleepMs, shared: cloudShared },
    }
  }

  async function cloudLoginReady() {
    try {
      const response = await fetch('/fengcloud/1/account/mount', { credentials: 'include' })
      if (!response.ok) return false
      const payload = await response.json()
      if (payload?.code != null) return [0, 200].includes(Number(payload.code))
      return [payload, payload?.list, payload?.rows, payload?.data,
        payload?.data?.list, payload?.data?.rows].some(Array.isArray)
    } catch (_) {
      return false
    }
  }

  function isSemirCloudPage() {
    return /^https:\/\/fmp\.semirapp\.com(?:[\/:?#]|$)/i.test(compact(location?.href))
  }

  function fileChooserPhase(items) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'file_chooser_upload',
        has_more: true,
        strict: true,
        items,
        next_phase: 'load_plan1',
        sleep_ms: 100,
      },
    }
  }

  function cloudSourceEval(expression) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'cdp_target_eval',
        has_more: true,
        expression,
        target_url_contains: [SEMIR_CLOUD_URL],
        target_types: ['page'],
        shared_key: 'cloud_source_scan',
        next_phase: 'cloud_source_ready',
        sleep_ms: 0,
        shared,
      },
    }
  }

  function buildPhotographySearchExpression(colorCodes) {
    return `;(async () => {
      const compact = value => String(value == null ? '' : value).trim()
      const slash = value => compact(value).replace(/\\\\/g, '/').replace(/\\/{2,}/g, '/').replace(/^\\/+|\\/+$/g, '')
      const colorCodes = ${JSON.stringify(colorCodes)}
      const mountName = ${JSON.stringify(PHOTOGRAPHY_MOUNT_NAME)}
      const cloudFilePattern = /\\.(?:jpe?g|png|webp|psd)$/i
      const pageSize = 500
      const searchPageSize = 100
      const maxFilesPerStyle = 10000
      const maxDepth = 16
      const fetchJson = async (url, options = {}) => {
        const response = await fetch(url, { credentials: 'include', ...options })
        if (!response.ok) throw new Error(String(response.status) + ' ' + (response.statusText || url))
        const payload = await response.json()
        if (payload && payload.code != null && ![0, 200].includes(Number(payload.code))) {
          throw new Error(compact(payload.message || payload.msg || ('接口返回 ' + payload.code)))
        }
        return payload && payload.data != null ? payload.data : payload
      }
      const listArray = payload => [payload, payload && payload.list, payload && payload.rows,
        payload && payload.files, payload && payload.items, payload && payload.data,
        payload && payload.data && payload.data.list, payload && payload.data && payload.data.rows,
        payload && payload.data && payload.data.files, payload && payload.data && payload.data.items].find(Array.isArray)
      const isDir = item => [item && item.dir, item && item.is_dir, item && item.is_directory, item && item.directory]
        .some(value => value === true || value === 1 || value === '1')
        || ['dir', 'folder'].includes(compact(item && item.type).toLowerCase())
      const listFolder = async fullpath => {
        const all = []
        let start = 0
        while (true) {
          const query = new URLSearchParams({
            order: 'filename asc', size: String(pageSize), start: String(start),
            mount_id: String(mountId), fullpath: String(fullpath || ''), path: String(fullpath || ''), current: '1',
          })
          const payload = await fetchJson('/fengcloud/1/file/ls?' + query.toString())
          const items = listArray(payload)
          if (!Array.isArray(items)) throw new Error('云盘列目录接口未返回列表')
          all.push(...items)
          start += items.length
          const total = Number(payload && (payload.total || payload.count))
          if (!items.length || (Number.isFinite(total) ? start >= total : items.length < pageSize)) break
        }
        return all
      }
      const searchFolders = async styleCode => {
        const all = []
        let start = 0
        while (true) {
          const body = new URLSearchParams({
            size: String(searchPageSize), start: String(start), keyword: styleCode,
            mount_id: String(mountId), scope: '["filename", "tag"]',
          })
          const payload = await fetchJson('/fengcloud/2/file/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
          })
          const items = listArray(payload)
          if (!Array.isArray(items)) throw new Error('云盘搜索接口未返回列表')
          all.push(...items)
          start += items.length
          const total = Number(payload && (payload.total || payload.count))
          if (!items.length || (Number.isFinite(total) ? start >= total : items.length < searchPageSize)) break
        }
        const seen = new Set()
        return all.filter(item => {
          const filename = compact(item && (item.filename || item.name || item.file_name))
          const fullpath = slash(item && (item.fullpath || item.full_path || item.path))
          if (!isDir(item) || filename.slice(0, 12) !== styleCode || !fullpath) return false
          const key = fullpath.toLowerCase()
          if (seen.has(key)) return false
          seen.add(key)
          return true
        }).map(item => ({
          filename: compact(item && (item.filename || item.name || item.file_name)),
          fullpath: slash(item && (item.fullpath || item.full_path || item.path)),
        }))
      }
      const collectFiles = async folders => {
        const queue = folders.map(folder => ({ fullpath: folder.fullpath, depth: 0 }))
        const visited = new Set()
        const files = []
        const seenFiles = new Set()
        while (queue.length) {
          const current = queue.shift()
          const key = slash(current.fullpath).toLowerCase()
          if (!key || visited.has(key)) continue
          visited.add(key)
          const items = await listFolder(current.fullpath)
          for (const item of items) {
            const filename = compact(item && (item.filename || item.name || item.file_name))
            const fullpath = slash(item && (item.fullpath || item.full_path || item.path) || [current.fullpath, filename].filter(Boolean).join('/'))
            if (!filename || !fullpath) continue
            if (isDir(item)) {
              if (current.depth < maxDepth) queue.push({ fullpath, depth: current.depth + 1 })
              continue
            }
            if (!cloudFilePattern.test(filename)) continue
            const fileKey = fullpath.toLowerCase()
            if (seenFiles.has(fileKey)) continue
            seenFiles.add(fileKey)
            files.push({
              filename, fullpath,
              filesize: Number(item && (item.filesize || item.size || item.file_size) || 0),
              filehash: compact(item && (item.filehash || item.file_hash || item.md5)),
              mtime: item && (item.mtime || item.modified_at || item.updated_at || ''),
            })
            if (files.length > maxFilesPerStyle) throw new Error('单款摄影源文件超过10000个，请缩小范围')
          }
        }
        return files
      }
      try {
        const mountsPayload = await fetchJson('/fengcloud/1/account/mount')
        const mounts = Array.isArray(mountsPayload) ? mountsPayload : (mountsPayload && (mountsPayload.list || mountsPayload.rows)) || []
        const mount = mounts.find(item => compact(item && (item.org_name || item.name)) === mountName)
        if (!mount) throw new Error('没有找到首级摄影库：' + mountName)
        var mountId = mount.mount_id
        const results = []
        const styleCache = new Map()
        const scanStyle = async styleCode => {
          if (styleCache.has(styleCode)) return styleCache.get(styleCode)
          const folders = await searchFolders(styleCode)
          const scanned = []
          for (const folder of folders) {
            const files = await collectFiles([folder])
            scanned.push({ ...folder, file_count: files.length, files })
          }
          styleCache.set(styleCode, scanned)
          return scanned
        }
        for (const colorCode of colorCodes) {
          const styleCode = colorCode.slice(0, 12)
          const markerJpgName = styleCode + '-' + colorCode.slice(-5) + '.jpg'
          const scanned = await scanStyle(styleCode)
          const matched = scanned.map(folder => ({
            ...folder,
            marker_file: folder.files.find(file => compact(file.filename).toLowerCase() === markerJpgName.toLowerCase()) || null,
          })).filter(folder => folder.marker_file)
          const maxFileCount = matched.length ? Math.max(...matched.map(folder => Number(folder.file_count || 0))) : 0
          const topFolders = matched.filter(folder => Number(folder.file_count || 0) === maxFileCount)
          const selected = topFolders.length === 1 ? topFolders[0] : null
          const candidateFolders = scanned.map(folder => ({
            filename: folder.filename,
            fullpath: folder.fullpath,
            file_count: folder.file_count,
          }))
          const matchedFolders = matched.map(folder => ({
            filename: folder.filename,
            fullpath: folder.fullpath,
            file_count: folder.file_count,
            matched_jpg_filename: folder.marker_file.filename,
          }))
          results.push({
            color_code: colorCode,
            style_code: styleCode,
            marker_jpg_name: markerJpgName,
            candidate_folders: candidateFolders,
            candidate_folder_count: candidateFolders.length,
            matched_folders: matchedFolders,
            matched_folder_count: matchedFolders.length,
            folders: selected ? [{
              filename: selected.filename,
              fullpath: selected.fullpath,
              file_count: selected.file_count,
              matched_jpg_filename: selected.marker_file.filename,
            }] : [],
            files: selected ? selected.files : [],
            selection_note: matched.length > 1 && selected
              ? '多个文件夹包含该款色，已选图片多的上传'
              : '',
            selection_error: matched.length > 1 && !selected
              ? '多个文件夹包含该款色且图片数量并列，需人工复核'
              : '',
          })
        }
        return { ok: true, mount_name: mountName, mount_id: mountId, results }
      } catch (error) {
        return { ok: false, error: compact(error && error.message || error) }
      }
    })()`
  }

  function findZipEnd(view) {
    const signature = 0x06054b50
    const min = Math.max(0, view.byteLength - 65557)
    for (let offset = view.byteLength - 22; offset >= min; offset -= 1) {
      if (view.getUint32(offset, true) === signature) return offset
    }
    throw new Error('不是有效的 XLSX 文件：找不到 ZIP 目录')
  }

  function zipEntries(buffer) {
    const view = new DataView(buffer)
    const decoder = new TextDecoder('utf-8')
    const end = findZipEnd(view)
    const total = view.getUint16(end + 10, true)
    let offset = view.getUint32(end + 16, true)
    const entries = new Map()
    for (let index = 0; index < total; index += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('XLSX ZIP 目录损坏')
      const method = view.getUint16(offset + 10, true)
      const compressedSize = view.getUint32(offset + 20, true)
      const nameLength = view.getUint16(offset + 28, true)
      const extraLength = view.getUint16(offset + 30, true)
      const commentLength = view.getUint16(offset + 32, true)
      const localOffset = view.getUint32(offset + 42, true)
      const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLength)).replace(/\\/g, '/')
      entries.set(name, { method, compressedSize, localOffset })
      offset += 46 + nameLength + extraLength + commentLength
    }
    return entries
  }

  async function zipText(buffer, entries, name, required = true) {
    const entry = entries.get(name)
    if (!entry) {
      if (!required) return ''
      throw new Error(`XLSX 缺少内部文件：${name}`)
    }
    const view = new DataView(buffer)
    const nameLength = view.getUint16(entry.localOffset + 26, true)
    const extraLength = view.getUint16(entry.localOffset + 28, true)
    const start = entry.localOffset + 30 + nameLength + extraLength
    const compressed = new Uint8Array(buffer, start, entry.compressedSize)
    let bytes = compressed
    if (entry.method === 8) {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      bytes = new Uint8Array(await new Response(stream).arrayBuffer())
    } else if (entry.method !== 0) {
      throw new Error(`XLSX 使用了不支持的压缩方式：${entry.method}`)
    }
    return new TextDecoder('utf-8').decode(bytes)
  }

  function xmlDocument(text, label) {
    const documentNode = new DOMParser().parseFromString(text, 'application/xml')
    if (documentNode.getElementsByTagName('parsererror').length) throw new Error(`${label} XML 解析失败`)
    return documentNode
  }

  function nodes(root, localName) {
    return [...root.getElementsByTagNameNS('*', localName)]
  }

  function resolveZipPath(base, target) {
    const parts = `${base}/${target}`.replace(/^\/+/, '').split('/')
    const clean = []
    parts.forEach(part => {
      if (!part || part === '.') return
      if (part === '..') clean.pop()
      else clean.push(part)
    })
    return clean.join('/')
  }

  function columnIndex(reference) {
    const letters = compact(reference).match(/^[A-Z]+/i)?.[0]?.toUpperCase() || ''
    let index = 0
    for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64
    return index - 1
  }

  function cellText(cell, sharedStrings) {
    const type = cell.getAttribute('t') || ''
    if (type === 'inlineStr') return nodes(cell, 'is')[0]?.textContent || ''
    const raw = nodes(cell, 'v')[0]?.textContent || ''
    if (type === 's') return sharedStrings[Number(raw)] ?? ''
    if (type === 'b') return raw === '1' ? 'True' : 'False'
    return raw
  }

  function rowValues(row, sharedStrings) {
    const values = []
    nodes(row, 'c').forEach(cell => {
      const index = columnIndex(cell.getAttribute('r'))
      if (index >= 0) values[index] = cellText(cell, sharedStrings)
    })
    return values
  }

  function dedupeHeaders(rawHeaders) {
    const used = new Map()
    return rawHeaders.map((value, index) => {
      const header = compact(value) || `列${index + 1}`
      const count = (used.get(header) || 0) + 1
      used.set(header, count)
      return count === 1 ? header : `${header}_${count}`
    })
  }

  const WORKSHEET_FIELDS = ['大货款号', '大货款色号', '款色号', '款色编码', 'SKU编码', '商品编码', '上市批次', '产品线', '年龄段']

  function worksheetHeaderName(value) {
    return compact(value).replace(/\s+/g, '')
  }

  function worksheetHeaderBase(value) {
    return worksheetHeaderName(String(value || '').split('/').pop()).replace(/_\d+$/, '')
  }

  function findWorksheetHeaderRow(byNumber) {
    let selected = 0
    let selectedScore = -1
    ;[...byNumber.keys()].sort((a, b) => a - b).filter(rowNumber => rowNumber <= 20).forEach(rowNumber => {
      const names = (byNumber.get(rowNumber) || []).map(worksheetHeaderName)
      if (!names.includes('大货款号')) return
      const score = names.reduce((total, name) => total + (WORKSHEET_FIELDS.includes(name) ? 1 : 0), 0)
      if (score > selectedScore) {
        selected = rowNumber
        selectedScore = score
      }
    })
    return selected
  }

  function preserveBatchHeaderGroups(byNumber, headerRowNumber, rawHeaders) {
    const parentHeaders = byNumber.get(headerRowNumber - 1) || []
    let activeGroup = ''
    return rawHeaders.map((header, index) => {
      const parent = worksheetHeaderName(parentHeaders[index])
      if (parent) activeGroup = ['正季上市', '上市规划'].includes(parent) ? parent : ''
      if (header === '上市批次' && activeGroup) return `${activeGroup}/${header}`
      return header
    })
  }

  function worksheetRows(xml, sharedStrings) {
    const documentNode = xmlDocument(xml, '工作表')
    const sheetRows = nodes(documentNode, 'row')
    if (!sheetRows.length) return []
    const byNumber = new Map()
    sheetRows.forEach((row, index) => byNumber.set(Number(row.getAttribute('r') || index + 1), rowValues(row, sharedStrings)))
    let headers
    let dataStart
    const headerRowNumber = findWorksheetHeaderRow(byNumber)
    if (headerRowNumber) {
      const rawHeaders = (byNumber.get(headerRowNumber) || []).map(worksheetHeaderName)
      headers = dedupeHeaders(preserveBatchHeaderGroups(byNumber, headerRowNumber, rawHeaders))
      dataStart = headerRowNumber + 1
    } else {
      const primary = byNumber.get(1) || []
      const secondary = byNumber.get(2) || []
      const width = Math.max(primary.length, secondary.length)
      const grouped = Array.from({ length: width }, (_, index) => !compact(primary[index]) && Boolean(compact(secondary[index]))).some(Boolean)
      if (!grouped) {
        headers = dedupeHeaders(primary.map(worksheetHeaderName))
        dataStart = 2
      } else {
        let lastParent = ''
        const merged = Array.from({ length: width }, (_, index) => {
          const parent = worksheetHeaderName(primary[index])
          const child = worksheetHeaderName(secondary[index])
          if (parent) lastParent = parent
          const effectiveParent = parent || (child ? lastParent : '')
          if (child && effectiveParent && child !== effectiveParent) return `${effectiveParent}/${child}`
          return effectiveParent || child || `列${index + 1}`
        })
        headers = dedupeHeaders(merged)
        dataStart = 3
      }
    }
    const wanted = headers.map(header => {
      const base = worksheetHeaderBase(header)
      return WORKSHEET_FIELDS.includes(base)
    })
    const result = []
    ;[...byNumber.keys()].sort((a, b) => a - b).forEach(rowNumber => {
      if (rowNumber < dataStart) return
      const values = byNumber.get(rowNumber) || []
      if (values.every(value => !compact(value))) return
      const row = {}
      headers.forEach((header, index) => {
        if (wanted[index]) row[header] = compact(values[index])
      })
      result.push(row)
    })
    return result
  }

  async function readWorkbookSheets(file, requestedSheets) {
    if (!file) throw new Error('未能从浏览器文件输入中读取计划表')
    if (!/\.(?:xlsx|xlsm)$/i.test(file.name || '')) {
      throw new Error(`计划表选错文件：${file.name || '未知文件'}。请选择上市计划表 .xlsx/.xlsm，不要选择 AI分图安装包 .zip`)
    }
    const buffer = await file.arrayBuffer()
    const entries = zipEntries(buffer)
    if (!entries.has('xl/workbook.xml')) {
      throw new Error(`文件“${file.name}”不是有效的 Excel 工作簿：缺少 xl/workbook.xml`)
    }
    const workbookXml = xmlDocument(await zipText(buffer, entries, 'xl/workbook.xml'), '工作簿')
    const relationshipsXml = xmlDocument(await zipText(buffer, entries, 'xl/_rels/workbook.xml.rels'), '工作簿关系')
    const relationshipTargets = new Map(nodes(relationshipsXml, 'Relationship').map(item => [
      item.getAttribute('Id'),
      resolveZipPath('xl', item.getAttribute('Target') || ''),
    ]))
    const sheetTargets = new Map(nodes(workbookXml, 'sheet').map(item => [
      item.getAttribute('name') || '',
      relationshipTargets.get(item.getAttribute('r:id') || item.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')),
    ]))
    const sharedXml = await zipText(buffer, entries, 'xl/sharedStrings.xml', false)
    const sharedStrings = sharedXml ? nodes(xmlDocument(sharedXml, '共享文本'), 'si').map(item => item.textContent || '') : []
    const sheets = {}
    const sheetNames = requestedSheets.length ? requestedSheets : [...sheetTargets.keys()]
    for (const sheetName of sheetNames) {
      const target = sheetTargets.get(sheetName)
      if (!target) throw new Error(`计划表“${file.name}”缺少指定 Sheet：${sheetName}`)
      const xml = await zipText(buffer, entries, target)
      sheets[sheetName] = { rows: worksheetRows(xml, sharedStrings) }
    }
    return { path: file.name, sheets }
  }

  function parseMappings(raw) {
    const lines = Array.isArray(raw) ? raw : String(raw || '').split(/\r?\n/)
    const mappings = []
    const seen = new Set()
    for (const line of lines) {
      const text = compact(line)
      if (!text) continue
      const divider = text.indexOf('=') >= 0 ? text.indexOf('=') : text.indexOf('→')
      if (divider < 1) throw new Error(`Sheet 映射格式错误：${text}；请使用 Sheet名称=云盘目录`)
      const sheet = compact(text.slice(0, divider))
      const directory = compact(text.slice(divider + 1))
      if (!sheet || !directory) throw new Error(`Sheet 映射不完整：${text}`)
      if (seen.has(sheet)) throw new Error(`Sheet 映射重复：${sheet}`)
      seen.add(sheet)
      mappings.push({ sheet, directory })
    }
    return mappings
  }

  function normalizeColorCodes(rawValue) {
    const source = Array.isArray(rawValue) ? rawValue.join('\n') : String(rawValue || '')
    const tokens = source.replace(/[，、；;,]/g, '\n').split(/\s+/).map(compact).filter(Boolean)
    const invalid = unique(tokens.filter(value => !/^\d{17}$/.test(value)))
    if (invalid.length) throw new Error(`以下款色号不是完整17位数字：${invalid.slice(0, 8).join('、')}`)
    const codes = unique(tokens)
    if (!codes.length) throw new Error('请至少填写一个17位款色号')
    return codes
  }

  function normalizeCloudRoot(raw) {
    const value = compact(raw).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    const matches = value.match(/\/\//g) || []
    if (matches.length !== 1) {
      throw new Error('云盘根路径必须且只能在挂载点后保留一个 //')
    }
    const [mount, remainder] = value.split('//')
    const cleanMount = compact(mount).replace(/\/+$/g, '')
    const cleanRemainder = remainder.split('/').map(compact).filter(Boolean).join('/')
    if (!cleanMount || !cleanRemainder) throw new Error('云盘根路径缺少挂载点或根目录')
    return `${cleanMount}//${cleanRemainder}`
  }

  function formatRunDate(raw) {
    const text = compact(raw)
    if (!text) return ''
    const currentYear = new Date().getFullYear()
    const shortMatch = text.match(/^(\d{1,2})[.\-/月](\d{1,2})日?$/)
    const fullMatch = text.match(/^(\d{4})[.\-/年](\d{1,2})[.\-/月](\d{1,2})日?$/)
    const year = Number(fullMatch?.[1] || currentYear)
    const month = Number(fullMatch?.[2] || shortMatch?.[1])
    const day = Number(fullMatch?.[3] || shortMatch?.[2])
    const parsed = new Date(year, month - 1, day)
    if ((!shortMatch && !fullMatch)
      || parsed.getFullYear() !== year
      || parsed.getMonth() !== month - 1
      || parsed.getDate() !== day) {
      throw new Error(`日期格式无效：${text}。请填写 M.D（如 7.2）或 YYYY-M-D`)
    }
    return `${month}.${day}`
  }

  function fieldBase(key) {
    return compact(String(key || '').split('/').pop()).replace(/_\d+$/, '')
  }

  function matchingKeys(row, aliases) {
    const wanted = new Set(aliases.map(compact))
    return Object.keys(row || {}).filter(key => wanted.has(fieldBase(key)))
  }

  function codeFromValue(value, length) {
    let text = compact(value).replace(/^'+/, '').replace(/\.0+$/, '')
    if (/^\d+(?:\.\d+)?[eE][+-]?\d+$/.test(text)) {
      const number = Number(text)
      if (Number.isSafeInteger(number)) text = String(number)
    }
    const exact = text.match(new RegExp(`^\\d{${length}}$`))
    if (exact) return exact[0]
    const embedded = text.match(new RegExp(`(?:^|\\D)(\\d{${length}})(?:\\D|$)`))
    return embedded ? embedded[1] : ''
  }

  function rowCodes(row, aliases, length) {
    return unique(matchingKeys(row, aliases).map(key => codeFromValue(row[key], length)).filter(Boolean))
  }

  function duplicateCodeConflict(row, aliases, length, label) {
    for (const alias of aliases) {
      const keys = Object.keys(row || {}).filter(key => fieldBase(key) === alias)
      if (keys.length < 2) continue
      const values = unique(keys.map(key => codeFromValue(row[key], length)).filter(Boolean))
      if (values.length !== 1) {
        return `“${label}”同名列无法解析为唯一有效值：${values.join(' / ') || '均为空或格式无效'}`
      }
    }
    return ''
  }

  const PRODUCT_ALIASES = ['大货款号']
  const COLOR_ALIASES = ['大货款色号', '款色号', '款色编码', 'SKU编码', '商品编码']

  function resolveRequiredField(row, aliases, label) {
    const keys = matchingKeys(row, aliases)
    if (!keys.length) return { ok: false, error: `未找到“${label}”列` }
    const values = unique(keys.map(key => compact(row[key])).filter(Boolean))
    if (values.length !== 1) {
      return { ok: false, error: values.length ? `“${label}”同名列存在冲突值：${values.join(' / ')}` : `“${label}”为空` }
    }
    return {
      ok: true,
      value: values[0],
      note: keys.length > 1 ? `存在 ${keys.length} 个同名“${label}”列，采用唯一非空值“${values[0]}”` : '',
    }
  }

  function fieldGroup(key) {
    const parts = String(key || '').split('/')
    return parts.length > 1 ? worksheetHeaderName(parts.slice(0, -1).join('/')) : ''
  }

  function resolveBatchField(row) {
    const keys = matchingKeys(row, ['上市批次'])
    if (!keys.length) return { ok: false, error: '未找到“上市批次”列' }
    const seasonalKeys = keys.filter(key => fieldGroup(key).split('/').includes('正季上市'))
    const planningKeys = keys.filter(key => fieldGroup(key).split('/').includes('上市规划'))
    const groupedKeys = new Set([...seasonalKeys, ...planningKeys])
    const valuesFor = selectedKeys => unique(selectedKeys.map(key => compact(row[key])).filter(Boolean))
    const seasonalValues = valuesFor(seasonalKeys)
    if (seasonalValues.length > 1) {
      return { ok: false, error: `“正季上市/上市批次”存在冲突值：${seasonalValues.join(' / ')}` }
    }
    if (seasonalValues.length === 1) {
      const planningValues = valuesFor(planningKeys)
      const differentPlanning = planningValues.filter(value => value !== seasonalValues[0])
      return {
        ok: true,
        value: seasonalValues[0],
        note: differentPlanning.length
          ? `正季上市批次“${seasonalValues[0]}”优先于上市规划批次“${differentPlanning.join(' / ')}”`
          : '',
      }
    }
    const planningValues = valuesFor(planningKeys)
    if (planningValues.length > 1) {
      return { ok: false, error: `“上市规划/上市批次”存在冲突值：${planningValues.join(' / ')}` }
    }
    if (planningValues.length === 1) {
      return {
        ok: true,
        value: planningValues[0],
        note: seasonalKeys.length ? `正季上市批次为空，采用上市规划批次“${planningValues[0]}”` : '',
      }
    }
    const ungroupedKeys = keys.filter(key => !groupedKeys.has(key))
    if (ungroupedKeys.length) {
      const values = valuesFor(ungroupedKeys)
      if (values.length !== 1) {
        return { ok: false, error: values.length ? `“上市批次”同名列存在冲突值：${values.join(' / ')}` : '“上市批次”为空' }
      }
      return {
        ok: true,
        value: values[0],
        note: ungroupedKeys.length > 1 ? `存在 ${ungroupedKeys.length} 个同名“上市批次”列，采用唯一非空值“${values[0]}”` : '',
      }
    }
    return { ok: false, error: '“上市批次”为空' }
  }

  function batchDirectory(value) {
    const raw = compact(value)
    const text = raw.toUpperCase()
    const match = text.match(/^(\d{1,2})\s*(?:批|P)?$/i)
    if (match) {
      const number = Number(match[1])
      if (Number.isInteger(number) && number > 0) return `${number}P`
    }
    return raw
  }

  function workbookSheets(fileParam) {
    if (!fileParam || !compact(fileParam.path)) return {}
    if (fileParam.sheets && typeof fileParam.sheets === 'object') return fileParam.sheets
    const name = compact(fileParam.sheet_name) || 'Sheet1'
    return { [name]: { rows: Array.isArray(fileParam.rows) ? fileParam.rows : [] } }
  }

  function planRowSignature(row) {
    return ['上市批次', '产品线', '年龄段'].map(label => {
      const resolved = label === '上市批次'
        ? resolveBatchField(row)
        : resolveRequiredField(row, [label], label)
      return resolved.ok ? resolved.value : `!${resolved.error}`
    }).join('\u001f')
  }

  function choosePlanHit(plan, styleNo, colorNo, mappings) {
    const availableSheets = workbookSheets(plan.file)
    const effectiveMappings = mappings.length
      ? mappings
      : Object.keys(availableSheets).map(sheet => ({ sheet, directory: '' }))
    const missingSheets = effectiveMappings.map(item => item.sheet).filter(name => !availableSheets[name])
    if (missingSheets.length) {
      return { status: 'ambiguous', note: `${plan.label}缺少指定 Sheet：${missingSheets.join('、')}` }
    }

    const sheetHits = []
    for (const mapping of effectiveMappings) {
      const rows = Array.isArray(availableSheets[mapping.sheet]?.rows) ? availableSheets[mapping.sheet].rows : []
      const matches = rows.filter(row => rowCodes(row, PRODUCT_ALIASES, 12).includes(styleNo))
      if (!matches.length) continue
      const productConflict = matches.map(row => duplicateCodeConflict(row, PRODUCT_ALIASES, 12, '大货款号')).find(Boolean)
      if (productConflict) return { status: 'ambiguous', note: `${plan.label}/${mapping.sheet}${productConflict}` }
      const exactRows = colorNo ? matches.filter(row => rowCodes(row, COLOR_ALIASES, 17).includes(colorNo)) : []
      sheetHits.push({ mapping, matches, exactRows })
    }
    if (!sheetHits.length) return { status: 'none' }

    let selectedSheet = null
    if (sheetHits.length === 1) {
      selectedSheet = sheetHits[0]
    } else {
      const exactSheets = sheetHits.filter(hit => hit.exactRows.length)
      if (exactSheets.length === 1) selectedSheet = exactSheets[0]
      else {
        return {
          status: 'ambiguous',
          note: `${plan.label}在多个指定 Sheet 命中且无法唯一确定：${sheetHits.map(hit => hit.mapping.sheet).join('、')}`,
        }
      }
    }

    let row = null
    const notes = []
    const colorConflict = colorNo ? selectedSheet.matches
      .map(item => duplicateCodeConflict(item, COLOR_ALIASES, 17, '款色号'))
      .find(Boolean) : ''
    if (colorConflict) {
      return { status: 'ambiguous', note: `${plan.label}/${selectedSheet.mapping.sheet}${colorConflict}` }
    }
    if (!colorNo) {
      const signatures = unique(selectedSheet.matches.map(planRowSignature))
      if (signatures.length !== 1) {
        return { status: 'ambiguous', note: `${plan.label}/${selectedSheet.mapping.sheet}按12位款号命中多条记录，但上市批次、产品线或年龄段不一致` }
      }
      row = selectedSheet.matches[0]
      notes.push(`文件夹未识别到17位款色号，已按12位款号匹配${selectedSheet.matches.length}条计划记录`)
    } else if (selectedSheet.exactRows.length === 1) {
      row = selectedSheet.exactRows[0]
      if (selectedSheet.matches.length > 1) notes.push('同 Sheet 多记录，按17位款色号精确匹配')
    } else if (selectedSheet.exactRows.length > 1) {
      return { status: 'ambiguous', note: `${plan.label}/${selectedSheet.mapping.sheet}存在多条相同款色号记录` }
    } else if (selectedSheet.matches.length === 1) {
      row = selectedSheet.matches[0]
    } else {
      return { status: 'ambiguous', note: `${plan.label}/${selectedSheet.mapping.sheet}命中多条记录但无17位款色号精确匹配` }
    }

    const colorCodes = unique(selectedSheet.matches.flatMap(item => rowCodes(item, COLOR_ALIASES, 17)))
    if (!colorCodes.length) notes.push('计划表未识别到款色号列，同款款色号数量记为0')
    if (sheetHits.length > 1) notes.push(`多个 Sheet 命中，按17位款色号唯一命中 ${selectedSheet.mapping.sheet}`)
    return {
      status: 'hit',
      row,
      sheet: selectedSheet.mapping.sheet,
      sheetDirectory: selectedSheet.mapping.directory,
      colorCount: colorCodes.length,
      note: notes.join('；'),
    }
  }

  function selectFinalPlan(plan1Result, plan2Result, plans) {
    const plan2Matched = plan2Result && plan2Result.status !== 'none'
    if (plan1Result.status === 'ambiguous') return { status: 'ambiguous', note: plan1Result.note }
    if (plan1Result.status === 'hit') {
      const note = plan2Matched ? '两张计划表均命中，按查询计划表1优先' : ''
      return { status: 'hit', plan: plans[0], hit: plan1Result, note }
    }
    if (!plan2Result) return { status: 'none' }
    if (plan2Result.status === 'ambiguous') return { status: 'ambiguous', note: plan2Result.note }
    if (plan2Result.status === 'hit') return { status: 'hit', plan: plans[1], hit: plan2Result, note: '' }
    return { status: 'none' }
  }

  function targetPath(root, segments) {
    const clean = segments.map(compact)
    if (clean.some(value => !value)) throw new Error('目标路径存在空目录项')
    return `${root}/${clean.join('/')}`
  }

  function stillReviewRow(found, config, plans, mappings) {
    const colorCode = compact(found?.color_code)
    const styleNo = compact(found?.style_code || colorCode.slice(0, 12))
    const markerJpgName = compact(found?.marker_jpg_name || `${styleNo}-${colorCode.slice(-5)}.jpg`)
    const folders = Array.isArray(found?.folders) ? found.folders : []
    const files = Array.isArray(found?.files) ? found.files : []
    const candidateFolderCount = Number(found?.candidate_folder_count || 0)
    const matchedFolderCount = Number(found?.matched_folder_count || 0)
    const folderNames = folders.map(folder => compact(folder?.filename)).filter(Boolean)
    const sourcePaths = folders.map(folder => slashPath(folder?.fullpath)).filter(Boolean)
      .map(path => `${PHOTOGRAPHY_MOUNT_NAME}//${path}`)
    const notes = []
    const base = {
      '款色号': colorCode,
      '款号': styleNo,
      '对应JPG文件名': markerJpgName,
      '摄影文件夹名称': folderNames.join('\n'),
      '摄影源路径': sourcePaths.join('\n'),
      '候选摄影文件夹数': candidateFolderCount,
      '命中款色文件夹数': matchedFolderCount,
      '摄影文件夹数': folders.length,
      '文件数': files.length,
      '最终文件夹名': '',
      '命中计划表及对应目录': '',
      '命中Sheet及对应目录': '',
      '批次': '',
      '云盘目标路径': '',
      '状态': '需复核',
      '备注': '',
    }

    if (!candidateFolderCount) {
      base['备注'] = `摄影库未找到文件夹名前12位完全等于 ${styleNo} 的文件夹`
      return base
    }
    if (!matchedFolderCount) {
      base['备注'] = `找到 ${candidateFolderCount} 个候选摄影文件夹，但都未找到对应JPG：${markerJpgName}`
      return base
    }
    if (compact(found?.selection_error)) {
      base['备注'] = `${compact(found.selection_error)}；对应JPG：${markerJpgName}`
      return base
    }
    if (!folders.length) {
      base['备注'] = `已找到对应JPG ${markerJpgName}，但未能唯一选择摄影文件夹`
      return base
    }
    if (!files.length) {
      base['备注'] = '已找到摄影文件夹，但其中没有 JPG/JPEG/PNG/WEBP/PSD 文件'
      return base
    }
    if (compact(found?.selection_note)) notes.push(compact(found.selection_note))
    const sourceFolderName = folderNames[0] || sourcePaths[0]?.split('/').pop() || styleNo
    const namePrefix = config.keepSourceName ? sourceFolderName : styleNo
    base['最终文件夹名'] = `${namePrefix} ${config.renameContent}${config.dateText}`.trim()

    const p1 = choosePlanHit(plans[0], styleNo, '', mappings)
    const p2 = plans[1] ? choosePlanHit(plans[1], styleNo, '', mappings) : null
    const selected = selectFinalPlan(p1, p2, plans)
    if (selected.status !== 'hit') {
      notes.push(selected.status === 'none' ? '所有指定计划表和 Sheet 均未找到款号' : selected.note)
      base['备注'] = unique(notes.filter(Boolean)).join('；')
      return base
    }

    const hit = selected.hit
    const batch = resolveBatchField(hit.row)
    const product = resolveRequiredField(hit.row, ['产品线'], '产品线')
    const age = product.ok && product.value === '婴幼童'
      ? resolveRequiredField(hit.row, ['年龄段'], '年龄段')
      : { ok: true, value: '', note: '' }
    for (const item of [batch, product, age]) {
      if (item.note) notes.push(item.note)
    }
    const invalid = [batch, product, age].filter(item => !item.ok)
    base['命中计划表及对应目录'] = `${selected.plan.label}｜${selected.plan.directory}`
    base['命中Sheet及对应目录'] = `${hit.sheet}｜${hit.sheetDirectory}`
    if (invalid.length) {
      notes.push(...invalid.map(item => item.error))
      base['备注'] = unique([selected.note, hit.note, ...notes].filter(Boolean)).join('；')
      return base
    }

    const batchDir = batchDirectory(batch.value)
    if (!batchDir) {
      notes.push(`上市批次“${batch.value}”无法转换为P目录`)
      base['批次'] = batch.value
      base['备注'] = unique([selected.note, hit.note, ...notes].filter(Boolean)).join('；')
      return base
    }

    const lastDirectory = product.value === '婴幼童' ? age.value : product.value
    try {
      base['云盘目标路径'] = targetPath(config.cloudRoot, [
        selected.plan.directory,
        ...(config.customPathItem ? [config.customPathItem] : []),
        ...(hit.sheetDirectory ? [hit.sheetDirectory] : []),
        batchDir,
        lastDirectory,
        base['最终文件夹名'],
      ])
      base['批次'] = batch.value
      base['状态'] = '待审核'
    } catch (error) {
      notes.push(String(error?.message || error))
    }
    base['备注'] = unique([selected.note, hit.note, ...notes].filter(Boolean)).join('；')
    return base
  }

  try {
    if (compact(params.confirm_config) !== 'yes') {
      return { success: false, error: '尚未获得开始确认：请选择“已确认，可以开始”' }
    }
    const colorCodes = normalizeColorCodes(params.style_codes)
    const planFilesFolder = compact(params.plan_files_folder)
    const plan1Path = planPath(params.plan1, planFilesFolder, params.plan1_filename)
    const plan1Directory = compact(params.plan1_directory)
    const plan2Path = planPath(params.plan2, planFilesFolder, params.plan2_filename)
    const plan2Directory = compact(params.plan2_directory)
    const customPathItem = compact(params.custom_path_item)
    const keepSourceName = compact(params.keep_source_name || 'yes').toLowerCase() === 'yes'
    const renameContent = compact(params.rename_content)
    if (!plan1Path || !plan1Directory) {
      return { success: false, error: '配置不完整：款色号、计划表1及对应目录均为必填' }
    }
    if (plan2Path && !plan2Directory) return { success: false, error: '使用计划表2时必须填写计划表2对应目录' }
    if (!plan2Path && plan2Directory) return { success: false, error: '填写了计划表2对应目录，但没有选择计划表2' }

    if (phase === 'main') {
      if (!isSemirCloudPage()) {
        try {
          location.href = SEMIR_CLOUD_URL
        } catch (error) {
          return { success: false, error: `无法打开森马云盘登录页：${compact(error?.message || error)}` }
        }
      }
      return cloudNextPhase('cloud_wait_login', {
        ...shared,
        cloud_login_url: SEMIR_CLOUD_URL,
        cloud_login_wait_rounds: 0,
      })
    }
    if (phase === 'cloud_wait_login') {
      if (!await cloudLoginReady()) {
        return cloudNextPhase('cloud_wait_login', {
          ...shared,
          cloud_login_url: SEMIR_CLOUD_URL,
          cloud_login_wait_rounds: Number(shared.cloud_login_wait_rounds || 0) + 1,
        })
      }
      return cloudNextPhase('cloud_plan_start', {
        ...shared,
        cloud_login_ready: true,
      }, 0)
    }

    const mappings = parseMappings(params.sheet_mappings)
    const embeddedPlan1 = Boolean(params.plan1?.sheets)
    if (!embeddedPlan1 && phase === 'cloud_plan_start') {
      const paths = [{ key: 'plan1', path: plan1Path, label: '计划表1' }]
      if (plan2Path) paths.push({ key: 'plan2', path: plan2Path, label: '计划表2' })
      return fileChooserPhase(preparePlanFileInputs(paths))
    }
    if (!embeddedPlan1 && phase === 'load_plan1') {
      const file = document.querySelector(`#${PLAN_INPUTS.plan1}`)?.files?.[0]
      window.__AI_MOP_STILL_PLAN_FILES__ = {
        plan1: await readWorkbookSheets(file, mappings.map(item => item.sheet)),
      }
      return nextPhase(plan2Path ? 'load_plan2' : 'build_review')
    }
    if (!embeddedPlan1 && phase === 'load_plan2') {
      const file = document.querySelector(`#${PLAN_INPUTS.plan2}`)?.files?.[0]
      const cached = window.__AI_MOP_STILL_PLAN_FILES__ || {}
      cached.plan2 = await readWorkbookSheets(file, mappings.map(item => item.sheet))
      window.__AI_MOP_STILL_PLAN_FILES__ = cached
      return nextPhase('build_review')
    }

    const loadedPlans = embeddedPlan1
      ? { plan1: params.plan1, plan2: params.plan2 }
      : (window.__AI_MOP_STILL_PLAN_FILES__ || {})
    if (!loadedPlans.plan1) return { success: false, error: '计划表1尚未完成读取，请重新执行任务' }
    if (plan2Path && !loadedPlans.plan2) return { success: false, error: '计划表2尚未完成读取，请重新执行任务' }

    if (phase !== 'cloud_source_ready') {
      return cloudSourceEval(buildPhotographySearchExpression(colorCodes))
    }

    const evaluated = shared.cloud_source_scan
    if (!evaluated?.ok) return { success: false, error: `读取摄影库失败：${compact(evaluated?.error || '未收到跨标签页执行结果')}` }
    const scan = evaluated.value
    if (!scan?.ok) return { success: false, error: `读取摄影库失败：${compact(scan?.error || '未知错误')}` }
    if (compact(scan.mount_name) !== PHOTOGRAPHY_MOUNT_NAME) {
      return { success: false, error: `搜索范围错误：期望“${PHOTOGRAPHY_MOUNT_NAME}”库，实际为“${compact(scan.mount_name)}”` }
    }

    const resultMap = new Map((Array.isArray(scan.results) ? scan.results : [])
      .map(item => [compact(item?.color_code), item]))
    const cloudRoot = normalizeCloudRoot(params.cloud_root)
    const plans = [{
      file: loadedPlans.plan1,
      label: `查询计划表1（${basename(plan1Path)}）`,
      directory: plan1Directory,
    }]
    if (plan2Path) plans.push({
      file: loadedPlans.plan2,
      label: `查询计划表2（${basename(plan2Path)}）`,
      directory: plan2Directory,
    })
    const config = {
      cloudRoot,
      customPathItem,
      keepSourceName,
      renameContent,
      dateText: formatRunDate(params.run_date),
    }
    const rows = colorCodes.map(colorCode => stillReviewRow(
      resultMap.get(colorCode) || {
        color_code: colorCode,
        style_code: colorCode.slice(0, 12),
        marker_jpg_name: `${colorCode.slice(0, 12)}-${colorCode.slice(-5)}.jpg`,
        candidate_folder_count: 0,
        matched_folder_count: 0,
        folders: [],
        files: [],
      },
      config,
      plans,
      mappings,
    ))
    if (!embeddedPlan1) delete window.__AI_MOP_STILL_PLAN_FILES__
    const reviewNeeded = rows.filter(row => row['状态'] === '需复核').length
    return {
      success: true,
      data: rows,
      meta: {
        action: 'complete',
        has_more: false,
        shared: {
          total_rows: rows.length,
          matched_colors: rows.filter(row => Number(row['摄影文件夹数']) > 0).length,
          source_folder_count: rows.reduce((total, row) => total + Number(row['摄影文件夹数'] || 0), 0),
          review_needed: reviewNeeded,
          ready_for_review: rows.length - reviewNeeded,
          confirmed_cloud_root: cloudRoot,
          source_mount_name: PHOTOGRAPHY_MOUNT_NAME,
        },
      },
    }
  } catch (error) {
    return { success: false, error: String(error?.message || error) }
  }
})()
