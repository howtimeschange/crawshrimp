function cellText(row, keys) {
  for (const key of keys) {
    const value = row?.[key]
    const text = String(value == null ? '' : value).trim()
    if (text) return text
  }
  return ''
}

function classifyPrecheckRow(row) {
  const status = cellText(row, ['状态', 'status'])
  const result = cellText(row, ['执行结果', 'result'])
  const note = cellText(row, ['备注', 'note'])
  const combined = `${status} ${result} ${note}`

  if (status === 'invalid' || /预检失败|校验失败|配置有误/.test(combined)) return 'invalid'
  if (status === 'ready_but_out_of_current_live_scope') return 'outOfScope'
  if (status === 'ready_for_live' || /预检通过|校验通过/.test(combined)) return 'ready'
  return 'unknown'
}

export function summarizePrecheckRows(rows = []) {
  if (!Array.isArray(rows) || !rows.length) {
    return { pass: false, summary: '预检结果为空' }
  }

  const counts = {
    ready: 0,
    invalid: 0,
    outOfScope: 0,
    unknown: 0,
  }

  for (const row of rows) {
    counts[classifyPrecheckRow(row)] += 1
  }

  const parts = []
  if (counts.ready) parts.push(`${counts.ready} 行可直接执行`)
  if (counts.invalid) parts.push(`${counts.invalid} 行配置有误`)
  if (counts.outOfScope) parts.push(`${counts.outOfScope} 行超出当前 live 范围`)
  if (counts.unknown) parts.push(`${counts.unknown} 行未识别预检状态`)

  return {
    pass: counts.ready > 0 && counts.invalid === 0 && counts.outOfScope === 0 && counts.unknown === 0,
    summary: parts.join('，') || '未识别到有效预检结果',
  }
}
