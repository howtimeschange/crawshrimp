import { nowIso, toJson } from './db'
import type { Env } from './env'
import { badRequest, json } from './http'

const ALLOWED_KINDS = new Set(['source', 'reference', 'ai', 'table', 'log', 'result'])
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.csv', '.xlsx', '.xls', '.json', '.txt', '.log'])

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
}

interface AssetRow {
  asset_uid: string
  object_key: string
  filename: string
  meta_json: string
}

export function batchObjectKey(batchUid: string, kind: string, filename: string): string {
  return `batches/${safePathSegment(batchUid)}/${safePathSegment(kind)}/${safeFilename(filename)}`
}

export async function createAssetUploadPlan(request: Request, env: Env): Promise<Response> {
  const body = await requestJson(request) as AssetUploadBody
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

  const objectKey = batchObjectKey(batchUid, kind, `${safePathSegment(assetUid)}-${safeFilename(filename)}`)
  if (!objectKey.startsWith(`batches/${safePathSegment(batchUid)}/`) || objectKey.includes('..')) {
    return badRequest('invalid object key')
  }
  const now = nowIso()
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
  return json({
    asset_uid: assetUid,
    object_key: objectKey,
    upload_url: `/api/assets/upload/${encodeURIComponent(objectKey)}`,
    method: 'PUT',
    headers: {},
  })
}

export async function getAssetDownload(request: Request, env: Env): Promise<Response> {
  const assetUid = new URL(request.url).pathname.match(/^\/api\/assets\/([^/]+)\/download$/)?.[1] || ''
  if (!assetUid) return badRequest('asset_uid is required')
  const asset = await env.DB.prepare('SELECT asset_uid, object_key, filename, meta_json FROM ai_image_assets WHERE asset_uid = ? LIMIT 1')
    .bind(decodeURIComponent(assetUid))
    .first<AssetRow>()
  if (!asset) return json({ error: 'Not found' }, { status: 404 })
  const object = await env.ASSETS.get(asset.object_key)
  if (!object) return json({ error: 'Asset object not found' }, { status: 404 })
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType || 'application/octet-stream',
      'content-disposition': `attachment; filename="${asset.filename.replace(/"/g, '')}"`,
    },
  })
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
  now: string
}): Promise<void> {
  await env.DB.prepare(
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
       updated_at = excluded.updated_at`,
  )
    .bind(
      asset.assetUid,
      asset.batchUid,
      asset.styleId,
      asset.kind,
      asset.status,
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
  if (isRawPathKey(key)) return undefined
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

function sourcePathLabel(value: string): string {
  if (!value) return ''
  if (containsLocalAbsolutePath(value) || value.includes('/') || value.includes('\\')) return safeFilename(value)
  return value
}

function containsLocalAbsolutePath(value: string): boolean {
  return /(^|[\s"'([{])(?:\/(?:Users|home|Volumes|private|tmp|var)\/[^\s"'()[\]{}<>]+|[a-zA-Z]:[\\/][^\s"'()[\]{}<>]+|\\\\[^\s"'()[\]{}<>\\]+[\\/][^\s"'()[\]{}<>]+)/.test(value)
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

async function requestJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return {}
  }
}
