export function taskIdentityKey(adapterId, task) {
  const adapter = String(adapterId || task?.adapter_id || '').trim()
  const taskId = String(task?.task_id || task?.id || '').trim()
  return adapter && taskId ? `${adapter}::${taskId}` : ''
}

export function shouldResetTaskValues(previousKey, task, adapterId = '') {
  const nextKey = taskIdentityKey(adapterId, task)
  if (!nextKey) return false
  return nextKey !== String(previousKey || '')
}

export function mergeTaskLiveStatus(task, status) {
  if (!task || !status || !status.status) return task || null
  return {
    ...task,
    live: {
      ...(task.live || {}),
      ...status,
    },
  }
}
