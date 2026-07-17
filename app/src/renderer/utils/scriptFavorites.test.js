import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import * as scriptFavoriteUtils from './scriptFavorites.js'
import { partitionScriptGroups } from './scriptFavorites.js'

test('partitions favorites oldest-first and retains normal source order', () => {
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

  assert.deepEqual(result.favorites.map(({ adapter_id }) => adapter_id), ['old', 'new'])
  assert.deepEqual(result.scripts.map(({ adapter_id }) => adapter_id), ['first', 'middle'])
})

test('uses stable original order for invalid favorite time', () => {
  const result = partitionScriptGroups(
    [{ adapter_id: 'first' }, { adapter_id: 'second' }],
    { first: 'invalid', second: 'invalid' },
  )

  assert.deepEqual(result.favorites.map(({ adapter_id }) => adapter_id), ['first', 'second'])
})

test('drops a favorite snapshot captured before a newer mutation', () => {
  assert.equal(scriptFavoriteUtils.shouldApplyScriptFavoritesSnapshot(4, 4), true)
  assert.equal(scriptFavoriteUtils.shouldApplyScriptFavoritesSnapshot(4, 5), false)
})

test('script list is a single-page favorite-first layout with an isolated bookmark action', () => {
  const source = readFileSync(new URL('../views/ScriptList.vue', import.meta.url), 'utf8')

  assert.match(source, /我的收藏/)
  assert.match(source, /全部脚本/)
  assert.match(source, /@click\.stop="toggleFavorite\(entry\.group\.adapter_id\)"/)
  assert.match(source, /:aria-pressed="isFavorite\(entry\.group\.adapter_id\)"/)
  assert.match(source, /window\.cs\.getScriptFavorites\(\)/)
  assert.match(source, /window\.cs\.favoriteScript\(adapterId\)/)
  assert.match(source, /window\.cs\.unfavoriteScript\(adapterId\)/)
  assert.match(source, /<IconBookmark class="favorite-icon"/)
  assert.match(source, /:class="\{ active: isFavorite\(entry\.group\.adapter_id\) \}"/)
  assert.match(source, /<strong>\{\{ entry\.group\.adapter_name \}\}<\/strong>\s*<span v-if="entry\.group\.adapter_version" class="adapter-version">/)
})

test('script favorites use a tactile bookmark control rather than a decorative heart', () => {
  const source = readFileSync(new URL('../views/ScriptList.vue', import.meta.url), 'utf8')

  assert.match(source, /import \{ IconBookmark \} from '@tabler\/icons-vue'/)
  assert.match(source, /<IconBookmark class="favorite-icon"/)
  assert.match(source, /\.favorite-btn\s*\{[\s\S]*?border:\s*1px solid rgba\(255, 255, 255, .12\);/)
  assert.match(source, /\.favorite-btn\.active\s*\{[\s\S]*?background:\s*rgba\(255, 107, 43, .16\);/)
  assert.match(source, /\.favorite-btn\.active \.favorite-icon\s*\{[\s\S]*?fill:\s*currentColor;/)
})

test('script favorites skip polling during mutations and discard stale responses', () => {
  const source = readFileSync(new URL('../views/ScriptList.vue', import.meta.url), 'utf8')

  assert.match(source, /let favoriteMutationVersion = 0/)
  assert.match(source, /if \(quiet && !force && favoritePendingIds\.value\.size\) return/)
  assert.match(source, /const favoriteReadVersion = favoriteMutationVersion/)
  assert.match(source, /if \(!shouldApplyScriptFavoritesSnapshot\(favoriteReadVersion, favoriteMutationVersion\)\) return/)
  assert.match(source, /favoriteMutationVersion \+= 1/)
  assert.match(source, /await loadFavorites\(\{ quiet: true, force: true \}\)/)
})
