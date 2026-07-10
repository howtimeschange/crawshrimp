import { recordAudit } from './audit'
import { fromJsonObject, nowIso, toJson } from './db'
import type { Env } from './env'
import { badRequest, forbidden, json, readJsonObject } from './http'
import { requirePermission, type CurrentUser } from './auth-routes'
import { requireActiveMachine, type MachineRow } from './machine-routes'
import { assetUidConflictResponse, batchObjectKey, sanitizedMeta, upsertAsset } from './asset-routes'
import {
  arrayBufferToDataUrl,
  canonicalOneXmModel,
  createAndPollOneXmImageTask,
  dataUrlToBytes,
  extensionForMime,
  mimeFromDataUrl,
  settleOneXmImageTask,
} from './one-xm-image'
import { redactSensitiveJson } from './security/redact'
import { randomToken, sha256Hex } from './security/tokens'

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

interface AssetPreviewRow {
  id: number
  asset_uid: string
  batch_uid: string
  style_id: number
  kind: string
  status: string
  object_key: string
  filename: string
  content_hash: string
  parent_asset_uid: string | null
  created_at: string
  updated_at: string
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

interface BatchSubmitSignal {
  latestSubmitStatus?: string
  hasSubmittedAsset: boolean
}

interface GenerationRequestRow {
  id: number
  request_uid: string
  batch_uid: string
  style_id: number
  source_asset_uid: string
  reference_asset_uids_json: string
  prompt_template_version_id: number | null
  prompt_text: string
  status: string
  dispatch_job_uid: string
  request_meta_json?: string
  upstream_task_json?: string
  result_asset_uids_json?: string
  error_message?: string
  created_by: number | null
  created_at: string
  updated_at: string
}

interface ImageResourceRow {
  id: number
  resource_uid: string
  batch_uid: string
  style_code: string
  item_id: string
  kind: string
  asset_uid: string
  object_key: string
  filename: string
  content_hash: string
  source_label: string
  created_by_machine_id: string | null
  created_by_user_id: number | null
  created_at: string
  updated_at: string
}

const ALLOWED_KINDS = new Set(['source', 'reference', 'ai', 'table', 'log', 'result'])
const SUBMIT_MACHINE_MAX_AGE_MS = 2 * 60 * 1000
const GENERATION_MODELS = new Set(['gpt-image-2', 'gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview'])
const GENERATION_SIZES = new Set(['1:1', '3:4', '4:3', '16:9', '9:16', '1024x1024', '1536x1024', '1024x1536', '2048x2048', '4096x4096'])
const GENERATION_QUALITIES = new Set(['auto', 'low', 'medium', 'high', 'standard', '1K', '2K', '4K'])
const GENERATION_FORMATS = new Set(['png', 'jpeg', 'jpg', 'webp'])
const SECRET_FIELD_PATTERN = /(^|[_-])(api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization)$/i
const MAX_DIRECT_GENERATION_INPUT_IMAGES = 8
const MAX_DIRECT_GENERATION_INPUT_BYTES = 10 * 1024 * 1024
const MAX_DIRECT_GENERATION_TOTAL_INPUT_BYTES = 32 * 1024 * 1024
const SUBMITTED_BATCH_STATUSES = new Set(['submitted'])

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
  if (actor.machine && existing?.source_machine_id && existing.source_machine_id !== actor.machine.machine_id) {
    return forbidden('Only the source machine can sync this batch')
  }
  if (existing) {
    const submittedGuard = submittedBatchGuard(existing)
    if (submittedGuard) return submittedGuard
  }
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

  const syncedStyles: Array<Record<string, string | number>> = []
  const incomingAssetUids = new Set<string>()
  try {
    for (const style of styles) {
      const styleId = await upsertStyle(env, batchUid, style, now)
      syncedStyles.push(syncedStyleResponse(style, styleId))
      const assets = Array.isArray(style.assets) ? style.assets.filter((asset): asset is Record<string, unknown> => asset && typeof asset === 'object' && !Array.isArray(asset)) : []
      for (const asset of assets) {
        const assetUid = stringValue(asset.asset_uid)
        if (assetUid) incomingAssetUids.add(assetUid)
        await upsertSyncedAsset(env, batchUid, styleId, asset, now)
      }
    }
    await deleteStalePlannedSyncedAssets(env, batchUid, incomingAssetUids)
  } catch (error) {
    const response = assetUidConflictResponse(error)
    if (response) return response
    throw error
  }

  await recordAudit(env, auditActor(actor), 'batches.sync', 'ai_image_batch', batchUid, { style_count: styles.length }, request)
  if (existing) await recomputeReviewState(env, batchUid)
  const batch = await env.DB.prepare('SELECT * FROM ai_image_batches WHERE batch_uid = ? LIMIT 1').bind(batchUid).first<BatchRow>()
  return json({ batch, styles: syncedStyles }, { status: existing ? 200 : 201 })
}

export async function syncBatchComplete(request: Request, env: Env): Promise<Response> {
  const actor = await requireActiveMachine(request, env)
  if (actor instanceof Response) return actor
  const batchUid = batchUidFromCompletePath(request)
  if (!batchUid) return badRequest('batch_uid is required')
  const batch = await env.DB.prepare('SELECT * FROM ai_image_batches WHERE batch_uid = ? LIMIT 1').bind(batchUid).first<BatchRow>()
  if (!batch) return json({ error: 'Not found' }, { status: 404 })
  if (batch.source_machine_id !== actor.machine_id) return forbidden('Only the source machine can complete sync for this batch')
  if (batch.status !== 'syncing' && batch.status !== 'pending_review') {
    return json({ error: 'sync-complete requires batch status syncing or pending_review' }, { status: 409 })
  }
  const styleCount = await env.DB.prepare('SELECT COUNT(*) as count FROM ai_image_styles WHERE batch_uid = ?').bind(batchUid).first<{ count: number }>()
  const aiAssetCount = await env.DB.prepare("SELECT COUNT(*) as count FROM ai_image_assets WHERE batch_uid = ? AND kind = 'ai' AND status = 'uploaded'").bind(batchUid).first<{ count: number }>()
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
  const { results: jobs } = await env.DB.prepare('SELECT * FROM dispatch_jobs WHERE batch_uid = ? ORDER BY id DESC').bind(batchUid).all<DispatchJobRow>()
  const { results: imageResources } = await env.DB.prepare('SELECT * FROM image_resources WHERE batch_uid = ? ORDER BY id ASC').bind(batchUid).all<ImageResourceRow>()
  const { results: generationRequests } = await env.DB.prepare('SELECT * FROM ai_generation_requests WHERE batch_uid = ? ORDER BY id DESC').bind(batchUid).all<GenerationRequestRow>()
  return json({
    batch: {
      ...batch,
      prompt_version_set: parseArray(batch.prompt_version_set_json),
      jobs: jobs.map(safeJobResponse),
      image_resources: imageResources,
      generation_requests: generationRequests.map(safeGenerationRequestResponse),
      styles: styles.map((style) => ({
        ...style,
        source_summary: fromJsonObject(style.source_summary_json),
        review_summary: fromJsonObject(style.review_summary_json),
        submit_summary: fromJsonObject(style.submit_summary_json),
        image_resources: imageResources.filter((resource) => resource.style_code === style.style_code && resource.item_id === style.item_id),
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
  const batchUids = results.map((batch) => batch.batch_uid)
  const submitSignals = await loadBatchSubmitSignals(env, batchUids)
  const previews = await loadBatchPreviews(env, batchUids)
  return json({
    batches: results.map((batch) => ({
      ...batch,
      status: derivedBatchListStatus(batch, submitSignals.get(batch.batch_uid)),
      prompt_version_set: parseArray(batch.prompt_version_set_json),
      previews: previewsForBatch(previews, batch.batch_uid),
    })),
  })
}

export async function saveAssetDecision(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'batches:review')
  if (actor instanceof Response) return actor
  const batchUid = batchUidFromAssetDecisionPath(request)
  const assetUid = assetUidFromDecisionPath(request)
  if (!batchUid || !assetUid) return badRequest('batch_uid and asset_uid are required')
  const body = await readJsonObject(request)
  const decision = stringValue(body.decision)
  if (!['approved', 'rejected', 'pending'].includes(decision)) return badRequest('decision must be approved, rejected, or pending')
  const batch = await loadBatch(env, batchUid)
  if (!batch) return json({ error: 'Not found' }, { status: 404 })
  const submittedGuard = submittedBatchGuard(batch)
  if (submittedGuard) return submittedGuard
  const asset = await env.DB.prepare('SELECT * FROM ai_image_assets WHERE asset_uid = ? LIMIT 1').bind(assetUid).first<AssetRow>()
  if (!asset || asset.batch_uid !== batchUid || asset.kind !== 'ai') return json({ error: 'Not found' }, { status: 404 })
  if (asset.status === 'submitted') return json({ error: 'submitted AI assets cannot be reviewed again' }, { status: 409 })
  if (await hasActiveSubmitJob(env, batchUid)) return json({ error: 'review decisions are locked while a submit job is active' }, { status: 409 })
  const now = nowIso()
  await env.DB.prepare("UPDATE ai_image_assets SET status = ?, updated_at = ? WHERE asset_uid = ? AND batch_uid = ? AND kind = 'ai'")
    .bind(decision, now, assetUid, batchUid)
    .run()
  await appendApprovalEvent(env, batchUid, asset.style_id, assetUid, `asset.${decision}`, actor.user.id, { decision, note: stringValue(body.note), prompt_template_version_id: asset.prompt_template_version_id, prompt_text: asset.prompt_text }, now)
  const state = await recomputeReviewState(env, batchUid)
  await recordAudit(env, { userId: actor.user.id }, 'batches.asset_decision.save', 'ai_image_asset', assetUid, { batch_uid: batchUid, decision }, request)
  return json({ ok: true, decision, batch_status: state.batchStatus })
}

export async function createManualStyleAsset(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'batches:review')
  if (actor instanceof Response) return actor
  const batchUid = batchUidFromManualAssetPath(request)
  const body = await readJsonObject(request)
  const styleId = Number(body.style_id)
  const assetUid = stringValue(body.asset_uid)
  const filename = stringValue(body.filename)
  const kind = stringValue(body.kind) || 'ai'
  if (!batchUid || !Number.isInteger(styleId) || styleId <= 0 || !assetUid || !filename) return badRequest('batch_uid, style_id, asset_uid, and filename are required')
  if (!isSafeIdentifier(assetUid)) return badRequest('asset_uid must be a safe identifier')
  if (!ALLOWED_KINDS.has(kind) || !['source', 'reference', 'ai'].includes(kind)) return badRequest('kind must be source, reference, or ai')
  const batch = await loadBatch(env, batchUid)
  if (!batch) return json({ error: 'Not found' }, { status: 404 })
  const submittedGuard = submittedBatchGuard(batch)
  if (submittedGuard) return submittedGuard
  const style = await env.DB.prepare('SELECT * FROM ai_image_styles WHERE id = ? AND batch_uid = ? LIMIT 1').bind(styleId, batchUid).first<StyleRow>()
  if (!style) return badRequest('style_id is not in batch')
  const safeAssetFilename = safeFilename(filename)
  const now = nowIso()
  try {
    await upsertAsset(env, {
      assetUid,
      batchUid,
      styleId,
      kind,
      status: 'planned',
      objectKey: batchObjectKey(batchUid, kind, `${assetUid}-${safeAssetFilename}`),
      filename: safeAssetFilename,
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
  await appendApprovalEvent(env, batchUid, styleId, assetUid, 'asset.manual_create', actor.user.id, { kind, prompt_template_version_id: numberOrNull(body.prompt_template_version_id), prompt_text: stringValue(body.prompt_text) }, now)
  await recomputeReviewState(env, batchUid)
  await recordAudit(env, { userId: actor.user.id }, 'batches.asset.manual_create', 'ai_image_asset', assetUid, { batch_uid: batchUid }, request)
  const objectKey = batchObjectKey(batchUid, kind, `${assetUid}-${safeAssetFilename}`)
  return json({
    ok: true,
    asset_uid: assetUid,
    object_key: objectKey,
    upload_url: `/api/assets/upload/${encodeURIComponent(objectKey)}`,
    method: 'PUT',
    headers: {},
  }, { status: 201 })
}

export async function createRegenerationJobs(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'jobs:regenerate')
  if (actor instanceof Response) return actor
  const batchUid = batchUidFromRegeneratePath(request)
  const body = await readJsonObject(request)
  const selected = stringArray(body.asset_uids ?? body.assetUids)
  const promptOverrides = promptOverrideMap(body.prompt_overrides ?? body.promptOverrides)
  const requestNonce = stringValue(body.request_nonce ?? body.requestNonce)
  if (!batchUid || selected.length === 0) return badRequest('batch_uid and asset_uids are required')
  return createRegenerationJobsForAssets(request, env, actor, batchUid, selected, promptOverrides, requestNonce)
}

export async function createRejectedRegenerationJobs(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'jobs:regenerate')
  if (actor instanceof Response) return actor
  const batchUid = batchUidFromRegenerateRejectedPath(request)
  const body = await readJsonObject(request)
  const promptOverrides = promptOverrideMap(body.prompt_overrides ?? body.promptOverrides)
  const requestNonce = stringValue(body.request_nonce ?? body.requestNonce)
  if (!batchUid) return badRequest('batch_uid is required')
  const batch = await loadBatch(env, batchUid)
  if (!batch) return json({ error: 'Not found' }, { status: 404 })
  const submittedGuard = submittedBatchGuard(batch)
  if (submittedGuard) return submittedGuard
  const { results: assets } = await env.DB.prepare('SELECT * FROM ai_image_assets WHERE batch_uid = ? ORDER BY id ASC').bind(batchUid).all<AssetRow>()
  const rejectedAssetUids = assets.filter((asset) => asset.kind === 'ai' && asset.status === 'rejected').map((asset) => asset.asset_uid)
  if (rejectedAssetUids.length === 0) return json({ jobs: [] })
  return createRegenerationJobsForAssets(request, env, actor, batchUid, rejectedAssetUids, promptOverrides, requestNonce)
}

async function createRegenerationJobsForAssets(
  request: Request,
  env: Env,
  actor: CurrentUser,
  batchUid: string,
  selected: string[],
  promptOverrides: Map<string, string>,
  requestNonce: string,
): Promise<Response> {
  const batch = await loadBatch(env, batchUid)
  if (!batch) return json({ error: 'Not found' }, { status: 404 })
  const submittedGuard = submittedBatchGuard(batch)
  if (submittedGuard) return submittedGuard
  const { results: assets } = await env.DB.prepare('SELECT * FROM ai_image_assets WHERE batch_uid = ? ORDER BY id ASC').bind(batchUid).all<AssetRow>()
  const jobs: DispatchJobRow[] = []
  let created = false
  for (const assetUid of selected) {
    const asset = assets.find((row) => row.asset_uid === assetUid && row.kind === 'ai')
    if (!asset) return badRequest(`asset is not in batch: ${assetUid}`)
    if (asset.status !== 'rejected') return json({ error: 'regeneration requires selected rejected assets' }, { status: 409 })
    const promptText = promptOverrides.get(asset.asset_uid) || asset.prompt_text
    const promptHash = await sha256Hex(promptText)
    const referenceAssetUids = assets
      .filter((row) => row.style_id === asset.style_id && ['source', 'reference'].includes(row.kind) && row.status === 'uploaded')
      .map((row) => row.asset_uid)
    const resultAssetUid = `regen-${randomToken('job').replace(/^job-/, '')}`
    const payload = {
      batch_uid: batchUid,
      style_id: asset.style_id,
      asset_uid: resultAssetUid,
      rejected_asset_uid: asset.asset_uid,
      prompt_text: promptText,
      original_prompt_text: asset.prompt_text,
      reference_asset_uids: referenceAssetUids,
      parent_asset_uid: asset.asset_uid,
      request_nonce: requestNonce,
    }
    const baseIdempotencyKey = `regenerate_ai_image:${batchUid}:${assetUid}:${promptHash}`
    const idempotencyKey = requestNonce ? `${baseIdempotencyKey}:${requestNonce}` : baseIdempotencyKey
    const existing = await findDispatchJob(env, 'regenerate_ai_image', idempotencyKey)
    const requeueExisting = shouldRequeueExistingJob(existing)
    const jobSpec = {
      batchUid,
      jobType: 'regenerate_ai_image',
      requestedBy: actor.user.id,
      assignedMachineId: null,
      requiredCapabilities: ['regenerate_ai_image'],
      priority: 50,
      maxAttempts: 1,
      idempotencyKey,
      payload,
    }
    const job = existing
      ? requeueExisting
        ? await requeueDispatchJob(env, existing, jobSpec)
        : existing
      : await insertDispatchJob(env, jobSpec)
    jobs.push(job)
    if (!existing || requeueExisting) created = true
  }
  await recordAudit(env, { userId: actor.user.id }, 'jobs.regenerate_ai_image.create', 'ai_image_batch', batchUid, { asset_uids: selected }, request)
  return json({ jobs }, { status: created ? 201 : 200 })
}

export async function createGenerationJob(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'jobs:generate')
  if (actor instanceof Response) return actor
  const batchUid = batchUidFromGeneratePath(request)
  const body = await readJsonObject(request)
  if (containsSecretishInput(body)) return badRequest('generation request must not include secrets or data URLs')
  const styleId = Number(body.style_id ?? body.styleId)
  const sourceAssetUid = stringValue(body.source_asset_uid ?? body.sourceAssetUid)
  const referenceAssetUids = stringArray(body.reference_asset_uids ?? body.referenceAssetUids)
  const promptText = stringValue(body.prompt_text ?? body.promptText)
  const promptTemplateVersionId = numberOrNull(body.prompt_template_version_id ?? body.promptTemplateVersionId)
  const machineId = stringValue(body.machine_id ?? body.machineId)
  const requestNonce = stringValue(body.request_nonce ?? body.requestNonce)
  const model = stringValue(body.model) || 'gpt-image-2'
  const size = stringValue(body.size) || '1:1'
  const quality = stringValue(body.quality) || 'auto'
  const outputFormat = normalizeOutputFormat(stringValue(body.output_format ?? body.outputFormat) || 'png')
  const count = Number(body.count ?? 1)
  if (!batchUid || !Number.isInteger(styleId) || styleId <= 0 || !sourceAssetUid || !promptText) {
    return badRequest('batch_uid, style_id, source_asset_uid, and prompt_text are required')
  }
  if (!GENERATION_MODELS.has(model)) return badRequest('unsupported generation model')
  if (!GENERATION_SIZES.has(size)) return badRequest('unsupported generation size')
  if (!GENERATION_QUALITIES.has(quality)) return badRequest('unsupported generation quality')
  if (!GENERATION_FORMATS.has(outputFormat)) return badRequest('unsupported output_format')
  if (!Number.isInteger(count) || count < 1 || count > 8) return badRequest('count must be an integer from 1 to 8')
  const batch = await loadBatch(env, batchUid)
  if (!batch) return json({ error: 'Not found' }, { status: 404 })
  const submittedGuard = submittedBatchGuard(batch)
  if (submittedGuard) return submittedGuard
  const style = await env.DB.prepare('SELECT * FROM ai_image_styles WHERE id = ? AND batch_uid = ? LIMIT 1').bind(styleId, batchUid).first<StyleRow>()
  if (!style) return badRequest('style_id is not in batch')
  const { results: assets } = await env.DB.prepare('SELECT * FROM ai_image_assets WHERE batch_uid = ? ORDER BY id ASC').bind(batchUid).all<AssetRow>()
  const sourceAsset = assets.find((asset) => asset.asset_uid === sourceAssetUid && asset.style_id === styleId && ['source', 'reference'].includes(asset.kind) && asset.status === 'uploaded')
  if (!sourceAsset) return badRequest('source_asset_uid must be an uploaded source/reference asset in the selected style')
  const missingReference = referenceAssetUids.find((assetUid) => !assets.some((asset) => asset.asset_uid === assetUid && asset.style_id === styleId && ['source', 'reference'].includes(asset.kind) && asset.status === 'uploaded'))
  if (missingReference) return badRequest(`reference asset is not uploaded in style: ${missingReference}`)
  if (machineId) {
    const machine = await env.DB.prepare('SELECT * FROM task_machines WHERE machine_id = ? LIMIT 1').bind(machineId).first<MachineRow>()
    if (!machine || machine.auth_status !== 'active') return badRequest('selected machine must be active')
    if (!parseArray(machine.capabilities_json).includes('generate_ai_image')) return badRequest('selected machine lacks generate_ai_image capability')
  }
  const promptHash = await sha256Hex(promptText)
  const refsHash = await sha256Hex(JSON.stringify(referenceAssetUids))
  const promptTemplateVersionKey = promptTemplateVersionId ?? ''
  const settingsHash = await sha256Hex(JSON.stringify({ model, size, quality, output_format: outputFormat, count }))
  const idempotencyKey = `generate_ai_image:${batchUid}:${styleId}:${sourceAssetUid}:${promptHash}:${refsHash}:${promptTemplateVersionKey}:${settingsHash}:${machineId}:${requestNonce}`
  const existing = await findDispatchJob(env, 'generate_ai_image', idempotencyKey)
  const requeueExisting = shouldRequeueExistingJob(existing)
  const requestUid = existing ? await generationRequestUidForJob(env, existing) : randomToken('gen')
  const resultAssetUids = Array.from({ length: count }, (_, index) => `gen-result-${randomToken('job').replace(/^job-/, '')}-${index + 1}`)
  const payload = {
    request_uid: requestUid,
    batch_uid: batchUid,
    style_id: styleId,
    style_code: style.style_code,
    item_id: style.item_id,
    skc_code: style.skc_code,
    category: style.category,
    gender: style.gender,
    source_asset_uid: sourceAssetUid,
    reference_asset_uids: referenceAssetUids,
    prompt_template_version_id: promptTemplateVersionId,
    prompt_text: promptText,
    model,
    size,
    quality,
    output_format: outputFormat,
    count,
    machine_id: machineId || null,
    result_asset_uids: resultAssetUids,
    request_nonce: requestNonce,
  }
  const jobSpec = {
    batchUid,
    jobType: 'generate_ai_image',
    requestedBy: actor.user.id,
    assignedMachineId: machineId || null,
    requiredCapabilities: ['generate_ai_image'],
    priority: 50,
    maxAttempts: 1,
    idempotencyKey,
    payload,
  }
  const job = existing
    ? requeueExisting
      ? await requeueDispatchJob(env, existing, jobSpec)
      : existing
    : await insertDispatchJob(env, jobSpec)
  if (!existing) {
    await env.DB.prepare(
      `INSERT INTO ai_generation_requests
         (request_uid, batch_uid, style_id, source_asset_uid, reference_asset_uids_json,
          prompt_template_version_id, prompt_text, status, dispatch_job_uid, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(requestUid, batchUid, styleId, sourceAssetUid, toJson(referenceAssetUids), promptTemplateVersionId, promptText, 'queued', job.job_uid, actor.user.id, nowIso(), nowIso())
      .run()
  } else if (requeueExisting) {
    await env.DB.prepare('UPDATE ai_generation_requests SET status = ?, updated_at = ? WHERE dispatch_job_uid = ?')
      .bind('queued', nowIso(), job.job_uid)
      .run()
  }
  await recordAudit(env, { userId: actor.user.id }, 'jobs.generate_ai_image.create', 'ai_image_batch', batchUid, { style_id: styleId, source_asset_uid: sourceAssetUid, machine_id: machineId }, request)
  return json({ job, request_uid: requestUid }, { status: !existing || requeueExisting ? 201 : 200 })
}

export async function createDirectGeneration(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'jobs:generate')
  if (actor instanceof Response) return actor
  const batchUid = batchUidFromGenerateDirectPath(request)
  const body = await readJsonObject(request)
  if (containsSecretishInput(body)) return badRequest('generation request must not include secrets or data URLs')
  const styleId = Number(body.style_id ?? body.styleId)
  const sourceAssetUid = stringValue(body.source_asset_uid ?? body.sourceAssetUid)
  const referenceAssetUids = uniqueStrings(stringArray(body.reference_asset_uids ?? body.referenceAssetUids))
  const promptText = stringValue(body.prompt_text ?? body.promptText)
  const promptTemplateVersionId = numberOrNull(body.prompt_template_version_id ?? body.promptTemplateVersionId)
  const model = canonicalOneXmModel(stringValue(body.model) || 'gpt-image-2')
  const size = stringValue(body.size) || '1:1'
  const quality = stringValue(body.quality) || 'auto'
  const outputFormat = normalizeOutputFormat(stringValue(body.output_format ?? body.outputFormat) || 'png')
  const count = Number(body.count ?? 1)
  if (!batchUid || !Number.isInteger(styleId) || styleId <= 0 || !sourceAssetUid || !promptText) {
    return badRequest('batch_uid, style_id, source_asset_uid, and prompt_text are required')
  }
  if (!GENERATION_MODELS.has(model)) return badRequest('unsupported generation model')
  if (!GENERATION_SIZES.has(size)) return badRequest('unsupported generation size')
  if (!GENERATION_QUALITIES.has(quality)) return badRequest('unsupported generation quality')
  if (!GENERATION_FORMATS.has(outputFormat)) return badRequest('unsupported output_format')
  if (!Number.isInteger(count) || count < 1 || count > 8) return badRequest('count must be an integer from 1 to 8')
  const batch = await loadBatch(env, batchUid)
  if (!batch) return json({ error: 'Not found' }, { status: 404 })
  const submittedGuard = submittedBatchGuard(batch)
  if (submittedGuard) return submittedGuard
  const style = await env.DB.prepare('SELECT * FROM ai_image_styles WHERE id = ? AND batch_uid = ? LIMIT 1').bind(styleId, batchUid).first<StyleRow>()
  if (!style) return badRequest('style_id is not in batch')
  const { results: assets } = await env.DB.prepare('SELECT * FROM ai_image_assets WHERE batch_uid = ? ORDER BY id ASC').bind(batchUid).all<AssetRow>()
  const sourceAsset = assets.find((asset) => asset.asset_uid === sourceAssetUid && asset.style_id === styleId && ['source', 'reference'].includes(asset.kind) && asset.status === 'uploaded')
  if (!sourceAsset) return badRequest('source_asset_uid must be an uploaded source/reference asset in the selected style')
  const missingReference = referenceAssetUids.find((assetUid) => !assets.some((asset) => asset.asset_uid === assetUid && asset.style_id === styleId && ['source', 'reference'].includes(asset.kind) && asset.status === 'uploaded'))
  if (missingReference) return badRequest(`reference asset is not uploaded in style: ${missingReference}`)
  const generationAssetUids = uniqueStrings([sourceAssetUid, ...referenceAssetUids])
  if (generationAssetUids.length > MAX_DIRECT_GENERATION_INPUT_IMAGES) {
    return badRequest(`direct cloud generation supports at most ${MAX_DIRECT_GENERATION_INPUT_IMAGES} source/reference images`)
  }

  const requestUid = randomToken('gen')
  const requestMeta = {
    mode: 'direct_cloud',
    model,
    size,
    quality,
    output_format: outputFormat,
    count,
  }
  const now = nowIso()
  await insertDirectGenerationRequest(env, {
    requestUid,
    batchUid,
    styleId,
    sourceAssetUid,
    referenceAssetUids,
    promptTemplateVersionId,
    promptText,
    status: 'running',
    requestMeta,
    actorUserId: actor.user.id,
    now,
  })

  try {
    const generationAssets = generationAssetUids.map((assetUid) => assets.find((asset) => asset.asset_uid === assetUid)).filter((asset): asset is AssetRow => Boolean(asset))
    const imageDataUrls = await assetsToDataUrls(env, generationAssets)
    const result = await createAndPollOneXmImageTask(env, {
      model,
      prompt: buildDirectGenerationPrompt(promptText, generationAssets, size, quality),
      imageDataUrls,
      size,
      quality,
      outputFormat,
      count,
      idempotencyKey: requestUid,
    })
    if (result.status === 'running') {
      await updateDirectGenerationRequest(env, requestUid, 'running', result.task, [], result.error || '')
      await recordAudit(env, { userId: actor.user.id }, 'jobs.generate_ai_image.direct_pending', 'ai_generation_request', requestUid, { batch_uid: batchUid, style_id: styleId, model }, request)
      return json({ status: 'running', request_uid: requestUid, next_poll_after_ms: result.nextPollAfterMs }, { status: 202 })
    }

    const storedAssets = await completeDirectGenerationRequest(env, {
      requestUid,
      batchUid,
      style,
      sourceAssetUid,
      promptTemplateVersionId,
      promptText,
      model,
      size,
      quality,
      outputFormat,
      dataUrls: result.dataUrls.slice(0, count),
      upstreamTask: result.task,
      userId: actor.user.id,
      now: nowIso(),
    })
    await recordAudit(env, { userId: actor.user.id }, 'jobs.generate_ai_image.direct_complete', 'ai_generation_request', requestUid, { batch_uid: batchUid, style_id: styleId, asset_count: storedAssets.length, model }, request)
    return json({ status: 'completed', request_uid: requestUid, assets: storedAssets }, { status: 201 })
  } catch (error) {
    const status = error && typeof error === 'object' && typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : 502
    const message = String(error instanceof Error ? error.message : 'Cloud generation failed')
    await updateDirectGenerationRequest(env, requestUid, 'failed', {}, [], message)
    await recordAudit(env, { userId: actor.user.id }, 'jobs.generate_ai_image.direct_failed', 'ai_generation_request', requestUid, { batch_uid: batchUid, style_id: styleId, error: message }, request)
    return json({ error: message, request_uid: requestUid }, { status })
  }
}

export async function pollDirectGeneration(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'jobs:generate')
  if (actor instanceof Response) return actor
  const batchUid = batchUidFromGenerationRequestPollPath(request)
  const requestUid = generationRequestUidFromPollPath(request)
  if (!batchUid || !requestUid) return badRequest('batch_uid and request_uid are required')
  const batch = await loadBatch(env, batchUid)
  if (!batch) return json({ error: 'Not found' }, { status: 404 })
  const generationRequest = await env.DB.prepare('SELECT * FROM ai_generation_requests WHERE request_uid = ? LIMIT 1')
    .bind(requestUid)
    .first<GenerationRequestRow>()
  if (!generationRequest || generationRequest.batch_uid !== batchUid) return json({ error: 'Not found' }, { status: 404 })
  if (generationRequest.status !== 'completed') {
    const submittedGuard = submittedBatchGuard(batch)
    if (submittedGuard) return submittedGuard
  }
  if (generationRequest.dispatch_job_uid) return json({ error: 'generation request is not a direct cloud generation request' }, { status: 409 })
  if (generationRequest.status === 'completed') {
    return json({
      status: 'completed',
      request_uid: requestUid,
      assets: await directGenerationResultAssets(env, generationRequest),
    })
  }
  if (generationRequest.status === 'finalizing') {
    return json({ status: 'finalizing', request_uid: requestUid, next_poll_after_ms: 500 }, { status: 202 })
  }
  if (!['queued', 'running'].includes(generationRequest.status)) {
    return json({ error: `generation request is ${generationRequest.status}` }, { status: 409 })
  }
  const style = await env.DB.prepare('SELECT * FROM ai_image_styles WHERE id = ? AND batch_uid = ? LIMIT 1')
    .bind(generationRequest.style_id, batchUid)
    .first<StyleRow>()
  if (!style) return json({ error: 'generation request style was not found' }, { status: 409 })
  const requestMeta = fromJsonObject(generationRequest.request_meta_json)
  const model = canonicalOneXmModel(stringValue(requestMeta.model) || 'gpt-image-2')
  const size = stringValue(requestMeta.size) || '1:1'
  const quality = stringValue(requestMeta.quality) || 'auto'
  const outputFormat = normalizeOutputFormat(stringValue(requestMeta.output_format) || 'png')
  const count = normalizeGenerationCount(requestMeta.count)
  const upstreamTask = fromJsonObject(generationRequest.upstream_task_json)

  try {
    const result = await settleOneXmImageTask(env, upstreamTask, model)
    if (result.status === 'running') {
      await updateDirectGenerationRequest(env, requestUid, 'running', result.task, [], result.error || '')
      await recordAudit(env, { userId: actor.user.id }, 'jobs.generate_ai_image.direct_poll_pending', 'ai_generation_request', requestUid, { batch_uid: batchUid, style_id: generationRequest.style_id, model }, request)
      return json({ status: 'running', request_uid: requestUid, next_poll_after_ms: result.nextPollAfterMs }, { status: 202 })
    }

    const claimedFinalization = await claimDirectGenerationFinalization(env, requestUid)
    if (!claimedFinalization) {
      const current = await loadDirectGenerationRequest(env, requestUid)
      if (current?.status === 'completed') {
        return json({ status: 'completed', request_uid: requestUid, assets: await directGenerationResultAssets(env, current) })
      }
      return json({ status: current?.status || 'finalizing', request_uid: requestUid, next_poll_after_ms: 500 }, { status: 202 })
    }
    const storedAssets = await completeDirectGenerationRequest(env, {
      requestUid,
      batchUid,
      style,
      sourceAssetUid: generationRequest.source_asset_uid,
      promptTemplateVersionId: generationRequest.prompt_template_version_id,
      promptText: generationRequest.prompt_text,
      model,
      size,
      quality,
      outputFormat,
      dataUrls: result.dataUrls.slice(0, count),
      upstreamTask: result.task,
      userId: actor.user.id,
      now: nowIso(),
    })
    await recordAudit(env, { userId: actor.user.id }, 'jobs.generate_ai_image.direct_poll_complete', 'ai_generation_request', requestUid, { batch_uid: batchUid, style_id: generationRequest.style_id, asset_count: storedAssets.length, model }, request)
    return json({ status: 'completed', request_uid: requestUid, assets: storedAssets }, { status: 201 })
  } catch (error) {
    const status = error && typeof error === 'object' && typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : 502
    const message = String(error instanceof Error ? error.message : 'Cloud generation poll failed')
    await failDirectGenerationRequest(env, requestUid, upstreamTask, message)
    await recordAudit(env, { userId: actor.user.id }, 'jobs.generate_ai_image.direct_poll_failed', 'ai_generation_request', requestUid, { batch_uid: batchUid, style_id: generationRequest.style_id, error: message }, request)
    return json({ error: message, request_uid: requestUid }, { status })
  }
}

export async function exportReviewDetail(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'batches:read')
  if (actor instanceof Response) return actor
  const batchUid = batchUidFromReviewDetailPath(request)
  if (!batchUid) return badRequest('batch_uid is required')
  const batch = await loadBatch(env, batchUid)
  if (!batch) return json({ error: 'Not found' }, { status: 404 })
  const { results: styles } = await env.DB.prepare('SELECT * FROM ai_image_styles WHERE batch_uid = ? ORDER BY id ASC').bind(batchUid).all<StyleRow>()
  const { results: assets } = await env.DB.prepare('SELECT * FROM ai_image_assets WHERE batch_uid = ? ORDER BY id ASC').bind(batchUid).all<AssetRow>()
  const { results: events } = await env.DB.prepare('SELECT * FROM approval_events WHERE batch_uid = ? ORDER BY id ASC').bind(batchUid).all()
  return json({ batch, styles, assets, approval_events: events })
}

export async function listImageResources(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'batches:read')
  if (actor instanceof Response) return actor
  const batchUid = batchUidFromImageResourcesPath(request)
  if (!batchUid) return badRequest('batch_uid is required')
  const batch = await loadBatch(env, batchUid)
  if (!batch) return json({ error: 'Not found' }, { status: 404 })
  const searchParams = new URL(request.url).searchParams
  const styleCode = stringValue(searchParams.get('style_code'))
  const itemId = stringValue(searchParams.get('item_id'))
  const filters = ['batch_uid = ?']
  const values: string[] = [batchUid]
  if (styleCode) {
    filters.push('style_code = ?')
    values.push(styleCode)
  }
  if (itemId) {
    filters.push('item_id = ?')
    values.push(itemId)
  }
  const statement = env.DB.prepare(`SELECT * FROM image_resources WHERE ${filters.join(' AND ')} ORDER BY id ASC`).bind(...values)
  const { results } = await statement.all<ImageResourceRow>()
  return json({ image_resources: results })
}

export async function markBatchReady(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'batches:review')
  if (actor instanceof Response) return actor
  const batchUid = batchUidFromMarkReadyPath(request)
  if (!batchUid) return badRequest('batch_uid is required')
  const batch = await loadBatch(env, batchUid)
  if (!batch) return json({ error: 'Not found' }, { status: 404 })
  const submittedGuard = submittedBatchGuard(batch)
  if (submittedGuard) return submittedGuard
  const state = await recomputeReviewState(env, batchUid)
  if (!state.ready) return json({ error: 'every non-skipped style must have at least one approved AI asset' }, { status: 409 })
  await recordAudit(env, { userId: actor.user.id }, 'batches.ready_to_submit.mark', 'ai_image_batch', batchUid, {}, request)
  return json({ ok: true, status: state.batchStatus })
}

export async function getSubmitPlan(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'batches:read')
  if (actor instanceof Response) return actor
  const batchUid = batchUidFromSubmitPlanPath(request)
  if (!batchUid) return badRequest('batch_uid is required')
  const batch = await loadBatch(env, batchUid)
  if (!batch) return json({ error: 'Not found' }, { status: 404 })
  return json({ submit_plan: await buildSubmitPlan(env, batchUid) })
}

export async function createSubmitJob(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'jobs:submit')
  if (actor instanceof Response) return actor
  const batchUid = batchUidFromSubmitPath(request)
  const body = await readJsonObject(request)
  const machineId = stringValue(body.machine_id ?? body.machineId)
  if (!batchUid || !machineId) return badRequest('batch_uid and machine_id are required')
  const batch = await loadBatch(env, batchUid)
  if (!batch) return json({ error: 'Not found' }, { status: 404 })
  const idempotencyKey = `submit_tmall_material_test:${batchUid}`
  const existing = await findDispatchJob(env, 'submit_tmall_material_test', idempotencyKey)
  if (batch.status === 'submitted' || existing?.status === 'succeeded' || await hasSucceededSubmitJob(env, batchUid)) {
    return json({ error: 'batch has already been submitted' }, { status: 409 })
  }
  if (!existing && await hasActiveSubmitJob(env, batchUid)) {
    return json({ error: 'batch already has an active submit job', code: 'batch_submit_active' }, { status: 409 })
  }
  const reviewState = await recomputeReviewState(env, batchUid)
  if (!reviewState.ready) {
    return json({ error: 'every non-skipped style must have at least one approved AI asset before submit' }, { status: 409 })
  }
  const machine = await env.DB.prepare('SELECT * FROM task_machines WHERE machine_id = ? LIMIT 1').bind(machineId).first<MachineRow>()
  if (!machine || machine.auth_status !== 'active') return badRequest('selected machine must be active')
  if (!isFreshOnlineSubmitMachine(machine)) return json({ error: 'selected machine must be online and recently seen before submit' }, { status: 409 })
  if (!parseArray(machine.capabilities_json).includes('submit_tmall_material_test')) return badRequest('selected machine lacks submit_tmall_material_test capability')
  const submitPlan = await buildSubmitPlan(env, batchUid)
  if (submitPlan.assets.length === 0) return json({ error: 'submit plan requires at least one approved AI asset' }, { status: 409 })
  const jobSpec = {
    batchUid,
    jobType: 'submit_tmall_material_test',
    requestedBy: actor.user.id,
    assignedMachineId: machineId,
    requiredCapabilities: ['submit_tmall_material_test'],
    priority: 40,
    maxAttempts: 1,
    idempotencyKey,
    payload: { submit_plan: submitPlan },
  }
  const reusedActiveJob = Boolean(existing && activeDispatchStatuses.has(existing.status))
  const job = existing
    ? reusedActiveJob
      ? existing
      : await requeueDispatchJob(env, existing, jobSpec)
    : await insertDispatchJob(env, jobSpec)
  await recordAudit(env, { userId: actor.user.id }, 'jobs.submit_tmall_material_test.create', 'ai_image_batch', batchUid, { machine_id: machineId }, request)
  return json({ job, submit_plan: submitPlan }, { status: reusedActiveJob ? 200 : 201 })
}

export async function getSubmitResult(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'batches:read')
  if (actor instanceof Response) return actor
  const batchUid = batchUidFromSubmitResultPath(request)
  if (!batchUid) return badRequest('batch_uid is required')
  const { results: jobs } = await env.DB.prepare("SELECT * FROM dispatch_jobs WHERE batch_uid = ? AND job_type = 'submit_tmall_material_test' ORDER BY id DESC").bind(batchUid).all<DispatchJobRow>()
  return json({ jobs: jobs.map(safeJobResponse) })
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

function syncedStyleResponse(style: Record<string, unknown>, styleId: number): Record<string, string | number> {
  const response: Record<string, string | number> = {
    id: styleId,
    style_id: styleId,
    style_code: stringValue(style.style_code),
    item_id: stringValue(style.item_id),
  }
  const styleUid = safeResponseString(style.style_uid)
  if (styleUid) response.style_uid = styleUid
  return response
}

function safeResponseString(value: unknown): string {
  const text = stringValue(value)
  if (!text || text.includes('/') || text.includes('\\')) return ''
  return text
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
    status: 'planned',
    objectKey,
    filename: safeAssetFilename,
    contentHash: stringValue(asset.content_hash),
    promptTemplateVersionId: numberOrNull(asset.prompt_template_version_id),
    promptText: stringValue(asset.prompt_text),
    parentAssetUid: nullableString(asset.parent_asset_uid),
    generationJobId: nullableString(asset.generation_job_id),
    meta: sanitizedMeta(asset),
    statusPolicy: 'preserve-reviewed',
    now,
  })
}

async function deleteStalePlannedSyncedAssets(env: Env, batchUid: string, incomingAssetUids: Set<string>): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT asset_uid, batch_uid, style_id, kind, status, object_key, filename, content_hash, meta_json
     FROM ai_image_assets
     WHERE batch_uid = ? AND status = 'planned'`,
  )
    .bind(batchUid)
    .all<AssetRow>()
  const stale = (results || []).filter((asset) => !incomingAssetUids.has(asset.asset_uid))
  for (const asset of stale) {
    await env.DB.prepare("DELETE FROM ai_image_assets WHERE batch_uid = ? AND asset_uid = ? AND status = 'planned'")
      .bind(batchUid, asset.asset_uid)
      .run()
  }
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

function batchUidFromAssetDecisionPath(request: Request): string {
  return decodeURIComponent(new URL(request.url).pathname.match(/^\/api\/ai-image-batches\/([^/]+)\/assets\/[^/]+\/decision$/)?.[1] || '')
}

function assetUidFromDecisionPath(request: Request): string {
  return decodeURIComponent(new URL(request.url).pathname.match(/^\/api\/ai-image-batches\/[^/]+\/assets\/([^/]+)\/decision$/)?.[1] || '')
}

function batchUidFromManualAssetPath(request: Request): string {
  return decodeURIComponent(new URL(request.url).pathname.match(/^\/api\/ai-image-batches\/([^/]+)\/manual-assets$/)?.[1] || '')
}

function batchUidFromRegeneratePath(request: Request): string {
  return decodeURIComponent(new URL(request.url).pathname.match(/^\/api\/ai-image-batches\/([^/]+)\/regenerate$/)?.[1] || '')
}

function batchUidFromRegenerateRejectedPath(request: Request): string {
  return decodeURIComponent(new URL(request.url).pathname.match(/^\/api\/ai-image-batches\/([^/]+)\/regenerate-rejected$/)?.[1] || '')
}

function batchUidFromGeneratePath(request: Request): string {
  return decodeURIComponent(new URL(request.url).pathname.match(/^\/api\/ai-image-batches\/([^/]+)\/generate$/)?.[1] || '')
}

function batchUidFromGenerateDirectPath(request: Request): string {
  return decodeURIComponent(new URL(request.url).pathname.match(/^\/api\/ai-image-batches\/([^/]+)\/generate-direct$/)?.[1] || '')
}

function batchUidFromGenerationRequestPollPath(request: Request): string {
  return decodeURIComponent(new URL(request.url).pathname.match(/^\/api\/ai-image-batches\/([^/]+)\/generation-requests\/[^/]+\/poll$/)?.[1] || '')
}

function generationRequestUidFromPollPath(request: Request): string {
  return decodeURIComponent(new URL(request.url).pathname.match(/^\/api\/ai-image-batches\/[^/]+\/generation-requests\/([^/]+)\/poll$/)?.[1] || '')
}

function batchUidFromReviewDetailPath(request: Request): string {
  return decodeURIComponent(new URL(request.url).pathname.match(/^\/api\/ai-image-batches\/([^/]+)\/review-detail$/)?.[1] || '')
}

function batchUidFromImageResourcesPath(request: Request): string {
  return decodeURIComponent(new URL(request.url).pathname.match(/^\/api\/ai-image-batches\/([^/]+)\/image-resources$/)?.[1] || '')
}

function batchUidFromMarkReadyPath(request: Request): string {
  return decodeURIComponent(new URL(request.url).pathname.match(/^\/api\/ai-image-batches\/([^/]+)\/mark-ready$/)?.[1] || '')
}

function batchUidFromSubmitPlanPath(request: Request): string {
  return decodeURIComponent(new URL(request.url).pathname.match(/^\/api\/ai-image-batches\/([^/]+)\/submit-plan$/)?.[1] || '')
}

function batchUidFromSubmitPath(request: Request): string {
  return decodeURIComponent(new URL(request.url).pathname.match(/^\/api\/ai-image-batches\/([^/]+)\/submit$/)?.[1] || '')
}

function batchUidFromSubmitResultPath(request: Request): string {
  return decodeURIComponent(new URL(request.url).pathname.match(/^\/api\/ai-image-batches\/([^/]+)\/submit-result$/)?.[1] || '')
}

async function loadBatch(env: Env, batchUid: string): Promise<BatchRow | null> {
  return env.DB.prepare('SELECT * FROM ai_image_batches WHERE batch_uid = ? LIMIT 1').bind(batchUid).first<BatchRow>()
}

function submittedBatchGuard(batch: BatchRow): Response | null {
  if (!SUBMITTED_BATCH_STATUSES.has(batch.status)) return null
  return json({ error: 'batch has already been submitted' }, { status: 409 })
}

async function loadBatchPreviews(env: Env, batchUids: string[]): Promise<AssetPreviewRow[]> {
  if (batchUids.length === 0) return []
  const placeholders = batchUids.map(() => '?').join(', ')
  const { results } = await env.DB.prepare(
    `WITH ranked_previews AS (
       SELECT
         id,
         asset_uid,
         batch_uid,
         style_id,
         kind,
         status,
         object_key,
         filename,
         content_hash,
         parent_asset_uid,
         created_at,
         updated_at,
         ROW_NUMBER() OVER (
           PARTITION BY batch_uid, CASE WHEN kind IN ('source', 'reference') THEN 'source' ELSE 'ai' END
           ORDER BY
             CASE kind WHEN 'source' THEN 0 WHEN 'reference' THEN 1 ELSE 2 END,
             style_id ASC,
             id ASC
         ) AS preview_rank
       FROM ai_image_assets
       WHERE batch_uid IN (${placeholders})
         AND kind IN ('source', 'reference', 'ai')
         AND (
           lower(filename) LIKE '%.jpg'
           OR lower(filename) LIKE '%.jpeg'
           OR lower(filename) LIKE '%.png'
           OR lower(filename) LIKE '%.webp'
           OR lower(filename) LIKE '%.gif'
         )
     )
     SELECT
       id,
       asset_uid,
       batch_uid,
       style_id,
       kind,
       status,
       object_key,
       filename,
       content_hash,
       parent_asset_uid,
       created_at,
       updated_at
     FROM ranked_previews
     WHERE (kind IN ('source', 'reference') AND preview_rank <= 1)
        OR (kind = 'ai' AND preview_rank <= 4)
     ORDER BY batch_uid ASC, CASE kind WHEN 'source' THEN 0 WHEN 'reference' THEN 1 ELSE 2 END, style_id ASC, id ASC`,
  )
    .bind(...batchUids)
    .all<AssetPreviewRow>()
  return results
}

async function loadBatchSubmitSignals(env: Env, batchUids: string[]): Promise<Map<string, BatchSubmitSignal>> {
  const signals = new Map<string, BatchSubmitSignal>(
    batchUids.map((batchUid) => [batchUid, { hasSubmittedAsset: false }]),
  )
  if (batchUids.length === 0) return signals
  const placeholders = batchUids.map(() => '?').join(', ')
  const { results: submittedAssets } = await env.DB.prepare(
    `SELECT batch_uid
     FROM ai_image_assets
     WHERE batch_uid IN (${placeholders})
       AND kind = 'ai'
       AND status = 'submitted'
     GROUP BY batch_uid`,
  )
    .bind(...batchUids)
    .all<{ batch_uid: string }>()
  for (const row of submittedAssets) {
    const signal = signals.get(row.batch_uid)
    if (signal) signal.hasSubmittedAsset = true
  }
  const { results: jobs } = await env.DB.prepare(
    `SELECT batch_uid, status
     FROM dispatch_jobs
     WHERE batch_uid IN (${placeholders})
       AND job_type = 'submit_tmall_material_test'
     ORDER BY batch_uid ASC, id DESC`,
  )
    .bind(...batchUids)
    .all<{ batch_uid: string; status: string }>()
  for (const job of jobs) {
    const signal = signals.get(job.batch_uid)
    if (signal && !signal.latestSubmitStatus) signal.latestSubmitStatus = job.status
  }
  return signals
}

function derivedBatchListStatus(batch: BatchRow, signal?: BatchSubmitSignal): string {
  if (batch.status === 'submitted') return 'submitted'
  if (signal?.hasSubmittedAsset || signal?.latestSubmitStatus === 'succeeded') return 'submitted'
  if (signal?.latestSubmitStatus && activeDispatchStatuses.has(signal.latestSubmitStatus)) return 'submitting'
  return batch.status
}

function previewsForBatch(assets: AssetPreviewRow[], batchUid: string): AssetPreviewRow[] {
  const rows = assets.filter((asset) => asset.batch_uid === batchUid && isPreviewImage(asset.filename))
  const source = rows.find((asset) => asset.kind === 'source') ?? rows.find((asset) => asset.kind === 'reference')
  const aiRows = rows.filter((asset) => asset.kind === 'ai').slice(0, 4)
  return [...(source ? [source] : []), ...aiRows].slice(0, 5)
}

function isPreviewImage(filename: string): boolean {
  return /\.(jpe?g|png|webp|gif)$/i.test(filename)
}

async function appendApprovalEvent(env: Env, batchUid: string, styleId: number | null, assetUid: string | null, eventType: string, userId: number, payload: unknown, now: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO approval_events (batch_uid, style_id, asset_uid, event_type, actor, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(batchUid, styleId, assetUid, eventType, `user:${userId}`, toJson(payload), now)
    .run()
}

async function recomputeReviewState(env: Env, batchUid: string): Promise<{ ready: boolean; batchStatus: string }> {
  const batch = await loadBatch(env, batchUid)
  if (batch && SUBMITTED_BATCH_STATUSES.has(batch.status)) {
    return { ready: true, batchStatus: batch.status }
  }
  const { results: styles } = await env.DB.prepare('SELECT * FROM ai_image_styles WHERE batch_uid = ? ORDER BY id ASC').bind(batchUid).all<StyleRow>()
  const { results: assets } = await env.DB.prepare('SELECT * FROM ai_image_assets WHERE batch_uid = ? ORDER BY id ASC').bind(batchUid).all<AssetRow>()
  const now = nowIso()
  let ready = true
  let allSubmitted = true
  let hasReviewableStyle = false
  for (const style of styles) {
    if (style.status === 'skipped') continue
    hasReviewableStyle = true
    const styleAiAssets = assets.filter((asset) => asset.style_id === style.id && asset.kind === 'ai')
    const approved = styleAiAssets.filter((asset) => asset.status === 'approved').length
    const submitted = styleAiAssets.filter((asset) => asset.status === 'submitted').length
    const rejected = styleAiAssets.filter((asset) => asset.status === 'rejected').length
    const pending = styleAiAssets.filter((asset) => !['approved', 'rejected', 'submitted'].includes(asset.status)).length
    const status = submitted > 0 ? 'submitted' : approved > 0 ? 'approved' : rejected > 0 && pending === 0 ? 'rejected' : 'pending_review'
    if (approved + submitted === 0) ready = false
    if (submitted === 0) allSubmitted = false
    await env.DB.prepare('UPDATE ai_image_styles SET status = ?, review_summary_json = ? WHERE id = ? AND batch_uid = ?')
      .bind(status, toJson({ approved, submitted, rejected, pending }), style.id, batchUid)
      .run()
  }
  const batchStatus = ready && hasReviewableStyle ? allSubmitted ? 'submitted' : 'ready_to_submit' : 'pending_review'
  await env.DB.prepare('UPDATE ai_image_batches SET status = ?, updated_at = ? WHERE batch_uid = ?')
    .bind(batchStatus, now, batchUid)
    .run()
  return { ready: batchStatus === 'ready_to_submit' || batchStatus === 'submitted', batchStatus }
}

async function buildSubmitPlan(env: Env, batchUid: string): Promise<{ batch_uid: string; styles: StyleRow[]; assets: Array<AssetRow & { meta: unknown }> }> {
  const { results: styles } = await env.DB.prepare('SELECT * FROM ai_image_styles WHERE batch_uid = ? ORDER BY id ASC').bind(batchUid).all<StyleRow>()
  const { results: assets } = await env.DB.prepare('SELECT * FROM ai_image_assets WHERE batch_uid = ? ORDER BY id ASC').bind(batchUid).all<AssetRow>()
  const approvedAiAssets = assets.filter((asset) => asset.kind === 'ai' && asset.status === 'approved')
  const styleIds = new Set(approvedAiAssets.map((asset) => asset.style_id))
  const sourceAssets = assets.filter((asset) => styleIds.has(asset.style_id) && ['source', 'reference'].includes(asset.kind) && asset.status === 'uploaded')
  return {
    batch_uid: batchUid,
    styles: styles.filter((style) => styleIds.has(style.id)),
    assets: [...sourceAssets, ...approvedAiAssets].map((asset) => ({ ...asset, meta: fromJsonObject(asset.meta_json) })),
  }
}

async function insertDispatchJob(env: Env, job: {
  batchUid: string
  jobType: string
  requestedBy: number
  assignedMachineId: string | null
  requiredCapabilities: string[]
  priority: number
  maxAttempts: number
  idempotencyKey: string
  payload: unknown
}): Promise<DispatchJobRow> {
  const now = nowIso()
  const jobUid = randomToken('job')
  await env.DB.prepare(
    `INSERT INTO dispatch_jobs
       (job_uid, batch_uid, job_type, status, requested_by, assigned_machine_id, required_capabilities_json,
        priority, max_attempts, idempotency_key, payload_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(job_type, idempotency_key) DO NOTHING`,
  )
    .bind(jobUid, job.batchUid, job.jobType, 'queued', job.requestedBy, job.assignedMachineId, toJson(job.requiredCapabilities), job.priority, job.maxAttempts, job.idempotencyKey, toJson(job.payload), now, now)
    .run()
  const row = await findDispatchJob(env, job.jobType, job.idempotencyKey)
  if (!row) throw new Error(`dispatch job was not created: ${job.jobType}`)
  return row
}

async function requeueDispatchJob(env: Env, existing: DispatchJobRow, job: {
  batchUid: string
  jobType: string
  requestedBy: number
  assignedMachineId: string | null
  requiredCapabilities: string[]
  priority: number
  maxAttempts: number
  idempotencyKey: string
  payload: unknown
}): Promise<DispatchJobRow> {
  const now = nowIso()
  await env.DB.prepare(
    `UPDATE dispatch_jobs
     SET status = ?,
         assigned_machine_id = ?,
         required_capabilities_json = ?,
         priority = ?,
         attempt_count = ?,
         max_attempts = ?,
         lease_id = NULL,
         lease_expires_at = NULL,
         payload_json = ?,
         result_json = ?,
         updated_at = ?
     WHERE job_uid = ?`,
  )
    .bind('queued', job.assignedMachineId, toJson(job.requiredCapabilities), job.priority, 0, job.maxAttempts, toJson(job.payload), toJson({}), now, existing.job_uid)
    .run()
  const row = await findDispatchJob(env, job.jobType, job.idempotencyKey)
  if (!row) throw new Error(`dispatch job was not requeued: ${job.jobType}`)
  return row
}

async function findDispatchJob(env: Env, jobType: string, idempotencyKey: string): Promise<DispatchJobRow | null> {
  return env.DB.prepare('SELECT * FROM dispatch_jobs WHERE job_type = ? AND idempotency_key = ? LIMIT 1')
    .bind(jobType, idempotencyKey)
    .first<DispatchJobRow>()
}

const activeDispatchStatuses = new Set(['queued', 'leased', 'running', 'uploading_results', 'cancel_requested'])

function shouldRequeueExistingJob(job: DispatchJobRow | null): boolean {
  return Boolean(job && !activeDispatchStatuses.has(job.status) && job.status !== 'succeeded')
}

function safeJobResponse(job: DispatchJobRow): Record<string, unknown> {
  const { payload_json: payloadJson, result_json: resultJson, ...safeJob } = job
  return {
    ...safeJob,
    payload: redactSensitiveJson(fromJsonObject(payloadJson)),
    result: redactSensitiveJson(fromJsonObject(resultJson)),
  }
}

function safeGenerationRequestResponse(row: GenerationRequestRow): Record<string, unknown> {
  return {
    ...row,
    reference_asset_uids: parseArray(row.reference_asset_uids_json),
    request_meta: redactSensitiveJson(fromJsonObject(row.request_meta_json)),
    upstream_task: redactSensitiveJson(fromJsonObject(row.upstream_task_json)),
    result_asset_uids: parseArray(row.result_asset_uids_json || '[]'),
  }
}

async function insertDirectGenerationRequest(env: Env, request: {
  requestUid: string
  batchUid: string
  styleId: number
  sourceAssetUid: string
  referenceAssetUids: string[]
  promptTemplateVersionId: number | null
  promptText: string
  status: string
  requestMeta: Record<string, unknown>
  actorUserId: number
  now: string
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO ai_generation_requests
       (request_uid, batch_uid, style_id, source_asset_uid, reference_asset_uids_json,
        prompt_template_version_id, prompt_text, status, dispatch_job_uid, request_meta_json,
        upstream_task_json, result_asset_uids_json, error_message, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      request.requestUid,
      request.batchUid,
      request.styleId,
      request.sourceAssetUid,
      toJson(request.referenceAssetUids),
      request.promptTemplateVersionId,
      request.promptText,
      request.status,
      '',
      toJson(request.requestMeta),
      toJson({}),
      toJson([]),
      '',
      request.actorUserId,
      request.now,
      request.now,
    )
    .run()
}

async function updateDirectGenerationRequest(env: Env, requestUid: string, status: string, upstreamTask: unknown, resultAssetUids: string[], errorMessage: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE ai_generation_requests
     SET status = ?, upstream_task_json = ?, result_asset_uids_json = ?, error_message = ?, updated_at = ?
     WHERE request_uid = ?`,
  )
    .bind(status, toJson(upstreamTask || {}), toJson(resultAssetUids), errorMessage, nowIso(), requestUid)
    .run()
}

async function claimDirectGenerationFinalization(env: Env, requestUid: string): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE ai_generation_requests
     SET status = 'finalizing', updated_at = ?
     WHERE request_uid = ?
       AND status IN ('queued', 'running')`,
  )
    .bind(nowIso(), requestUid)
    .run()
  return Number(result.meta.changes ?? 0) === 1
}

function loadDirectGenerationRequest(env: Env, requestUid: string): Promise<GenerationRequestRow | null> {
  return env.DB.prepare('SELECT * FROM ai_generation_requests WHERE request_uid = ? LIMIT 1')
    .bind(requestUid)
    .first<GenerationRequestRow>()
}

async function failDirectGenerationRequest(env: Env, requestUid: string, upstreamTask: unknown, errorMessage: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE ai_generation_requests
     SET status = ?, upstream_task_json = ?, result_asset_uids_json = ?, error_message = ?, updated_at = ?
     WHERE request_uid = ?
       AND status != 'completed'`,
  )
    .bind('failed', toJson(upstreamTask || {}), toJson([]), errorMessage, nowIso(), requestUid)
    .run()
}

async function directGenerationResultAssets(env: Env, generationRequest: GenerationRequestRow): Promise<Array<{ asset_uid: string; object_key: string; filename: string; status: string }>> {
  const assetUids = parseArray(generationRequest.result_asset_uids_json || '[]')
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
  if (assetUids.length === 0) return []
  const { results } = await env.DB.prepare('SELECT * FROM ai_image_assets WHERE batch_uid = ? ORDER BY id ASC')
    .bind(generationRequest.batch_uid)
    .all<AssetRow>()
  const selected = new Set(assetUids)
  return results
    .filter((asset) => selected.has(asset.asset_uid))
    .map((asset) => ({
      asset_uid: asset.asset_uid,
      object_key: asset.object_key,
      filename: asset.filename,
      status: asset.status,
    }))
}

async function completeDirectGenerationRequest(env: Env, details: {
  requestUid: string
  batchUid: string
  style: StyleRow
  sourceAssetUid: string
  promptTemplateVersionId: number | null
  promptText: string
  model: string
  size: string
  quality: string
  outputFormat: string
  dataUrls: string[]
  upstreamTask: unknown
  userId: number
  now: string
}): Promise<Array<{ asset_uid: string; object_key: string; filename: string; status: string }>> {
  const storedAssets = await storeDirectGenerationAssets(env, details)
  await updateDirectGenerationRequest(env, details.requestUid, 'completed', details.upstreamTask, storedAssets.map((asset) => asset.asset_uid), '')
  await appendApprovalEvent(env, details.batchUid, details.style.id, null, 'asset.cloud_generate', details.userId, {
    request_uid: details.requestUid,
    asset_uids: storedAssets.map((asset) => asset.asset_uid),
    model: details.model,
    size: details.size,
    quality: details.quality,
    output_format: details.outputFormat,
  }, details.now)
  await recomputeReviewState(env, details.batchUid)
  return storedAssets
}

async function assetsToDataUrls(env: Env, assets: AssetRow[]): Promise<string[]> {
  const dataUrls: string[] = []
  let totalBytes = 0
  for (const asset of assets) {
    const result = await assetToDataUrl(env, asset)
    totalBytes += result.byteLength
    if (totalBytes > MAX_DIRECT_GENERATION_TOTAL_INPUT_BYTES) {
      throw directGenerationInputError(`direct cloud generation source/reference images exceed ${formatBytes(MAX_DIRECT_GENERATION_TOTAL_INPUT_BYTES)} total`)
    }
    dataUrls.push(result.dataUrl)
  }
  return dataUrls
}

async function assetToDataUrl(env: Env, asset: AssetRow): Promise<{ dataUrl: string; byteLength: number }> {
  const object = await env.ASSETS.get(asset.object_key)
  if (!object) throw new Error(`source asset object not found: ${asset.asset_uid}`)
  const objectSize = typeof (object as { size?: unknown }).size === 'number' ? (object as { size: number }).size : 0
  if (objectSize > MAX_DIRECT_GENERATION_INPUT_BYTES) {
    throw directGenerationInputError(`source/reference image is too large: ${asset.asset_uid}`)
  }
  const buffer = await object.arrayBuffer()
  if (buffer.byteLength > MAX_DIRECT_GENERATION_INPUT_BYTES) {
    throw directGenerationInputError(`source/reference image is too large: ${asset.asset_uid}`)
  }
  return {
    dataUrl: arrayBufferToDataUrl(buffer, object.httpMetadata?.contentType || mimeFromFilename(asset.filename)),
    byteLength: buffer.byteLength,
  }
}

async function storeDirectGenerationAssets(env: Env, details: {
  requestUid: string
  batchUid: string
  style: StyleRow
  sourceAssetUid: string
  promptTemplateVersionId: number | null
  promptText: string
  model: string
  size: string
  quality: string
  outputFormat: string
  dataUrls: string[]
  userId: number
  now: string
}): Promise<Array<{ asset_uid: string; object_key: string; filename: string; status: string }>> {
  const storedAssets: Array<{ asset_uid: string; object_key: string; filename: string; status: string }> = []
  for (let index = 0; index < details.dataUrls.length; index += 1) {
    const dataUrl = details.dataUrls[index]
    const mime = mimeFromDataUrl(dataUrl)
    const extension = extensionForMime(mime, details.outputFormat)
    const assetUid = `cloud-gen-${details.requestUid}-${index + 1}`
    const filename = `${assetUid}.${extension}`
    const objectKey = batchObjectKey(details.batchUid, 'ai', filename)
    const bytes = dataUrlToBytes(dataUrl)
    await env.ASSETS.put(objectKey, bytes, {
      httpMetadata: { contentType: mime },
    })
    const contentHash = await sha256Hex(dataUrl)
    await upsertAsset(env, {
      assetUid,
      batchUid: details.batchUid,
      styleId: details.style.id,
      kind: 'ai',
      status: 'pending',
      objectKey,
      filename,
      contentHash,
      promptTemplateVersionId: details.promptTemplateVersionId,
      promptText: details.promptText,
      parentAssetUid: details.sourceAssetUid,
      generationJobId: details.requestUid,
      meta: {
        source_label: '云端直接生成',
        request_uid: details.requestUid,
        model: details.model,
        size: details.size,
        quality: details.quality,
        output_format: details.outputFormat,
        direct_cloud_generation: true,
      },
      now: details.now,
    })
    await upsertGeneratedImageResource(env, details.style, {
      assetUid,
      batchUid: details.batchUid,
      objectKey,
      filename,
      contentHash,
      userId: details.userId,
      now: details.now,
    })
    storedAssets.push({ asset_uid: assetUid, object_key: objectKey, filename, status: 'pending' })
  }
  return storedAssets
}

async function upsertGeneratedImageResource(env: Env, style: StyleRow, asset: {
  assetUid: string
  batchUid: string
  objectKey: string
  filename: string
  contentHash: string
  userId: number
  now: string
}): Promise<void> {
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
    .bind(asset.assetUid, asset.batchUid, style.style_code, style.item_id, 'ai', asset.assetUid, asset.objectKey, asset.filename, asset.contentHash, '云端直接生成', null, asset.userId, asset.now, asset.now)
    .run()
}

function buildDirectGenerationPrompt(promptText: string, assets: AssetRow[], size: string, quality: string): string {
  const lines: string[] = []
  if (assets.length > 0) {
    lines.push('## Reference images')
    for (const [index, asset] of assets.entries()) {
      const role = index === 0 ? 'MAIN SOURCE' : asset.kind.toUpperCase()
      lines.push(`Image #${index + 1}: ${role}. Preserve useful product shape, color, fabric, branding, and styling details when they are relevant.`)
    }
  }
  lines.push('## Instructions')
  lines.push(promptText)
  if (size) lines.push(`Aspect or size target: ${size}.`)
  if (quality) lines.push(`Quality target: ${quality}.`)
  lines.push('Output one clean ecommerce-ready image. No watermark, border, UI chrome, or extra text unless the prompt explicitly asks for text.')
  return lines.join('\n')
}

function mimeFromFilename(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'image/png'
}

async function generationRequestUidForJob(env: Env, job: DispatchJobRow): Promise<string> {
  const payload = fromJsonObject(job.payload_json)
  const payloadRequestUid = typeof payload.request_uid === 'string' ? payload.request_uid : ''
  if (payloadRequestUid) return payloadRequestUid
  const row = await env.DB.prepare('SELECT request_uid FROM ai_generation_requests WHERE dispatch_job_uid = ? LIMIT 1')
    .bind(job.job_uid)
    .first<{ request_uid: string }>()
  return typeof row?.request_uid === 'string' ? row.request_uid : ''
}

async function hasActiveSubmitJob(env: Env, batchUid: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT id FROM dispatch_jobs
     WHERE batch_uid = ?
       AND job_type = 'submit_tmall_material_test'
       AND status IN ('queued', 'leased', 'running', 'uploading_results', 'cancel_requested')
     LIMIT 1`,
  )
    .bind(batchUid)
    .first<{ id: number }>()
  return Boolean(row)
}

async function hasSucceededSubmitJob(env: Env, batchUid: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT id FROM dispatch_jobs
     WHERE batch_uid = ?
       AND job_type = 'submit_tmall_material_test'
       AND status = 'succeeded'
     LIMIT 1`,
  )
    .bind(batchUid)
    .first<{ id: number }>()
  return Boolean(row)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()) : []
}

function uniqueStrings(value: string[]): string[] {
  return [...new Set(value.filter(Boolean))]
}

function normalizeOutputFormat(value: string): string {
  return value.toLowerCase() === 'jpeg' ? 'jpg' : value.toLowerCase()
}

function normalizeGenerationCount(value: unknown): number {
  const count = Number(value)
  return Number.isInteger(count) && count >= 1 && count <= 8 ? count : 1
}

function directGenerationInputError(message: string): Error & { status?: number } {
  const error = new Error(message) as Error & { status?: number }
  error.status = 400
  return error
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${Math.round(value / 1024 / 1024)}MB`
  if (value >= 1024) return `${Math.round(value / 1024)}KB`
  return `${value}B`
}

function containsSecretishInput(value: unknown): boolean {
  if (typeof value === 'string') return /data:image/i.test(value)
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(containsSecretishInput)
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_FIELD_PATTERN.test(key)) return true
    if (containsSecretishInput(child)) return true
  }
  return false
}

function promptOverrideMap(value: unknown): Map<string, string> {
  const result = new Map<string, string>()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  for (const [assetUid, prompt] of Object.entries(value as Record<string, unknown>)) {
    const uid = stringValue(assetUid)
    const text = stringValue(prompt)
    if (uid && text) result.set(uid, text)
  }
  return result
}

function isFreshOnlineSubmitMachine(machine: MachineRow): boolean {
  if (!['online_idle', 'online_busy'].includes(machine.health)) return false
  if (!machine.last_seen_at) return false
  const lastSeen = Date.parse(machine.last_seen_at)
  return Number.isFinite(lastSeen) && Date.now() - lastSeen <= SUBMIT_MACHINE_MAX_AGE_MS
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
