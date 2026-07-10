export const PROMPT_SCENARIOS = ['裂变图', '创意拍摄']
export const DEFAULT_PROMPT_LIBRARY_NAME = 'AI 测图提示词库 本地版'
export const PROMPT_IMPORT_HEADER_ROWS = [4, 3, 5]

const HEADER_ALIASES = {
  field_name: ['字段名'],
  source_field_id: ['字段 ID', '字段ID'],
  field_order: ['字段顺序'],
  visible: ['在当前视图'],
  size_label: ['尺寸'],
  output_format: ['格式'],
  reference_fields: ['引用字段'],
  prompt_text: ['描述内容'],
  word_count: ['字数'],
  field_type: ['字段类型'],
  female_priority: ['女性优先度'],
  male_neutral_priority: ['男性/中性优先度', '男性优先度', '中性优先度'],
  enabled: ['启用', '是否启用'],
}

export function parsePromptWorkbookSheets(workbook = {}) {
  const sheets = workbook?.sheets && typeof workbook.sheets === 'object'
    ? workbook.sheets
    : { [workbook?.sheet_name || 'Prompt']: workbook }

  return Object.entries(sheets).flatMap(([sheetName, table]) => {
    const rows = Array.isArray(table?.rows) ? table.rows : []
    return rows
      .map(row => promptTemplateFromWorkbookRow(sheetName, row))
      .filter(row => row.field_name && row.prompt_text)
  })
}

export function parsePromptWorkbookImportCandidates(candidates = []) {
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const templates = parsePromptWorkbookSheets(candidate?.workbook || {})
    if (templates.length) {
      return {
        header_row: Number(candidate?.header_row || candidate?.headerRow || 0) || null,
        workbook: candidate?.workbook || {},
        templates,
      }
    }
  }
  return { header_row: null, workbook: null, templates: [] }
}

export function normalizePromptLibrary(library = {}) {
  const now = new Date().toISOString()
  const sourceType = normalizeLibrarySourceType(library.source_type || library.library_type)
  const cloudLibraryId = library.cloud_library_id ?? (sourceType === 'cloud' ? library.id : null)
  return {
    library_uid: String(library.library_uid || (sourceType === 'cloud' && library.id ? `cloud:${library.id}` : library.id || '')),
    source_type: sourceType,
    library_type: sourceType,
    name: String(library.name || DEFAULT_PROMPT_LIBRARY_NAME).trim() || DEFAULT_PROMPT_LIBRARY_NAME,
    scenario: normalizeScenario(library.scenario),
    status: String(library.status || 'draft'),
    cloud_library_id: cloudLibraryId,
    cloud_synced_at: String(library.cloud_synced_at || ''),
    import_source_path: String(library.import_source_path || ''),
    created_at: String(library.created_at || now),
    updated_at: String(library.updated_at || now),
    templates: (Array.isArray(library.templates) ? library.templates : []).map(normalizePromptTemplate),
  }
}

export function normalizePromptTemplate(template = {}) {
  const femalePriority = numberOrNull(template.female_priority)
  const maleNeutralPriority = numberOrNull(template.male_neutral_priority)
  const explicitPriority = numberOrNull(template.priority)
  const priority = explicitPriority ?? femalePriority ?? maleNeutralPriority ?? 100

  return {
    local_uid: String(template.local_uid || ''),
    id: template.id,
    library_id: template.library_id,
    group_name: String(template.group_name || '').trim(),
    field_name: String(template.field_name || '').trim(),
    source_field_id: String(template.source_field_id || '').trim(),
    field_order: numberOrNull(template.field_order),
    visible: template.visible === false || template.visible === 0 || isNo(template.visible) ? false : true,
    size_label: String(template.size_label || '2K').trim() || '2K',
    output_format: String(template.output_format || 'jpeg').trim() || 'jpeg',
    quality: String(template.quality || 'auto').trim() || 'auto',
    reference_fields: splitReferenceFields(template.reference_fields),
    prompt_text: String(template.prompt_text || '').trim(),
    word_count: numberOrNull(template.word_count),
    field_type: String(template.field_type || '').trim(),
    female_priority: femalePriority,
    male_neutral_priority: maleNeutralPriority,
    category_rules: arrayOfStrings(template.category_rules),
    gender_rules: arrayOfStrings(template.gender_rules),
    priority,
    enabled: template.enabled === false || template.enabled === 0 || isNo(template.enabled) ? false : true,
    updated_at: String(template.updated_at || ''),
  }
}

export function defaultPromptTemplate(groupName = '裂变图') {
  return normalizePromptTemplate({
    group_name: groupName,
    field_name: '正面标准站姿',
    prompt_text: '保留商品主体、颜色和版型，生成适合 AI 测图的电商主图。',
    field_order: 0,
    female_priority: 10,
  })
}

export function buildPromptLibraryPickerLibraries({ localLibraries = [], cloudLibraries = [] } = {}) {
  const localItems = (Array.isArray(localLibraries) ? localLibraries : [])
    .map((library, index) => buildPromptLibraryPickerLibrary(library, 'local', index))
  const cloudItems = (Array.isArray(cloudLibraries) ? cloudLibraries : [])
    .map((library, index) => buildPromptLibraryPickerLibrary(library, 'cloud', index))
  return [...localItems, ...cloudItems]
}

export function buildCloudPromptLibraryPayload(library = {}) {
  const normalized = normalizePromptLibrary(library)
  return {
    name: normalized.name,
    scenario: normalized.scenario,
    templates: normalized.templates.map(template => ({
      group_name: template.group_name,
      field_name: template.field_name,
      source_field_id: template.source_field_id,
      field_order: template.field_order,
      visible: template.visible,
      prompt_text: template.prompt_text,
      size_label: template.size_label,
      output_format: template.output_format,
      quality: template.quality,
      reference_fields: template.reference_fields,
      word_count: template.word_count,
      field_type: template.field_type,
      female_priority: template.female_priority,
      male_neutral_priority: template.male_neutral_priority,
      category_rules: template.category_rules,
      gender_rules: template.gender_rules,
      priority: template.priority,
      enabled: template.enabled,
    })),
  }
}

export function createLocalPromptUid(prefix = 'prompt') {
  const random = Math.random().toString(36).slice(2, 9)
  return `${prefix}_${Date.now().toString(36)}_${random}`
}

function promptTemplateFromWorkbookRow(sheetName, row = {}) {
  return normalizePromptTemplate({
    group_name: String(sheetName || '').trim() || 'Prompt',
    field_name: workbookValue(row, 'field_name'),
    source_field_id: workbookValue(row, 'source_field_id'),
    field_order: workbookValue(row, 'field_order'),
    visible: workbookValue(row, 'visible'),
    size_label: workbookValue(row, 'size_label'),
    output_format: workbookValue(row, 'output_format'),
    reference_fields: workbookValue(row, 'reference_fields'),
    prompt_text: workbookValue(row, 'prompt_text'),
    word_count: workbookValue(row, 'word_count'),
    field_type: workbookValue(row, 'field_type'),
    female_priority: workbookValue(row, 'female_priority'),
    male_neutral_priority: workbookValue(row, 'male_neutral_priority'),
    enabled: workbookValue(row, 'enabled') || true,
  })
}

function workbookValue(row, key) {
  for (const name of HEADER_ALIASES[key] || []) {
    const value = row?.[name]
    const text = String(value == null ? '' : value).trim()
    if (text) return text
  }
  return ''
}

function normalizeScenario(value) {
  const scenario = String(value || '').trim()
  return PROMPT_SCENARIOS.includes(scenario) ? scenario : PROMPT_SCENARIOS[0]
}

function buildPromptLibraryPickerLibrary(library = {}, sourceType = 'local', index = 0) {
  const normalized = normalizePromptLibrary({ ...library, source_type: sourceType })
  const cloudId = normalized.cloud_library_id ?? library.cloud_library_id ?? library.id ?? stripCloudLibraryPrefix(normalized.library_uid)
  const localId = normalized.library_uid || library.id
  const identity = String((sourceType === 'cloud' ? cloudId : localId) || `${sourceType}-${index + 1}`).trim()
  const pickerKey = `${sourceType}:${identity}`
  return {
    ...normalized,
    id: pickerKey,
    picker_key: pickerKey,
    source_label: sourceType === 'cloud' ? '线上' : '本地',
    templates: normalized.templates
      .map((template, templateIndex) => normalizePromptPickerTemplate(template, pickerKey, sourceType, templateIndex))
      .filter(Boolean),
  }
}

function normalizePromptPickerTemplate(template = {}, libraryPickerKey = '', sourceType = 'local', index = 0) {
  const normalized = normalizePromptTemplate(template)
  if (!normalized.prompt_text || normalized.enabled === false) return null
  const templateIdentity = String(template.template_id || normalized.id || normalized.local_uid || index + 1).trim()
  return {
    ...normalized,
    template_id: `${libraryPickerKey}:${templateIdentity}`,
    source_type: sourceType,
    library_picker_key: libraryPickerKey,
  }
}

function stripCloudLibraryPrefix(value) {
  return String(value || '').replace(/^cloud:/, '')
}

function normalizeLibrarySourceType(value) {
  return String(value || '').trim() === 'cloud' ? 'cloud' : 'local'
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(String(value).trim())
  return Number.isFinite(number) ? number : null
}

function isNo(value) {
  const text = String(value ?? '').trim().toLowerCase()
  return ['否', 'false', '0', 'no', '停用', '禁用'].includes(text)
}

function splitReferenceFields(value) {
  if (Array.isArray(value)) return arrayOfStrings(value)
  return String(value || '')
    .split(/[,\n，、；;]/)
    .map(item => item.trim())
    .filter(Boolean)
}

function arrayOfStrings(value) {
  return Array.isArray(value)
    ? value.map(item => String(item || '').trim()).filter(Boolean)
    : []
}
