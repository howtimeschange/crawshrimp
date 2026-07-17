import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { partitionScriptGroups } from './scriptFavorites.js'

test('partitions favorites newest-first and retains normal source order', () => {
  const groups = [
    { adapter_id: 'first' },
    { adapter_id: 'old' },
    { adapter_id: 'middle' },
    { adapter_id: 'new' },
  ]

  const result = partitionScriptGroups(groups, {
    old: '2026-07-17T09:00:00+00:00',
    new: '2026-07-17T10:00:00+00:00',
  })

  assert.deepEqual(result.favorites.map(({ adapter_id }) => adapter_id), ['new', 'old'])
  assert.deepEqual(result.scripts.map(({ adapter_id }) => adapter_id), ['first', 'middle'])
})

test('uses stable original order for invalid favorite time', () => {
  const result = partitionScriptGroups(
    [{ adapter_id: 'first' }, { adapter_id: 'second' }],
    { first: 'invalid', second: 'invalid' },
  )

  assert.deepEqual(result.favorites.map(({ adapter_id }) => adapter_id), ['first', 'second'])
})

test('script list is a single-page favorite-first layout with an isolated star action', () => {
  const source = readFileSync(new URL('../views/ScriptList.vue', import.meta.url), 'utf8')

  assert.match(source, /我的收藏/)
  assert.match(source, /全部脚本/)
  assert.match(source, /@click\.stop="toggleFavorite\(entry\.group\.adapter_id\)"/)
  assert.match(source, /:aria-pressed="isFavorite\(entry\.group\.adapter_id\)"/)
  assert.match(source, /window\.cs\.getScriptFavorites\(\)/)
  assert.match(source, /window\.cs\.favoriteScript\(adapterId\)/)
  assert.match(source, /window\.cs\.unfavoriteScript\(adapterId\)/)
  assert.match(source, /class="favorite-icon" viewBox="0 0 24 24"/)
  assert.match(source, /<path d="M12 21\.35l-1\.45-1\.32C5\.4 15\.36 2 12\.28 2 8\.5/)
  assert.match(source, /:class="\{ active: isFavorite\(entry\.group\.adapter_id\) \}"/)
  assert.match(source, /<strong>\{\{ entry\.group\.adapter_name \}\}<\/strong>\s*<span v-if="entry\.group\.adapter_version" class="adapter-version">/)
})
