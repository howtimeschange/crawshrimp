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
  payload_json: string
  result_json: string
  created_at: string
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
  events: unknown[]
  audits: unknown[]
  claimRaceRequiredCapabilitiesJson?: string
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
      const sorted = [...this.state.jobs]
        .filter((job) => job.status === 'queued' && (!job.assigned_machine_id || job.assigned_machine_id === machineId))
        .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at))
      return (sorted[0] ?? null) as T | null
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
    if (normalized.includes('from dispatch_jobs')) {
      const machineId = String(this.params[0])
      const results = [...this.state.jobs]
        .filter((job) => job.status === 'queued' && (!job.assigned_machine_id || job.assigned_machine_id === machineId))
        .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at))
      return { results: results as T[] }
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
    if (normalized.startsWith('update dispatch_jobs set lease_id')) {
      const machineId = String(this.params[2])
      const jobUid = String(this.params[4])
      const requiredCapabilitiesParam = normalized.includes('required_capabilities_json = ?') ? String(this.params[5]) : null
      const job = this.state.jobs.find((row) => row.job_uid === jobUid && row.status === 'queued' && (!row.assigned_machine_id || row.assigned_machine_id === machineId))
      if (!job) return result(0)
      if (this.state.claimRaceRequiredCapabilitiesJson) job.required_capabilities_json = this.state.claimRaceRequiredCapabilitiesJson
      if (requiredCapabilitiesParam !== null && job.required_capabilities_json !== requiredCapabilitiesParam) return result(0)
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
      const job = this.state.jobs.find((row) => row.job_uid === jobUid && row.lease_id === leaseId && row.assigned_machine_id === machineId && ['leased', 'running', 'uploading_results'].includes(row.status))
      if (!job) return result(0)
      job.lease_expires_at = String(this.params[0])
      job.updated_at = String(this.params[1])
      return result(1)
    }
    if (normalized.startsWith('update dispatch_jobs set status')) {
      const status = String(this.params[0])
      const jobUid = String(this.params[3])
      const leaseId = String(this.params[4])
      const machineId = String(this.params[5])
      const job = this.state.jobs.find((row) => row.job_uid === jobUid && row.lease_id === leaseId && row.assigned_machine_id === machineId && ['leased', 'running', 'uploading_results'].includes(row.status))
      if (!job) return result(0)
      job.status = status
      job.result_json = String(this.params[1])
      job.updated_at = String(this.params[2])
      return result(1)
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
    payload_json: '{}',
    result_json: '{}',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}
