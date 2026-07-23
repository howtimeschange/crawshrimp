import test from 'node:test'
import assert from 'node:assert/strict'

import * as theme from './theme.mjs'

const {
  THEME_STORAGE_KEY,
  applyTheme,
  normalizeThemePreference,
  readThemePreference,
  resolveTheme,
  writeThemePreference,
} = theme

test('theme preference accepts system, light and dark only', () => {
  assert.equal(normalizeThemePreference('LIGHT'), 'light')
  assert.equal(normalizeThemePreference('dark'), 'dark')
  assert.equal(normalizeThemePreference('unknown'), 'system')
  assert.equal(normalizeThemePreference(''), 'system')
})

test('system theme follows the operating system while explicit themes do not', () => {
  assert.equal(resolveTheme('system', false), 'light')
  assert.equal(resolveTheme('system', true), 'dark')
  assert.equal(resolveTheme('light', true), 'light')
  assert.equal(resolveTheme('dark', false), 'dark')
})

test('theme preference persists with a safe system fallback', () => {
  const values = new Map()
  const storage = {
    getItem: key => values.get(key),
    setItem: (key, value) => values.set(key, value),
  }

  assert.equal(readThemePreference(storage), 'system')
  assert.equal(writeThemePreference(storage, 'light'), 'light')
  assert.equal(values.get(THEME_STORAGE_KEY), 'light')
  assert.equal(readThemePreference(storage), 'light')

  values.set(THEME_STORAGE_KEY, 'sepia')
  assert.equal(readThemePreference(storage), 'system')
})

test('applyTheme updates the root dataset and native color scheme', () => {
  const documentRef = {
    documentElement: {
      dataset: {},
      style: {},
    },
  }

  assert.equal(applyTheme('system', { documentRef, systemPrefersDark: true }), 'dark')
  assert.deepEqual(documentRef.documentElement.dataset, {
    themePreference: 'system',
    theme: 'dark',
  })
  assert.equal(documentRef.documentElement.style.colorScheme, 'dark')
})

test('system theme observation supports modern Chromium media query events', () => {
  let registeredHandler = null
  let removedHandler = null
  const mediaQuery = {
    addEventListener(type, handler) {
      assert.equal(type, 'change')
      registeredHandler = handler
    },
    removeEventListener(type, handler) {
      assert.equal(type, 'change')
      removedHandler = handler
    },
  }
  const onChange = () => {}

  const cleanup = theme.observeSystemTheme(mediaQuery, onChange)

  assert.equal(registeredHandler, onChange)
  cleanup()
  assert.equal(removedHandler, onChange)
})

test('system theme observation falls back to legacy media query events', () => {
  let registeredHandler = null
  let removedHandler = null
  const mediaQuery = {
    addListener(handler) {
      registeredHandler = handler
    },
    removeListener(handler) {
      removedHandler = handler
    },
  }
  const onChange = () => {}

  const cleanup = theme.observeSystemTheme(mediaQuery, onChange)

  assert.equal(registeredHandler, onChange)
  cleanup()
  assert.equal(removedHandler, onChange)
})
