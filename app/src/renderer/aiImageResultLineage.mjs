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

function buildItemQueueIndex(queues = []) {
  const index = new Map()
  queues.forEach((queue, queueIndex) => {
    for (const item of queue.items || []) {
      for (const identity of resultIdentityCandidates(item)) {
        if (!index.has(identity)) index.set(identity, queueIndex)
      }
    }
  })
  return index
}

function resultLineageHasCycle(item, items = []) {
  const index = buildResultIndex(items)
  const visited = new Set(resultIdentityCandidates(item))
  let parentKey = String(item?.editSource?.result_key || '').trim()
  while (parentKey) {
    if (visited.has(parentKey)) return true
    const parent = index.get(parentKey)
    if (!parent) return false
    resultIdentityCandidates(parent).forEach((identity) => visited.add(identity))
    parentKey = String(parent?.editSource?.result_key || '').trim()
  }
  return false
}

function resolveQueueRootIndex(queue, queueIndex, allItems, itemQueueIndex) {
  for (const item of queue.items || []) {
    if (!String(item?.editSource?.result_key || '').trim()) continue
    if (resultLineageHasCycle(item, allItems)) return queueIndex
    const lineage = resolveResultLineage(item, allItems)
    if (lineage.length < 2) continue
    const root = lineage[0]
    for (const identity of resultIdentityCandidates(root)) {
      const rootIndex = itemQueueIndex.get(identity)
      if (Number.isInteger(rootIndex) && rootIndex >= 0 && rootIndex < queueIndex) return rootIndex
    }
  }
  return queueIndex
}

function aggregateQueueStatus(statuses = []) {
  const normalized = statuses
    .map((status) => String(status || '').trim().toLowerCase())
    .filter(Boolean)
  return ['running', 'queued', 'failed', 'completed']
    .find((status) => normalized.includes(status)) || normalized[0] || ''
}

function finalizeQueueGroup(group) {
  const { statuses, ...queue } = group
  let resultIndex = 0
  const items = queue.items.map((item) => {
    if (item?.loading || item?.failed) return { ...item }
    resultIndex += 1
    return { ...item, label: `结果 ${resultIndex}` }
  })
  return {
    ...queue,
    status: aggregateQueueStatus(statuses),
    loading: items.some((item) => item?.loading),
    items,
  }
}

export function groupResultQueuesByLineage(queues = []) {
  const sourceQueues = (Array.isArray(queues) ? queues : [])
    .filter((queue) => queue && Array.isArray(queue.items) && queue.items.length)
    .map((queue) => ({
      ...queue,
      items: queue.items.map((item) => ({ ...item })),
    }))
  if (!sourceQueues.length) return []

  const allItems = sourceQueues.flatMap((queue) => queue.items)
  const itemQueueIndex = buildItemQueueIndex(sourceQueues)
  const groups = []
  const groupsByRootIndex = new Map()

  sourceQueues.forEach((queue, queueIndex) => {
    const rootIndex = resolveQueueRootIndex(queue, queueIndex, allItems, itemQueueIndex)
    let group = groupsByRootIndex.get(rootIndex)
    if (!group) {
      const rootQueue = sourceQueues[rootIndex] || queue
      group = {
        ...rootQueue,
        items: [],
        statuses: [],
      }
      groupsByRootIndex.set(rootIndex, group)
      groups.push(group)
    }
    group.items.push(...queue.items)
    group.statuses.push(queue.status)
  })

  return groups.map(finalizeQueueGroup)
}

export function promptChainFromLineage(items = []) {
  return (Array.isArray(items) ? items : []).map((item, index) => ({
    key: `prompt-lineage-${index}`,
    label: index === 0 ? '原图 Prompt' : `修改 Prompt ${index}`,
    prompt: String(item?.prompt || '').trim(),
  }))
}
