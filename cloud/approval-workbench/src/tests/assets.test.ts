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

interface FakeState {
  users: UserRow[]
  roles: RoleRow[]
  userRoles: UserRoleRow[]
  sessions: SessionRow[]
  machines: MachineRow[]
  machineTokens: MachineTokenRow[]
  batches: BatchRow[]
  dispatchJobs: DispatchJobRow[]
  assets: AssetRow[]
  imageResources: ImageResourceRow[]
  r2Gets: string[]
  r2Puts: Array<{ key: string; body: string; contentType: string }>
  r2Objects: Record<string, { body: string; contentType: string }>
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
      if (!normalized.includes('status')) throw new Error('asset upload lookup must select status')
      return (this.state.assets.find((row) => row.object_key === String(this.params[0])) ?? null) as T | null
    }
    if (normalized.includes('from ai_image_batches') && normalized.includes('where batch_uid = ?')) {
      return (this.state.batches.find((row) => row.batch_uid === String(this.params[0])) ?? null) as T | null
    }
    if (normalized.includes('from dispatch_jobs') && normalized.includes('where job_uid = ?')) {
      return (this.state.dispatchJobs.find((row) => row.job_uid === String(this.params[0])) ?? null) as T | null
    }
    if (normalized.includes('from ai_image_styles') && normalized.includes('where id = ?')) {
      return (styleRow(Number(this.params[0]), String(this.params[1])) ?? null) as T | null
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
    if (normalized.includes('from ai_image_styles') && normalized.includes('where batch_uid = ?')) {
      return { results: [styleRow(7, String(this.params[0]))] as T[] }
    }
    if (normalized.includes('from ai_image_assets') && normalized.includes('where batch_uid = ?')) {
      return { results: this.state.assets.filter((row) => row.batch_uid === String(this.params[0])) as T[] }
    }
    if (normalized.includes('from dispatch_jobs') && normalized.includes('where batch_uid = ?')) {
      return { results: this.state.dispatchJobs.filter((row) => row.batch_uid === String(this.params[0])) as T[] }
    }
    if (normalized.includes('from image_resources')) {
      const batchUid = String(this.params[0])
      const hasStyleFilter = normalized.includes('style_code = ?')
      const hasItemFilter = normalized.includes('item_id = ?')
      let paramIndex = 1
      const styleCode = hasStyleFilter ? String(this.params[paramIndex++]) : ''
      const itemId = hasItemFilter ? String(this.params[paramIndex++]) : ''
      return {
        results: this.state.imageResources
          .filter((row) => row.batch_uid === batchUid && (!styleCode || row.style_code === styleCode) && (!itemId || row.item_id === itemId))
          .sort((left, right) => left.id - right.id) as T[],
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
      if (existing) {
        existing.batch_uid = String(this.params[1])
        existing.style_id = Number(this.params[2])
        existing.kind = String(this.params[3])
        existing.status = String(this.params[4])
        existing.object_key = String(this.params[5])
        existing.filename = String(this.params[6])
        existing.content_hash = String(this.params[7])
        existing.prompt_template_version_id = numberOrNull(this.params[8])
        existing.prompt_text = String(this.params[9])
        existing.parent_asset_uid = stringOrNull(this.params[10])
        existing.generation_job_id = stringOrNull(this.params[11])
        existing.meta_json = String(this.params[12])
        existing.updated_at = String(this.params[14])
        return result(1, existing.id)
      }
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
    if (normalized.startsWith('insert into image_resources')) {
      const existing = this.state.imageResources.find((row) => row.resource_uid === String(this.params[0]))
      if (existing) {
        existing.batch_uid = String(this.params[1])
        existing.style_code = String(this.params[2])
        existing.item_id = String(this.params[3])
        existing.kind = String(this.params[4])
        existing.asset_uid = String(this.params[5])
        existing.object_key = String(this.params[6])
        existing.filename = String(this.params[7])
        existing.content_hash = String(this.params[8])
        existing.source_label = String(this.params[9])
        existing.created_by_machine_id = stringOrNull(this.params[10])
        existing.created_by_user_id = numberOrNull(this.params[11])
        existing.updated_at = String(this.params[13])
        return result(1, existing.id)
      }
      const id = this.state.imageResources.length + 1
      this.state.imageResources.push({
        id,
        resource_uid: String(this.params[0]),
        batch_uid: String(this.params[1]),
        style_code: String(this.params[2]),
        item_id: String(this.params[3]),
        kind: String(this.params[4]),
        asset_uid: String(this.params[5]),
        object_key: String(this.params[6]),
        filename: String(this.params[7]),
        content_hash: String(this.params[8]),
        source_label: String(this.params[9]),
        created_by_machine_id: stringOrNull(this.params[10]),
        created_by_user_id: numberOrNull(this.params[11]),
        created_at: String(this.params[12]),
        updated_at: String(this.params[13]),
      })
      return result(1, id)
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
        const object = state.r2Objects[key]
        if (object) {
          return {
            body: new Blob([object.body]).stream(),
            httpMetadata: { contentType: object.contentType },
          } as unknown as R2ObjectBody
        }
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

  it('rejects active machine bearer tokens without a current asset lease or sync upload plan', async () => {
    const { state, machineToken } = await baseState()
    const response = await fetchWorker(new Request('https://example.test/api/assets/presign', {
      method: 'POST',
      headers: { authorization: `Bearer ${machineToken}` },
      body: JSON.stringify({ ...validPresignBody(), job_uid: '', lease_id: '' }),
    }), fakeEnv(state))

    expect(response.status).toBe(403)
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

  it('upserts an image resource when an uploaded image asset completes', async () => {
    const { state, machineToken } = await baseState()
    const objectKey = 'batches/batch-20260707/source/source-1-source.jpg'
    state.assets.push(assetRow({
      asset_uid: 'source-1',
      kind: 'source',
      status: 'planned',
      object_key: objectKey,
      filename: 'source.jpg',
      content_hash: 'hash-source',
      meta_json: JSON.stringify({ source_label: '原图/主图', source_path_label: 'source.jpg' }),
    }))

    const response = await fetchWorker(new Request(`https://example.test/api/assets/upload/${encodeURIComponent(objectKey)}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${machineToken}`,
        'content-type': 'image/jpeg',
      },
      body: 'source-bytes',
    }), fakeEnv(state))

    expect(response.status).toBe(200)
    expect(state.imageResources).toHaveLength(1)
    expect(state.imageResources[0]).toMatchObject({
      resource_uid: 'source-1',
      batch_uid: 'batch-20260707',
      style_code: '208326100202',
      item_id: '1002178235142',
      kind: 'source',
      asset_uid: 'source-1',
      object_key: objectKey,
      filename: 'source.jpg',
      content_hash: 'hash-source',
      source_label: '原图/主图',
      created_by_machine_id: 'machine-1',
      created_by_user_id: null,
    })
  })

  it('lists uploaded image resources scoped to a batch detail response', async () => {
    const { state, reviewerCookie } = await baseState()
    state.assets.push(assetRow({ asset_uid: 'source-1', kind: 'source', status: 'uploaded' }))
    state.imageResources.push(imageResourceRow({
      resource_uid: 'source-1',
      kind: 'source',
      source_label: '原图/主图',
    }))

    const response = await fetchWorker(new Request('https://example.test/api/ai-image-batches/batch-20260707', {
      headers: { cookie: reviewerCookie },
    }), fakeEnv(state))
    const body = await response.json() as { batch: { image_resources: ImageResourceRow[]; styles: Array<{ image_resources: ImageResourceRow[] }> } }

    expect(response.status).toBe(200)
    expect(body.batch.image_resources).toHaveLength(1)
    expect(body.batch.image_resources[0]).toMatchObject({
      resource_uid: 'source-1',
      kind: 'source',
      style_code: '208326100202',
      item_id: '1002178235142',
    })
    expect(body.batch.styles[0].image_resources).toHaveLength(1)
  })

  it('lists image resources for the current batch and optional style item identity', async () => {
    const { state, reviewerCookie } = await baseState()
    state.imageResources.push(
      imageResourceRow({ resource_uid: 'source-1', kind: 'source', style_code: '208326100202', item_id: '1002178235142' }),
      imageResourceRow({ id: 2, resource_uid: 'source-2', kind: 'source', style_code: '208326100202', item_id: '1002178235143' }),
      imageResourceRow({ id: 3, resource_uid: 'source-3', kind: 'source', style_code: '208326100203', item_id: '1002178235144' }),
    )

    const response = await fetchWorker(new Request('https://example.test/api/ai-image-batches/batch-20260707/image-resources?style_code=208326100202&item_id=1002178235142', {
      headers: { cookie: reviewerCookie },
    }), fakeEnv(state))
    const body = await response.json() as { image_resources: ImageResourceRow[] }

    expect(response.status).toBe(200)
    expect(body.image_resources.map((resource) => resource.resource_uid)).toEqual(['source-1'])
  })

  it('allows source machines to upload planned assets for their syncing batch without a job lease', async () => {
    const { state, machineToken } = await baseState()
    state.assets.push(assetRow({
      asset_uid: 'sync-source-1',
      kind: 'source',
      status: 'planned',
      object_key: 'batches/batch-20260707/source/sync-source-1-source.jpg',
      filename: 'source.jpg',
    }))
    const env = fakeEnv(state)
    const presignResponse = await fetchWorker(new Request('https://example.test/api/assets/presign', {
      method: 'POST',
      headers: { authorization: `Bearer ${machineToken}` },
      body: JSON.stringify({
        batch_uid: 'batch-20260707',
        style_id: 7,
        asset_uid: 'sync-source-1',
        kind: 'source',
        filename: 'source.jpg',
      }),
    }), env)
    const presign = await presignResponse.json() as { upload_url: string; object_key: string }

    const uploadResponse = await fetchWorker(new Request(`https://example.test${presign.upload_url}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${machineToken}`, 'content-type': 'image/jpeg' },
      body: 'source-bytes',
    }), env)

    expect(presignResponse.status).toBe(200)
    expect(presign.upload_url).not.toContain('job_uid=')
    expect(uploadResponse.status).toBe(200)
    expect(state.r2Puts).toEqual([{ key: presign.object_key, body: 'source-bytes', contentType: 'image/jpeg' }])
    expect(state.assets[0].status).toBe('uploaded')
  })

  it('rejects source-machine sync uploads for assets that are not still planned', async () => {
    const { state, machineToken } = await baseState()
    state.assets.push(assetRow({
      asset_uid: 'sync-source-1',
      kind: 'source',
      status: 'uploaded',
      object_key: 'batches/batch-20260707/source/sync-source-1-source.jpg',
      filename: 'source.jpg',
    }))
    const response = await fetchWorker(new Request('https://example.test/api/assets/presign', {
      method: 'POST',
      headers: { authorization: `Bearer ${machineToken}` },
      body: JSON.stringify({
        batch_uid: 'batch-20260707',
        style_id: 7,
        asset_uid: 'sync-source-1',
        kind: 'source',
        filename: 'source.jpg',
      }),
    }), fakeEnv(state))

    expect(response.status).toBe(403)
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

  it('lets reviewer sessions upload planned manual source assets and mark them uploaded', async () => {
    const { state, reviewerCookie } = await baseState()
    const objectKey = 'batches/batch-20260707/source/manual-source.jpg'
    state.assets.push(assetRow({
      asset_uid: 'manual-source',
      kind: 'source',
      status: 'planned',
      object_key: objectKey,
      filename: 'manual-source.jpg',
    }))

    const response = await fetchWorker(new Request(`https://example.test/api/assets/upload/${encodeURIComponent(objectKey)}`, {
      method: 'PUT',
      headers: { cookie: reviewerCookie, 'content-type': 'image/jpeg' },
      body: 'source-bytes',
    }), fakeEnv(state))

    expect(response.status).toBe(200)
    expect(state.r2Puts).toEqual([{ key: objectKey, body: 'source-bytes', contentType: 'image/jpeg' }])
    expect(state.assets[0].status).toBe('uploaded')
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

  it('rejects asset_uid reuse that would move an existing asset to another batch', async () => {
    const { state, adminCookie } = await baseState()
    state.assets.push(assetRow({
      asset_uid: 'shared-asset',
      batch_uid: 'batch-20260707',
      style_id: 7,
      kind: 'ai',
      object_key: 'batches/batch-20260707/ai/shared-asset-old.jpg',
      filename: 'old.jpg',
    }))

    const response = await fetchWorker(new Request('https://example.test/api/assets/presign', {
      method: 'POST',
      headers: { cookie: adminCookie },
      body: JSON.stringify({
        batch_uid: 'other-batch',
        style_id: 99,
        asset_uid: 'shared-asset',
        kind: 'source',
        filename: 'new.jpg',
      }),
    }), fakeEnv(state))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'asset_uid already belongs to a different asset scope' })
    expect(state.assets[0]).toMatchObject({
      asset_uid: 'shared-asset',
      batch_uid: 'batch-20260707',
      style_id: 7,
      kind: 'ai',
      object_key: 'batches/batch-20260707/ai/shared-asset-old.jpg',
      filename: 'old.jpg',
    })
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

  it('adds same-origin protection headers to cookie-authenticated asset downloads', async () => {
    const { state, reviewerCookie } = await baseState()
    const asset = assetRow()
    state.assets.push(asset)
    state.r2Objects[asset.object_key] = { body: 'image-bytes', contentType: 'image/jpeg' }

    const response = await fetchWorker(new Request('https://example.test/api/assets/asset-ai-1/download', {
      headers: { cookie: reviewerCookie, 'sec-fetch-site': 'same-origin' },
    }), fakeEnv(state))

    expect(response.status).toBe(200)
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.text()).toBe('image-bytes')
  })

  it('rejects cross-site cookie-authenticated asset downloads before R2 lookup', async () => {
    const { state, reviewerCookie } = await baseState()
    state.assets.push(assetRow())
    const response = await fetchWorker(new Request('https://example.test/api/assets/asset-ai-1/download', {
      headers: { cookie: reviewerCookie, 'sec-fetch-site': 'cross-site' },
    }), fakeEnv(state))

    expect(response.status).toBe(403)
    expect(state.r2Gets).toEqual([])
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

  it('scopes generate_ai_image leases to source/reference downloads and generated AI result uploads', async () => {
    const { state, machineToken } = await baseState()
    state.dispatchJobs.push({
      job_uid: 'job-generate',
      batch_uid: 'batch-20260707',
      job_type: 'generate_ai_image',
      status: 'leased',
      assigned_machine_id: 'machine-1',
      lease_id: 'lease-generate',
      lease_expires_at: '2999-01-01T00:00:00.000Z',
      payload_json: JSON.stringify({
        batch_uid: 'batch-20260707',
        style_id: 7,
        request_uid: 'gen-request-1',
        source_asset_uid: 'asset-source-1',
        reference_asset_uids: ['asset-reference-1'],
        result_asset_uids: ['asset-ai-result-1'],
      }),
    })
    state.assets.push(
      assetRow({ id: 1, asset_uid: 'asset-source-1', kind: 'source', object_key: 'batches/batch-20260707/source/source.jpg', filename: 'source.jpg' }),
      assetRow({ id: 2, asset_uid: 'asset-reference-1', kind: 'reference', object_key: 'batches/batch-20260707/reference/reference.jpg', filename: 'reference.jpg' }),
      assetRow({ id: 3, asset_uid: 'asset-unrelated', kind: 'source', object_key: 'batches/batch-20260707/source/unrelated.jpg', filename: 'unrelated.jpg' }),
    )
    const env = fakeEnv(state)

    const sourceDownload = await fetchWorker(new Request('https://example.test/api/assets/asset-source-1/download?job_uid=job-generate&lease_id=lease-generate', {
      headers: { authorization: `Bearer ${machineToken}` },
    }), env)
    const referenceDownload = await fetchWorker(new Request('https://example.test/api/assets/asset-reference-1/download?job_uid=job-generate&lease_id=lease-generate', {
      headers: { authorization: `Bearer ${machineToken}` },
    }), env)
    const unrelatedDownload = await fetchWorker(new Request('https://example.test/api/assets/asset-unrelated/download?job_uid=job-generate&lease_id=lease-generate', {
      headers: { authorization: `Bearer ${machineToken}` },
    }), env)
    const resultUpload = await fetchWorker(new Request('https://example.test/api/assets/presign', {
      method: 'POST',
      headers: { authorization: `Bearer ${machineToken}` },
      body: JSON.stringify({
        batch_uid: 'batch-20260707',
        style_id: 7,
        asset_uid: 'asset-ai-result-1',
        kind: 'ai',
        filename: 'generated.png',
        generation_job_id: 'gen-request-1',
        job_uid: 'job-generate',
        lease_id: 'lease-generate',
      }),
    }), env)
    const unrelatedUpload = await fetchWorker(new Request('https://example.test/api/assets/presign', {
      method: 'POST',
      headers: { authorization: `Bearer ${machineToken}` },
      body: JSON.stringify({
        batch_uid: 'batch-20260707',
        style_id: 7,
        asset_uid: 'asset-ai-other',
        kind: 'ai',
        filename: 'other.png',
        job_uid: 'job-generate',
        lease_id: 'lease-generate',
      }),
    }), env)

    expect(sourceDownload.status).toBe(404)
    expect(referenceDownload.status).toBe(404)
    expect(unrelatedDownload.status).toBe(403)
    expect(resultUpload.status).toBe(200)
    expect(unrelatedUpload.status).toBe(403)
    expect(state.r2Gets).toEqual([
      'batches/batch-20260707/source/source.jpg',
      'batches/batch-20260707/reference/reference.jpg',
    ])
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
    batches: [
      {
        id: 1,
        batch_uid: 'batch-20260707',
        local_instance_uid: 'local-instance',
        local_run_id: 'local-run',
        title: 'Batch',
        status: 'syncing',
        prompt_library_id: null,
        prompt_version_set_json: '[]',
        source_machine_id: 'machine-1',
        created_by: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
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
    imageResources: [],
    r2Gets: [],
    r2Puts: [],
    r2Objects: {},
  }
  return {
    state,
    machineToken,
    reviewerCookie: `cs_session=${reviewerSession}`,
    adminCookie: `cs_session=${adminSession}`,
  }
}

function styleRow(id = 7, batchUid = 'batch-20260707') {
  return {
    id,
    batch_uid: batchUid,
    style_code: '208326100202',
    item_id: '1002178235142',
    skc_code: '208326100202-00482',
    category: '长袖T恤',
    gender: '中性',
    status: 'pending_review',
    missing_prompt_reason: '',
    source_summary_json: '{}',
    review_summary_json: '{}',
    submit_summary_json: '{}',
  }
}

function imageResourceRow(overrides: Partial<ImageResourceRow> = {}): ImageResourceRow {
  return {
    id: 1,
    resource_uid: 'asset-ai-1',
    batch_uid: 'batch-20260707',
    style_code: '208326100202',
    item_id: '1002178235142',
    kind: 'ai',
    asset_uid: 'asset-ai-1',
    object_key: 'batches/batch-20260707/ai/asset-ai-1-ai.jpg',
    filename: 'ai.jpg',
    content_hash: 'hash-1',
    source_label: '',
    created_by_machine_id: null,
    created_by_user_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
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
