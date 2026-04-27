;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'init'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  function cleanPath(value) {
    return String(value || '').trim().replace(/^['"]|['"]$/g, '')
  }

  function basename(value) {
    const normalized = cleanPath(value).replace(/\\/g, '/')
    return normalized.split('/').filter(Boolean).pop() || normalized
  }

  function normalizePdfInputs(rawValue) {
    const sourceValue = rawValue && typeof rawValue === 'object' && Array.isArray(rawValue.paths)
      ? rawValue.paths
      : rawValue
    const rawItems = Array.isArray(sourceValue)
      ? sourceValue
      : sourceValue && typeof sourceValue === 'object' && sourceValue.path
        ? [sourceValue.path]
        : String(sourceValue || '').replace(/[；;]/g, '\n').split(/\r?\n/)
    const result = []
    const seen = new Set()

    for (const rawItem of rawItems) {
      const filePath = cleanPath(rawItem)
      if (!filePath || !/\.pdf$/i.test(filePath)) continue
      const key = filePath.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      result.push({
        path: filePath,
        filename: basename(filePath),
      })
    }

    return result
  }

  function inferPdfType(file) {
    const name = `${file?.filename || ''} ${file?.path || ''}`
    if (/洗唛|洗标|水洗/.test(name)) {
      return { value: 'wash_label', label: '洗唛' }
    }
    if (/吊牌|合格证/.test(name)) {
      return { value: 'hang_tag', label: '吊牌/合格证' }
    }
    return { value: 'auto', label: '自动识别' }
  }

  function pdfTypeMeta(type) {
    if (type === 'wash_label') return { value: 'wash_label', label: '洗唛' }
    if (type === 'hang_tag') return { value: 'hang_tag', label: '吊牌/合格证' }
    return { value: 'auto', label: '自动识别' }
  }

  function rowsForPdfFiles(pdfFiles, forcedType = '') {
    return pdfFiles.map(file => {
      const pdfType = forcedType ? pdfTypeMeta(forcedType) : inferPdfType(file)
      return {
        'PDF文件': file.filename,
        'PDF类型': pdfType.label,
        '原始路径': file.path,
        '处理动作': '等待后端截图',
        '备注': '',
        '__pdf_path': file.path,
        '__pdf_type': pdfType.value,
      }
    })
  }

  function collectTypedPdfRows(inputParams = params) {
    const washFiles = normalizePdfInputs(inputParams.wash_pdf_files)
    const tagFiles = normalizePdfInputs(inputParams.tag_pdf_files)
    const legacyFiles = normalizePdfInputs(inputParams.pdf_files)

    return [
      ...rowsForPdfFiles(washFiles, 'wash_label'),
      ...rowsForPdfFiles(tagFiles, 'hang_tag'),
      ...rowsForPdfFiles(legacyFiles),
    ]
  }

  function complete(data = [], nextShared = shared) {
    return {
      success: true,
      data,
      meta: {
        has_more: false,
        shared: nextShared,
      },
    }
  }

  function fail(message) {
    return { success: false, error: String(message || 'PDF 批量截图脚本执行失败') }
  }

  if (testExports) {
    Object.assign(testExports, {
      normalizePdfInputs,
      inferPdfType,
      pdfTypeMeta,
      rowsForPdfFiles,
      collectTypedPdfRows,
    })
    return complete([], shared)
  }

  try {
    if (phase === 'init' || phase === 'main') {
      const rows = collectTypedPdfRows(params)
      if (!rows.length) return fail('请至少选择洗唛 PDF 或吊牌 PDF')
      return complete(rows, {
        ...shared,
        total_rows: rows.length,
        current_exec_no: rows.length,
        current_buyer_id: rows[0]?.PDF文件 || '',
        current_store: '深绘 PDF 批量截图',
      })
    }

    return fail(`未知 phase: ${phase}`)
  } catch (error) {
    return fail(error?.message || error)
  }
})()
