export function buildBalaAiStageRequest(exportResult = {}) {
  const next = exportResult?.next_task || {}
  return {
    adapterId: String(next.adapter_id || 'bala-ai-video-assistant'),
    taskId: String(next.task_id || 'bala_ai_face_background_generate'),
    params: next.params && typeof next.params === 'object' ? next.params : {},
  }
}

export function parseBalaMaterialBoardUrl(url = '') {
  try {
    const parsed = new URL(String(url || ''))
    if (!parsed.pathname.includes('/bala-ai-video-materials/')) return null
    const parts = parsed.pathname.split('/').filter(Boolean)
    const batchId = parts[parts.length - 1] || ''
    const token = parsed.searchParams.get('token') || ''
    if (!batchId || !token) return null
    return { batchId, token }
  } catch {
    return null
  }
}

export function collectDownloadedMaterialRows(payload = {}) {
  const rows = []
  const appendRows = (value) => {
    if (Array.isArray(value)) {
      for (const row of value) {
        if (row && typeof row === 'object') rows.push(row)
      }
    }
  }
  appendRows(payload?.rows)
  appendRows(payload?.data)
  appendRows(payload?.records)
  appendRows(payload?.result?.rows)
  appendRows(payload?.result?.data)
  return rows.filter(row =>
    String(row?.本地文件 || row?.local_file || '').trim()
    && !['已跳过', '失败', '下载失败'].includes(String(row?.下载结果 || '').trim())
  )
}
