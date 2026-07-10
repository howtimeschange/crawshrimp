function lineAndColumnFromPosition(source, position) {
  const safePosition = Math.max(0, Math.min(Number(position) || 0, source.length))
  const prefix = source.slice(0, safePosition)
  const lines = prefix.split('\n')
  return {
    line: lines.length,
    column: (lines.at(-1)?.length || 0) + 1,
  }
}

function jsonErrorLocation(source, error) {
  const message = String(error?.message || error || '')
  const explicitLocation = message.match(/line\s+(\d+)\s+column\s+(\d+)/i)
  if (explicitLocation) {
    return { line: Number(explicitLocation[1]), column: Number(explicitLocation[2]) }
  }
  const positionMatch = message.match(/position\s+(\d+)/i)
  return lineAndColumnFromPosition(source, positionMatch ? Number(positionMatch[1]) : source.length)
}

export function parseAdvancedJsonConfig(value) {
  const source = String(value || '').trim()
  if (!source) return {}

  let parsed
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    const { line, column } = jsonErrorLocation(source, error)
    throw new Error(`高级 JSON 格式错误：第 ${line} 行，第 ${column} 列。请检查双引号、逗号和括号。`)
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('高级 JSON 必须是对象，例如 {"background":"white"}。')
  }
  return parsed
}
