import * as XLSX from 'xlsx'

export interface MaterialTestOverviewRow {
  record_type: string
  row_no: number | null
  style_code: string
  item_id: string
  item_title: string
  task_id: string
  test_status: string
  test_channel: string
  material_count: number
  statistic_type: string
  best_material: string
  execution_result: string
  remark: string
}

export interface MaterialTestDetailRow {
  record_type: string
  row_no: number | null
  style_code: string
  item_id: string
  item_title: string
  task_id: string
  test_status: string
  test_channel: string
  material_count: number
  statistic_type: string
  statistic_date: string
  image_type: string
  material_id: string
  material_ratio: string
  material_share: number
  material_url: string
  search_impressions: number
  search_clicks: number
  search_ctr: number
  detail_impressions: number
  detail_clicks: number
  detail_ctr: number
  detail_add_to_cart: number
  detail_pay_conversion: number
  detail_pay_conversion_rate: number
  data_download_url: string
  execution_result: string
  remark: string
}

export interface ParsedMaterialTestWorkbook {
  overview_rows: MaterialTestOverviewRow[]
  detail_rows: MaterialTestDetailRow[]
  source: {
    filename: string
    sheet_names: string[]
  }
}

const OVERVIEW_HEADERS: Record<string, keyof MaterialTestOverviewRow> = {
  记录类型: 'record_type',
  表格行号: 'row_no',
  款号: 'style_code',
  商品ID: 'item_id',
  商品标题: 'item_title',
  任务ID: 'task_id',
  测试状态: 'test_status',
  测试渠道: 'test_channel',
  测试素材数: 'material_count',
  统计口径: 'statistic_type',
  最优素材: 'best_material',
  执行结果: 'execution_result',
  备注: 'remark',
}

const DETAIL_HEADERS: Record<string, keyof MaterialTestDetailRow> = {
  记录类型: 'record_type',
  表格行号: 'row_no',
  款号: 'style_code',
  商品ID: 'item_id',
  商品标题: 'item_title',
  任务ID: 'task_id',
  测试状态: 'test_status',
  测试渠道: 'test_channel',
  测试素材数: 'material_count',
  统计口径: 'statistic_type',
  统计日期: 'statistic_date',
  图片类型: 'image_type',
  素材ID: 'material_id',
  素材比例: 'material_ratio',
  素材占比: 'material_share',
  素材URL: 'material_url',
  搜索曝光: 'search_impressions',
  搜索点击: 'search_clicks',
  搜索点击率: 'search_ctr',
  详情曝光: 'detail_impressions',
  详情点击: 'detail_clicks',
  详情点击率: 'detail_ctr',
  详情加购: 'detail_add_to_cart',
  详情支付转化: 'detail_pay_conversion',
  详情支付转化率: 'detail_pay_conversion_rate',
  数据下载链接: 'data_download_url',
  执行结果: 'execution_result',
  备注: 'remark',
}

const NUMERIC_FIELDS = new Set<keyof MaterialTestDetailRow | keyof MaterialTestOverviewRow>([
  'row_no',
  'material_count',
  'material_share',
  'search_impressions',
  'search_clicks',
  'search_ctr',
  'detail_impressions',
  'detail_clicks',
  'detail_ctr',
  'detail_add_to_cart',
  'detail_pay_conversion',
  'detail_pay_conversion_rate',
])

export async function parseMaterialTestWorkbook(file: File): Promise<ParsedMaterialTestWorkbook> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })
  return parseMaterialTestWorkbookData(workbook, file.name)
}

export function parseMaterialTestWorkbookData(workbook: XLSX.WorkBook, filename = ''): ParsedMaterialTestWorkbook {
  return {
    overview_rows: rowsForSheet(workbook, '概览').map((row) => normalizeOverviewRow(row)).filter(hasOverviewIdentity),
    detail_rows: rowsForSheet(workbook, '明细').map((row) => normalizeDetailRow(row)).filter(hasDetailIdentity),
    source: {
      filename,
      sheet_names: workbook.SheetNames,
    },
  }
}

export function percentToDecimal(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const text = String(value).trim().replace(/,/g, '')
  if (!text || text === '-') return 0
  if (text.endsWith('%')) {
    const number = Number(text.slice(0, -1))
    return Number.isFinite(number) ? number / 100 : 0
  }
  const number = Number(text)
  return Number.isFinite(number) ? number : 0
}

function rowsForSheet(workbook: XLSX.WorkBook, sheetName: string): Record<string, unknown>[] {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
}

function normalizeOverviewRow(row: Record<string, unknown>): MaterialTestOverviewRow {
  const mapped = mapChineseRow(row, OVERVIEW_HEADERS)
  return {
    record_type: text(mapped.record_type),
    row_no: nullableInteger(mapped.row_no),
    style_code: text(mapped.style_code),
    item_id: text(mapped.item_id),
    item_title: text(mapped.item_title),
    task_id: text(mapped.task_id),
    test_status: text(mapped.test_status),
    test_channel: text(mapped.test_channel),
    material_count: integer(mapped.material_count),
    statistic_type: text(mapped.statistic_type || mapped.test_channel),
    best_material: text(mapped.best_material),
    execution_result: text(mapped.execution_result),
    remark: text(mapped.remark),
  }
}

function normalizeDetailRow(row: Record<string, unknown>): MaterialTestDetailRow {
  const mapped = mapChineseRow(row, DETAIL_HEADERS)
  return {
    record_type: text(mapped.record_type),
    row_no: nullableInteger(mapped.row_no),
    style_code: text(mapped.style_code),
    item_id: text(mapped.item_id),
    item_title: text(mapped.item_title),
    task_id: text(mapped.task_id),
    test_status: text(mapped.test_status),
    test_channel: text(mapped.test_channel),
    material_count: integer(mapped.material_count),
    statistic_type: text(mapped.statistic_type),
    statistic_date: normalizeStatisticDate(mapped.statistic_date),
    image_type: text(mapped.image_type),
    material_id: text(mapped.material_id),
    material_ratio: text(mapped.material_ratio),
    material_share: percentToDecimal(mapped.material_share),
    material_url: text(mapped.material_url),
    search_impressions: integer(mapped.search_impressions),
    search_clicks: integer(mapped.search_clicks),
    search_ctr: percentToDecimal(mapped.search_ctr),
    detail_impressions: integer(mapped.detail_impressions),
    detail_clicks: integer(mapped.detail_clicks),
    detail_ctr: percentToDecimal(mapped.detail_ctr),
    detail_add_to_cart: integer(mapped.detail_add_to_cart),
    detail_pay_conversion: integer(mapped.detail_pay_conversion),
    detail_pay_conversion_rate: percentToDecimal(mapped.detail_pay_conversion_rate),
    data_download_url: text(mapped.data_download_url),
    execution_result: text(mapped.execution_result),
    remark: text(mapped.remark),
  }
}

function mapChineseRow<T extends Record<string, string>>(row: Record<string, unknown>, headers: T): Partial<Record<T[keyof T], unknown>> {
  const mapped: Partial<Record<T[keyof T], unknown>> = {}
  for (const [key, value] of Object.entries(row)) {
    const target = headers[key] ?? key
    mapped[target as T[keyof T]] = NUMERIC_FIELDS.has(target as keyof MaterialTestDetailRow) ? value : value
  }
  return mapped
}

function hasOverviewIdentity(row: MaterialTestOverviewRow): boolean {
  return Boolean(row.item_id && row.task_id)
}

function hasDetailIdentity(row: MaterialTestDetailRow): boolean {
  return Boolean(row.item_id && row.task_id && row.statistic_type && row.material_url)
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim()
}

function normalizeStatisticDate(value: unknown): string {
  const raw = text(value)
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (ymd) return `${ymd[1]}${ymd[2]}${ymd[3]}`
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(raw)
  if (compact) return `${compact[1]}${compact[2]}${compact[3]}`
  return raw
}

function integer(value: unknown): number {
  const number = Number(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(number) ? Math.trunc(number) : 0
}

function nullableInteger(value: unknown): number | null {
  const number = integer(value)
  return number > 0 ? number : null
}
