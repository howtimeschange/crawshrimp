import { afterEach, expect, test, vi } from 'vitest'
import { createAndPollOneXmImageTask } from '../worker/one-xm-image'
import type { Env } from '../worker/env'

const image = 'data:image/png;base64,aW1hZ2U='
const input = { model: 'woka/gpt-image-2', prompt: 'product', imageDataUrls: [image], size: '1:1', quality: 'high', outputFormat: 'png', count: 1 }
afterEach(() => vi.unstubAllGlobals())

test('cloud Woka uses authenticated multipart edits and materializes the response', async () => {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    expect(init.headers).toEqual({ Authorization: 'Bearer woka-key' })
    const form = init.body as FormData
    expect(form.get('model')).toBe('gpt-image-2')
    expect(form.get('image')).toBeInstanceOf(Blob)
    return Response.json({ data: [{ b64_json: 'aW1hZ2U=' }] })
  })
  vi.stubGlobal('fetch', fetch)
  const result = await createAndPollOneXmImageTask({ WOKA_IMAGE_API_KEY: 'woka-key' } as Env, input)
  expect(fetch.mock.calls[0][0]).toBe('https://4.0.wk-best.com/v1/images/edits')
  expect(result.status).toBe('completed')
  if (result.status === 'completed') expect(result.dataUrls).toEqual([image])
})

test('cloud Semir Gemini preserves reference, resolution, and requested count', async () => {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    expect(init.headers).toEqual({ 'x-goog-api-key': 'google-key', 'Content-Type': 'application/json' })
    const body = JSON.parse(init.body as string)
    expect(body.contents[0].parts[1].inlineData.data).toBe('aW1hZ2U=')
    expect(body.generationConfig.imageConfig).toEqual({ aspectRatio: '3:4', imageSize: '4K' })
    return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] } }] })
  })
  vi.stubGlobal('fetch', fetch)
  const result = await createAndPollOneXmImageTask({ SEMIR_IMAGE_GEMINI_API_KEY: 'google-key' } as Env, { ...input, model: 'semir/gemini-3-pro-image-preview', size: '3:4', quality: '4K', count: 2 })
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(fetch.mock.calls[0][0]).toBe('https://ai-aigw.semir.com/overseas-image-gemini/v1beta/models/gemini-3-pro-image-preview:generateContent')
  if (result.status === 'completed') expect(result.dataUrls).toEqual([image, image])
})

test('missing provider key never falls back to 1XM', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  await expect(createAndPollOneXmImageTask({ ONE_XM_API_KEY: 'legacy' } as Env, input)).rejects.toThrow('Missing woka')
  expect(fetch).not.toHaveBeenCalled()
})

test('network ambiguity does not resubmit synchronous generation', async () => {
  const fetch = vi.fn(async () => { throw new Error('timeout') })
  vi.stubGlobal('fetch', fetch)
  await expect(createAndPollOneXmImageTask({ WOKA_IMAGE_API_KEY: 'key' } as Env, input)).rejects.toThrow('timeout')
  expect(fetch).toHaveBeenCalledTimes(1)
})

test('explicit rate limiting retries, then returns the completed images', async () => {
  let calls = 0
  vi.stubGlobal('fetch', vi.fn(async () => {
    calls += 1
    return calls === 1 ? Response.json({ error: { code: 'rate_limit_exceeded' } }, { status: 429 }) : Response.json({ data: [{ b64_json: 'aW1hZ2U=' }] })
  }))
  const result = await createAndPollOneXmImageTask({ WOKA_IMAGE_API_KEY: 'key' } as Env, input)
  expect(calls).toBe(2)
  expect(result.status).toBe('completed')
})
