import type { Env } from './env'

export interface OneXmImageInput {
  model: string
  prompt: string
  imageDataUrls: string[]
  size: string
  quality: string
  outputFormat: string
  count: number
  idempotencyKey?: string
}

export type OneXmImageTaskResult =
  | { status: 'completed'; dataUrls: string[]; task: unknown }
  | { status: 'running'; task: unknown; taskStatus: string; nextPollAfterMs: number; error?: string }

const DEFAULT_BASE_URL = 'https://api.1xm.ai/v1'
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_FETCH_TIMEOUT_MS = 30_000
const DEFAULT_POLL_INTERVAL_MS = 3_000
const DEFAULT_MAX_POLLS = 0
const TASK_HTTP_TIMEOUT_MS = 30_000
const TRANSIENT_STATUSES = new Set([408, 409, 425, 429, 502, 503, 504, 524])
const SUCCEEDED_STATUSES = new Set(['succeeded', 'completed', 'success', 'done'])
const FAILED_STATUSES = new Set(['failed', 'error', 'canceled', 'cancelled'])
const MODEL_ALIASES: Record<string, string> = {
  'nano-banana-2': 'gemini-3.1-flash-image-preview',
  'nano-banana-pro': 'gemini-3-pro-image-preview',
}

export async function createAndPollOneXmImageTask(env: Env, input: OneXmImageInput): Promise<OneXmImageTaskResult> {
  const model = canonicalOneXmModel(input.model)
  const apiKey = resolveOneXmApiKey(env, model)
  if (!apiKey) throw oneXmError(`Missing 1XM API key for ${model}`, 400)
  const baseUrl = oneXmBaseUrl(env)
  const timeoutMs = numberFromEnv(env.ONE_XM_IMAGE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1_000, 900_000)
  const deadlineAt = Date.now() + timeoutMs
  const task = await createImageTask(baseUrl, apiKey, buildImageTaskPayload(env, model, input), input.idempotencyKey, deadlineAt)
  return settleImageTask(env, baseUrl, apiKey, task, deadlineAt)
}

export async function settleOneXmImageTask(env: Env, task: unknown, modelOverride?: string): Promise<OneXmImageTaskResult> {
  const model = canonicalOneXmModel(modelOverride || modelFromTask(task))
  const apiKey = resolveOneXmApiKey(env, model)
  if (!apiKey) throw oneXmError(`Missing 1XM API key for ${model}`, 400)
  const timeoutMs = Math.min(
    numberFromEnv(env.ONE_XM_IMAGE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1_000, 900_000),
    numberFromEnv(env.ONE_XM_IMAGE_FETCH_TIMEOUT_MS, DEFAULT_FETCH_TIMEOUT_MS, 1_000, 120_000) + TASK_HTTP_TIMEOUT_MS,
  )
  return settleImageTask(env, oneXmBaseUrl(env), apiKey, task, Date.now() + timeoutMs, {
    maxPolls: 1,
    skipFirstDelay: true,
  })
}

export function canonicalOneXmModel(model: string): string {
  const value = String(model || '').trim()
  return MODEL_ALIASES[value] || value || 'gpt-image-2'
}

export function mimeFromDataUrl(dataUrl: string): string {
  const match = String(dataUrl || '').match(/^data:(image\/[^;]+);base64,/)
  return match?.[1] || 'image/png'
}

export function extensionForMime(mime: string, fallback: string): string {
  const normalized = mime.toLowerCase()
  if (normalized === 'image/jpeg') return 'jpg'
  if (normalized === 'image/webp') return 'webp'
  if (normalized === 'image/gif') return 'gif'
  if (normalized === 'image/png') return 'png'
  return normalizeOutputFormat(fallback) || 'png'
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const match = String(dataUrl || '').match(/^data:image\/[^;]+;base64,(.+)$/)
  if (!match) throw oneXmError('Generated image is not a data URL', 502)
  return base64ToBytes(match[1])
}

export function arrayBufferToDataUrl(buffer: ArrayBuffer, mime: string): string {
  return `data:${normalizeImageMime(mime)};base64,${arrayBufferToBase64(buffer)}`
}

function buildImageTaskPayload(env: Env, model: string, input: OneXmImageInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model,
    prompt: input.prompt,
    n: normalizeCount(input.count),
    output_format: normalizeOutputFormat(input.outputFormat),
  }
  if (model === 'gpt-image-2') {
    payload.size = normalizeGptImageSize(input.size)
    payload.quality = normalizeGptImageQuality(input.quality)
    if (env.ONE_XM_GPT_IMAGE_GROUP) payload.group = env.ONE_XM_GPT_IMAGE_GROUP
  } else {
    payload.size = normalizeGeminiSize(input.size)
    payload.quality = normalizeGeminiQuality(input.quality)
  }
  if (input.imageDataUrls.length > 0) payload.image = input.imageDataUrls
  return payload
}

async function createImageTask(baseUrl: string, apiKey: string, payload: Record<string, unknown>, idempotencyKey: string | undefined, deadlineAt: number): Promise<unknown> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  const response = await fetchWithTimeout(`${baseUrl}/images/tasks`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  }, Math.min(TASK_HTTP_TIMEOUT_MS, Math.max(1_000, deadlineAt - Date.now())))
  const data = await readJsonResponse(response)
  if (!response.ok && response.status !== 202) {
    throw oneXmError(`Upstream ${response.status}: ${formatUpstreamError(data)}`, response.status)
  }
  return data
}

async function settleImageTask(env: Env, baseUrl: string, apiKey: string, initialTask: unknown, deadlineAt: number, options: { maxPolls?: number; skipFirstDelay?: boolean } = {}): Promise<OneXmImageTaskResult> {
  let task = initialTask
  let attempts = 0
  const maxPolls = options.maxPolls ?? numberFromEnv(env.ONE_XM_IMAGE_MAX_POLLS, DEFAULT_MAX_POLLS, 0, 120)
  const fetchTimeoutMs = numberFromEnv(env.ONE_XM_IMAGE_FETCH_TIMEOUT_MS, DEFAULT_FETCH_TIMEOUT_MS, 1_000, 120_000)

  for (;;) {
    const status = taskStatus(task)
    const dataUrls = await extractImageDataUrls(task, fetchTimeoutMs)
    if (dataUrls.length > 0) return { status: 'completed', dataUrls, task }
    if (SUCCEEDED_STATUSES.has(status)) throw oneXmError('Model returned no image.', 502)
    if (FAILED_STATUSES.has(status)) throw oneXmError(`Image task ${status}: ${formatUpstreamError(task)}`, 502)

    const pollTarget = pollTargetFromTask(task)
    const nextPollAfterMs = pollAfterMs(env, task)
    if (!pollTarget) throw oneXmError('Image task response did not include poll_url or task_id.', 502)
    if (attempts >= maxPolls || Date.now() >= deadlineAt) {
      return { status: 'running', task, taskStatus: status || 'queued', nextPollAfterMs }
    }

    if (!(options.skipFirstDelay && attempts === 0)) {
      await sleep(Math.min(nextPollAfterMs, Math.max(0, deadlineAt - Date.now())))
    }
    const pollUrl = buildPollUrl(baseUrl, pollTarget)
    const response = await fetchWithTimeout(pollUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    }, Math.min(TASK_HTTP_TIMEOUT_MS, Math.max(1_000, deadlineAt - Date.now())))
    const data = await readJsonResponse(response)
    if (!response.ok) {
      if (TRANSIENT_STATUSES.has(response.status)) {
        return {
          status: 'running',
          task,
          taskStatus: status || 'queued',
          nextPollAfterMs,
          error: `Upstream ${response.status}: ${formatUpstreamError(data)}`,
        }
      }
      throw oneXmError(`Upstream ${response.status}: ${formatUpstreamError(data)}`, response.status)
    }
    task = data
    attempts += 1
  }
}

async function extractImageDataUrls(task: unknown, imageFetchTimeoutMs: number): Promise<string[]> {
  const urls: string[] = []
  const records = imageRecords(task)
  for (const record of records) {
    const direct = stringValue(record.b64_json)
      ? `data:image/png;base64,${stringValue(record.b64_json)}`
      : dataUrlString(record.url) || dataUrlString(record.image_url) || dataUrlString(record.output_url)
    if (direct) {
      urls.push(direct)
      continue
    }
    const remoteUrl = remoteImageUrl(record.url) || remoteImageUrl(record.image_url) || remoteImageUrl(record.output_url)
    if (remoteUrl) urls.push(await remoteImageToDataUrl(remoteUrl, imageFetchTimeoutMs))
  }
  const topLevel = task && typeof task === 'object' && !Array.isArray(task) ? task as Record<string, unknown> : {}
  const remoteUrl = remoteImageUrl(topLevel.output_url) || remoteImageUrl(topLevel.url)
  if (remoteUrl) urls.push(await remoteImageToDataUrl(remoteUrl, imageFetchTimeoutMs))
  const topDataUrl = dataUrlString(topLevel.output_url) || dataUrlString(topLevel.url)
  if (topDataUrl) urls.push(topDataUrl)
  return urls
}

function imageRecords(task: unknown): Array<Record<string, unknown>> {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return []
  const record = task as Record<string, unknown>
  const data = Array.isArray(record.data) ? record.data : []
  const images = Array.isArray(record.images) ? record.images : []
  return [...data, ...images].filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
}

async function remoteImageToDataUrl(url: string, timeoutMs: number): Promise<string> {
  const response = await fetchWithTimeout(url, {}, timeoutMs)
  if (!response.ok) throw oneXmError(`Generated image download failed: ${response.status}`, 502)
  const buffer = await response.arrayBuffer()
  return arrayBufferToDataUrl(buffer, response.headers.get('content-type') || 'image/png')
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

function oneXmBaseUrl(env: Env): string {
  return String(env.ONE_XM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

function resolveOneXmApiKey(env: Env, model: string): string {
  if (model === 'gpt-image-2') return stringValue(env.ONE_XM_GPT_IMAGE_2_KEY) || stringValue(env.ONE_XM_API_KEY)
  if (model === 'gemini-3.1-flash-image-preview') return stringValue(env.ONE_XM_GEMINI_3_1_FLASH_IMAGE_PREVIEW_KEY) || stringValue(env.ONE_XM_API_KEY)
  if (model === 'gemini-3-pro-image-preview') return stringValue(env.ONE_XM_GEMINI_3_PRO_IMAGE_PREVIEW_KEY) || stringValue(env.ONE_XM_API_KEY)
  return stringValue(env.ONE_XM_API_KEY)
}

function modelFromTask(task: unknown): string {
  if (task && typeof task === 'object' && !Array.isArray(task)) {
    return canonicalOneXmModel(stringValue((task as Record<string, unknown>).model))
  }
  return 'gpt-image-2'
}

function buildPollUrl(baseUrl: string, pollTarget: string): string {
  if (/^https?:\/\//i.test(pollTarget)) return pollTarget
  return `${baseUrl}/images/tasks/${encodeURIComponent(pollTarget)}`
}

function pollTargetFromTask(task: unknown): string {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return ''
  const record = task as Record<string, unknown>
  return stringValue(record.poll_url) || stringValue(record.pollUrl) || stringValue(record.id) || stringValue(record.task_id) || stringValue(record.taskId)
}

function taskStatus(task: unknown): string {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return ''
  return stringValue((task as Record<string, unknown>).status).toLowerCase()
}

function pollAfterMs(env: Env, task: unknown): number {
  const fallback = numberFromEnv(env.ONE_XM_IMAGE_POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS, 0, 60_000)
  if (!task || typeof task !== 'object' || Array.isArray(task)) return fallback
  const record = task as Record<string, unknown>
  const seconds = Number(record.poll_after ?? record.pollAfter)
  if (!Number.isFinite(seconds) || seconds < 0) return fallback
  return Math.min(60_000, Math.max(0, seconds * 1_000))
}

function normalizeGptImageSize(value: string): string {
  const size = String(value || '').trim().toLowerCase()
  if (/^\d+x\d+$/.test(size)) return size
  if (size === '1:1') return '1024x1024'
  if (size === '4:3') return '1536x1024'
  if (size === '3:4') return '1024x1536'
  if (size === '16:9') return '1536x864'
  if (size === '9:16') return '864x1536'
  return 'auto'
}

function normalizeGptImageQuality(value: string): string {
  const quality = String(value || '').trim().toLowerCase()
  return ['auto', 'high', 'medium', 'low'].includes(quality) ? quality : 'high'
}

function normalizeGeminiSize(value: string): string {
  const size = String(value || '').trim()
  if (['1:1', '4:3', '3:4', '16:9', '9:16'].includes(size)) return size
  if (size === '1024x1024' || size === '2048x2048' || size === '4096x4096') return '1:1'
  if (size === '1536x1024') return '4:3'
  if (size === '1024x1536') return '3:4'
  return '1:1'
}

function normalizeGeminiQuality(value: string): string {
  const quality = String(value || '').trim().toUpperCase()
  return ['1K', '2K', '4K'].includes(quality) ? quality : '2K'
}

function normalizeOutputFormat(value: string): string {
  const format = String(value || '').trim().toLowerCase()
  return format === 'jpeg' ? 'jpg' : (['png', 'jpg', 'webp'].includes(format) ? format : 'png')
}

function normalizeCount(value: number): number {
  return Number.isInteger(value) ? Math.max(1, Math.min(8, value)) : 1
}

function normalizeImageMime(value: string): string {
  const mime = String(value || '').split(';')[0].trim().toLowerCase()
  return mime.startsWith('image/') ? mime : 'image/png'
}

function dataUrlString(value: unknown): string {
  const text = stringValue(value)
  return /^data:image\/[^;]+;base64,/i.test(text) ? text : ''
}

function remoteImageUrl(value: unknown): string {
  const text = stringValue(value)
  return /^https?:\/\//i.test(text) ? text : ''
}

function formatUpstreamError(data: unknown): string {
  if (!data || typeof data !== 'object') return String(data || 'unknown error').slice(0, 500)
  const record = data as Record<string, unknown>
  const nested = record.error && typeof record.error === 'object' && !Array.isArray(record.error) ? record.error as Record<string, unknown> : {}
  return String(nested.message || record.error || record.message || record.raw || JSON.stringify(record)).slice(0, 500)
}

function numberFromEnv(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, number))
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function oneXmError(message: string, status: number): Error & { status?: number } {
  const error = new Error(message) as Error & { status?: number }
  error.status = status
  return error
}
