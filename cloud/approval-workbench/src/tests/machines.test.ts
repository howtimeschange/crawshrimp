import { describe, expect, it } from 'vitest'
import worker from '../worker/index'
import { sha256Hex } from '../worker/security/tokens'

interface UserRow {
  id: number
  email: string
  name: string
  status: string
}

interface RoleRow {
  id: number
  role_key: string
  name: string
}

interface UserRoleRow {
  user_id: number
  role_id: number
}

interface SessionRow {
  user_id: number
  session_hash: string
  expires_at: string
  revoked_at: string | null
}

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
  auth_status: string
  health: string
  current_job_id: string | null
  last_seen_at: string | null
  registered_at: string
  updated_at: string
}

interface MachineTokenRow {
  id: number
  machine_id: string
  token_hash: string
  token_version: number
  status: string
  issued_by: number | null
  issued_at: string
  last_used_at: string | null
  revoked_at: string | null
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
  cancel_requested: number
  payload_json: string
  result_json: string
  created_at: string
  updated_at: string
}

interface BatchRow {
  id: number
  batch_uid: string
  status: string
  updated_at: string
}

interface StyleRow {
  id: number
  batch_uid: string
  style_code: string
  status: string
  submit_summary_json: string
}

interface AssetRow {
  id: number
  asset_uid: string
  batch_uid: string
  style_id: number
  kind: string
  status: string
  updated_at: string
}

interface GenerationRequestRow {
  request_uid: string
  dispatch_job_uid: string
  status: string
  updated_at: string
}

interface FakeState {
  users: UserRow[]
  roles: RoleRow[]
  userRoles: UserRoleRow[]
  sessions: SessionRow[]
  enrollmentTokens: EnrollmentTokenRow[]
  machines: MachineRow[]
  machineTokens: MachineTokenRow[]
  jobs: DispatchJobRow[]
  batches: BatchRow[]
  styles: StyleRow[]
  assets: AssetRow[]
  generationRequests: GenerationRequestRow[]
  events: unknown[]
  audits: unknown[]
  claimRaceRequiredCapabilitiesJson?: string
  claimRaceMachineAuthStatus?: string
  claimRaceMachineHealth?: string
  claimRaceMachineCapabilitiesJson?: string
  batchSubmittedWhileJobStatus?: string
}

class FakeD1Statement {
  private params: unknown[] = []

  constructor(
    private readonly state: FakeState,
    private readonly sql: string,
  ) {}

  bind(...params: unknown[]): FakeD1Statement {
    this.params = params
    return this
  }

  async first<T>(): Promise<T | null> {
    const normalized = normalizeSql(this.sql)
    if (normalized.includes('from sessions') && normalized.includes('join users')) {
      const sessionHash = String(this.params[0])
      const now = String(this.params[1])
      const session = this.state.sessions.find((row) => row.session_hash === sessionHash && !row.revoked_at && row.expires_at > now)
      if (!session) return null
      return (this.state.users.find((user) => user.id === session.user_id && user.status === 'active') ?? null) as T | null
    }
    if (normalized.includes('from machine_enrollment_tokens') && normalized.includes('where used_by_machine_id = ?')) {
      const machineId = String(this.params[0])
      const rows = this.state.enrollmentTokens
        .filter((row) => row.used_by_machine_id === machineId)
        .sort((a, b) => {
          const usedAtOrder = String(b.used_at ?? '').localeCompare(String(a.used_at ?? ''))
          return usedAtOrder || b.id - a.id
        })
      return (rows[0] ?? null) as T | null
    }
    if (normalized.includes('from machine_enrollment_tokens') && normalized.includes('token_hash')) {
      const tokenHash = String(this.params[0])
      return (this.state.enrollmentTokens.find((row) => row.token_hash === tokenHash) ?? null) as T | null
    }
    if (normalized.includes('from machine_tokens') && normalized.includes('join task_machines')) {
      const tokenHash = String(this.params[0])
      const token = this.state.machineTokens.find((row) => row.token_hash === tokenHash && row.status === 'active' && !row.revoked_at)
      if (!token) return null
      const machine = this.state.machines.find((row) => row.machine_id === token.machine_id)
      return (machine ? { ...machine, token_hash: token.token_hash } : null) as T | null
    }
    if (normalized.includes('from dispatch_jobs') && normalized.includes("status = 'queued'")) {
      const machineId = String(this.params[0])
      const excludesCancelRequested = normalized.includes('cancel_requested != 1')
      const sorted = [...this.state.jobs]
        .filter((job) => job.status === 'queued' && (!excludesCancelRequested || job.cancel_requested !== 1) && (!job.assigned_machine_id || job.assigned_machine_id === machineId))
        .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at))
      return (sorted[0] ?? null) as T | null
    }
    if (normalized.includes('from dispatch_jobs') && normalized.includes('where job_uid = ?')) {
      return (this.state.jobs.find((job) => job.job_uid === String(this.params[0])) ?? null) as T | null
    }
    return null
  }

  async all<T>(): Promise<{ results: T[] }> {
    const normalized = normalizeSql(this.sql)
    if (normalized.includes('from roles') && normalized.includes('join user_roles')) {
      const userId = Number(this.params[0])
      const results = this.state.userRoles
        .filter((userRole) => userRole.user_id === userId)
        .map((userRole) => this.state.roles.find((role) => role.id === userRole.role_id))
        .filter((role): role is RoleRow => Boolean(role))
      return { results: results as T[] }
    }
    if (normalized.includes('from machine_enrollment_tokens')) return { results: this.state.enrollmentTokens as T[] }
    if (normalized.includes('from task_machines')) return { results: this.state.machines as T[] }
    if (normalized.includes('from dispatch_jobs') && normalized.includes('cancel_requested = 1')) {
      const cutoff = String(this.params[0])
      const results = this.state.jobs
        .filter((job) => job.cancel_requested === 1
          && ['leased', 'running', 'uploading_results', 'cancel_requested'].includes(job.status)
          && Boolean(job.lease_expires_at)
          && String(job.lease_expires_at) < cutoff)
        .map((job) => ({
          job_uid: job.job_uid,
          status: job.status,
          assigned_machine_id: job.assigned_machine_id,
          lease_id: job.lease_id,
        }))
      return { results: results as T[] }
    }
    if (normalized.includes('from dispatch_jobs')) {
      const machineId = String(this.params[0])
      const excludesCancelRequested = normalized.includes('cancel_requested != 1')
      const results = [...this.state.jobs]
        .filter((job) => job.status === 'queued' && (!excludesCancelRequested || job.cancel_requested !== 1) && (!job.assigned_machine_id || job.assigned_machine_id === machineId))
        .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at))
      return { results: results.map((job) => ({ ...job })) as T[] }
    }
    if (normalized.includes('from ai_image_assets') && normalized.includes("status = 'approved'")) {
      const batchUid = String(this.params[0])
      return {
        results: this.state.assets
          .filter((asset) => asset.batch_uid === batchUid && asset.kind === 'ai' && asset.status === 'approved')
          .map((asset) => ({ asset_uid: asset.asset_uid, style_id: asset.style_id })) as T[],
      }
    }
    return { results: [] }
  }

  async run(): Promise<D1Result> {
    const normalized = normalizeSql(this.sql)
    if (normalized.startsWith('insert into machine_enrollment_tokens')) {
      const id = this.state.enrollmentTokens.length + 1
      this.state.enrollmentTokens.push({
        id,
        token_hash: String(this.params[0]),
        label: String(this.params[1]),
        owner_user_id: numberOrNull(this.params[2]),
        allowed_capabilities_json: String(this.params[3]),
        require_approval: Number(this.params[4]),
        status: 'issued',
        expires_at: String(this.params[5]),
        used_by_machine_id: null,
        created_by: Number(this.params[6]),
        created_at: String(this.params[7]),
        used_at: null,
        revoked_at: null,
      })
      return result(1, id)
    }
    if (normalized.startsWith('update machine_enrollment_tokens set')) {
      const machineId = String(this.params[1])
      const tokenHash = String(this.params[2])
      const token = this.state.enrollmentTokens.find((row) => row.token_hash === tokenHash && row.status === 'issued')
      if (!token) return result(0)
      token.status = 'used'
      token.used_by_machine_id = machineId
      token.used_at = String(this.params[0])
      return result(1)
    }
    if (normalized.startsWith('insert into task_machines')) {
      const id = this.state.machines.length + 1
      this.state.machines.push({
        id,
        machine_id: String(this.params[0]),
        machine_name: String(this.params[1]),
        owner_user_id: numberOrNull(this.params[2]),
        app_version: String(this.params[3]),
        fingerprint_hash: String(this.params[4]),
        capabilities_json: String(this.params[5]),
        auth_status: String(this.params[6]),
        health: 'offline',
        current_job_id: null,
        last_seen_at: null,
        registered_at: String(this.params[7]),
        updated_at: String(this.params[8]),
      })
      return result(1, id)
    }
    if (normalized.startsWith('insert into machine_tokens')) {
      const id = this.state.machineTokens.length + 1
      this.state.machineTokens.push({
        id,
        machine_id: String(this.params[0]),
        token_hash: String(this.params[1]),
        token_version: 1,
        status: 'active',
        issued_by: numberOrNull(this.params[2]),
        issued_at: String(this.params[3]),
        last_used_at: null,
        revoked_at: null,
      })
      return result(1, id)
    }
    if (normalized.startsWith('insert into dispatch_job_events')) {
      this.state.events.push({
        job_uid: String(this.params[0]),
        machine_id: String(this.params[1]),
        lease_id: String(this.params[2]),
        event_type: String(this.params[3]),
        message: String(this.params[4]),
        payload_json: String(this.params[5]),
        created_at: String(this.params[6]),
      })
      return result(1, this.state.events.length)
    }
    if (normalized.startsWith('update task_machines set auth_status')) {
      const machine = this.state.machines.find((row) => row.machine_id === String(this.params[2]))
      if (machine) machine.auth_status = String(this.params[0])
      return result(machine ? 1 : 0)
    }
    if (normalized.startsWith('update task_machines set health')) {
      const hasCapabilitiesUpdate = normalized.includes('capabilities_json')
      const machineId = String(this.params[hasCapabilitiesUpdate ? 5 : 4])
      const machine = this.state.machines.find((row) => row.machine_id === machineId)
      if (!machine) return result(0)
      machine.health = String(this.params[0])
      machine.last_seen_at = String(this.params[1])
      machine.app_version = String(this.params[2])
      if (hasCapabilitiesUpdate) {
        machine.capabilities_json = String(this.params[3])
        machine.updated_at = String(this.params[4])
      } else {
        machine.updated_at = String(this.params[3])
      }
      return result(1)
    }
    if (normalized.startsWith('update machine_tokens set last_used_at')) {
      const tokenHash = String(this.params[1])
      const token = this.state.machineTokens.find((row) => row.token_hash === tokenHash)
      if (token) token.last_used_at = String(this.params[0])
      return result(token ? 1 : 0)
    }
    if (normalized.startsWith("update dispatch_jobs set status = 'cancelled'")) {
      const now = String(this.params[0])
      const cutoff = String(this.params[1])
      let changes = 0
      for (const job of this.state.jobs) {
        const expiredLease = job.cancel_requested === 1
          && ['leased', 'running', 'uploading_results', 'cancel_requested'].includes(job.status)
          && Boolean(job.lease_expires_at)
          && String(job.lease_expires_at) < cutoff
        if (expiredLease) {
          job.status = 'cancelled'
          job.assigned_machine_id = null
          job.lease_id = null
          job.lease_expires_at = null
          job.updated_at = now
          changes += 1
        }
      }
      return result(changes)
    }
    if (normalized.startsWith("update dispatch_jobs set status = 'queued'")) {
      const now = String(this.params[0])
      const cutoff = this.params.length > 1 ? String(this.params[1]) : ''
      let changes = 0
      for (const job of this.state.jobs) {
        const expiredLease = ['leased', 'running', 'uploading_results', 'cancel_requested'].includes(job.status)
          && job.cancel_requested !== 1
          && Boolean(job.lease_expires_at)
          && String(job.lease_expires_at) < cutoff
        const retryable = job.status === 'retryable_failed' && job.cancel_requested !== 1
        if ((expiredLease || retryable) && job.attempt_count < job.max_attempts) {
          job.status = 'queued'
          job.assigned_machine_id = null
          job.lease_id = null
          job.lease_expires_at = null
          job.updated_at = now
          changes += 1
        }
      }
      return result(changes)
    }
    if (normalized.startsWith('update dispatch_jobs set lease_id')) {
      const machineId = String(this.params[2])
      const jobUid = String(this.params[4])
      const requiredCapabilitiesParam = normalized.includes('required_capabilities_json = ?') ? String(this.params[5]) : null
      const job = this.state.jobs.find((row) => row.job_uid === jobUid && row.status === 'queued' && (!row.assigned_machine_id || row.assigned_machine_id === machineId))
      if (!job) return result(0)
      if (normalized.includes('cancel_requested != 1') && job.cancel_requested === 1) return result(0)
      if (this.state.claimRaceRequiredCapabilitiesJson) job.required_capabilities_json = this.state.claimRaceRequiredCapabilitiesJson
      if (requiredCapabilitiesParam !== null && job.required_capabilities_json !== requiredCapabilitiesParam) return result(0)
      const machine = this.state.machines.find((row) => row.machine_id === machineId)
      if (machine) {
        if (this.state.claimRaceMachineAuthStatus) machine.auth_status = this.state.claimRaceMachineAuthStatus
        if (this.state.claimRaceMachineHealth) machine.health = this.state.claimRaceMachineHealth
        if (this.state.claimRaceMachineCapabilitiesJson) machine.capabilities_json = this.state.claimRaceMachineCapabilitiesJson
      }
      if (normalized.includes('from task_machines')) {
        if (!machine || machine.auth_status !== 'active' || !['online_idle', 'online_busy'].includes(machine.health)) return result(0)
        const machineCapabilities = parseStringArray(machine.capabilities_json)
        const machineCapabilitySet = new Set(machineCapabilities)
        const requiredCapabilities = parseStringArray(job.required_capabilities_json)
        if (requiredCapabilities.some((capability) => !machineCapabilitySet.has(capability))) return result(0)
      }
      job.lease_id = String(this.params[0])
      job.lease_expires_at = String(this.params[1])
      job.assigned_machine_id = machineId
      job.status = 'leased'
      job.attempt_count += 1
      job.updated_at = String(this.params[3])
      return result(1)
    }
    if (normalized.startsWith('update task_machines set current_job_id = null')) {
      const machine = this.state.machines.find((row) => row.machine_id === String(this.params[2]))
      if (!machine) return result(0)
      machine.current_job_id = null
      machine.health = String(this.params[0])
      machine.updated_at = String(this.params[1])
      return result(1)
    }
    if (normalized.startsWith('update task_machines set current_job_id')) {
      const machine = this.state.machines.find((row) => row.machine_id === String(this.params[3]))
      if (!machine) return result(0)
      machine.current_job_id = String(this.params[0])
      machine.health = String(this.params[1])
      machine.updated_at = String(this.params[2])
      return result(1)
    }
    if (normalized.startsWith('update dispatch_jobs set lease_expires_at')) {
      const jobUid = String(this.params[2])
      const leaseId = String(this.params[3])
      const machineId = String(this.params[4])
      const job = this.state.jobs.find((row) => row.job_uid === jobUid && row.lease_id === leaseId && row.assigned_machine_id === machineId && ['leased', 'running', 'uploading_results', 'cancel_requested'].includes(row.status))
      if (!job) return result(0)
      job.lease_expires_at = String(this.params[0])
      job.updated_at = String(this.params[1])
      return result(1)
    }
    if (normalized.startsWith('update dispatch_jobs set cancel_requested')) {
      const status = String(this.params[0])
      const jobUid = String(this.params[2])
      const job = this.state.jobs.find((row) => row.job_uid === jobUid && ['queued', 'leased', 'running', 'uploading_results', 'cancel_requested'].includes(row.status))
      if (!job) return result(0)
      job.cancel_requested = 1
      job.status = status
      job.updated_at = String(this.params[1])
      return result(1)
    }
    if (normalized.startsWith('update dispatch_jobs set status')) {
      const status = String(this.params[0])
      const jobUid = String(this.params[3])
      const leaseId = String(this.params[4])
      const machineId = String(this.params[5])
      const job = this.state.jobs.find((row) => row.job_uid === jobUid && row.lease_id === leaseId && row.assigned_machine_id === machineId && ['leased', 'running', 'uploading_results', 'cancel_requested'].includes(row.status))
      if (!job) return result(0)
      job.status = status
      job.result_json = String(this.params[1])
      job.updated_at = String(this.params[2])
      return result(1)
    }
    if (normalized.startsWith('update ai_generation_requests set status')) {
      const status = String(this.params[0])
      const jobUid = String(this.params[2])
      const request = this.state.generationRequests.find((row) => row.dispatch_job_uid === jobUid)
      if (!request) return result(0)
      request.status = status
      request.updated_at = String(this.params[1])
      return result(1)
    }
    if (normalized.startsWith("update ai_image_batches set status = 'submitted'")) {
      const batch = this.state.batches.find((row) => row.batch_uid === String(this.params[1]))
      if (!batch) return result(0)
      batch.status = 'submitted'
      batch.updated_at = String(this.params[0])
      this.state.batchSubmittedWhileJobStatus = this.state.jobs.find((job) => job.batch_uid === batch.batch_uid && job.job_type === 'submit_tmall_material_test')?.status
      return result(1)
    }
    if (normalized.startsWith("update ai_image_assets set status = 'submitted'")) {
      const now = String(this.params[0])
      const batchUid = String(this.params[1])
      const assetUids = new Set(this.params.slice(2).map(String))
      let changes = 0
      for (const asset of this.state.assets) {
        if (asset.batch_uid === batchUid && asset.kind === 'ai' && assetUids.has(asset.asset_uid)) {
          asset.status = 'submitted'
          asset.updated_at = now
          changes += 1
        }
      }
      return result(changes)
    }
    if (normalized.startsWith("update ai_image_styles set status = 'submitted'")) {
      const summary = String(this.params[0])
      const batchUid = String(this.params[1])
      const styleIds = new Set([Number(this.params[2])])
      let changes = 0
      for (const style of this.state.styles) {
        if (style.batch_uid === batchUid && styleIds.has(style.id)) {
          style.status = 'submitted'
          style.submit_summary_json = summary
          changes += 1
        }
      }
      return result(changes)
    }
    return result(1)
  }
}

class FakeD1Database {
  constructor(private readonly state: FakeState) {}

  prepare(sql: string): FakeD1Statement {
    return new FakeD1Statement(this.state, sql)
  }
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase()
}

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value)
}

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

function result(changes: number, lastRowId = 0): D1Result {
  return { success: true, meta: { changes, last_row_id: lastRowId } } as D1Result
}

function fakeEnv(state: FakeState) {
  return {
    DB: new FakeD1Database(state) as unknown as D1Database,
    ASSETS: {} as R2Bucket,
    SESSION_TTL_SECONDS: '604800',
  }
}

function fetchWorker(request: Request, env: ReturnType<typeof fakeEnv>): Promise<Response> {
  return (worker.fetch as unknown as (request: Request, env: ReturnType<typeof fakeEnv>) => Promise<Response>)(request, env)
}

async function emptyState(): Promise<FakeState> {
  return {
    users: [{ id: 1, email: 'admin@example.com', name: 'Admin', status: 'active' }],
    roles: [{ id: 1, role_key: 'admin', name: '管理员' }],
    userRoles: [{ user_id: 1, role_id: 1 }],
    sessions: [],
    enrollmentTokens: [],
    machines: [],
    machineTokens: [],
    jobs: [],
    batches: [],
    styles: [],
    assets: [],
    generationRequests: [],
    events: [],
    audits: [],
  }
}

async function addSession(state: FakeState, userId: number, token: string): Promise<string> {
  state.sessions.push({
    user_id: userId,
    session_hash: await sha256Hex(token),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    revoked_at: null,
  })
  return `cs_session=${token}`
}

async function seedEnrollmentToken(state: FakeState, overrides: Partial<EnrollmentTokenRow> = {}): Promise<string> {
  const plainToken = overrides.token_hash ? 'unused' : `csr_enroll_${state.enrollmentTokens.length + 1}`
  state.enrollmentTokens.push({
    id: state.enrollmentTokens.length + 1,
    token_hash: overrides.token_hash ?? await sha256Hex(plainToken),
    label: 'test-token',
    owner_user_id: null,
    allowed_capabilities_json: JSON.stringify(['regenerate_ai_image']),
    require_approval: 1,
    status: 'issued',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    used_by_machine_id: null,
    created_by: 1,
    created_at: new Date().toISOString(),
    used_at: null,
    revoked_at: null,
    ...overrides,
  })
  return plainToken
}

async function enrollMachine(state: FakeState, token: string, capabilities = ['regenerate_ai_image']): Promise<string> {
  const nextMachineNumber = state.machines.length + 1
  const response = await fetchWorker(
    new Request('https://example.test/api/machines/enroll', {
      method: 'POST',
      body: JSON.stringify({
        enrollment_token: token,
        machine_id: `machine-${nextMachineNumber}`,
        machine_name: 'Workbench Mac',
        fingerprint: `fingerprint-${nextMachineNumber}`,
        app_version: '1.0.0',
        capabilities,
      }),
    }),
    fakeEnv(state),
  )
  const body = await response.json() as { machine_token: string }
  return body.machine_token
}

function bearer(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` }
}

describe('machine routes', () => {
  it('admin can create an enrollment token and receives the plain token once', async () => {
    const state = await emptyState()
    const cookie = await addSession(state, 1, 'admin-token')
    const response = await fetchWorker(
      new Request('https://example.test/api/admin/machine-enrollment-tokens', {
        method: 'POST',
        headers: { cookie },
        body: JSON.stringify({ label: 'Mac Studio', allowed_capabilities: ['regenerate_ai_image'], expires_in_seconds: 3600 }),
      }),
      fakeEnv(state),
    )
    const body = await response.json() as { token: string; enrollment_token: { token_hash?: string } }

    expect(response.status).toBe(201)
    expect(body.token).toMatch(/^csr_enroll_/)
    expect(body.enrollment_token.token_hash).toBeUndefined()
    expect(state.enrollmentTokens).toHaveLength(1)
    expect(state.enrollmentTokens[0].token_hash).not.toBe(body.token)
  })

  it('reusing an enrollment token fails', async () => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state)
    await enrollMachine(state, token)

    const response = await fetchWorker(
      new Request('https://example.test/api/machines/enroll', {
        method: 'POST',
        body: JSON.stringify({
          enrollment_token: token,
          machine_id: 'machine-2',
          machine_name: 'Second Mac',
          fingerprint: 'fingerprint-2',
          app_version: '1.0.0',
          capabilities: ['regenerate_ai_image'],
        }),
      }),
      fakeEnv(state),
    )

    expect(response.status).toBe(400)
  })

  it('expired enrollment token fails', async () => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state, { expires_at: new Date(Date.now() - 60_000).toISOString() })
    const response = await fetchWorker(
      new Request('https://example.test/api/machines/enroll', {
        method: 'POST',
        body: JSON.stringify({
          enrollment_token: token,
          machine_id: 'machine-1',
          machine_name: 'Expired Mac',
          fingerprint: 'fingerprint-1',
          app_version: '1.0.0',
          capabilities: ['regenerate_ai_image'],
        }),
      }),
      fakeEnv(state),
    )

    expect(response.status).toBe(400)
  })

  it('enrollment with capability outside allowed_capabilities_json fails', async () => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state)
    const response = await fetchWorker(
      new Request('https://example.test/api/machines/enroll', {
        method: 'POST',
        body: JSON.stringify({
          enrollment_token: token,
          machine_id: 'machine-1',
          machine_name: 'Wrong Mac',
          fingerprint: 'fingerprint-1',
          app_version: '1.0.0',
          capabilities: ['submit_tmall_material_test'],
        }),
      }),
      fakeEnv(state),
    )

    expect(response.status).toBe(400)
  })

  it('pending approval machine cannot claim', async () => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state)
    const machineToken = await enrollMachine(state, token)
    state.jobs.push(jobRow({ job_uid: 'job-1' }))

    const response = await fetchWorker(
      new Request('https://example.test/api/machines/jobs/claim', {
        method: 'POST',
        headers: bearer(machineToken),
      }),
      fakeEnv(state),
    )

    expect(response.status).toBe(403)
    expect(state.jobs[0].status).toBe('queued')
  })

  it('active machine can heartbeat and claim a queued job with matching capability', async () => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state)
    const machineToken = await enrollMachine(state, token)
    state.machines[0].auth_status = 'active'
    state.jobs.push(jobRow({ job_uid: 'job-1', payload_json: JSON.stringify({ style_code: 'S1' }) }))

    const heartbeat = await fetchWorker(
      new Request('https://example.test/api/machines/heartbeat', {
        method: 'POST',
        headers: bearer(machineToken),
        body: JSON.stringify({ health: 'online_idle', app_version: '1.0.1', capabilities: ['regenerate_ai_image'] }),
      }),
      fakeEnv(state),
    )
    const claim = await fetchWorker(
      new Request('https://example.test/api/machines/jobs/claim', {
        method: 'POST',
        headers: bearer(machineToken),
      }),
      fakeEnv(state),
    )
    const body = await claim.json() as { job: { job_uid: string; lease_id: string; payload: { style_code: string } } }

    expect(heartbeat.status).toBe(200)
    expect(claim.status).toBe(200)
    expect(body.job.job_uid).toBe('job-1')
    expect(body.job.lease_id).toMatch(/^lease_/)
    expect(body.job.payload.style_code).toBe('S1')
    expect(state.jobs[0].status).toBe('leased')
    expect(state.jobs[0].attempt_count).toBe(1)
    expect(state.jobs[0].assigned_machine_id).toBe('machine-1')
    expect(state.machines[0].capabilities_json).toBe(JSON.stringify(['regenerate_ai_image']))
  })

  it.each([
    { label: 'expired leased', status: 'leased' },
    { label: 'expired running', status: 'running' },
    { label: 'expired uploading', status: 'uploading_results' },
    { label: 'retryable failed', status: 'retryable_failed' },
  ])('recovers and claims $label jobs when attempts remain', async ({ status }) => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state)
    const machineToken = await enrollMachine(state, token)
    state.machines[0].auth_status = 'active'
    state.machines[0].health = 'online_idle'
    state.jobs.push(jobRow({
      job_uid: `job-${status}`,
      status,
      assigned_machine_id: 'machine-old',
      lease_id: 'lease-old',
      lease_expires_at: new Date(Date.now() - 60_000).toISOString(),
      attempt_count: 1,
      max_attempts: 3,
    }))

    const response = await fetchWorker(
      new Request('https://example.test/api/machines/jobs/claim', {
        method: 'POST',
        headers: bearer(machineToken),
      }),
      fakeEnv(state),
    )
    const body = await response.json() as { job: { job_uid: string; attempt_count: number } }

    expect(response.status).toBe(200)
    expect(body.job.job_uid).toBe(`job-${status}`)
    expect(body.job.attempt_count).toBe(2)
    expect(state.jobs[0].status).toBe('leased')
    expect(state.jobs[0].assigned_machine_id).toBe('machine-1')
  })

  it('expires cancel-requested leases as cancelled instead of reclaiming them', async () => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state)
    const machineToken = await enrollMachine(state, token)
    state.machines[0].auth_status = 'active'
    state.machines[0].health = 'online_idle'
    state.jobs.push(jobRow({
      job_uid: 'job-cancel-expired',
      status: 'cancel_requested',
      cancel_requested: 1,
      assigned_machine_id: 'machine-old',
      lease_id: 'lease-old',
      lease_expires_at: new Date(Date.now() - 60_000).toISOString(),
      attempt_count: 1,
      max_attempts: 3,
    }))

    const response = await fetchWorker(
      new Request('https://example.test/api/machines/jobs/claim', {
        method: 'POST',
        headers: bearer(machineToken),
      }),
      fakeEnv(state),
    )
    const body = await response.json() as { job: null }

    expect(response.status).toBe(200)
    expect(body.job).toBeNull()
    expect(state.jobs[0].status).toBe('cancelled')
    expect(state.jobs[0].assigned_machine_id).toBeNull()
    expect(state.jobs[0].lease_id).toBeNull()
    expect(state.jobs[0].lease_expires_at).toBeNull()
  })

  it('does not claim queued jobs with cancel requested even if state is malformed', async () => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state)
    const machineToken = await enrollMachine(state, token)
    state.machines[0].auth_status = 'active'
    state.machines[0].health = 'online_idle'
    state.jobs.push(jobRow({
      job_uid: 'job-cancel-queued',
      status: 'queued',
      cancel_requested: 1,
    }))

    const response = await fetchWorker(
      new Request('https://example.test/api/machines/jobs/claim', {
        method: 'POST',
        headers: bearer(machineToken),
      }),
      fakeEnv(state),
    )
    const body = await response.json() as { job: null }

    expect(response.status).toBe(200)
    expect(body.job).toBeNull()
    expect(state.jobs[0].status).toBe('queued')
    expect(state.jobs[0].lease_id).toBeNull()
    expect(state.jobs[0].assigned_machine_id).toBeNull()
  })

  it.each([
    { label: 'expired leased', status: 'leased', lease_expires_at: new Date(Date.now() - 60_000).toISOString() },
    { label: 'retryable failed', status: 'retryable_failed', lease_expires_at: null },
  ])('does not recover $label jobs after attempts are exhausted', async ({ status, lease_expires_at }) => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state)
    const machineToken = await enrollMachine(state, token)
    state.machines[0].auth_status = 'active'
    state.machines[0].health = 'online_idle'
    state.jobs.push(jobRow({
      job_uid: `job-exhausted-${status}`,
      status,
      assigned_machine_id: 'machine-old',
      lease_id: 'lease-old',
      lease_expires_at,
      attempt_count: 3,
      max_attempts: 3,
    }))

    const response = await fetchWorker(
      new Request('https://example.test/api/machines/jobs/claim', {
        method: 'POST',
        headers: bearer(machineToken),
      }),
      fakeEnv(state),
    )
    const body = await response.json() as { job: null }

    expect(response.status).toBe(200)
    expect(body.job).toBeNull()
    expect(state.jobs[0].status).toBe(status)
    expect(state.jobs[0].assigned_machine_id).toBe('machine-old')
  })

  it('does not recover terminal submit failures during claim', async () => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state, {
      allowed_capabilities_json: JSON.stringify(['submit_tmall_material_test']),
    })
    const machineToken = await enrollMachine(state, token, ['submit_tmall_material_test'])
    state.machines[0].auth_status = 'active'
    state.machines[0].health = 'online_idle'
    state.jobs.push(jobRow({
      job_uid: 'job-terminal-submit',
      job_type: 'submit_tmall_material_test',
      status: 'terminal_failed',
      required_capabilities_json: JSON.stringify(['submit_tmall_material_test']),
      attempt_count: 1,
      max_attempts: 3,
    }))

    const response = await fetchWorker(
      new Request('https://example.test/api/machines/jobs/claim', {
        method: 'POST',
        headers: bearer(machineToken),
      }),
      fakeEnv(state),
    )
    const body = await response.json() as { job: null }

    expect(response.status).toBe(200)
    expect(body.job).toBeNull()
    expect(state.jobs[0].status).toBe('terminal_failed')
  })

  it('rejects heartbeat capability expansion and blocks submit-only claims', async () => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state)
    const machineToken = await enrollMachine(state, token, ['regenerate_ai_image'])
    state.machines[0].auth_status = 'active'
    state.machines[0].health = 'online_idle'
    state.jobs.push(jobRow({
      job_uid: 'job-submit',
      job_type: 'submit_tmall_material_test',
      required_capabilities_json: JSON.stringify(['submit_tmall_material_test']),
    }))

    const heartbeat = await fetchWorker(
      new Request('https://example.test/api/machines/heartbeat', {
        method: 'POST',
        headers: bearer(machineToken),
        body: JSON.stringify({ health: 'online_idle', capabilities: ['regenerate_ai_image', 'submit_tmall_material_test'] }),
      }),
      fakeEnv(state),
    )
    const claim = await fetchWorker(
      new Request('https://example.test/api/machines/jobs/claim', {
        method: 'POST',
        headers: bearer(machineToken),
      }),
      fakeEnv(state),
    )
    const claimBody = await claim.json() as { job: null }

    expect(heartbeat.status).toBe(400)
    expect(state.machines[0].capabilities_json).toBe(JSON.stringify(['regenerate_ai_image']))
    expect(claim.status).toBe(200)
    expect(claimBody.job).toBeNull()
    expect(state.jobs[0].status).toBe('queued')
  })

  it('persists heartbeat capability narrowing and stops claiming dropped capabilities', async () => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state, {
      allowed_capabilities_json: JSON.stringify(['regenerate_ai_image', 'submit_tmall_material_test']),
    })
    const machineToken = await enrollMachine(state, token, ['regenerate_ai_image', 'submit_tmall_material_test'])
    state.machines[0].auth_status = 'active'
    state.machines[0].health = 'online_idle'
    state.jobs.push(jobRow({
      job_uid: 'job-submit',
      job_type: 'submit_tmall_material_test',
      required_capabilities_json: JSON.stringify(['submit_tmall_material_test']),
    }))

    const heartbeat = await fetchWorker(
      new Request('https://example.test/api/machines/heartbeat', {
        method: 'POST',
        headers: bearer(machineToken),
        body: JSON.stringify({ health: 'online_idle', capabilities: ['regenerate_ai_image'] }),
      }),
      fakeEnv(state),
    )
    const claim = await fetchWorker(
      new Request('https://example.test/api/machines/jobs/claim', {
        method: 'POST',
        headers: bearer(machineToken),
      }),
      fakeEnv(state),
    )
    const claimBody = await claim.json() as { job: null }

    expect(heartbeat.status).toBe(200)
    expect(state.machines[0].capabilities_json).toBe(JSON.stringify(['regenerate_ai_image']))
    expect(claim.status).toBe(200)
    expect(claimBody.job).toBeNull()
    expect(state.jobs[0].status).toBe('queued')
  })

  it('restores originally authorized capabilities after a narrowed heartbeat', async () => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state, {
      allowed_capabilities_json: JSON.stringify(['regenerate_ai_image', 'submit_tmall_material_test']),
    })
    const machineToken = await enrollMachine(state, token, ['regenerate_ai_image', 'submit_tmall_material_test'])
    state.machines[0].auth_status = 'active'
    state.machines[0].health = 'online_idle'
    state.jobs.push(jobRow({
      job_uid: 'job-submit',
      job_type: 'submit_tmall_material_test',
      required_capabilities_json: JSON.stringify(['submit_tmall_material_test']),
    }))

    const narrowHeartbeat = await fetchWorker(
      new Request('https://example.test/api/machines/heartbeat', {
        method: 'POST',
        headers: bearer(machineToken),
        body: JSON.stringify({ health: 'online_idle', capabilities: ['regenerate_ai_image'] }),
      }),
      fakeEnv(state),
    )
    const blockedClaim = await fetchWorker(
      new Request('https://example.test/api/machines/jobs/claim', {
        method: 'POST',
        headers: bearer(machineToken),
      }),
      fakeEnv(state),
    )
    const blockedClaimBody = await blockedClaim.json() as { job: null }

    expect(narrowHeartbeat.status).toBe(200)
    expect(blockedClaim.status).toBe(200)
    expect(blockedClaimBody.job).toBeNull()
    expect(state.jobs[0].status).toBe('queued')

    const restoredHeartbeat = await fetchWorker(
      new Request('https://example.test/api/machines/heartbeat', {
        method: 'POST',
        headers: bearer(machineToken),
        body: JSON.stringify({ health: 'online_idle', capabilities: ['submit_tmall_material_test'] }),
      }),
      fakeEnv(state),
    )
    const restoredClaim = await fetchWorker(
      new Request('https://example.test/api/machines/jobs/claim', {
        method: 'POST',
        headers: bearer(machineToken),
      }),
      fakeEnv(state),
    )
    const restoredClaimBody = await restoredClaim.json() as { job: { job_uid: string } }

    expect(restoredHeartbeat.status).toBe(200)
    expect(state.machines[0].capabilities_json).toBe(JSON.stringify(['submit_tmall_material_test']))
    expect(restoredClaim.status).toBe(200)
    expect(restoredClaimBody.job.job_uid).toBe('job-submit')
    expect(state.jobs[0].status).toBe('leased')
  })

  it('rejects never-authorized heartbeat capabilities without expanding current capabilities', async () => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state, {
      allowed_capabilities_json: JSON.stringify(['regenerate_ai_image', 'submit_tmall_material_test']),
    })
    const machineToken = await enrollMachine(state, token, ['regenerate_ai_image', 'submit_tmall_material_test'])
    state.machines[0].auth_status = 'active'

    const narrowHeartbeat = await fetchWorker(
      new Request('https://example.test/api/machines/heartbeat', {
        method: 'POST',
        headers: bearer(machineToken),
        body: JSON.stringify({ health: 'online_idle', capabilities: ['regenerate_ai_image'] }),
      }),
      fakeEnv(state),
    )
    const invalidHeartbeat = await fetchWorker(
      new Request('https://example.test/api/machines/heartbeat', {
        method: 'POST',
        headers: bearer(machineToken),
        body: JSON.stringify({ health: 'online_idle', capabilities: ['regenerate_ai_image', 'export_platform_product'] }),
      }),
      fakeEnv(state),
    )

    expect(narrowHeartbeat.status).toBe(200)
    expect(invalidHeartbeat.status).toBe(400)
    expect(state.machines[0].capabilities_json).toBe(JSON.stringify(['regenerate_ai_image']))
  })

  it('does not lease a selected job when required capabilities changed before update', async () => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state, {
      allowed_capabilities_json: JSON.stringify(['regenerate_ai_image', 'submit_tmall_material_test']),
    })
    const machineToken = await enrollMachine(state, token, ['regenerate_ai_image'])
    state.machines[0].auth_status = 'active'
    state.machines[0].health = 'online_idle'
    state.jobs.push(jobRow({ job_uid: 'job-race' }))
    state.claimRaceRequiredCapabilitiesJson = JSON.stringify(['submit_tmall_material_test'])

    const claim = await fetchWorker(
      new Request('https://example.test/api/machines/jobs/claim', {
        method: 'POST',
        headers: bearer(machineToken),
      }),
      fakeEnv(state),
    )
    const claimBody = await claim.json() as { job: null }

    expect(claim.status).toBe(200)
    expect(claimBody.job).toBeNull()
    expect(state.jobs[0].status).toBe('queued')
    expect(state.jobs[0].assigned_machine_id).toBeNull()
    expect(state.jobs[0].required_capabilities_json).toBe(JSON.stringify(['submit_tmall_material_test']))
  })

  it.each([
    { label: 'disabled', authStatus: 'disabled', health: undefined },
    { label: 'revoked', authStatus: 'revoked', health: undefined },
    { label: 'unhealthy', authStatus: undefined, health: 'needs_login' },
  ])('does not lease a selected job when the machine becomes $label before update', async ({ authStatus, health }) => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state)
    const machineToken = await enrollMachine(state, token, ['regenerate_ai_image'])
    state.machines[0].auth_status = 'active'
    state.machines[0].health = 'online_idle'
    state.jobs.push(jobRow({ job_uid: 'job-machine-race' }))
    state.claimRaceMachineAuthStatus = authStatus
    state.claimRaceMachineHealth = health

    const claim = await fetchWorker(
      new Request('https://example.test/api/machines/jobs/claim', {
        method: 'POST',
        headers: bearer(machineToken),
      }),
      fakeEnv(state),
    )
    const claimBody = await claim.json() as { job: null }

    expect(claim.status).toBe(200)
    expect(claimBody.job).toBeNull()
    expect(state.jobs[0].status).toBe('queued')
    expect(state.jobs[0].assigned_machine_id).toBeNull()
  })

  it('does not lease a selected job when current machine capabilities narrow before update', async () => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state, {
      allowed_capabilities_json: JSON.stringify(['regenerate_ai_image', 'submit_tmall_material_test']),
    })
    const machineToken = await enrollMachine(state, token, ['regenerate_ai_image', 'submit_tmall_material_test'])
    state.machines[0].auth_status = 'active'
    state.machines[0].health = 'online_idle'
    state.jobs.push(jobRow({ job_uid: 'job-capability-race' }))
    state.claimRaceMachineCapabilitiesJson = JSON.stringify(['submit_tmall_material_test'])

    const claim = await fetchWorker(
      new Request('https://example.test/api/machines/jobs/claim', {
        method: 'POST',
        headers: bearer(machineToken),
      }),
      fakeEnv(state),
    )
    const claimBody = await claim.json() as { job: null }

    expect(claim.status).toBe(200)
    expect(claimBody.job).toBeNull()
    expect(state.jobs[0].status).toBe('queued')
    expect(state.jobs[0].assigned_machine_id).toBeNull()
    expect(state.machines[0].capabilities_json).toBe(JSON.stringify(['submit_tmall_material_test']))
  })

  it('claim returns next_poll_after_seconds when no jobs are available', async () => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state)
    const machineToken = await enrollMachine(state, token)
    state.machines[0].auth_status = 'active'
    state.machines[0].health = 'online_idle'

    const response = await fetchWorker(
      new Request('https://example.test/api/machines/jobs/claim', {
        method: 'POST',
        headers: bearer(machineToken),
      }),
      fakeEnv(state),
    )
    const body = await response.json() as { job: null; next_poll_after_seconds: number }

    expect(response.status).toBe(200)
    expect(body.job).toBeNull()
    expect(body.next_poll_after_seconds).toBe(10)
  })

  it('rejects stale lease writes', async () => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state)
    const machineToken = await enrollMachine(state, token)
    state.machines[0].auth_status = 'active'
    state.machines[0].health = 'online_busy'
    state.machines[0].current_job_id = 'job-1'
    state.jobs.push(jobRow({ job_uid: 'job-1', status: 'leased', lease_id: 'lease-current' }))

    const response = await fetchWorker(
      new Request('https://example.test/api/jobs/job-1/progress', {
        method: 'POST',
        headers: bearer(machineToken),
        body: JSON.stringify({ lease_id: 'lease-old', result: { pct: 50 } }),
      }),
      fakeEnv(state),
    )

    expect(response.status).toBe(403)
    expect(state.jobs[0].status).toBe('leased')
  })

  it('lets user sessions request cancellation and leased machines observe it on renew', async () => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state)
    const machineToken = await enrollMachine(state, token)
    state.machines[0].auth_status = 'active'
    state.machines[0].health = 'online_busy'
    state.machines[0].current_job_id = 'job-1'
    state.jobs.push(jobRow({ job_uid: 'job-1', status: 'running', assigned_machine_id: 'machine-1', lease_id: 'lease-current' }))
    const cookie = await addSession(state, 1, 'admin-cancel-token')

    const cancel = await fetchWorker(
      new Request('https://example.test/api/jobs/job-1/cancel', {
        method: 'POST',
        headers: { cookie },
      }),
      fakeEnv(state),
    )
    const renew = await fetchWorker(
      new Request('https://example.test/api/jobs/job-1/renew', {
        method: 'POST',
        headers: bearer(machineToken),
        body: JSON.stringify({ lease_id: 'lease-current' }),
      }),
      fakeEnv(state),
    )
    const body = await renew.json() as { cancel_requested: boolean }

    expect(cancel.status).toBe(200)
    expect(state.jobs[0].status).toBe('cancel_requested')
    expect(state.jobs[0].cancel_requested).toBe(1)
    expect(body.cancel_requested).toBe(true)
  })

  it('persists blocked_needs_login failures and keeps machine health needs_login', async () => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state)
    const machineToken = await enrollMachine(state, token)
    state.machines[0].auth_status = 'active'
    state.machines[0].health = 'online_busy'
    state.machines[0].current_job_id = 'job-login'
    state.jobs.push(jobRow({
      job_uid: 'job-login',
      status: 'leased',
      lease_id: 'lease-login',
      assigned_machine_id: 'machine-1',
    }))

    const response = await fetchWorker(
      new Request('https://example.test/api/jobs/job-login/fail', {
        method: 'POST',
        headers: bearer(machineToken),
        body: JSON.stringify({
          lease_id: 'lease-login',
          status: 'blocked_needs_login',
          terminal: false,
          message: 'Chrome CDP unavailable',
          result: { status: 'blocked_needs_login' },
        }),
      }),
      fakeEnv(state),
    )
    const body = await response.json() as { status: string }

    expect(response.status).toBe(200)
    expect(body.status).toBe('blocked_needs_login')
    expect(state.jobs[0].status).toBe('blocked_needs_login')
    expect(JSON.parse(state.jobs[0].result_json)).toEqual({ status: 'blocked_needs_login' })
    expect(state.machines[0].current_job_id).toBeNull()
    expect(state.machines[0].health).toBe('needs_login')
  })

  it('persists submitted batch, style, and approved AI asset state when a submit job completes', async () => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state, {
      allowed_capabilities_json: JSON.stringify(['submit_tmall_material_test']),
    })
    const machineToken = await enrollMachine(state, token, ['submit_tmall_material_test'])
    state.machines[0].auth_status = 'active'
    state.machines[0].health = 'online_busy'
    state.machines[0].current_job_id = 'job-submit'
    state.batches.push({ id: 1, batch_uid: 'batch-1', status: 'ready_to_submit', updated_at: '2026-01-01T00:00:00.000Z' })
    state.styles.push({ id: 10, batch_uid: 'batch-1', style_code: 'style-1', status: 'approved', submit_summary_json: '{}' })
    state.assets.push(
      { id: 1, asset_uid: 'source-1', batch_uid: 'batch-1', style_id: 10, kind: 'source', status: 'uploaded', updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 2, asset_uid: 'ai-approved-1', batch_uid: 'batch-1', style_id: 10, kind: 'ai', status: 'approved', updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 3, asset_uid: 'ai-rejected-1', batch_uid: 'batch-1', style_id: 10, kind: 'ai', status: 'rejected', updated_at: '2026-01-01T00:00:00.000Z' },
    )
    state.jobs.push(jobRow({
      job_uid: 'job-submit',
      batch_uid: 'batch-1',
      job_type: 'submit_tmall_material_test',
      status: 'leased',
      lease_id: 'lease-submit',
      assigned_machine_id: 'machine-1',
      required_capabilities_json: JSON.stringify(['submit_tmall_material_test']),
      payload_json: JSON.stringify({
        submit_plan: {
          batch_uid: 'batch-1',
          assets: [
            { asset_uid: 'source-1', style_id: 10, kind: 'source' },
            { asset_uid: 'ai-approved-1', style_id: 10, kind: 'ai' },
          ],
        },
      }),
    }))

    const response = await fetchWorker(
      new Request('https://example.test/api/jobs/job-submit/complete', {
        method: 'POST',
        headers: bearer(machineToken),
        body: JSON.stringify({ lease_id: 'lease-submit', result: { dry_run: true } }),
      }),
      fakeEnv(state),
    )

    expect(response.status).toBe(200)
    expect(state.jobs[0].status).toBe('succeeded')
    expect(state.batches[0].status).toBe('submitted')
    expect(state.batchSubmittedWhileJobStatus).toBe('uploading_results')
    expect(state.assets.map((asset) => [asset.asset_uid, asset.status])).toEqual([
      ['source-1', 'uploaded'],
      ['ai-approved-1', 'submitted'],
      ['ai-rejected-1', 'rejected'],
    ])
    expect(state.styles[0].status).toBe('submitted')
    expect(JSON.parse(state.styles[0].submit_summary_json)).toMatchObject({
      job_uid: 'job-submit',
      submitted_asset_uids: ['ai-approved-1'],
    })
  })

  it('does not mark batch or style submitted when a submit plan asset is no longer approved', async () => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state, {
      allowed_capabilities_json: JSON.stringify(['submit_tmall_material_test']),
    })
    const machineToken = await enrollMachine(state, token, ['submit_tmall_material_test'])
    state.machines[0].auth_status = 'active'
    state.machines[0].health = 'online_busy'
    state.machines[0].current_job_id = 'job-submit-stale'
    state.batches.push({ id: 1, batch_uid: 'batch-1', status: 'ready_to_submit', updated_at: '2026-01-01T00:00:00.000Z' })
    state.styles.push({ id: 10, batch_uid: 'batch-1', style_code: 'style-1', status: 'approved', submit_summary_json: '{}' })
    state.assets.push(
      { id: 1, asset_uid: 'source-1', batch_uid: 'batch-1', style_id: 10, kind: 'source', status: 'uploaded', updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 2, asset_uid: 'ai-approved-1', batch_uid: 'batch-1', style_id: 10, kind: 'ai', status: 'rejected', updated_at: '2026-01-01T00:00:00.000Z' },
    )
    state.jobs.push(jobRow({
      job_uid: 'job-submit-stale',
      batch_uid: 'batch-1',
      job_type: 'submit_tmall_material_test',
      status: 'leased',
      lease_id: 'lease-submit',
      assigned_machine_id: 'machine-1',
      required_capabilities_json: JSON.stringify(['submit_tmall_material_test']),
      payload_json: JSON.stringify({
        submit_plan: {
          batch_uid: 'batch-1',
          assets: [
            { asset_uid: 'source-1', style_id: 10, kind: 'source' },
            { asset_uid: 'ai-approved-1', style_id: 10, kind: 'ai' },
          ],
        },
      }),
    }))

    const response = await fetchWorker(
      new Request('https://example.test/api/jobs/job-submit-stale/complete', {
        method: 'POST',
        headers: bearer(machineToken),
        body: JSON.stringify({ lease_id: 'lease-submit', result: { dry_run: true } }),
      }),
      fakeEnv(state),
    )

    expect(response.status).toBe(200)
    expect(state.jobs[0].status).toBe('succeeded')
    expect(state.batches[0].status).toBe('ready_to_submit')
    expect(state.assets.map((asset) => [asset.asset_uid, asset.status])).toEqual([
      ['source-1', 'uploaded'],
      ['ai-approved-1', 'rejected'],
    ])
    expect(state.styles[0].status).toBe('approved')
    expect(state.styles[0].submit_summary_json).toBe('{}')
  })

  it('does not mark the batch submitted when only part of the submit plan remains approved', async () => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state, {
      allowed_capabilities_json: JSON.stringify(['submit_tmall_material_test']),
    })
    const machineToken = await enrollMachine(state, token, ['submit_tmall_material_test'])
    state.machines[0].auth_status = 'active'
    state.machines[0].health = 'online_busy'
    state.machines[0].current_job_id = 'job-submit-partial-stale'
    state.batches.push({ id: 1, batch_uid: 'batch-1', status: 'ready_to_submit', updated_at: '2026-01-01T00:00:00.000Z' })
    state.styles.push(
      { id: 10, batch_uid: 'batch-1', style_code: 'style-1', status: 'approved', submit_summary_json: '{}' },
      { id: 11, batch_uid: 'batch-1', style_code: 'style-2', status: 'approved', submit_summary_json: '{}' },
    )
    state.assets.push(
      { id: 1, asset_uid: 'source-1', batch_uid: 'batch-1', style_id: 10, kind: 'source', status: 'uploaded', updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 2, asset_uid: 'ai-approved-1', batch_uid: 'batch-1', style_id: 10, kind: 'ai', status: 'approved', updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 3, asset_uid: 'source-2', batch_uid: 'batch-1', style_id: 11, kind: 'source', status: 'uploaded', updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 4, asset_uid: 'ai-stale-2', batch_uid: 'batch-1', style_id: 11, kind: 'ai', status: 'rejected', updated_at: '2026-01-01T00:00:00.000Z' },
    )
    state.jobs.push(jobRow({
      job_uid: 'job-submit-partial-stale',
      batch_uid: 'batch-1',
      job_type: 'submit_tmall_material_test',
      status: 'leased',
      lease_id: 'lease-submit',
      assigned_machine_id: 'machine-1',
      required_capabilities_json: JSON.stringify(['submit_tmall_material_test']),
      payload_json: JSON.stringify({
        submit_plan: {
          batch_uid: 'batch-1',
          assets: [
            { asset_uid: 'source-1', style_id: 10, kind: 'source' },
            { asset_uid: 'ai-approved-1', style_id: 10, kind: 'ai' },
            { asset_uid: 'source-2', style_id: 11, kind: 'source' },
            { asset_uid: 'ai-stale-2', style_id: 11, kind: 'ai' },
          ],
        },
      }),
    }))

    const response = await fetchWorker(
      new Request('https://example.test/api/jobs/job-submit-partial-stale/complete', {
        method: 'POST',
        headers: bearer(machineToken),
        body: JSON.stringify({ lease_id: 'lease-submit', result: { dry_run: true } }),
      }),
      fakeEnv(state),
    )

    expect(response.status).toBe(200)
    expect(state.jobs[0].status).toBe('succeeded')
    expect(state.batches[0].status).toBe('ready_to_submit')
    expect(state.assets.map((asset) => [asset.asset_uid, asset.status])).toEqual([
      ['source-1', 'uploaded'],
      ['ai-approved-1', 'approved'],
      ['source-2', 'uploaded'],
      ['ai-stale-2', 'rejected'],
    ])
    expect(state.styles.map((style) => [style.style_code, style.status, style.submit_summary_json])).toEqual([
      ['style-1', 'approved', '{}'],
      ['style-2', 'approved', '{}'],
    ])
  })

  it('does not mark the batch submitted when current approvals include AI assets missing from the submit plan', async () => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state, {
      allowed_capabilities_json: JSON.stringify(['submit_tmall_material_test']),
    })
    const machineToken = await enrollMachine(state, token, ['submit_tmall_material_test'])
    state.machines[0].auth_status = 'active'
    state.machines[0].health = 'online_busy'
    state.machines[0].current_job_id = 'job-submit-extra-approved'
    state.batches.push({ id: 1, batch_uid: 'batch-1', status: 'ready_to_submit', updated_at: '2026-01-01T00:00:00.000Z' })
    state.styles.push(
      { id: 10, batch_uid: 'batch-1', style_code: 'style-1', status: 'approved', submit_summary_json: '{}' },
      { id: 11, batch_uid: 'batch-1', style_code: 'style-2', status: 'approved', submit_summary_json: '{}' },
    )
    state.assets.push(
      { id: 1, asset_uid: 'source-1', batch_uid: 'batch-1', style_id: 10, kind: 'source', status: 'uploaded', updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 2, asset_uid: 'ai-approved-1', batch_uid: 'batch-1', style_id: 10, kind: 'ai', status: 'approved', updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 3, asset_uid: 'source-2', batch_uid: 'batch-1', style_id: 11, kind: 'source', status: 'uploaded', updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 4, asset_uid: 'ai-extra-2', batch_uid: 'batch-1', style_id: 11, kind: 'ai', status: 'approved', updated_at: '2026-01-01T00:00:00.000Z' },
    )
    state.jobs.push(jobRow({
      job_uid: 'job-submit-extra-approved',
      batch_uid: 'batch-1',
      job_type: 'submit_tmall_material_test',
      status: 'leased',
      lease_id: 'lease-submit',
      assigned_machine_id: 'machine-1',
      required_capabilities_json: JSON.stringify(['submit_tmall_material_test']),
      payload_json: JSON.stringify({
        submit_plan: {
          batch_uid: 'batch-1',
          assets: [
            { asset_uid: 'source-1', style_id: 10, kind: 'source' },
            { asset_uid: 'ai-approved-1', style_id: 10, kind: 'ai' },
          ],
        },
      }),
    }))

    const response = await fetchWorker(
      new Request('https://example.test/api/jobs/job-submit-extra-approved/complete', {
        method: 'POST',
        headers: bearer(machineToken),
        body: JSON.stringify({ lease_id: 'lease-submit', result: { dry_run: true } }),
      }),
      fakeEnv(state),
    )

    expect(response.status).toBe(200)
    expect(state.jobs[0].status).toBe('succeeded')
    expect(state.batches[0].status).toBe('ready_to_submit')
    expect(state.assets.map((asset) => [asset.asset_uid, asset.status])).toEqual([
      ['source-1', 'uploaded'],
      ['ai-approved-1', 'approved'],
      ['source-2', 'uploaded'],
      ['ai-extra-2', 'approved'],
    ])
    expect(state.styles.map((style) => [style.style_code, style.status, style.submit_summary_json])).toEqual([
      ['style-1', 'approved', '{}'],
      ['style-2', 'approved', '{}'],
    ])
  })

  it('does not treat duplicate planned AI asset IDs as a full approved set match', async () => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state, {
      allowed_capabilities_json: JSON.stringify(['submit_tmall_material_test']),
    })
    const machineToken = await enrollMachine(state, token, ['submit_tmall_material_test'])
    state.machines[0].auth_status = 'active'
    state.machines[0].health = 'online_busy'
    state.machines[0].current_job_id = 'job-submit-duplicate-plan'
    state.batches.push({ id: 1, batch_uid: 'batch-1', status: 'ready_to_submit', updated_at: '2026-01-01T00:00:00.000Z' })
    state.styles.push(
      { id: 10, batch_uid: 'batch-1', style_code: 'style-1', status: 'approved', submit_summary_json: '{}' },
      { id: 11, batch_uid: 'batch-1', style_code: 'style-2', status: 'approved', submit_summary_json: '{}' },
    )
    state.assets.push(
      { id: 1, asset_uid: 'ai-approved-1', batch_uid: 'batch-1', style_id: 10, kind: 'ai', status: 'approved', updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 2, asset_uid: 'ai-approved-2', batch_uid: 'batch-1', style_id: 11, kind: 'ai', status: 'approved', updated_at: '2026-01-01T00:00:00.000Z' },
    )
    state.jobs.push(jobRow({
      job_uid: 'job-submit-duplicate-plan',
      batch_uid: 'batch-1',
      job_type: 'submit_tmall_material_test',
      status: 'leased',
      lease_id: 'lease-submit',
      assigned_machine_id: 'machine-1',
      required_capabilities_json: JSON.stringify(['submit_tmall_material_test']),
      payload_json: JSON.stringify({
        submit_plan: {
          batch_uid: 'batch-1',
          assets: [
            { asset_uid: 'ai-approved-1', style_id: 10, kind: 'ai' },
            { asset_uid: 'ai-approved-1', style_id: 10, kind: 'ai' },
          ],
        },
      }),
    }))

    const response = await fetchWorker(
      new Request('https://example.test/api/jobs/job-submit-duplicate-plan/complete', {
        method: 'POST',
        headers: bearer(machineToken),
        body: JSON.stringify({ lease_id: 'lease-submit', result: { dry_run: true } }),
      }),
      fakeEnv(state),
    )

    expect(response.status).toBe(200)
    expect(state.jobs[0].status).toBe('succeeded')
    expect(state.batches[0].status).toBe('ready_to_submit')
    expect(state.assets.map((asset) => [asset.asset_uid, asset.status])).toEqual([
      ['ai-approved-1', 'approved'],
      ['ai-approved-2', 'approved'],
    ])
    expect(state.styles.map((style) => [style.style_code, style.status, style.submit_summary_json])).toEqual([
      ['style-1', 'approved', '{}'],
      ['style-2', 'approved', '{}'],
    ])
  })

  it('records the dispatch job lease holder and rejects same-lease writes from another machine', async () => {
    const state = await emptyState()
    const tokenOne = await seedEnrollmentToken(state, { id: 1 })
    const tokenTwo = await seedEnrollmentToken(state, { id: 2 })
    const machineTokenOne = await enrollMachine(state, tokenOne)
    const machineTokenTwo = await enrollMachine(state, tokenTwo)
    state.machines[0].auth_status = 'active'
    state.machines[0].health = 'online_idle'
    state.machines[1].auth_status = 'active'
    state.machines[1].health = 'online_busy'
    state.jobs.push(jobRow({ job_uid: 'job-lease-holder' }))

    const claim = await fetchWorker(
      new Request('https://example.test/api/machines/jobs/claim', {
        method: 'POST',
        headers: bearer(machineTokenOne),
      }),
      fakeEnv(state),
    )
    const claimBody = await claim.json() as { job: { lease_id: string } }

    expect(claim.status).toBe(200)
    expect(state.jobs[0].assigned_machine_id).toBe('machine-1')

    for (const action of ['renew', 'progress', 'complete', 'fail']) {
      state.jobs[0].status = 'leased'
      const response = await fetchWorker(
        new Request(`https://example.test/api/jobs/job-lease-holder/${action}`, {
          method: 'POST',
          headers: bearer(machineTokenTwo),
          body: JSON.stringify({ lease_id: claimBody.job.lease_id, result: { ok: true } }),
        }),
        fakeEnv(state),
      )
      expect(response.status).toBe(403)
      expect(state.jobs[0].assigned_machine_id).toBe('machine-1')
      expect(state.jobs[0].status).toBe('leased')
    }
  })

  it('updates generation request status when generate_ai_image jobs complete or fail', async () => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state, {
      allowed_capabilities_json: JSON.stringify(['generate_ai_image']),
    })
    const machineToken = await enrollMachine(state, token, ['generate_ai_image'])
    state.machines[0].auth_status = 'active'
    state.machines[0].health = 'online_busy'
    state.jobs.push(
      jobRow({
        job_uid: 'job-generate-complete',
        job_type: 'generate_ai_image',
        status: 'running',
        assigned_machine_id: 'machine-1',
        required_capabilities_json: JSON.stringify(['generate_ai_image']),
        lease_id: 'lease-complete',
      }),
      jobRow({
        id: 2,
        job_uid: 'job-generate-fail',
        job_type: 'generate_ai_image',
        status: 'running',
        assigned_machine_id: 'machine-1',
        required_capabilities_json: JSON.stringify(['generate_ai_image']),
        lease_id: 'lease-fail',
      }),
    )
    state.generationRequests.push(
      { request_uid: 'gen-request-complete', dispatch_job_uid: 'job-generate-complete', status: 'queued', updated_at: '2026-01-01T00:00:00.000Z' },
      { request_uid: 'gen-request-fail', dispatch_job_uid: 'job-generate-fail', status: 'queued', updated_at: '2026-01-01T00:00:00.000Z' },
    )

    const complete = await fetchWorker(new Request('https://example.test/api/jobs/job-generate-complete/complete', {
      method: 'POST',
      headers: bearer(machineToken),
      body: JSON.stringify({ lease_id: 'lease-complete', result: { generated_asset_uids: ['asset-ai-result-1'] } }),
    }), fakeEnv(state))
    state.machines[0].health = 'online_busy'
    const fail = await fetchWorker(new Request('https://example.test/api/jobs/job-generate-fail/fail', {
      method: 'POST',
      headers: bearer(machineToken),
      body: JSON.stringify({ lease_id: 'lease-fail', result: { error: 'provider timeout' } }),
    }), fakeEnv(state))

    expect(complete.status).toBe(200)
    expect(fail.status).toBe(200)
    expect(state.generationRequests.map((request) => [request.request_uid, request.status])).toEqual([
      ['gen-request-complete', 'completed'],
      ['gen-request-fail', 'failed'],
    ])
  })

  it('claims a matching job beyond earlier non-matching queued jobs', async () => {
    const state = await emptyState()
    const token = await seedEnrollmentToken(state)
    const machineToken = await enrollMachine(state, token, ['regenerate_ai_image'])
    state.machines[0].auth_status = 'active'
    state.machines[0].health = 'online_idle'
    const baseTime = Date.now()
    for (let index = 0; index < 25; index += 1) {
      state.jobs.push(jobRow({
        id: index + 1,
        job_uid: `job-submit-${index}`,
        job_type: 'submit_tmall_material_test',
        required_capabilities_json: JSON.stringify(['submit_tmall_material_test']),
        priority: index + 1,
        created_at: new Date(baseTime + index).toISOString(),
      }))
    }
    state.jobs.push(jobRow({
      id: 26,
      job_uid: 'job-regenerate-claimable',
      priority: 26,
      created_at: new Date(baseTime + 26).toISOString(),
    }))

    const response = await fetchWorker(
      new Request('https://example.test/api/machines/jobs/claim', {
        method: 'POST',
        headers: bearer(machineToken),
      }),
      fakeEnv(state),
    )
    const body = await response.json() as { job: { job_uid: string } }

    expect(response.status).toBe(200)
    expect(body.job.job_uid).toBe('job-regenerate-claimable')
    expect(state.jobs[25].status).toBe('leased')
    expect(state.jobs[25].assigned_machine_id).toBe('machine-1')
  })
})

function jobRow(overrides: Partial<DispatchJobRow>): DispatchJobRow {
  return {
    id: 1,
    job_uid: 'job-1',
    batch_uid: 'batch-1',
    job_type: 'regenerate_ai_image',
    status: 'queued',
    requested_by: null,
    assigned_machine_id: null,
    required_capabilities_json: JSON.stringify(['regenerate_ai_image']),
    priority: 10,
    attempt_count: 0,
    max_attempts: 3,
    idempotency_key: 'idem-1',
    lease_id: null,
    lease_expires_at: null,
    cancel_requested: 0,
    payload_json: '{}',
    result_json: '{}',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}
