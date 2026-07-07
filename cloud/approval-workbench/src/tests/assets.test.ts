import { describe, expect, it } from 'vitest'
import worker from '../worker/index'

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

interface FakeState {
  assets: AssetRow[]
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
    if (normalized.includes('from ai_image_assets') && normalized.includes('where asset_uid = ?')) {
      return (this.state.assets.find((row) => row.asset_uid === String(this.params[0])) ?? null) as T | null
    }
    return null
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: [] }
  }

  async run(): Promise<D1Result> {
    const normalized = normalizeSql(this.sql)
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
      async get() {
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
  it('returns deterministic object keys under the batch prefix', async () => {
    const state: FakeState = { assets: [] }
    const response = await fetchWorker(new Request('https://example.test/api/assets/presign', {
      method: 'POST',
      body: JSON.stringify({
        batch_uid: 'batch-20260707',
        style_id: 7,
        asset_uid: 'asset-ai-1',
        kind: 'ai',
        filename: '../look 1.png',
        content_hash: 'hash-1',
      }),
    }), fakeEnv(state))
    const body = await response.json() as { object_key: string }

    expect(response.status).toBe(200)
    expect(body.object_key).toBe('batches/batch-20260707/ai/asset-ai-1-look-1.png')
    expect(state.assets[0].object_key).toBe(body.object_key)
  })

  it('rejects paths outside allowed asset suffixes', async () => {
    const state: FakeState = { assets: [] }
    const response = await fetchWorker(new Request('https://example.test/api/assets/presign', {
      method: 'POST',
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
    const state: FakeState = { assets: [] }
    const response = await fetchWorker(new Request('https://example.test/api/assets/presign', {
      method: 'POST',
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
    const state: FakeState = { assets: [] }
    const response = await fetchWorker(new Request('https://example.test/api/assets/presign', {
      method: 'POST',
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
})

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
