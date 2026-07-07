import { recordAudit } from './audit'
import { fromJsonObject, nowIso, toJson } from './db'
import type { Env } from './env'
import { badRequest, forbidden, json, readJsonObject } from './http'
import { requirePermission, type CurrentUser } from './auth-routes'
import { requireActiveMachine, type MachineRow } from './machine-routes'
import { batchObjectKey, sanitizedMeta, upsertAsset } from './asset-routes'

interface BatchRow {
  id: number
  batch_uid: string
  local_instance_uid: string
  local_run_id: string
  title: string
  status: string
  prompt_library_id: number | null
  prompt_version_set_json: string
  source_machine_id: string | null
  created_by: number | null
  created_at: string
  updated_at: string
}

interface StyleRow {
  id: number
  batch_uid: string
  style_code: string
  item_id: string
  skc_code: string
  category: string
  gender: string
  status: string
  missing_prompt_reason: string
  source_summary_json: string
  review_summary_json: string
  submit_summary_json: string
}

interface AssetRow {
  id: number
  asset_uid: string
  batch_uid: string
  style_id: number
  kind: string
  status: string
  object_key: string
  filename: string
  content_hash: string
  prompt_template_version_id: number | null
  prompt_text: string
  parent_asset_uid: string | null
  generation_job_id: string | null
  meta_json: string
  created_at: string
  updated_at: string
}

const ALLOWED_KINDS = new Set(['source', 'reference', 'ai', 'table', 'log', 'result'])

export async function syncBatch(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request)
  const actor = await syncActor(request, env, body)
  if (actor instanceof Response) return actor

  const batchUid = stringValue(body.batch_uid)
  const title = stringValue(body.title)
  if (!batchUid || !title) return badRequest('batch_uid and title are required')
  if (!isSafeIdentifier(batchUid)) return badRequest('batch_uid must be a safe identifier')
  const styles = Array.isArray(body.styles) ? body.styles.filter((style): style is Record<string, unknown> => style && typeof style === 'object' && !Array.isArray(style)) : []
  const existing = await env.DB.prepare('SELECT * FROM ai_image_batches WHERE batch_uid = ? LIMIT 1').bind(batchUid).first<BatchRow>()
  const now = nowIso()
  await env.DB.prepare(
    `INSERT INTO ai_image_batches
       (batch_uid, local_instance_uid, local_run_id, title, status, prompt_library_id, prompt_version_set_json, source_machine_id, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(batch_uid) DO UPDATE SET
       local_instance_uid = excluded.local_instance_uid,
       local_run_id = excluded.local_run_id,
       title = excluded.title,
       prompt_library_id = excluded.prompt_library_id,
       prompt_version_set_json = excluded.prompt_version_set_json,
       source_machine_id = excluded.source_machine_id,
       created_by = excluded.created_by,
       updated_at = excluded.updated_at`,
  )
    .bind(
      batchUid,
      stringValue(body.local_instance_uid),
      stringValue(body.local_run_id),
      title,
      existing?.status || 'syncing',
      numberOrNull(body.prompt_library_id),
      toJson(body.prompt_version_set ?? []),
      actor.sourceMachineId,
      actor.createdBy,
      now,
      now,
    )
    .run()

  for (const style of styles) {
    const styleId = await upsertStyle(env, batchUid, style, now)
    const assets = Array.isArray(style.assets) ? style.assets.filter((asset): asset is Record<string, unknown> => asset && typeof asset === 'object' && !Array.isArray(asset)) : []
    for (const asset of assets) {
      await upsertSyncedAsset(env, batchUid, styleId, asset, now)
    }
  }

  await recordAudit(env, auditActor(actor), 'batches.sync', 'ai_image_batch', batchUid, { style_count: styles.length }, request)
  const batch = await env.DB.prepare('SELECT * FROM ai_image_batches WHERE batch_uid = ? LIMIT 1').bind(batchUid).first<BatchRow>()
  return json({ batch }, { status: existing ? 200 : 201 })
}

export async function syncBatchComplete(request: Request, env: Env): Promise<Response> {
  const actor = await requireActiveMachine(request, env)
  if (actor instanceof Response) return actor
  const batchUid = batchUidFromCompletePath(request)
  if (!batchUid) return badRequest('batch_uid is required')
  const batch = await env.DB.prepare('SELECT * FROM ai_image_batches WHERE batch_uid = ? LIMIT 1').bind(batchUid).first<BatchRow>()
  if (!batch) return json({ error: 'Not found' }, { status: 404 })
  if (batch.status !== 'syncing' && batch.status !== 'pending_review') {
    return json({ error: 'sync-complete requires batch status syncing or pending_review' }, { status: 409 })
  }
  const styleCount = await env.DB.prepare('SELECT COUNT(*) as count FROM ai_image_styles WHERE batch_uid = ?').bind(batchUid).first<{ count: number }>()
  const aiAssetCount = await env.DB.prepare("SELECT COUNT(*) as count FROM ai_image_assets WHERE batch_uid = ? AND kind = 'ai'").bind(batchUid).first<{ count: number }>()
  if (!styleCount?.count || !aiAssetCount?.count) return badRequest('sync-complete requires at least one style and one AI asset')
  if (batch.status === 'syncing') {
    await env.DB.prepare("UPDATE ai_image_batches SET status = 'pending_review', updated_at = ? WHERE batch_uid = ?")
      .bind(nowIso(), batchUid)
      .run()
  }
  await recordAudit(env, { machineId: actor.machine_id }, 'batches.sync_complete', 'ai_image_batch', batchUid, {}, request)
  return json({ ok: true, status: 'pending_review' })
}

export async function getBatch(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'batches:read')
  if (actor instanceof Response) return actor
  const batchUid = batchUidFromDetailPath(request)
  if (!batchUid) return badRequest('batch_uid is required')
  const batch = await env.DB.prepare('SELECT * FROM ai_image_batches WHERE batch_uid = ? LIMIT 1').bind(batchUid).first<BatchRow>()
  if (!batch) return json({ error: 'Not found' }, { status: 404 })
  const { results: styles } = await env.DB.prepare('SELECT * FROM ai_image_styles WHERE batch_uid = ? ORDER BY id ASC').bind(batchUid).all<StyleRow>()
  const { results: assets } = await env.DB.prepare('SELECT * FROM ai_image_assets WHERE batch_uid = ? ORDER BY id ASC').bind(batchUid).all<AssetRow>()
  return json({
    batch: {
      ...batch,
      prompt_version_set: parseArray(batch.prompt_version_set_json),
      styles: styles.map((style) => ({
        ...style,
        source_summary: fromJsonObject(style.source_summary_json),
        review_summary: fromJsonObject(style.review_summary_json),
        submit_summary: fromJsonObject(style.submit_summary_json),
        assets: assets
          .filter((asset) => asset.style_id === style.id)
          .map((asset) => ({ ...asset, meta: fromJsonObject(asset.meta_json) })),
      })),
    },
  })
}

export async function listBatches(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'batches:read')
  if (actor instanceof Response) return actor
  const { results } = await env.DB.prepare('SELECT * FROM ai_image_batches ORDER BY created_at DESC LIMIT 100').all<BatchRow>()
  return json({ batches: results.map((batch) => ({ ...batch, prompt_version_set: parseArray(batch.prompt_version_set_json) })) })
}

async function syncActor(request: Request, env: Env, body: Record<string, unknown>): Promise<{ machine?: MachineRow; user?: CurrentUser; sourceMachineId: string | null; createdBy: number | null } | Response> {
  if (request.headers.get('authorization')) {
    const machine = await requireActiveMachine(request, env)
    if (machine instanceof Response) return machine
    return { machine, sourceMachineId: machine.machine_id, createdBy: null }
  }
  const actor = await requirePermission(request, env, 'machines:write')
  if (actor instanceof Response) return actor.status === 401 ? actor : forbidden('Only admin users may create machine-origin batches')
  return { user: actor, sourceMachineId: stringValue(body.source_machine_id) || null, createdBy: actor.user.id }
}

async function upsertStyle(env: Env, batchUid: string, style: Record<string, unknown>, now: string): Promise<number> {
  const styleCode = stringValue(style.style_code)
  if (!styleCode) throw new Error('style_code is required')
  const itemId = stringValue(style.item_id)
  await env.DB.prepare(
    `INSERT INTO ai_image_styles
       (batch_uid, style_code, item_id, skc_code, category, gender, status, missing_prompt_reason, source_summary_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(batch_uid, style_code, item_id) DO UPDATE SET
       skc_code = excluded.skc_code,
       category = excluded.category,
       gender = excluded.gender,
       status = excluded.status,
       missing_prompt_reason = excluded.missing_prompt_reason,
       source_summary_json = excluded.source_summary_json`,
  )
    .bind(
      batchUid,
      styleCode,
      itemId,
      stringValue(style.skc_code),
      stringValue(style.category),
      stringValue(style.gender),
      stringValue(style.status) || 'pending_review',
      stringValue(style.missing_prompt_reason),
      toJson(style.source_summary ?? {}),
    )
    .run()
  const row = await env.DB.prepare('SELECT * FROM ai_image_styles WHERE batch_uid = ? AND style_code = ? AND item_id = ? LIMIT 1')
    .bind(batchUid, styleCode, itemId)
    .first<StyleRow>()
  if (!row) throw new Error(`style was not created: ${styleCode}`)
  return row.id
}

async function upsertSyncedAsset(env: Env, batchUid: string, styleId: number, asset: Record<string, unknown>, now: string): Promise<void> {
  const assetUid = stringValue(asset.asset_uid)
  const kind = stringValue(asset.kind)
  const filename = stringValue(asset.filename)
  if (!assetUid || !kind || !filename) throw new Error('asset_uid, kind, and filename are required')
  if (!isSafeIdentifier(assetUid)) throw new Error('asset_uid must be a safe identifier')
  if (!ALLOWED_KINDS.has(kind)) throw new Error(`invalid asset kind: ${kind}`)
  const safeAssetFilename = safeFilename(filename)
  const objectKey = batchObjectKey(batchUid, kind, `${assetUid}-${safeAssetFilename}`)
  await upsertAsset(env, {
    assetUid,
    batchUid,
    styleId,
    kind,
    status: stringValue(asset.status) || 'uploaded',
    objectKey,
    filename: safeAssetFilename,
    contentHash: stringValue(asset.content_hash),
    promptTemplateVersionId: numberOrNull(asset.prompt_template_version_id),
    promptText: stringValue(asset.prompt_text),
    parentAssetUid: nullableString(asset.parent_asset_uid),
    generationJobId: nullableString(asset.generation_job_id),
    meta: sanitizedMeta(asset),
    now,
  })
}

function auditActor(actor: { machine?: MachineRow; user?: CurrentUser }): { machineId?: string; userId?: number } {
  return actor.machine ? { machineId: actor.machine.machine_id } : { userId: actor.user?.user.id }
}

function batchUidFromDetailPath(request: Request): string {
  return decodeURIComponent(new URL(request.url).pathname.match(/^\/api\/ai-image-batches\/([^/]+)$/)?.[1] || '')
}

function batchUidFromCompletePath(request: Request): string {
  return decodeURIComponent(new URL(request.url).pathname.match(/^\/api\/ai-image-batches\/([^/]+)\/sync-complete$/)?.[1] || '')
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isSafeIdentifier(value: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(value)
}

function safeFilename(value: string): string {
  const base = value.split(/[\\/]/).filter(Boolean).at(-1) || 'asset'
  return base.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'asset'
}

function nullableString(value: unknown): string | null {
  const valueString = stringValue(value)
  return valueString || null
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function parseArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
