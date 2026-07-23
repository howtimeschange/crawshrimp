export const THEME_STORAGE_KEY = 'crawshrimp.ui.theme'
export const THEME_PREFERENCES = Object.freeze(['system', 'light', 'dark'])

export function normalizeThemePreference(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return THEME_PREFERENCES.includes(normalized) ? normalized : 'system'
}

export function readThemePreference(storage) {
  try {
    return normalizeThemePreference(storage?.getItem?.(THEME_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

export function resolveTheme(preference, systemPrefersDark = false) {
  const normalized = normalizeThemePreference(preference)
  if (normalized === 'system') return systemPrefersDark ? 'dark' : 'light'
  return normalized
}

export function applyTheme(preference, {
  documentRef = globalThis.document,
  systemPrefersDark = false,
} = {}) {
  const normalized = normalizeThemePreference(preference)
  const resolved = resolveTheme(normalized, systemPrefersDark)
  const root = documentRef?.documentElement
  if (root) {
    root.dataset.themePreference = normalized
    root.dataset.theme = resolved
    root.style.colorScheme = resolved
  }
  return resolved
}

export function writeThemePreference(storage, preference) {
  const normalized = normalizeThemePreference(preference)
  try {
    storage?.setItem?.(THEME_STORAGE_KEY, normalized)
  } catch {
    // Theme changes still apply for the current session when storage is unavailable.
  }
  return normalized
}

export function observeSystemTheme(mediaQuery, onChange) {
  if (!mediaQuery || typeof onChange !== 'function') return () => {}

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', onChange)
    return () => mediaQuery.removeEventListener?.('change', onChange)
  }

  if (typeof mediaQuery.addListener === 'function') {
    mediaQuery.addListener(onChange)
    return () => mediaQuery.removeListener?.(onChange)
  }

  return () => {}
}
