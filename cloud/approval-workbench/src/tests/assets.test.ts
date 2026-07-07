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

interface FakeState {
  users: UserRow[]
  roles: RoleRow[]
  userRoles: UserRoleRow[]
  sessions: SessionRow[]
  machines: MachineRow[]
  machineTokens: MachineTokenRow[]
  dispatchJobs: DispatchJobRow[]
  assets: AssetRow[]
  r2Gets: string[]
  r2Puts: Array<{ key: string; body: string; contentType: string }>
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
    if (normalized.includes('from machine_tokens') && normalized.includes('join task_machines')) {
      const tokenHash = String(this.params[0])
      const token = this.state.machineTokens.find((row) => row.token_hash === tokenHash && row.status === 'active' && !row.revoked_at)
      if (!token) return null
      const machine = this.state.machines.find((row) => row.machine_id === token.machine_id)
      return (machine ? { ...machine, token_hash: token.token_hash } : null) as T | null
    }
    if (normalized.includes('from ai_image_assets') && normalized.includes('where asset_uid = ?')) {
      return (this.state.assets.find((row) => row.asset_uid === String(this.params[0])) ?? null) as T | null
    }
    if (normalized.includes('from ai_image_assets') && normalized.includes('where object_key = ?')) {
      return (this.state.assets.find((row) => row.object_key === String(this.params[0])) ?? null) as T | null
    }
    if (normalized.includes('from dispatch_jobs') && normalized.includes('where job_uid = ?')) {
      return (this.state.dispatchJobs.find((row) => row.job_uid === String(this.params[0])) ?? null) as T | null
    }
    return null
  }

  async all<T>(): Promise<{ results: T[] }> {
    const normalized = normalizeSql(this.sql)
    if (normalized.includes('from roles') && normalized.includes('join user_roles')) {
      const userId = Number(this.params[0])
      return {
        results: this.state.userRoles
          .filter((userRole) => userRole.user_id === userId)
          .map((userRole) => this.state.roles.find((role) => role.id === userRole.role_id))
          .filter((role): role is RoleRow => Boolean(role)) as T[],
      }
    }
    return { results: [] }
  }

  async run(): Promise<D1Result> {
    const normalized = normalizeSql(this.sql)
    if (normalized.startsWith('update machine_tokens set last_used_at')) {
      const token = this.state.machineTokens.find((row) => row.token_hash === String(this.params[1]))
      if (token) token.last_used_at = String(this.params[0])
      return result(token ? 1 : 0)
    }
    if (normalized.startsWith('insert into ai_image_assets')) {
      const existing = this.state.assets.find((row) => row.asset_uid === String(this.params[0]))
      if (existing) return result(1, existing.id)
      const id = this.state.assets.length + 1
      this.state.assets.push({
        id,
        asset_uid: String(this.params[0]),
        batch_uid: String(this.params[1]),
        style_id: Number(this.params[2]),
        kind: String(this.params[3]),
        status: String(this.params[4]),
        object_key: String(this.params[5]),
        filename: String(this.params[6]),
        content_hash: String(this.params[7]),
        prompt_template_version_id: numberOrNull(this.params[8]),
        prompt_text: String(this.params[9]),
        parent_asset_uid: stringOrNull(this.params[10]),
        generation_job_id: stringOrNull(this.params[11]),
        meta_json: String(this.params[12]),
        created_at: String(this.params[13]),
        updated_at: String(this.params[14]),
      })
      return result(1, id)
    }
    if (normalized.startsWith('update ai_image_assets set status')) {
      const asset = this.state.assets.find((row) => row.object_key === String(this.params[2]))
      if (!asset) return result(0)
      asset.status = String(this.params[0])
      asset.updated_at = String(this.params[1])
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

function fakeEnv(state: FakeState) {
  return {
    DB: new FakeD1Database(state) as unknown as D1Database,
    ASSETS: {
      async get(key: string) {
        state.r2Gets.push(key)
        return null
      },
      async put(key: string, value: ReadableStream | ArrayBuffer | string | null, options?: R2PutOptions) {
        const body = typeof value === 'string'
          ? value
          : value instanceof ArrayBuffer
            ? new TextDecoder().decode(value)
            : value
              ? await new Response(value).text()
              : ''
        const httpMetadata = options?.httpMetadata
        const contentType = httpMetadata instanceof Headers
          ? httpMetadata.get('content-type') || ''
          : httpMetadata?.contentType || ''
        state.r2Puts.push({
          key,
          body,
          contentType,
        })
        return null
      },
    } as unknown as R2Bucket,
    SESSION_TTL_SECONDS: '604800',
  }
}

function fetchWorker(request: Request, env: ReturnType<typeof fakeEnv>): Promise<Response> {
  return (worker.fetch as unknown as (request: Request, env: ReturnType<typeof fakeEnv>) => Promise<Response>)(request, env)
}

describe('asset upload planning routes', () => {
  it('rejects unauthenticated presign requests', async () => {
    const { state } = await baseState()
    const response = await fetchWorker(new Request('https://example.test/api/assets/presign', {
      method: 'POST',
      body: JSON.stringify(validPresignBody()),
    }), fakeEnv(state))

    expect(response.status).toBe(401)
    expect(state.assets).toHaveLength(0)
  })

  it('rejects active machine bearer tokens without a current asset lease', async () => {
    const { state, machineToken } = await baseState()
    const response = await fetchWorker(new Request('https://example.test/api/assets/presign', {
      method: 'POST',
      headers: { authorization: `Bearer ${machineToken}` },
      body: JSON.stringify({ ...validPresignBody(), job_uid: '', lease_id: '' }),
    }), fakeEnv(state))

    expect(response.status).toBe(400)
    expect(state.assets).toHaveLength(0)
  })

  it('allows active leased machine bearer tokens to create scoped upload plans', async () => {
    const { state, machineToken } = await baseState()
    const response = await fetchWorker(new Request('https://example.test/api/assets/presign', {
      method: 'POST',
      headers: { authorization: `Bearer ${machineToken}` },
      body: JSON.stringify(validPresignBody()),
    }), fakeEnv(state))

    expect(response.status).toBe(200)
    expect(state.assets[0].asset_uid).toBe('asset-ai-1')
  })

  it('allows machine bearer tokens to upload a planned asset object and marks it uploaded', async () => {
    const { state, machineToken } = await baseState()
    const env = fakeEnv(state)
    const presignResponse = await fetchWorker(new Request('https://example.test/api/assets/presign', {
      method: 'POST',
      headers: { authorization: `Bearer ${machineToken}` },
      body: JSON.stringify(validPresignBody()),
    }), env)
    const presign = await presignResponse.json() as { upload_url: string; object_key: string }

    const response = await fetchWorker(new Request(`https://example.test${presign.upload_url}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${machineToken}`,
        'content-type': 'image/jpeg',
      },
      body: 'image-bytes',
    }), env)
    const body = await response.json() as { ok: boolean; object_key: string }

    expect(response.status).toBe(200)
    expect(body).toEqual({ ok: true, object_key: presign.object_key })
    expect(state.r2Puts).toEqual([{ key: presign.object_key, body: 'image-bytes', contentType: 'image/jpeg' }])
    expect(state.assets[0].status).toBe('uploaded')
  })

  it('rejects upload object keys outside the batches prefix', async () => {
    const { state, machineToken } = await baseState()
    const response = await fetchWorker(new Request('https://example.test/api/assets/upload/tmp%2Fasset.jpg', {
      method: 'PUT',
      headers: { authorization: `Bearer ${machineToken}` },
      body: 'image-bytes',
    }), fakeEnv(state))

    expect(response.status).toBe(400)
    expect(state.r2Puts).toEqual([])
  })

  it('rejects stale upload object keys without a planned asset row', async () => {
    const { state, machineToken } = await baseState()
    const objectKey = 'batches/batch-20260707/ai/stale.jpg'
    const response = await fetchWorker(new Request(`https://example.test/api/assets/upload/${encodeURIComponent(objectKey)}?job_uid=job-upload&lease_id=lease-upload`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${machineToken}` },
      body: 'image-bytes',
    }), fakeEnv(state))

    expect(response.status).toBe(404)
    expect(state.r2Puts).toEqual([])
  })

  it('rejects unauthenticated upload requests', async () => {
    const { state } = await baseState()
    const objectKey = 'batches/batch-20260707/ai/asset-ai-1-ai.jpg'
    state.assets.push(assetRow({ status: 'planned', object_key: objectKey }))

    const response = await fetchWorker(new Request(`https://example.test/api/assets/upload/${encodeURIComponent(objectKey)}`, {
      method: 'PUT',
      body: 'image-bytes',
    }), fakeEnv(state))

    expect(response.status).toBe(401)
    expect(state.r2Puts).toEqual([])
    expect(state.assets[0].status).toBe('planned')
  })

  it('rejects non-admin user sessions without machines:write for presign', async () => {
    const { state, reviewerCookie } = await baseState()
    const response = await fetchWorker(new Request('https://example.test/api/assets/presign', {
      method: 'POST',
      headers: { cookie: reviewerCookie },
      body: JSON.stringify(validPresignBody()),
    }), fakeEnv(state))

    expect(response.status).toBe(403)
    expect(state.assets).toHaveLength(0)
  })

  it('allows admin users with machines:write to create upload plans', async () => {
    const { state, adminCookie } = await baseState()
    const response = await fetchWorker(new Request('https://example.test/api/assets/presign', {
      method: 'POST',
      headers: { cookie: adminCookie },
      body: JSON.stringify(validPresignBody()),
    }), fakeEnv(state))

    expect(response.status).toBe(200)
    expect(state.assets[0].asset_uid).toBe('asset-ai-1')
  })

  it('rejects unauthenticated download requests before R2 lookup', async () => {
    const { state } = await baseState()
    state.assets.push(assetRow())
    const response = await fetchWorker(new Request('https://example.test/api/assets/asset-ai-1/download'), fakeEnv(state))

    expect(response.status).toBe(401)
    expect(state.r2Gets).toEqual([])
  })

  it('allows users with batches:read to reach the R2 download lookup path', async () => {
    const { state, reviewerCookie } = await baseState()
    state.assets.push(assetRow())
    const response = await fetchWorker(new Request('https://example.test/api/assets/asset-ai-1/download', {
      headers: { cookie: reviewerCookie },
    }), fakeEnv(state))

    expect(response.status).toBe(404)
    expect(state.r2Gets).toEqual(['batches/batch-20260707/ai/asset-ai-1-ai.jpg'])
  })

  it('rejects active machine bearer token downloads without a current asset lease', async () => {
    const { state, machineToken } = await baseState()
    state.assets.push(assetRow())
    const response = await fetchWorker(new Request('https://example.test/api/assets/asset-ai-1/download', {
      headers: { authorization: `Bearer ${machineToken}` },
    }), fakeEnv(state))

    expect(response.status).toBe(400)
    expect(state.r2Gets).toEqual([])
  })

  it('allows active leased machine bearer tokens to reach the R2 download lookup path', async () => {
    const { state, machineToken } = await baseState()
    state.assets.push(assetRow())
    const response = await fetchWorker(new Request('https://example.test/api/assets/asset-ai-1/download?job_uid=job-download&lease_id=lease-download', {
      headers: { authorization: `Bearer ${machineToken}` },
    }), fakeEnv(state))

    expect(response.status).toBe(404)
    expect(state.r2Gets).toEqual(['batches/batch-20260707/ai/asset-ai-1-ai.jpg'])
  })

  it('returns deterministic object keys under the batch prefix', async () => {
    const { state, machineToken } = await baseState()
    const response = await fetchWorker(new Request('https://example.test/api/assets/presign', {
      method: 'POST',
      headers: { authorization: `Bearer ${machineToken}` },
      body: JSON.stringify({
        batch_uid: 'batch-20260707',
        style_id: 7,
        asset_uid: 'asset-ai-1',
        kind: 'ai',
        filename: '../look 1.png',
        content_hash: 'hash-1',
        job_uid: 'job-upload',
        lease_id: 'lease-upload',
      }),
    }), fakeEnv(state))
    const body = await response.json() as { object_key: string }

    expect(response.status).toBe(200)
    expect(body.object_key).toBe('batches/batch-20260707/ai/asset-ai-1-look-1.png')
    expect(state.assets[0].object_key).toBe(body.object_key)
  })

  it('rejects paths outside allowed asset suffixes', async () => {
    const { state, adminCookie } = await baseState()
    const response = await fetchWorker(new Request('https://example.test/api/assets/presign', {
      method: 'POST',
      headers: { cookie: adminCookie },
      body: JSON.stringify({
        batch_uid: 'batch-20260707',
        style_id: 7,
        asset_uid: 'asset-log-1',
        kind: 'log',
        filename: 'run.sh',
      }),
    }), fakeEnv(state))

    expect(response.status).toBe(400)
    expect(state.assets).toHaveLength(0)
  })

  it('stores sanitized source_path_label metadata without raw local absolute paths', async () => {
    const { state, adminCookie } = await baseState()
    const response = await fetchWorker(new Request('https://example.test/api/assets/presign', {
      method: 'POST',
      headers: { cookie: adminCookie },
      body: JSON.stringify({
        batch_uid: 'batch-20260707',
        style_id: 7,
        asset_uid: 'asset-source-1',
        kind: 'source',
        filename: 'source.jpg',
        source_path: '/Users/xingyicheng/Desktop/raw/source.jpg',
      }),
    }), fakeEnv(state))

    expect(response.status).toBe(200)
    expect(JSON.parse(state.assets[0].meta_json)).toEqual({ source_path_label: 'source.jpg' })
    expect(state.assets[0].meta_json).not.toContain('/Users/xingyicheng')
  })

  it('sanitizes absolute source_path_label and nested local paths while keeping safe metadata', async () => {
    const { state, adminCookie } = await baseState()
    const response = await fetchWorker(new Request('https://example.test/api/assets/presign', {
      method: 'POST',
      headers: { cookie: adminCookie },
      body: JSON.stringify({
        batch_uid: 'batch-20260707',
        style_id: 7,
        asset_uid: 'asset-source-2',
        kind: 'source',
        filename: 'source.jpg',
        source_path_label: '/Users/xingyicheng/Desktop/raw/source.jpg',
        meta: {
          model: '1xm',
          note: 'review source image',
          original_path: '/Users/xingyicheng/Desktop/raw/source.jpg',
          windows_path: 'C:\\Users\\xingyicheng\\Desktop\\raw\\source.jpg',
          nested: {
            label: 'safe folder label',
            local_path: '/private/tmp/raw/source.jpg',
            values: ['keep-me', '/Users/xingyicheng/Desktop/raw/a.jpg', { absolute_path: 'D:\\raw\\b.jpg', color: 'red' }],
          },
        },
      }),
    }), fakeEnv(state))

    expect(response.status).toBe(200)
    const meta = JSON.parse(state.assets[0].meta_json)
    expect(meta).toEqual({
      model: '1xm',
      note: 'review source image',
      nested: {
        label: 'safe folder label',
        values: ['keep-me', { color: 'red' }],
      },
      source_path_label: 'source.jpg',
    })
    expect(state.assets[0].meta_json).not.toContain('/Users/')
    expect(state.assets[0].meta_json).not.toContain('/private/tmp')
    expect(state.assets[0].meta_json).not.toContain('C:\\')
    expect(state.assets[0].meta_json).not.toContain('D:\\')
  })

  it('scrubs generic POSIX local paths and object-key metadata while preserving safe URLs', async () => {
    const { state, adminCookie } = await baseState()
    const response = await fetchWorker(new Request('https://example.test/api/assets/presign', {
      method: 'POST',
      headers: { cookie: adminCookie },
      body: JSON.stringify({
        batch_uid: 'batch-1',
        style_id: 7,
        asset_uid: 'asset-a',
        kind: 'ai',
        filename: 'file.jpg',
        source_path_label: '/opt/crawshrimp/raw/source.jpg',
        meta: {
          preview_url: 'https://cdn.example.test/source.jpg',
          object_key: 'batches/batch-1/ai/asset-a-file.jpg',
          objectKey: 'batches/other-batch/source/other-file.jpg',
          r2_object_key: 'batches/batch-1/reference/asset-a-file.jpg',
          storage_key: 'batches/batch-1/log/asset-a.txt',
          nested: {
            mount_path: '/mnt/share/source.jpg',
            object_key: 'batches/other-batch/ai/nested.jpg',
            labels: ['keep-me', '/opt/crawshrimp/raw/other.jpg'],
          },
        },
      }),
    }), fakeEnv(state))

    expect(response.status).toBe(200)
    const meta = JSON.parse(state.assets[0].meta_json)
    expect(meta).toEqual({
      preview_url: 'https://cdn.example.test/source.jpg',
      nested: {
        labels: ['keep-me'],
      },
      source_path_label: 'source.jpg',
    })
    expect(state.assets[0].object_key).toBe('batches/batch-1/ai/asset-a-file.jpg')
    expect(state.assets[0].meta_json).not.toContain('/opt/')
    expect(state.assets[0].meta_json).not.toContain('/mnt/')
    expect(state.assets[0].meta_json).not.toContain('other-batch')
    expect(state.assets[0].meta_json).not.toContain('r2_object_key')
    expect(state.assets[0].meta_json).not.toContain('storage_key')
  })
})

async function baseState(): Promise<{ state: FakeState; machineToken: string; reviewerCookie: string; adminCookie: string }> {
  const machineToken = 'csr_machine_test'
  const reviewerSession = 'sess_reviewer'
  const adminSession = 'sess_admin'
  const state: FakeState = {
    users: [
      { id: 1, email: 'admin@example.com', name: 'Admin', status: 'active' },
      { id: 2, email: 'reviewer@example.com', name: 'Reviewer', status: 'active' },
    ],
    roles: [
      { id: 1, role_key: 'admin', name: 'Admin' },
      { id: 2, role_key: 'reviewer', name: 'Reviewer' },
    ],
    userRoles: [
      { user_id: 1, role_id: 1 },
      { user_id: 2, role_id: 2 },
    ],
    sessions: [
      { user_id: 1, session_hash: await sha256Hex(adminSession), expires_at: '2999-01-01T00:00:00.000Z', revoked_at: null },
      { user_id: 2, session_hash: await sha256Hex(reviewerSession), expires_at: '2999-01-01T00:00:00.000Z', revoked_at: null },
    ],
    machines: [
      {
        id: 1,
        machine_id: 'machine-1',
        machine_name: 'Machine 1',
        owner_user_id: null,
        app_version: '1.0.0',
        fingerprint_hash: 'fp',
        capabilities_json: '["ai-image-sync"]',
        auth_status: 'active',
        health: 'online_idle',
        current_job_id: null,
        last_seen_at: null,
        registered_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    machineTokens: [
      {
        id: 1,
        machine_id: 'machine-1',
        token_hash: await sha256Hex(machineToken),
        token_version: 1,
        status: 'active',
        issued_by: null,
        issued_at: '2026-01-01T00:00:00.000Z',
        last_used_at: null,
        revoked_at: null,
      },
    ],
    dispatchJobs: [
      {
        job_uid: 'job-upload',
        batch_uid: 'batch-20260707',
        job_type: 'regenerate_ai_image',
        status: 'leased',
        assigned_machine_id: 'machine-1',
        lease_id: 'lease-upload',
        lease_expires_at: '2999-01-01T00:00:00.000Z',
        payload_json: JSON.stringify({
          batch_uid: 'batch-20260707',
          style_id: 7,
          asset_uid: 'asset-ai-1',
          reference_asset_uids: ['asset-source-1'],
        }),
      },
      {
        job_uid: 'job-download',
        batch_uid: 'batch-20260707',
        job_type: 'submit_tmall_material_test',
        status: 'leased',
        assigned_machine_id: 'machine-1',
        lease_id: 'lease-download',
        lease_expires_at: '2999-01-01T00:00:00.000Z',
        payload_json: JSON.stringify({
          submit_plan: {
            batch_uid: 'batch-20260707',
            assets: [{ asset_uid: 'asset-ai-1', style_id: 7, kind: 'ai' }],
          },
        }),
      },
    ],
    assets: [],
    r2Gets: [],
    r2Puts: [],
  }
  return {
    state,
    machineToken,
    reviewerCookie: `cs_session=${reviewerSession}`,
    adminCookie: `cs_session=${adminSession}`,
  }
}

function validPresignBody(): Record<string, unknown> {
  return {
    batch_uid: 'batch-20260707',
    style_id: 7,
    asset_uid: 'asset-ai-1',
    kind: 'ai',
    filename: 'ai.jpg',
    content_hash: 'hash-1',
    job_uid: 'job-upload',
    lease_id: 'lease-upload',
  }
}

function assetRow(overrides: Partial<AssetRow> = {}): AssetRow {
  return {
    id: 1,
    asset_uid: 'asset-ai-1',
    batch_uid: 'batch-20260707',
    style_id: 7,
    kind: 'ai',
    status: 'uploaded',
    object_key: 'batches/batch-20260707/ai/asset-ai-1-ai.jpg',
    filename: 'ai.jpg',
    content_hash: 'hash-1',
    prompt_template_version_id: null,
    prompt_text: '',
    parent_asset_uid: null,
    generation_job_id: null,
    meta_json: '{}',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function normalizeSql(sql: string): string {
  return sql.toLowerCase().replace(/\s+/g, ' ').trim()
}

function result(changes: number, lastRowId = 0): D1Result {
  return {
    success: true,
    meta: { changes, last_row_id: lastRowId } as D1Meta & Record<string, unknown>,
    results: [],
  }
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function stringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}
