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
  const failedSkuMaxRetries = Math.max(0, Math.min(5, Math.floor(Number(
    params.failed_sku_max_retries ?? params.failed_sku_auto_retries ?? 2,
  ))))
  const outputDir = textOf(params.output_dir || params.export_dir || params.download_dir || '')
  const pilotStyle = compact(params.pilot_style || '')
  const maxSkc = Math.max(0, Math.min(10000, Math.floor(Number(params.max_skc || 0))))
  const styleCodesText = textOf(params.style_codes || params.style_code || params.skc_codes || '')
  const enterpriseCodesText = textOf(params.enterprise_codes || params.enterprise_code || params.sku_nos || '')
  const scmLookupEnabled = params.scm_lookup !== false && String(params.scm_lookup || '').toLowerCase() !== 'false'
  const scmAttachmentRecognitionEnabled = params.ai_wash_instruction_recognition === true
    || String(params.ai_wash_instruction_recognition || '').toLowerCase() === 'true'
  const scmUrlContains = textOf(params.scm_url_contains || 'scm.semir.com')
  const scmOnlyCompleted = params.scm_only_completed !== false && String(params.scm_only_completed || '').toLowerCase() !== 'false'
  const scmBrandMode = compact(params.scm_brand || 'auto')
  const scmCompositionMode = compact(params.scm_composition_mode || 'evidence_only')
  const aiWashInstructionModelId = textOf(params.ai_wash_instruction_model_id || '')
  const aiWashInstructionFallbackModels = textOf(params.ai_wash_instruction_fallback_models || '')
  const manufacturerNameParam = textOf(paramValue('manufacturer_name', ''))
  const manufacturerAddressParam = textOf(paramValue('manufacturer_address', ''))
  const productionDateParam = textOf(paramValue('production_date', '2024-10-01'))
  const batchNumberParam = textOf(paramValue('batch_number', 'PC241016'))
  const careSymbolsMode = compact(params.care_symbols_mode || 'scm_or_fixed')
  const fixedCareSymbolsProfileParam = compact(paramValue('fixed_care_symbols_profile', 'dingtalk_sop')).toLowerCase()
  const labelWidthMm = Math.max(10, Math.min(100, paramNumber('label_width_mm', 45)))
  const labelLengthMm = Math.max(50, Math.min(500, paramNumber('label_length_mm', 230)))
  const labelPaddingMm = Math.max(0, Math.min(100, paramNumber('label_padding_mm', 10)))
  const taskStartedAt = textOf(params.__task_started_at || params.task_started_at || '')
  const API_PAGE_SIZE = 200
  const API_QUERY_PAGE_SIZE = 50
  const SCAN_PAGES_PER_PHASE = 8
  const SCAN_CONCURRENCY = 4
  const EXPORT_MODAL_WAIT_ATTEMPTS = 40
  const EXPORT_MODAL_REFIRE_EVERY_ATTEMPTS = 10
  const SAFE_PRINT_OVERFLOW_TEXT = '已超出安全打印区域'
  const SAFE_PRINT_OVERFLOW_CONFIRM_TEXT = '填写信息已超出画布尺寸'
  const SAFE_PRINT_LENGTH_COARSE_STEP_MM = 20
  const SAFE_PRINT_LENGTH_COARSE_MAX_STEPS = 5
  const SAFE_PRINT_LENGTH_FINE_STEP_MM = 5
  const SAFE_PRINT_LENGTH_FINE_MAX_STEPS = 16
  const TEMPLATE_FIELD_CORRECTION_MAX_ATTEMPTS = 3
  const SCM_LOGIN_WAIT_MS = 500000
  const SCM_LOGIN_RETRY_SLEEP_MS = 5000
  const SCM_LOGIN_MAX_ATTEMPTS = Math.ceil(SCM_LOGIN_WAIT_MS / SCM_LOGIN_RETRY_SLEEP_MS)
  const AI_WASH_PROGRESS_KIND = 'temu_ai_wash_label'
  const REQUIRED_COLUMNS = ['款号']
  const OPTIONAL_COLUMNS = ['制造商名称', '制造商地址', '生产日期', '批次号', '洗水唛宽度mm', '洗水唛长度mm', '上下预留mm']
  const WORKBOOK_COLUMN_ALIASES = {
    生产日期: ['生产日期', '生产年月', '生产月份'],
    批次号: ['批次号', '批号', '生产批次号', '生产批号'],
    洗水唛宽度mm: ['洗水唛宽度mm', '水洗唛宽度mm', '洗水唛宽度', '水洗唛宽度', '宽度mm', '宽mm', '宽'],
    洗水唛长度mm: ['洗水唛长度mm', '水洗唛长度mm', '洗水唛长度', '水洗唛长度', '长度mm', '长mm', '长'],
    上下预留mm: ['上下预留mm', '上下预留尺寸mm', '上下预留尺寸', '预留mm', '预留'],
  }
  const LABEL_DIMENSION_SPECS = {
    width: { column: '洗水唛宽度mm', label: '洗水唛宽度mm', min: 10, max: 100, paramDefault: () => labelWidthMm },
    length: { column: '洗水唛长度mm', label: '洗水唛长度mm', min: 50, max: 500, paramDefault: () => labelLengthMm },
    padding: { column: '上下预留mm', label: '上下预留mm', min: 0, max: 100, paramDefault: () => labelPaddingMm },
  }
  const IDENTIFIER_COLUMNS = new Set(['款号'])
  const MISSING_COMPOSITION = new Set(['', 'N/A', 'NA'])
  const SAVE_MODE = 'create_and_download'
  const PILOT_STYLE = '209225117208'
  const FIXED_CARE_SYMBOL_PROFILES = {
    legacy_20260731: {
      id: 'legacy_20260731',
      symbols: {
        washing: 10,
        bleaching: 3,
        drying: 5,
        ironing: 3,
        dryCleaning: 5,
      },
      labels: {
        washing: 'Maximum washing temperature 30℃',
        bleaching: 'Do not bleach',
        drying: 'Line drying in the shade',
        ironing: 'Iron at maximal sole plate temperature 120℃, steam may cause irreversible damage',
        dryCleaning: 'Do not dry clean',
      },
    },
    dingtalk_sop: {
      id: 'dingtalk_sop',
      symbols: {
        washing: 13,
        bleaching: 3,
        drying: 4,
        ironing: 3,
        dryCleaning: 5,
      },
      labels: {
        washing: 'Hand wash, maximum temperature 40℃',
        bleaching: 'Do not bleach',
        drying: 'Line drying',
        ironing: 'Iron at maximal sole plate temperature 120℃, steam may cause irreversible damage',
        dryCleaning: 'Do not dry clean',
      },
    },
  }
  const TEMU_CARE_SYMBOL_OPTIONS = {
    washing: [
      { standardId: 'W02', value: 14, label: 'Do not wash', patterns: [/do not wash/i, /不可水洗|不可洗|禁止水洗/] },
      { standardId: 'W15', value: 15, label: 'Hand wash, ambient temperature', patterns: [/hand wash,\s*ambient temperature/i, /常温\s*手洗|冷水手洗|环境温度手洗/] },
      { standardId: 'W01', value: 13, label: 'Hand wash, maximum temperature 40℃', patterns: [/hand wash,\s*maximum temperature\s*40\s*℃/i, /wash by hand(?!\s*ambient)/i, /(?:最高洗涤温度\s*)?40\s*℃?\s*手洗|手洗(?:，?最高洗涤温度\s*40\s*℃)?/] },
      { standardId: 'W12', value: 1, label: 'Maximum washing temperature 95℃ normal process', patterns: [/maximum washing temperature\s*95℃\s*normal process/i, /95℃\s*(?:常规程序|常规洗|水洗|洗涤|机洗)/] },
      { standardId: 'W11', value: 2, label: 'Maximum washing temperature 70℃ normal process', patterns: [/maximum washing temperature\s*70℃\s*normal process/i, /70℃\s*(?:常规程序|常规洗|水洗|洗涤|机洗)/] },
      { standardId: 'W10', value: 4, label: 'Maximum washing temperature 60℃ mild process', patterns: [/maximum washing temperature\s*60℃\s*mild process/i, /60℃\s*(?:缓和程序|轻柔洗|缓和洗)/] },
      { standardId: 'W09', value: 3, label: 'Maximum washing temperature 60℃ normal process', patterns: [/maximum washing temperature\s*60℃(?!\s*(mild|very mild))/i, /60℃\s*(?:常规程序|常规洗|水洗|洗涤|机洗)/] },
      { standardId: 'W14', value: 6, label: 'Maximum washing temperature 50℃ mild process', patterns: [/maximum washing temperature\s*50℃\s*mild process/i, /50℃\s*(?:缓和程序|轻柔洗|缓和洗)/] },
      { standardId: 'W13', value: 5, label: 'Maximum washing temperature 50℃ normal process', patterns: [/maximum washing temperature\s*50℃(?!\s*(mild|very mild))/i, /50℃\s*(?:常规程序|常规洗|水洗|洗涤|机洗)/] },
      { standardId: 'W08', value: 9, label: 'Maximum washing temperature 40℃ very mild process', patterns: [/maximum washing temperature\s*40℃\s*very mild process/i, /40℃\s*(?:非常缓和程序|极轻柔洗|非常缓和洗)/] },
      { standardId: 'W07', value: 8, label: 'Maximum washing temperature 40℃ mild process', patterns: [/maximum washing temperature\s*40℃\s*mild process/i, /40℃\s*(?:缓和程序|轻柔洗|缓和洗)/] },
      { standardId: 'W06', value: 7, label: 'Maximum washing temperature 40℃ normal process', patterns: [/maximum washing temperature\s*40℃(?!\s*(mild|very mild))/i, /40℃\s*(?:常规程序|常规洗|水洗|洗涤|机洗)/] },
      { standardId: 'W05', value: 12, label: 'Maximum washing temperature 30℃ very mild process', patterns: [/maximum (?:washing )?temperature\s*30\s*℃\s*very mild process/i, /30\s*℃\s*(?:非常缓和程序|极轻柔洗|非常缓和洗)/] },
      { standardId: 'W04', value: 11, label: 'Maximum washing temperature 30℃ mild process', patterns: [/maximum (?:washing )?temperature\s*30\s*℃\s*mild process/i, /30\s*℃\s*(?:缓和程序|轻柔洗|缓和洗)/] },
      { standardId: 'W03', value: 10, label: 'Maximum washing temperature 30℃ normal process', patterns: [/maximum (?:washing )?temperature\s*30\s*℃(?!\s*(mild|very mild))/i, /30\s*℃\s*(?:常规程序|常规洗|水洗|洗涤|机洗)/] },
    ],
    bleaching: [
      { standardId: 'B03', value: 3, label: 'Do not bleach', patterns: [/do not bleach/i, /不可漂白|禁止漂白/] },
      { standardId: 'B02', value: 2, label: 'Only oxygen/non-chlorine bleach allowed', patterns: [/only oxygen\s*\/\s*non-chlorine bleach allowed/i, /oxygen\/non-chlorine bleach/i, /仅允许氧漂|非氯漂|不可氯漂/] },
      { standardId: 'B01', value: 1, label: 'Any bleaching agent allowed', patterns: [/any bleaching agent allowed/i, /允许任何漂白剂|可漂白|任何漂白/] },
    ],
    drying: [
      { standardId: 'D08', value: 11, label: 'Drip flat drying in the shade', patterns: [/drip flat drying in the shade/i, /阴凉处(?:滴干后平摊晾干|平摊滴干|滴水平摊)/] },
      { standardId: 'D04', value: 10, label: 'Drip flat drying', patterns: [/drip flat drying/i, /滴干后平摊晾干|平摊滴干|滴水平摊干燥/] },
      { standardId: 'D07', value: 9, label: 'Flat drying in the shade', patterns: [/flat drying in the shade/i, /阴凉处平摊晾干|阴凉处平放干燥/] },
      { standardId: 'D03', value: 8, label: 'Flat drying', patterns: [/flat drying|dry flat/i, /平摊晾干|平摊|平坦|平放干燥|平放/] },
      { standardId: 'D06', value: 7, label: 'Drip line drying in the shade', patterns: [/drip line drying in the shade/i, /阴凉处(?:悬挂滴干|滴水吊干)/] },
      { standardId: 'D02', value: 6, label: 'Drip line drying', patterns: [/drip line drying/i, /悬挂滴干|滴水悬挂晾干|滴水吊干/] },
      { standardId: 'D05', value: 5, label: 'Line drying in the shade', patterns: [/line drying in the shade/i, /阴凉处悬挂晾干|阴凉处晾干|阴凉处吊干|阴干/] },
      { standardId: 'D01', value: 4, label: 'Line drying', patterns: [/line drying|line dry/i, /悬挂晾干|悬挂晾晒|挂晾|吊干|悬挂干燥/] },
      { standardId: 'D11', value: 3, label: 'Do not tumble dry', patterns: [/do not tumble dry/i, /不可(?:翻转|滚筒)干燥|禁止烘干/] },
      { standardId: 'D10', value: 2, label: 'Tumble drying possible, low temperature', patterns: [/tumble drying possible.*(?:60℃|lower temperature|low temperature)/i, /低温(?:翻转|滚筒)?干燥|较低温度.*60℃/] },
      { standardId: 'D09', value: 1, label: 'Tumble drying possible, normal temperature', patterns: [/tumble drying possible.*(?:80℃|normal temperature)/i, /常规温度.*80℃|常温(?:翻转|滚筒)?干燥|正常温度烘干/] },
    ],
    ironing: [
      { standardId: 'I04', value: 4, label: 'Do not iron', patterns: [/do not iron/i, /不可熨烫|禁止熨烫/] },
      { standardId: 'I08', value: 5, label: 'Iron at maximum sole plate temperature 120℃ without steam', patterns: [/120℃\s*without steam/i, /120℃.*(?:不可蒸汽熨烫|无蒸汽|不可蒸汽)/] },
      { standardId: 'I07', value: 3, label: 'Iron at maximal sole plate temperature 120℃, steam may cause irreversible damage', patterns: [/120\s*℃.*steam.*irreversible damage/i, /maximum sole-?plate temperature(?: of)?\s*110℃/i, /110℃.*(?:without steam|无蒸汽)/, /低温熨烫|低温无蒸汽|120\s*℃.*蒸汽.*损伤|(?:^|[，,；;\s])可熨烫/] },
      { standardId: 'I06', value: 2, label: 'Iron at maximal sole plate temperature 160℃', patterns: [/sole plate temperature\s*(?:150|160)℃/i, /(?:150|160)℃.*熨烫|中温熨烫/] },
      { standardId: 'I05', value: 1, label: 'Iron at maximal sole plate temperature 210℃', patterns: [/sole plate temperature\s*(?:200|210)℃/i, /(?:200|210)℃.*熨烫|高温熨烫/] },
    ],
    dryCleaning: [
      { standardId: 'P05', value: 5, label: 'Do not dry clean', patterns: [/do not dry clean/i, /不可干洗|不可专业干洗|禁止干洗/] },
      { standardId: 'P09', value: 9, label: 'Do not wet clean', patterns: [/do not wet clean/i, /不可湿洗|不可专业湿洗|禁止专业湿洗/] },
      { standardId: 'P10', value: 21, label: 'Professional dry cleaning P very mild process', patterns: [/tetrachloroethene.*very mild process/i, /P类专业干洗.*非常缓和|专业干洗.*非常缓和干洗/] },
      { standardId: 'P02', value: 2, label: 'Professional dry cleaning P mild process', patterns: [/tetrachloroethene.*mild process/i, /P类专业干洗.*缓和|专业干洗.*缓和干洗/] },
      { standardId: 'P01', value: 1, label: 'Professional dry cleaning P normal process', patterns: [/tetrachloroethene.*normal process/i, /P类专业干洗.*常规|专业干洗.*常规干洗/] },
      { standardId: 'P04', value: 4, label: 'Professional dry cleaning F mild process', patterns: [/hydrocarbons.*mild process/i, /F类专业干洗.*缓和|碳氢化合物.*缓和干洗/] },
      { standardId: 'P03', value: 3, label: 'Professional dry cleaning F normal process', patterns: [/hydrocarbons.*normal process/i, /F类专业干洗.*常规|碳氢化合物.*常规干洗/] },
      { standardId: 'P08', value: 8, label: 'Professional wet cleaning very mild process', patterns: [/professional wet cleaning.*very mild process/i, /专业湿洗.*非常缓和|W极缓和湿洗/] },
      { standardId: 'P07', value: 7, label: 'Professional wet cleaning mild process', patterns: [/[pr]otessional wet cleaning.*mild process/i, /专业湿洗.*缓和|W缓和湿洗/] },
      { standardId: 'P06', value: 6, label: 'Professional wet cleaning normal process', patterns: [/professional wet cleaning(?!.*(?:mild|very mild))/i, /专业湿洗.*常规|W常规湿洗/] },
    ],
  }
  const CARE_SYMBOL_FIELDS = ['washing', 'bleaching', 'drying', 'ironing', 'dryCleaning']
  const DEFAULT_ING_LANGS = ['en', 'de', 'fr', 'it', 'es', 'da', 'cs', 'sv']
  const SCM_WASH_APPROVAL_URL = 'https://scm.semir.com/scm-quality-mgm/index/scm-qc-wash-appr-index'
  const SCM_WASH_APPROVAL_REFERER = SCM_WASH_APPROVAL_URL
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

  function paramValue(name, fallback) {
    return Object.prototype.hasOwnProperty.call(params, name) ? params[name] : fallback
  }

  function paramNumber(name, fallback) {
    const value = paramValue(name, fallback)
    if (value === '' || value === null || value === undefined) return Number(fallback)
    return Number(value)
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

  function workbookCell(row, key) {
    if (!row || typeof row !== 'object') return ''
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key]
    const aliases = WORKBOOK_COLUMN_ALIASES[key] || []
    for (const alias of aliases) {
      if (Object.prototype.hasOwnProperty.call(row, alias)) return row[alias]
    }
    return ''
  }

  function normalizeWorkbookRow(row) {
    const item = {}
    for (const key of [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS]) {
      const value = workbookCell(row, key)
      item[key] = IDENTIFIER_COLUMNS.has(key) ? compact(value) : textOf(value)
    }
    return item
  }

  function rowExactKey(row) {
    return [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS].map(key => row[key] || '').join('\u001f')
  }

  function sizeSortKey(value) {
    const text = compact(value)
    const number = Number(text)
    if (Number.isFinite(number)) return String(number).padStart(8, '0')
    return text
  }

  function parseWorkbookMm(value, spec) {
    const raw = textOf(value)
    if (!raw) return { value: null }
    const match = raw.match(/-?\d+(?:\.\d+)?/)
    const number = match ? Number(match[0]) : Number.NaN
    if (!Number.isFinite(number)) {
      return { value: null, error: `${spec.label} 不是有效数字：${raw}` }
    }
    if (number < spec.min || number > spec.max) {
      return { value: null, error: `${spec.label} 超出范围 ${spec.min}-${spec.max}：${raw}` }
    }
    return { value: number }
  }

  function uniqueWorkbookMmValues(items, spec) {
    const values = []
    const errors = []
    for (const item of items) {
      const parsed = parseWorkbookMm(item?.[spec.column], spec)
      if (parsed.error) errors.push(parsed.error)
      if (parsed.value === null || parsed.value === undefined) continue
      values.push(parsed.value)
    }
    return {
      values: [...new Set(values)].sort((left, right) => left - right),
      errors: [...new Set(errors)],
    }
  }

  function uniqueWorkbookTextValues(items, column) {
    return [...new Set(items.map(item => textOf(item?.[column])).filter(Boolean))].sort()
  }

  function uniqueWorkbookProductionDates(items) {
    const values = []
    const errors = []
    for (const item of items) {
      const raw = textOf(item?.['生产日期'])
      if (!raw) continue
      const normalized = normalizeDate(raw)
      if (!normalized) {
        errors.push(`生产日期格式无效：${raw}`)
        continue
      }
      values.push(normalized)
    }
    return {
      values: [...new Set(values)].sort(),
      errors: [...new Set(errors)],
    }
  }

  function normalizeEnterpriseCode(value) {
    const raw = compact(value).replace(/\.pdf$/i, '')
    if (!raw) return ''
    const parts = raw.split(/[-_]/).map(compact).filter(Boolean)
    return parts.length > 1 ? parts[parts.length - 1] : raw
  }

  function splitListText(value) {
    return textOf(value)
      .split(/[\s,，;；、]+/)
      .map(textOf)
      .filter(Boolean)
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

  function normalizeStyleCode(value) {
    return compact(value).replace(/\.pdf$/i, '').split(/[-_]/).map(compact).filter(Boolean)[0] || ''
  }

  function parseStyleCodes() {
    const rawValues = styleCodesText
      .split(/[\s,，;；、]+/)
      .map(normalizeStyleCode)
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

  function temuSkuNoForFilename(target) {
    return compact(target?.skuExtCode || target?.excelSkuNo || target?.skuNo || target?.enterpriseCode)
  }

  function buildOutputFilenameForTarget(target, careLabel = {}) {
    const temuSku = Number(target?.productSkuId || 0) || ''
    const skuNo = temuSkuNoForFilename(target)
    return `${safeFilename(temuSku, 'TEMU页面SKU')}-${safeFilename(skuNo, 'SKU货号')}.pdf`
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

  function buildDirectInputWorkflow() {
    const parsedStyles = parseStyleCodes()
    const parsedCodes = parseEnterpriseCodes()
    const styleTargets = parsedStyles.unique.map((style, index) => ({
      inputMode: 'style_code',
      style,
      color: '',
      skc: style,
      representativeSize: '',
      skuCode: '',
      skuNo: '',
      enterpriseCode: '',
      composition: '',
      compositionSource: 'scm_or_manual',
      productLine: '',
      sizeCount: 0,
      status: 'ready',
      reason: '',
      outputFilename: '',
      sourceIndex: index + 1,
    }))
    const enterpriseTargets = parsedCodes.unique.map((code, index) => ({
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
    let targets = [...styleTargets, ...enterpriseTargets]
    if (!targets.length) return null
    if (maxSkc > 0) targets = targets.slice(0, maxSkc)
    const mode = styleTargets.length && enterpriseTargets.length
      ? 'style_and_enterprise_create_and_download'
      : styleTargets.length
        ? 'style_code_create_and_download'
        : 'enterprise_code_create_and_download'
    return {
      mode,
      summary: {
        sourceStyles: parsedStyles.unique.length,
        selectedStyles: targets.filter(item => item.inputMode === 'style_code').length,
        exactDuplicateStylesRemoved: parsedStyles.rawValues.length - parsedStyles.unique.length,
        sourceEnterpriseCodes: parsedCodes.unique.length,
        selectedEnterpriseCodes: targets.filter(item => item.inputMode === 'enterprise_code').length,
        exactDuplicateCodesRemoved: parsedCodes.rawValues.length - parsedCodes.unique.length,
        selectedTargets: targets.length,
        maxSkc,
      },
      excelTargets: targets,
    }
  }

  function buildWorkbookWorkflow() {
    const sourceRows = sourceRowsFromParam().map(normalizeWorkbookRow)
      .filter(row => compact(row['款号']))
    if (!sourceRows.length) return null

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

    const selectedRows = rows.filter(item => !pilotStyle || compact(item['款号']) === pilotStyle)
    const styleGroups = {}
    for (const item of selectedRows) {
      const style = compact(item['款号'])
      if (!styleGroups[style]) styleGroups[style] = []
      styleGroups[style].push(item)
    }

    let excelTargets = Object.keys(styleGroups).sort().map(style => {
      const items = [...styleGroups[style]]
      const representative = items[0]
      const manufacturerNames = [...new Set(items.map(item => textOf(item['制造商名称'])).filter(Boolean))].sort()
      const manufacturerAddresses = [...new Set(items.map(item => textOf(item['制造商地址'])).filter(Boolean))].sort()
      const productionDates = uniqueWorkbookProductionDates(items)
      const batchNumbers = uniqueWorkbookTextValues(items, '批次号')
      const widthValues = uniqueWorkbookMmValues(items, LABEL_DIMENSION_SPECS.width)
      const lengthValues = uniqueWorkbookMmValues(items, LABEL_DIMENSION_SPECS.length)
      const paddingValues = uniqueWorkbookMmValues(items, LABEL_DIMENSION_SPECS.padding)
      const manufacturerConflicts = [
        manufacturerNames.length > 1 ? '同一款号存在多个制造商名称' : '',
        manufacturerAddresses.length > 1 ? '同一款号存在多个制造商地址' : '',
        productionDates.values.length > 1 ? '同一款号存在多个生产日期' : '',
        batchNumbers.length > 1 ? '同一款号存在多个批次号' : '',
        ...productionDates.errors,
        widthValues.values.length > 1 ? '同一款号存在多个洗水唛宽度' : '',
        lengthValues.values.length > 1 ? '同一款号存在多个洗水唛长度' : '',
        paddingValues.values.length > 1 ? '同一款号存在多个上下预留' : '',
        ...widthValues.errors,
        ...lengthValues.errors,
        ...paddingValues.errors,
      ].filter(Boolean)
      const status = manufacturerConflicts.length ? 'exception' : 'ready'
      const reason = manufacturerConflicts.join('；')
      return {
        inputMode: 'style_code',
        style,
        color: '',
        skc: style,
        representativeSize: '',
        skuCode: '',
        skuNo: '',
        enterpriseCode: '',
        composition: '',
        compositionSource: 'scm_or_manual',
        productLine: '',
        manufacturerName: manufacturerNames[0] || textOf(representative['制造商名称']),
        manufacturerAddress: manufacturerAddresses[0] || textOf(representative['制造商地址']),
        productionDate: productionDates.values[0] || '',
        batchNumber: batchNumbers[0] || '',
        labelWidthMm: widthValues.values[0] ?? null,
        labelLengthMm: lengthValues.values[0] ?? null,
        labelPaddingMm: paddingValues.values[0] ?? null,
        sizeCount: 0,
        status,
        reason,
        outputFilename: '',
      }
    })
    if (maxSkc > 0) excelTargets = excelTargets.slice(0, maxSkc)

    return {
      mode: 'excel_style_code_create_and_download',
      summary: {
        sourceRows: sourceRows.length,
        exactDuplicateRowsRemoved,
        uniqueRows: rows.length,
        selectedRows: selectedRows.length,
        selectedStyles: Object.keys(styleGroups).length,
        readyTargets: excelTargets.filter(item => item.status === 'ready').length,
        exceptionTargets: excelTargets.filter(item => item.status === 'exception').length,
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
        open_url_if_missing: options.open_url_if_missing || '',
        open_wait_ms: Number(options.open_wait_ms || 0),
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

  function normalizeDateParts(year, month, day) {
    const y = Number(year)
    const m = Number(month)
    const d = Number(day)
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return ''
    if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return ''
    const date = new Date(Date.UTC(y, m - 1, d))
    if (
      date.getUTCFullYear() !== y
      || date.getUTCMonth() !== m - 1
      || date.getUTCDate() !== d
    ) return ''
    return [
      String(y).padStart(4, '0'),
      String(m).padStart(2, '0'),
      String(d).padStart(2, '0'),
    ].join('-')
  }

  function normalizeExcelSerialDate(value) {
    const serial = Number(value)
    if (!Number.isFinite(serial) || serial < 1 || serial > 80000) return ''
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 24 * 60 * 60 * 1000)
    return normalizeDateParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
  }

  function normalizeDate(value) {
    if (value && typeof value === 'object'
      && typeof value.getFullYear === 'function'
      && typeof value.getMonth === 'function'
      && typeof value.getDate === 'function') {
      return normalizeDateParts(value.getFullYear(), value.getMonth() + 1, value.getDate())
    }
    if (typeof value === 'number') return normalizeExcelSerialDate(value)

    const raw = textOf(value)
      .replace(/[./]/g, '-')
      .replace(/[年月]/g, '-')
      .replace(/[日号]/g, '')
    const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/)
    if (match) return normalizeDateParts(match[1], match[2], match[3])

    const compactMatch = raw.match(/^(\d{4})(\d{2})(\d{2})$/)
    if (compactMatch) return normalizeDateParts(compactMatch[1], compactMatch[2], compactMatch[3])

    if (/^\d{5}(?:\.\d+)?$/.test(raw)) return normalizeExcelSerialDate(raw)
    return ''
  }

  function normalizeProductionDate(value) {
    const normalized = normalizeDate(value)
    if (!normalized) return ''
    return `${normalized.slice(0, 8)}01`
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

  function fixedCareSymbolsProfile() {
    if (fixedCareSymbolsProfileParam === 'dingtalk_sop' || fixedCareSymbolsProfileParam === 'sop') {
      return FIXED_CARE_SYMBOL_PROFILES.dingtalk_sop
    }
    return FIXED_CARE_SYMBOL_PROFILES.legacy_20260731
  }

  function fixedCareSymbols(reason = '') {
    const profile = fixedCareSymbolsProfile()
    return {
      ...profile.symbols,
      __source: reason || `fixed_defaults:${profile.id}`,
      __labels: { ...profile.labels },
    }
  }

  function normalizedCareInstructionText(value) {
    return textOf(value)
      .replace(/°\s*C/ig, '℃')
      .replace(/\bC\b/g, '℃')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function firstRuleMatch(text, rules) {
    for (const rule of rules) {
      if (rule.patterns.some(pattern => pattern.test(text))) return rule
    }
    return null
  }

  function careSymbolOptionByValue(field, value) {
    const number = Number(value)
    return (TEMU_CARE_SYMBOL_OPTIONS[field] || []).find(option => option.value === number) || null
  }

  function careSymbolsFromObject(value, source, sourceText = '') {
    const input = value && typeof value === 'object' && !Array.isArray(value)
      ? (value.careSymbols && typeof value.careSymbols === 'object' ? value.careSymbols : value)
      : null
    if (!input) return null
    const symbols = {}
    const labels = {}
    const standardIds = {}
    const missing = []
    for (const field of CARE_SYMBOL_FIELDS) {
      const option = careSymbolOptionByValue(field, input[field])
      if (!option) {
        missing.push(field)
        continue
      }
      symbols[field] = option.value
      labels[field] = option.label
      standardIds[field] = option.standardId
    }
    if (Object.keys(symbols).length === 0) return null
    if (missing.length) {
      return {
        ...symbols,
        __labels: labels,
        __standardIds: standardIds,
        error: `${source}_care_symbols_unmapped:${missing.join(',')}`,
        missing,
        sourceText: sourceText || '',
      }
    }
    return withCareSymbolMeta(symbols, source, labels, standardIds, sourceText || '')
  }

  function plainCareSymbols(value) {
    const parsed = careSymbolsFromObject(value, 'plain')
    return parsed ? careSymbolValues(parsed) : null
  }

  function withCareSymbolMeta(symbols, source, labels = {}, standardIds = {}, sourceText = '', fallbackReason = '') {
    return {
      ...symbols,
      __source: source,
      __labels: labels,
      __standardIds: standardIds,
      __sourceText: sourceText,
      __fallbackReason: fallbackReason,
    }
  }

  function mergeMissingCareSymbols(
    mapped,
    fallback,
    missing,
    reason,
    sourceText,
    sourcePrefix = 'scm_instruction_mapping_partial_fallback',
  ) {
    const symbols = {}
    const labels = {}
    const standardIds = {}
    for (const field of CARE_SYMBOL_FIELDS) {
      if (mapped[field] != null) {
        symbols[field] = mapped[field]
        labels[field] = mapped.__labels?.[field] || ''
        standardIds[field] = mapped.__standardIds?.[field] || ''
      } else {
        symbols[field] = fallback[field]
        labels[field] = fallback.__labels?.[field] || ''
        standardIds[field] = fallback.__standardIds?.[field] || ''
      }
    }
    return withCareSymbolMeta(
      symbols,
      `${sourcePrefix}:${missing.join(',')}`,
      labels,
      standardIds,
      sourceText,
      reason,
    )
  }

  function parseAiCareSymbols(target) {
    const sourceText = normalizedCareInstructionText(target?.scmCareInstructionText || '')
    const parsed = careSymbolsFromObject(target?.scmCareSymbols || target?.careSymbols, 'scm_attachment_ai_care_symbols', sourceText)
    if (!parsed) return null
    if (!parsed.error) return parsed
    const mapped = mapCareSymbolsFromScmText(target)
    const fallback = mapped && !mapped.error ? mapped : fixedCareSymbols(parsed.error)
    return mergeMissingCareSymbols(
      parsed,
      fallback,
      parsed.missing || [],
      parsed.error,
      sourceText || parsed.sourceText || mapped?.sourceText || '',
      'scm_attachment_ai_care_symbols_partial_fallback',
    )
  }

  function mapCareSymbolsFromScmText(target) {
    const text = normalizedCareInstructionText(target?.scmCareInstructionText || params.scm_care_instruction_text || '')
    if (!text) return { error: 'missing_scm_care_instruction_text' }
    const symbols = {}
    const labels = {}
    const standardIds = {}
    const missing = []
    for (const field of CARE_SYMBOL_FIELDS) {
      const matched = firstRuleMatch(text, TEMU_CARE_SYMBOL_OPTIONS[field])
      if (!matched) {
        missing.push(field)
        continue
      }
      symbols[field] = matched.value
      labels[field] = matched.label
      standardIds[field] = matched.standardId
    }
    if (missing.length) {
      return {
        ...symbols,
        __labels: labels,
        __standardIds: standardIds,
        error: `scm_care_instruction_unmapped:${missing.join(',')}`,
        missing,
        sourceText: text.slice(0, 500),
      }
    }
    return withCareSymbolMeta(symbols, 'scm_instruction_mapping', labels, standardIds, text.slice(0, 500))
  }

  function parseCareSymbols(target) {
    if (careSymbolsMode === 'scm_or_fixed' || careSymbolsMode === 'auto') {
      const aiSymbols = parseAiCareSymbols(target)
      if (aiSymbols && !aiSymbols.error) return aiSymbols
      const mapped = mapCareSymbolsFromScmText(target)
      if (!mapped.error) return mapped
      if (mapped.missing?.length && Object.keys(careSymbolValues(mapped)).some(field => mapped[field] != null)) {
        return mergeMissingCareSymbols(
          mapped,
          fixedCareSymbols(mapped.error),
          mapped.missing,
          mapped.error,
          mapped.sourceText || '',
        )
      }
      return fixedCareSymbols(mapped.error)
    }
    if (careSymbolsMode === 'fixed_defaults' || careSymbolsMode === 'pilot_defaults') return fixedCareSymbols(careSymbolsMode)
    if (careSymbolsMode !== 'manual_json' && careSymbolsMode !== 'scm_confirmed_json') {
      return { error: `未知洗护符号模式：${careSymbolsMode || '空'}` }
    }
    const parsed = parseCareSymbolsJson(careSymbolsMode === 'scm_confirmed_json' ? 'SCM 已确认洗护符号 JSON' : '洗护符号 JSON')
    if (!parsed.error) parsed.__source = careSymbolsMode
    return parsed
  }

  function careSymbolValues(symbols) {
    return {
      washing: symbols.washing,
      bleaching: symbols.bleaching,
      drying: symbols.drying,
      ironing: symbols.ironing,
      dryCleaning: symbols.dryCleaning,
    }
  }

  function optionArray(value) {
    return Array.isArray(value) ? value.map(textOf).filter(Boolean) : []
  }

  function chooseTemuOption(options, requested, fieldName, sourceLabel = 'param') {
    const values = optionArray(options)
    const wanted = textOf(requested)
    if (wanted && values.length === 0) return { value: wanted, source: `${sourceLabel}_no_temu_options` }
    if (wanted && values.includes(wanted)) return { value: wanted, source: `${sourceLabel}_exact_temu_option` }
    if (wanted) return { value: wanted, source: `${sourceLabel}_not_in_temu_options` }
    if (values.length === 1) return { value: values[0], source: 'single_temu_option' }
    return {
      error: `${fieldName} 未命中 TEMU 回读选项，请在导入模板或参数中填写完全一致的值`,
      options: values,
    }
  }

  function chooseOptionalTemuOption(options, requested, fieldName, sourceLabel = 'param') {
    const wanted = textOf(requested)
    if (!wanted) return { value: '', source: `${sourceLabel}_blank_not_filled` }
    return chooseTemuOption(options, wanted, fieldName, sourceLabel)
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
    return {
      mode: 'scm_evidence_only_not_written',
      reason: scmCompositionMode === 'safe_simple'
        ? '业务反馈要求成分不回填 TEMU，已忽略 safe_simple'
        : '',
    }
  }

  function configuredTargetMm(target, keys, spec) {
    for (const key of keys) {
      const value = target?.[key]
      if (value === null || value === undefined || value === '') continue
      const number = Number(value)
      if (!Number.isFinite(number) || number < spec.min || number > spec.max) continue
      return { value: number, source: 'excel' }
    }
    return { value: spec.paramDefault(), source: 'param' }
  }

  function configuredLabelDimensions(target) {
    return {
      width: configuredTargetMm(target, ['excelLabelWidthMm', 'labelWidthMm'], LABEL_DIMENSION_SPECS.width),
      length: configuredTargetMm(target, ['excelLabelLengthMm', 'labelLengthMm'], LABEL_DIMENSION_SPECS.length),
      padding: configuredTargetMm(target, ['excelLabelPaddingMm', 'labelPaddingMm'], LABEL_DIMENSION_SPECS.padding),
    }
  }

  function resolvedLabelDimensions(target) {
    const dimensions = configuredLabelDimensions(target)
    return {
      width: dimensions.width.value,
      len: dimensions.length.value,
      padding: dimensions.padding.value,
      widthSource: dimensions.width.source,
      lengthSource: dimensions.length.source,
      paddingSource: dimensions.padding.source,
      lengthStrategy: dimensions.length.source === 'excel' ? 'excel_configured' : 'param_configured',
    }
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
      manufacturerAddressPg: textOf(care?.manufacturerAddressPg ?? care?.manufacturerAddress),
      productionDate: normalizeDate(care?.productionDate),
      batchNumber: textOf(care?.batchNumber),
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

  function normalizedTemplateNumber(value) {
    const number = Number(value)
    return Number.isFinite(number) ? number : 0
  }

  function templateFieldValueMatches(expected, actual, type = 'text') {
    if (type === 'number') {
      return Math.abs(normalizedTemplateNumber(expected) - normalizedTemplateNumber(actual)) < 0.001
    }
    if (type === 'date') return normalizeDate(expected) === normalizeDate(actual)
    return textOf(expected) === textOf(actual)
  }

  function savedTemplateExpectedFields(summary = shared.carePayloadSummary || {}) {
    return {
      manufacturerName: textOf(summary.manufacturerName),
      manufacturerAddressPg: textOf(summary.manufacturerAddressPg),
      productionDate: normalizeDate(summary.productionDate),
      batchNumber: textOf(summary.batchNumber),
      width: normalizedTemplateNumber(summary.width),
      len: normalizedTemplateNumber(summary.len),
      padding: normalizedTemplateNumber(summary.padding),
    }
  }

  function savedTemplateActualFields(care = {}) {
    return {
      manufacturerName: textOf(care.manufacturerName),
      manufacturerAddressPg: textOf(care.manufacturerAddressPg ?? care.manufacturerAddress),
      productionDate: normalizeDate(care.productionDate),
      batchNumber: textOf(care.batchNumber),
      width: normalizedTemplateNumber(care.width),
      len: normalizedTemplateNumber(care.len),
      padding: normalizedTemplateNumber(care.padding),
    }
  }

  function verifySavedTemplateFields(care, summary = shared.carePayloadSummary || {}) {
    const expected = savedTemplateExpectedFields(summary)
    const actual = savedTemplateActualFields(care)
    const specs = [
      ['制造商名称', 'manufacturerName', 'text'],
      ['制造商地址', 'manufacturerAddressPg', 'text'],
      ['生产日期', 'productionDate', 'date'],
      ['批次号', 'batchNumber', 'text'],
      ['洗水唛宽度mm', 'width', 'number'],
      ['洗水唛长度mm', 'len', 'number'],
      ['上下预留mm', 'padding', 'number'],
    ]
    const mismatches = specs
      .filter(([, key, type]) => !templateFieldValueMatches(expected[key], actual[key], type))
      .map(([label, key]) => ({
        field: label,
        expected: expected[key],
        actual: actual[key],
      }))
    return {
      ok: mismatches.length === 0,
      expected,
      actual,
      mismatches,
      summary: mismatches
        .map(item => `${item.field}: 期望「${item.expected}」/ TEMU回读「${item.actual}」`)
        .join('；'),
    }
  }

  function shouldVerifySavedTemplateFieldsAfterSave() {
    return executeMode === SAVE_MODE
      && isSaveExplicitlyEnabled()
      && shared.saveResult?.success === true
      && !!shared.carePayloadSummary
  }

  function buildCarePayload(care, target) {
    const symbols = parseCareSymbols(target)
    if (symbols.error) return symbols

    const targetManufacturerName = textOf(target?.excelManufacturerName || target?.manufacturerName)
    const targetManufacturerAddress = textOf(target?.excelManufacturerAddress || target?.manufacturerAddress)
    const manufacturerNameInput = targetManufacturerName || manufacturerNameParam
    const manufacturerAddressInput = targetManufacturerAddress || manufacturerAddressParam
    const manufacturerNameSource = targetManufacturerName ? 'excel' : (manufacturerNameParam ? 'param' : 'blank')
    const manufacturerAddressSource = targetManufacturerAddress ? 'excel' : (manufacturerAddressParam ? 'param' : 'blank')
    const manufacturerName = chooseOptionalTemuOption(care?.manufacturerNameOptions, manufacturerNameInput, '制造商名称', manufacturerNameSource)
    if (manufacturerName.error) return manufacturerName
    const manufacturerAddress = chooseOptionalTemuOption(care?.manufacturerAddressOptions, manufacturerAddressInput, '制造商地址', manufacturerAddressSource)
    if (manufacturerAddress.error) return manufacturerAddress
    const targetProductionDateInput = textOf(target?.excelProductionDate || target?.productionDate)
    const productionDate = targetProductionDateInput ? normalizeDate(targetProductionDateInput) : normalizeProductionDate(productionDateParam)
    const productionDateSource = targetProductionDateInput ? 'excel' : 'param'
    if (!productionDate) return { error: `生产日期格式无效：${targetProductionDateInput || productionDateParam}` }
    const batchNumberInput = textOf(target?.excelBatchNumber || target?.batchNumber) || batchNumberParam
    const batchNumberSource = textOf(target?.excelBatchNumber || target?.batchNumber) ? 'excel' : 'param'

    const showTrackingLabel = true
    const ukfr = care?.ukfrInfo || {}
    const materialOverride = buildMaterialOverride(care, target)
    const labelDimensions = resolvedLabelDimensions(target)
    return {
      payload: {
        productSkuId: Number(target.productSkuId || 0),
        productSkcId: Number(target.productSkcId || 0),
        productId: Number(target.productId || 0),
        showTrackingLabel,
        manufacturerName: showTrackingLabel ? manufacturerName.value : void 0,
        manufacturerAddressPg: showTrackingLabel ? manufacturerAddress.value : void 0,
        batchNumber: showTrackingLabel ? batchNumberInput : void 0,
        productionDate: showTrackingLabel ? productionDate : void 0,
        isSkipRisk: false,
        washing: symbols.washing,
        bleaching: symbols.bleaching,
        drying: symbols.drying,
        ironing: symbols.ironing,
        dryCleaning: symbols.dryCleaning,
        len: labelDimensions.len,
        width: labelDimensions.width,
        showSize: care?.showSize == null ? void 0 : care.showSize === true,
        padding: labelDimensions.padding,
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
        productionDateSource,
        batchNumber: batchNumberInput,
        batchNumberSource,
        careSymbols: careSymbolValues(symbols),
        width: labelDimensions.width,
        len: labelDimensions.len,
        padding: labelDimensions.padding,
        widthSource: labelDimensions.widthSource,
        lengthSource: labelDimensions.lengthSource,
        paddingSource: labelDimensions.paddingSource,
        lengthStrategy: labelDimensions.lengthStrategy,
        requestedMinimumLen: labelLengthMm,
        careSymbolsMode,
        careSymbolsSource: textOf(symbols.__source),
        careSymbolsLabels: symbols.__labels || {},
        careSymbolsStandardIds: symbols.__standardIds || {},
        careSymbolsSourceText: textOf(symbols.__sourceText),
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
      excelManufacturerName: textOf(target.excelManufacturerName || target.manufacturerName),
      excelManufacturerAddress: textOf(target.excelManufacturerAddress || target.manufacturerAddress),
      excelProductionDate: textOf(target.excelProductionDate || target.productionDate),
      excelBatchNumber: textOf(target.excelBatchNumber || target.batchNumber),
      excelLabelWidthMm: Number(target.excelLabelWidthMm || target.labelWidthMm || 0) || null,
      excelLabelLengthMm: Number(target.excelLabelLengthMm || target.labelLengthMm || 0) || null,
      excelLabelPaddingMm: Number.isFinite(Number(target.excelLabelPaddingMm ?? target.labelPaddingMm))
        ? Number(target.excelLabelPaddingMm ?? target.labelPaddingMm)
        : null,
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
      scmCareSymbols: plainCareSymbols(target.scmCareSymbols || target.careSymbols),
      scmAttachmentRecognitionStatus: textOf(target.scmAttachmentRecognitionStatus),
      scmAttachmentRecognitionError: textOf(target.scmAttachmentRecognitionError),
      autoRetryAttempt: Number(target.autoRetryAttempt || 0),
      autoRetryReason: textOf(target.autoRetryReason),
      autoRetrySourceResult: textOf(target.autoRetrySourceResult),
      retryOfKey: textOf(target.retryOfKey),
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

  function targetInputMode(target) {
    return textOf(target?.inputMode)
  }

  function isStyleCodeProgressTarget(target) {
    return targetInputMode(target) === 'style_code'
  }

  function isSkuProgressTarget(target) {
    if (!target || isStyleCodeProgressTarget(target)) return false
    return !!(target.skuNo || target.skuExtCode || target.enterpriseCode)
  }

  function targetStyleForProgress(target) {
    return compact(target?.style || target?.excelStyle || target?.skc || target?.skcExtCode)
  }

  function targetSkuForProgress(target) {
    return compact(target?.skuNo || target?.skuExtCode || target?.enterpriseCode)
  }

  function countSkuProgressTargets(targets) {
    return (Array.isArray(targets) ? targets : []).filter(isSkuProgressTarget).length
  }

  function remainingSkuLimitBeforeTarget(targets, index) {
    if (maxDownloads <= 0) return Number.POSITIVE_INFINITY
    const before = Array.isArray(targets) ? targets.slice(0, Math.max(0, index)) : []
    return Math.max(0, maxDownloads - countSkuProgressTargets(before))
  }

  function progressCount(value, total = 0) {
    const number = Math.max(0, Math.floor(Number(value || 0)))
    return total > 0 ? Math.min(number, total) : number
  }

  function inferStyleProgressTotal(nextShared, targets) {
    const summary = nextShared?.workflowSummary || {}
    const fromSummary = Number(summary.selectedStyles || 0)
    if (Number.isFinite(fromSummary) && fromSummary > 0) return fromSummary
    return (Array.isArray(targets) ? targets : []).filter(isStyleCodeProgressTarget).length
  }

  function inferProgressStage(currentTarget, skuTotal) {
    if (isStyleCodeProgressTarget(currentTarget)) return 'expand_style'
    if (skuTotal > 0) return 'sku'
    return 'prepare'
  }

  function progressStoreText(stage, styleCompleted, styleTotal, skuCompleted, skuTotal) {
    if (stage === 'finalize') return 'AI洗唛制作 / 汇总完成'
    if (stage === 'prepare') return 'AI洗唛制作 / 准备表格'
    if (stage === 'expand_style') {
      const current = styleTotal > 0 ? Math.min(styleCompleted + 1, styleTotal) : styleCompleted + 1
      return styleTotal > 0
        ? `AI洗唛制作 / 展开款号 ${current}/${styleTotal}`
        : 'AI洗唛制作 / 展开款号'
    }
    if (skuTotal > 0) {
      const current = Math.min(skuCompleted + 1, skuTotal)
      return `AI洗唛制作 / 制作 SKU ${current}/${skuTotal}`
    }
    return 'AI洗唛制作 / 制作 SKU'
  }

  function withAiWashProgress(nextShared = shared, overrides = {}) {
    const targets = Array.isArray(nextShared.excelTargets) ? nextShared.excelTargets : []
    const index = Math.max(0, Number(nextShared.currentExcelTargetIndex || 0))
    const currentTarget = nextShared.excelTarget || targets[index] || {}
    const inferredSkuTotal = countSkuProgressTargets(targets)
    const styleTotal = Math.max(0, Math.floor(Number(
      overrides.style_total ?? nextShared.style_total ?? inferStyleProgressTotal(nextShared, targets) ?? 0,
    )))
    const skuTotal = Math.max(0, Math.floor(Number(
      overrides.sku_total ?? nextShared.sku_total ?? inferredSkuTotal,
    )))
    const styleCompleted = progressCount(
      overrides.style_completed ?? nextShared.style_completed,
      styleTotal,
    )
    const skuCompleted = progressCount(
      overrides.sku_completed ?? nextShared.sku_completed,
      skuTotal,
    )
    const stage = textOf(overrides.wash_label_stage) || inferProgressStage(currentTarget, skuTotal)
    const styleCurrent = compact(overrides.style_current || targetStyleForProgress(currentTarget))
    const skuCurrent = compact(overrides.sku_current || targetSkuForProgress(currentTarget))
    const activeTotal = skuTotal > 0 ? skuTotal : styleTotal
    const activeCurrent = stage === 'finalize'
      ? activeTotal
      : skuTotal > 0
        ? Math.min(skuCompleted + (skuCurrent ? 1 : 0), skuTotal)
        : styleTotal > 0
          ? Math.min(styleCompleted + (styleCurrent ? 1 : 0), styleTotal)
          : 0

    return {
      ...nextShared,
      progress_kind: AI_WASH_PROGRESS_KIND,
      wash_label_stage: stage,
      style_total: styleTotal,
      style_completed: styleCompleted,
      style_current: styleCurrent,
      sku_total: skuTotal,
      sku_completed: skuCompleted,
      sku_current: skuCurrent,
      sku_skipped: progressCount(overrides.sku_skipped ?? nextShared.sku_skipped),
      sku_success: progressCount(overrides.sku_success ?? nextShared.sku_success),
      sku_failed: progressCount(overrides.sku_failed ?? nextShared.sku_failed),
      sku_retrying: progressCount(overrides.sku_retrying ?? nextShared.sku_retrying),
      wash_label_store: targetStore,
      total_rows: activeTotal || Number(nextShared.total_rows || 0),
      current_exec_no: activeCurrent || Number(nextShared.current_exec_no || 0),
      current_buyer_id: skuCurrent || styleCurrent || nextShared.current_buyer_id || '',
      current_store: progressStoreText(stage, styleCompleted, styleTotal, skuCompleted, skuTotal),
    }
  }

  function styleQueryTarget() {
    return isStyleCodeProgressTarget(excelTarget())
  }

  function replaceCurrentExcelTarget(replacements, nextShared = shared) {
    const targets = excelTargets()
    const index = Math.max(0, Number(nextShared.currentExcelTargetIndex || 0))
    const nextTargets = [
      ...targets.slice(0, index),
      ...(Array.isArray(replacements) ? replacements : []),
      ...targets.slice(index + 1),
    ]
    const nextIndex = Math.min(index, Math.max(0, nextTargets.length - 1))
    return {
      ...nextShared,
      excelTargets: nextTargets,
      currentExcelTargetIndex: nextIndex,
      excelTarget: nextTargets[nextIndex] || null,
      total_rows: nextTargets.length,
      current_exec_no: nextTargets.length ? nextIndex + 1 : 0,
      current_buyer_id: nextTargets[nextIndex]?.skuNo || nextTargets[nextIndex]?.style || '',
      current_store: targetStore,
    }
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
    const autoRetryAttempt = Number(extra.自动重试次数 ?? target?.autoRetryAttempt ?? currentExcelTarget?.autoRetryAttempt ?? 0)
    const autoRetryReason = textOf(extra.自动重试原因 || target?.autoRetryReason || currentExcelTarget?.autoRetryReason)
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
      自动重试次数: autoRetryAttempt,
      是否重试后成功: extra.是否重试后成功 ?? (autoRetryAttempt > 0 && result === 'official_download_received'),
      自动重试原因: autoRetryReason,
      结果: result,
      来源: String(extra.source || (result === 'official_download_received' ? 'temu_official_download' : result)),
      文件名: textOf(target?.outputFilename),
      文件路径: String(extra.path || ''),
      文件大小: Number(extra.bytes || 0),
      PDF签名已校验: !!extra.signatureValidated,
      页面API已校验: !!rowShared.apiValidated,
      保存字段已校验: rowShared.savedTemplateFieldsVerified === true,
      保存字段修正次数: Number(rowShared.templateFieldCorrectionAttempts || 0),
      保存字段差异: String(extra.保存字段差异 || rowShared.savedTemplateFieldMismatchSummary || ''),
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
      SCM洗护说明来源: String(extra.SCM洗护说明来源 || target?.scmCareInstructionSource || ''),
      SCM附件识别状态: String(extra.SCM附件识别状态 || target?.scmAttachmentRecognitionStatus || rowShared.scmAttachmentRecognitionStatus || ''),
      洗水唛宽度mm: Number(rowShared.carePayloadSummary?.width || rowShared.careLabel?.width || 0),
      洗水唛长度mm: Number(rowShared.carePayloadSummary?.len || rowShared.careLabel?.len || 0),
      上下预留mm: Number(rowShared.carePayloadSummary?.padding || rowShared.careLabel?.padding || 0),
      安全打印区加长: rowShared.carePayloadSummary?.safePrintLengthAdjusted === true,
      安全打印区起始长度mm: Number(rowShared.carePayloadSummary?.safePrintLengthBaseMm || 0),
      安全打印区最终长度mm: Number(rowShared.carePayloadSummary?.safePrintLengthFinalMm || 0),
      洗水唛尺码: String(rowShared.careLabel?.size || ''),
      洗护符号模式: String(rowShared.carePayloadSummary?.careSymbolsMode || careSymbolsMode),
      洗护符号: rowShared.carePayloadSummary?.careSymbols ? JSON.stringify(rowShared.carePayloadSummary.careSymbols) : '',
      洗护符号来源: String(rowShared.carePayloadSummary?.careSymbolsSource || ''),
      洗护符号说明: rowShared.carePayloadSummary?.careSymbolsLabels ? JSON.stringify(rowShared.carePayloadSummary.careSymbolsLabels) : '',
      洗护符号标准ID: rowShared.carePayloadSummary?.careSymbolsStandardIds ? JSON.stringify(rowShared.carePayloadSummary.careSymbolsStandardIds) : '',
      SCM洗护说明: String(rowShared.carePayloadSummary?.careSymbolsSourceText || target?.scmCareInstructionText || ''),
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
      exportModalCloseAttempts: 0,
      editDrawerAttempts: 0,
      editDrawerCloseAttempts: 0,
      editCompleteExportAttempts: 0,
      staleEditModalCloseAttempts: 0,
      overflowConfirmCloseAttempts: 0,
      safePrintSizeModalAttempts: 0,
      safePrintLengthBaseMm: 0,
      safePrintLengthCoarseSteps: 0,
      safePrintLengthFineSteps: 0,
      safePrintLengthAdjustedMm: 0,
      safePrintLengthAdjustmentStrategy: '',
      safePrintPendingLengthMm: 0,
      templateFieldCorrectionAttempts: 0,
      savedTemplateFieldsVerified: false,
      savedTemplateFieldMismatchSummary: '',
      savedTemplateFieldReadback: null,
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
      excelManufacturerName: textOf(target?.manufacturerName || target?.excelManufacturerName),
      excelManufacturerAddress: textOf(target?.manufacturerAddress || target?.excelManufacturerAddress),
      excelProductionDate: textOf(target?.productionDate || target?.excelProductionDate),
      excelBatchNumber: textOf(target?.batchNumber || target?.excelBatchNumber),
      excelLabelWidthMm: Number(target?.labelWidthMm || target?.excelLabelWidthMm || 0) || null,
      excelLabelLengthMm: Number(target?.labelLengthMm || target?.excelLabelLengthMm || 0) || null,
      excelLabelPaddingMm: Number.isFinite(Number(target?.labelPaddingMm ?? target?.excelLabelPaddingMm))
        ? Number(target?.labelPaddingMm ?? target?.excelLabelPaddingMm)
        : null,
      autoRetryAttempt: Number(target?.autoRetryAttempt || 0),
      autoRetryReason: textOf(target?.autoRetryReason),
      autoRetrySourceResult: textOf(target?.autoRetrySourceResult),
      retryOfKey: textOf(target?.retryOfKey),
    }
    attached.outputFilename = buildOutputFilenameForTarget(attached)
    return attached
  }

  function retryAttemptsByKey(nextShared = shared) {
    const value = nextShared?.failedSkuRetryAttempts
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  }

  function targetRetryKey(target) {
    const productSkuId = Number(target?.productSkuId || 0)
    if (productSkuId) return `productSkuId:${productSkuId}`
    const sku = compact(target?.skuExtCode || target?.excelSkuNo || target?.skuNo || target?.enterpriseCode)
    if (sku) return `sku:${sku}`
    const label = Number(target?.labelCode || 0)
    if (label) return `labelCode:${label}`
    return ''
  }

  function retryCandidateTarget(nextShared = shared) {
    const excel = nextShared.excelTarget || excelTarget() || {}
    const api = nextShared.apiTarget || shared.apiTarget || {}
    const merged = {
      ...excel,
      ...api,
      inputMode: textOf(excel.inputMode || api.inputMode || 'style_sku'),
      skuNo: compact(excel.skuNo || excel.excelSkuNo || api.skuExtCode || api.skuNo),
      enterpriseCode: compact(excel.enterpriseCode || excel.skuNo || excel.excelSkuNo || api.skuExtCode || api.enterpriseCode),
      status: 'ready',
    }
    merged.outputFilename = textOf(merged.outputFilename) || buildOutputFilenameForTarget(merged)
    return merged
  }

  function shouldRetryFailure(result, reason, extra = {}, nextShared = shared) {
    if (!excelMode() || failedSkuMaxRetries <= 0) return false
    const target = retryCandidateTarget(nextShared)
    if (!isSkuProgressTarget(target)) return false
    const text = [result, reason, extra.temuRowStatus, extra.source].map(textOf).join(' ')
    if (/dry[_ -]?run|风险确认|仅打印|不可制作|不唯一|缺少\s*SKU|Excel|目标标识缺失|缺少 productId|saved_template_fields_mismatch|保存字段回读不一致|字段回读仍不一致/i.test(text)) {
      return false
    }
    const key = targetRetryKey(target)
    if (!key) return false
    return Number(retryAttemptsByKey(nextShared)[key] || 0) < failedSkuMaxRetries
  }

  function scheduleFailedSkuRetry(result, reason, extra = {}, nextShared = shared) {
    if (!shouldRetryFailure(result, reason, extra, nextShared)) return null
    const target = retryCandidateTarget(nextShared)
    const key = targetRetryKey(target)
    const attempts = retryAttemptsByKey(nextShared)
    const nextAttempt = Number(attempts[key] || 0) + 1
    const targets = Array.isArray(nextShared.excelTargets) ? nextShared.excelTargets : excelTargets()
    const retryTarget = {
      ...target,
      status: 'ready',
      autoRetryAttempt: nextAttempt,
      autoRetryReason: textOf(reason),
      autoRetrySourceResult: textOf(result),
      retryOfKey: key,
      outputFilename: buildOutputFilenameForTarget(target),
    }
    const retryTargets = [...targets, retryTarget]
    const retryShared = withAiWashProgress({
      ...nextShared,
      excelTargets: retryTargets,
      failedSkuRetryAttempts: {
        ...attempts,
        [key]: nextAttempt,
      },
      lastAutoRetry: {
        key,
        skuNo: compact(retryTarget.skuNo || retryTarget.skuExtCode),
        productSkuId: Number(retryTarget.productSkuId || 0),
        attempt: nextAttempt,
        maxAttempts: failedSkuMaxRetries,
        reason: textOf(reason),
      },
      temuRowStatus: `已加入自动重试队列 ${nextAttempt}/${failedSkuMaxRetries}`,
    }, {
      sku_total: countSkuProgressTargets(retryTargets),
      sku_retrying: Number(nextShared.sku_retrying || 0) + 1,
      wash_label_stage: 'sku',
    })
    return nextPhase(advancePhaseName(), 100, retryShared, [])
  }

  function finishTargetFailure(result, reason, extra = {}, nextShared = shared) {
    const retryAction = scheduleFailedSkuRetry(result, reason, extra, nextShared)
    if (retryAction) return retryAction
    const target = retryCandidateTarget(nextShared)
    const retryAttempt = Number(target.autoRetryAttempt || 0)
    const finalExtra = {
      ...extra,
      自动重试次数: retryAttempt,
      自动重试原因: textOf(target.autoRetryReason),
      是否重试后成功: false,
    }
    const finalSharedBase = {
      ...nextShared,
      temuRowStatus: String(extra.temuRowStatus || '单条失败'),
    }
    const finalShared = excelMode() && isSkuProgressTarget(target)
      ? withAiWashProgress(finalSharedBase, {
        sku_failed: Number(nextShared.sku_failed || 0) + 1,
        wash_label_stage: 'sku',
      })
      : finalSharedBase
    return nextPhase(
      advancePhaseName(),
      100,
      finalShared,
      [resultRow(result, reason, finalExtra, null, finalShared)],
    )
  }

  function continueAfterFailure(reason, extra = {}, nextShared = shared) {
    return finishTargetFailure('official_download_failed', reason, extra, nextShared)
  }

  function officialPdfCheckItem(target) {
    return {
      label: `TEMU 官方洗水唛 PDF ${target.excelSkuCode || target.skcExtCode || ''}-${target.excelSkuNo || target.skuExtCode || ''}`,
      filename: target.outputFilename,
      target_dir: outputDir,
      expected_magic: '%PDF-',
      min_bytes: 1024,
      not_before_iso: taskStartedAt,
    }
  }

  function existingOfficialPdfCheckAction(apiRecord, nextShared, nextPhaseName) {
    if (!downloadAfterSave || !outputDir || !nextPhaseName || !apiRecord?.outputFilename || nextShared.existingOfficialPdfChecked) return null
    if (executeMode === SAVE_MODE && isSaveExplicitlyEnabled()) return null
    return {
      success: true,
      data: [],
      meta: {
        action: 'check_files',
        items: [officialPdfCheckItem(apiRecord)],
        strict: false,
        shared_key: 'existingOfficialPdfCheck',
        next_phase: 'verify_existing_official_pdf',
        sleep_ms: 50,
        shared: {
          ...nextShared,
          apiTarget: apiRecord,
          existingOfficialPdfChecked: true,
          existingOfficialPdfNextPhase: nextPhaseName,
          temuRowStatus: '检查导出目录已有官方PDF',
        },
      },
    }
  }

  function bestCheckedFile(checkResult) {
    const items = Array.isArray(checkResult?.items) ? checkResult.items : []
    return items.find(item => item?.success && item?.path)
      || items.find(item => item?.path || item?.error)
      || null
  }

  function continueAfterExistingPdfMiss(nextShared = shared) {
    const target = apiTarget()
    const nextPhaseName = textOf(nextShared.existingOfficialPdfNextPhase)
      || (isDownloadable(target) ? 'prepare_search' : 'prepare_care_payload')
    return nextPhase(
      nextPhaseName,
      100,
      {
        ...nextShared,
        existingOfficialPdfNextPhase: '',
        temuRowStatus: textOf(nextShared.temuRowStatus) || '导出目录未命中已有PDF',
      },
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

  function scmAttachmentExtension(url) {
    const clean = textOf(url).split('?')[0]
    const match = clean.match(/\.([A-Za-z0-9]{1,8})$/)
    return match ? `.${match[1].toLowerCase()}` : '.pdf'
  }

  function scmAttachmentFilename(target, evidence) {
    const row = evidence?.selected || {}
    const style = inferStyleFromTarget(target) || row.style || 'style'
    const order = textOf(row.orderNo || 'scm')
    const color = compact(row.colorCode || '')
    const ext = scmAttachmentExtension(row.washFileUrl || target?.scmWashFile)
    return safeFilename(`${style}${color ? `-${color}` : ''}-${order}-wash-attachment${ext}`, `scm-wash-attachment${ext}`)
  }

  function scmAttachmentHeaders() {
    return {
      Referer: SCM_WASH_APPROVAL_REFERER,
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,application/pdf,application/octet-stream,*/*;q=0.8',
    }
  }

  function scmAttachmentValidation(url) {
    const ext = scmAttachmentExtension(url)
    if (ext === '.pdf') {
      return {
        expected_magic: '%PDF-',
        min_bytes: 1,
        validate_signature: true,
      }
    }
    return {
      min_bytes: 1,
    }
  }

  function shouldRecognizeScmAttachment(apiRecord, evidence) {
    if (!scmAttachmentRecognitionEnabled) return false
    if (careSymbolsMode !== 'scm_or_fixed' && careSymbolsMode !== 'auto') return false
    const url = textOf(evidence?.selected?.washFileUrl || apiRecord?.scmWashFile)
    if (!url) return false
    const aiSymbols = parseAiCareSymbols(apiRecord)
    if (aiSymbols && !aiSymbols.error) return false
    const mapped = mapCareSymbolsFromScmText(apiRecord)
    return !!mapped.error
  }

  function scmWashInstructionCache(nextShared = shared) {
    const cache = nextShared?.scmWashInstructionByStyle
    return cache && typeof cache === 'object' && !Array.isArray(cache) ? cache : {}
  }

  function scmWashInstructionCacheKey(target) {
    return inferStyleFromTarget(target)
  }

  function withScmWashInstructionCache(nextShared, target, entry) {
    const style = scmWashInstructionCacheKey(target)
    if (!style) return nextShared
    return {
      ...nextShared,
      scmWashInstructionByStyle: {
        ...scmWashInstructionCache(nextShared),
        [style]: {
          style,
          ok: entry?.ok === true,
          instructionText: normalizedCareInstructionText(entry?.instructionText || ''),
          careSymbols: plainCareSymbols(entry?.careSymbols),
          source: textOf(entry?.source || ''),
          status: textOf(entry?.status || ''),
          error: textOf(entry?.error || ''),
          washFile: textOf(entry?.washFile || target?.scmWashFile),
          attachmentPath: textOf(entry?.attachmentPath || ''),
        },
      },
    }
  }

  function cachedScmWashInstructionForTarget(target) {
    const style = scmWashInstructionCacheKey(target)
    if (!style) return null
    return scmWashInstructionCache()[style] || null
  }

  function reuseCachedScmWashInstructionAction(target, evidence) {
    const cached = cachedScmWashInstructionForTarget(target)
    if (!cached) return null
    const instructionText = normalizedCareInstructionText(cached.instructionText || '')
    const careSymbols = plainCareSymbols(cached.careSymbols)
    if (cached.ok && (instructionText || careSymbols)) {
      return nextPhase('api_care_query', 100, {
        ...shared,
        apiTarget: {
          ...target,
          scmCareInstructionText: instructionText,
          scmCareInstructionSource: textOf(cached.source || 'scm_wash_attachment_ai_ocr'),
          scmCareSymbols: careSymbols,
          scmAttachmentRecognitionStatus: 'recognized_reused',
          scmAttachmentRecognitionError: '',
        },
        scmLookupAttempts: 0,
        scmLookupStatus: 'SCM查询成功，复用同款洗唛附件识别结果',
        scmAttachmentRecognitionStatus: 'recognized_reused',
        scmAttachmentRecognitionError: '',
        scmRows: evidence?.rows || [],
        scmSelectedRow: evidence?.selected || null,
      })
    }
    const reason = textOf(cached.error || '同款洗唛附件未识别到完整洗护说明')
    return nextPhase('api_care_query', 100, {
      ...shared,
      apiTarget: {
        ...target,
        scmAttachmentRecognitionStatus: 'recognition_skipped_same_style_failed',
        scmAttachmentRecognitionError: reason,
      },
      scmLookupAttempts: 0,
      scmLookupStatus: 'SCM同款洗唛附件已尝试识别失败，使用固定洗护符号',
      scmAttachmentRecognitionStatus: 'recognition_skipped_same_style_failed',
      scmAttachmentRecognitionError: reason,
      scmRows: evidence?.rows || [],
      scmSelectedRow: evidence?.selected || null,
    })
  }

  function scmAttachmentDownloadAction(apiRecord, evidence) {
    const row = evidence.selected || {}
    const url = textOf(row.washFileUrl || apiRecord.scmWashFile)
    const filename = scmAttachmentFilename(apiRecord, evidence)
    const validation = scmAttachmentValidation(url)
    return {
      success: true,
      data: [],
      meta: {
        action: 'download_urls',
        items: [{
          url,
          filename,
          label: `SCM洗唛附件 ${inferStyleFromTarget(apiRecord) || ''}`,
          headers: scmAttachmentHeaders(),
          no_proxy: true,
          ...validation,
          target_relative_path: `scm-wash-attachments/${filename}`,
          retry_attempts: 2,
          retry_delay_ms: 500,
          timeout_seconds: timeoutSeconds,
        }],
        strict: false,
        shared_key: 'scmAttachmentDownload',
        next_phase: 'verify_scm_attachment_download',
        sleep_ms: 100,
        shared: {
          ...shared,
          apiTarget: apiRecord,
          scmSelectedRow: evidence.selected,
          scmRows: evidence.rows,
          scmLookupAttempts: 0,
          scmLookupStatus: 'SCM查询成功，准备下载洗唛附件识别洗护说明',
          scmAttachmentRecognitionStatus: 'download_pending',
        },
      },
    }
  }

  function bestDownloadPath(downloadResult) {
    const items = Array.isArray(downloadResult?.items) ? downloadResult.items : []
    return items.find(item => item?.success && item?.path) || null
  }

  function recognizeScmAttachmentAction(target, item) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'recognize_wash_care_media',
        items: [{
          path: textOf(item.path),
          filename: textOf(item.filename),
          label: textOf(item.label || 'SCM洗唛附件'),
          source_url: textOf(item.url),
          style: inferStyleFromTarget(target),
          order_no: textOf(target.scmOrderNo),
        }],
        model_id: aiWashInstructionModelId,
        fallback_model_ids: splitListText(aiWashInstructionFallbackModels),
        shared_key: 'scmAttachmentRecognition',
        next_phase: 'verify_scm_attachment_recognition',
        sleep_ms: 100,
        shared: {
          ...shared,
          apiTarget: target,
          scmAttachmentPath: textOf(item.path),
          scmAttachmentRecognitionStatus: 'recognizing',
          scmLookupStatus: 'SCM洗唛附件已下载，正在识别洗护说明',
        },
      },
    }
  }

  function shouldResaveBeforeDownload(apiRecord) {
    return executeMode === SAVE_MODE
      && isSaveExplicitlyEnabled()
      && downloadAfterSave
      && isCareLabelRequired(apiRecord)
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

  async function queryApiRecordsByStyle(style) {
    const styleCode = compact(style)
    const records = []
    let total = 0
    let page = 1
    let totalPages = 1
    while (page <= totalPages && page <= 100) {
      const response = await pagePost('/visage-agent-seller/labelcode/pageQuery', {
        page,
        pageSize: API_PAGE_SIZE,
        skcExtCodes: [styleCode],
      })
      const payload = responseData(response)
      const pageItems = Array.isArray(payload.pageItems) ? payload.pageItems : []
      total = Math.max(total, Number(payload.total || 0))
      totalPages = Math.max(1, Math.ceil(total / API_PAGE_SIZE))
      records.push(...pageItems.map(normalizeApiRecord).filter(record => record.skcExtCode === styleCode))
      page += 1
    }
    return { total, records }
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
    const setter = typeof HTMLInputElement !== 'undefined'
      ? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      : null
    if (setter) setter.call(input, value)
    else input.value = value
    if (typeof Event === 'function' && input.dispatchEvent) {
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
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
        .some(action => textOf(action) === '编辑')
    })
    return rows.length === 1 ? rows[0] : null
  }

  function washLabelAction(row, actionText) {
    const actions = [...row.querySelectorAll('a,button,[role="button"]')]
      .filter(action => visible(action) && textOf(action) === actionText)
    if (!actions.length) return null
    const scoped = actions.find(action => {
      let parent = action.parentElement
      for (let depth = 0; parent && depth < 5; depth += 1, parent = parent.parentElement) {
        const parentText = textOf(parent)
        if (parentText.includes('商品合规标签')) return false
        if (parentText.includes('洗水唛')) return true
      }
      return false
    })
    return scoped || actions[0]
  }

  function editWashLabelAction(row) {
    return washLabelAction(row, '编辑')
  }

  function washLabelEditDrawer() {
    const drawers = [...document.querySelectorAll('[class*="Drawer_visible"], [class*="Drawer_content"], [class*="drawer-body"], [class*="edit-modal_container"]')]
      .filter(visible)
      .filter(drawer => {
        const drawerText = textOf(drawer)
        return drawerText.includes('修改洗水唛') && drawerText.includes('完成并导出')
      })
    return drawers.length ? drawers[drawers.length - 1] : null
  }

  function closeWashLabelEditDrawerIfPresent(nextPhaseName, nextShared = shared, data = [], sleepMs = 300) {
    const drawer = washLabelEditDrawer()
    if (!drawer) return null
    const attempts = Number(nextShared.editDrawerCloseAttempts || 0)
    if (attempts >= 3) return fail('洗水唛编辑窗口关闭失败，已停止以避免复用旧预览')
    const cancel = [...drawer.querySelectorAll('button')]
      .find(candidate => visible(candidate) && textOf(candidate) === '取消')
    const close = [...drawer.querySelectorAll('button,[role="button"],span')]
      .find(candidate => visible(candidate) && ['关闭', 'Close', '×'].includes(textOf(candidate)))
    const action = cancel || close
    if (action?.click) action.click()
    return nextPhase(nextPhaseName, sleepMs, {
      ...nextShared,
      editDrawerCloseAttempts: attempts + 1,
    }, data)
  }

  function completeAndExportButton() {
    const drawer = washLabelEditDrawer()
    if (!drawer) return null
    return [...drawer.querySelectorAll('button')]
      .find(candidate => visible(candidate) && textOf(candidate) === '完成并导出') || null
  }

  function washLabelSafetyOverflowVisible() {
    const drawer = washLabelEditDrawer()
    return !!(drawer && textOf(drawer).includes(SAFE_PRINT_OVERFLOW_TEXT))
  }

  function sizeEditModal() {
    const candidates = [
      ...document.querySelectorAll('[data-testid="beast-core-modal"], [class*="MDL_outerWrapper"], [class*="MDL_innerWrapper"]'),
    ].filter(visible)
      .filter(modal => {
        const modalText = textOf(modal)
        return modalText.includes('修改洗水唛尺寸') && modalText.includes('确认')
      })
    return candidates.length ? candidates[candidates.length - 1] : null
  }

  function overflowConfirmModal() {
    const candidates = [
      ...document.querySelectorAll('[data-testid="beast-core-modal"], [class*="MDL_outerWrapper"], [class*="MDL_innerWrapper"]'),
    ].filter(visible)
      .filter(modal => {
        const modalText = textOf(modal)
        return modalText.includes(SAFE_PRINT_OVERFLOW_CONFIRM_TEXT)
          || modalText.includes('超出的信息将无法被导出')
      })
    return candidates.length ? candidates[candidates.length - 1] : null
  }

  function closeOverflowConfirmModalIfPresent() {
    const modal = overflowConfirmModal()
    if (!modal) return false
    const cancel = [...modal.querySelectorAll('button')]
      .find(candidate => visible(candidate) && textOf(candidate) === '取消')
    const close = [...modal.querySelectorAll('button,[role="button"],span')]
      .find(candidate => visible(candidate) && ['关闭', 'Close', '×'].includes(textOf(candidate)))
    const action = cancel || close
    if (!action) return false
    action.click?.()
    return true
  }

  function closeSizeEditModalIfPresent() {
    const modal = sizeEditModal()
    if (!modal) return false
    const cancel = [...modal.querySelectorAll('button')]
      .find(candidate => visible(candidate) && textOf(candidate) === '取消')
    const close = [...modal.querySelectorAll('button,[role="button"],span')]
      .find(candidate => visible(candidate) && ['关闭', 'Close', '×'].includes(textOf(candidate)))
    const action = cancel || close
    if (!action) return false
    action.click?.()
    return true
  }

  function parseDrawerLabelSize() {
    const drawer = washLabelEditDrawer()
    const text = drawer ? textOf(drawer) : ''
    const length = Number(text.match(/长[:：]\s*(\d+(?:\.\d+)?)\s*mm/i)?.[1] || 0)
    const width = Number(text.match(/宽[:：]\s*(\d+(?:\.\d+)?)\s*mm/i)?.[1] || 0)
    return {
      length: Number.isFinite(length) && length > 0 ? length : 0,
      width: Number.isFinite(width) && width > 0 ? width : 0,
    }
  }

  function clickSizeEditAction() {
    const drawer = washLabelEditDrawer()
    if (!drawer) return false
    const actions = [...drawer.querySelectorAll('a,button,[role="button"]')]
      .filter(candidate => visible(candidate) && textOf(candidate) === '修改')
      .map(action => ({
        action,
        scopeText: textOf(action.closest?.('[class*="Form_item"], [class*="form-block_item"], [class*="size-edit_container"]') || action.parentElement),
      }))
    const match = actions.find(item => item.scopeText.includes('洗水唛尺寸') || /长[:：]\s*\d/.test(item.scopeText))
    if (!match) return false
    match.action.click?.()
    return true
  }

  function labelLengthAdjustmentBase(target = apiTarget()) {
    const configured = resolvedLabelDimensions(target).len
    const fromSummary = Number(shared.carePayloadSummary?.safePrintLengthBaseMm || 0)
      || Number(shared.carePayloadSummary?.len || 0)
    const fromPayload = Number(shared.carePayload?.len || 0)
    const fromCare = Number(shared.careLabel?.len || 0)
    return Math.max(50, Math.min(500, Number(configured || fromSummary || fromPayload || fromCare || labelLengthMm)))
  }

  function nextSafePrintLength(target = apiTarget()) {
    const base = Math.max(50, Math.min(500, Number(shared.safePrintLengthBaseMm || labelLengthAdjustmentBase(target))))
    const coarseSteps = Math.max(0, Math.floor(Number(shared.safePrintLengthCoarseSteps || 0)))
    const fineSteps = Math.max(0, Math.floor(Number(shared.safePrintLengthFineSteps || 0)))
    if (coarseSteps < SAFE_PRINT_LENGTH_COARSE_MAX_STEPS) {
      const nextCoarseSteps = coarseSteps + 1
      return {
        base,
        length: Math.min(500, base + SAFE_PRINT_LENGTH_COARSE_STEP_MM * nextCoarseSteps),
        coarseSteps: nextCoarseSteps,
        fineSteps,
        strategy: '+20mm',
      }
    }
    if (fineSteps < SAFE_PRINT_LENGTH_FINE_MAX_STEPS) {
      const nextFineSteps = fineSteps + 1
      return {
        base,
        length: Math.min(500, base
          + SAFE_PRINT_LENGTH_COARSE_STEP_MM * SAFE_PRINT_LENGTH_COARSE_MAX_STEPS
          + SAFE_PRINT_LENGTH_FINE_STEP_MM * nextFineSteps),
        coarseSteps,
        fineSteps: nextFineSteps,
        strategy: '+5mm',
      }
    }
    return {
      base,
      exhausted: true,
      coarseSteps,
      fineSteps,
      length: Math.min(500, base
        + SAFE_PRINT_LENGTH_COARSE_STEP_MM * SAFE_PRINT_LENGTH_COARSE_MAX_STEPS
        + SAFE_PRINT_LENGTH_FINE_STEP_MM * SAFE_PRINT_LENGTH_FINE_MAX_STEPS),
    }
  }

  function updateSafePrintLengthSummary(length, adjustment) {
    const summary = shared.carePayloadSummary || {}
    const careLabel = shared.careLabel || {}
    const payload = shared.carePayload || {}
    return {
      ...shared,
      safePrintLengthBaseMm: adjustment.base,
      safePrintLengthCoarseSteps: adjustment.coarseSteps,
      safePrintLengthFineSteps: adjustment.fineSteps,
      safePrintLengthAdjustedMm: length,
      safePrintLengthAdjustmentStrategy: adjustment.strategy,
      carePayload: {
        ...payload,
        len: length,
      },
      careLabel: {
        ...careLabel,
        len: length,
      },
      carePayloadSummary: {
        ...summary,
        len: length,
        safePrintLengthAdjusted: true,
        safePrintLengthBaseMm: adjustment.base,
        safePrintLengthFinalMm: length,
        safePrintLengthCoarseSteps: adjustment.coarseSteps,
        safePrintLengthFineSteps: adjustment.fineSteps,
      },
    }
  }

  function confirmSizeEditLength(lengthMm) {
    const modal = sizeEditModal()
    if (!modal) return { ok: false, reason: '尺寸修改弹窗未打开' }
    const inputs = [...modal.querySelectorAll('input')].filter(visible)
    if (inputs.length < 2) return { ok: false, reason: '尺寸修改弹窗缺少长宽输入框' }
    const lengthInput = inputs[0]
    const widthInput = inputs[1]
    const width = textOf(widthInput.value) || String(parseDrawerLabelSize().width || shared.carePayloadSummary?.width || shared.careLabel?.width || labelWidthMm)
    const lengthText = String(lengthMm)
    const widthText = String(width)
    if (!setInputValue(lengthInput, lengthText)) return { ok: false, reason: `长度输入框未能写入 ${lengthText}` }
    if (widthText && !setInputValue(widthInput, widthText)) return { ok: false, reason: `宽度输入框未能保持 ${widthText}` }
    const confirm = [...modal.querySelectorAll('button')]
      .find(candidate => visible(candidate) && textOf(candidate) === '确认')
    if (!confirm) return { ok: false, reason: '尺寸修改弹窗缺少确认按钮' }
    if (confirm.disabled) return { ok: false, reason: '尺寸修改确认按钮不可用' }
    confirm.click?.()
    return { ok: true, width: Number(widthText) || 0 }
  }

  function prepareSafePrintLengthAdjustment() {
    const modal = sizeEditModal()
    const pendingLength = Number(shared.safePrintPendingLengthMm || 0)
    if (modal && pendingLength > 0) {
      const result = confirmSizeEditLength(pendingLength)
      if (!result.ok) {
        return continueAfterFailure(result.reason, {
          temuRowStatus: '安全打印区尺寸调整失败',
          安全打印区起始长度mm: Number(shared.safePrintLengthBaseMm || 0),
          安全打印区目标长度mm: pendingLength,
        })
      }
      const adjustment = {
        base: Number(shared.safePrintLengthBaseMm || labelLengthAdjustmentBase()),
        coarseSteps: Number(shared.safePrintLengthCoarseSteps || 0),
        fineSteps: Number(shared.safePrintLengthFineSteps || 0),
        strategy: textOf(shared.safePrintLengthAdjustmentStrategy),
      }
      return nextPhase('prepare_edit_export', 1000, {
        ...updateSafePrintLengthSummary(pendingLength, adjustment),
        safePrintPendingLengthMm: 0,
        safePrintSizeModalAttempts: 0,
        temuRowStatus: `安全打印区超出，已调整长度到 ${pendingLength}mm`,
      })
    }

    if (!washLabelSafetyOverflowVisible()) return null
    const adjustment = nextSafePrintLength()
    if (adjustment.exhausted) {
      return continueAfterFailure('洗水唛内容持续超出安全打印区域，已达到自动加长上限', {
        temuRowStatus: '安全打印区超出',
        安全打印区起始长度mm: adjustment.base,
        安全打印区最终尝试长度mm: adjustment.length,
        安全打印区20mm次数: adjustment.coarseSteps,
        安全打印区5mm次数: adjustment.fineSteps,
      })
    }
    if (!clickSizeEditAction()) {
      const attempts = Number(shared.safePrintSizeModalAttempts || 0)
      if (attempts >= 8) {
        return continueAfterFailure('洗水唛内容超出安全打印区域，但未找到尺寸修改入口', {
          temuRowStatus: '安全打印区尺寸入口缺失',
          安全打印区起始长度mm: adjustment.base,
          安全打印区目标长度mm: adjustment.length,
        })
      }
      return nextPhase('prepare_edit_export', 500, {
        ...shared,
        safePrintSizeModalAttempts: attempts + 1,
        safePrintLengthBaseMm: adjustment.base,
      })
    }
    return nextPhase('prepare_edit_export', 300, {
      ...shared,
      safePrintLengthBaseMm: adjustment.base,
      safePrintLengthCoarseSteps: adjustment.coarseSteps,
      safePrintLengthFineSteps: adjustment.fineSteps,
      safePrintLengthAdjustmentStrategy: adjustment.strategy,
      safePrintPendingLengthMm: adjustment.length,
      safePrintSizeModalAttempts: 0,
      temuRowStatus: `安全打印区超出，准备调整长度到 ${adjustment.length}mm`,
    })
  }

  function exportModal() {
    const modals = [...document.querySelectorAll('[data-testid="beast-core-modal"]')]
      .filter(visible)
      .filter(modal => textOf(modal).includes('确认导出吗？'))
    return modals.length ? modals[modals.length - 1] : null
  }

  function closeExportModalIfPresent(nextPhaseName, nextShared = shared, data = [], sleepMs = 300) {
    const modals = [...document.querySelectorAll('[data-testid="beast-core-modal"]')]
      .filter(visible)
      .filter(modal => textOf(modal).includes('确认导出吗？'))
    if (!modals.length) return null
    const attempts = Number(nextShared.exportModalCloseAttempts || 0)
    if (attempts >= 3) return fail('导出弹窗关闭失败，已停止以避免复用旧预览')
    let clicked = 0
    for (const modal of modals.reverse()) {
      const action = [...modal.querySelectorAll('button')]
        .find(candidate => visible(candidate) && ['取消', '返回修改'].includes(textOf(candidate)))
        || [...modal.querySelectorAll('button,[role="button"],span')]
          .find(candidate => visible(candidate) && ['关闭', 'Close', '×'].includes(textOf(candidate)))
      if (!action) continue
      action.click?.()
      clicked += 1
    }
    if (clicked) {
      return nextPhase(nextPhaseName, sleepMs, {
        ...nextShared,
        exportModalCloseAttempts: attempts + 1,
      }, data)
    }
    if (attempts < 3) {
      return nextPhase(nextPhaseName, sleepMs, {
        ...nextShared,
        exportModalCloseAttempts: attempts + 1,
      }, data)
    }
    return null
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
    const englishCompositions = uniqueNonblank(candidateRows.map(row => row.eComponent))
    const remarks = uniqueNonblank(candidateRows.map(row => row.skcRemark))
    const selected = candidateRows[0]
    return {
      rows,
      brandRows,
      completedRows,
      candidateRows,
      selected,
      compositions,
      composition: compositions[0] || '',
      englishComposition: englishCompositions[0] || '',
      careInstructionText: remarks.join('；'),
      careInstructionSource: remarks.length ? 'scm_skc_remark' : 'missing_structured_wash_instruction',
    }
  }

  function scmLookupExpression(target) {
    const style = inferStyleFromTarget(target)
    const styleJson = JSON.stringify(style)
    const washPageUrlJson = JSON.stringify(SCM_WASH_APPROVAL_URL)
    return `
(async () => {
  const style = ${styleJson};
  const washPageUrl = ${washPageUrlJson};
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
  if (!style) return { ok: false, reason: 'missing_style', rows: [] };
  const href = String(location.href || '');
  const titleText = String(document.title || '');
  const bodyText = textOf(document.body).slice(0, 1000);
  const loginLike = /login|sso|oauth|cas|iam|auth|selfcare|passport/i.test(href)
    || /登录|统一身份认证|身份验证|账号密码|扫码登录|验证码/.test(titleText + ' ' + bodyText);
  if (loginLike) {
    return {
      ok: false,
      retry: true,
      loginRequired: true,
      reason: 'scm_login_required',
      title: titleText,
      currentUrl: href,
    };
  }
  if (!/\\/scm-quality-mgm\\/index\\/scm-qc-wash-appr-index(?:$|[?#])/.test(href)) {
    location.href = washPageUrl;
    return { ok: false, retry: true, reason: 'navigating_to_scm_wash_appr_index', currentUrl: href };
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
    const workflow = buildWorkbookWorkflow() || buildDirectInputWorkflow()
    if (!workflow) {
      return complete([
        resultRow('input_required', '制作链路必须填写款号/SKC、企业码，或上传「洗唛需求」Excel 后按 SKC 选择代表 SKU', {
          temuRowStatus: '缺少输入',
        }, {}),
      ], {
        ...shared,
        workbookError: 'style_codes, enterprise_codes or input_file required',
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
    const nextShared = withAiWashProgress({
      ...shared,
      workflowMode: workflow.mode || 'excel_representative_skc_create_and_download',
      workflowSummary: workflow.summary,
      excelTargets: targets,
      currentExcelTargetIndex: 0,
      excelTarget: targets[0] || null,
      apiMadeWashLabelCount: 0,
      apiPendingWashLabelCount: 0,
      scanTotalRecords: workflow.summary?.selectedRows || workflow.summary?.selectedTargets || workflow.summary?.selectedEnterpriseCodes || 0,
      total_rows: targets.length,
      current_exec_no: targets.length ? 1 : 0,
      current_row_no: 0,
      current_buyer_id: targets[0]?.skuNo || '',
      current_store: targetStore,
    }, {
      style_total: workflow.summary?.selectedStyles || targets.filter(isStyleCodeProgressTarget).length,
      style_completed: 0,
      sku_total: countSkuProgressTargets(targets),
      sku_completed: 0,
      wash_label_stage: targets[0]?.inputMode === 'style_code' ? 'expand_style' : 'sku',
    })
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
    if (styleQueryTarget()) {
      const style = compact(target.style || target.skc)
      try {
        const { total, records } = await queryApiRecordsByStyle(style)
        const allDerivedTargets = []
        const skippedRows = []
        for (const record of records) {
          const attached = attachExcelTarget(record, {
            ...target,
            inputMode: 'style_sku',
            style,
            skc: record.skcExtCode,
            skuCode: record.skcExtCode,
            skuNo: record.skuExtCode,
            enterpriseCode: record.skuExtCode,
            sizeCount: records.length,
            status: 'ready',
          })
          if (isCareLabelRequired(record)) {
            allDerivedTargets.push(attached)
          } else {
            skippedRows.push(resultRow('print_only_skipped', 'TEMU 该 SKU 仅显示打印/合规标签，未出现洗水唛制作入口；按 SOP 跳过并记录。', {
              temuRowStatus: '仅打印无制作',
              source: 'temu_pagequery_skc',
              TEMU匹配记录数: records.length,
              TEMU标签类型: record.labelType,
              TEMU洗水唛状态: record.cosmeticLabelStatus,
              TEMU需要洗水唛: record.needCosmeticLabel,
            }, attached, { ...shared, apiTarget: attached, apiValidated: true }))
          }
        }
        const skuLimit = remainingSkuLimitBeforeTarget(excelTargets(), Math.max(0, Number(shared.currentExcelTargetIndex || 0)))
        const derivedTargets = Number.isFinite(skuLimit) ? allDerivedTargets.slice(0, skuLimit) : allDerivedTargets
        const replacedBaseShared = replaceCurrentExcelTarget(derivedTargets, {
          ...shared,
          apiValidated: true,
          styleQueryTotal: total,
          styleQueryMatchedRecords: records.length,
          styleQueryDerivedTargets: allDerivedTargets.length,
          styleQuerySelectedTargets: derivedTargets.length,
          styleQuerySkuLimit: Number.isFinite(skuLimit) ? skuLimit : 0,
          styleQuerySkippedRows: skippedRows.length,
          temuRowStatus: derivedTargets.length
            ? '款号已展开到SKU'
            : allDerivedTargets.length
              ? '款号SKU已被限量参数截断'
              : '款号无可制作SKU',
        })
        const replacedShared = withAiWashProgress(replacedBaseShared, {
          style_total: Number(shared.style_total || 0)
            || Number(shared.workflowSummary?.selectedStyles || 0)
            || Number(shared.style_completed || 0) + 1,
          style_completed: Number(shared.style_completed || 0) + 1,
          sku_total: countSkuProgressTargets(replacedBaseShared.excelTargets),
          sku_skipped: Number(shared.sku_skipped || 0) + skippedRows.length,
          wash_label_stage: derivedTargets.length ? 'sku' : 'expand_style',
        })
        if (!records.length) {
          const row = resultRow('style_not_found', `TEMU 未查询到款号/SKC：${style}`, {
            temuRowStatus: 'TEMU未找到款号',
            source: 'temu_pagequery_skc',
          }, target, { ...shared, apiTarget: target, apiValidated: true })
          if (!replacedShared.excelTargets.length) return complete([row], replacedShared)
          return nextPhase('api_lookup_excel_target', 100, resetTargetState(replacedShared), [row])
        }
        if (!derivedTargets.length) {
          if (!replacedShared.excelTargets.length) return complete(skippedRows, replacedShared)
          return nextPhase('api_lookup_excel_target', 100, resetTargetState(replacedShared), skippedRows)
        }
        return nextPhase('api_lookup_excel_target', 100, resetTargetState(replacedShared), skippedRows)
      } catch (error) {
        const attempts = Number(shared.styleLookupAttempts || 0)
        if (attempts < 2) {
          return nextPhase('api_lookup_excel_target', 600, {
            ...shared,
            styleLookupAttempts: attempts + 1,
            styleLookupLastError: safeApiError(error),
          })
        }
        return nextPhase('advance_excel_target', 100, {
          ...shared,
          styleLookupAttempts: 0,
          styleLookupLastError: safeApiError(error),
          temuRowStatus: 'TEMU款号查询失败',
        }, [
          resultRow('style_lookup_failed', 'TEMU 页面 API 查询款号/SKC 失败', {
            temuRowStatus: 'TEMU款号查询失败',
            API错误: safeApiError(error),
          }, target),
        ])
      }
    }
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
        open_url_if_missing: SCM_WASH_APPROVAL_URL,
        open_wait_ms: 2000,
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
      const loginRequired = payload?.loginRequired === true
        || /scm_login_required|login|sso|oauth|cas|iam|auth|selfcare|passport|登录|统一身份认证|身份验证/i.test([
          reason,
          payload?.title,
          payload?.currentUrl,
          wrapper?.target?.url,
        ].map(textOf).join(' '))
      if (loginRequired && attempts < SCM_LOGIN_MAX_ATTEMPTS) {
        const nextAttempt = attempts + 1
        return nextPhase('scm_lookup_target', SCM_LOGIN_RETRY_SLEEP_MS, {
          ...shared,
          scmLookupAttempts: nextAttempt,
          scmLookupLastError: reason,
          scmLookupLoginRequired: true,
          scmLookupStatus: `等待 SCM 登录 ${Math.min(nextAttempt * SCM_LOGIN_RETRY_SLEEP_MS, SCM_LOGIN_WAIT_MS) / 1000}/${SCM_LOGIN_WAIT_MS / 1000}s`,
        })
      }
      if ((payload?.retry || /未找到匹配 target|not ready|navigating|dataset/i.test(reason)) && attempts < 12) {
        return nextPhase('scm_lookup_target', 900, {
          ...shared,
          scmLookupAttempts: attempts + 1,
          scmLookupLastError: reason,
          scmLookupStatus: 'SCM查询等待页面就绪',
        })
      }
      return nextPhase('api_care_query', 100, {
        ...shared,
        apiTarget: {
          ...target,
          scmLookupFailedReason: reason,
        },
        scmLookupAttempts: 0,
        scmLookupLastError: loginRequired ? `SCM登录等待超时：${reason}` : reason,
        scmLookupStatus: loginRequired ? 'SCM登录等待超时，使用固定洗护符号' : 'SCM查询失败，使用固定洗护符号',
      })
    }

    const evidence = selectScmEvidence(payload.rows, target)
    if (evidence.error) {
      return nextPhase('api_care_query', 100, {
        ...shared,
        apiTarget: {
          ...target,
          scmLookupEvidenceError: evidence.error,
        },
        scmRows: evidence.rows || [],
        scmLookupLastError: evidence.error,
        scmLookupStatus: 'SCM证据不可用，使用固定洗护符号',
        scmMatchedRows: Array.isArray(evidence.rows) ? evidence.rows.length : 0,
        scmCompletedRows: Array.isArray(evidence.completedRows) ? evidence.completedRows.length : 0,
        scmCandidateRows: Array.isArray(evidence.candidateRows) ? evidence.candidateRows.length : 0,
        scmCompositionCandidates: Array.isArray(evidence.compositions) ? evidence.compositions : [],
      })
    }
    const apiRecord = attachScmEvidence(target, evidence)
    if (shouldRecognizeScmAttachment(apiRecord, evidence)) {
      const cachedAction = reuseCachedScmWashInstructionAction(apiRecord, evidence)
      if (cachedAction) return cachedAction
      return scmAttachmentDownloadAction(apiRecord, evidence)
    }
    return nextPhase('api_care_query', 150, {
      ...shared,
      apiTarget: apiRecord,
      scmLookupAttempts: 0,
      scmLookupStatus: 'SCM查询成功',
      scmRows: evidence.rows,
      scmSelectedRow: evidence.selected,
    })
  }

  if (phase === 'verify_scm_attachment_download') {
    const target = apiTarget()
    const item = bestDownloadPath(shared.scmAttachmentDownload || {})
    if (!item) {
      const items = Array.isArray(shared.scmAttachmentDownload?.items) ? shared.scmAttachmentDownload.items : []
      const reason = textOf(items.find(candidate => candidate?.error)?.error || shared.scmAttachmentDownload?.error || 'SCM洗唛附件下载失败')
      const nextShared = withScmWashInstructionCache({
        ...shared,
        apiTarget: {
          ...target,
          scmAttachmentRecognitionStatus: 'download_failed',
          scmAttachmentRecognitionError: reason,
        },
        scmAttachmentRecognitionStatus: 'download_failed',
        scmAttachmentRecognitionError: reason,
        scmLookupStatus: 'SCM洗唛附件下载失败，使用固定洗护符号',
      }, target, {
        ok: false,
        status: 'download_failed',
        error: reason,
        source: 'scm_wash_attachment_download',
        washFile: target.scmWashFile,
      })
      return nextPhase('api_care_query', 100, nextShared)
    }
    return recognizeScmAttachmentAction(target, item)
  }

  if (phase === 'verify_scm_attachment_recognition') {
    const target = apiTarget()
    const recognition = shared.scmAttachmentRecognition || {}
    const instructionText = normalizedCareInstructionText(
      recognition.instructionText
      || recognition.careInstructionText
      || recognition.washCareInstruction
      || '',
    )
    const recognizedCareSymbols = plainCareSymbols(recognition.careSymbols || recognition.payload?.careSymbols)
    if (recognition?.ok && (instructionText || recognizedCareSymbols)) {
      const source = textOf(recognition.source || 'scm_wash_attachment_ai_ocr')
      const nextShared = withScmWashInstructionCache({
        ...shared,
        apiTarget: {
          ...target,
          scmCareInstructionText: instructionText,
          scmCareInstructionSource: source,
          scmCareSymbols: recognizedCareSymbols,
          scmAttachmentRecognitionStatus: 'recognized',
        },
        scmAttachmentRecognitionStatus: 'recognized',
        scmLookupStatus: 'SCM查询成功，洗唛附件识别成功',
      }, target, {
        ok: true,
        instructionText,
        careSymbols: recognizedCareSymbols,
        source,
        status: 'recognized',
        washFile: target.scmWashFile,
        attachmentPath: shared.scmAttachmentPath,
      })
      return nextPhase('api_care_query', 150, nextShared)
    }
    const reason = textOf(recognition.error || 'SCM洗唛附件未识别到完整洗护说明')
    const nextShared = withScmWashInstructionCache({
      ...shared,
      apiTarget: {
        ...target,
        scmAttachmentRecognitionStatus: 'recognition_failed',
        scmAttachmentRecognitionError: reason,
      },
      scmAttachmentRecognitionStatus: 'recognition_failed',
      scmAttachmentRecognitionError: reason,
      scmLookupStatus: 'SCM洗唛附件识别失败，使用固定洗护符号',
    }, target, {
      ok: false,
      status: 'recognition_failed',
      error: reason,
      source: textOf(recognition.source || 'scm_wash_attachment_ai_ocr'),
      washFile: target.scmWashFile,
      attachmentPath: shared.scmAttachmentPath,
    })
    return nextPhase('api_care_query', 100, nextShared)
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
      if (shouldVerifySavedTemplateFieldsAfterSave()) {
        const verification = verifySavedTemplateFields(care, shared.carePayloadSummary)
        if (!verification.ok) {
          const attempts = Number(shared.templateFieldCorrectionAttempts || 0)
          const mismatchShared = {
            ...nextShared,
            savedTemplateFieldsVerified: false,
            savedTemplateFieldMismatchSummary: verification.summary,
            savedTemplateFieldReadback: verification,
            temuRowStatus: '保存字段回读不一致，准备API修正',
          }
          if (attempts < TEMPLATE_FIELD_CORRECTION_MAX_ATTEMPTS) {
            return nextPhase('prepare_care_payload', 200, {
              ...mismatchShared,
              saveResult: null,
              resaveExistingWashLabel: isDownloadable(apiRecord),
              templateFieldCorrectionAttempts: attempts + 1,
              temuRowStatus: `保存字段回读不一致，通过TEMU保存接口修正 ${attempts + 1}/${TEMPLATE_FIELD_CORRECTION_MAX_ATTEMPTS}`,
            })
          }
          return finishTargetFailure('saved_template_fields_mismatch', `TEMU 保存接口修正后字段回读仍不一致：${verification.summary}`, {
            temuRowStatus: '保存字段API修正失败',
            保存字段差异: verification.summary,
            TEMU回读字段: JSON.stringify(verification.actual),
            目标字段: JSON.stringify(verification.expected),
          }, mismatchShared)
        }
        nextShared.savedTemplateFieldsVerified = true
        nextShared.savedTemplateFieldMismatchSummary = ''
        nextShared.savedTemplateFieldReadback = verification
        nextShared.temuRowStatus = '保存字段已校验'
      }
      const nextPhaseAfterExistingPdfCheck = isDownloadable(apiRecord)
        ? (shouldResaveBeforeDownload(apiRecord) && !shared.saveResult?.success ? 'prepare_care_payload' : 'prepare_search')
        : (isPendingCreatable(apiRecord) ? 'prepare_care_payload' : '')
      const existingPdfCheck = existingOfficialPdfCheckAction(apiRecord, nextShared, nextPhaseAfterExistingPdfCheck)
      if (existingPdfCheck) return existingPdfCheck
      if (isDownloadable(apiRecord)) {
        if (!downloadAfterSave) {
          return nextPhase(advancePhaseName(), 100, nextShared, [
            resultRow('already_made_no_download', 'TEMU 已显示“已制作”，当前参数关闭下载，未重复编辑或保存。', {
              temuRowStatus: '已制作',
              source: 'temu_readback',
            }, apiRecord, nextShared),
          ])
        }
        if (shouldResaveBeforeDownload(apiRecord) && !shared.saveResult?.success) {
          return nextPhase('prepare_care_payload', 100, {
            ...nextShared,
            resaveExistingWashLabel: true,
            temuRowStatus: '已制作，按模板重新保存后导出',
          })
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

  if (phase === 'verify_existing_official_pdf') {
    const target = apiTarget()
    const item = bestCheckedFile(shared.existingOfficialPdfCheck || {})
    if (item?.success && item.path) {
      const nextShared = withAiWashProgress({
        ...shared,
        officialDownloadPath: item.path,
        officialDownloadReceived: true,
        temuRowStatus: '导出目录已有官方PDF，断点续跑跳过',
      }, {
        sku_success: Number(shared.sku_success || 0) + 1,
        wash_label_stage: 'sku',
      })
      return nextPhase(advancePhaseName(), 100, nextShared, [
        resultRow('resume_existing_pdf_skipped', '导出目录已存在有效官方 PDF，跳过重复制作/下载。', {
          path: item.path,
          bytes: Number(item.bytes || 0),
          signatureValidated: item.signatureValidated !== false,
          source: 'local_resume_pdf',
          是否重试后成功: Number(target.autoRetryAttempt || excelTarget().autoRetryAttempt || 0) > 0,
        }, target, nextShared),
      ])
    }
    return continueAfterExistingPdfMiss({
      ...shared,
      existingOfficialPdfMissReason: String(item?.error || '导出目录未发现有效官方 PDF'),
    })
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
      savedTemplateFieldsVerified: false,
      savedTemplateFieldMismatchSummary: '',
      savedTemplateFieldReadback: null,
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
    if (!isPendingCreatable(target) && !(shared.resaveExistingWashLabel && isDownloadable(target))) {
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
      const saveEndpoint = shared.resaveExistingWashLabel && isDownloadable(target)
        ? '/visage-agent-seller/labelcode/care/edit'
        : '/visage-agent-seller/labelcode/care/create'
      const response = await pagePost(saveEndpoint, payload)
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
        saveEndpoint,
        saveAttempts: 0,
        postSaveLookupAttempts: 0,
        temuRowStatus: saveEndpoint.endsWith('/edit') ? '已调用编辑保存' : '已调用保存',
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
      return finishTargetFailure('save_failed', 'TEMU 洗水唛保存接口调用失败', {
        temuRowStatus: '保存失败',
        API错误: safeApiError(error),
      }, {
        ...shared,
        saveLastError: safeApiError(error),
        temuRowStatus: '保存失败',
      })
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
      return finishTargetFailure('save_readback_failed', '已调用保存接口，但 TEMU 未在等待时间内回读为“已制作”。', {
        temuRowStatus: '保存后未回读已制作',
        TEMU匹配记录数: records.length,
        TEMU可导出记录数: downloadable.length,
      }, {
        ...shared,
        temuRowStatus: '保存后未回读已制作',
      })
    } catch (error) {
      const attempts = Number(shared.postSaveLookupAttempts || 0)
      if (attempts < 2) {
        return nextPhase('post_save_lookup', 1200, {
          ...shared,
          postSaveLookupAttempts: attempts + 1,
          postSaveLookupLastError: safeApiError(error),
        })
      }
      return finishTargetFailure('save_readback_query_failed', '保存后 TEMU 页面 API 回读失败', {
        temuRowStatus: '保存后查询失败',
        API错误: safeApiError(error),
      }, {
        ...shared,
        postSaveLookupLastError: safeApiError(error),
        temuRowStatus: '保存后查询失败',
      })
    }
  }

  if (phase === 'prepare_search') {
    if (closeOverflowConfirmModalIfPresent() || closeSizeEditModalIfPresent()) {
      return nextPhase('prepare_search', 300, {
        ...shared,
        staleEditModalCloseAttempts: Number(shared.staleEditModalCloseAttempts || 0) + 1,
      })
    }
    const closeModal = closeExportModalIfPresent('prepare_search')
    if (closeModal) return closeModal
    const closeDrawer = closeWashLabelEditDrawerIfPresent('prepare_search')
    if (closeDrawer) return closeDrawer

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
      const action = editWashLabelAction(targetRow)
      if (!action) {
        return continueAfterFailure('已制作洗水唛行缺少编辑按钮', {
          temuRowStatus: '编辑按钮缺失',
        })
      }
      action.click?.()
      return nextPhase('prepare_edit_export', 700, {
        ...shared,
        temuRowStatus: '已制作',
        matchedRowText: textOf(targetRow),
        exportSource: 'wash_label_edit_complete_export',
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

  if (phase === 'prepare_edit_export') {
    if (closeOverflowConfirmModalIfPresent()) {
      return nextPhase('prepare_edit_export', 300, {
        ...shared,
        overflowConfirmCloseAttempts: Number(shared.overflowConfirmCloseAttempts || 0) + 1,
        temuRowStatus: '已取消超出安全打印区确认弹窗，准备调整长度',
      })
    }
    const safePrintAdjustment = prepareSafePrintLengthAdjustment()
    if (safePrintAdjustment) return safePrintAdjustment
    const button = completeAndExportButton()
    if (!button) {
      const attempts = Number(shared.editDrawerAttempts || 0)
      if (attempts >= 12) {
        return continueAfterFailure('点击编辑后未出现“修改洗水唛”窗口或“完成并导出”按钮', {
          temuRowStatus: '编辑窗口缺失',
        })
      }
      return nextPhase('prepare_edit_export', 500, {
        ...shared,
        editDrawerAttempts: attempts + 1,
      })
    }
    if (button.disabled) {
      const attempts = Number(shared.editCompleteExportAttempts || 0)
      if (attempts >= 40) {
        return continueAfterFailure('洗水唛编辑窗口“完成并导出”按钮持续未启用，未执行导出', {
          temuRowStatus: '完成并导出未启用',
        })
      }
      return nextPhase('prepare_edit_export', 500, {
        ...shared,
        editCompleteExportAttempts: attempts + 1,
      })
    }
    button.click?.()
    return nextPhase('prepare_export', 800, {
      ...shared,
      editDrawerAttempts: 0,
      editCompleteExportAttempts: 0,
      exportSource: 'wash_label_edit_complete_export',
      temuRowStatus: '已从编辑窗口触发完成并导出',
    })
  }

  if (phase === 'prepare_export') {
    const modal = exportModal()
    if (!modal) {
      const attempts = Number(shared.exportModalAttempts || 0)
      if (attempts >= EXPORT_MODAL_WAIT_ATTEMPTS) {
        return continueAfterFailure('点击导出后未出现“确认导出吗？”弹窗', {
          temuRowStatus: '导出弹窗缺失',
        })
      }
      const shouldRefire = attempts > 0 && attempts % EXPORT_MODAL_REFIRE_EVERY_ATTEMPTS === 0
      const button = shouldRefire ? completeAndExportButton() : null
      if (button && !button.disabled) button.click?.()
      return nextPhase('prepare_export', 500, {
        ...shared,
        exportModalAttempts: attempts + 1,
        temuRowStatus: button && !button.disabled
          ? '已重试从编辑窗口触发完成并导出'
          : shared.temuRowStatus,
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
                target_dir: outputDir,
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
          target_dir: outputDir,
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
    const closeModal = closeExportModalIfPresent('verify_download')
    if (closeModal) return closeModal
    const closeDrawer = closeWashLabelEditDrawerIfPresent('verify_download')
    if (closeDrawer) return closeDrawer

    const downloadResult = shared.downloadResult || {}
    const item = bestDownloadItem(downloadResult)
    if (item?.success && item.path) {
      const nextShared = withAiWashProgress({
        ...shared,
        officialDownloadPath: item.path,
        officialDownloadReceived: true,
      }, {
        sku_success: Number(shared.sku_success || 0) + 1,
        wash_label_stage: 'sku',
      })
      return nextPhase(advancePhaseName(), 100, nextShared, [
        resultRow('official_download_received', '', {
          path: item.path,
          bytes: Number(item.bytes || 0),
          signatureValidated: item.signatureValidated !== false,
          匹配方式: String(item.matchedBy || ''),
          浏览器下载控制: String(item.browserDownloadControl?.method || ''),
          导出触发来源: String(shared.exportSource || ''),
        }, null, nextShared),
      ])
    }
    return finishTargetFailure('official_download_failed', String(item?.error || '浏览器未返回官方 PDF 文件'), {
      path: String(item?.path || ''),
      bytes: Number(item?.bytes || 0),
      signatureValidated: !!item?.signatureValidated,
      下载返回: JSON.stringify(downloadResult).slice(0, 1200),
    }, {
      ...shared,
      officialDownloadReceived: false,
      officialDownloadError: String(item?.error || '浏览器未返回官方 PDF 文件'),
    })
  }

  if (phase === 'advance_excel_target') {
    const targets = excelTargets()
    const currentIndex = Math.max(0, Number(shared.currentExcelTargetIndex || 0))
    const currentTarget = targets[currentIndex] || shared.excelTarget || {}
    const nextIndex = Number(shared.currentExcelTargetIndex || 0) + 1
    const nextStyleCompleted = Number(shared.style_completed || 0) + (isStyleCodeProgressTarget(currentTarget) ? 1 : 0)
    const nextSkuCompleted = Number(shared.sku_completed || 0) + (isSkuProgressTarget(currentTarget) ? 1 : 0)
    if (nextIndex >= targets.length) {
      return complete([], withAiWashProgress({
        ...shared,
        batchCompleted: true,
        completedTargetCount: targets.length,
      }, {
        style_completed: nextStyleCompleted,
        sku_completed: nextSkuCompleted,
        wash_label_stage: 'finalize',
      }))
    }
    return nextPhase('api_lookup_excel_target', 150, withAiWashProgress(resetTargetState({
      ...shared,
      currentExcelTargetIndex: nextIndex,
      excelTarget: targets[nextIndex],
      current_exec_no: nextIndex + 1,
      current_buyer_id: targets[nextIndex]?.skuNo || '',
      current_store: targetStore,
      apiTarget: null,
      excelLookupAttempts: 0,
      excelLookupLastError: '',
    }), {
      style_completed: nextStyleCompleted,
      sku_completed: nextSkuCompleted,
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
