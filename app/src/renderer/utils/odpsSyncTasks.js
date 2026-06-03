const ODPS_SYNCABLE_TASKS = Object.freeze([
  Object.freeze({ adapterId: 'temu', taskId: 'mall_flux', aliases: Object.freeze(['mall-flux']) }),
  Object.freeze({ adapterId: 'tiktok-ops-assistant', taskId: 'product_analytics', aliases: Object.freeze(['product-analytics']) }),
  Object.freeze({ adapterId: 'aliexpress-ops-assistant', taskId: 'deal_analysis', aliases: Object.freeze(['deal-analysis']) }),
  Object.freeze({ adapterId: 'aliexpress-ops-assistant', taskId: 'product_ranking', aliases: Object.freeze(['product-ranking']) }),
  Object.freeze({ adapterId: 'lazada-plus-v1', taskId: 'business_advisor', aliases: Object.freeze(['business-advisor']) }),
  Object.freeze({ adapterId: 'shopee-plus-v2', taskId: 'business_analysis', aliases: Object.freeze(['business-analysis']) }),
])

function normalize(value) {
  return String(value || '').trim()
}

export function isExcelFile(path) {
  return /\.(xlsx|xlsm|xls)$/i.test(normalize(path))
}

export function resolveOdpsSyncTask(adapterId, taskId) {
  const adapter = normalize(adapterId)
  const task = normalize(taskId)
  const item = ODPS_SYNCABLE_TASKS.find(candidate =>
    candidate.adapterId === adapter &&
    [candidate.taskId, ...(candidate.aliases || [])].includes(task)
  )
  return item ? { adapter_id: item.adapterId, task_id: item.taskId } : null
}

export function isOdpsSyncableTask(adapterId, taskId) {
  return !!resolveOdpsSyncTask(adapterId, taskId)
}

export function buildOdpsSyncFile(adapterId, taskId, path) {
  const resolved = resolveOdpsSyncTask(adapterId, taskId)
  const normalizedPath = normalize(path)
  if (!resolved || !normalizedPath) return null
  return { ...resolved, path: normalizedPath }
}

export function isOdpsSyncableFile(file) {
  return !!file &&
    !!resolveOdpsSyncTask(file.adapter_id, file.task_id) &&
    isExcelFile(file.path)
}

export function groupOdpsSyncableFiles(files = []) {
  const groups = []
  const indexByKey = new Map()

  for (const file of files || []) {
    if (!isOdpsSyncableFile(file)) continue
    const task = resolveOdpsSyncTask(file.adapter_id, file.task_id)
    const path = normalize(file.path)
    const key = `${task.adapter_id}::${task.task_id}`
    let index = indexByKey.get(key)
    if (index == null) {
      index = groups.length
      indexByKey.set(key, index)
      groups.push({ ...task, paths: [] })
    }
    groups[index].paths.push(path)
  }

  return groups
}
