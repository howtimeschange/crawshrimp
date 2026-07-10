export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'crawshrimp.sidebarCollapsed.v1'

export function readSidebarCollapsed(storage) {
  try {
    return storage?.getItem?.(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function writeSidebarCollapsed(storage, collapsed) {
  try {
    storage?.setItem?.(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0')
    return true
  } catch {
    return false
  }
}
