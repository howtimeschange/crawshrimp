import fs from 'node:fs'
import * as XLSX from 'xlsx'

const workbookPath = process.env.PROMPT_WORKBOOK_PATH || '/Users/xingyicheng/Downloads/AI 测图提示词库.xlsx'
const baseUrl = process.env.APP_URL || 'http://127.0.0.1:8787'
const sessionCookie = process.env.CS_SESSION ? `cs_session=${process.env.CS_SESSION}` : process.env.COOKIE || ''

if (!sessionCookie) {
  console.error('Set CS_SESSION or COOKIE for an administrator session before seeding.')
  process.exit(1)
}

const workbook = XLSX.read(fs.readFileSync(workbookPath), { type: 'buffer' })
const templates = workbook.SheetNames.flatMap((sheetName) => {
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, blankrows: false, defval: '' })
  return rowsToPromptTemplates(sheetName, rows)
})

const response = await fetch(`${baseUrl}/api/prompt-libraries/import`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    cookie: sessionCookie,
  },
  body: JSON.stringify({
    name: 'AI 测图提示词库 默认版',
    scenario: process.env.PROMPT_SCENARIO || '裂变图',
    templates,
  }),
})

if (!response.ok) {
  console.error(await response.text())
  process.exit(1)
}

const result = await response.json()
console.log(`Seeded ${templates.length} prompt rows into library ${result.library.id}`)

function rowsToPromptTemplates(sheetName, rows) {
  const headerIndex = rows.findIndex((row) => row.some((cell) => text(cell) === '字段名'))
  if (headerIndex < 0) return []
  const headers = rows[headerIndex].map(text)
  const column = (name) => headers.indexOf(name)
  const get = (row, index) => index >= 0 ? text(row[index]) : ''
  const integer = (row, index) => {
    const value = Number(get(row, index))
    return Number.isInteger(value) ? value : null
  }
  const cols = {
    fieldName: column('字段名'),
    sourceFieldId: column('字段 ID'),
    fieldOrder: column('字段顺序'),
    visible: column('在当前视图'),
    sizeLabel: column('尺寸'),
    outputFormat: column('格式'),
    referenceFields: column('引用字段'),
    promptText: column('描述内容'),
    wordCount: column('字数'),
    fieldType: column('字段类型'),
    femalePriority: column('女性优先度'),
    maleNeutralPriority: column('男性/中性优先度'),
  }
  return rows.slice(headerIndex + 1).map((row) => ({
    group_name: sheetName,
    field_name: get(row, cols.fieldName),
    source_field_id: get(row, cols.sourceFieldId),
    field_order: integer(row, cols.fieldOrder),
    visible: get(row, cols.visible) !== '否',
    size_label: get(row, cols.sizeLabel),
    output_format: get(row, cols.outputFormat) || 'jpeg',
    reference_fields: get(row, cols.referenceFields),
    prompt_text: get(row, cols.promptText),
    word_count: integer(row, cols.wordCount),
    field_type: get(row, cols.fieldType),
    female_priority: integer(row, cols.femalePriority),
    male_neutral_priority: integer(row, cols.maleNeutralPriority),
    enabled: true,
  })).filter((row) => row.field_name && row.prompt_text)
}

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim()
}
