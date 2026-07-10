export function resultIdentityCandidates(item = {}) {
  return [item.url, item.path]
    .map((value) => String(value || '').trim())
    .filter((value, index, values) => value && values.indexOf(value) === index)
}

export function mergeCurrentJobRecord(currentJob, jobs = []) {
  if (!currentJob || typeof currentJob !== 'object') return currentJob || null
  const jobUid = String(currentJob.job_uid || '').trim()
  if (!jobUid) return currentJob
  const persistedJob = (Array.isArray(jobs) ? jobs : [])
    .find((job) => String(job?.job_uid || '').trim() === jobUid)
  return persistedJob ? { ...persistedJob, ...currentJob } : currentJob
}

export function buildResultIndex(items = []) {
  const index = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    for (const key of resultIdentityCandidates(item)) index.set(key, item)
  }
  return index
}

export function resolveResultLineage(item, items = []) {
  if (!item) return []
  const index = buildResultIndex(items)
  const visited = new Set(resultIdentityCandidates(item))
  const ancestors = []
  let parentKey = String(item.editSource?.result_key || '').trim()

  while (parentKey && !visited.has(parentKey)) {
    const parent = index.get(parentKey)
    if (!parent) break
    ancestors.unshift(parent)
    resultIdentityCandidates(parent).forEach((key) => visited.add(key))
    parentKey = String(parent.editSource?.result_key || '').trim()
  }

  return [...ancestors, item]
}

export function promptChainFromLineage(items = []) {
  return (Array.isArray(items) ? items : []).map((item, index) => ({
    key: `prompt-lineage-${index}`,
    label: index === 0 ? '原图 Prompt' : `修改 Prompt ${index}`,
    prompt: String(item?.prompt || '').trim(),
  }))
}
