const REDACTED = '[redacted]'
const SENSITIVE_KEY_PATTERN = /(^|[_-])(api[_-]?key|access[_-]?token|refresh[_-]?token|token|authorization|cookie|session|password|secret|local[_-]?path|file[_-]?path|source[_-]?path)$/i
const LOCAL_PATH_PATTERN = /(^|[\s"'=])(?:\/Users\/|\/private\/|\/tmp\/|\/var\/|\/opt\/|\/mnt\/|[A-Za-z]:\\)/
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/i

export function redactSensitiveJson(value: unknown): unknown {
  return redactValue(value, '')
}

export function redactSensitiveText(value: unknown): string {
  if (typeof value !== 'string') return ''
  const redacted = redactValue(value, '')
  return typeof redacted === 'string' ? redacted : REDACTED
}

function redactValue(value: unknown, key: string): unknown {
  if (isSensitiveKey(key)) return REDACTED
  if (typeof value === 'string') {
    if (LOCAL_PATH_PATTERN.test(value) || BEARER_PATTERN.test(value)) return REDACTED
    return value
  }
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, ''))
  if (value && typeof value === 'object') {
    const redacted: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      redacted[childKey] = redactValue(childValue, childKey)
    }
    return redacted
  }
  return value
}

function isSensitiveKey(key: string): boolean {
  return Boolean(key && SENSITIVE_KEY_PATTERN.test(key))
}
