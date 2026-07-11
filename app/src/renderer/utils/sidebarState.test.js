import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  readSidebarCollapsed,
  writeSidebarCollapsed,
} from './sidebarState.js'

test('missing and malformed sidebar collapsed values read as expanded', () => {
  assert.equal(readSidebarCollapsed(new MapStorage()), false)
  assert.equal(readSidebarCollapsed(new MapStorage([['crawshrimp.sidebarCollapsed.v1', 'yes']])), false)
  assert.equal(readSidebarCollapsed(new MapStorage([['crawshrimp.sidebarCollapsed.v1', '0']])), false)
})

test('stored 1 reads as collapsed', () => {
  assert.equal(readSidebarCollapsed(new MapStorage([['crawshrimp.sidebarCollapsed.v1', '1']])), true)
})

test('writeSidebarCollapsed stores the v1 key and catches storage exceptions', () => {
  const storage = new MapStorage()
  assert.equal(writeSidebarCollapsed(storage, true), true)
  assert.equal(storage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY), '1')

  assert.equal(writeSidebarCollapsed(storage, false), true)
  assert.equal(storage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY), '0')

  assert.equal(readSidebarCollapsed({
    getItem() {
      throw new Error('blocked')
    },
  }), false)
  assert.equal(writeSidebarCollapsed({
    setItem() {
      throw new Error('blocked')
    },
  }, true), false)
})

class MapStorage {
  constructor(entries = []) {
    this.values = new Map(entries)
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null
  }

  setItem(key, value) {
    this.values.set(key, value)
  }
}
