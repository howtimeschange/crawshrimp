import { recordAudit } from './audit'
import { fromJsonObject, nowIso, toJson } from './db'
import type { Env } from './env'
import { badRequest, forbidden, json, readJsonObject, unauthorized } from './http'
import { canClaimJob, type DispatchStatus, type MachineAuthStatus, type MachineHealth } from './job-state'
import { requirePermission } from './auth-routes'
import { randomToken, sha256Hex } from './security/tokens'

interface EnrollmentTokenRow {
  id: number
  token_hash: string
  label: string
  owner_user_id: number | null
  allowed_capabilities_json: string
  require_approval: number
  status: string
  expires_at: string
  used_by_machine_id: string | null
  created_by: number
  created_at: string
  used_at: string | null
  revoked_at: string | null
}

interface MachineRow {
  id: number
  machine_id: string
  machine_name: string
  owner_user_id: number | null
  app_version: string
  fingerprint_hash: string
  capabilities_json: string
  auth_status: MachineAuthStatus
  health: MachineHealth
  current_job_id: string | null
  last_seen_at: string | null
  registered_at: string
  updated_at: string
  token_hash?: string
}

interface DispatchJobRow {
  id: number
  job_uid: string
  batch_uid: string
  job_type: string
  status: DispatchStatus
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

const CLAIM_POLL_AFTER_SECONDS = 10
const JOB_LEASE_SECONDS = 300

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value !== 'string' || !value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
  } catch {
    return []
  }
}

function publicEnrollmentToken(row: EnrollmentTokenRow): Omit<EnrollmentTokenRow, 'token_hash'> {
  const { token_hash: _tokenHash, ...safeRow } = row
  return safeRow
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') || ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1].trim() : null
}

async function requireMachine(request: Request, env: Env): Promise<MachineRow | Response> {
  const token = bearerToken(request)
  if (!token) return unauthorized('Machine bearer token is required')
  const tokenHash = await sha256Hex(token)
  const machine = await env.DB.prepare(
    `SELECT m.id, m.machine_id, m.machine_name, m.owner_user_id, m.app_version, m.fingerprint_hash,
            m.capabilities_json, m.auth_status, m.health, m.current_job_id, m.last_seen_at,
            m.registered_at, m.updated_at, mt.token_hash
     FROM machine_tokens mt
     JOIN task_machines m ON m.machine_id = mt.machine_id
     WHERE mt.token_hash = ?
       AND mt.status = 'active'
       AND mt.revoked_at IS NULL
     LIMIT 1`,
  )
    .bind(tokenHash)
    .first<MachineRow>()
  if (!machine) return unauthorized('Invalid machine token')
  await env.DB.prepare('UPDATE machine_tokens SET last_used_at = ? WHERE token_hash = ?').bind(nowIso(), tokenHash).run()
  return machine
}

async function requireActiveMachine(request: Request, env: Env): Promise<MachineRow | Response> {
  const machine = await requireMachine(request, env)
  if (machine instanceof Response) return machine
  if (machine.auth_status !== 'active') return forbidden('Machine is not approved')
  return machine
}

async function allowedCapabilitiesForMachine(env: Env, machineId: string): Promise<string[] | null> {
  const tokenRow = await env.DB.prepare(
    `SELECT id, token_hash, label, owner_user_id, allowed_capabilities_json, require_approval, status,
            expires_at, used_by_machine_id, created_by, created_at, used_at, revoked_at
     FROM machine_enrollment_tokens
     WHERE used_by_machine_id = ?
     ORDER BY used_at DESC, id DESC
     LIMIT 1`,
  )
    .bind(machineId)
    .first<EnrollmentTokenRow>()
  if (!tokenRow) return null
  return parseStringArray(tokenRow.allowed_capabilities_json)
}

function secondsFromBody(value: unknown): number {
  const seconds = Number(value ?? 86_400)
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 31_536_000) : 86_400
}

export async function createEnrollmentToken(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'machines:write')
  if (actor instanceof Response) return actor
  const body = await readJsonObject(request)
  const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : 'Machine enrollment token'
  const allowedCapabilities = parseStringArray(body.allowed_capabilities ?? body.allowedCapabilities)
  const ownerUserId = typeof body.owner_user_id === 'number' ? body.owner_user_id : null
  const requireApproval = body.require_approval === false || body.requireApproval === false ? 0 : 1
  const plainToken = randomToken('csr_enroll')
  const tokenHash = await sha256Hex(plainToken)
  const now = nowIso()
  const expiresAt = new Date(Date.now() + secondsFromBody(body.expires_in_seconds ?? body.expiresInSeconds) * 1000).toISOString()
  const result = await env.DB.prepare(
    `INSERT INTO machine_enrollment_tokens
       (token_hash, label, owner_user_id, allowed_capabilities_json, require_approval, expires_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(tokenHash, label, ownerUserId, toJson(allowedCapabilities), requireApproval, expiresAt, actor.user.id, now)
    .run()
  const enrollmentToken: Omit<EnrollmentTokenRow, 'token_hash'> = {
    id: Number(result.meta.last_row_id),
    label,
    owner_user_id: ownerUserId,
    allowed_capabilities_json: toJson(allowedCapabilities),
    require_approval: requireApproval,
    status: 'issued',
    expires_at: expiresAt,
    used_by_machine_id: null,
    created_by: actor.user.id,
    created_at: now,
    used_at: null,
    revoked_at: null,
  }
  await recordAudit(env, { userId: actor.user.id }, 'machines.enrollment_token.create', 'machine_enrollment_token', String(enrollmentToken.id), { label, allowedCapabilities }, request)
  return json({ token: plainToken, enrollment_token: enrollmentToken }, { status: 201 })
}

export async function revokeEnrollmentToken(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'machines:write')
  if (actor instanceof Response) return actor
  const id = Number(new URL(request.url).pathname.match(/^\/api\/admin\/machine-enrollment-tokens\/(\d+)$/)?.[1])
  if (!Number.isInteger(id) || id <= 0) return badRequest('valid token id is required')
  await env.DB.prepare("UPDATE machine_enrollment_tokens SET status = 'revoked', revoked_at = ? WHERE id = ?").bind(nowIso(), id).run()
  await recordAudit(env, { userId: actor.user.id }, 'machines.enrollment_token.revoke', 'machine_enrollment_token', String(id), {}, request)
  return json({ ok: true })
}

export async function listEnrollmentTokens(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'machines:read')
  if (actor instanceof Response) return actor
  const { results } = await env.DB.prepare(
    `SELECT id, token_hash, label, owner_user_id, allowed_capabilities_json, require_approval, status,
            expires_at, used_by_machine_id, created_by, created_at, used_at, revoked_at
     FROM machine_enrollment_tokens
     ORDER BY id DESC
     LIMIT 100`,
  ).all<EnrollmentTokenRow>()
  return json({ enrollment_tokens: results.map(publicEnrollmentToken) })
}

export async function listMachines(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'machines:read')
  if (actor instanceof Response) return actor
  const { results } = await env.DB.prepare(
    `SELECT id, machine_id, machine_name, owner_user_id, app_version, fingerprint_hash, capabilities_json,
            auth_status, health, current_job_id, last_seen_at, registered_at, updated_at
     FROM task_machines
     ORDER BY id DESC
     LIMIT 100`,
  ).all<MachineRow>()
  return json({ machines: results })
}

export async function approveMachine(request: Request, env: Env): Promise<Response> {
  return setMachineStatus(request, env, 'active', 'machines.approve')
}

export async function disableMachine(request: Request, env: Env): Promise<Response> {
  return setMachineStatus(request, env, 'disabled', 'machines.disable')
}

export async function revokeMachine(request: Request, env: Env): Promise<Response> {
  const response = await setMachineStatus(request, env, 'revoked', 'machines.revoke')
  if (response.status < 300) {
    const machineId = machineIdFromAdminPath(request)
    await env.DB.prepare("UPDATE machine_tokens SET status = 'revoked', revoked_at = ? WHERE machine_id = ?").bind(nowIso(), machineId).run()
  }
  return response
}

async function setMachineStatus(request: Request, env: Env, status: MachineAuthStatus, action: string): Promise<Response> {
  const actor = await requirePermission(request, env, 'machines:write')
  if (actor instanceof Response) return actor
  const machineId = machineIdFromAdminPath(request)
  if (!machineId) return badRequest('valid machine id is required')
  await env.DB.prepare('UPDATE task_machines SET auth_status = ?, updated_at = ? WHERE machine_id = ?').bind(status, nowIso(), machineId).run()
  await recordAudit(env, { userId: actor.user.id }, action, 'machine', machineId, { status }, request)
  return json({ ok: true })
}

export async function rotateMachineToken(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'machines:write')
  if (actor instanceof Response) return actor
  const machineId = machineIdFromAdminPath(request)
  if (!machineId) return badRequest('valid machine id is required')
  const plainToken = randomToken('csr_machine')
  const tokenHash = await sha256Hex(plainToken)
  await env.DB.prepare("UPDATE machine_tokens SET status = 'revoked', revoked_at = ? WHERE machine_id = ? AND status = 'active'").bind(nowIso(), machineId).run()
  await env.DB.prepare('INSERT INTO machine_tokens (machine_id, token_hash, issued_by, issued_at) VALUES (?, ?, ?, ?)')
    .bind(machineId, tokenHash, actor.user.id, nowIso())
    .run()
  await recordAudit(env, { userId: actor.user.id }, 'machines.token.rotate', 'machine', machineId, {}, request)
  return json({ machine_id: machineId, machine_token: plainToken })
}

export async function enrollMachine(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request)
  const enrollmentToken = typeof body.enrollment_token === 'string' ? body.enrollment_token : ''
  const machineId = typeof body.machine_id === 'string' ? body.machine_id.trim() : ''
  const machineName = typeof body.machine_name === 'string' && body.machine_name.trim() ? body.machine_name.trim() : machineId
  const fingerprint = typeof body.fingerprint === 'string' ? body.fingerprint : ''
  const appVersion = typeof body.app_version === 'string' ? body.app_version : ''
  const capabilities = parseStringArray(body.capabilities)
  if (!enrollmentToken || !machineId || !fingerprint) return badRequest('enrollment_token, machine_id, and fingerprint are required')

  const tokenHash = await sha256Hex(enrollmentToken)
  const tokenRow = await env.DB.prepare(
    `SELECT id, token_hash, label, owner_user_id, allowed_capabilities_json, require_approval, status,
            expires_at, used_by_machine_id, created_by, created_at, used_at, revoked_at
     FROM machine_enrollment_tokens
     WHERE token_hash = ?
     LIMIT 1`,
  )
    .bind(tokenHash)
    .first<EnrollmentTokenRow>()
  if (!tokenRow || tokenRow.status !== 'issued' || tokenRow.revoked_at || tokenRow.used_at || tokenRow.expires_at <= nowIso()) {
    return badRequest('Enrollment token is invalid')
  }
  const allowedCapabilities = parseStringArray(tokenRow.allowed_capabilities_json)
  const allowed = new Set(allowedCapabilities)
  const invalidCapabilities = capabilities.filter((capability) => !allowed.has(capability))
  if (invalidCapabilities.length > 0) return badRequest(`capability not allowed: ${invalidCapabilities.join(', ')}`)

  const now = nowIso()
  const authStatus: MachineAuthStatus = tokenRow.require_approval ? 'pending_approval' : 'active'
  const fingerprintHash = await sha256Hex(fingerprint)
  const machineToken = randomToken('csr_machine')
  const machineTokenHash = await sha256Hex(machineToken)
  const tokenUpdate = await env.DB.prepare(
    `UPDATE machine_enrollment_tokens
     SET used_at = ?, used_by_machine_id = ?, status = 'used'
     WHERE token_hash = ?
       AND status = 'issued'
       AND used_at IS NULL`,
  )
    .bind(now, machineId, tokenHash)
    .run()
  if (Number(tokenUpdate.meta.changes ?? 0) === 0) return badRequest('Enrollment token is invalid')
  await env.DB.prepare(
    `INSERT INTO task_machines
       (machine_id, machine_name, owner_user_id, app_version, fingerprint_hash, capabilities_json, auth_status, registered_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(machineId, machineName, tokenRow.owner_user_id, appVersion, fingerprintHash, toJson(capabilities), authStatus, now, now)
    .run()
  await env.DB.prepare('INSERT INTO machine_tokens (machine_id, token_hash, issued_by, issued_at) VALUES (?, ?, ?, ?)')
    .bind(machineId, machineTokenHash, null, now)
    .run()
  await recordAudit(env, { machineId }, 'machines.enroll', 'machine', machineId, { capabilities, authStatus }, request)
  return json({ machine_id: machineId, auth_status: authStatus, machine_token: machineToken }, { status: 201 })
}

export async function heartbeat(request: Request, env: Env): Promise<Response> {
  const machine = await requireMachine(request, env)
  if (machine instanceof Response) return machine
  const body = await readJsonObject(request)
  const health = typeof body.health === 'string' ? body.health : 'online_idle'
  if (!['offline', 'online_idle', 'online_busy', 'needs_login', 'config_missing', 'version_blocked'].includes(health)) return badRequest('invalid health')
  const appVersion = typeof body.app_version === 'string' ? body.app_version : machine.app_version
  const registeredCapabilities = await allowedCapabilitiesForMachine(env, machine.machine_id)
  if (!registeredCapabilities) return forbidden('Machine enrollment authorization is unavailable')
  const heartbeatCapabilities = parseStringArray(body.capabilities)
  const registeredCapabilitySet = new Set(registeredCapabilities)
  const unsupportedCapabilities = heartbeatCapabilities.filter((capability) => !registeredCapabilitySet.has(capability))
  if (unsupportedCapabilities.length > 0) return badRequest(`capability not registered: ${unsupportedCapabilities.join(', ')}`)
  const now = nowIso()
  await env.DB.prepare(
    `UPDATE task_machines
     SET health = ?, last_seen_at = ?, app_version = ?, capabilities_json = ?, updated_at = ?
     WHERE machine_id = ?`,
  )
    .bind(health, now, appVersion, toJson(heartbeatCapabilities), now, machine.machine_id)
    .run()
  await recordAudit(env, { machineId: machine.machine_id }, 'machines.heartbeat', 'machine', machine.machine_id, { health }, request)
  return json({ ok: true, machine_id: machine.machine_id, auth_status: machine.auth_status, health })
}

export async function claimJob(request: Request, env: Env): Promise<Response> {
  const machine = await requireActiveMachine(request, env)
  if (machine instanceof Response) return machine
  if (!['online_idle', 'online_busy'].includes(machine.health)) return forbidden('Machine is not available for claims')
  const machineCapabilities = parseStringArray(machine.capabilities_json)
  const { results } = await env.DB.prepare(
    `SELECT id, job_uid, batch_uid, job_type, status, requested_by, assigned_machine_id, required_capabilities_json,
            priority, attempt_count, max_attempts, idempotency_key, lease_id, lease_expires_at, payload_json,
            result_json, created_at, updated_at
     FROM dispatch_jobs
     WHERE status = 'queued'
       AND (assigned_machine_id IS NULL OR assigned_machine_id = '' OR assigned_machine_id = ?)
     ORDER BY priority ASC, created_at ASC
    `,
  )
    .bind(machine.machine_id)
    .all<DispatchJobRow>()
  const selected = results.find((job) => canClaimJob({
    jobStatus: job.status,
    assignedMachineId: job.assigned_machine_id || '',
    requiredCapabilities: parseStringArray(job.required_capabilities_json),
    machineId: machine.machine_id,
    machineAuthStatus: machine.auth_status,
    machineHealth: machine.health,
    machineCapabilities,
  }))
  if (!selected) return json({ job: null, next_poll_after_seconds: CLAIM_POLL_AFTER_SECONDS })

  const leaseId = randomToken('lease')
  const now = nowIso()
  const leaseExpiresAt = new Date(Date.now() + JOB_LEASE_SECONDS * 1000).toISOString()
  const update = await env.DB.prepare(
    `UPDATE dispatch_jobs
     SET lease_id = ?,
         lease_expires_at = ?,
         status = 'leased',
         assigned_machine_id = ?,
         attempt_count = attempt_count + 1,
         updated_at = ?
     WHERE job_uid = ?
       AND status = 'queued'
       AND required_capabilities_json = ?
       AND (assigned_machine_id IS NULL OR assigned_machine_id = '' OR assigned_machine_id = ?)`,
  )
    .bind(leaseId, leaseExpiresAt, machine.machine_id, now, selected.job_uid, selected.required_capabilities_json, machine.machine_id)
    .run()
  if (Number(update.meta.changes ?? 0) === 0) return json({ job: null, next_poll_after_seconds: CLAIM_POLL_AFTER_SECONDS })
  await env.DB.prepare('UPDATE task_machines SET current_job_id = ?, health = ?, updated_at = ? WHERE machine_id = ?')
    .bind(selected.job_uid, 'online_busy', now, machine.machine_id)
    .run()
  await recordJobEvent(env, selected.job_uid, machine.machine_id, leaseId, 'leased', '', { attempt_count: selected.attempt_count + 1 })
  return json({
    job: {
      job_uid: selected.job_uid,
      batch_uid: selected.batch_uid,
      job_type: selected.job_type,
      lease_id: leaseId,
      lease_expires_at: leaseExpiresAt,
      payload: fromJsonObject(selected.payload_json),
      required_capabilities: parseStringArray(selected.required_capabilities_json),
      attempt_count: selected.attempt_count + 1,
    },
    next_poll_after_seconds: 0,
  })
}

export async function renewJob(request: Request, env: Env): Promise<Response> {
  const machine = await requireActiveMachine(request, env)
  if (machine instanceof Response) return machine
  const body = await readJsonObject(request)
  const jobUid = typeof body.job_uid === 'string' ? body.job_uid : jobUidFromPath(request)
  const leaseId = typeof body.lease_id === 'string' ? body.lease_id : ''
  if (!jobUid || !leaseId) return badRequest('job_uid and lease_id are required')
  const leaseExpiresAt = new Date(Date.now() + JOB_LEASE_SECONDS * 1000).toISOString()
  const update = await env.DB.prepare(
    `UPDATE dispatch_jobs
     SET lease_expires_at = ?, updated_at = ?
     WHERE job_uid = ?
       AND lease_id = ?
       AND assigned_machine_id = ?
       AND status IN ('leased', 'running', 'uploading_results')`,
  )
    .bind(leaseExpiresAt, nowIso(), jobUid, leaseId, machine.machine_id)
    .run()
  if (Number(update.meta.changes ?? 0) === 0) return forbidden('Stale lease')
  await recordJobEvent(env, jobUid, machine.machine_id, leaseId, 'lease_renewed', '', { lease_expires_at: leaseExpiresAt })
  return json({ ok: true, lease_expires_at: leaseExpiresAt })
}

export async function progressJob(request: Request, env: Env): Promise<Response> {
  return updateJobWithLease(request, env, 'running', 'progress')
}

export async function completeJob(request: Request, env: Env): Promise<Response> {
  return updateJobWithLease(request, env, 'succeeded', 'completed')
}

export async function failJob(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request)
  const terminal = body.terminal === true
  return updateJobWithLease(request, env, terminal ? 'terminal_failed' : 'retryable_failed', 'failed', body)
}

async function updateJobWithLease(request: Request, env: Env, status: DispatchStatus, eventType: string, existingBody?: Record<string, unknown>): Promise<Response> {
  const machine = await requireActiveMachine(request, env)
  if (machine instanceof Response) return machine
  const body = existingBody ?? await readJsonObject(request)
  const jobUid = typeof body.job_uid === 'string' ? body.job_uid : jobUidFromPath(request)
  const leaseId = typeof body.lease_id === 'string' ? body.lease_id : ''
  if (!jobUid || !leaseId) return badRequest('job_uid and lease_id are required')
  const result = body.result && typeof body.result === 'object' ? body.result : {}
  const update = await env.DB.prepare(
    `UPDATE dispatch_jobs
     SET status = ?, result_json = ?, updated_at = ?
     WHERE job_uid = ?
       AND lease_id = ?
       AND assigned_machine_id = ?
       AND status IN ('leased', 'running', 'uploading_results')`,
  )
    .bind(status, toJson(result), nowIso(), jobUid, leaseId, machine.machine_id)
    .run()
  if (Number(update.meta.changes ?? 0) === 0) return forbidden('Stale lease')
  if (['succeeded', 'retryable_failed', 'terminal_failed'].includes(status)) {
    await env.DB.prepare('UPDATE task_machines SET current_job_id = NULL, health = ?, updated_at = ? WHERE machine_id = ?')
      .bind('online_idle', nowIso(), machine.machine_id)
      .run()
  }
  await recordJobEvent(env, jobUid, machine.machine_id, leaseId, eventType, typeof body.message === 'string' ? body.message : '', { status, result })
  return json({ ok: true, status })
}

async function recordJobEvent(env: Env, jobUid: string, machineId: string, leaseId: string, eventType: string, message: string, payload: unknown): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO dispatch_job_events (job_uid, machine_id, lease_id, event_type, message, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(jobUid, machineId, leaseId, eventType, message, toJson(payload), nowIso())
    .run()
}

function machineIdFromAdminPath(request: Request): string {
  return decodeURIComponent(new URL(request.url).pathname.match(/^\/api\/admin\/machines\/([^/]+)/)?.[1] || '')
}

function jobUidFromPath(request: Request): string {
  return decodeURIComponent(new URL(request.url).pathname.match(/^\/api\/jobs\/([^/]+)\//)?.[1] || '')
}
