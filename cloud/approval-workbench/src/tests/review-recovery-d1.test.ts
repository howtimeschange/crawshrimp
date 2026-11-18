import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { applyWorkflowMigrations, createD1MigrationTestDatabase, type D1MigrationTestDatabase } from './migration-test-helper'
import type { Env } from '../worker/env'
import worker from '../worker/index'
import { sha256Hex } from '../worker/security/tokens'

const oldTime = '2026-01-01T00:00:00.000Z'
const future = '2099-01-01T00:00:00.000Z'
const batchPath = '/api/ai-image-batches/batch-1'
const imageResult = { id: 'provider-1', status: 'succeeded', data: [{ b64_json: 'aW1hZ2U=' }] }
const runningResult = { id: 'provider-1', status: 'running' }
const payload = { style_id: 1, source_asset_uid: 'source', prompt_text: 'local test', client_request_id: 'test-client-request-0001' }

let db: D1MigrationTestDatabase
let env: Env
const fetchWorker = worker.fetch as unknown as (request: Request, env: Env) => Promise<Response>
const request = (path: string, body?: object) => fetchWorker(new Request(`https://review.test${path}`, {
  method: body === undefined ? 'GET' : 'POST', headers: { cookie: 'cs_session=test-session' },
  body: body === undefined ? undefined : JSON.stringify(body),
}), env)
const submit = (overrides = {}) => request(`${batchPath}/generate-direct`, { ...payload, ...overrides })
const poll = (uid: string) => request(`${batchPath}/generation-requests/${uid}/poll`, {})
const generation = (uid: string) => db.prepare('SELECT * FROM ai_generation_requests WHERE request_uid = ?').bind(uid).first<{
  status: string; upstream_task_json: string; result_asset_uids_json: string; error_message: string
}>()
const audits = async (uid: string) => (await db.prepare('SELECT action FROM audit_logs WHERE resource_id = ? ORDER BY id')
  .bind(uid).all<{ action: string }>()).results.map(row => row.action.replace('jobs.generate_ai_image.direct_', ''))
const seedOldRequest = (uid: string, status = 'finalizing') => db.prepare(
  `INSERT INTO ai_generation_requests (request_uid, batch_uid, style_id, source_asset_uid, prompt_text,
      status, upstream_task_json, created_by, created_at, updated_at) VALUES (?, 'batch-1', 1, 'source', 'old prompt', ?, ?, 1, ?, ?)`,
).bind(uid, status, JSON.stringify(runningResult), oldTime, oldTime).run()

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(async () => {
  db = await createD1MigrationTestDatabase()
  await applyWorkflowMigrations(db)
  env = { DB: db.database, ASSETS: db.assets, ONE_XM_API_KEY: 'local-test-key', ONE_XM_IMAGE_MAX_POLLS: '0' } as Env
  await db.batch([
    db.prepare("INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (1, 'test@example.test', 'Test', 'unused', ?, ?)").bind(oldTime, oldTime),
    db.prepare("INSERT OR IGNORE INTO roles (role_key, name, created_at, updated_at) VALUES ('admin', 'Admin', ?, ?)").bind(oldTime, oldTime),
    db.prepare("INSERT INTO user_roles (user_id, role_id, assigned_at) SELECT 1, id, ? FROM roles WHERE role_key = 'admin'").bind(oldTime),
    db.prepare('INSERT INTO sessions (user_id, session_hash, expires_at, created_at) VALUES (1, ?, ?, ?)').bind(await sha256Hex('test-session'), future, oldTime),
    db.prepare("INSERT INTO ai_image_batches (batch_uid, title, created_at, updated_at) VALUES ('batch-1', 'D1 test', ?, ?)").bind(oldTime, oldTime),
    db.prepare("INSERT INTO ai_image_styles (id, batch_uid, style_code) VALUES (1, 'batch-1', 'test-style')"),
    db.prepare(`INSERT INTO ai_image_assets (asset_uid, batch_uid, style_id, kind, status, object_key, filename, created_at, updated_at)
                VALUES ('source', 'batch-1', 1, 'source', 'uploaded', 'source.png', 'source.png', ?, ?)`).bind(oldTime, oldTime),
  ])
  await env.ASSETS.put('source.png', 'fixture', { httpMetadata: { contentType: 'image/png' } })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await db?.dispose()
})

describe('approval workflow recovery on D1 and R2', () => {
  it('admits one provider submission per client intent and replays the receipt before and after completion', async () => {
    const began = deferred<void>()
    const accepted = deferred<void>()
    const submitKeys: Array<string | null> = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
      if (init.method === 'GET') return Response.json(imageResult)
      submitKeys.push(new Headers(init.headers).get('idempotency-key'))
      if (submitKeys.length > 1) return Response.json(imageResult)
      began.resolve()
      await accepted.promise
      return Response.json(runningResult, { status: 202 })
    }))
    const first = submit()
    await began.promise
    const repeated = await submit()
    const { request_uid: uid } = await repeated.json<{ request_uid: string }>()
    expect(repeated.status).toBe(202)
    expect((await submit({ prompt_text: 'different input' })).status).toBe(409)
    accepted.resolve()
    expect((await (await first).json<{ request_uid: string }>()).request_uid).toBe(uid)
    expect((await poll(uid)).status).toBe(201)
    const replay = await submit()
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({ request_uid: uid, status: 'completed', assets: [{ asset_uid: `cloud-gen-${uid}-1` }] })
    expect(submitKeys).toEqual([uid])
    expect(await audits(uid)).toEqual(['pending', 'poll_complete'])

    const intentional = await submit({ client_request_id: 'test-client-request-0002' })
    const newUid = (await intentional.json<{ request_uid: string }>()).request_uid
    expect(intentional.status).toBe(201)
    expect(submitKeys).toEqual([uid, newUid])
    expect(newUid).not.toBe(uid)
    expect(await audits(newUid)).toEqual(['complete'])
  })

  it('reuses the failed receipt when the provider accepts a POST before its response is lost', async () => {
    const upstream = vi.fn().mockRejectedValueOnce(new Error('provider POST response disconnected'))
    vi.stubGlobal('fetch', upstream)
    const lost = await submit()
    const { request_uid: uid } = await lost.json<{ request_uid: string }>()
    expect(lost.status).toBe(502)
    expect(await generation(uid)).toMatchObject({ status: 'failed' })
    const replay = await submit()
    expect(replay.status).toBe(409)
    expect(await replay.json()).toMatchObject({ request_uid: uid })
    expect(upstream).toHaveBeenCalledTimes(1)
    expect(await audits(uid)).toEqual(['failed'])
  })

  it('returns the D1 winner when a late running response arrives after completion', async () => {
    const uid = 'race'
    await seedOldRequest(uid, 'running')
    const started = deferred<void>()
    const release = deferred<void>()
    const upstream = vi.fn()
      .mockImplementationOnce(async () => {
        started.resolve()
        await release.promise
        return Response.json(runningResult)
      })
      .mockResolvedValueOnce(Response.json(imageResult))
    vi.stubGlobal('fetch', upstream)
    const slow = poll(uid)
    await started.promise
    expect((await poll(uid)).status).toBe(201)
    release.resolve()
    expect(await (await slow).json()).toMatchObject({ status: 'completed', assets: [{ asset_uid: 'cloud-gen-race-1' }] })
    expect(await generation(uid)).toMatchObject({ status: 'completed', result_asset_uids_json: '["cloud-gen-race-1"]' })
    expect(await audits(uid)).toEqual(['poll_complete'])
  })

  it('retries status-transport errors with the original handle and avoids duplicate failure audit', async () => {
    const uid = 'transport'
    await seedOldRequest(uid, 'running')
    const upstream = vi.fn()
      .mockRejectedValueOnce(new Error('temporary status disconnect'))
      .mockRejectedValueOnce(new Error('temporary status disconnect'))
      .mockResolvedValueOnce(Response.json({ status: 'running', poll_after: 2 }))
      .mockResolvedValueOnce(Response.json(imageResult))
    vi.stubGlobal('fetch', upstream)
    expect((await poll(uid)).status).toBe(502)
    expect((await poll(uid)).status).toBe(502)
    expect(await generation(uid)).toMatchObject({ status: 'running', upstream_task_json: JSON.stringify(runningResult) })
    expect((await poll(uid)).status).toBe(202)
    expect((await poll(uid)).status).toBe(201)
    expect(await audits(uid)).toEqual(['poll_failed', 'poll_pending', 'poll_complete'])
    expect(upstream.mock.calls.every(([url, init]) => url.endsWith('/provider-1') && init.method === 'GET')).toBe(true)
  })

  it.each(['failed', 'succeeded'])('ends an expired legacy finalization when upstream returns %s without an image', async status => {
    const uid = `legacy-${status}`
    await seedOldRequest(uid)
    const upstream = vi.fn().mockRejectedValueOnce(new Error('temporary legacy disconnect'))
      .mockResolvedValueOnce(Response.json({ id: 'provider-1', status }))
    vi.stubGlobal('fetch', upstream)
    expect((await poll(uid)).status).toBe(502)
    expect((await generation(uid))?.status).toBe('finalizing')
    expect((await poll(uid)).status).toBe(502)
    expect((await generation(uid))?.status).toBe('failed')
    expect((await poll(uid)).status).toBe(409)
    expect(await audits(uid)).toEqual(['poll_failed', 'poll_failed'])
    expect(upstream).toHaveBeenCalledTimes(2)
  })

  it('reads back a completed recovery when a competing legacy poll reports terminal failure late', async () => {
    const uid = 'legacy-race'
    await seedOldRequest(uid)
    const started = deferred<void>()
    const release = deferred<void>()
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce(async () => {
        started.resolve()
        await release.promise
        return Response.json({ id: 'provider-1', status: 'failed' })
      })
      .mockResolvedValueOnce(Response.json(imageResult)))
    const late = poll(uid)
    await started.promise
    expect((await poll(uid)).status).toBe(201)
    release.resolve()
    expect(await (await late).json()).toMatchObject({ status: 'completed' })
    expect(await audits(uid)).toEqual(['poll_complete'])
  })

  it('replays a stored image checkpoint after the lease expires and rolls back audit and terminal status together', async () => {
    const upstream = vi.fn().mockResolvedValue(Response.json({ status: 'succeeded', data: imageResult.data }))
    vi.stubGlobal('fetch', upstream)
    await db.exec("CREATE TRIGGER deny_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'simulated audit failure'); END")
    const response = await submit()
    const { request_uid: uid } = await response.json<{ request_uid: string }>()
    expect(response.status).toBe(502)
    expect((await generation(uid))?.status).toBe('finalizing')
    expect(await db.prepare('SELECT COUNT(*) AS total FROM approval_events').first('total')).toBe(0)
    await db.exec('DROP TRIGGER deny_audit')
    expect((await poll(uid)).status).toBe(202)
    await db.prepare('UPDATE ai_generation_requests SET updated_at = ? WHERE request_uid = ?').bind(oldTime, uid).run()
    const outcomes = await Promise.all([poll(uid), poll(uid)])
    expect(outcomes.map(outcome => outcome.status)).toContain(201)
    expect(upstream).toHaveBeenCalledTimes(1)
    expect(await audits(uid)).toEqual(['poll_complete'])
    expect(await db.prepare('SELECT COUNT(*) AS total FROM approval_events').first('total')).toBe(1)
    expect(await db.prepare("SELECT COUNT(*) AS total FROM ai_image_assets WHERE kind = 'ai'").first('total')).toBe(1)
  })

  it('resolves the latest version from a published library with 101 enabled templates and limit=1', async () => {
    await db.prepare("INSERT INTO prompt_libraries (id, name, scenario, status, created_at, updated_at) VALUES (1, 'test', 'test', 'published', ?, ?)").bind(oldTime, oldTime).run()
    for (const version of [1, 2]) {
      await db.batch(Array.from({ length: 101 }, (_, index) => {
        const id = index + 1
        return version === 1
          ? db.prepare("INSERT INTO prompt_templates (id, library_id, group_name, field_name, prompt_text, updated_at) VALUES (?, 1, 'test', 'field', 'draft', ?)").bind(id, oldTime)
          : db.prepare("INSERT INTO prompt_template_versions (template_id, version_no, snapshot_json, created_at) VALUES (?, 1, ?, ?)")
            .bind(id, JSON.stringify({ prompt_text: `published-${id}` }), oldTime)
      }))
    }
    await db.prepare("INSERT INTO prompt_template_versions (template_id, version_no, snapshot_json, created_at) VALUES (1, 2, ?, ?)")
      .bind(JSON.stringify({ prompt_text: 'newest' }), oldTime).run()
    await db.batch([
      db.prepare(`INSERT INTO task_machines (machine_id, machine_name, fingerprint_hash, auth_status, capabilities_json, registered_at, updated_at)
                  VALUES ('prompt-machine', 'Test machine', 'fingerprint', 'active', '["generate_ai_image"]', ?, ?)`).bind(oldTime, oldTime),
      db.prepare("INSERT INTO machine_tokens (machine_id, token_hash, issued_at) VALUES ('prompt-machine', ?, ?)")
        .bind(await sha256Hex('test-machine-token'), oldTime),
    ])
    const path = '/api/prompt-libraries/1/resolved?limit=1'
    const replies = await Promise.all([
      request(path),
      fetchWorker(new Request(`https://review.test${path}`, { headers: { authorization: 'Bearer test-machine-token' } }), env),
    ])
    for (const reply of replies) {
      expect(reply.status).toBe(200)
      expect(await reply.json()).toMatchObject({ templates: [{ template_id: 1, prompt_text: 'newest' }] })
    }
  })
})
