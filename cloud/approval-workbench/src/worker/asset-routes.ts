import { fromJsonObject, nowIso, toJson } from './db'
import type { Env } from './env'
import { badRequest, forbidden, json, readJsonObject } from './http'
import { requirePermission } from './auth-routes'
import { requireActiveMachine } from './machine-routes'
import type { Permission } from './security/rbac'

const ALLOWED_KINDS = new Set(['source', 'reference', 'ai', 'table', 'log', 'result'])
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.csv', '.xlsx', '.xls', '.json', '.txt', '.log'])

class AssetUidConflictError extends Error {
  constructor() {
    super('asset_uid already belongs to a different asset scope')
  }
}

interface AssetUploadBody {
  batch_uid?: unknown
  style_id?: unknown
  asset_uid?: unknown
  kind?: unknown
  filename?: unknown
  content_hash?: unknown
  prompt_template_version_id?: unknown
  prompt_text?: unknown
  parent_asset_uid?: unknown
  generation_job_id?: unknown
  source_path?: unknown
  source_path_label?: unknown
  meta?: unknown
  job_uid?: unknown
  jobUid?: unknown
  lease_id?: unknown
  leaseId?: unknown
}

interface AssetRow {
  asset_uid: string
  batch_uid: string
  style_id: number
  kind: string
  status: string
  object_key: string
  filename: string
  content_hash: string
  meta_json: string
}

interface StyleRow {
  id: number
  batch_uid: string
  style_code: string
  item_id: string
}

interface BatchRow {
  batch_uid: string
  status: string
  source_machine_id: string | null
}

interface DispatchJobRow {
  job_uid: string
  batch_uid: string
  job_type: string
  status: string
  assigned_machine_id: string | null
  lease_id: string | null
  lease_expires_at: string | null
  payload_json: string
}

export function batchObjectKey(batchUid: string, kind: string, filename: string): string {
  return `batches/${safePathSegment(batchUid)}/${safePathSegment(kind)}/${safeFilename(filename)}`
}

export async function createAssetUploadPlan(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request) as AssetUploadBody
  const actor = await requireMachineOrUserPermission(request, env, 'machines:write')
  if (actor instanceof Response) return actor
  const batchUid = stringValue(body.batch_uid)
  const assetUid = stringValue(body.asset_uid)
  const kind = stringValue(body.kind)
  const filename = stringValue(body.filename)
  const styleId = Number(body.style_id)
  if (!batchUid || !assetUid || !kind || !filename || !Number.isInteger(styleId) || styleId <= 0) {
    return badRequest('batch_uid, style_id, asset_uid, kind, and filename are required')
  }
  if (!isSafeIdentifier(batchUid) || !isSafeIdentifier(assetUid)) return badRequest('batch_uid and asset_uid must be safe identifiers')
  if (!ALLOWED_KINDS.has(kind)) return badRequest('invalid asset kind')
  if (!hasAllowedSuffix(filename)) return badRequest('asset filename suffix is not allowed')
  if (isMachineActor(actor)) {
    const lease = leaseFields(request, body)
    if (lease.jobUid || lease.leaseId) {
      const job = await requireMachineLeaseForBatch(request, env, actor.machine_id, batchUid, body)
      if (job instanceof Response) return job
      if (!isAssetAllowedForMachineJob(job, { assetUid, batchUid, styleId, kind, access: 'upload' })) {
        return forbidden('Machine lease does not include this asset upload')
      }
    } else if (isMaterialTestResultUpload({ batchUid, kind })) {
      const job = await requireMachineLeaseForBatch(request, env, actor.machine_id, batchUid, body)
      if (job instanceof Response) return job
    } else {
      const syncScope = await requireMachineSyncUploadPlan(env, actor.machine_id, { assetUid, batchUid, styleId, kind, filename: safeFilename(filename) })
      if (syncScope instanceof Response) return syncScope
    }
  }

  const objectKey = batchObjectKey(batchUid, kind, `${safePathSegment(assetUid)}-${safeFilename(filename)}`)
  if (!objectKey.startsWith(`batches/${safePathSegment(batchUid)}/`) || objectKey.includes('..')) {
    return badRequest('invalid object key')
  }
  const now = nowIso()
  try {
    await upsertAsset(env, {
      assetUid,
      batchUid,
      styleId,
      kind,
      status: 'planned',
      objectKey,
      filename: safeFilename(filename),
      contentHash: stringValue(body.content_hash),
      promptTemplateVersionId: numberOrNull(body.prompt_template_version_id),
      promptText: stringValue(body.prompt_text),
      parentAssetUid: nullableString(body.parent_asset_uid),
      generationJobId: nullableString(body.generation_job_id),
      meta: sanitizedMeta(body),
      now,
    })
  } catch (error) {
    const response = assetUidConflictResponse(error)
    if (response) return response
    throw error
  }
  const lease = isMachineActor(actor) ? leaseFields(request, body) : null
  return json({
    asset_uid: assetUid,
    object_key: objectKey,
    upload_url: uploadUrlForObjectKey(objectKey, lease && lease.jobUid && lease.leaseId ? lease : null),
    method: 'PUT',
    headers: {},
  })
}

export async function uploadAsset(request: Request, env: Env): Promise<Response> {
  const actor = await requireMachineOrUserPermission(request, env, 'batches:review')
  if (actor instanceof Response) return actor
  const objectKey = objectKeyFromUploadPath(request)
  if (!isValidUploadObjectKey(objectKey)) return badRequest('invalid object key')
  const asset = await env.DB.prepare('SELECT asset_uid, batch_uid, style_id, kind, status, object_key, filename, content_hash, meta_json FROM ai_image_assets WHERE object_key = ? LIMIT 1')
    .bind(objectKey)
    .first<AssetRow>()
  if (!asset) return json({ error: 'Asset upload plan not found' }, { status: 404 })
  if (isMachineActor(actor)) {
    const lease = leaseFields(request)
    if (lease.jobUid || lease.leaseId) {
      const job = await requireMachineLeaseForBatch(request, env, actor.machine_id, asset.batch_uid)
      if (job instanceof Response) return job
      if (!isAssetAllowedForMachineJob(job, { assetUid: asset.asset_uid, batchUid: asset.batch_uid, styleId: asset.style_id, kind: asset.kind, access: 'upload' })) {
        return forbidden('Machine lease does not include this asset upload')
      }
    } else if (isMaterialTestResultUpload({ batchUid: asset.batch_uid, kind: asset.kind })) {
      const job = await requireMachineLeaseForBatch(request, env, actor.machine_id, asset.batch_uid)
      if (job instanceof Response) return job
    } else {
      const syncScope = await requireMachineSyncUploadObject(env, actor.machine_id, asset)
      if (syncScope instanceof Response) return syncScope
    }
  }
  await env.ASSETS.put(objectKey, request.body, {
    httpMetadata: {
      contentType: request.headers.get('content-type') || 'application/octet-stream',
    },
  })
  const now = nowIso()
  await env.DB.prepare("UPDATE ai_image_assets SET status = ?, updated_at = ? WHERE object_key = ?")
    .bind('uploaded', now, objectKey)
    .run()
  await upsertImageResourceForUploadedAsset(env, asset, actor, now)
  return json({ ok: true, object_key: objectKey })
}

export async function getAssetDownload(request: Request, env: Env): Promise<Response> {
  const actor = await requireMachineOrUserPermission(request, env, 'batches:read')
  if (actor instanceof Response) return actor
  if (!isMachineActor(actor) && isRejectedCrossSiteCookieDownload(request)) {
    return forbidden('Cross-site cookie asset downloads are not allowed')
  }
  const assetUid = new URL(request.url).pathname.match(/^\/api\/assets\/([^/]+)\/download$/)?.[1] || ''
  if (!assetUid) return badRequest('asset_uid is required')
  const asset = await env.DB.prepare('SELECT asset_uid, batch_uid, style_id, kind, object_key, filename, content_hash, meta_json FROM ai_image_assets WHERE asset_uid = ? LIMIT 1')
    .bind(decodeURIComponent(assetUid))
    .first<AssetRow>()
  if (!asset) return json({ error: 'Not found' }, { status: 404 })
  if (isMachineActor(actor)) {
    const job = await requireMachineLeaseForBatch(request, env, actor.machine_id, asset.batch_uid)
    if (job instanceof Response) return job
    if (!isAssetAllowedForMachineJob(job, { assetUid: asset.asset_uid, batchUid: asset.batch_uid, styleId: asset.style_id, kind: asset.kind, access: 'download' })) {
      return forbidden('Machine lease does not include this asset download')
    }
  }
  const object = await env.ASSETS.get(asset.object_key)
  if (!object) return json({ error: 'Asset object not found' }, { status: 404 })
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType || 'application/octet-stream',
      'content-disposition': `attachment; filename="${asset.filename.replace(/"/g, '')}"`,
      'cross-origin-resource-policy': 'same-origin',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'; sandbox",
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

async function requireMachineOrUserPermission(request: Request, env: Env, permission: Permission): Promise<unknown | Response> {
  if (hasBearerToken(request)) return requireActiveMachine(request, env)
  return requirePermission(request, env, permission)
}

function hasBearerToken(request: Request): boolean {
  return /^Bearer\s+\S+/i.test(request.headers.get('authorization') || '')
}

function isRejectedCrossSiteCookieDownload(request: Request): boolean {
  if (!request.headers.get('cookie')) return false
  return (request.headers.get('sec-fetch-site') || '').toLowerCase() === 'cross-site'
}

async function requireMachineLeaseForBatch(request: Request, env: Env, machineId: string, batchUid: string, body?: { job_uid?: unknown; jobUid?: unknown; lease_id?: unknown; leaseId?: unknown }): Promise<DispatchJobRow | Response> {
  const { jobUid, leaseId } = leaseFields(request, body)
  if (!jobUid || !leaseId) return badRequest('machine asset access requires job_uid and lease_id')
  const job = await env.DB.prepare(
    `SELECT job_uid, batch_uid, job_type, status, assigned_machine_id, lease_id, lease_expires_at, payload_json
     FROM dispatch_jobs
     WHERE job_uid = ?
     LIMIT 1`,
  )
    .bind(jobUid)
    .first<DispatchJobRow>()
  if (!job) return forbidden('Machine lease was not found')
  if (job.batch_uid !== batchUid || job.assigned_machine_id !== machineId || job.lease_id !== leaseId) return forbidden('Machine lease does not match this batch')
  if (!['leased', 'running', 'uploading_results'].includes(job.status)) return forbidden('Machine lease is not active')
  if (!job.lease_expires_at || job.lease_expires_at <= nowIso()) return forbidden('Machine lease is expired')
  return job
}

async function requireMachineSyncUploadPlan(
  env: Env,
  machineId: string,
  asset: { assetUid: string; batchUid: string; styleId: number; kind: string; filename: string },
): Promise<true | Response> {
  const existing = await env.DB.prepare(
    `SELECT asset_uid, batch_uid, style_id, kind, status, object_key, filename, content_hash, meta_json
     FROM ai_image_assets
     WHERE asset_uid = ?
     LIMIT 1`,
  )
    .bind(asset.assetUid)
    .first<AssetRow>()
  if (!existing) return forbidden('Machine sync upload requires a planned synced asset')
  if (existing.batch_uid !== asset.batchUid || existing.style_id !== asset.styleId || existing.kind !== asset.kind || existing.filename !== asset.filename) {
    return forbidden('Machine sync upload does not match the planned asset')
  }
  return requireMachineSyncUploadObject(env, machineId, existing)
}

async function requireMachineSyncUploadObject(env: Env, machineId: string, asset: AssetRow): Promise<true | Response> {
  const batch = await env.DB.prepare('SELECT batch_uid, status, source_machine_id FROM ai_image_batches WHERE batch_uid = ? LIMIT 1')
    .bind(asset.batch_uid)
    .first<BatchRow>()
  if (!batch || batch.source_machine_id !== machineId) return forbidden('Machine cannot upload assets for this batch')
  if (!['syncing', 'pending_review'].includes(batch.status)) return forbidden('Machine sync upload is closed for this batch')
  if (asset.status !== 'planned') return forbidden('Machine sync upload requires a planned asset')
  return true
}

async function upsertImageResourceForUploadedAsset(env: Env, asset: AssetRow, actor: unknown, now: string): Promise<void> {
  if (!['source', 'reference', 'ai', 'result'].includes(asset.kind)) return
  const style = await env.DB.prepare('SELECT id, batch_uid, style_code, item_id FROM ai_image_styles WHERE id = ? AND batch_uid = ? LIMIT 1')
    .bind(asset.style_id, asset.batch_uid)
    .first<StyleRow>()
  const meta = fromJsonObject(asset.meta_json)
  const sourceLabel = stringValue(meta.source_label) || stringValue(meta.label) || stringValue(meta.source_path_label)
  await env.DB.prepare(
    `INSERT INTO image_resources
       (resource_uid, batch_uid, style_code, item_id, kind, asset_uid, object_key, filename, content_hash,
        source_label, created_by_machine_id, created_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(resource_uid) DO UPDATE SET
       batch_uid = excluded.batch_uid,
       style_code = excluded.style_code,
       item_id = excluded.item_id,
       kind = excluded.kind,
       asset_uid = excluded.asset_uid,
       object_key = excluded.object_key,
       filename = excluded.filename,
       content_hash = excluded.content_hash,
       source_label = excluded.source_label,
       created_by_machine_id = excluded.created_by_machine_id,
       created_by_user_id = excluded.created_by_user_id,
       updated_at = excluded.updated_at`,
  )
    .bind(
      asset.asset_uid,
      asset.batch_uid,
      style?.style_code || '',
      style?.item_id || '',
      asset.kind,
      asset.asset_uid,
      asset.object_key,
      asset.filename,
      asset.content_hash,
      sourceLabel,
      isMachineActor(actor) ? actor.machine_id : null,
      userIdForActor(actor),
      now,
      now,
    )
    .run()
}

function leaseFields(request: Request, body?: { job_uid?: unknown; jobUid?: unknown; lease_id?: unknown; leaseId?: unknown } | null): { jobUid: string; leaseId: string } {
  const url = new URL(request.url)
  return {
    jobUid: stringValue(body?.job_uid) || stringValue(body?.jobUid) || url.searchParams.get('job_uid') || url.searchParams.get('jobUid') || '',
    leaseId: stringValue(body?.lease_id) || stringValue(body?.leaseId) || url.searchParams.get('lease_id') || url.searchParams.get('leaseId') || '',
  }
}

function isMachineActor(actor: unknown): actor is { machine_id: string } {
  return Boolean(actor && typeof actor === 'object' && typeof (actor as { machine_id?: unknown }).machine_id === 'string')
}

function isMaterialTestResultUpload(asset: { batchUid: string; kind: string }): boolean {
  return asset.batchUid === 'material-test' && asset.kind === 'result'
}

function userIdForActor(actor: unknown): number | null {
  if (!actor || typeof actor !== 'object') return null
  const user = (actor as { user?: { id?: unknown } }).user
  return typeof user?.id === 'number' ? user.id : null
}

function isAssetAllowedForMachineJob(job: DispatchJobRow, asset: { assetUid: string; batchUid: string; styleId: number; kind: string; access: 'download' | 'upload' }): boolean {
  const payload = fromJsonObject(job.payload_json)
  if (job.job_type === 'regenerate_ai_image') {
    if (stringValue(payload.batch_uid) !== asset.batchUid || Number(payload.style_id) !== asset.styleId) return false
    if (asset.access === 'download') return stringArray(payload.reference_asset_uids).includes(asset.assetUid)
    return asset.kind === 'ai' && stringValue(payload.asset_uid) === asset.assetUid
  }
  if (job.job_type === 'generate_ai_image') {
    if (stringValue(payload.batch_uid) !== asset.batchUid || Number(payload.style_id) !== asset.styleId) return false
    if (asset.access === 'download') {
      return stringValue(payload.source_asset_uid) === asset.assetUid || stringArray(payload.reference_asset_uids).includes(asset.assetUid)
    }
    return asset.kind === 'ai' && stringArray(payload.result_asset_uids).includes(asset.assetUid)
  }
  if (job.job_type === 'submit_tmall_material_test') {
    const submitPlan = payload.submit_plan && typeof payload.submit_plan === 'object' && !Array.isArray(payload.submit_plan) ? payload.submit_plan as Record<string, unknown> : {}
    if (stringValue(submitPlan.batch_uid) !== asset.batchUid) return false
    const assets = Array.isArray(submitPlan.assets) ? submitPlan.assets : []
    const allowed = assets.some((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
      const row = entry as Record<string, unknown>
      return stringValue(row.asset_uid) === asset.assetUid && Number(row.style_id) === asset.styleId
    })
    return asset.access === 'download' && allowed
  }
  if (job.job_type === 'crawl_tmall_material_test_data') {
    return asset.access === 'upload' && asset.batchUid === 'material-test' && asset.kind === 'result'
  }
  return false
}

function uploadUrlForObjectKey(objectKey: string, lease: { jobUid: string; leaseId: string } | null): string {
  const base = `/api/assets/upload/${encodeURIComponent(objectKey)}`
  if (!lease) return base
  return `${base}?job_uid=${encodeURIComponent(lease.jobUid)}&lease_id=${encodeURIComponent(lease.leaseId)}`
}

function objectKeyFromUploadPath(request: Request): string {
  const prefix = '/api/assets/upload/'
  const pathname = new URL(request.url).pathname
  if (!pathname.startsWith(prefix)) return ''
  try {
    return decodeURIComponent(pathname.slice(prefix.length))
  } catch {
    return ''
  }
}

function isValidUploadObjectKey(objectKey: string): boolean {
  if (!objectKey || !objectKey.startsWith('batches/')) return false
  const parts = objectKey.split('/')
  if (parts.length < 4) return false
  return parts.every((part) => Boolean(part) && part !== '.' && part !== '..')
}

export async function upsertAsset(env: Env, asset: {
  assetUid: string
  batchUid: string
  styleId: number
  kind: string
  status: string
  objectKey: string
  filename: string
  contentHash: string
  promptTemplateVersionId: number | null
  promptText: string
  parentAssetUid: string | null
  generationJobId: string | null
  meta: Record<string, unknown>
  statusPolicy?: 'replace' | 'preserve-existing'
  now: string
}): Promise<void> {
  const existing = await env.DB.prepare(
    `SELECT asset_uid, batch_uid, style_id, kind, status, object_key, filename, content_hash, meta_json
     FROM ai_image_assets
     WHERE asset_uid = ?
     LIMIT 1`,
  )
    .bind(asset.assetUid)
    .first<AssetRow>()
  if (existing && (
    existing.batch_uid !== asset.batchUid
    || existing.style_id !== asset.styleId
    || existing.kind !== asset.kind
    || existing.object_key !== asset.objectKey
  )) {
    throw new AssetUidConflictError()
  }
  const nextStatus = existing && asset.statusPolicy === 'preserve-existing' ? existing.status : asset.status
  const result = await env.DB.prepare(
    `INSERT INTO ai_image_assets
       (asset_uid, batch_uid, style_id, kind, status, object_key, filename, content_hash,
        prompt_template_version_id, prompt_text, parent_asset_uid, generation_job_id, meta_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(asset_uid) DO UPDATE SET
       batch_uid = excluded.batch_uid,
       style_id = excluded.style_id,
       kind = excluded.kind,
       status = excluded.status,
       object_key = excluded.object_key,
       filename = excluded.filename,
       content_hash = excluded.content_hash,
       prompt_template_version_id = excluded.prompt_template_version_id,
       prompt_text = excluded.prompt_text,
       parent_asset_uid = excluded.parent_asset_uid,
       generation_job_id = excluded.generation_job_id,
       meta_json = excluded.meta_json,
       updated_at = excluded.updated_at
     WHERE ai_image_assets.batch_uid = excluded.batch_uid
       AND ai_image_assets.style_id = excluded.style_id
       AND ai_image_assets.kind = excluded.kind
       AND ai_image_assets.object_key = excluded.object_key`,
  )
    .bind(
      asset.assetUid,
      asset.batchUid,
      asset.styleId,
      asset.kind,
      nextStatus,
      asset.objectKey,
      asset.filename,
      asset.contentHash,
      asset.promptTemplateVersionId,
      asset.promptText,
      asset.parentAssetUid,
      asset.generationJobId,
      toJson(asset.meta),
      asset.now,
      asset.now,
    )
    .run()
  if (Number(result.meta.changes ?? 0) === 0) throw new AssetUidConflictError()
}

export function assetUidConflictResponse(error: unknown): Response | null {
  if (error instanceof AssetUidConflictError) return json({ error: error.message }, { status: 409 })
  return null
}

export function sanitizedMeta(body: { meta?: unknown; source_path?: unknown; source_path_label?: unknown }): Record<string, unknown> {
  const source = body.meta && typeof body.meta === 'object' && !Array.isArray(body.meta) ? body.meta as Record<string, unknown> : {}
  const meta: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    const sanitized = sanitizeMetaValue(key, value)
    if (sanitized !== undefined) meta[key] = sanitized
  }
  const labelSource = sourcePathLabel(stringValue(body.source_path_label))
    || sourcePathLabel(stringValue(source.source_path_label))
    || sourcePathLabel(stringValue(body.source_path) || stringValue(source.source_path))
  if (labelSource) meta.source_path_label = labelSource
  return meta
}

function sanitizeMetaValue(key: string, value: unknown): unknown {
  if (isRawPathKey(key) || isObjectKeyMetadataKey(key)) return undefined
  if (typeof value === 'string') return containsLocalAbsolutePath(value) ? undefined : value
  if (Array.isArray(value)) {
    const sanitized = value
      .map((entry) => sanitizeMetaValue('', entry))
      .filter((entry) => entry !== undefined)
    return sanitized
  }
  if (value && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      const child = sanitizeMetaValue(childKey, childValue)
      if (child !== undefined) sanitized[childKey] = child
    }
    return sanitized
  }
  return value
}

function isRawPathKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return normalized === 'sourcepath'
    || normalized === 'localpath'
    || normalized === 'absolutepath'
    || normalized === 'originalpath'
    || normalized === 'filesystempath'
    || normalized === 'fullpath'
}

function isObjectKeyMetadataKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return normalized === 'objectkey'
    || normalized.endsWith('objectkey')
    || normalized === 'storagekey'
}

function sourcePathLabel(value: string): string {
  if (!value) return ''
  if (containsLocalAbsolutePath(value) || value.includes('/') || value.includes('\\')) return safeFilename(value)
  return value
}

function containsLocalAbsolutePath(value: string): boolean {
  if (isSafeCloudReference(value)) return false
  return /(^|[\s"'([{])(?:\/(?!\/)[^\s"'()[\]{}<>]+|[a-zA-Z]:[\\/][^\s"'()[\]{}<>]+|\\\\[^\s"'()[\]{}<>\\]+[\\/][^\s"'()[\]{}<>]+)/.test(value)
}

function isSafeCloudReference(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    || /^batches\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(value)
}

function hasAllowedSuffix(filename: string): boolean {
  const safe = safeFilename(filename).toLowerCase()
  return [...ALLOWED_EXTENSIONS].some((extension) => safe.endsWith(extension))
}

function safePathSegment(value: string): string {
  const safe = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return safe || 'unknown'
}

function safeFilename(value: string): string {
  const base = value.split(/[\\/]/).filter(Boolean).at(-1) || 'asset'
  return base.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'asset'
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()) : []
}

function isSafeIdentifier(value: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(value)
}

function nullableString(value: unknown): string | null {
  const string = stringValue(value)
  return string || null
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}
