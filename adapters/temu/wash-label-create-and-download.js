;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const runtimePhase = window.__CRAWSHRIMP_PHASE__ || 'init'
  const phase = runtimePhase === 'main' ? 'init' : runtimePhase
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const targetStore = textOf(params.store_name || 'balabala Official Shop')
  const executeMode = compact(params.execute_mode || 'dry_run')
  const allowSave = params.allow_save === true || String(params.allow_save || '').toLowerCase() === 'true'
  const downloadAfterSave = params.download_after_save !== false && String(params.download_after_save || '').toLowerCase() !== 'false'
  const skipAlreadyMade = params.skip_already_made !== false && String(params.skip_already_made || '').toLowerCase() !== 'false'
  const maxDownloads = Math.max(0, Math.min(10000, Math.floor(Number(params.max_downloads || 0))))
  const timeoutSeconds = Math.max(5, Math.min(120, Number(params.timeout_seconds || 60)))
  const pilotStyle = compact(params.pilot_style || '')
  const maxSkc = Math.max(0, Math.min(10000, Math.floor(Number(params.max_skc || 0))))
  const enterpriseCodesText = textOf(params.enterprise_codes || params.enterprise_code || params.sku_nos || '')
  const scmLookupEnabled = params.scm_lookup !== false && String(params.scm_lookup || '').toLowerCase() !== 'false'
  const scmUrlContains = textOf(params.scm_url_contains || 'scm.semir.com')
  const scmOnlyCompleted = params.scm_only_completed !== false && String(params.scm_only_completed || '').toLowerCase() !== 'false'
  const scmBrandMode = compact(params.scm_brand || 'auto')
  const scmCompositionMode = compact(params.scm_composition_mode || 'safe_simple')
  const manufacturerNameParam = textOf(params.manufacturer_name || 'Zhejiang Semir Garment Co.,Ltd.')
  const manufacturerAddressParam = textOf(params.manufacturer_address || 'No.98, Nanhui Road, Louqiao Industrial Park, Ouhai District, Wenzhou/Zhejiang, China')
  const productionDateParam = textOf(params.production_date || '2026-06-01')
  const batchNumberParam = textOf(params.batch_number || 'PC260601')
  const careSymbolsMode = compact(params.care_symbols_mode || 'pilot_defaults')
  const labelWidthMm = Math.max(10, Math.min(100, Number(params.label_width_mm || 35)))
  const labelLengthMm = Math.max(50, Math.min(500, Number(params.label_length_mm || 235)))
  const labelPaddingMm = Math.max(0, Math.min(100, Number(params.label_padding_mm || 10)))
  const API_PAGE_SIZE = 200
  const API_QUERY_PAGE_SIZE = 50
  const SCAN_PAGES_PER_PHASE = 8
  const SCAN_CONCURRENCY = 4
  const REQUIRED_COLUMNS = ['款号', '颜色', '尺码', 'SKC', 'SKU编码', 'SKU货号', '洗唛成分', '产品线']
  const IDENTIFIER_COLUMNS = new Set(['款号', '尺码', 'SKC', 'SKU编码', 'SKU货号'])
  const MISSING_COMPOSITION = new Set(['', 'N/A', 'NA'])
  const SAVE_MODE = 'create_and_download'
  const PILOT_STYLE = '209225117208'
  const PILOT_CARE_SYMBOLS = {
    washing: 13,
    bleaching: 3,
    drying: 8,
    ironing: 3,
    dryCleaning: 5,
  }
  const DEFAULT_ING_LANGS = ['en', 'de', 'fr', 'it', 'es', 'da', 'cs', 'sv']
  const SCM_BRAND_BY_STORE = {
    'SEMIR Official Shop': { code: '10', label: '森马' },
    'balabala Official Shop': { code: '20', label: '巴拉巴拉' },
    'Balabala Shoes': { code: '20', label: '巴拉巴拉' },
    'minibala Kids Shop': { code: '23', label: 'mini bala' },
  }

  function compact(value) {
    return String(value || '').replace(/\s+/g, '').trim()
  }

  function textOf(value) {
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value).replace(/\s+/g, ' ').trim()
    }
    return String(value?.innerText || value?.textContent || '').replace(/\s+/g, ' ').trim()
  }

  function isMissingComposition(value) {
    return MISSING_COMPOSITION.has(textOf(value).toUpperCase())
  }

  function sourceRowsFromParam() {
    const file = params.input_file || params.wash_label_file || null
    if (!file || typeof file !== 'object') return []
    if (file.sheets && file.sheets['洗唛需求'] && Array.isArray(file.sheets['洗唛需求'].rows)) {
      return file.sheets['洗唛需求'].rows
    }
    return Array.isArray(file.rows) ? file.rows : []
  }

  function normalizeWorkbookRow(row) {
    const item = {}
    for (const key of REQUIRED_COLUMNS) {
      const value = row?.[key]
      item[key] = IDENTIFIER_COLUMNS.has(key) ? compact(value) : textOf(value)
    }
    return item
  }

  function rowExactKey(row) {
    return REQUIRED_COLUMNS.map(key => row[key] || '').join('\u001f')
  }

  function sizeSortKey(value) {
    const text = compact(value)
    const number = Number(text)
    if (Number.isFinite(number)) return String(number).padStart(8, '0')
    return text
  }

  function normalizeEnterpriseCode(value) {
    const raw = compact(value).replace(/\.pdf$/i, '')
    if (!raw) return ''
    const parts = raw.split(/[-_]/).map(compact).filter(Boolean)
    return parts.length > 1 ? parts[parts.length - 1] : raw
  }

  function parseEnterpriseCodes() {
    const rawValues = enterpriseCodesText
      .split(/[\s,，;；、]+/)
      .map(normalizeEnterpriseCode)
      .filter(Boolean)
    const seen = new Set()
    const unique = []
    for (const value of rawValues) {
      if (seen.has(value)) continue
      seen.add(value)
      unique.push(value)
    }
    return { rawValues, unique }
  }

  function inferStyleFromSkuCode(value) {
    const code = compact(value)
    return /^\d{12,}$/.test(code) ? code.slice(0, 12) : ''
  }

  function inferColorCodeFromSkc(value, style = '') {
    const code = compact(value)
    const styleCode = compact(style)
    if (!styleCode || !code.startsWith(styleCode)) return ''
    const rest = code.slice(styleCode.length)
    return rest.length >= 5 ? rest.slice(0, 5) : ''
  }

  function inferStyleFromTarget(target) {
    return compact(target?.excelStyle || target?.style)
      || inferStyleFromSkuCode(target?.excelSkuCode || target?.skuCode)
      || inferStyleFromSkuCode(target?.excelSkc || target?.skc)
      || inferStyleFromSkuCode(target?.skcExtCode)
  }

  function inferColorFromTarget(target) {
    const style = inferStyleFromTarget(target)
    return compact(target?.scmColorCode)
      || inferColorCodeFromSkc(target?.excelSkc || target?.skc, style)
      || inferColorCodeFromSkc(target?.excelSkuCode || target?.skuCode, style)
      || inferColorCodeFromSkc(target?.skcExtCode, style)
  }

  function inferSkuCodeFromParts(target, careLabel = {}) {
    const existing = compact(target?.excelSkuCode || target?.skuCode)
    if (existing) return existing
    const skc = compact(target?.scmSkcCode || target?.excelSkc || target?.skc)
    const size = compact(careLabel?.size || target?.excelRepresentativeSize || target?.representativeSize)
    if (skc && size) return `${skc}${size}`
    return compact(target?.skcExtCode)
  }

  function enterpriseCodeFromTarget(target) {
    return compact(target?.enterpriseCode || target?.excelSkuNo || target?.skuNo || target?.skuExtCode)
  }

  function buildOutputFilenameForTarget(target, careLabel = {}) {
    const skuCode = inferSkuCodeFromParts(target, careLabel)
    const enterpriseCode = enterpriseCodeFromTarget(target)
    return `${safeFilename(skuCode, String(target?.productSkcId || 'SKU编码'))}-${safeFilename(enterpriseCode, String(target?.productSkuId || '企业码'))}.pdf`
  }

  function buildEnterpriseCodeWorkflow() {
    const parsedCodes = parseEnterpriseCodes()
    const codes = parsedCodes.unique
    if (!codes.length) return null
    let targets = codes.map((code, index) => ({
      inputMode: 'enterprise_code',
      style: '',
      color: '',
      skc: '',
      representativeSize: '',
      skuCode: '',
      skuNo: code,
      enterpriseCode: code,
      composition: '',
      compositionSource: 'scm_or_manual',
      productLine: '',
      sizeCount: 1,
      status: 'ready',
      reason: '',
      outputFilename: '',
      sourceIndex: index + 1,
    }))
    if (maxSkc > 0) targets = targets.slice(0, maxSkc)
    return {
      mode: 'enterprise_code_create_and_download',
      summary: {
        sourceEnterpriseCodes: codes.length,
        selectedEnterpriseCodes: targets.length,
        exactDuplicateCodesRemoved: parsedCodes.rawValues.length - codes.length,
        maxSkc,
      },
      excelTargets: targets,
    }
  }

  function buildWorkbookWorkflow() {
    const sourceRows = sourceRowsFromParam().map(normalizeWorkbookRow)
      .filter(row => REQUIRED_COLUMNS.some(key => textOf(row[key])))
    if (!sourceRows.length) return null

    const missingColumns = REQUIRED_COLUMNS.filter(key => (
      !sourceRows.some(row => Object.prototype.hasOwnProperty.call(row, key))
    ))
    if (missingColumns.length) {
      return {
        error: `Excel 缺少必填字段：${missingColumns.join('、')}`,
      }
    }

    const seen = new Set()
    const rows = []
    let exactDuplicateRowsRemoved = 0
    for (const row of sourceRows) {
      const key = rowExactKey(row)
      if (seen.has(key)) {
        exactDuplicateRowsRemoved += 1
        continue
      }
      seen.add(key)
      rows.push({ ...row })
    }

    const styleValues = {}
    for (const row of rows) {
      const composition = textOf(row['洗唛成分'])
      if (isMissingComposition(composition)) continue
      const style = compact(row['款号'])
      if (!styleValues[style]) styleValues[style] = new Set()
      styleValues[style].add(composition)
    }

    const resolved = rows.map(row => {
      let composition = textOf(row['洗唛成分'])
      let compositionSource = 'current_row'
      let status = 'ready'
      let reason = ''
      if (isMissingComposition(composition)) {
        const candidates = [...(styleValues[compact(row['款号'])] || [])].sort()
        if (candidates.length === 1) {
          composition = candidates[0]
          compositionSource = 'same_style_unique'
        } else if (candidates.length === 0) {
          compositionSource = 'scm_required'
          status = 'needs_scm'
          reason = 'No nonblank composition under the same 款号'
        } else {
          compositionSource = 'conflict'
          status = 'exception'
          reason = 'Multiple compositions under the same 款号'
        }
      }
      return {
        ...row,
        洗唛成分_解析: composition,
        成分来源: compositionSource,
        状态: status,
        异常原因: reason,
        目标文件名: `${compact(row['SKU编码'])}-${compact(row['SKU货号'])}.pdf`,
      }
    })

    const byIdentifier = {}
    for (const item of resolved) {
      const key = `${compact(item['SKU编码'])}\u001f${compact(item['SKU货号'])}`
      if (!byIdentifier[key]) byIdentifier[key] = []
      byIdentifier[key].push(item)
    }
    for (const items of Object.values(byIdentifier)) {
      const variants = new Set(items.map(rowExactKey))
      if (variants.size <= 1) continue
      for (const item of items) {
        item.状态 = 'exception'
        item.异常原因 = `Non-identical rows share SKU identifiers ${compact(item['SKU编码'])}/${compact(item['SKU货号'])}`
      }
    }

    const selectedRows = resolved.filter(item => !pilotStyle || compact(item['款号']) === pilotStyle)
    const skcGroups = {}
    for (const item of selectedRows) {
      const skc = compact(item['SKC'])
      if (!skcGroups[skc]) skcGroups[skc] = []
      skcGroups[skc].push(item)
    }

    let excelTargets = Object.keys(skcGroups).sort().map(skc => {
      const items = [...skcGroups[skc]].sort((left, right) => (
        sizeSortKey(left['尺码']).localeCompare(sizeSortKey(right['尺码']))
        || compact(left['SKU货号']).localeCompare(compact(right['SKU货号']))
      ))
      const representative = items.find(item => item.状态 === 'ready') || items[0]
      return {
        style: compact(representative['款号']),
        color: textOf(representative['颜色']),
        skc,
        representativeSize: compact(representative['尺码']),
        skuCode: compact(representative['SKU编码']),
        skuNo: compact(representative['SKU货号']),
        composition: textOf(representative['洗唛成分_解析']),
        compositionSource: textOf(representative['成分来源']),
        productLine: textOf(representative['产品线']),
        sizeCount: items.length,
        status: representative.状态,
        reason: representative.异常原因 || '',
        outputFilename: `${compact(representative['SKU编码'])}-${compact(representative['SKU货号'])}.pdf`,
      }
    })
    if (maxSkc > 0) excelTargets = excelTargets.slice(0, maxSkc)

    return {
      mode: 'excel_representative_skc_create_and_download',
      summary: {
        sourceRows: sourceRows.length,
        exactDuplicateRowsRemoved,
        uniqueRows: rows.length,
        selectedRows: selectedRows.length,
        selectedSkc: Object.keys(skcGroups).length,
        readyRows: selectedRows.filter(item => item.状态 === 'ready').length,
        needsScmRows: selectedRows.filter(item => item.状态 === 'needs_scm').length,
        exceptionRows: selectedRows.filter(item => item.状态 === 'exception').length,
        pilotStyle: pilotStyle || '',
        maxSkc,
      },
      excelTargets,
    }
  }

  function safeFilename(value, fallback) {
    return String(value || '')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/^\.+|\.+$/g, '') || fallback
  }

  function visible(element) {
    if (!element || !element.getClientRects?.().length) return false
    const rect = element.getBoundingClientRect?.()
    if (!rect || !rect.width || !rect.height) return false
    const style = getComputedStyle(element)
    return style.display !== 'none' && style.visibility !== 'hidden'
  }

  function centerClick(element, delayMs = 120) {
    if (!element) return null
    try { element.scrollIntoView?.({ block: 'center', inline: 'center' }) } catch (error) {}
    const rect = element.getBoundingClientRect?.()
    if (!rect || !rect.width || !rect.height) return null
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      delay_ms: delayMs,
    }
  }

  function nextPhase(name, sleepMs = 500, nextShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: {
        action: 'next_phase',
        next_phase: name,
        sleep_ms: sleepMs,
        shared: nextShared,
      },
    }
  }

  function cdpTargetEval(expression, nextPhaseName, sleepMs = 500, nextShared = shared, options = {}) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'cdp_target_eval',
        expression,
        target_url_contains: Array.isArray(options.target_url_contains) ? options.target_url_contains : [],
        target_url_regex: options.target_url_regex || '',
        target_types: Array.isArray(options.target_types) ? options.target_types : ['page'],
        shared_key: options.shared_key || '',
        user_gesture: !!options.user_gesture,
        next_phase: nextPhaseName,
        sleep_ms: sleepMs,
        shared: nextShared,
      },
    }
  }

  function complete(data = [], nextShared = shared) {
    return {
      success: true,
      data,
      meta: {
        action: 'complete',
        has_more: false,
        shared: nextShared,
      },
    }
  }

  function fail(message) {
    return { success: false, error: message }
  }

  function safeApiError(error) {
    const name = textOf(error?.name || 'Error')
    const message = textOf(error?.message || error || '未知错误')
      .replace(/(anti-content|authorization|cookie|token)(?:\s*[:=]\s*)?[^\s,;]*/ig, '$1=[redacted]')
      .slice(0, 300)
    return `${name}: ${message}`
  }

  function normalizeDate(value) {
    const raw = textOf(value).replace(/[./]/g, '-')
    const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
    if (!match) return ''
    return [
      match[1],
      String(match[2]).padStart(2, '0'),
      String(match[3]).padStart(2, '0'),
    ].join('-')
  }

  function parseCareSymbolsJson(label) {
    let parsed = null
    try {
      parsed = JSON.parse(String(params.care_symbols_json || '{}'))
    } catch (error) {
      return { error: `${label} 无法解析：${safeApiError(error)}` }
    }
    const fields = ['washing', 'bleaching', 'drying', 'ironing', 'dryCleaning']
    const symbols = {}
    for (const field of fields) {
      const value = Number(parsed?.[field])
      if (!Number.isFinite(value) || value <= 0) {
        return { error: `${label} 缺少有效字段：${field}` }
      }
      symbols[field] = value
    }
    return symbols
  }

  function parseCareSymbols(target) {
    if (careSymbolsMode === 'pilot_defaults') return { ...PILOT_CARE_SYMBOLS }
    if (careSymbolsMode !== 'manual_json' && careSymbolsMode !== 'scm_confirmed_json') {
      return { error: `未知洗护符号模式：${careSymbolsMode || '空'}` }
    }
    return parseCareSymbolsJson(careSymbolsMode === 'scm_confirmed_json' ? 'SCM 已确认洗护符号 JSON' : '洗护符号 JSON')
  }

  function optionArray(value) {
    return Array.isArray(value) ? value.map(textOf).filter(Boolean) : []
  }

  function chooseTemuOption(options, requested, fieldName) {
    const values = optionArray(options)
    const wanted = textOf(requested)
    if (values.length === 0) return { value: wanted, source: 'param_no_temu_options' }
    if (wanted && values.includes(wanted)) return { value: wanted, source: 'param_exact_temu_option' }
    if (values.length === 1) return { value: values[0], source: 'single_temu_option' }
    return {
      error: `${fieldName} 未命中 TEMU 回读选项，请在参数中填写完全一致的值`,
      options: values,
    }
  }

  function parseSimpleComposition(value, language = 'zh') {
    let text = textOf(value)
      .replace(/（[^）]*）/g, ' ')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) return { error: 'empty_composition' }
    const firstPart = text.split(/[;；]/)[0]
    if (/袋布|里料|辅料|配料|其他|绣花|罗纹|填充物|Pocket|Lining|Other|Rib|Embroidery/i.test(firstPart)) {
      return { error: 'multi_part_composition' }
    }
    text = firstPart.replace(/^[^:：]{0,12}[:：]\s*/u, ' ')
    const parts = []
    const regex = language === 'en'
      ? /(\d+(?:\.\d+)?)\s*%\s*([A-Za-z][A-Za-z\s/-]*?)(?=\s+\d+(?:\.\d+)?\s*%|$)/g
      : /(\d+(?:\.\d+)?)\s*%\s*([\u4e00-\u9fa5A-Za-z]+)/g
    let match = null
    while ((match = regex.exec(text))) {
      const proportion = Number(match[1])
      const name = textOf(match[2]).replace(/(及以上|以下)$/g, '')
      if (Number.isFinite(proportion) && proportion > 0 && name) {
        parts.push({ name, proportion: String(proportion).replace(/\.0$/, '') })
      }
    }
    const total = parts.reduce((sum, part) => sum + Number(part.proportion || 0), 0)
    if (!parts.length) return { error: 'no_percent_materials' }
    if (Math.abs(total - 100) > 0.5) return { error: `composition_total_${total}` }
    return { parts }
  }

  function cloneMaterialWithPart(template, part, language = 'zh') {
    const row = template && typeof template === 'object' ? { ...template } : {}
    const hadKeys = Object.keys(row).length > 0
    if ('name' in row || language === 'zh') row.name = part.name
    if ('propValue' in row || language === 'en') row.propValue = part.name
    if ('proportion' in row || !hadKeys) row.proportion = part.proportion
    if ('proportionValue' in row) row.proportionValue = part.proportion
    return row
  }

  function buildMaterialOverride(care, target) {
    if (scmCompositionMode === 'evidence_only') {
      return { mode: 'evidence_only' }
    }
    const composition = textOf(target?.excelComposition)
    if (!composition || target?.excelCompositionSource !== 'scm_qc_wash_appr_page') {
      return { mode: 'temu_existing' }
    }
    const zh = parseSimpleComposition(composition, 'zh')
    if (!zh.parts) {
      return { mode: 'scm_evidence_only_unparsed', reason: zh.error, composition }
    }
    const en = parseSimpleComposition(target?.scmEnglishComposition || target?.excelEnglishComposition || '', 'en')
    const materialInfoList = zh.parts.map((part, index) => (
      cloneMaterialWithPart(Array.isArray(care?.materialInfoList) ? care.materialInfoList[index] : null, part, 'zh')
    ))
    const i18nTemplates = Array.isArray(care?.materialI18nInfoList) ? care.materialI18nInfoList : []
    const englishParts = en.parts && en.parts.length === zh.parts.length ? en.parts : zh.parts
    const materialI18nInfoList = englishParts.map((part, index) => (
      cloneMaterialWithPart(i18nTemplates[index] || i18nTemplates[0] || { lan: 'en' }, part, 'en')
    ))
    return {
      mode: 'scm_safe_simple_applied',
      materialInfoList,
      materialI18nInfoList,
      composition,
    }
  }

  function resolvedLabelLength(care) {
    const temuLength = Number(care?.len || 0)
    if (!Number.isFinite(temuLength) || temuLength <= 0) return labelLengthMm
    return Math.max(temuLength, labelLengthMm)
  }

  function sanitizeCareInitial(care) {
    const ukfr = care?.ukfrInfo || {}
    return {
      productId: Number(care?.productId || 0),
      productSkuId: Number(care?.productSkuId || 0),
      productSkcId: Number(care?.productSkcId || 0),
      width: Number(care?.width || 0),
      len: Number(care?.len || 0),
      padding: Number(care?.padding || 0),
      size: textOf(care?.size),
      manufacturerName: textOf(care?.manufacturerName),
      manufacturerAddressPg: textOf(care?.manufacturerAddressPg),
      manufacturerNameOptions: optionArray(care?.manufacturerNameOptions),
      manufacturerAddressOptions: optionArray(care?.manufacturerAddressOptions),
      showTrackingLabel: care?.showTrackingLabel,
      showNonTxtDesPG: care?.showNonTxtDesPG,
      showToyFireAlarmPG: care?.showToyFireAlarmPG,
      showCarpetWarningPG: care?.showCarpetWarningPG,
      showCEMarkingPG: care?.showCEMarkingPG,
      showSpanishVatNoPG: care?.showSpanishVatNoPG,
      ukfrInfo: {
        showWarningPG: ukfr.showWarningPG,
        showComplianceEntityPG: ukfr.showComplianceEntityPG,
        showEntityDatePG: ukfr.showEntityDatePG,
        showFillingMaterialsPG: ukfr.showFillingMaterialsPG,
        showCoveringMaterialsPG: ukfr.showCoveringMaterialsPG,
        showBatchNumberPG: ukfr.showBatchNumberPG,
        showIncludeSchedule3InterLinerPG: ukfr.showIncludeSchedule3InterLinerPG,
      },
      materialInfoCount: Array.isArray(care?.materialInfoList) ? care.materialInfoList.length : 0,
      materialI18nInfoCount: Array.isArray(care?.materialI18nInfoList) ? care.materialI18nInfoList.length : 0,
      qrCodePresent: !!care?.qrCode,
    }
  }

  function buildCarePayload(care, target) {
    const symbols = parseCareSymbols(target)
    if (symbols.error) return symbols
    if (
      careSymbolsMode === 'pilot_defaults'
      && compact(target?.excelStyle || target?.skcExtCode).slice(0, PILOT_STYLE.length) !== PILOT_STYLE
    ) {
      return { error: '当前选择“试点已确认符号”，但目标款号不是 209225117208；请改用人工 JSON 符号或人工确认 SCM 附件。' }
    }

    const manufacturerName = chooseTemuOption(care?.manufacturerNameOptions, manufacturerNameParam, '制造商名称')
    if (manufacturerName.error) return manufacturerName
    const manufacturerAddress = chooseTemuOption(care?.manufacturerAddressOptions, manufacturerAddressParam, '制造商地址')
    if (manufacturerAddress.error) return manufacturerAddress
    const productionDate = normalizeDate(productionDateParam)
    if (!productionDate) return { error: `生产日期格式无效：${productionDateParam}` }

    const showTrackingLabel = care?.showTrackingLabel !== false
    const ukfr = care?.ukfrInfo || {}
    const materialOverride = buildMaterialOverride(care, target)
    return {
      payload: {
        productSkuId: Number(target.productSkuId || 0),
        productSkcId: Number(target.productSkcId || 0),
        productId: Number(target.productId || 0),
        manufacturerName: showTrackingLabel ? manufacturerName.value : void 0,
        manufacturerAddressPg: manufacturerAddress.value,
        batchNumber: showTrackingLabel ? batchNumberParam : void 0,
        productionDate: showTrackingLabel ? productionDate : void 0,
        isSkipRisk: false,
        washing: symbols.washing,
        bleaching: symbols.bleaching,
        drying: symbols.drying,
        ironing: symbols.ironing,
        dryCleaning: symbols.dryCleaning,
        len: resolvedLabelLength(care),
        width: Number(care?.width || 0) || labelWidthMm,
        showSize: care?.showSize == null ? void 0 : care.showSize === true,
        padding: Number(care?.padding || 0) || labelPaddingMm,
        showLocalSize: care?.showLocalSize == null ? void 0 : care.showLocalSize === true,
        showNonTxtDes: care?.showNonTxtDes === true,
        showToyFireAlarm: care?.showToyFireAlarm === true,
        showCarpetWarning: care?.showCarpetWarning === true,
        showCEMarking: care?.showCEMarking === true,
        ukfrInfo: {
          showWarning: ukfr.showWarning === true,
          complianceEntityType: ukfr.entityName ? ukfr.complianceEntityType : void 0,
          entityName: ukfr.entityName ? textOf(ukfr.entityName) : '',
          entityPostalCode: ukfr.entityName ? textOf(ukfr.entityPostalCode) : void 0,
          entityDateType: ukfr.entityDate ? ukfr.entityDateType : void 0,
          entityDate: ukfr.entityDate ? normalizeDate(ukfr.entityDate) : '',
          fillingMaterials: ukfr.fillingMaterials ? textOf(ukfr.fillingMaterials) : '',
          coveringMaterials: ukfr.coveringMaterials ? textOf(ukfr.coveringMaterials) : '',
          batchNumber: ukfr.batchNumber ? textOf(ukfr.batchNumber) : '',
          includeSchedule3InterLiner: ukfr.includeSchedule3InterLiner == null ? void 0 : ukfr.includeSchedule3InterLiner === true,
        },
        ingLangs: Array.isArray(care?.ingLangs) && care.ingLangs.length ? care.ingLangs : DEFAULT_ING_LANGS,
        materialInfoList: materialOverride.materialInfoList || care?.materialInfoList,
        materialI18nInfoList: materialOverride.materialI18nInfoList || care?.materialI18nInfoList,
      },
      summary: {
        manufacturerName: manufacturerName.value,
        manufacturerNameSource: manufacturerName.source,
        manufacturerAddressPg: manufacturerAddress.value,
        manufacturerAddressSource: manufacturerAddress.source,
        productionDate,
        batchNumber: batchNumberParam,
        careSymbols: symbols,
        width: Number(care?.width || 0) || labelWidthMm,
        len: resolvedLabelLength(care),
        padding: Number(care?.padding || 0) || labelPaddingMm,
        lengthStrategy: 'minimum_for_full_qr',
        requestedMinimumLen: labelLengthMm,
        careSymbolsMode,
        compositionMode: materialOverride.mode,
        compositionModeReason: materialOverride.reason || '',
        compositionSource: textOf(target?.excelCompositionSource),
        composition: textOf(target?.excelComposition),
      },
    }
  }

  function isSaveExplicitlyEnabled() {
    return executeMode === SAVE_MODE && allowSave
  }

  function pagePostRequest() {
    const chunks = window.chunkLoadingGlobal_temu_sca_goods
    if (!Array.isArray(chunks)) {
      throw new Error('TEMU 页面请求模块尚未加载')
    }
    let webpackRequire = null
    const chunkId = `crawshrimp-wash-label-${Date.now()}-${Math.random().toString(36).slice(2)}`
    chunks.push([[chunkId], {}, runtime => { webpackRequire = runtime }])
    if (typeof webpackRequire !== 'function') {
      throw new Error('TEMU 页面 webpack 运行时不可用')
    }
    let requestModule = null
    try {
      requestModule = webpackRequire(45689)
    } catch (error) {}
    if (typeof requestModule?.b !== 'function') {
      const candidateId = Object.keys(webpackRequire.m || {}).find(moduleId => {
        const source = String(webpackRequire.m[moduleId] || '')
        return source.length < 800
          && source.includes('.Gk)(')
          && source.includes('.Jt')
          && source.includes('.bE')
          && source.includes('{b:')
      })
      if (candidateId) {
        try {
          requestModule = webpackRequire(candidateId)
        } catch (error) {}
      }
    }
    const post = requestModule?.b
    if (typeof post !== 'function') {
      throw new Error('TEMU 页面 POST 请求封装不可用')
    }
    return post
  }

  async function pagePost(path, payload) {
    class PassthroughResponse {}
    const post = pagePostRequest()
    return await post(PassthroughResponse, path, payload, { skipCheck: true })
  }

  function responseData(response) {
    return response?.res ?? response ?? {}
  }

  function normalizeApiRecord(item) {
    const labelCodeVO = item?.labelCodeVO || {}
    const requirement = item?.labelRequirement || {}
    return {
      productId: Number(item?.productId || 0),
      productSkuId: Number(labelCodeVO.productSkuId || 0),
      productSkcId: Number(labelCodeVO.productSkcId || 0),
      labelCode: Number(labelCodeVO.labelCode || 0),
      skcExtCode: compact(labelCodeVO.skcExtCode),
      skuExtCode: compact(labelCodeVO.skuExtCode),
      productName: textOf(item?.productName),
      labelType: Number(requirement.labelType || 0),
      cosmeticLabelStatus: Number(requirement.cosmeticLabelStatus || 0),
      needCosmeticLabel: requirement.needCosmeticLabel === true,
    }
  }

  function isDownloadable(record) {
    return !!(
      record?.productId
      && record?.productSkuId
      && record?.productSkcId
      && record?.labelCode
      && record?.skcExtCode
      && record?.skuExtCode
      && record.needCosmeticLabel
      && record.labelType === 3
      && record.cosmeticLabelStatus === 2
    )
  }

  function isCareLabelRequired(record) {
    return !!(
      record?.productId
      && record?.productSkuId
      && record?.productSkcId
      && record?.labelCode
      && record?.skuExtCode
      && record.needCosmeticLabel
      && record.labelType === 3
    )
  }

  function isPendingCreatable(record) {
    return isCareLabelRequired(record) && record.cosmeticLabelStatus !== 2
  }

  function targetKey(target) {
    return [
      Number(target?.labelCode || 0),
      Number(target?.productSkcId || 0),
      Number(target?.productSkuId || 0),
      compact(target?.skuExtCode),
    ].join('|')
  }

  function mergeTargets(existing, incoming) {
    const seen = new Set()
    const merged = []
    for (const item of [...(existing || []), ...(incoming || [])]) {
      if (!isDownloadable(item)) continue
      const key = targetKey(item)
      if (!key || seen.has(key)) continue
      seen.add(key)
      merged.push({ ...item })
    }
    return merged
  }

  function assignOutputFilenames(targets) {
    const bases = targets.map(target => buildOutputFilenameForTarget(target).replace(/\.pdf$/i, ''))
    const counts = bases.reduce((result, base) => {
      result[base] = Number(result[base] || 0) + 1
      return result
    }, {})
    return targets.map((target, index) => ({
      ...target,
      outputFilename: counts[bases[index]] > 1
        ? `${bases[index]}-${safeFilename(target.labelCode, 'TEMU标签编码')}.pdf`
        : `${bases[index]}.pdf`,
    }))
  }

  function apiTargets() {
    return Array.isArray(shared.apiTargets) ? shared.apiTargets : []
  }

  function apiTarget() {
    const targets = apiTargets()
    const index = Math.max(0, Number(shared.currentTargetIndex || 0))
    const target = shared.apiTarget || targets[index] || {}
    return {
      productId: Number(target.productId || 0),
      productSkuId: Number(target.productSkuId || 0),
      productSkcId: Number(target.productSkcId || 0),
      labelCode: Number(target.labelCode || 0),
      skcExtCode: compact(target.skcExtCode),
      skuExtCode: compact(target.skuExtCode),
      productName: textOf(target.productName),
      labelType: Number(target.labelType || 0),
      cosmeticLabelStatus: Number(target.cosmeticLabelStatus || 0),
      needCosmeticLabel: target.needCosmeticLabel === true,
      outputFilename: textOf(target.outputFilename),
      enterpriseCode: compact(target.enterpriseCode),
      inputMode: textOf(target.inputMode),
      excelStyle: compact(target.excelStyle || target.style),
      excelColor: textOf(target.excelColor || target.color),
      excelSkc: compact(target.excelSkc || target.skc),
      excelSkuCode: compact(target.excelSkuCode || target.skuCode),
      excelSkuNo: compact(target.excelSkuNo || target.skuNo),
      excelRepresentativeSize: compact(target.excelRepresentativeSize || target.representativeSize),
      excelSizeCount: Number(target.excelSizeCount || target.sizeCount || 0),
      excelComposition: textOf(target.excelComposition || target.composition),
      excelEnglishComposition: textOf(target.excelEnglishComposition),
      excelCompositionSource: textOf(target.excelCompositionSource || target.compositionSource),
      excelProductLine: textOf(target.excelProductLine || target.productLine),
      scmOrderNo: textOf(target.scmOrderNo),
      scmStatus: textOf(target.scmStatus),
      scmColorCode: compact(target.scmColorCode),
      scmColorName: textOf(target.scmColorName),
      scmResult: textOf(target.scmResult),
      scmRemark: textOf(target.scmRemark),
      scmWashFile: textOf(target.scmWashFile),
      scmHangTagFile: textOf(target.scmHangTagFile),
      scmCareInstructionText: textOf(target.scmCareInstructionText),
      scmCareInstructionSource: textOf(target.scmCareInstructionSource),
    }
  }

  function excelTargets() {
    return Array.isArray(shared.excelTargets) ? shared.excelTargets : []
  }

  function excelTarget() {
    const targets = excelTargets()
    const index = Math.max(0, Number(shared.currentExcelTargetIndex || 0))
    return shared.excelTarget || targets[index] || {}
  }

  function excelMode() {
    return Array.isArray(shared.excelTargets)
  }

  function advancePhaseName() {
    return excelMode() ? 'advance_excel_target' : 'advance_target'
  }

  function currentStoreName() {
    const account = [...document.querySelectorAll('[class*="account-info_accountInfo"]')]
      .find(visible)
    if (!account) return ''
    return textOf(account)
  }

  function resultRow(result, reason = '', extra = {}, explicitTarget = null, rowShared = shared) {
    const target = explicitTarget || apiTarget()
    const currentExcelTarget = excelTarget()
    const targetIndex = excelMode()
      ? Math.max(0, Number(rowShared.currentExcelTargetIndex || 0))
      : Math.max(0, Number(rowShared.currentTargetIndex || 0))
    const batchTotal = excelMode() ? excelTargets().length : apiTargets().length
    return {
      店铺: currentStoreName() || targetStore,
      批量序号: batchTotal ? targetIndex + 1 : 0,
      批量总数: batchTotal,
      接口扫描总记录: Number(rowShared.scanTotalRecords || 0),
      已制作洗水唛数量: Number(rowShared.apiMadeWashLabelCount || 0),
      款号: compact(target?.excelStyle || currentExcelTarget.style),
      SKC: compact(target?.excelSkc || currentExcelTarget.skc),
      颜色: textOf(target?.excelColor || currentExcelTarget.color),
      代表尺码: compact(target?.excelRepresentativeSize || currentExcelTarget.representativeSize),
      尺码数: Number(target?.excelSizeCount || currentExcelTarget.sizeCount || 0),
      SKU编码: inferSkuCodeFromParts(target) || compact(currentExcelTarget.skuCode),
      SKU货号: compact(target?.excelSkuNo || currentExcelTarget.skuNo || target?.skuExtCode),
      企业码: enterpriseCodeFromTarget(target) || compact(currentExcelTarget.enterpriseCode),
      TEMU行状态: String(extra.temuRowStatus || rowShared.temuRowStatus || ''),
      请求格式: 'PDF',
      下载模式: downloadAfterSave ? 'official_after_create' : 'no_download',
      执行模式: executeMode,
      保存已授权: isSaveExplicitlyEnabled(),
      结果: result,
      来源: String(extra.source || (result === 'official_download_received' ? 'temu_official_download' : result)),
      文件名: textOf(target?.outputFilename),
      文件路径: String(extra.path || ''),
      文件大小: Number(extra.bytes || 0),
      PDF签名已校验: !!extra.signatureValidated,
      页面API已校验: !!rowShared.apiValidated,
      TEMU产品ID: Number(target?.productId || 0),
      TEMU商品SKU_ID: Number(target?.productSkuId || 0),
      TEMU商品SKC_ID: Number(target?.productSkcId || 0),
      TEMU标签编码: Number(target?.labelCode || 0),
      SCM查询状态: String(extra.SCM查询状态 || rowShared.scmLookupStatus || ''),
      SCM申请单号: String(extra.SCM申请单号 || target?.scmOrderNo || ''),
      SCM状态: String(extra.SCM状态 || target?.scmStatus || ''),
      SCM色号: String(extra.SCM色号 || target?.scmColorCode || ''),
      SCM色名: String(extra.SCM色名 || target?.scmColorName || ''),
      SCM判定结果: String(extra.SCM判定结果 || target?.scmResult || ''),
      SCM判定备注: String(extra.SCM判定备注 || target?.scmRemark || ''),
      SCM洗唛文件: String(extra.SCM洗唛文件 || target?.scmWashFile || ''),
      洗水唛宽度mm: Number(rowShared.carePayloadSummary?.width || rowShared.careLabel?.width || 0),
      洗水唛长度mm: Number(rowShared.carePayloadSummary?.len || rowShared.careLabel?.len || 0),
      上下预留mm: Number(rowShared.carePayloadSummary?.padding || rowShared.careLabel?.padding || 0),
      洗水唛尺码: String(rowShared.careLabel?.size || ''),
      洗护符号模式: String(rowShared.carePayloadSummary?.careSymbolsMode || careSymbolsMode),
      洗护符号: rowShared.carePayloadSummary?.careSymbols ? JSON.stringify(rowShared.carePayloadSummary.careSymbols) : '',
      制造商名称: String(rowShared.carePayloadSummary?.manufacturerName || ''),
      制造商地址: String(rowShared.carePayloadSummary?.manufacturerAddressPg || ''),
      生产日期: String(rowShared.carePayloadSummary?.productionDate || ''),
      批次号: String(rowShared.carePayloadSummary?.batchNumber || ''),
      洗唛成分: textOf(target?.excelComposition || currentExcelTarget.composition),
      成分来源: textOf(target?.excelCompositionSource || currentExcelTarget.compositionSource),
      产品线: textOf(target?.excelProductLine || currentExcelTarget.productLine),
      原因: String(reason || ''),
      ...extra,
    }
  }

  function resetTargetState(nextShared) {
    return {
      ...nextShared,
      careLabel: null,
      careInitial: null,
      carePayload: null,
      carePayloadSummary: null,
      saveResult: null,
      downloadResult: null,
      temuRowStatus: String(nextShared.temuRowStatus || ''),
      careQueryAttempts: 0,
      careLastError: '',
      carePayloadAttempts: 0,
      saveAttempts: 0,
      saveLastError: '',
      postSaveLookupAttempts: 0,
      scmLookupAttempts: 0,
      scmLookupResult: null,
      scmLookupStatus: '',
      scmRows: [],
      scmSelectedRow: null,
      scmLookupLastError: '',
      searchControlAttempts: 0,
      searchAttempts: 0,
      queriedSkuNo: '',
      matchedRowText: '',
      exportModalAttempts: 0,
      exportConfirmAttempts: 0,
      officialDownloadPath: '',
      officialDownloadReceived: false,
      officialDownloadError: '',
    }
  }

  function attachExcelTarget(record, target) {
    const attached = {
      ...target,
      ...record,
      enterpriseCode: compact(target?.enterpriseCode || target?.skuNo || target?.excelSkuNo || record?.skuExtCode),
      inputMode: textOf(target?.inputMode || ''),
      excelStyle: compact(target?.style || target?.excelStyle) || inferStyleFromSkuCode(target?.skuCode || target?.excelSkuCode || record?.skcExtCode),
      excelColor: textOf(target?.color || target?.excelColor),
      excelSkc: compact(target?.skc || target?.excelSkc),
      excelSkuCode: compact(target?.skuCode || target?.excelSkuCode),
      excelSkuNo: compact(target?.skuNo || target?.excelSkuNo),
      excelRepresentativeSize: compact(target?.representativeSize || target?.excelRepresentativeSize),
      excelSizeCount: Number(target?.sizeCount || target?.excelSizeCount || 0),
      excelComposition: textOf(target?.composition || target?.excelComposition),
      excelCompositionSource: textOf(target?.compositionSource || target?.excelCompositionSource),
      excelProductLine: textOf(target?.productLine || target?.excelProductLine),
    }
    attached.outputFilename = textOf(target?.outputFilename) || buildOutputFilenameForTarget(attached)
    return attached
  }

  function continueAfterFailure(reason, extra = {}, nextShared = shared) {
    return nextPhase(
      advancePhaseName(),
      100,
      { ...nextShared, temuRowStatus: String(extra.temuRowStatus || '单条失败') },
      [resultRow('official_download_failed', reason, extra)],
    )
  }

  function shouldLookupScm(target) {
    return !!(scmLookupEnabled && inferStyleFromTarget(target))
  }

  function attachScmEvidence(target, evidence) {
    const row = evidence.selected || {}
    const nextTarget = {
      ...target,
      excelStyle: inferStyleFromTarget(target) || row.style || compact(target?.excelStyle),
      excelColor: textOf(row.colorName || target?.excelColor || target?.color),
      excelSkc: compact(row.skcCode || target?.excelSkc || target?.skc),
      excelComposition: textOf(evidence.composition || target?.excelComposition || target?.composition),
      excelCompositionSource: 'scm_qc_wash_appr_page',
      excelEnglishComposition: textOf(evidence.englishComposition || target?.excelEnglishComposition),
      scmOrderNo: textOf(row.orderNo),
      scmStatus: textOf(row.hStatusDisplay),
      scmColorCode: compact(row.colorCode),
      scmColorName: textOf(row.colorName),
      scmResult: Number.isFinite(Number(row.skcResult)) ? String(row.skcResult) : '',
      scmRemark: textOf(row.skcRemark),
      scmWashFile: textOf(row.washFileUrl),
      scmHangTagFile: textOf(row.hangTagFileUrl),
      scmCareInstructionText: textOf(evidence.careInstructionText),
      scmCareInstructionSource: textOf(evidence.careInstructionSource),
    }
    nextTarget.outputFilename = buildOutputFilenameForTarget(nextTarget)
    return nextTarget
  }

  function nextPhaseAfterTemuLookup(apiRecord, nextShared) {
    return nextPhase(shouldLookupScm(apiRecord) ? 'scm_lookup_target' : 'api_care_query', 150, resetTargetState({
      ...nextShared,
      apiTarget: apiRecord,
    }))
  }

  function finalizeScan(nextShared) {
    let targets = assignOutputFilenames(nextShared.apiTargets || [])
    if (maxDownloads > 0) targets = targets.slice(0, maxDownloads)
    const scanShared = {
      ...nextShared,
      apiValidated: true,
      apiTargets: targets,
      apiMadeWashLabelCount: targets.length,
      currentTargetIndex: 0,
      apiTarget: targets[0] || null,
      scanCompleted: !nextShared.scanStoppedByLimit,
    }
    if (!targets.length) {
      return complete([
        resultRow('batch_no_downloadable', '当前店铺未找到“已制作且可导出”的洗水唛', {
          temuRowStatus: '无可下载记录',
        }, {}),
      ], scanShared)
    }
    return nextPhase('api_care_query', 150, resetTargetState(scanShared))
  }

  async function mapWithConcurrency(values, concurrency, worker) {
    const results = new Array(values.length)
    let nextIndex = 0
    async function runWorker() {
      while (nextIndex < values.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await worker(values[index], index)
      }
    }
    const count = Math.max(1, Math.min(Number(concurrency || 1), values.length || 1))
    await Promise.all(Array.from({ length: count }, () => runWorker()))
    return results
  }

  async function queryApiPage(page) {
    const response = await pagePost('/visage-agent-seller/labelcode/pageQuery', {
      page,
      pageSize: API_PAGE_SIZE,
    })
    const payload = responseData(response)
    const pageItems = Array.isArray(payload.pageItems) ? payload.pageItems : []
    return {
      page,
      total: Number(payload.total || 0),
      records: pageItems.map(normalizeApiRecord),
    }
  }

  function targetStoreSection(modal) {
    const sections = [...modal.querySelectorAll('[class*="account-info_mallSection"]')]
    return sections.find(section => {
      const name = section.querySelector('[class*="account-info_mallName"]')
      return textOf(name) === targetStore
    }) || null
  }

  function storeSwitchModal() {
    return [...document.querySelectorAll('[data-testid="beast-core-modal"]')]
      .filter(visible)
      .find(modal => textOf(modal).includes('切换店铺')) || null
  }

  function openStoreDropdown() {
    const account = [...document.querySelectorAll('[class*="account-info_accountInfo"]')]
      .find(visible)
    if (!account) return false
    account.click?.()
    return true
  }

  function findDropdownSwitchButton() {
    return [...document.querySelectorAll('[class*="account-info_operatorBtn"]')]
      .filter(visible)
      .find(element => textOf(element) === '切换' && !element.disabled) || null
  }

  function findSkuSearchInput() {
    const candidates = [...document.querySelectorAll('input[placeholder="多个查询请空格或逗号依次输入"]')]
      .filter(visible)
    const relatedToSku = candidates.find(input => {
      let parent = input.parentElement
      for (let depth = 0; parent && depth < 7; depth += 1, parent = parent.parentElement) {
        const inputs = [...parent.querySelectorAll('input')]
        if (inputs.some(candidate => compact(candidate.value) === 'SKU')) return true
      }
      return false
    })
    return relatedToSku || (candidates.length >= 2 ? candidates[1] : candidates[0]) || null
  }

  function setInputValue(input, value) {
    if (!input) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (setter) setter.call(input, value)
    else input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return input.value === value
  }

  function findQueryButton() {
    return [...document.querySelectorAll('button')]
      .filter(visible)
      .find(button => textOf(button) === '查询' && !button.disabled) || null
  }

  function matchingRows() {
    const skuNo = apiTarget().skuExtCode
    if (!skuNo) return []
    return [...document.querySelectorAll('tr')]
      .filter(row => textOf(row).includes(skuNo))
  }

  function apiIdentityRows() {
    const target = apiTarget()
    const requiredTokens = [
      target.labelCode,
      target.productSkcId,
      target.productSkuId,
      target.skuExtCode,
    ].map(value => String(value || '')).filter(Boolean)
    if (requiredTokens.length < 4) return []
    return matchingRows().filter(row => {
      const tokens = textOf(row).split(/\s+/).filter(Boolean)
      return requiredTokens.every(token => tokens.includes(token))
    })
  }

  function madeWashLabelRow() {
    const rows = apiIdentityRows().filter(row => {
      const rowText = textOf(row)
      if (!rowText.includes('已制作') || !rowText.includes('洗水唛')) return false
      return [...row.querySelectorAll('a,button,[role="button"]')]
        .some(action => textOf(action) === '导出')
    })
    return rows.length === 1 ? rows[0] : null
  }

  function exportAction(row) {
    return [...row.querySelectorAll('a,button,[role="button"]')]
      .find(action => visible(action) && textOf(action) === '导出') || null
  }

  function exportModal() {
    return [...document.querySelectorAll('[data-testid="beast-core-modal"]')]
      .filter(visible)
      .find(modal => textOf(modal).includes('确认导出吗？')) || null
  }

  function exportFormatLabel(modal, labelText) {
    return [...modal.querySelectorAll('label[data-testid="beast-core-checkbox"]')]
      .find(label => textOf(label) === labelText) || null
  }

  function isChecked(label) {
    if (!label) return false
    if (label.getAttribute?.('data-checked') === 'true') return true
    return !!label.querySelector?.('input[type="checkbox"]')?.checked
  }

  function temuPdfUrlBlobExpression() {
    return `
(async () => {
  const compact = value => String(value || '').replace(/\\s+/g, ' ').trim();
  const toBase64 = bytes => {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  };
  const modal = [...document.querySelectorAll('[data-testid="beast-core-modal"]')]
    .find(element => compact(element.innerText || element.textContent).includes('确认导出吗'));
  if (!modal) return { success: false, error: 'TEMU export modal not found' };
  const canvas = modal.querySelector('canvas');
  const fiberKey = Object.keys(modal).find(key => key.startsWith('__reactFiber'));
  let fiber = fiberKey ? modal[fiberKey] : null;
  let pdfUrl = '';
  for (let depth = 0; fiber && depth < 30; depth += 1, fiber = fiber.return) {
    if (fiber.memoizedProps && typeof fiber.memoizedProps.pdfUrl === 'string') {
      pdfUrl = fiber.memoizedProps.pdfUrl;
      break;
    }
  }
  if (!pdfUrl || !pdfUrl.startsWith('blob:')) {
    return { success: false, error: 'TEMU export modal pdfUrl not found' };
  }
  const response = await fetch(pdfUrl);
  const blob = await response.blob();
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(...bytes.slice(0, 5));
  return {
    success: true,
    data: [{
      url: pdfUrl,
      type: blob.type || '',
      bytes: bytes.length,
      magic,
      canvasWidth: Number(canvas?.width || 0),
      canvasHeight: Number(canvas?.height || 0),
      base64: toBase64(bytes),
    }],
  };
})()
`.trim()
  }

  function bestDownloadItem(downloadResult) {
    const items = Array.isArray(downloadResult?.items) ? downloadResult.items : []
    return items.find(item => item?.success && item?.signatureValidated && item?.path)
      || items.find(item => item?.success && item?.path)
      || items[0]
      || null
  }

  function scmBrandFilter() {
    const mode = scmBrandMode || 'auto'
    if (mode === 'any' || mode === 'none' || mode === 'all') return null
    if (mode === 'auto') return SCM_BRAND_BY_STORE[targetStore] || null
    const codeToLabel = {
      10: '森马',
      20: '巴拉巴拉',
      23: 'mini bala',
      28: '森马儿童',
    }
    return { code: mode, label: codeToLabel[mode] || mode }
  }

  function scmStatusText(value) {
    const status = Number(value)
    if (status === 100) return '已完成'
    if (status === 10) return '待确认'
    if (status === 5) return '已退回'
    if (status === 0) return '草稿'
    return Number.isFinite(status) ? String(status) : textOf(value)
  }

  function normalizeScmRow(row) {
    return {
      orderNo: textOf(row?.ORDER_NO),
      brand: compact(row?.BRAND),
      brandDisplay: textOf(row?.BRAND_DISPLAY),
      style: compact(row?.P_MAT_CODE),
      styleName: textOf(row?.P_MAT_NAME),
      skcCode: compact(row?.SKC_CODE),
      colorCode: compact(row?.F1),
      colorName: textOf(row?.F1_DISPLAY),
      cComponent: textOf(row?.C_COMPONENT),
      eComponent: textOf(row?.E_COMPONENT),
      hStatus: Number(row?.H_STATUS),
      hStatusDisplay: scmStatusText(row?.H_STATUS),
      skcResult: Number(row?.SKC_RESULT),
      skcRemark: textOf(row?.SKC_REMARK),
      washFileUrl: textOf(row?.SKC_FILE_URL1),
      hangTagFileUrl: textOf(row?.SKC_FILE_URL2),
      lastModifiedTime: textOf(row?.LAST_MODIFIED_TIME),
      treeLevel: textOf(row?.TREE_LEVEL),
    }
  }

  function uniqueNonblank(values) {
    const seen = new Set()
    const out = []
    for (const value of values.map(textOf).filter(Boolean)) {
      if (seen.has(value)) continue
      seen.add(value)
      out.push(value)
    }
    return out
  }

  function selectScmEvidence(rawRows, target) {
    const rows = (Array.isArray(rawRows) ? rawRows : [])
      .map(normalizeScmRow)
      .filter(row => row.style === inferStyleFromTarget(target))
      .filter(row => row.treeLevel !== '1')
    const brand = scmBrandFilter()
    const brandRows = brand?.code
      ? rows.filter(row => row.brand === brand.code || row.brandDisplay === brand.label)
      : rows
    const completedRows = brandRows.filter(row => row.hStatus === 100)
    const statusRows = scmOnlyCompleted ? completedRows : (completedRows.length ? completedRows : brandRows)
    const colorCode = inferColorFromTarget(target)
    const colorRows = colorCode
      ? statusRows.filter(row => row.colorCode === colorCode || row.skcCode.endsWith(colorCode) || row.skcCode.includes(`${row.style}${colorCode}`))
      : statusRows
    const candidateRows = colorRows.length ? colorRows : statusRows
    if (!rows.length) {
      return { error: `SCM 未查到款号 ${inferStyleFromTarget(target)} 的洗唛批复判定记录`, rows, brandRows, completedRows }
    }
    if (brand?.code && !brandRows.length) {
      return { error: `SCM 查到款号，但没有匹配店铺品牌 ${brand.label || brand.code} 的记录`, rows, brandRows, completedRows }
    }
    if (scmOnlyCompleted && !completedRows.length) {
      return { error: 'SCM 查到款号，但没有状态“已完成”的记录', rows, brandRows, completedRows }
    }
    if (!candidateRows.length) {
      return { error: colorCode ? `SCM 没有匹配色号 ${colorCode} 的记录` : 'SCM 没有可用候选记录', rows, brandRows, completedRows }
    }
    const compositions = uniqueNonblank(candidateRows.map(row => row.cComponent))
    if (!compositions.length) {
      return { error: 'SCM 候选记录缺少中文成分', rows, brandRows, completedRows, candidateRows }
    }
    if (compositions.length > 1) {
      return {
        error: 'SCM 候选记录存在多个中文成分，未自动选择',
        rows,
        brandRows,
        completedRows,
        candidateRows,
        compositions,
      }
    }
    const englishCompositions = uniqueNonblank(candidateRows.map(row => row.eComponent))
    const remarks = uniqueNonblank(candidateRows.map(row => row.skcRemark))
    const selected = candidateRows[0]
    return {
      rows,
      brandRows,
      completedRows,
      candidateRows,
      selected,
      composition: compositions[0],
      englishComposition: englishCompositions[0] || '',
      careInstructionText: remarks.join('；'),
      careInstructionSource: remarks.length ? 'scm_skc_remark' : 'missing_structured_wash_instruction',
    }
  }

  function scmLookupExpression(target) {
    const style = inferStyleFromTarget(target)
    const styleJson = JSON.stringify(style)
    return `
(async () => {
  const style = ${styleJson};
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const textOf = value => {
    if (value && typeof value === 'object') {
      return String(value.innerText || value.textContent || '').replace(/\\s+/g, ' ').trim();
    }
    return String(value || '').replace(/\\s+/g, ' ').trim();
  };
  const compact = value => String(value || '').replace(/\\s+/g, '').trim();
  const visible = element => {
    if (!element || !element.getClientRects || !element.getClientRects().length) return false;
    const rect = element.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return false;
    const styleObj = getComputedStyle(element);
    return styleObj.display !== 'none' && styleObj.visibility !== 'hidden';
  };
  const washPageUrl = 'https://scm.semir.com/scm-quality-mgm/index/scm-qc-wash-appr-index';
  if (!style) return { ok: false, reason: 'missing_style', rows: [] };
  if (!/\\/scm-quality-mgm\\/index\\/scm-qc-wash-appr-index(?:$|[?#])/.test(String(location.href || ''))) {
    location.href = washPageUrl;
    return { ok: false, retry: true, reason: 'navigating_to_scm_wash_appr_index', currentUrl: String(location.href || '') };
  }

  function findDataset() {
    const pageEl = document.querySelector('.q-page');
    const start = pageEl && pageEl.__vue__;
    const seen = new Set();
    function visit(comp, depth) {
      if (!comp || depth > 8 || seen.has(comp._uid)) return null;
      seen.add(comp._uid);
      if (comp.$refs && comp.$refs.mainTableContainer) return comp;
      if (comp.$refs && comp.$refs.refDataset && comp.$refs.refDataset.$refs && comp.$refs.refDataset.$refs.mainTableContainer) {
        return comp.$refs.refDataset;
      }
      const children = comp.$children || [];
      for (let i = 0; i < children.length; i += 1) {
        const found = visit(children[i], depth + 1);
        if (found) return found;
      }
      return null;
    }
    if (start && start.$parent && start.$parent.$refs && start.$parent.$refs.refDataset) return start.$parent.$refs.refDataset;
    return visit(start, 0);
  }

  function findStyleQInput(dataset) {
    const seen = new Set();
    function visit(comp, depth) {
      if (!comp || depth > 8 || seen.has(comp._uid)) return null;
      seen.add(comp._uid);
      const refs = comp.$refs || {};
      if (refs.input_0_P_MAT_CODE) {
        return Array.isArray(refs.input_0_P_MAT_CODE) ? refs.input_0_P_MAT_CODE[0] : refs.input_0_P_MAT_CODE;
      }
      const children = comp.$children || [];
      for (let i = 0; i < children.length; i += 1) {
        const found = visit(children[i], depth + 1);
        if (found) return found;
      }
      return null;
    }
    return visit(dataset, 0);
  }

  function setInputValue(input, value) {
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') && Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return compact(input.value) === compact(value);
  }

  let dataset = null;
  for (let i = 0; i < 30; i += 1) {
    dataset = findDataset();
    if (dataset && dataset.$refs && dataset.$refs.mainTableContainer) break;
    await sleep(300);
  }
  if (!dataset || !dataset.$refs || !dataset.$refs.mainTableContainer) {
    return { ok: false, retry: true, reason: 'scm_dataset_not_ready', title: document.title || '', currentUrl: location.href || '' };
  }
  const qInput = findStyleQInput(dataset);
  if (qInput && typeof qInput.__emitValue === 'function') {
    qInput.__emitValue(style);
  } else {
    const styleInput = [...document.querySelectorAll('input[type="text"]')]
      .find(input => visible(input) && textOf(input.closest('.q-field') || input.parentElement).includes('款号'));
    if (!setInputValue(styleInput, style)) {
      return { ok: false, reason: 'style_input_not_found', title: document.title || '', currentUrl: location.href || '' };
    }
  }
  await sleep(100);
  const searchButton = [...document.querySelectorAll('button,.q-btn')]
    .find(button => visible(button) && textOf(button).includes('搜索'));
  if (!searchButton) {
    return { ok: false, reason: 'search_button_not_found', title: document.title || '', currentUrl: location.href || '' };
  }
  searchButton.click();

  let table = dataset.$refs.mainTableContainer;
  let rows = [];
  for (let i = 0; i < 40; i += 1) {
    await sleep(250);
    dataset = findDataset() || dataset;
    table = dataset && dataset.$refs && dataset.$refs.mainTableContainer;
    const data = (table && (table.myListData || table.sourceMyListData)) || [];
    rows = data.filter(row => compact(row && row.P_MAT_CODE) === style);
    if (rows.length || (table && Number(table.recordsTotal || 0) === 0 && !table.loading)) break;
  }
  const safeRows = rows.map(row => ({
    ORDER_NO: textOf(row.ORDER_NO),
    BRAND: compact(row.BRAND),
    BRAND_DISPLAY: textOf(row.BRAND_DISPLAY),
    P_MAT_CODE: compact(row.P_MAT_CODE),
    P_MAT_NAME: textOf(row.P_MAT_NAME),
    SKC_CODE: compact(row.SKC_CODE),
    F1: compact(row.F1),
    F1_DISPLAY: textOf(row.F1_DISPLAY),
    C_COMPONENT: textOf(row.C_COMPONENT),
    E_COMPONENT: textOf(row.E_COMPONENT),
    H_STATUS: Number(row.H_STATUS || 0),
    SKC_RESULT: Number(row.SKC_RESULT || 0),
    SKC_REMARK: textOf(row.SKC_REMARK),
    SKC_FILE_URL1: textOf(row.SKC_FILE_URL1),
    SKC_FILE_URL2: textOf(row.SKC_FILE_URL2),
    LAST_MODIFIED_TIME: textOf(row.LAST_MODIFIED_TIME),
    TREE_LEVEL: textOf(row.TREE_LEVEL),
  }));
  return {
    ok: true,
    source: 'scm_qc_wash_appr_page_component',
    title: document.title || '',
    currentUrl: location.href || '',
    queryStyle: style,
    recordsTotal: Number(table && table.recordsTotal || 0),
    rows: safeRows,
  };
})()
`.trim()
  }

  if (!/\/goods\/label(?:$|[?#])/.test(String(location.href || ''))) {
    return fail(`当前页面不是 TEMU 商品条码管理页：${String(location.href || '')}`)
  }

  if (phase === 'init') {
    const observedStore = currentStoreName()
    if (!observedStore) {
      const attempts = Number(shared.storeReadAttempts || 0)
      if (attempts >= 10) return fail('无法读取当前 TEMU 店铺名称')
      return nextPhase('init', 800, { ...shared, storeReadAttempts: attempts + 1 })
    }
    if (!targetStore || observedStore === targetStore) {
      return nextPhase('excel_prepare', 300, {
        ...shared,
        observedStoreBefore: observedStore,
        observedStoreAfter: observedStore,
      })
    }
    if (!openStoreDropdown()) return fail('无法打开 TEMU 店铺菜单')
    return nextPhase('open_store_switch', 300, {
      ...shared,
      observedStoreBefore: observedStore,
      storeSwitchAttempts: 0,
    })
  }

  if (phase === 'open_store_switch') {
    if (storeSwitchModal()) return nextPhase('choose_store', 0, shared)
    const switchButton = findDropdownSwitchButton()
    if (switchButton) {
      switchButton.click?.()
      return nextPhase('choose_store', 400, shared)
    }
    const attempts = Number(shared.storeSwitchAttempts || 0)
    if (attempts >= 8) return fail('店铺菜单中未找到“切换”入口')
    if (attempts > 0) openStoreDropdown()
    return nextPhase('open_store_switch', 500, {
      ...shared,
      storeSwitchAttempts: attempts + 1,
    })
  }

  if (phase === 'choose_store') {
    const modal = storeSwitchModal()
    if (!modal) {
      const attempts = Number(shared.chooseStoreAttempts || 0)
      if (attempts >= 8) return fail('未出现 TEMU 切换店铺弹窗')
      return nextPhase('choose_store', 500, {
        ...shared,
        chooseStoreAttempts: attempts + 1,
      })
    }
    const section = targetStoreSection(modal)
    if (!section) {
      const stores = [...modal.querySelectorAll('[class*="account-info_mallName"]')]
        .map(textOf)
        .filter(Boolean)
      return complete([
        resultRow('batch_store_not_found', `当前账号看不到目标店铺：${targetStore}`, {
          可用店铺: stores.join('、'),
        }, {}),
      ], { ...shared, availableStores: stores })
    }
    const button = section.querySelector('button[class*="account-info_operatorBtn"]')
    if (!button || button.disabled) {
      return nextPhase('verify_store', 300, shared)
    }
    button.click?.()
    return nextPhase('verify_store', 1200, {
      ...shared,
      storeVerifyAttempts: 0,
    })
  }

  if (phase === 'verify_store') {
    const observedStore = currentStoreName()
    if (observedStore === targetStore) {
      return nextPhase('excel_prepare', 500, {
        ...shared,
        observedStoreAfter: observedStore,
      })
    }
    const attempts = Number(shared.storeVerifyAttempts || 0)
    if (attempts >= 15) {
      return fail(`店铺切换后回读不匹配：期望 ${targetStore}，实际 ${observedStore || '未知'}`)
    }
    return nextPhase('verify_store', 800, {
      ...shared,
      storeVerifyAttempts: attempts + 1,
    })
  }

  if (phase === 'api_scan') {
    try {
      if (!Number(shared.scanTotalPages || 0)) {
        const first = await queryApiPage(1)
        const targets = mergeTargets([], first.records)
        const totalPages = Math.max(1, Math.ceil(first.total / API_PAGE_SIZE))
        const stoppedByLimit = maxDownloads > 0 && targets.length >= maxDownloads
        const nextShared = {
          ...shared,
          apiValidated: true,
          apiScanAttempts: 0,
          scanTotalRecords: first.total,
          scanTotalPages: totalPages,
          scanNextPage: 2,
          scanPagesCompleted: 1,
          scanStoppedByLimit: stoppedByLimit,
          apiTargets: stoppedByLimit ? targets.slice(0, maxDownloads) : targets,
        }
        if (stoppedByLimit || totalPages <= 1) return finalizeScan(nextShared)
        return nextPhase('api_scan', 50, nextShared)
      }

      const startPage = Math.max(2, Number(shared.scanNextPage || 2))
      const endPage = Math.min(
        Number(shared.scanTotalPages || startPage),
        startPage + SCAN_PAGES_PER_PHASE - 1,
      )
      const pages = Array.from(
        { length: Math.max(0, endPage - startPage + 1) },
        (_, index) => startPage + index,
      )
      const batches = await mapWithConcurrency(pages, SCAN_CONCURRENCY, queryApiPage)
      const discovered = batches
        .flatMap(batch => batch.records)
        .filter(isDownloadable)
      let targets = mergeTargets(shared.apiTargets || [], discovered)
      const stoppedByLimit = maxDownloads > 0 && targets.length >= maxDownloads
      if (stoppedByLimit) targets = targets.slice(0, maxDownloads)
      const nextShared = {
        ...shared,
        apiValidated: true,
        apiScanAttempts: 0,
        scanNextPage: endPage + 1,
        scanPagesCompleted: endPage,
        scanStoppedByLimit: stoppedByLimit,
        apiTargets: targets,
      }
      if (stoppedByLimit || endPage >= Number(shared.scanTotalPages || 0)) {
        return finalizeScan(nextShared)
      }
      return nextPhase('api_scan', 50, nextShared)
    } catch (error) {
      const attempts = Number(shared.apiScanAttempts || 0)
      if (attempts < 2) {
        return nextPhase('api_scan', 600, {
          ...shared,
          apiScanAttempts: attempts + 1,
          apiLastError: safeApiError(error),
        })
      }
      const failedShared = {
        ...shared,
        apiValidated: false,
        apiLastError: safeApiError(error),
        temuRowStatus: 'API批量扫描失败',
      }
      return complete([
        resultRow('batch_scan_failed', 'TEMU 页面 API 批量扫描失败，请确认登录状态和页面是否完整加载', {
          temuRowStatus: 'API批量扫描失败',
          API错误: safeApiError(error),
        }, {}),
      ], failedShared)
    }
  }

  if (phase === 'excel_prepare') {
    const workflow = buildEnterpriseCodeWorkflow() || buildWorkbookWorkflow()
    if (!workflow) {
      return complete([
        resultRow('input_required', '制作链路必须填写企业码，或上传「洗唛需求」Excel 后按 SKC 选择代表 SKU', {
          temuRowStatus: '缺少输入',
        }, {}),
      ], {
        ...shared,
        workbookError: 'enterprise_codes or input_file required',
      })
    }
    if (workflow.error) {
      return complete([
        resultRow('excel_invalid', workflow.error, {
          temuRowStatus: 'Excel校验失败',
        }, {}),
      ], {
        ...shared,
        workbookError: workflow.error,
      })
    }
    let targets = workflow.excelTargets || []
    if (maxDownloads > 0) targets = targets.slice(0, maxDownloads)
    const nextShared = {
      ...shared,
      workflowMode: workflow.mode || 'excel_representative_skc_create_and_download',
      workflowSummary: workflow.summary,
      excelTargets: targets,
      currentExcelTargetIndex: 0,
      excelTarget: targets[0] || null,
      apiMadeWashLabelCount: 0,
      apiPendingWashLabelCount: 0,
      scanTotalRecords: workflow.summary?.selectedRows || workflow.summary?.selectedEnterpriseCodes || 0,
      total_rows: targets.length,
      current_exec_no: targets.length ? 1 : 0,
      current_row_no: 0,
      current_buyer_id: targets[0]?.skuNo || '',
      current_store: targetStore,
    }
    if (!targets.length) {
      return complete([
        resultRow('input_no_targets', '未得到可处理目标，请检查企业码、款号筛选或表格内容', {
          temuRowStatus: '无目标',
          workflowSummary: workflow.summary,
        }, {}),
      ], nextShared)
    }
    return nextPhase('api_lookup_excel_target', 150, resetTargetState(nextShared))
  }

  if (phase === 'api_lookup_excel_target') {
    const target = excelTarget()
    if (!target || !target.skuNo) {
      return nextPhase('advance_excel_target', 100, {
        ...shared,
        temuRowStatus: 'Excel目标缺少SKU货号',
      }, [
        resultRow('excel_target_invalid', 'Excel 代表目标缺少 SKU货号', {
          temuRowStatus: 'Excel目标缺少SKU货号',
        }, target || {}),
      ])
    }
    if (target.status && target.status !== 'ready') {
      return nextPhase('advance_excel_target', 100, {
        ...shared,
        temuRowStatus: target.status === 'needs_scm' ? '待SCM补充' : 'Excel异常',
      }, [
        resultRow(target.status === 'needs_scm' ? 'needs_scm' : 'excel_exception', target.reason || 'Excel 目标未达到可制作条件', {
          temuRowStatus: target.status === 'needs_scm' ? '待SCM补充' : 'Excel异常',
        }, target),
      ])
    }
    try {
      const response = await pagePost('/visage-agent-seller/labelcode/pageQuery', {
        page: 1,
        pageSize: API_QUERY_PAGE_SIZE,
        skuExtCodes: [target.skuNo],
      })
      const payload = responseData(response)
      const records = (Array.isArray(payload.pageItems) ? payload.pageItems : [])
        .map(normalizeApiRecord)
        .filter(record => record.skuExtCode === compact(target.skuNo))
      const downloadable = records.filter(isDownloadable)
      const creatable = records.filter(isPendingCreatable)
      if (downloadable.length > 1) {
        return nextPhase('advance_excel_target', 100, {
          ...shared,
          temuRowStatus: 'TEMU可导出记录不唯一',
        }, [
          resultRow('temu_downloadable_not_unique', 'TEMU 查询到多条可导出的已制作洗水唛记录，未自动选择', {
            temuRowStatus: 'TEMU可导出记录不唯一',
            TEMU匹配记录数: records.length,
            TEMU可导出记录数: downloadable.length,
          }, target),
        ])
      }
      if (downloadable.length === 1) {
        const apiRecord = attachExcelTarget(downloadable[0], target)
        if (skipAlreadyMade && !downloadAfterSave) {
          return nextPhase('advance_excel_target', 100, {
            ...shared,
            apiValidated: true,
            apiTarget: apiRecord,
            apiMadeWashLabelCount: Number(shared.apiMadeWashLabelCount || 0) + 1,
            temuRowStatus: '已制作',
          }, [
            resultRow('already_made_skipped', 'TEMU 已显示“已制作”，且当前参数不下载官方 PDF，未重复编辑或保存。', {
              temuRowStatus: '已制作',
              source: 'temu_readback',
            }, apiRecord),
          ])
        }
        return nextPhaseAfterTemuLookup(apiRecord, {
          ...shared,
          apiValidated: true,
          apiMadeWashLabelCount: Number(shared.apiMadeWashLabelCount || 0) + 1,
          temuRowStatus: '已制作',
        })
      }
      if (creatable.length > 1) {
        return nextPhase('advance_excel_target', 100, {
          ...shared,
          temuRowStatus: 'TEMU待制作记录不唯一',
        }, [
          resultRow('temu_creatable_not_unique', 'TEMU 查询到多条待制作洗水唛记录，未自动选择', {
            temuRowStatus: 'TEMU待制作记录不唯一',
            TEMU匹配记录数: records.length,
            TEMU待制作记录数: creatable.length,
          }, target),
        ])
      }
      if (creatable.length === 1) {
        const apiRecord = attachExcelTarget(creatable[0], target)
        return nextPhaseAfterTemuLookup(apiRecord, {
          ...shared,
          apiValidated: true,
          apiPendingWashLabelCount: Number(shared.apiPendingWashLabelCount || 0) + 1,
          temuRowStatus: 'TEMU待制作',
        })
      }
      if (records.length) {
        const record = records[0]
        return nextPhase('advance_excel_target', 100, {
          ...shared,
          temuRowStatus: 'TEMU不可制作或导出',
        }, [
          resultRow('temu_not_downloadable_or_creatable', 'TEMU 记录当前不满足洗水唛制作或 PDF 导出条件', {
            temuRowStatus: 'TEMU不可制作或导出',
            TEMU匹配记录数: records.length,
            TEMU标签类型: record.labelType,
            TEMU洗水唛状态: record.cosmeticLabelStatus,
            TEMU需要洗水唛: record.needCosmeticLabel,
          }, target),
        ])
      }
      return nextPhase('advance_excel_target', 100, {
        ...shared,
        temuRowStatus: 'TEMU未找到SKU',
      }, [
        resultRow('temu_sku_not_found', `TEMU 未查询到 SKU货号：${target.skuNo}`, {
          temuRowStatus: 'TEMU未找到SKU',
        }, target),
      ])
    } catch (error) {
      const attempts = Number(shared.excelLookupAttempts || 0)
      if (attempts < 2) {
        return nextPhase('api_lookup_excel_target', 600, {
          ...shared,
          excelLookupAttempts: attempts + 1,
          excelLookupLastError: safeApiError(error),
        })
      }
      return nextPhase('advance_excel_target', 100, {
        ...shared,
        excelLookupAttempts: 0,
        excelLookupLastError: safeApiError(error),
        temuRowStatus: 'TEMU查询失败',
      }, [
        resultRow('temu_lookup_failed', 'TEMU 页面 API 查询 Excel 代表 SKU 失败', {
          temuRowStatus: 'TEMU查询失败',
          API错误: safeApiError(error),
        }, target),
      ])
    }
  }

  if (phase === 'scm_lookup_target') {
    const target = apiTarget()
    const style = inferStyleFromTarget(target)
    if (!style) {
      return nextPhase('api_care_query', 100, {
        ...shared,
        scmLookupStatus: '缺少款号，跳过SCM',
      })
    }
    return cdpTargetEval(
      scmLookupExpression(target),
      'verify_scm_lookup',
      300,
      {
        ...shared,
        scmLookupStatus: `SCM查询款号 ${style}`,
      },
      {
        target_url_contains: [scmUrlContains],
        target_types: ['page'],
        shared_key: 'scmLookupResult',
        user_gesture: true,
      },
    )
  }

  if (phase === 'verify_scm_lookup') {
    const target = apiTarget()
    const wrapper = shared.scmLookupResult || {}
    const payload = wrapper?.value || {}
    const attempts = Number(shared.scmLookupAttempts || 0)
    if (!wrapper?.ok || !payload?.ok) {
      const reason = textOf(payload?.reason || wrapper?.error || 'SCM查询未返回成功结果')
      if ((payload?.retry || /未找到匹配 target|not ready|navigating|dataset/i.test(reason)) && attempts < 12) {
        return nextPhase('scm_lookup_target', 900, {
          ...shared,
          scmLookupAttempts: attempts + 1,
          scmLookupLastError: reason,
          scmLookupStatus: 'SCM查询等待页面就绪',
        })
      }
      return nextPhase(advancePhaseName(), 100, {
        ...shared,
        scmLookupAttempts: 0,
        scmLookupLastError: reason,
        scmLookupStatus: 'SCM查询失败',
        temuRowStatus: 'SCM查询失败',
      }, [
        resultRow('scm_lookup_failed', `SCM 查询失败：${reason}`, {
          temuRowStatus: 'SCM查询失败',
          SCM查询状态: '失败',
        }, target),
      ])
    }

    const evidence = selectScmEvidence(payload.rows, target)
    if (evidence.error) {
      return nextPhase(advancePhaseName(), 100, {
        ...shared,
        scmRows: evidence.rows || [],
        scmLookupStatus: 'SCM证据不可用',
        temuRowStatus: 'SCM证据不可用',
      }, [
        resultRow('scm_evidence_invalid', evidence.error, {
          temuRowStatus: 'SCM证据不可用',
          SCM查询状态: '证据不可用',
          SCM匹配记录数: Array.isArray(evidence.rows) ? evidence.rows.length : 0,
          SCM已完成记录数: Array.isArray(evidence.completedRows) ? evidence.completedRows.length : 0,
          SCM候选记录数: Array.isArray(evidence.candidateRows) ? evidence.candidateRows.length : 0,
          SCM成分候选: Array.isArray(evidence.compositions) ? evidence.compositions.join(' | ') : '',
        }, target),
      ])
    }
    const apiRecord = attachScmEvidence(target, evidence)
    return nextPhase('api_care_query', 150, {
      ...shared,
      apiTarget: apiRecord,
      scmLookupAttempts: 0,
      scmLookupStatus: 'SCM查询成功',
      scmRows: evidence.rows,
      scmSelectedRow: evidence.selected,
    })
  }

  if (phase === 'api_care_query') {
    const target = apiTarget()
    if (!target.productId || !target.productSkuId || !target.labelCode) {
      return continueAfterFailure('页面 API 目标记录缺少 productId、productSkuId 或 labelCode', {
        temuRowStatus: '目标标识缺失',
      })
    }
    try {
      const response = await pagePost('/visage-agent-seller/labelcode/care/query', {
        productId: target.productId,
        productSkuId: target.productSkuId,
      })
      const care = responseData(response)
      const careInitial = sanitizeCareInitial(care)
      const careLabel = {
        productId: Number(care.productId || 0),
        productSkuId: Number(care.productSkuId || 0),
        productSkcId: Number(care.productSkcId || 0),
        width: Number(care.width || 0) || labelWidthMm,
        len: Number(care.len || 0) || labelLengthMm,
        padding: Number(care.padding || 0) || labelPaddingMm,
        size: textOf(care.size),
      }
      if (
        careLabel.productId !== target.productId
        || careLabel.productSkuId !== target.productSkuId
        || careLabel.productSkcId !== target.productSkcId
      ) {
        return continueAfterFailure('洗水唛详情 API 回读与目标记录不一致', {
          temuRowStatus: '详情校验失败',
        }, {
          ...shared,
          apiValidated: false,
          careLabel,
          careInitial,
        })
      }
      const apiRecord = {
        ...target,
        excelSkuCode: inferSkuCodeFromParts(target, careLabel),
      }
      apiRecord.outputFilename = buildOutputFilenameForTarget(apiRecord, careLabel)
      const nextShared = {
        ...shared,
        apiTarget: apiRecord,
        apiValidated: true,
        careLabel,
        careInitial,
        careQueryAttempts: 0,
      }
      if (isDownloadable(apiRecord)) {
        if (!downloadAfterSave) {
          return nextPhase(advancePhaseName(), 100, nextShared, [
            resultRow('already_made_no_download', 'TEMU 已显示“已制作”，当前参数关闭下载，未重复编辑或保存。', {
              temuRowStatus: '已制作',
              source: 'temu_readback',
            }, apiRecord, nextShared),
          ])
        }
        return nextPhase('prepare_search', 250, nextShared)
      }
      if (isPendingCreatable(apiRecord)) {
        return nextPhase('prepare_care_payload', 100, nextShared)
      }
      return nextPhase(advancePhaseName(), 100, {
        ...nextShared,
        temuRowStatus: 'TEMU不可制作或导出',
      }, [
        resultRow('temu_not_downloadable_or_creatable', '详情回读后目标仍不满足制作或导出条件', {
          temuRowStatus: 'TEMU不可制作或导出',
        }, apiRecord),
      ])
    } catch (error) {
      const attempts = Number(shared.careQueryAttempts || 0)
      if (attempts < 2) {
        return nextPhase('api_care_query', 600, {
          ...shared,
          careQueryAttempts: attempts + 1,
          careLastError: safeApiError(error),
        })
      }
      return continueAfterFailure('洗水唛详情 API 查询失败，请确认登录状态和页面是否完整加载', {
        temuRowStatus: '详情查询失败',
        API错误: safeApiError(error),
      }, {
        ...shared,
        apiValidated: false,
        careLastError: safeApiError(error),
      })
    }
  }

  if (phase === 'prepare_care_payload') {
    const target = apiTarget()
    const care = shared.careInitial || {}
    const built = buildCarePayload(care, target)
    if (!built.payload) {
      return nextPhase(advancePhaseName(), 100, {
        ...shared,
        carePayloadError: built.error || '制作参数生成失败',
        temuRowStatus: '制作参数失败',
      }, [
        resultRow('create_payload_failed', built.error || '制作参数生成失败', {
          temuRowStatus: '制作参数失败',
          TEMU可选项: Array.isArray(built.options) ? built.options.join('、') : '',
        }),
      ])
    }
    const nextShared = {
      ...shared,
      carePayload: built.payload,
      carePayloadSummary: built.summary,
      temuRowStatus: '制作参数已就绪',
    }
    if (!isSaveExplicitlyEnabled()) {
      return nextPhase(advancePhaseName(), 100, nextShared, [
        resultRow('create_payload_ready', executeMode === SAVE_MODE
          ? '已生成制作参数，但 allow_save 未开启；未调用 TEMU 保存接口。'
          : 'dry_run 仅生成制作参数；未调用 TEMU 保存接口。', {
            temuRowStatus: '制作参数已就绪',
            source: 'dry_run_payload',
            制作Payload摘要: JSON.stringify(built.summary),
            洗护符号: JSON.stringify(built.summary.careSymbols),
            制造商名称: built.summary.manufacturerName,
            制造商地址: built.summary.manufacturerAddressPg,
            生产日期: built.summary.productionDate,
            批次号: built.summary.batchNumber,
            成分写入策略: built.summary.compositionMode,
            成分写入原因: built.summary.compositionModeReason,
          }, target, nextShared),
      ])
    }
    return nextPhase('save_care_label', 100, nextShared)
  }

  if (phase === 'save_care_label') {
    const target = apiTarget()
    const payload = shared.carePayload || null
    if (!payload || !payload.productSkuId || !payload.productSkcId || !payload.productId) {
      return nextPhase(advancePhaseName(), 100, {
        ...shared,
        temuRowStatus: '制作参数缺失',
      }, [
        resultRow('create_payload_missing', '保存阶段缺少制作 payload，未调用 TEMU 保存接口。', {
          temuRowStatus: '制作参数缺失',
        }),
      ])
    }
    if (!isPendingCreatable(target)) {
      return nextPhase(advancePhaseName(), 100, {
        ...shared,
        temuRowStatus: '非待制作项',
      }, [
        resultRow('save_rejected_not_pending', '目标不是待制作洗水唛，未执行编辑或重复保存。', {
          temuRowStatus: '非待制作项',
        }),
      ])
    }
    try {
      const response = await pagePost('/visage-agent-seller/labelcode/care/create', payload)
      const saveResult = responseData(response)
      const rejectedSiteNames = Array.isArray(saveResult?.rejectedSiteNames)
        ? saveResult.rejectedSiteNames.map(textOf).filter(Boolean)
        : []
      if (rejectedSiteNames.length) {
        return nextPhase(advancePhaseName(), 100, {
          ...shared,
          saveResult: { rejectedSiteNames },
          temuRowStatus: '保存需风险确认',
        }, [
          resultRow('save_needs_risk_confirmation', 'TEMU 保存接口返回站点风险确认，脚本未自动跳过风险；请人工确认后重跑。', {
            temuRowStatus: '保存需风险确认',
            rejectedSiteNames: rejectedSiteNames.join('、'),
          }),
        ])
      }
      return nextPhase('post_save_lookup', 1200, {
        ...shared,
        saveResult: { success: true },
        saveAttempts: 0,
        postSaveLookupAttempts: 0,
        temuRowStatus: '已调用保存',
      })
    } catch (error) {
      const attempts = Number(shared.saveAttempts || 0)
      if (attempts < 1) {
        return nextPhase('save_care_label', 1200, {
          ...shared,
          saveAttempts: attempts + 1,
          saveLastError: safeApiError(error),
        })
      }
      return nextPhase(advancePhaseName(), 100, {
        ...shared,
        saveLastError: safeApiError(error),
        temuRowStatus: '保存失败',
      }, [
        resultRow('save_failed', 'TEMU 洗水唛保存接口调用失败', {
          temuRowStatus: '保存失败',
          API错误: safeApiError(error),
        }),
      ])
    }
  }

  if (phase === 'post_save_lookup') {
    const target = apiTarget()
    try {
      const response = await pagePost('/visage-agent-seller/labelcode/pageQuery', {
        page: 1,
        pageSize: API_QUERY_PAGE_SIZE,
        skuExtCodes: [target.skuExtCode],
      })
      const payload = responseData(response)
      const records = (Array.isArray(payload.pageItems) ? payload.pageItems : [])
        .map(normalizeApiRecord)
        .filter(record => record.skuExtCode === target.skuExtCode)
      const downloadable = records.filter(isDownloadable)
      if (downloadable.length === 1) {
        const apiRecord = {
          ...attachExcelTarget(downloadable[0], target),
          outputFilename: target.outputFilename,
        }
        const nextShared = {
          ...shared,
          apiTarget: apiRecord,
          apiValidated: true,
          apiMadeWashLabelCount: Number(shared.apiMadeWashLabelCount || 0) + 1,
          temuRowStatus: '已制作',
        }
        if (!downloadAfterSave) {
          return nextPhase(advancePhaseName(), 100, nextShared, [
            resultRow('save_verified_no_download', '保存后 TEMU 回读为“已制作”，当前参数关闭下载。', {
              temuRowStatus: '已制作',
              source: 'temu_save_readback',
            }, apiRecord, nextShared),
          ])
        }
        return nextPhase('api_care_query', 600, nextShared)
      }
      const attempts = Number(shared.postSaveLookupAttempts || 0)
      if (attempts < 10) {
        return nextPhase('post_save_lookup', 1200, {
          ...shared,
          postSaveLookupAttempts: attempts + 1,
          temuRowStatus: '保存后等待已制作',
        })
      }
      return nextPhase(advancePhaseName(), 100, {
        ...shared,
        temuRowStatus: '保存后未回读已制作',
      }, [
        resultRow('save_readback_failed', '已调用保存接口，但 TEMU 未在等待时间内回读为“已制作”。', {
          temuRowStatus: '保存后未回读已制作',
          TEMU匹配记录数: records.length,
          TEMU可导出记录数: downloadable.length,
        }),
      ])
    } catch (error) {
      const attempts = Number(shared.postSaveLookupAttempts || 0)
      if (attempts < 2) {
        return nextPhase('post_save_lookup', 1200, {
          ...shared,
          postSaveLookupAttempts: attempts + 1,
          postSaveLookupLastError: safeApiError(error),
        })
      }
      return nextPhase(advancePhaseName(), 100, {
        ...shared,
        postSaveLookupLastError: safeApiError(error),
        temuRowStatus: '保存后查询失败',
      }, [
        resultRow('save_readback_query_failed', '保存后 TEMU 页面 API 回读失败', {
          temuRowStatus: '保存后查询失败',
          API错误: safeApiError(error),
        }),
      ])
    }
  }

  if (phase === 'prepare_search') {
    const target = apiTarget()
    const input = findSkuSearchInput()
    const queryButton = findQueryButton()
    if (!input || !queryButton) {
      const attempts = Number(shared.searchControlAttempts || 0)
      if (attempts >= 10) {
        return continueAfterFailure('未找到 SKU货号输入框或查询按钮', {
          temuRowStatus: '页面查询控件缺失',
        })
      }
      return nextPhase('prepare_search', 700, {
        ...shared,
        searchControlAttempts: attempts + 1,
      })
    }
    if (!setInputValue(input, target.skuExtCode)) {
      return continueAfterFailure('SKU货号未能写入查询输入框', {
        temuRowStatus: '页面查询输入失败',
      })
    }
    queryButton.click?.()
    return nextPhase('verify_search', 800, {
      ...shared,
      searchAttempts: 0,
      queriedSkuNo: target.skuExtCode,
    })
  }

  if (phase === 'verify_search') {
    const target = apiTarget()
    const identityRows = apiIdentityRows()
    if (identityRows.length > 1) {
      return continueAfterFailure('页面出现多条与 API 标识完全相同的记录，未执行导出', {
        temuRowStatus: '页面记录不唯一',
        页面精确匹配行数: identityRows.length,
      })
    }
    const targetRow = madeWashLabelRow()
    if (targetRow) {
      const action = exportAction(targetRow)
      if (!action) {
        return continueAfterFailure('已制作洗水唛行缺少导出按钮', {
          temuRowStatus: '导出按钮缺失',
        })
      }
      action.click?.()
      return nextPhase('prepare_export', 600, {
        ...shared,
        temuRowStatus: '已制作',
        matchedRowText: textOf(targetRow),
      })
    }

    const rows = matchingRows()
    if (rows.length) {
      const attempts = Number(shared.searchAttempts || 0)
      if (attempts < 2) {
        return nextPhase('verify_search', 500, {
          ...shared,
          searchAttempts: attempts + 1,
        })
      }
      return continueAfterFailure('页面结果与 API 目标标识不一致，未执行导出', {
        temuRowStatus: '页面/API不一致',
        匹配行数: rows.length,
        API精确匹配行数: identityRows.length,
      })
    }

    const attempts = Number(shared.searchAttempts || 0)
    const pageText = textOf(document.body)
    if (attempts >= 10 || (attempts >= 2 && pageText.includes('共有 0 条'))) {
      return continueAfterFailure(`页面未查询到 API 已枚举的 SKU货号：${target.skuExtCode}`, {
        temuRowStatus: '页面未找到',
      })
    }
    return nextPhase('verify_search', 700, {
      ...shared,
      searchAttempts: attempts + 1,
    })
  }

  if (phase === 'prepare_export') {
    const modal = exportModal()
    if (!modal) {
      const attempts = Number(shared.exportModalAttempts || 0)
      if (attempts >= 10) {
        return continueAfterFailure('点击导出后未出现“确认导出吗？”弹窗', {
          temuRowStatus: '导出弹窗缺失',
        })
      }
      return nextPhase('prepare_export', 500, {
        ...shared,
        exportModalAttempts: attempts + 1,
      })
    }
    const pdf = exportFormatLabel(modal, 'PDF')
    const png = exportFormatLabel(modal, 'PNG')
    if (!pdf || !png) return fail('导出弹窗中未找到 PDF/PNG 格式选项')
    if (!isChecked(pdf)) pdf.click?.()
    if (isChecked(png)) png.click?.()
    return nextPhase('verify_export_options', 500, {
      ...shared,
      exportConfirmAttempts: 0,
    })
  }

  if (phase === 'verify_export_options') {
    const target = apiTarget()
    const modal = exportModal()
    if (!modal) return fail('校验导出格式时弹窗已消失')
    const pdf = exportFormatLabel(modal, 'PDF')
    const png = exportFormatLabel(modal, 'PNG')
    if (!isChecked(pdf) || isChecked(png)) {
      return fail('导出格式未能稳定切换为仅 PDF')
    }
    const button = [...modal.querySelectorAll('button')]
      .find(candidate => visible(candidate) && textOf(candidate) === '确认无误，导出')
    if (button?.disabled) {
      const attempts = Number(shared.exportConfirmAttempts || 0)
      if (attempts >= 40) {
        const canvas = modal.querySelector('canvas')
        if (canvas?.width && canvas?.height) {
          return {
            success: true,
            data: [],
            meta: {
              action: 'download_clicks',
              items: [{
                label: `TEMU 官方洗水唛 PDF ${target.excelSkuCode || target.skcExtCode}-${target.excelSkuNo || target.skuExtCode}`,
                filename: target.outputFilename,
                clicks: [],
                page_blob_expression: temuPdfUrlBlobExpression(),
                expected_name_regex: '.+\\.pdf$',
                expected_magic: '%PDF-',
                min_bytes: 1024,
                timeout_ms: Math.round(timeoutSeconds * 1000),
                source: 'temu_official_download',
              }],
              strict: false,
              shared_key: 'downloadResult',
              next_phase: 'verify_download',
              sleep_ms: 200,
              shared: {
                ...shared,
                temuRowStatus: '已制作',
                exportFallback: 'pdfUrl_blob',
              },
            },
          }
        }
        return continueAfterFailure('PDF 预览未完成或最终导出按钮持续未启用，未执行导出点击', {
          temuRowStatus: '导出按钮未启用',
        })
      }
      return nextPhase('verify_export_options', 500, {
        ...shared,
        exportConfirmAttempts: attempts + 1,
      })
    }
    const click = centerClick(button)
    if (!click) return fail('未找到可点击的最终 PDF 导出按钮')
    return {
      success: true,
      data: [],
      meta: {
        action: 'download_clicks',
        items: [{
          label: `TEMU 官方洗水唛 PDF ${target.skcExtCode}-${target.skuExtCode}`,
          filename: target.outputFilename,
          clicks: [click],
          expected_name_regex: '.+\\.pdf$',
          expected_magic: '%PDF-',
          capture_blob_download: true,
          min_bytes: 1024,
          timeout_ms: Math.round(timeoutSeconds * 1000),
          source: 'temu_official_download',
        }],
        strict: false,
        shared_key: 'downloadResult',
        next_phase: 'verify_download',
        sleep_ms: 200,
        shared,
      },
    }
  }

  if (phase === 'verify_download') {
    const downloadResult = shared.downloadResult || {}
    const item = bestDownloadItem(downloadResult)
    if (item?.success && item.path) {
      return nextPhase(advancePhaseName(), 100, {
        ...shared,
        officialDownloadPath: item.path,
        officialDownloadReceived: true,
      }, [
        resultRow('official_download_received', '', {
          path: item.path,
          bytes: Number(item.bytes || 0),
          signatureValidated: item.signatureValidated !== false,
          匹配方式: String(item.matchedBy || ''),
          浏览器下载控制: String(item.browserDownloadControl?.method || ''),
        }),
      ])
    }
    return nextPhase(advancePhaseName(), 100, {
      ...shared,
      officialDownloadReceived: false,
      officialDownloadError: String(item?.error || '浏览器未返回官方 PDF 文件'),
    }, [
      resultRow('official_download_failed', String(item?.error || '浏览器未返回官方 PDF 文件'), {
        path: String(item?.path || ''),
        bytes: Number(item?.bytes || 0),
        signatureValidated: !!item?.signatureValidated,
        下载返回: JSON.stringify(downloadResult).slice(0, 1200),
      }),
    ])
  }

  if (phase === 'advance_excel_target') {
    const targets = excelTargets()
    const nextIndex = Number(shared.currentExcelTargetIndex || 0) + 1
    if (nextIndex >= targets.length) {
      return complete([], {
        ...shared,
        batchCompleted: true,
        completedTargetCount: targets.length,
      })
    }
    return nextPhase('api_lookup_excel_target', 150, resetTargetState({
      ...shared,
      currentExcelTargetIndex: nextIndex,
      excelTarget: targets[nextIndex],
      current_exec_no: nextIndex + 1,
      current_buyer_id: targets[nextIndex]?.skuNo || '',
      current_store: targetStore,
      apiTarget: null,
      excelLookupAttempts: 0,
      excelLookupLastError: '',
    }))
  }

  if (phase === 'advance_target') {
    const targets = apiTargets()
    const nextIndex = Number(shared.currentTargetIndex || 0) + 1
    if (nextIndex >= targets.length) {
      return complete([], {
        ...shared,
        batchCompleted: true,
        completedTargetCount: targets.length,
      })
    }
    return nextPhase('api_care_query', 150, resetTargetState({
      ...shared,
      currentTargetIndex: nextIndex,
      apiTarget: targets[nextIndex],
    }))
  }

  return fail(`未知执行阶段：${phase}`)
})()
