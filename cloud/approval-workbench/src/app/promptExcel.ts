import * as XLSX from 'xlsx'

export interface PromptTemplateExcelRow {
  group_name: string
  field_name: string
  source_field_id: string
  field_order: number | null
  visible: boolean
  size_label: string
  output_format: string
  reference_fields: string
  prompt_text: string
  word_count: number | null
  field_type: string
  female_priority: number | null
  male_neutral_priority: number | null
  enabled: boolean
}

const HEADER_ALIASES: Record<keyof Omit<PromptTemplateExcelRow, 'group_name' | 'enabled'>, string[]> = {
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
}

export function rowsToPromptTemplates(sheetName: string, rows: unknown[][]): PromptTemplateExcelRow[] {
  const headerIndex = rows.findIndex((row) => row.some((cell) => cellText(cell) === '字段名'))
  if (headerIndex < 0) return []

  const headers = rows[headerIndex].map(cellText)
  const indexByHeader = new Map(headers.map((header, index) => [header, index]))
  const column = (key: keyof Omit<PromptTemplateExcelRow, 'group_name' | 'enabled'>) => {
    const alias = HEADER_ALIASES[key].find((name) => indexByHeader.has(name))
    return alias === undefined ? -1 : Number(indexByHeader.get(alias))
  }
  const indices = {
    field_name: column('field_name'),
    source_field_id: column('source_field_id'),
    field_order: column('field_order'),
    visible: column('visible'),
    size_label: column('size_label'),
    output_format: column('output_format'),
    reference_fields: column('reference_fields'),
    prompt_text: column('prompt_text'),
    word_count: column('word_count'),
    field_type: column('field_type'),
    female_priority: column('female_priority'),
    male_neutral_priority: column('male_neutral_priority'),
  }

  return rows.slice(headerIndex + 1).map((row) => ({
    group_name: sheetName.trim(),
    field_name: valueAt(row, indices.field_name),
    source_field_id: valueAt(row, indices.source_field_id),
    field_order: numberAt(row, indices.field_order),
    visible: visibleAt(row, indices.visible),
    size_label: valueAt(row, indices.size_label),
    output_format: valueAt(row, indices.output_format) || 'jpeg',
    reference_fields: valueAt(row, indices.reference_fields),
    prompt_text: valueAt(row, indices.prompt_text),
    word_count: numberAt(row, indices.word_count),
    field_type: valueAt(row, indices.field_type),
    female_priority: numberAt(row, indices.female_priority),
    male_neutral_priority: numberAt(row, indices.male_neutral_priority),
    enabled: true,
  })).filter((row) => row.field_name && row.prompt_text)
}

export async function parsePromptWorkbook(file: File): Promise<PromptTemplateExcelRow[]> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  return workbook.SheetNames.flatMap((sheetName) => {
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '' })
    return rowsToPromptTemplates(sheetName, rows)
  })
}

export function exportPromptWorkbook(libraryName: string, rows: PromptTemplateExcelRow[]): void {
  const workbook = XLSX.utils.book_new()
  const grouped = new Map<string, PromptTemplateExcelRow[]>()
  for (const row of rows) {
    const groupName = row.group_name || 'Prompt'
    grouped.set(groupName, [...(grouped.get(groupName) || []), row])
  }

  for (const [groupName, groupRows] of grouped) {
    const sheetRows = [
      [`${groupName} 字段描述`],
      [`导出库：${libraryName}`],
      [],
      ['字段名', '字段 ID', '字段顺序', '在当前视图', '尺寸', '格式', '引用字段', '描述内容', '字数', '字段类型', '女性优先度', '男性/中性优先度'],
      ...groupRows.map((row) => [
        row.field_name,
        row.source_field_id,
        row.field_order ?? '',
        row.visible ? '是' : '否',
        row.size_label,
        row.output_format,
        row.reference_fields,
        row.prompt_text,
        row.word_count ?? '',
        row.field_type,
        row.female_priority ?? '',
        row.male_neutral_priority ?? '',
      ]),
    ]
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheetRows), safeSheetName(groupName))
  }

  XLSX.writeFile(workbook, `${safeFileName(libraryName || 'prompt-library')}.xlsx`)
}

function valueAt(row: unknown[], index: number): string {
  return index >= 0 ? cellText(row[index]) : ''
}

function numberAt(row: unknown[], index: number): number | null {
  const value = index >= 0 ? Number(cellText(row[index])) : Number.NaN
  return Number.isFinite(value) ? value : null
}

function visibleAt(row: unknown[], index: number): boolean {
  const value = valueAt(row, index)
  return !['否', 'false', '0', 'no'].includes(value.toLowerCase())
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function safeSheetName(name: string): string {
  return (name || 'Prompt').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-')
}
