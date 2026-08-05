;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const runtimePhase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const phase = runtimePhase === 'main' ? 'init' : runtimePhase
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const SCM_ENTRY_URL = 'https://scm.semir.com/scm-quality-mgm/index/scm-qc-wash-appr-index'
  const DOWNLOAD_RETRY_ATTEMPTS = 3
  const DOWNLOAD_RETRY_DELAY_MS = 1000
  const DEFAULT_QUERY_DELAY_MS = 700
  const DEFAULT_DOWNLOAD_CONCURRENCY = 4
  const MAX_READ_ATTEMPTS = 24

  function compact(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim()
  }

  function compactCode(value) {
    let text = compact(value)
      .replace(/^款号[:：]?/i, '')
      .replace(/^style(?:\s*code)?[:：]?/i, '')
      .trim()
    if (/^\d+\.0+$/.test(text)) text = text.replace(/\.0+$/, '')
    return text
  }

  function uniqueValues(values) {
    const seen = new Set()
    const output = []
    for (const raw of values || []) {
      const value = compactCode(raw)
      if (!value || seen.has(value)) continue
      seen.add(value)
      output.push(value)
    }
    return output
  }

  function normalizeStyleCodes(rawValue) {
    const text = String(rawValue || '').replace(/[，、；;, \t]+/g, '\n')
    const values = []
    for (const line of text.split(/\r?\n/)) {
      const cleaned = compact(line)
      if (!cleaned) continue
      const matches = cleaned.match(/[A-Za-z0-9][A-Za-z0-9_-]{5,}(?:\.0+)?/g)
      if (matches && matches.length) values.push(...matches)
      else values.push(cleaned)
    }
    return uniqueValues(values)
  }

  function textOf(value) {
    if (typeof value === 'string' || typeof value === 'number') return compact(value)
    return compact(value?.innerText || value?.textContent || '')
  }

  function toSafeFilename(value, fallback = 'file') {
    const text = String(value || '')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/^\.+|\.+$/g, '')
      .replace(/^_+|_+$/g, '')
    return text || fallback
  }

  function timestampText() {
    const date = new Date()
    const pad = value => String(value).padStart(2, '0')
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
    ].join('') + '_' + [
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds()),
    ].join('')
  }

  function normalizeExportRoot(rawValue) {
    return String(rawValue || '').trim().replace(/[\\/]+$/g, '')
  }

  function buildPackageRoot(rawExportFolder, rawPackageName, nowText = timestampText()) {
    const exportRoot = normalizeExportRoot(rawExportFolder)
    const packageName = toSafeFilename(rawPackageName || `SCM洗唛吊牌_${nowText}`, `SCM洗唛吊牌_${nowText}`)
    return exportRoot ? `${exportRoot}/${packageName}` : packageName
  }

  function basenameFromUrl(url, fallback = 'file') {
    const raw = String(url || '').split(/[?#]/)[0]
    const part = raw.slice(raw.lastIndexOf('/') + 1)
    try {
      return toSafeFilename(decodeURIComponent(part), fallback)
    } catch (error) {
      return toSafeFilename(part, fallback)
    }
  }

  function encodeUrlForDownload(rawUrl) {
    const value = String(rawUrl || '').trim()
    if (!value) return ''
    try {
      const parsed = new URL(value, location.href)
      parsed.pathname = parsed.pathname
        .split('/')
        .map(part => {
          if (!part) return part
          try {
            return encodeURIComponent(decodeURIComponent(part))
          } catch (error) {
            return encodeURIComponent(part)
          }
        })
        .join('/')
      return parsed.toString()
    } catch (error) {
      return value.replace(/[^\x00-\x7F]/g, char => encodeURIComponent(char))
    }
  }

  function extensionOf(filename, fallback = '') {
    const name = String(filename || '')
    const index = name.lastIndexOf('.')
    if (index < 0) return fallback
    return name.slice(index + 1).toLowerCase() || fallback
  }

  function visible(element) {
    if (!element || !element.getClientRects?.().length) return false
    const rect = element.getBoundingClientRect?.()
    if (!rect || !rect.width || !rect.height) return false
    const style = getComputedStyle(element)
    return style.display !== 'none' && style.visibility !== 'hidden'
  }

  function setInputValue(input, value) {
    if (!input) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (setter) setter.call(input, value)
    else input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }))
    return compact(input.value) === compact(value)
  }

  function clickLike(element) {
    if (!element) return false
    try { element.scrollIntoView({ block: 'center', inline: 'center' }) } catch (error) {}
    try { element.focus?.() } catch (error) {}
    try { element.click?.() } catch (error) {}
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']) {
      try {
        const EventCtor = type.startsWith('pointer') && typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent
        element.dispatchEvent(new EventCtor(type, { bubbles: true, cancelable: true }))
      } catch (error) {}
    }
    return true
  }

  function findStyleInput() {
    const fields = [...document.querySelectorAll('label.q-field, .q-field')]
      .filter(visible)
      .filter(field => /^款号(?:\s|$)/.test(textOf(field)))
    for (const field of fields) {
      const input = field.querySelector('input.q-field__native, input:not([type="checkbox"])')
      if (input && input.type !== 'checkbox') return input
    }
    return [...document.querySelectorAll('input')]
      .filter(input => input.type !== 'checkbox' && visible(input))
      .find(input => {
        let node = input.parentElement
        for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
          if (/^款号(?:\s|$)/.test(textOf(node))) return true
        }
        return false
      }) || null
  }

  function findSearchButton() {
    return [...document.querySelectorAll('button')]
      .filter(visible)
      .find(button => /搜索/.test(textOf(button)) && !button.disabled) || null
  }

  function qtableVm() {
    const candidates = [...document.querySelectorAll('.q-table__container')]
      .map(element => element.__vue__)
      .filter(vm => vm && Array.isArray(vm.$props?.data) && Array.isArray(vm.$props?.columns))
    return candidates.find(vm => {
      const labels = (vm.$props.columns || []).map(column => compact(column?.label || column?.name)).join(' ')
      return labels.includes('款号') && labels.includes('洗唛文件') && labels.includes('吊牌文件')
    }) || candidates[0] || null
  }

  function isCompletedRecord(row) {
    const hStatus = String(row?.H_STATUS ?? '').trim()
    const status = String(row?.STATUS ?? '').trim()
    return hStatus === '100' || status === '0' || /已完成/.test(textOf(row?.STATUS_DISPLAY || row?.H_STATUS_DISPLAY || ''))
  }

  function normalizeScmRecord(row, styleCode) {
    return {
      orderNo: compact(row?.ORDER_NO),
      styleCode: compactCode(row?.P_MAT_CODE || styleCode),
      styleName: compact(row?.P_MAT_NAME),
      brand: compact(row?.BRAND_DISPLAY),
      season: compact(row?.SEASONS_DISPLAY || row?.SEASONS),
      purchaseGroup: compact(row?.PUR_GRP_DISPLAY || row?.PUR_GRP),
      vendorCode: compact(row?.VENDOR_CODE),
      vendorName: compact(row?.VENDOR_NAME),
      skc: compact(row?.SKC_CODE || row?.SKC_ID),
      colorCode: compact(row?.F1),
      colorName: compact(row?.F1_DISPLAY),
      purchaseNo: compact(row?.PO_NO),
      chineseComponent: compact(row?.C_COMPONENT),
      englishComponent: compact(row?.E_COMPONENT),
      washUrl: compact(row?.SKC_FILE_URL1),
      hangtagUrl: compact(row?.SKC_FILE_URL2),
      lastModifiedBy: compact(row?.LAST_MODIFIED_BY),
      lastModifiedTime: compact(row?.LAST_MODIFIED_TIME),
      hId: compact(row?.H_ID),
      itemId: compact(row?.ID),
      completed: isCompletedRecord(row),
    }
  }

  function tableRead(styleCode, options = {}) {
    const vm = qtableVm()
    if (!vm) return { loading: false, stale: true, rows: [], rowsNumber: 0, reason: '未找到 SCM 洗唛判定表格组件' }
    const data = Array.isArray(vm.$props?.data) ? vm.$props.data : []
    const rowsNumber = Number(vm.$props?.pagination?.rowsNumber || data.length || 0)
    const loading = !!vm.$props?.loading
    const wanted = compactCode(styleCode)
    const rows = data
      .filter(row => compactCode(row?.P_MAT_CODE) === wanted || compact(row?.SKC_CODE).startsWith(wanted))
      .filter(row => !options.onlyCompleted || isCompletedRecord(row))
      .map(row => normalizeScmRecord(row, wanted))
    const anyOtherStyle = data.some(row => compactCode(row?.P_MAT_CODE) && compactCode(row?.P_MAT_CODE) !== wanted)
    const stale = loading || (rows.length === 0 && rowsNumber > 0 && anyOtherStyle)
    return { loading, stale, rows, rowsNumber, reason: stale ? '表格仍在刷新或仍显示上一款号' : '' }
  }

  function componentKey(record) {
    return `${compact(record.chineseComponent)}\u001f${compact(record.englishComponent)}`
  }

  function baseSummaryRow(styleCode, record = {}, packageRoot = '') {
    return {
      __sheet_name: '成分汇总',
      __scm_package_root: packageRoot,
      输出表: '成分汇总',
      款号: compactCode(record.styleCode || styleCode),
      款名: compact(record.styleName),
      品牌: compact(record.brand),
      业绩季节: compact(record.season),
      采购组: compact(record.purchaseGroup),
      供应商编码: compact(record.vendorCode),
      供应商名称: compact(record.vendorName),
      中文成分: compact(record.chineseComponent),
      英文成分: compact(record.englishComponent),
      SKC数量: 0,
      洗唛文件数: 0,
      吊牌文件数: 0,
      查询结果: '',
      备注: '',
      抓取时间: new Date().toISOString(),
    }
  }

  function exceptionRow(styleCode, message, packageRoot = '', extra = {}) {
    return {
      __sheet_name: '异常',
      __scm_package_root: packageRoot,
      输出表: '异常',
      款号: compactCode(styleCode),
      SKC: compact(extra.skc),
      文件类型: compact(extra.fileType),
      文件名: compact(extra.filename),
      源文件URL: compact(extra.url),
      本地文件: '',
      文件大小: '',
      下载结果: compact(extra.downloadResult),
      查询结果: compact(extra.queryResult || '失败'),
      备注: compact(message),
      抓取时间: new Date().toISOString(),
    }
  }

  function detailRow(record, fileType, filename, url, downloadIndex, packageRoot, note = '') {
    return {
      __sheet_name: downloadIndex >= 0 ? '下载明细' : '异常',
      __download_index: downloadIndex,
      __scm_package_root: packageRoot,
      输出表: downloadIndex >= 0 ? '下载明细' : '异常',
      款号: record.styleCode,
      款名: record.styleName,
      品牌: record.brand,
      业绩季节: record.season,
      采购组: record.purchaseGroup,
      供应商编码: record.vendorCode,
      供应商名称: record.vendorName,
      SKC: record.skc,
      色号: record.colorCode,
      颜色名称: record.colorName,
      申请单号: record.orderNo,
      采购单号: record.purchaseNo,
      中文成分: record.chineseComponent,
      英文成分: record.englishComponent,
      文件类型: fileType,
      文件名: filename,
      源文件URL: url,
      本地文件: '',
      文件大小: '',
      下载结果: downloadIndex >= 0 ? '待下载' : '缺少文件URL',
      查询结果: '成功',
      备注: note,
      最后更新人: record.lastModifiedBy,
      最后更新时间: record.lastModifiedTime,
      抓取时间: new Date().toISOString(),
    }
  }

  function buildDownloadPlan(styleCode, records, packageRoot, startDownloadIndex = 0) {
    const plannedRows = []
    const downloadItems = []
    let downloadIndex = startDownloadIndex

    for (const record of records) {
      const fileDefs = [
        { type: '洗唛文件', folder: '洗唛文件', url: record.washUrl, fallback: `${record.skc || styleCode}-洗唛.jpg` },
        { type: '吊牌文件', folder: '吊牌文件', url: record.hangtagUrl, fallback: `${record.skc || styleCode}-吊牌.pdf` },
      ]
      for (const fileDef of fileDefs) {
        const url = compact(fileDef.url)
        const filename = basenameFromUrl(url, fileDef.fallback)
        if (!url) {
          plannedRows.push(detailRow(record, fileDef.type, '', '', -1, packageRoot, `${fileDef.type}未返回 URL`))
          continue
        }
        const relativePath = [
          toSafeFilename(record.styleCode || styleCode, '未分类款号'),
          fileDef.folder,
          filename,
        ].join('/')
        plannedRows.push(detailRow(record, fileDef.type, filename, url, downloadIndex, packageRoot))
        downloadItems.push({
          url: encodeUrlForDownload(url),
          filename,
          label: `${record.styleCode || styleCode} / ${record.skc || ''} / ${fileDef.type}`,
          target_dir: packageRoot,
          target_relative_path: relativePath,
          headers: {
            Referer: SCM_ENTRY_URL,
          },
          retry_attempts: DOWNLOAD_RETRY_ATTEMPTS,
          retry_delay_ms: DOWNLOAD_RETRY_DELAY_MS,
        })
        downloadIndex += 1
      }
    }

    return { plannedRows, downloadItems }
  }

  function buildSummaryRows(styleCode, records, detailRows, packageRoot) {
    if (!records.length) {
      return [exceptionRow(styleCode, 'SCM 当前筛选条件下未找到款号记录', packageRoot, { queryResult: '未找到记录' })]
    }

    const groups = new Map()
    for (const record of records) {
      const key = componentKey(record)
      if (!groups.has(key)) groups.set(key, { record, skcs: new Set() })
      groups.get(key).skcs.add(record.skc)
    }

    const multipleComponents = groups.size > 1
    return [...groups.values()].map(group => {
      const row = baseSummaryRow(styleCode, group.record, packageRoot)
      const relatedSkcs = group.skcs
      const relatedDetails = (detailRows || []).filter(item => (
        item.款号 === row.款号 && relatedSkcs.has(item.SKC)
      ))
      row.SKC数量 = relatedSkcs.size
      row.洗唛文件数 = relatedDetails.filter(item => item.文件类型 === '洗唛文件' && item.源文件URL).length
      row.吊牌文件数 = relatedDetails.filter(item => item.文件类型 === '吊牌文件' && item.源文件URL).length
      row.查询结果 = '成功'
      row.备注 = multipleComponents ? '同一款号存在多组中英文成分，请人工复核' : ''
      return row
    })
  }

  function finalizeRows(plannedRows, downloadResult) {
    const items = Array.isArray(downloadResult?.items) ? downloadResult.items : []
    return (Array.isArray(plannedRows) ? plannedRows : []).map(row => {
      if (String(row.__sheet_name || '') !== '下载明细') return row
      const index = Number(row.__download_index)
      const result = Number.isInteger(index) ? (items[index] || {}) : {}
      const success = !!result.success
      const bytes = Number(result.bytes || 0)
      return {
        ...row,
        本地文件: String(result.path || ''),
        文件大小: bytes || '',
        下载结果: success ? '已下载' : '下载失败',
        备注: success ? '' : String(result.error || '下载失败'),
      }
    })
  }

  function buildRunShared(styleCodes, overrides = {}) {
    return {
      target_style_codes: styleCodes,
      package_root: String(overrides.package_root || shared.package_root || ''),
      current_index: Number(overrides.current_index ?? shared.current_index ?? 0),
      planned_rows: Array.isArray(overrides.planned_rows) ? overrides.planned_rows : (Array.isArray(shared.planned_rows) ? shared.planned_rows : []),
      pending_download_items: Array.isArray(overrides.pending_download_items) ? overrides.pending_download_items : (Array.isArray(shared.pending_download_items) ? shared.pending_download_items : []),
      total_rows: styleCodes.length,
      current_exec_no: Number(overrides.current_exec_no ?? shared.current_exec_no ?? 1),
      current_row_no: Number(overrides.current_row_no ?? shared.current_row_no ?? 1),
      current_buyer_id: String(overrides.current_buyer_id ?? shared.current_buyer_id ?? styleCodes[0] ?? ''),
      current_store: 'SCM 洗唛批复判定',
      completed_count: Number(overrides.completed_count ?? shared.completed_count ?? 0),
      success_count: Number(overrides.success_count ?? shared.success_count ?? 0),
      failed_count: Number(overrides.failed_count ?? shared.failed_count ?? 0),
      ...overrides,
    }
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

  function downloadUrls(items, nextPhaseName, options = {}, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'download_urls',
        items,
        shared_key: options.shared_key || 'last_download_result',
        strict: false,
        concurrency: DEFAULT_DOWNLOAD_CONCURRENCY,
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

  function fail(message) {
    return { success: false, error: String(message || 'SCM 洗唛吊牌脚本执行失败') }
  }

  function exposeHelpers() {
    if (!testExports || typeof testExports !== 'object') return
    Object.assign(testExports, {
      normalizeStyleCodes,
      toSafeFilename,
      buildPackageRoot,
      basenameFromUrl,
      encodeUrlForDownload,
      extensionOf,
      normalizeScmRecord,
      buildDownloadPlan,
      buildSummaryRows,
      finalizeRows,
      tableRead,
      buildRunShared,
      isCompletedRecord,
    })
  }

  exposeHelpers()

  if (phase === '__exports__') {
    return complete([], shared)
  }

  try {
    if (!/scm\.semir\.com/i.test(String(location.hostname || location.href || ''))) {
      return fail(`当前页面不是 SCM 后台：${String(location.href || '')}`)
    }

    if (phase === 'init') {
      const styleCodes = normalizeStyleCodes(params.style_codes)
      if (!styleCodes.length) throw new Error('请至少输入一个款号')
      const packageRoot = buildPackageRoot(params.export_folder, params.package_name)
      return nextPhase('search_style', 0, buildRunShared(styleCodes, {
        package_root: packageRoot,
        current_index: 0,
        current_exec_no: 1,
        current_row_no: 1,
        current_buyer_id: styleCodes[0],
        planned_rows: [],
        pending_download_items: [],
      }))
    }

    if (phase === 'search_style') {
      const styleCodes = uniqueValues(shared.target_style_codes || normalizeStyleCodes(params.style_codes))
      const index = Number(shared.current_index || 0)
      if (index >= styleCodes.length) {
        const downloadItems = Array.isArray(shared.pending_download_items) ? shared.pending_download_items : []
        if (!downloadItems.length) {
          return complete(shared.planned_rows || [], buildRunShared(styleCodes, {
            ...shared,
            completed_count: styleCodes.length,
            current_buyer_id: '',
          }))
        }
        return downloadUrls(
          downloadItems,
          'finalize_all',
          {
            shared_key: 'last_download_result',
          },
          buildRunShared(styleCodes, {
            ...shared,
            current_index: styleCodes.length,
            completed_count: styleCodes.length,
            current_buyer_id: '',
          }),
        )
      }

      const styleCode = styleCodes[index]
      const input = findStyleInput()
      if (!input) throw new Error('未找到 SCM 页面上的“款号”筛选框')
      setInputValue(input, styleCode)
      const button = findSearchButton()
      if (!button) throw new Error('未找到 SCM 页面上的“搜索”按钮')
      clickLike(button)
      return nextPhase('read_style', DEFAULT_QUERY_DELAY_MS, buildRunShared(styleCodes, {
        ...shared,
        current_style_code: styleCode,
        read_attempts: 0,
        current_exec_no: index + 1,
        current_row_no: index + 1,
        current_buyer_id: styleCode,
      }))
    }

    if (phase === 'read_style') {
      const styleCodes = uniqueValues(shared.target_style_codes || normalizeStyleCodes(params.style_codes))
      const index = Number(shared.current_index || 0)
      const styleCode = String(shared.current_style_code || styleCodes[index] || '')
      const onlyCompleted = params.only_completed !== false
      const read = tableRead(styleCode, { onlyCompleted })
      const attempts = Number(shared.read_attempts || 0)

      if (read.stale && attempts < MAX_READ_ATTEMPTS) {
        return nextPhase('read_style', 500, buildRunShared(styleCodes, {
          ...shared,
          read_attempts: attempts + 1,
          last_read_reason: read.reason,
        }))
      }

      const packageRoot = String(shared.package_root || buildPackageRoot(params.export_folder, params.package_name))
      const records = read.stale ? [] : read.rows
      const currentPlannedRows = Array.isArray(shared.planned_rows) ? shared.planned_rows : []
      const currentDownloadItems = Array.isArray(shared.pending_download_items) ? shared.pending_download_items : []
      const startDownloadIndex = currentDownloadItems.length
      const plan = buildDownloadPlan(styleCode, records, packageRoot, startDownloadIndex)
      const summaryRows = read.stale
        ? [exceptionRow(styleCode, read.reason || 'SCM 表格读取超时', packageRoot, { queryResult: '读取超时' })]
        : buildSummaryRows(styleCode, records, plan.plannedRows, packageRoot)
      const rowsForStyle = [...summaryRows, ...plan.plannedRows]
      const nextIndex = index + 1
      const done = nextIndex >= styleCodes.length
      const hasSuccess = records.length > 0
      return nextPhase('search_style', 0, buildRunShared(styleCodes, {
        ...shared,
        current_index: nextIndex,
        completed_count: nextIndex,
        current_exec_no: done ? styleCodes.length : nextIndex + 1,
        current_row_no: done ? styleCodes.length : nextIndex + 1,
        current_buyer_id: done ? '' : styleCodes[nextIndex],
        planned_rows: [...currentPlannedRows, ...rowsForStyle],
        pending_download_items: [...currentDownloadItems, ...plan.downloadItems],
        success_count: Number(shared.success_count || 0) + (hasSuccess ? 1 : 0),
        failed_count: Number(shared.failed_count || 0) + (hasSuccess ? 0 : 1),
        last_style_code: styleCode,
        last_result: hasSuccess ? '成功' : '失败',
        read_attempts: 0,
      }))
    }

    if (phase === 'finalize_all') {
      const rows = finalizeRows(shared.planned_rows, shared.last_download_result)
      return complete(rows, {
        ...shared,
        planned_rows: rows,
        pending_download_items: [],
      })
    }

    return fail(`未知 phase: ${phase}`)
  } catch (error) {
    return fail(error?.message || error)
  }
})()
