export type JsonRecord = Record<string, unknown>

export function nowIso(): string {
  return new Date().toISOString()
}

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? {})
}

export function fromJsonObject(value: string | null | undefined): JsonRecord {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export async function first<T>(stmt: D1PreparedStatement): Promise<T | null> {
  const row = await stmt.first<T>()
  return row || null
}
