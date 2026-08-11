import { formatTasksForDisplay } from './taskDisplay.js'

function compareText(left, right) {
  return String(left || '').localeCompare(String(right || ''), 'zh-Hans-CN', {
    numeric: true,
    sensitivity: 'base',
  })
}

export function buildScriptGroups(tasks = []) {
  const map = {}
  for (const task of tasks) {
    if (task?.hidden) continue
    if (!map[task.adapter_id]) {
      map[task.adapter_id] = {
        adapter_id: task.adapter_id,
        adapter_name: task.adapter_name,
        adapter_version: task.adapter_version || '',
        enabled: task.enabled,
        tasks: [],
      }
    }
    map[task.adapter_id].tasks.push(task)
  }

  return Object.values(map)
    .map(group => ({
      ...group,
      tasks: formatTasksForDisplay(group.adapter_id, group.tasks),
    }))
    .sort((left, right) => {
      const nameOrder = compareText(left.adapter_name, right.adapter_name)
      if (nameOrder !== 0) return nameOrder
      return compareText(left.adapter_id, right.adapter_id)
    })
}
