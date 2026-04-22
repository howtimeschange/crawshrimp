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
  const DEFAULT_PROVIDER_READY_TIMEOUT_MS = 5 * 60 * 1000
  const DEFAULT_GENERATE_TIMEOUT_MS = 4 * 60 * 1000
  const DEFAULT_PROVIDER_POLL_MS = 2500
  const DEFAULT_SUBMIT_WAIT_MS = 1000
  const MIN_COMPLETION_WAIT_MS = 5000
  const BUSY_TEXT_PATTERN = /(停止生成|停止回答|取消生成|生成中|创作中|处理中|排队中|正在生成|正在创作|处理中)/i

  const PROVIDERS = Object.freeze({
    doubao: Object.freeze({
      key: 'doubao',
      name: '豆包',
      entryUrl: 'https://www.doubao.com/chat/create-image',
    }),
    gemini: Object.freeze({
      key: 'gemini',
      name: 'Gemini',
      entryUrl: 'https://gemini.google.com/app',
    }),
  })

  const COMBINED_CODE_ALIASES = [
    '款号/款色号',
    '款号/款色编码',
    '款号或款色号',
    '款号或款色编码',
    '货号/款色号',
    '货号/款色编码',
    '编码',
  ]
  const SPU_ALIASES = ['款号', '货号', 'spu']
  const SKC_ALIASES = ['款色号', '款色编码', '颜色编码', 'skc']
  const PROMPT_ALIASES = [
    'prompt',
    '提示词',
    '文生图prompt',
    '文生图提示词',
    '生图prompt',
    '生图提示词',
    'ai prompt',
    'aiprompt',
    '描述',
  ]

  function compact(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function normalizeHeaderKey(value) {
    return compact(value)
      .toLowerCase()
      .replace(/[\s_./\\\-：:（）()]+/g, '')
  }

  function getRowEntries(row) {
    if (!row || typeof row !== 'object') return []
    return Object.entries(row)
      .map(([key, value]) => ({
        rawKey: String(key || ''),
        normalizedKey: normalizeHeaderKey(key),
        value: compact(value),
      }))
      .filter(entry => entry.rawKey)
  }

  function findRowValue(row, aliases) {
    const aliasSet = new Set((Array.isArray(aliases) ? aliases : []).map(normalizeHeaderKey))
    return getRowEntries(row).find(entry => aliasSet.has(entry.normalizedKey) && entry.value) || null
  }

  function toSafeFilename(value, fallback = 'file') {
    const text = String(value || '')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, ' ')
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
    const matched = (Array.isArray(items) ? items : [])
      .filter(item => !isDirectoryItem(item))
      .filter(isImageItem)
      .filter(item => isWithinRelativePath(item?.fullpath, relativePath))
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

  function injectFiles(items, nextPhaseName, options = {}, newShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: {
        action: 'inject_files',
        items,
        next_phase: nextPhaseName,
        sleep_ms: Number(options.sleep_ms || 0),
        shared: newShared,
      },
    }
  }

  function cdpClicks(clicks, nextPhaseName, options = {}, newShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: {
        action: 'cdp_clicks',
        clicks,
        next_phase: nextPhaseName,
        sleep_ms: Number(options.sleep_ms || 0),
        shared: newShared,
      },
    }
  }

  function downloadClicks(items, nextPhaseName, options = {}, newShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: {
        action: 'download_clicks',
        items,
        shared_key: options.shared_key || 'downloadClickResults',
        shared_append: !!options.shared_append,
        strict: !!options.strict,
        next_phase: nextPhaseName,
        sleep_ms: Number(options.sleep_ms || 0),
        shared: newShared,
      },
    }
  }

  function fileChooserUpload(items, nextPhaseName, options = {}, newShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: {
        action: 'file_chooser_upload',
        items,
        shared_key: options.shared_key || 'file_chooser_uploads',
        shared_append: !!options.shared_append,
        strict: !!options.strict,
        next_phase: nextPhaseName,
        sleep_ms: Number(options.sleep_ms || 0),
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
      const total = Number(payload?.total || 0)
      all.push(...items)
      if (!items.length) break
      start += items.length
      if (start >= total) break
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

  function normalizeCodeCandidate(rawCode, rawSpu, rawSkc) {
    const combined = compact(rawCode)
    if (combined) return combined

    const spu = compact(rawSpu)
    const skc = compact(rawSkc)
    if (!spu && !skc) return ''
    if (!skc) return spu
    if (/^\d{5}$/.test(skc) && /^\d{6,}$/.test(spu)) return `${spu}-${skc}`
    if (/^\d{6,}-\d{5}$/.test(skc)) return skc
    return skc || spu
  }

  function resolvePromptValue(row) {
    const direct = findRowValue(row, PROMPT_ALIASES)
    return direct ? direct.value : ''
  }

  function collectMetadataEntries(row, usedKeys = []) {
    const used = new Set((Array.isArray(usedKeys) ? usedKeys : []).map(key => String(key || '')))
    return getRowEntries(row)
      .filter(entry => entry.value)
      .filter(entry => !used.has(entry.rawKey))
      .map(entry => ({
        key: entry.rawKey,
        value: entry.value,
      }))
  }

  function buildPromptText(basePrompt, metadataEntries) {
    const cleanPrompt = compact(basePrompt)
    const details = (Array.isArray(metadataEntries) ? metadataEntries : [])
      .filter(item => compact(item?.key) && compact(item?.value))
      .map(item => `${compact(item.key)}=${compact(item.value)}`)
      .join('；')

    if (!cleanPrompt && !details) return ''
    if (!details) return cleanPrompt
    if (!cleanPrompt) return `商品属性：${details}`
    return `${cleanPrompt}\n\n商品属性：${details}`
  }

  function normalizeAiJobs(rows, providerName) {
    const jobs = []
    const invalidRows = []

    for (let index = 0; index < (Array.isArray(rows) ? rows.length : 0); index += 1) {
      const row = rows[index] || {}
      const rowNo = index + 2
      const combinedCode = findRowValue(row, COMBINED_CODE_ALIASES)
      const spu = findRowValue(row, SPU_ALIASES)
      const skc = findRowValue(row, SKC_ALIASES)
      const prompt = findRowValue(row, PROMPT_ALIASES)

      const inputCode = normalizeCodeCandidate(combinedCode?.value, spu?.value, skc?.value)
      const metadataEntries = collectMetadataEntries(
        row,
        [combinedCode?.rawKey, spu?.rawKey, skc?.rawKey, prompt?.rawKey].filter(Boolean),
      )
      const promptBase = prompt?.value || resolvePromptValue(row)
      const promptFinal = buildPromptText(promptBase, metadataEntries)
      const metadataText = metadataEntries.map(item => `${item.key}=${item.value}`).join('；')

      if (!inputCode || !promptBase) {
        invalidRows.push({
          '表格行号': rowNo,
          '输入编码': inputCode,
          '匹配类型': inputCode ? (classifyCode(inputCode) === 'skc' ? '款色编码' : '款号') : '',
          'AI站点': providerName,
          '原始Prompt': promptBase,
          '最终Prompt': promptFinal,
          '商品属性': metadataText,
          '素材图数量': 0,
          '素材图文件': '',
          '素材云盘路径': '',
          '执行结果': '参数缺失',
          '备注': !inputCode ? '缺少款号/款色号' : '缺少 Prompt',
        })
        continue
      }

      jobs.push({
        row_no: rowNo,
        input_code: inputCode,
        code_type: classifyCode(inputCode),
        prompt_base: promptBase,
        prompt_final: promptFinal,
        metadata_text: metadataText,
      })
    }

    return { jobs, invalidRows }
  }

  function uniqueCodesFromJobs(jobs) {
    const deduped = []
    const seen = new Set()
    for (const job of Array.isArray(jobs) ? jobs : []) {
      const key = compact(job?.input_code)
      if (!key || seen.has(key)) continue
      seen.add(key)
      deduped.push(key)
    }
    return deduped
  }

  function findFirstJobRowNoByCode(jobs, code) {
    const target = compact(code)
    const matched = (Array.isArray(jobs) ? jobs : []).find(item => compact(item?.input_code) === target)
    return Number(matched?.row_no || 0)
  }

  function resolveProviderConfig(rawProvider) {
    const key = String(rawProvider || 'doubao').trim().toLowerCase()
    const fallback = PROVIDERS[key] || PROVIDERS.doubao
    return {
      providerKey: fallback.key,
      providerName: fallback.name,
      entryUrl: fallback.entryUrl,
    }
  }

  async function buildCodePlan(inputCode, mountId, relativePath, options = {}) {
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
        '下载结果': '未匹配到素材图',
        '本地文件': '',
        '备注': `搜索结果 ${searchItems.length} 条，过滤后 0 条`,
      })
      return { rows, downloadItems }
    }

    for (let index = 0; index < matchedItems.length; index += 1) {
      const item = matchedItems[index]
      const baseRow = {
        '输入编码': inputCode,
        '匹配类型': codeType === 'skc' ? '款色编码' : '款号',
        '文件名': String(item?.filename || ''),
        '云盘路径': String(item?.fullpath || ''),
        '下载结果': '',
        '本地文件': '',
        '备注': '',
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

        const runtimeFilename = buildRuntimeFilename(inputCode, item, index)
        rows.push({
          ...baseRow,
          '__runtime_filename': runtimeFilename,
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

  function buildSourceMap(materialRows) {
    const sourceMap = Object.create(null)

    for (const row of Array.isArray(materialRows) ? materialRows : []) {
      if (!row || typeof row !== 'object') continue
      if (compact(row['下载结果']) !== '已下载') continue
      const inputCode = compact(row['输入编码'])
      const localPath = compact(row['本地文件'])
      if (!inputCode || !localPath) continue

      if (!sourceMap[inputCode]) {
        sourceMap[inputCode] = {
          count: 0,
          items: [],
        }
      }

      sourceMap[inputCode].items.push({
        filename: compact(row['文件名']),
        cloud_path: compact(row['云盘路径']),
        local_path: localPath,
      })
      sourceMap[inputCode].count += 1
    }

    return sourceMap
  }

  function cloneSourceItem(sourceItem) {
    return {
      filename: compact(sourceItem?.filename),
      cloud_path: compact(sourceItem?.cloud_path),
      local_path: compact(sourceItem?.local_path),
    }
  }

  function buildExecutionQueue(jobs, sourceMap, providerName) {
    const execJobs = []
    const resultRows = []

    for (const job of Array.isArray(jobs) ? jobs : []) {
      const sourceItems = Array.isArray(sourceMap?.[job.input_code]?.items) ? sourceMap[job.input_code].items : []

      if (!sourceItems.length) {
        resultRows.push({
          '表格行号': Number(job.row_no || 0),
          '输入编码': job.input_code,
          '匹配类型': job.code_type === 'skc' ? '款色编码' : '款号',
          'AI站点': providerName,
          '原始Prompt': job.prompt_base,
          '最终Prompt': job.prompt_final,
          '商品属性': job.metadata_text,
          '素材图数量': 0,
          '素材图文件': '',
          '素材云盘路径': '',
          '生图文件数量': 0,
          '生图文件': '',
          '执行结果': '未匹配到素材图',
          '备注': '森马云盘未匹配到可用素材图',
          '__素材明细': [],
        })
        continue
      }

      for (let index = 0; index < sourceItems.length; index += 1) {
        const sourceDetail = cloneSourceItem(sourceItems[index])
        execJobs.push({
          ...job,
          source_item: sourceDetail,
          source_index: index + 1,
        })
        resultRows.push({
          '表格行号': Number(job.row_no || 0),
          '输入编码': job.input_code,
          '匹配类型': job.code_type === 'skc' ? '款色编码' : '款号',
          'AI站点': providerName,
          '原始Prompt': job.prompt_base,
          '最终Prompt': job.prompt_final,
          '商品属性': job.metadata_text,
          '素材图数量': 1,
          '素材图文件': sourceDetail.filename,
          '素材云盘路径': sourceDetail.cloud_path,
          '生图文件数量': 0,
          '生图文件': '',
          '执行结果': '待执行',
          '备注': '',
          '__素材明细': [sourceDetail],
        })
      }
    }

    return {
      execJobs,
      resultRows,
    }
  }

  function isVisible(element) {
    return !!element && !!(element.offsetWidth || element.offsetHeight || element.getClientRects?.().length)
  }

  function textOf(element) {
    return String(element?.textContent || '').replace(/\s+/g, ' ').trim()
  }

  function elementCenter(element) {
    if (!isVisible(element)) return null
    const rect = element.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return null
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      delay_ms: 120,
    }
  }

  function findVisibleElement(selectors, matcher) {
    const elements = typeof selectors === 'string'
      ? [...document.querySelectorAll(selectors)]
      : Array.isArray(selectors)
        ? selectors
        : []
    for (const element of elements) {
      if (!isVisible(element)) continue
      if (!matcher || matcher(element)) return element
    }
    return null
  }

  function hasBusyIndicators() {
    const candidates = [
      ...document.querySelectorAll('button, [role="button"], [role="status"], [aria-live], [class*="loading"], [class*="status"]'),
    ]
    return candidates.some(element => {
      if (!isVisible(element)) return false
      const payload = `${textOf(element)} ${element.getAttribute?.('aria-label') || ''}`
      return BUSY_TEXT_PATTERN.test(payload)
    })
  }

  function countVisibleLargeImages(minSize = 160) {
    return [...document.querySelectorAll('img')]
      .filter(isVisible)
      .filter(element => {
        const rect = element.getBoundingClientRect()
        return rect.width >= minSize && rect.height >= minSize
      })
      .filter(element => !element.closest('nav, aside'))
      .length
  }

  function countVisibleGeneratedResultImages(minSize = 120) {
    return [...document.querySelectorAll('img')]
      .filter(isVisible)
      .filter(element => {
        const rect = element.getBoundingClientRect()
        if (rect.width < minSize || rect.height < minSize) return false
        const src = String(element.currentSrc || element.getAttribute('src') || '').trim()
        return /rc_gen_image|flow-imagex-sign|byteimg|imagex/i.test(src)
      })
      .length
  }

  function countVisibleButtonsByExactText(label) {
    const expected = compact(label)
    if (!expected) return 0
    return [...document.querySelectorAll('button, [role="button"]')]
      .filter(isVisible)
      .filter(element => textOf(element) === expected)
      .length
  }

  function isDoubaoGenerationReady(state) {
    const generatedImageCount = Number(state?.generatedImageCount || 0)
    const saveButtonCount = Number(state?.saveButtonCount || 0)
    const onResultPage = !!(state?.resultPage || state?.urlChangedAfterSubmit)
    return saveButtonCount > 0 || (onResultPage && generatedImageCount > 0)
  }

  function setEditorPlainText(editor, text) {
    if (!editor) return false
    const value = String(text || '')
    try {
      editor.focus()
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
      try {
        document.execCommand('selectAll', false, null)
      } catch {}
      try {
        document.execCommand('delete', false, null)
      } catch {}
      const inserted = document.execCommand('insertText', false, value)
      editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: value }))
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
      editor.dispatchEvent(new Event('change', { bubbles: true }))
      return inserted !== false || textOf(editor).includes(value.split('\n')[0] || value)
    } catch (error) {
      console.warn('setEditorPlainText failed', error)
      return false
    }
  }

  function dispatchPointerSequenceClick(element) {
    if (!element || !isVisible(element)) return false
    try {
      const rect = element.getBoundingClientRect()
      const clientX = rect.left + Math.min(Math.max(rect.width / 2, 8), Math.max(rect.width - 8, 8))
      const clientY = rect.top + Math.min(Math.max(rect.height / 2, 8), Math.max(rect.height - 8, 8))
      const pointerInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        buttons: 1,
        clientX,
        clientY,
      }
      const mouseInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
        buttons: 1,
        clientX,
        clientY,
      }

      element.focus?.()
      try {
        element.dispatchEvent(new PointerEvent('pointerdown', pointerInit))
      } catch {}
      try {
        element.dispatchEvent(new MouseEvent('mousedown', mouseInit))
      } catch {}
      try {
        element.dispatchEvent(new PointerEvent('pointerup', { ...pointerInit, buttons: 0 }))
      } catch {}
      try {
        element.dispatchEvent(new MouseEvent('mouseup', { ...mouseInit, buttons: 0 }))
      } catch {}
      try {
        element.dispatchEvent(new MouseEvent('click', { ...mouseInit, buttons: 0 }))
      } catch {}
      try {
        element.click?.()
      } catch {}
      return true
    } catch (error) {
      console.warn('dispatchPointerSequenceClick failed', error)
      return false
    }
  }

  function findGeminiConsentDialog() {
    const containers = [
      ...document.querySelectorAll('[role="dialog"], mat-dialog-container, .mat-mdc-dialog-surface, .cdk-overlay-pane'),
    ]
    return containers.find(element => isVisible(element) && /根据图片和文件生成内容/.test(textOf(element))) || null
  }

  function acceptGeminiConsentIfPresent() {
    const dialog = findGeminiConsentDialog()
    if (!dialog) return false
    const agreeButton = [...dialog.querySelectorAll('button, [role="button"]')]
      .find(element => isVisible(element) && /^同意$/.test(textOf(element)))
    if (!agreeButton) return false
    return dispatchPointerSequenceClick(agreeButton)
  }

  function openGeminiUploadMenu() {
    const uploadMenuButton = [...document.querySelectorAll('button')]
      .find(element => isVisible(element) && /打开文件上传菜单/.test(element.getAttribute('aria-label') || ''))
    if (!uploadMenuButton) return false
    return dispatchPointerSequenceClick(uploadMenuButton)
  }

  function clickGeminiSendButton() {
    const sendButton = [...document.querySelectorAll('button, [role="button"]')]
      .find(element => isVisible(element) && /发送/.test(element.getAttribute('aria-label') || ''))
    if (!sendButton) return false
    return dispatchPointerSequenceClick(sendButton)
  }

  function hasGeminiUploadedReferencePreview() {
    const previewButton = [...document.querySelectorAll('button, [role="button"]')]
      .find(element => {
        if (!isVisible(element)) return false
        const payload = `${textOf(element)} ${element.getAttribute('aria-label') || ''}`
        return /以灯箱形式显示上传的图片|显示上传的图片|已上传图片|uploaded image/i.test(payload)
      })
    if (previewButton) return true

    return [...document.querySelectorAll('img')]
      .some(element => {
        if (!isVisible(element)) return false
        const src = String(element.getAttribute('src') || '').trim()
        if (!src || /^https:\/\/www\.gstatic\.com\/bard-robin-zs\/media_gen_templates\//.test(src)) return false
        const rect = element.getBoundingClientRect()
        return rect.width >= 48 && rect.height >= 48
      })
  }

  function basename(filePath) {
    return String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || ''
  }

  function guessFileExt(filenameOrUrl, fallback = 'png') {
    const raw = String(filenameOrUrl || '')
    const match = raw.match(/\.([a-zA-Z0-9]{2,5})(?:$|[?&#~])/)
    if (!match) return fallback
    return String(match[1] || fallback).toLowerCase()
  }

  function buildGeneratedFilename(providerKey, inputCode, index, sample = '') {
    const ext = guessFileExt(sample, providerKey === 'doubao' ? 'jpg' : 'png')
    return `${toSafeFilename(providerKey || 'ai', 'ai')}__${toSafeFilename(inputCode || 'item', 'item')}__${index + 1}.${ext}`
  }

  function readDoubaoGeneratedDownloadPlans(sharedState) {
    const job = getCurrentJob(sharedState)
    if (!job) return []

    const networkImages = [...document.querySelectorAll('img')]
      .filter(isVisible)
      .map(element => String(element.currentSrc || element.getAttribute('src') || '').trim())
      .filter(src => /^https?:\/\//i.test(src) && /rc_gen_image|flow-imagex-sign|byteimg|imagex/i.test(src))
    const imageSamples = [...new Set(networkImages)]

    return [...document.querySelectorAll('button')]
      .filter(element => isVisible(element) && /^保存$/.test(textOf(element)))
      .map((element, index) => ({
        clicks: [elementCenter(element)].filter(Boolean),
        filename: buildGeneratedFilename(sharedState.provider_key, job.input_code, index, imageSamples[index] || imageSamples[0] || ''),
        label: `${sharedState.provider_name || 'Doubao'} / ${job.input_code} / ${index + 1}`,
        expected_name_regex: '.+\\.(png|jpe?g|webp)$',
      }))
      .filter(item => item.clicks.length)
  }

  function readDoubaoGeneratedPreviewCenter() {
    const candidates = [...document.querySelectorAll('img')]
      .filter(isVisible)
      .map(element => {
        const rect = element.getBoundingClientRect()
        const src = String(element.currentSrc || element.getAttribute('src') || '').trim()
        return {
          center: elementCenter(element),
          area: rect.width * rect.height,
          src,
        }
      })
      .filter(item => item.center)
      .filter(item => /rc_gen_image|flow-imagex-sign|byteimg|imagex/i.test(item.src))
      .sort((left, right) => (right.area || 0) - (left.area || 0))

    return candidates[0]?.center || null
  }

  function readGeminiGeneratedDownloadPlans(sharedState) {
    const job = getCurrentJob(sharedState)
    if (!job) return []

    return [...document.querySelectorAll('button, [role="button"]')]
      .filter(element => isVisible(element) && /下载完整尺寸的图片/.test(element.getAttribute('aria-label') || ''))
      .map((element, index) => ({
        clicks: [elementCenter(element)].filter(Boolean),
        filename: buildGeneratedFilename(sharedState.provider_key, job.input_code, index, 'png'),
        label: `${sharedState.provider_name || 'Gemini'} / ${job.input_code} / ${index + 1}`,
        expected_name_regex: '.+\\.(png|jpe?g|webp)$',
      }))
      .filter(item => item.clicks.length)
  }

  function buildGeneratedDownloadPatch(downloadResult) {
    const items = Array.isArray(downloadResult?.items) ? downloadResult.items : []
    const successful = items.filter(item => item?.success && compact(item?.path))
    const failed = items.filter(item => !item?.success)
    const noteParts = []

    if (items.length && !successful.length) {
      noteParts.push('结果图下载失败')
    } else if (failed.length) {
      noteParts.push(`结果图下载 ${successful.length}/${items.length} 成功`)
    }

    if (failed.length) {
      const firstError = compact(failed[0]?.error)
      if (firstError) {
        noteParts.push(firstError)
      }
    }

    return {
      '生图文件数量': successful.length,
      '生图文件': successful.map(item => compact(item.filename) || basename(item.path)).filter(Boolean).join('\n'),
      '__生成图明细': successful.map(item => ({
        filename: compact(item.filename) || basename(item.path),
        local_path: compact(item.path),
      })),
      '备注': noteParts.join('；'),
    }
  }

  function readDoubaoState() {
    const editor = document.querySelector('[role="textbox"][contenteditable="true"]')
    const uploadInput = [...document.querySelectorAll('input[type="file"]')].find(element => element.multiple) || null
    const sendButton = document.querySelector('#flow-end-msg-send')
    const createImagePath = location.pathname === '/chat/create-image'
    const resultPage = /^\/chat\/(?!create-image)[^/]+/.test(location.pathname || '')

    return {
      ready: createImagePath && !!editor && !!uploadInput,
      createImagePath,
      resultPage,
      uploadSelector: 'input[type="file"][multiple]',
      sendCenter: elementCenter(sendButton),
      busy: hasBusyIndicators(),
      urlChangedAfterSubmit: resultPage,
      generatedImageCount: countVisibleGeneratedResultImages(),
      saveButtonCount: countVisibleButtonsByExactText('保存'),
      largeImageCount: countVisibleLargeImages(),
    }
  }

  function readGeminiState() {
    const allButtons = [...document.querySelectorAll('button, [role="button"], [role="menuitem"]')]
    const visibleButtons = allButtons.filter(isVisible)
    const editor = document.querySelector('[role="textbox"][contenteditable="true"]')
    const uploadMenuButton = visibleButtons.find(element => /打开文件上传菜单/.test(element.getAttribute('aria-label') || '')) || null
    const uploadFileMenuItem = visibleButtons.find(element => /^上传文件$/.test(textOf(element))) || null
    const newChatButton = visibleButtons.find(element => /发起新对话/.test(element.getAttribute('aria-label') || '')) || null
    const imageToolButton = visibleButtons.find(element => {
      const payload = `${textOf(element)} ${element.getAttribute('aria-label') || ''}`
      return /制作图片/.test(payload)
    }) || null
    const sendButton = visibleButtons.find(element => /发送/.test(element.getAttribute('aria-label') || '')) || null
    const imageToolActive = /取消选择.?制作图片/.test(imageToolButton?.getAttribute?.('aria-label') || '')
    const consentDialog = findGeminiConsentDialog()
    const sendDisabled = !!sendButton && (
      !!sendButton.disabled ||
      /^true$/i.test(sendButton.getAttribute?.('aria-disabled') || '') ||
      getComputedStyle(sendButton).pointerEvents === 'none' ||
      Number(getComputedStyle(sendButton).opacity || 1) < 0.5
    )

    return {
      ready: !!editor && !!uploadMenuButton,
      imageToolActive,
      imageToolCenter: elementCenter(imageToolButton),
      newChatCenter: elementCenter(newChatButton),
      uploadMenuCenter: elementCenter(uploadMenuButton),
      uploadFileMenuItemCenter: elementCenter(uploadFileMenuItem),
      sendCenter: elementCenter(sendButton),
      sendReady: !!sendButton && !sendDisabled,
      uploadReady: hasGeminiUploadedReferencePreview(),
      consentVisible: !!consentDialog,
      largeImageCount: countVisibleLargeImages(),
      busy: hasBusyIndicators(),
    }
  }

  function getCurrentJob(sharedState) {
    const jobs = Array.isArray(sharedState.jobs) ? sharedState.jobs : []
    const jobIndex = Number(sharedState.job_index || 0)
    return jobs[jobIndex] || null
  }

  function getCurrentJobSourceItems(sharedState) {
    const job = getCurrentJob(sharedState)
    if (!job) return []
    if (job.source_item) return [job.source_item]
    const sourceItems = sharedState.source_map?.[job.input_code]?.items
    return Array.isArray(sourceItems) ? sourceItems : []
  }

  function completeWithCurrentRows(sharedState) {
    const invalidRows = Array.isArray(sharedState.invalid_rows) ? sharedState.invalid_rows : []
    const resultRows = Array.isArray(sharedState.result_rows) ? sharedState.result_rows : []
    return complete([...invalidRows, ...resultRows], sharedState)
  }

  function finishCurrentJob(sharedState, patch = {}) {
    const jobs = Array.isArray(sharedState.jobs) ? sharedState.jobs : []
    const resultRows = Array.isArray(sharedState.result_rows) ? sharedState.result_rows.slice() : []
    const jobIndex = Number(sharedState.job_index || 0)
    const job = jobs[jobIndex]

    if (job && resultRows[jobIndex]) {
      resultRows[jobIndex] = {
        ...resultRows[jobIndex],
        ...patch,
      }
    }

    const nextIndex = jobIndex + 1
    if (!jobs[nextIndex]) {
      return complete(
        [...(Array.isArray(sharedState.invalid_rows) ? sharedState.invalid_rows : []), ...resultRows],
        {
          ...sharedState,
          result_rows: resultRows,
          generation_completed_jobs: jobs.length,
          current_source_filename: '',
        },
      )
    }

    const nextJob = jobs[nextIndex]
    return nextPhase('ai_plan_job', 0, {
      ...sharedState,
      result_rows: resultRows,
      job_index: nextIndex,
      generation_completed_jobs: nextIndex,
      current_exec_no: nextIndex + 1,
      current_buyer_id: nextJob.input_code,
      current_row_no: Number(nextJob.row_no || 0),
      current_store: sharedState.provider_name || '',
      current_source_filename: compact(nextJob.source_item?.filename),
      generation_submitted_at: 0,
      generation_baseline_images: 0,
      job_wait_started_at: 0,
    })
  }

  function exposeHelpers() {
    if (!testExports || typeof testExports !== 'object') return
    Object.assign(testExports, {
      parseCloudPath,
      classifyCode,
      normalizeDuplicateMode,
      buildFolderHashRoute,
      buildSearchHashRoute,
      matchesCode,
      filterSearchResults,
      normalizeAiJobs,
      resolveProviderConfig,
      buildPromptText,
      finalizeCodeRows,
      buildSourceMap,
      buildExecutionQueue,
      isDoubaoGenerationReady,
    })
  }

  exposeHelpers()

  if (phase === '__exports__') {
    return complete([], shared)
  }

  try {
    if (phase === 'init' || phase === 'main') {
      const cloudConfig = parseCloudPath(params.cloud_path)
      const provider = resolveProviderConfig(params.ai_provider)
      const parsedJobs = normalizeAiJobs(params?.input_file?.rows || [], provider.providerName)

      if (!parsedJobs.jobs.length && parsedJobs.invalidRows.length) {
        return complete(parsedJobs.invalidRows, {
          provider_key: provider.providerKey,
          provider_name: provider.providerName,
          provider_entry_url: provider.entryUrl,
        })
      }
      if (!parsedJobs.jobs.length) throw new Error('Excel 中没有可执行的生图行，请检查编码和 Prompt 列')

      const duplicateMode = normalizeDuplicateMode(params.duplicate_mode)
      const providerReadyTimeoutMs = Math.max(30, Number(params.provider_ready_timeout_seconds || 300)) * 1000
      const generateTimeoutMs = Math.max(60, Number(params.generate_timeout_seconds || 240)) * 1000
      const mount = await resolveMountId(cloudConfig.mountName)
      const uniqueCodes = uniqueCodesFromJobs(parsedJobs.jobs)

      return nextPhase('semir_plan_code', 0, {
        mount_id: mount.mountId,
        mount_name: mount.mountName,
        cloud_path: cloudConfig.raw,
        relative_path: cloudConfig.relativePath,
        folder_hash: buildFolderHashRoute(mount.mountId, cloudConfig.relativePath),
        duplicate_mode: duplicateMode,
        jobs: parsedJobs.jobs,
        invalid_rows: parsedJobs.invalidRows,
        unique_codes: uniqueCodes,
        code_index: 0,
        material_rows: [],
        pending_download_items: [],
        result_rows: [],
        source_map: {},
        provider_key: provider.providerKey,
        provider_name: provider.providerName,
        provider_entry_url: provider.entryUrl,
        provider_ready_timeout_ms: providerReadyTimeoutMs || DEFAULT_PROVIDER_READY_TIMEOUT_MS,
        generate_timeout_ms: generateTimeoutMs || DEFAULT_GENERATE_TIMEOUT_MS,
        total_rows: parsedJobs.jobs.length,
        search_total_codes: uniqueCodes.length,
        search_completed_codes: 0,
        generation_total_jobs: 0,
        generation_completed_jobs: 0,
        current_source_filename: '',
        current_exec_no: 1,
        current_buyer_id: uniqueCodes[0] || parsedJobs.jobs[0]?.input_code || '',
        current_row_no: findFirstJobRowNoByCode(parsedJobs.jobs, uniqueCodes[0] || parsedJobs.jobs[0]?.input_code || ''),
        current_store: cloudConfig.relativePath || mount.mountName,
      })
    }

    if (phase === 'semir_plan_code') {
      const codes = Array.isArray(shared.unique_codes) ? shared.unique_codes : []
      const codeIndex = Number(shared.code_index || 0)
      const currentCode = String(codes[codeIndex] || '')

      if (!currentCode) {
        return nextPhase('build_job_queue', 0, shared)
      }

      return nextPhase('semir_ensure_search', 0, {
        ...shared,
        current_code: currentCode,
        current_exec_no: Math.max(1, codeIndex + 1),
        current_buyer_id: currentCode,
        current_row_no: findFirstJobRowNoByCode(shared.jobs, currentCode),
      })
    }

    if (phase === 'semir_ensure_search') {
      const currentCode = String(shared.current_code || '')
      if (!currentCode) {
        return nextPhase('semir_plan_code', 0, shared)
      }

      const targetHash = buildSearchHashRoute(shared.mount_id, currentCode)
      if (targetHash && location.hash !== targetHash) {
        location.hash = targetHash
        return nextPhase('semir_collect_code', 1500, {
          ...shared,
          search_hash: targetHash,
        })
      }

      return nextPhase('semir_collect_code', 0, {
        ...shared,
        search_hash: targetHash,
      })
    }

    if (phase === 'semir_collect_code') {
      const codes = Array.isArray(shared.unique_codes) ? shared.unique_codes : []
      const codeIndex = Number(shared.code_index || 0)
      const currentCode = String(shared.current_code || codes[codeIndex] || '')

      const plan = await buildCodePlan(
        currentCode,
        shared.mount_id,
        shared.relative_path,
        {
          duplicateMode: shared.duplicate_mode,
        },
      )

      const materialRows = [...(Array.isArray(shared.material_rows) ? shared.material_rows : []), ...plan.rows]
      const downloadItems = [...(Array.isArray(shared.pending_download_items) ? shared.pending_download_items : []), ...plan.downloadItems]
      const nextIndex = codeIndex + 1
      const nextCode = String(codes[nextIndex] || '')

      if (nextCode) {
        return nextPhase('semir_plan_code', 0, {
          ...shared,
          material_rows: materialRows,
          pending_download_items: downloadItems,
          code_index: nextIndex,
          search_completed_codes: nextIndex,
          current_code: '',
          search_hash: '',
          current_exec_no: Math.max(1, nextIndex + 1),
          current_buyer_id: nextCode,
          current_row_no: findFirstJobRowNoByCode(shared.jobs, nextCode),
        })
      }

      if (!downloadItems.length) {
        return nextPhase('build_job_queue', 0, {
          ...shared,
          material_rows: materialRows,
          pending_download_items: [],
          search_completed_codes: codes.length,
          current_code: currentCode,
        })
      }

      return downloadUrls(
        downloadItems,
        'semir_finalize_downloads',
        {
          shared_key: 'material_download_result',
          strict: false,
          concurrency: DOWNLOAD_CONCURRENCY,
          retry_attempts: DOWNLOAD_RETRY_ATTEMPTS,
          retry_delay_ms: DOWNLOAD_RETRY_DELAY_MS,
        },
        {
          ...shared,
          material_rows: materialRows,
          pending_download_items: downloadItems,
          search_completed_codes: codes.length,
          current_code: currentCode,
          current_exec_no: Math.max(1, codes.length || 1),
          current_buyer_id: currentCode,
          current_row_no: findFirstJobRowNoByCode(shared.jobs, currentCode),
        },
      )
    }

    if (phase === 'semir_finalize_downloads') {
      const materialRows = finalizeCodeRows(shared.material_rows, shared.material_download_result)
      return nextPhase('build_job_queue', 0, {
        ...shared,
        material_rows: materialRows,
        pending_download_items: [],
      })
    }

    if (phase === 'build_job_queue') {
      const sourceMap = buildSourceMap(shared.material_rows)
      const queue = buildExecutionQueue(shared.jobs, sourceMap, shared.provider_name)
      if (!queue.execJobs.length) {
        return complete([...(Array.isArray(shared.invalid_rows) ? shared.invalid_rows : []), ...queue.resultRows], {
          ...shared,
          source_map: sourceMap,
          result_rows: queue.resultRows,
          generation_total_jobs: 0,
          generation_completed_jobs: 0,
          current_source_filename: '',
        })
      }

      const firstJob = queue.execJobs[0]
      return nextPhase('provider_open_home', 0, {
        ...shared,
        jobs: queue.execJobs,
        source_map: sourceMap,
        result_rows: queue.resultRows,
        total_rows: queue.execJobs.length,
        search_completed_codes: Array.isArray(shared.unique_codes) ? shared.unique_codes.length : 0,
        generation_total_jobs: queue.execJobs.length,
        generation_completed_jobs: 0,
        job_index: 0,
        current_exec_no: 1,
        current_buyer_id: firstJob.input_code,
        current_row_no: Number(firstJob.row_no || 0),
        current_store: shared.provider_name || '',
        current_source_filename: compact(firstJob.source_item?.filename),
        provider_ready_started_at: 0,
        job_wait_started_at: 0,
        generation_submitted_at: 0,
        generation_baseline_images: 0,
      })
    }

    if (phase === 'provider_open_home') {
      const targetUrl = String(shared.provider_entry_url || '').trim()
      if (!targetUrl) throw new Error('AI 站点入口 URL 为空')
      if (location.href !== targetUrl) {
        location.href = targetUrl
        return nextPhase('provider_wait_ready', 2500, {
          ...shared,
          provider_ready_started_at: Date.now(),
          current_store: `${shared.provider_name || ''} 登录/加载中`,
        })
      }
      return nextPhase('provider_wait_ready', 0, {
        ...shared,
        provider_ready_started_at: Number(shared.provider_ready_started_at || 0) || Date.now(),
      })
    }

    if (phase === 'provider_wait_ready') {
      const startedAt = Number(shared.provider_ready_started_at || 0) || Date.now()
      const timeoutMs = Number(shared.provider_ready_timeout_ms || DEFAULT_PROVIDER_READY_TIMEOUT_MS)
      const providerState = shared.provider_key === 'gemini' ? readGeminiState() : readDoubaoState()

      if (providerState.ready) {
        return nextPhase('ai_plan_job', 0, {
          ...shared,
          provider_ready_started_at: 0,
          current_store: shared.provider_name || '',
        })
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`等待 ${shared.provider_name || 'AI 站点'} 登录/就绪超时，请登录后重试`)
      }

      return nextPhase('provider_wait_ready', DEFAULT_PROVIDER_POLL_MS, {
        ...shared,
        provider_ready_started_at: startedAt,
        current_store: `${shared.provider_name || ''} 登录/加载中`,
      })
    }

    if (phase === 'ai_plan_job') {
      const job = getCurrentJob(shared)
      if (!job) {
        return completeWithCurrentRows(shared)
      }

      const sourceItems = getCurrentJobSourceItems(shared)
      if (!sourceItems.length) {
        return finishCurrentJob(shared, {
          '执行结果': '未匹配到素材图',
          '备注': '森马云盘未匹配到可用素材图',
        })
      }

      const baseShared = {
        ...shared,
        current_exec_no: Number(shared.job_index || 0) + 1,
        current_buyer_id: job.input_code,
        current_row_no: Number(job.row_no || 0),
        current_store: shared.provider_name || '',
        current_source_filename: compact(job.source_item?.filename),
        job_wait_started_at: 0,
        generation_submitted_at: 0,
        generation_baseline_images: 0,
      }

      if (shared.provider_key === 'gemini') {
        return nextPhase('gemini_reset_job', 0, baseShared)
      }
      return nextPhase('doubao_reset_job', 0, baseShared)
    }

    if (phase === 'doubao_reset_job') {
      if (!/doubao\.com/.test(location.host || '') || location.pathname !== '/chat/create-image') {
        location.href = String(shared.provider_entry_url || PROVIDERS.doubao.entryUrl)
        return nextPhase('doubao_wait_ready', 2500, {
          ...shared,
          job_wait_started_at: Date.now(),
          current_store: `${shared.provider_name || ''} 打开创作页`,
        })
      }
      return nextPhase('doubao_wait_ready', 300, {
        ...shared,
        job_wait_started_at: Number(shared.job_wait_started_at || 0) || Date.now(),
      })
    }

    if (phase === 'doubao_wait_ready') {
      const state = readDoubaoState()
      const startedAt = Number(shared.job_wait_started_at || 0) || Date.now()
      if (state.ready) {
        const files = getCurrentJobSourceItems(shared).map(item => item.local_path).filter(Boolean)
        return injectFiles(
          [{ selector: state.uploadSelector, files }],
          'doubao_fill_prompt',
          { sleep_ms: 800 },
          {
            ...shared,
            job_wait_started_at: 0,
            current_store: `${shared.provider_name || ''} 上传素材`,
          },
        )
      }

      if (Date.now() - startedAt > Number(shared.provider_ready_timeout_ms || DEFAULT_PROVIDER_READY_TIMEOUT_MS)) {
        return finishCurrentJob(shared, {
          '执行结果': 'AI站点未就绪',
          '备注': 'Doubao 创作页未就绪或未登录',
        })
      }

      return nextPhase('doubao_wait_ready', 1500, {
        ...shared,
        job_wait_started_at: startedAt,
        current_store: `${shared.provider_name || ''} 等待创作页`,
      })
    }

    if (phase === 'doubao_fill_prompt') {
      const job = getCurrentJob(shared)
      const state = readDoubaoState()
      const editor = document.querySelector('[role="textbox"][contenteditable="true"]')
      if (!job || !state.ready || !editor) {
        return finishCurrentJob(shared, {
          '执行结果': '提示词填写失败',
          '备注': 'Doubao Prompt 编辑器未就绪',
        })
      }

      const ok = setEditorPlainText(editor, job.prompt_final)
      if (!ok) {
        return finishCurrentJob(shared, {
          '执行结果': '提示词填写失败',
          '备注': 'Doubao Prompt 填写失败',
        })
      }

      return nextPhase('doubao_wait_submit', DEFAULT_SUBMIT_WAIT_MS, {
        ...shared,
        job_wait_started_at: Date.now(),
        current_store: `${shared.provider_name || ''} 等待提交`,
      })
    }

    if (phase === 'doubao_wait_submit') {
      const state = readDoubaoState()
      const startedAt = Number(shared.job_wait_started_at || 0) || Date.now()
      if (state.sendCenter) {
        return cdpClicks(
          [state.sendCenter],
          'doubao_wait_completion',
          { sleep_ms: 1200 },
          {
            ...shared,
            generation_submitted_at: Date.now(),
            generation_baseline_images: 0,
            current_store: `${shared.provider_name || ''} 生成中`,
          },
        )
      }

      if (Date.now() - startedAt > 30000) {
        return finishCurrentJob(shared, {
          '执行结果': '提交失败',
          '备注': 'Doubao 发送按钮未出现，请检查素材图或 Prompt',
        })
      }

      return nextPhase('doubao_wait_submit', 1000, {
        ...shared,
        job_wait_started_at: startedAt,
      })
    }

    if (phase === 'doubao_wait_completion') {
      const submittedAt = Number(shared.generation_submitted_at || 0) || Date.now()
      const timeoutMs = Number(shared.generate_timeout_ms || DEFAULT_GENERATE_TIMEOUT_MS)
      const state = readDoubaoState()
      const elapsed = Date.now() - submittedAt
      const generatedImageReady = isDoubaoGenerationReady(state)

      if (elapsed >= MIN_COMPLETION_WAIT_MS) {
        const downloadPlans = readDoubaoGeneratedDownloadPlans(shared)
        if (downloadPlans.length) {
          return downloadClicks(
            downloadPlans,
            'doubao_finalize_downloads',
            {
              shared_key: 'last_generated_download',
              strict: false,
              sleep_ms: 1200,
            },
            {
              ...shared,
              current_store: `${shared.provider_name || ''} 下载结果图`,
            },
          )
        }

        if (generatedImageReady) {
          const previewCenter = readDoubaoGeneratedPreviewCenter()
          if (previewCenter) {
            return cdpClicks(
              [previewCenter],
              'doubao_wait_download_ready',
              { sleep_ms: 800 },
              {
                ...shared,
                job_wait_started_at: Date.now(),
                current_store: `${shared.provider_name || ''} 打开结果预览`,
              },
            )
          }
          return nextPhase('doubao_wait_completion', 1500, {
            ...shared,
            current_store: `${shared.provider_name || ''} 等待结果操作按钮`,
          })
        }
      }

      if (elapsed > timeoutMs) {
        return finishCurrentJob(shared, {
          '执行结果': '生图超时',
          '备注': `Doubao 等待 ${Math.round(timeoutMs / 1000)} 秒后仍未检测到完成状态`,
        })
      }

      return nextPhase('doubao_wait_completion', 3000, {
        ...shared,
        current_store: `${shared.provider_name || ''} 生成中`,
      })
    }

    if (phase === 'doubao_wait_download_ready') {
      const startedAt = Number(shared.job_wait_started_at || 0) || Date.now()
      const downloadPlans = readDoubaoGeneratedDownloadPlans(shared)
      if (downloadPlans.length) {
        return downloadClicks(
          downloadPlans,
          'doubao_finalize_downloads',
          {
            shared_key: 'last_generated_download',
            strict: false,
            sleep_ms: 1200,
          },
          {
            ...shared,
            job_wait_started_at: 0,
            current_store: `${shared.provider_name || ''} 下载结果图`,
          },
        )
      }

      if (Date.now() - startedAt > 15000) {
        return finishCurrentJob(shared, {
          '执行结果': '结果图下载失败',
          '备注': 'Doubao 结果图预览已打开，但未识别到保存按钮',
        })
      }

      return nextPhase('doubao_wait_download_ready', 800, {
        ...shared,
        job_wait_started_at: startedAt,
        current_store: `${shared.provider_name || ''} 等待结果操作按钮`,
      })
    }

    if (phase === 'doubao_finalize_downloads') {
      const patch = buildGeneratedDownloadPatch(shared.last_generated_download)
      return finishCurrentJob(shared, {
        '执行结果': '生图完成',
        ...patch,
      })
    }

    if (phase === 'gemini_reset_job') {
      if (!/gemini\.google\.com/.test(location.host || '')) {
        location.href = String(shared.provider_entry_url || PROVIDERS.gemini.entryUrl)
        return nextPhase('gemini_wait_ready', 2500, {
          ...shared,
          job_wait_started_at: Date.now(),
          current_store: `${shared.provider_name || ''} 打开首页`,
        })
      }

      const state = readGeminiState()
      if (state.newChatCenter) {
        return cdpClicks(
          [state.newChatCenter],
          'gemini_wait_ready',
          { sleep_ms: 1200 },
          {
            ...shared,
            job_wait_started_at: Date.now(),
            current_store: `${shared.provider_name || ''} 新建对话`,
          },
        )
      }

      return nextPhase('gemini_wait_ready', 1200, {
        ...shared,
        job_wait_started_at: Number(shared.job_wait_started_at || 0) || Date.now(),
      })
    }

    if (phase === 'gemini_wait_ready') {
      const startedAt = Number(shared.job_wait_started_at || 0) || Date.now()
      const state = readGeminiState()

      if (state.consentVisible) {
        const accepted = acceptGeminiConsentIfPresent()
        return nextPhase('gemini_wait_ready', accepted ? 1200 : 800, {
          ...shared,
          job_wait_started_at: startedAt,
          current_store: `${shared.provider_name || ''} 确认上传协议`,
        })
      }

      if (!state.ready) {
        if (Date.now() - startedAt > Number(shared.provider_ready_timeout_ms || DEFAULT_PROVIDER_READY_TIMEOUT_MS)) {
          return finishCurrentJob(shared, {
            '执行结果': 'AI站点未就绪',
            '备注': 'Gemini 页面未就绪或未登录',
          })
        }
        return nextPhase('gemini_wait_ready', 1500, {
          ...shared,
          job_wait_started_at: startedAt,
          current_store: `${shared.provider_name || ''} 等待页面`,
        })
      }

      if (!state.imageToolActive && state.imageToolCenter) {
        return cdpClicks(
          [state.imageToolCenter],
          'gemini_wait_tool',
          { sleep_ms: 1200 },
          {
            ...shared,
            job_wait_started_at: Date.now(),
            current_store: `${shared.provider_name || ''} 启用制作图片`,
          },
        )
      }

      if (state.imageToolActive) {
        return nextPhase('gemini_open_upload_menu', 0, shared)
      }

      return finishCurrentJob(shared, {
        '执行结果': 'AI站点未就绪',
        '备注': 'Gemini 未找到“制作图片”入口',
      })
    }

    if (phase === 'gemini_wait_tool') {
      const state = readGeminiState()
      const startedAt = Number(shared.job_wait_started_at || 0) || Date.now()
      if (state.imageToolActive) {
        return nextPhase('gemini_open_upload_menu', 0, {
          ...shared,
          job_wait_started_at: 0,
        })
      }
      if (Date.now() - startedAt > 30000) {
        return finishCurrentJob(shared, {
          '执行结果': 'AI站点未就绪',
          '备注': 'Gemini 未成功切到“制作图片”模式',
        })
      }
      return nextPhase('gemini_wait_tool', 1200, {
        ...shared,
        job_wait_started_at: startedAt,
      })
    }

    if (phase === 'gemini_open_upload_menu') {
      const state = readGeminiState()
      if (state.consentVisible) {
        const accepted = acceptGeminiConsentIfPresent()
        return nextPhase('gemini_open_upload_menu', accepted ? 1200 : 800, {
          ...shared,
          current_store: `${shared.provider_name || ''} 确认上传协议`,
        })
      }
      if (!state.uploadMenuCenter) {
        return finishCurrentJob(shared, {
          '执行结果': '素材上传失败',
          '备注': 'Gemini 未找到上传入口',
        })
      }
      const opened = openGeminiUploadMenu()
      return nextPhase('gemini_wait_upload_menu', opened ? 500 : 800, {
        ...shared,
        job_wait_started_at: Date.now(),
        current_store: `${shared.provider_name || ''} 打开上传菜单`,
      })
    }

    if (phase === 'gemini_wait_upload_menu') {
      const state = readGeminiState()
      const startedAt = Number(shared.job_wait_started_at || 0) || Date.now()
      if (state.uploadFileMenuItemCenter) {
        const files = getCurrentJobSourceItems(shared).map(item => item.local_path).filter(Boolean)
        return fileChooserUpload(
          [{
            label: `${shared.provider_name || 'Gemini'} / ${shared.current_buyer_id || ''}`,
            clicks: [state.uploadFileMenuItemCenter],
            files,
            timeout_ms: 12000,
            settle_ms: 800,
          }],
          'gemini_fill_prompt',
          {
            shared_key: 'last_file_chooser_upload',
            strict: true,
            sleep_ms: 1200,
          },
          {
            ...shared,
            job_wait_started_at: 0,
            current_store: `${shared.provider_name || ''} 上传素材`,
          },
        )
      }

      if (Date.now() - startedAt > 15000) {
        return finishCurrentJob(shared, {
          '执行结果': '素材上传失败',
          '备注': 'Gemini 上传菜单未出现“上传文件”按钮',
        })
      }

      return nextPhase('gemini_wait_upload_menu', 500, {
        ...shared,
        job_wait_started_at: startedAt,
      })
    }

    if (phase === 'gemini_fill_prompt') {
      const job = getCurrentJob(shared)
      const editor = document.querySelector('[role="textbox"][contenteditable="true"]')
      if (!job || !editor) {
        return finishCurrentJob(shared, {
          '执行结果': '提示词填写失败',
          '备注': 'Gemini Prompt 编辑器未就绪',
        })
      }

      const ok = setEditorPlainText(editor, job.prompt_final)
      if (!ok) {
        return finishCurrentJob(shared, {
          '执行结果': '提示词填写失败',
          '备注': 'Gemini Prompt 填写失败',
        })
      }

      return nextPhase('gemini_wait_submit', DEFAULT_SUBMIT_WAIT_MS, {
        ...shared,
        job_wait_started_at: Date.now(),
        current_store: `${shared.provider_name || ''} 等待提交`,
      })
    }

    if (phase === 'gemini_wait_submit') {
      const state = readGeminiState()
      const startedAt = Number(shared.job_wait_started_at || 0) || Date.now()
      if (!state.uploadReady) {
        if (Date.now() - startedAt > 30000) {
          return finishCurrentJob(shared, {
            '执行结果': '素材上传失败',
            '备注': 'Gemini 素材预览在 30 秒内未就绪',
          })
        }
        return nextPhase('gemini_wait_submit', 1000, {
          ...shared,
          job_wait_started_at: startedAt,
          current_store: `${shared.provider_name || ''} 等待素材上传`,
        })
      }

      if (state.sendCenter && state.sendReady) {
        const submitted = clickGeminiSendButton()
        return nextPhase('gemini_wait_completion', submitted ? 1500 : 800, {
          ...shared,
          generation_submitted_at: Date.now(),
          generation_baseline_images: state.largeImageCount,
          current_store: `${shared.provider_name || ''} 生成中`,
        })
      }

      if (Date.now() - startedAt > 30000) {
        return finishCurrentJob(shared, {
          '执行结果': '提交失败',
          '备注': 'Gemini 发送按钮未就绪，请检查素材图上传状态或 Prompt',
        })
      }

      return nextPhase('gemini_wait_submit', 1000, {
        ...shared,
        job_wait_started_at: startedAt,
      })
    }

    if (phase === 'gemini_wait_completion') {
      const submittedAt = Number(shared.generation_submitted_at || 0) || Date.now()
      const timeoutMs = Number(shared.generate_timeout_ms || DEFAULT_GENERATE_TIMEOUT_MS)
      const state = readGeminiState()
      const elapsed = Date.now() - submittedAt
      const baselineImages = Number(shared.generation_baseline_images || 0)

      if (elapsed >= MIN_COMPLETION_WAIT_MS && !state.busy && state.largeImageCount > baselineImages) {
        const downloadPlans = readGeminiGeneratedDownloadPlans(shared)
        if (downloadPlans.length) {
          return downloadClicks(
            downloadPlans,
            'gemini_finalize_downloads',
            {
              shared_key: 'last_generated_download',
              strict: false,
              sleep_ms: 1200,
            },
            {
              ...shared,
              current_store: `${shared.provider_name || ''} 下载结果图`,
            },
          )
        }
        return finishCurrentJob(shared, {
          '执行结果': '生图完成',
          '备注': '',
        })
      }

      if (elapsed > timeoutMs) {
        return finishCurrentJob(shared, {
          '执行结果': '生图超时',
          '备注': `Gemini 等待 ${Math.round(timeoutMs / 1000)} 秒后仍未检测到完成状态`,
        })
      }

      return nextPhase('gemini_wait_completion', 3000, {
        ...shared,
        current_store: `${shared.provider_name || ''} 生成中`,
      })
    }

    if (phase === 'gemini_finalize_downloads') {
      const patch = buildGeneratedDownloadPatch(shared.last_generated_download)
      return finishCurrentJob(shared, {
        '执行结果': '生图完成',
        ...patch,
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
