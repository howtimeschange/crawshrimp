function normalizeSearchText(value) {
  return String(value || '').trim().toLocaleLowerCase('zh-Hans-CN')
}

export function matchesScriptGroupSearch(group, query) {
  const keyword = normalizeSearchText(query)
  if (!keyword) return true

  const adapterName = normalizeSearchText(group?.adapter_name)
  if (adapterName.includes(keyword)) return true

  return Array.isArray(group?.tasks)
    ? group.tasks.some(task => normalizeSearchText(task?.task_name).includes(keyword))
    : false
}
