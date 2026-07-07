export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(data), {
    status: init.status,
    statusText: init.statusText,
    headers,
  })
}

export function badRequest(message: string): Response {
  return json({ error: message }, { status: 400 })
}

export function unauthorized(message = 'Unauthorized'): Response {
  return json({ error: message }, { status: 401 })
}

export function forbidden(message = 'Forbidden'): Response {
  return json({ error: message }, { status: 403 })
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json()
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
