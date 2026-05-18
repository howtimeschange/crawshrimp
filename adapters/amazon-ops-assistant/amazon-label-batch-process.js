;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'init'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  function cleanText(value) {
    return String(value == null ? '' : value).trim()
  }

  function cleanPath(value) {
    return cleanText(value).replace(/^['"]|['"]$/g, '')
  }

  function basename(value) {
    const normalized = cleanPath(value).replace(/\\/g, '/')
    return normalized.split('/').filter(Boolean).pop() || normalized
  }

  function normalizeHeader(value) {
    return cleanText(value)
      .replace(/\s+/g, '')
      .replace(/[：:]/g, '')
      .toLowerCase()
  }

  function pickRowValue(row, aliases) {
    if (!row || typeof row !== 'object') return ''
    const aliasSet = new Set((aliases || []).map(normalizeHeader))
    for (const [key, value] of Object.entries(row)) {
      if (aliasSet.has(normalizeHeader(key))) return cleanText(value)
    }
    return ''
  }

  function normalizeMappingRows(mappingFile) {
    const rows = Array.isArray(mappingFile?.rows) ? mappingFile.rows : []
    const normalized = []
    const seen = new Set()

    for (const row of rows) {
      const fnsku = pickRowValue(row, ['FNSKU', 'fnsku', 'FNSKU码'])
      const labelName = pickRowValue(row, ['标签名称', '标签名', '文件名', '输出名称'])
      const sku = pickRowValue(row, ['SKU', 'sku'])
      if (!fnsku && !labelName && !sku) continue
      if (!fnsku || !labelName) {
        normalized.push({
          fnsku,
          sku,
          labelName,
          error: !fnsku ? '缺少 FNSKU' : '缺少标签名称',
        })
        continue
      }
      const key = fnsku.toUpperCase()
      if (seen.has(key)) {
        normalized.push({
          fnsku,
          sku,
          labelName,
          error: `FNSKU 重复：${fnsku}`,
        })
        continue
      }
      seen.add(key)
      normalized.push({
        fnsku,
        sku,
        labelName,
        error: '',
      })
    }

    return normalized
  }

  function normalizePdfInput(rawValue) {
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

  function buildInitialRows(inputParams = params) {
    const mappingRows = normalizeMappingRows(inputParams.mapping_file)
    const pdfFiles = normalizePdfInput(inputParams.label_pdf)
    const validMappings = mappingRows.filter(row => row.fnsku && row.labelName && !row.error)

    if (!mappingRows.length) {
      throw new Error('映射表为空，请上传包含 FNSKU 和 标签名称 的 Excel')
    }
    const invalidMapping = mappingRows.find(row => row.error)
    if (invalidMapping) {
      throw new Error(`映射表格式错误：${invalidMapping.error}`)
    }
    if (!validMappings.length) {
      throw new Error('映射表缺少有效 FNSKU/标签名称 数据')
    }
    if (!pdfFiles.length) {
      throw new Error('请至少选择一个商品标签 PDF')
    }

    return pdfFiles.map((file, index) => ({
      PDF文件: file.filename,
      页码: '',
      识别FNSKU: '',
      SKU: '',
      标签名称: '',
      匹配结果: '等待后端拆分',
      输出PDF: '',
      备注: '',
      __pdf_path: file.path,
      __pdf_index: index + 1,
      __mapping_rows: validMappings,
    }))
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
    return {
      success: false,
      error: String(message || '亚马逊标签批量处理脚本执行失败'),
    }
  }

  if (testExports) {
    Object.assign(testExports, {
      cleanText,
      normalizeHeader,
      pickRowValue,
      normalizeMappingRows,
      normalizePdfInput,
      buildInitialRows,
    })
    return complete([], shared)
  }

  try {
    if (phase === 'init' || phase === 'main') {
      const rows = buildInitialRows(params)
      const mappingCount = Array.isArray(rows[0]?.__mapping_rows) ? rows[0].__mapping_rows.length : 0
      return complete(rows, {
        ...shared,
        total_rows: rows.length,
        current_exec_no: rows.length,
        current_buyer_id: rows[0]?.PDF文件 || '',
        current_store: `亚马逊标签批量处理 · 映射 ${mappingCount} 条`,
      })
    }

    return fail(`未知 phase: ${phase}`)
  } catch (error) {
    return fail(error?.message || error)
  }
})()
