export interface ApiError {
  status: number
  message: string
}

export type JsonRecord = Record<string, unknown>

async function apiRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  const data = text ? safeJson(text) : null
  if (!response.ok) {
    const message = messageFor(data) || response.statusText || 'Request failed'
    throw { status: response.status, message } satisfies ApiError
  }
  return data as T
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function messageFor(data: unknown): string {
  if (data && typeof data === 'object') {
    const record = data as JsonRecord
    if (typeof record.error === 'string') return record.error
    if (typeof record.message === 'string') return record.message
  }
  return typeof data === 'string' ? data : ''
}

export function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>('GET', path)
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>('POST', path, body ?? {})
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>('PATCH', path, body ?? {})
}
