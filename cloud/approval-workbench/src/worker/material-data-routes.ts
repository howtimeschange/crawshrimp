import { recordAudit } from './audit'
import { fromJsonObject, nowIso, toJson } from './db'
import type { Env } from './env'
import { badRequest, forbidden, json, readJsonObject } from './http'
import { requirePermission, type CurrentUser } from './auth-routes'
import { requireActiveMachine, type MachineRow } from './machine-routes'
import { randomToken, sha256Hex } from './security/tokens'

interface OverviewRow {
  source_uid?: unknown
  source_filename?: unknown
  record_type?: unknown
  row_no?: unknown
  style_code?: unknown
  item_id?: unknown
  item_title?: unknown
  task_id?: unknown
  test_status?: unknown
  test_channel?: unknown
  material_count?: unknown
  statistic_type?: unknown
  best_material?: unknown
  execution_result?: unknown
  remark?: unknown
  记录类型?: unknown
  表格行号?: unknown
  款号?: unknown
  商品ID?: unknown
  商品标题?: unknown
  任务ID?: unknown
  测试状态?: unknown
  测试渠道?: unknown
  测试素材数?: unknown
  统计口径?: unknown
  最优素材?: unknown
  执行结果?: unknown
  备注?: unknown
}

interface DetailRow extends OverviewRow {
  statistic_date?: unknown
  image_type?: unknown
  material_id?: unknown
  material_ratio?: unknown
  material_share?: unknown
  material_url?: unknown
  search_impressions?: unknown
  search_clicks?: unknown
  search_ctr?: unknown
  detail_impressions?: unknown
  detail_clicks?: unknown
  detail_ctr?: unknown
  detail_add_to_cart?: unknown
  detail_pay_conversion?: unknown
  detail_pay_conversion_rate?: unknown
  data_download_url?: unknown
  统计日期?: unknown
  图片类型?: unknown
  素材ID?: unknown
  素材比例?: unknown
  素材占比?: unknown
  素材URL?: unknown
  搜索曝光?: unknown
  搜索点击?: unknown
  搜索点击率?: unknown
  详情曝光?: unknown
  详情点击?: unknown
  详情点击率?: unknown
  详情加购?: unknown
  详情支付转化?: unknown
  详情支付转化率?: unknown
  数据下载链接?: unknown
}

interface DispatchJobRow {
  id: number
  job_uid: string
  batch_uid: string
  job_type: string
  status: string
  requested_by: number | null
  assigned_machine_id: string | null
  required_capabilities_json: string
  priority: number
  attempt_count: number
  max_attempts: number
  idempotency_key: string
  lease_id: string | null
  lease_expires_at: string | null
  payload_json: string
  result_json: string
  created_at: string
  updated_at: string
}

interface MaterialTestScheduleRow {
  schedule_uid: string
  label: string
  statistic_type: string
  schedule_time: string
  timezone: string
  status: string
  target_machine_id: string | null
  payload_json: string
  created_by: number | null
}

const IMPORT_BATCH_SIZE = 500
const ACTIVE_IMPORT_LEASE_STATUSES = new Set(['leased', 'running', 'uploading_results'])
const VALID_SCHEDULE_STATUSES = new Set(['active', 'paused'])

export async function importMaterialTestData(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request)
  const actor = await requireMachineOrUser(request, env, 'jobs:generate', body)
  if (actor instanceof Response) return actor
  const source = objectValue(body.source)
  const sourceUid = stringValue(source.source_uid ?? source.sourceUid) || `material-${await sha256Hex(JSON.stringify(source).slice(0, 4096) + nowIso())}`
  const sourceFilename = stringValue(source.filename ?? source.source_filename ?? source.sourceFilename)
  const importedAt = nowIso()
  const overviewRows = arrayOfObjects(body.overview_rows ?? body.overviewRows).map((row) => normalizeOverview(row, sourceUid, sourceFilename)).filter((row) => row.item_id && row.task_id)
  const detailRows = arrayOfObjects(body.detail_rows ?? body.detailRows).map((row) => normalizeDetail(row, sourceUid, sourceFilename)).filter((row) => row.item_id && row.task_id && row.statistic_type && row.material_url)

  let changed = 0
  const overviewStatements = overviewRows.map((row) => env.DB.prepare(
    `INSERT INTO material_test_task_overviews
         (source_uid, source_filename, record_type, row_no, style_code, item_id, item_title, task_id,
          test_status, test_channel, material_count, statistic_type, best_material, execution_result,
          remark, imported_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(item_id, task_id, statistic_type) DO UPDATE SET
         source_uid = excluded.source_uid,
         source_filename = excluded.source_filename,
         record_type = excluded.record_type,
         row_no = excluded.row_no,
         style_code = excluded.style_code,
         item_title = excluded.item_title,
         test_status = excluded.test_status,
         test_channel = excluded.test_channel,
         material_count = excluded.material_count,
         best_material = excluded.best_material,
         execution_result = excluded.execution_result,
         remark = excluded.remark,
         imported_at = excluded.imported_at,
         updated_at = excluded.updated_at`,
  ).bind(row.source_uid, row.source_filename, row.record_type, row.row_no, row.style_code, row.item_id, row.item_title, row.task_id, row.test_status, row.test_channel, row.material_count, row.statistic_type, row.best_material, row.execution_result, row.remark, importedAt, importedAt))
  const detailStatements = detailRows.map((row) => env.DB.prepare(
    `INSERT INTO material_test_image_metrics
         (source_uid, source_filename, record_type, row_no, style_code, item_id, item_title, task_id,
          test_status, test_channel, material_count, statistic_type, statistic_date, image_type,
          material_id, material_ratio, material_share, material_url, search_impressions, search_clicks,
          search_ctr, detail_impressions, detail_clicks, detail_ctr, detail_add_to_cart,
          detail_pay_conversion, detail_pay_conversion_rate, data_download_url, execution_result,
          remark, imported_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(item_id, task_id, statistic_type, statistic_date, material_id, material_url) DO UPDATE SET
         source_uid = excluded.source_uid,
         source_filename = excluded.source_filename,
         record_type = excluded.record_type,
         row_no = excluded.row_no,
         style_code = excluded.style_code,
         item_title = excluded.item_title,
         test_status = excluded.test_status,
         test_channel = excluded.test_channel,
         material_count = excluded.material_count,
         image_type = excluded.image_type,
         material_ratio = excluded.material_ratio,
         material_share = excluded.material_share,
         search_impressions = excluded.search_impressions,
         search_clicks = excluded.search_clicks,
         search_ctr = excluded.search_ctr,
         detail_impressions = excluded.detail_impressions,
         detail_clicks = excluded.detail_clicks,
         detail_ctr = excluded.detail_ctr,
         detail_add_to_cart = excluded.detail_add_to_cart,
         detail_pay_conversion = excluded.detail_pay_conversion,
         detail_pay_conversion_rate = excluded.detail_pay_conversion_rate,
         data_download_url = excluded.data_download_url,
         execution_result = excluded.execution_result,
         remark = excluded.remark,
         imported_at = excluded.imported_at,
         updated_at = excluded.updated_at`,
  ).bind(row.source_uid, row.source_filename, row.record_type, row.row_no, row.style_code, row.item_id, row.item_title, row.task_id, row.test_status, row.test_channel, row.material_count, row.statistic_type, row.statistic_date, row.image_type, row.material_id, row.material_ratio, row.material_share, row.material_url, row.search_impressions, row.search_clicks, row.search_ctr, row.detail_impressions, row.detail_clicks, row.detail_ctr, row.detail_add_to_cart, row.detail_pay_conversion, row.detail_pay_conversion_rate, row.data_download_url, row.execution_result, row.remark, importedAt, importedAt))
  changed += await runD1Statements(env, overviewStatements)
  changed += await runD1Statements(env, detailStatements)

  await recordAudit(env, auditActor(actor), 'material_test.import', 'material_test_source', sourceUid, { source_filename: sourceFilename, overview_rows: overviewRows.length, detail_rows: detailRows.length }, request)
  return json({
    overview_rows: overviewRows.length,
    detail_rows: detailRows.length,
    inserted_or_updated: changed || overviewRows.length + detailRows.length,
    source_uid: sourceUid,
  })
}

export async function getMaterialTestSummary(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'dashboard:read')
  if (actor instanceof Response) return actor
  const row = await env.DB.prepare(
    `SELECT
       COUNT(DISTINCT item_id) AS total_items,
       COUNT(DISTINCT material_id || '|' || material_url) AS total_materials,
       COALESCE(SUM(search_impressions), 0) AS total_search_exposure,
       COALESCE(SUM(search_clicks), 0) AS total_search_clicks
     FROM material_test_image_metrics`,
  ).first<{ total_items: number; total_materials: number; total_search_exposure: number; total_search_clicks: number }>()
  const best = await env.DB.prepare("SELECT COUNT(*) AS best_image_count FROM material_test_task_overviews WHERE best_material <> ''").first<{ best_image_count: number }>()
  const latest = await env.DB.prepare('SELECT source_filename, imported_at FROM material_test_image_metrics ORDER BY imported_at DESC LIMIT 1').first<{ source_filename: string; imported_at: string }>()
  const totalSearchExposure = Number(row?.total_search_exposure ?? 0)
  const totalSearchClicks = Number(row?.total_search_clicks ?? 0)
  return json({
    total_items: Number(row?.total_items ?? 0),
    total_materials: Number(row?.total_materials ?? 0),
    total_search_exposure: totalSearchExposure,
    weighted_search_ctr: totalSearchExposure > 0 ? totalSearchClicks / totalSearchExposure : 0,
    best_image_count: Number(best?.best_image_count ?? 0),
    latest_import: latest ?? null,
  })
}

export async function listMaterialTestImages(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'dashboard:read')
  if (actor instanceof Response) return actor
  const params = new URL(request.url).searchParams
  const filters: string[] = []
  const values: string[] = []
  addEqualFilter(filters, values, 'statistic_type', params.get('statistic_type'))
  addEqualFilter(filters, values, 'statistic_date', normalizeStatisticDate(params.get('date') || params.get('statistic_date')))
  addEqualFilter(filters, values, 'image_type', params.get('image_type'))
  const search = stringValue(params.get('q') || params.get('search'))
  if (search) {
    filters.push('(style_code LIKE ? OR item_id LIKE ?)')
    values.push(`%${search}%`, `%${search}%`)
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
  const { results } = await env.DB.prepare(
    `SELECT id, style_code, item_id, item_title, task_id, statistic_type, statistic_date, image_type,
            material_id, material_ratio, material_share, material_url, search_impressions, search_clicks,
            search_ctr, detail_impressions, detail_clicks, detail_ctr, detail_add_to_cart,
            detail_pay_conversion, detail_pay_conversion_rate, execution_result, remark
     FROM material_test_image_metrics
     ${where}
     ORDER BY search_impressions DESC, detail_clicks DESC
     LIMIT 200`,
  )
    .bind(...values)
    .all()
  return json({ images: results })
}

export async function createMaterialTestCrawlJob(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'jobs:generate')
  if (actor instanceof Response) return actor
  const body = await readJsonObject(request)
  const machineId = stringValue(body.machine_id ?? body.machineId)
  const machineValidation = await validateMaterialTestMachine(env, machineId || null)
  if (machineValidation instanceof Response) return machineValidation
  const payload = {
    run_params: objectValue(body.run_params ?? body.runParams),
    source: objectValue(body.source),
  }
  const explicitIdempotencyKey = stringValue(body.idempotency_key ?? body.idempotencyKey)
  const keySource = JSON.stringify({ machineId, payload, schedule_uid: stringValue(body.schedule_uid ?? body.scheduleUid), request_uid: randomToken('request') })
  const idempotencyKey = explicitIdempotencyKey || `crawl_tmall_material_test_data:${await sha256Hex(keySource)}`
  const existing = await findDispatchJob(env, idempotencyKey)
  const job = existing ?? await insertDispatchJob(env, {
    requestedBy: actor.user.id,
    assignedMachineId: machineId || null,
    idempotencyKey,
    payload,
  })
  await recordAudit(env, { userId: actor.user.id }, 'jobs.crawl_tmall_material_test_data.create', 'dispatch_job', job.job_uid, { machine_id: machineId }, request)
  return json({ job: publicJob(job) }, { status: existing ? 200 : 201 })
}

export async function createMaterialTestSchedule(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'machines:write')
  if (actor instanceof Response) return actor
  const body = await readJsonObject(request)
  const scheduleTime = stringValue(body.schedule_time ?? body.scheduleTime)
  if (!validScheduleTime(scheduleTime)) return badRequest('schedule_time must be HH:mm from 00:00 to 23:59')
  const machineId = nullableString(body.machine_id ?? body.machineId)
  const machineValidation = await validateMaterialTestMachine(env, machineId)
  if (machineValidation instanceof Response) return machineValidation
  const timezone = stringValue(body.timezone) || 'Asia/Shanghai'
  if (!validTimeZone(timezone)) return badRequest('timezone must be a valid IANA time zone')
  const status = stringValue(body.status) || 'active'
  if (!VALID_SCHEDULE_STATUSES.has(status)) return badRequest('status must be active or paused')
  const now = nowIso()
  const scheduleUid = stringValue(body.schedule_uid ?? body.scheduleUid) || randomToken('mts')
  await env.DB.prepare(
    `INSERT INTO material_test_crawl_schedules
       (schedule_uid, label, statistic_type, schedule_time, timezone, status, target_machine_id, payload_json, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(schedule_uid) DO UPDATE SET
       label = excluded.label,
       statistic_type = excluded.statistic_type,
       schedule_time = excluded.schedule_time,
       timezone = excluded.timezone,
       status = excluded.status,
       target_machine_id = excluded.target_machine_id,
       payload_json = excluded.payload_json,
       updated_at = excluded.updated_at`,
  )
    .bind(scheduleUid, stringValue(body.label) || '天猫测图数据抓取', stringValue(body.statistic_type ?? body.statisticType) || 'ACCUMULATE_30_DAYS', scheduleTime, timezone, status, machineId, toJson(objectValue(body.payload)), actor.user.id, now, now)
    .run()
  const schedule = await env.DB.prepare('SELECT * FROM material_test_crawl_schedules WHERE schedule_uid = ? LIMIT 1').bind(scheduleUid).first()
  await recordAudit(env, { userId: actor.user.id }, 'material_test.schedule.upsert', 'material_test_crawl_schedule', scheduleUid, { schedule_time: scheduleTime }, request)
  return json({ schedule }, { status: 201 })
}

export async function dispatchDueMaterialTestSchedules(env: Env, scheduledAt = new Date()): Promise<{ checked: number; enqueued: number }> {
  const { results } = await env.DB.prepare(
    `SELECT schedule_uid, label, statistic_type, schedule_time, timezone, status, target_machine_id, payload_json, created_by
     FROM material_test_crawl_schedules
     WHERE status = 'active'`,
  ).all<MaterialTestScheduleRow>()
  let enqueued = 0
  for (const schedule of results) {
    const occurrence = scheduleOccurrence(schedule, scheduledAt)
    if (!occurrence) continue
    const payload = {
      run_params: {
        ...fromJsonObject(schedule.payload_json),
        statistic_type: schedule.statistic_type || 'ACCUMULATE_30_DAYS',
      },
      source: { schedule_uid: schedule.schedule_uid },
      schedule_uid: schedule.schedule_uid,
      schedule_time: schedule.schedule_time,
      timezone: schedule.timezone,
    }
    const before = await findDispatchJob(env, occurrence.idempotencyKey)
    if (before) continue
    await insertDispatchJob(env, {
      requestedBy: schedule.created_by,
      assignedMachineId: schedule.target_machine_id || null,
      idempotencyKey: occurrence.idempotencyKey,
      payload,
    })
    enqueued += 1
  }
  return { checked: results.length, enqueued }
}

async function requireMachineOrUser(request: Request, env: Env, permission: Parameters<typeof requirePermission>[2], body: Record<string, unknown>): Promise<MachineRow | CurrentUser | Response> {
  if (hasBearerToken(request)) {
    const machine = await requireActiveMachine(request, env)
    if (machine instanceof Response) return machine
    return requireMaterialImportLease(env, machine, body)
  }
  return requirePermission(request, env, permission)
}

async function requireMaterialImportLease(env: Env, machine: MachineRow, body: Record<string, unknown>): Promise<MachineRow | Response> {
  if (!parseArray(machine.capabilities_json).includes('crawl_tmall_material_test_data')) return forbidden('Machine lacks crawl_tmall_material_test_data capability')
  const jobUid = stringValue(body.job_uid ?? body.jobUid)
  const leaseId = stringValue(body.lease_id ?? body.leaseId)
  if (!jobUid || !leaseId) return badRequest('machine import requires job_uid and lease_id')
  const job = await env.DB.prepare(
    `SELECT job_uid, batch_uid, job_type, status, assigned_machine_id, lease_id, lease_expires_at, payload_json
     FROM dispatch_jobs
     WHERE job_uid = ?
     LIMIT 1`,
  )
    .bind(jobUid)
    .first<DispatchJobRow>()
  if (!job) return forbidden('Machine lease was not found')
  if (job.job_type !== 'crawl_tmall_material_test_data') return forbidden('Machine lease does not allow material data import')
  if (job.assigned_machine_id !== machine.machine_id || job.lease_id !== leaseId) return forbidden('Machine lease does not match this import')
  if (!ACTIVE_IMPORT_LEASE_STATUSES.has(job.status)) return forbidden('Machine lease is not active')
  if (!job.lease_expires_at || job.lease_expires_at <= nowIso()) return forbidden('Machine lease is expired')
  return machine
}

function normalizeOverview(row: OverviewRow, sourceUid: string, sourceFilename: string) {
  return {
    source_uid: stringValue(row.source_uid) || sourceUid,
    source_filename: stringValue(row.source_filename) || sourceFilename,
    record_type: stringValue(row.record_type ?? row.记录类型),
    row_no: nullableInteger(row.row_no ?? row.表格行号),
    style_code: stringValue(row.style_code ?? row.款号),
    item_id: stringValue(row.item_id ?? row.商品ID),
    item_title: stringValue(row.item_title ?? row.商品标题),
    task_id: stringValue(row.task_id ?? row.任务ID),
    test_status: stringValue(row.test_status ?? row.测试状态),
    test_channel: stringValue(row.test_channel ?? row.测试渠道),
    material_count: integer(row.material_count ?? row.测试素材数),
    statistic_type: stringValue(row.statistic_type ?? row.统计口径 ?? row.test_channel ?? row.测试渠道),
    best_material: stringValue(row.best_material ?? row.最优素材),
    execution_result: stringValue(row.execution_result ?? row.执行结果),
    remark: stringValue(row.remark ?? row.备注),
  }
}

function normalizeDetail(row: DetailRow, sourceUid: string, sourceFilename: string) {
  const base = normalizeOverview(row, sourceUid, sourceFilename)
  return {
    ...base,
    statistic_type: stringValue(row.statistic_type ?? row.统计口径),
    statistic_date: normalizeStatisticDate(row.statistic_date ?? row.统计日期),
    image_type: stringValue(row.image_type ?? row.图片类型),
    material_id: stringValue(row.material_id ?? row.素材ID),
    material_ratio: stringValue(row.material_ratio ?? row.素材比例),
    material_share: decimal(row.material_share ?? row.素材占比),
    material_url: stringValue(row.material_url ?? row.素材URL),
    search_impressions: integer(row.search_impressions ?? row.搜索曝光),
    search_clicks: integer(row.search_clicks ?? row.搜索点击),
    search_ctr: decimal(row.search_ctr ?? row.搜索点击率),
    detail_impressions: integer(row.detail_impressions ?? row.详情曝光),
    detail_clicks: integer(row.detail_clicks ?? row.详情点击),
    detail_ctr: decimal(row.detail_ctr ?? row.详情点击率),
    detail_add_to_cart: integer(row.detail_add_to_cart ?? row.详情加购),
    detail_pay_conversion: integer(row.detail_pay_conversion ?? row.详情支付转化),
    detail_pay_conversion_rate: decimal(row.detail_pay_conversion_rate ?? row.详情支付转化率),
    data_download_url: stringValue(row.data_download_url ?? row.数据下载链接),
  }
}

async function insertDispatchJob(env: Env, job: { requestedBy: number | null; assignedMachineId: string | null; idempotencyKey: string; payload: unknown }): Promise<DispatchJobRow> {
  const now = nowIso()
  const jobUid = randomToken('job')
  await env.DB.prepare(
    `INSERT INTO dispatch_jobs
       (job_uid, batch_uid, job_type, status, requested_by, assigned_machine_id, required_capabilities_json,
        priority, max_attempts, idempotency_key, payload_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(job_type, idempotency_key) DO NOTHING`,
  )
    .bind(jobUid, 'material-test', 'crawl_tmall_material_test_data', 'queued', job.requestedBy, job.assignedMachineId, toJson(['crawl_tmall_material_test_data']), 60, 1, job.idempotencyKey, toJson(job.payload), now, now)
    .run()
  const row = await findDispatchJob(env, job.idempotencyKey)
  if (!row) throw new Error('crawl_tmall_material_test_data dispatch job was not created')
  return row
}

async function validateMaterialTestMachine(env: Env, machineId: string | null): Promise<null | Response> {
  if (!machineId) return null
  const machine = await env.DB.prepare('SELECT * FROM task_machines WHERE machine_id = ? LIMIT 1').bind(machineId).first<MachineRow>()
  if (!machine || machine.auth_status !== 'active') return badRequest('selected machine must be active')
  if (!parseArray(machine.capabilities_json).includes('crawl_tmall_material_test_data')) return badRequest('selected machine lacks crawl_tmall_material_test_data capability')
  return null
}

function findDispatchJob(env: Env, idempotencyKey: string): Promise<DispatchJobRow | null> {
  return env.DB.prepare("SELECT * FROM dispatch_jobs WHERE job_type = 'crawl_tmall_material_test_data' AND idempotency_key = ? LIMIT 1")
    .bind(idempotencyKey)
    .first<DispatchJobRow>()
}

async function runD1Statements(env: Env, statements: D1PreparedStatement[]): Promise<number> {
  let changed = 0
  for (let index = 0; index < statements.length; index += IMPORT_BATCH_SIZE) {
    const chunk = statements.slice(index, index + IMPORT_BATCH_SIZE)
    if (chunk.length === 0) continue
    const db = env.DB as D1Database & { batch?: (statements: D1PreparedStatement[]) => Promise<D1Result[]> }
    const results = typeof db.batch === 'function'
      ? await db.batch(chunk)
      : await Promise.all(chunk.map((statement) => statement.run()))
    changed += results.reduce((total, result) => total + Number(result.meta.changes ?? 0), 0)
  }
  return changed
}

function hasBearerToken(request: Request): boolean {
  return /^Bearer\s+\S+/i.test(request.headers.get('authorization') || '')
}

function validScheduleTime(value: string): boolean {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!match) return false
  const hour = Number(match[1])
  const minute = Number(match[2])
  return Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
}

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date())
    return true
  } catch {
    return false
  }
}

function scheduleOccurrence(schedule: MaterialTestScheduleRow, now: Date): { idempotencyKey: string } | null {
  if (!validScheduleTime(schedule.schedule_time)) return null
  const local = localDateParts(now, schedule.timezone || 'Asia/Shanghai')
  if (`${local.hour}:${local.minute}` < normalizeScheduleTime(schedule.schedule_time)) return null
  return {
    idempotencyKey: `crawl_tmall_material_test_data:schedule:${schedule.schedule_uid}:${local.date}:${normalizeScheduleTime(schedule.schedule_time)}`,
  }
}

function normalizeScheduleTime(value: string): string {
  const [hour, minute] = value.split(':')
  return `${hour.padStart(2, '0')}:${minute}`
}

function localDateParts(date: Date, timeZone: string): { date: string; hour: string; minute: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const value = (type: string) => parts.find((part) => part.type === type)?.value || '00'
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    hour: value('hour').padStart(2, '0'),
    minute: value('minute').padStart(2, '0'),
  }
}

function publicJob(job: DispatchJobRow) {
  return {
    ...job,
    payload: fromJsonObject(job.payload_json),
    result: fromJsonObject(job.result_json),
  }
}

function addEqualFilter(filters: string[], values: string[], field: string, value: unknown): void {
  const text = stringValue(value)
  if (!text) return
  filters.push(`${field} = ?`)
  values.push(text)
}

function normalizeStatisticDate(value: unknown): string {
  const text = stringValue(value)
  if (!text) return ''
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (ymd) return `${ymd[1]}${ymd[2]}${ymd[3]}`
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(text)
  if (compact) return `${compact[1]}${compact[2]}${compact[3]}`
  return text
}

function auditActor(actor: MachineRow | CurrentUser): { machineId?: string; userId?: number } {
  if ('machine_id' in actor) return { machineId: actor.machine_id }
  return { userId: actor.user.id }
}

function arrayOfObjects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))) : []
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function parseArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function stringValue(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim()
}

function nullableString(value: unknown): string | null {
  const text = stringValue(value)
  return text || null
}

function integer(value: unknown): number {
  const number = Number(stringValue(value).replace(/,/g, ''))
  return Number.isFinite(number) ? Math.trunc(number) : 0
}

function nullableInteger(value: unknown): number | null {
  const number = integer(value)
  return number > 0 ? number : null
}

function decimal(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const text = stringValue(value).replace(/,/g, '')
  if (!text || text === '-') return 0
  if (text.endsWith('%')) {
    const number = Number(text.slice(0, -1))
    return Number.isFinite(number) ? number / 100 : 0
  }
  const number = Number(text)
  return Number.isFinite(number) ? number : 0
}
