import test from 'node:test'
import assert from 'node:assert/strict'

import { createPromptLibraryRequestGuard } from './promptLibraryRequestGuard.js'

test('only the latest prompt library request remains current', () => {
  const guard = createPromptLibraryRequestGuard()
  const first = guard.begin('cloud:1')
  const second = guard.begin('cloud:2')

  assert.equal(guard.isCurrent(first, 'cloud:1'), false)
  assert.equal(guard.isCurrent(second, 'cloud:2'), true)
  assert.equal(guard.isCurrent(second, 'cloud:1'), false)
  guard.invalidate()
  assert.equal(guard.isCurrent(second, 'cloud:2'), false)
})
