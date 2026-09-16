import { reactive } from 'vue'
export const interactionToasts = reactive([])
const timers = new Map()
let sequence = 0
export function dismissToast(id) {
  clearTimeout(timers.get(id)); timers.delete(id)
  const index = interactionToasts.findIndex(item => item.id === id)
  if (index >= 0) interactionToasts.splice(index, 1)
}
export function notifyOperation({ id = `operation-${++sequence}`, state = 'success', title, detail = '', action, actionLabel = '' }) {
  clearTimeout(timers.get(id)); timers.delete(id)
  const value = { id, state, title, detail, action, actionLabel }
  const existing = interactionToasts.find(item => item.id === id)
  if (existing) Object.assign(existing, value)
  else interactionToasts.push(value)
  // Do not discard pending work or failures to make room for cosmetic notifications.
  if (state === 'success') timers.set(id, setTimeout(() => dismissToast(id), action ? 12000 : 5000))
  return id
}
export async function runNotifiedOperation({ title, success, action, actionLabel, run }) {
  const id = notifyOperation({ state: 'pending', title })
  try {
    const result = await run()
    if (result?.error || result?.detail || result?.ok === false) throw new Error(result.error || result.detail || '操作失败')
    notifyOperation({ id, state: 'success', title: success, action, actionLabel })
    return result
  } catch (error) {
    notifyOperation({ id, state: 'error', title: '操作未完成', detail: error?.message || String(error) })
    throw error
  }
}
