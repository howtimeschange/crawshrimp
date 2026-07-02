import test from 'node:test'
import assert from 'node:assert/strict'

import {
  mergeTaskLiveStatus,
  shouldResetTaskValues,
  taskIdentityKey,
} from './taskRunnerState.js'

test('taskIdentityKey is stable across refreshed copies of the same task', () => {
  const first = {
    adapter_id: 'semir-cloud-drive',
    task_id: 'tmall_material_new_624',
    task_name: '森马-天猫AI生图参考素材准备',
    live: null,
  }
  const refreshed = {
    adapter_id: 'semir-cloud-drive',
    task_id: 'tmall_material_new_624',
    task_name: '森马-天猫AI生图参考素材准备',
    live: { status: 'running' },
  }

  assert.equal(taskIdentityKey(first.adapter_id, first), taskIdentityKey(refreshed.adapter_id, refreshed))
})

test('shouldResetTaskValues only resets when the selected task identity changes', () => {
  const currentTask = {
    adapter_id: 'semir-cloud-drive',
    task_id: 'tmall_material_new_624',
  }
  const refreshedTask = {
    adapter_id: 'semir-cloud-drive',
    task_id: 'tmall_material_new_624',
    live: { status: 'done' },
  }
  const otherTask = {
    adapter_id: 'semir-cloud-drive',
    task_id: 'tmall_material_match_buy',
  }

  assert.equal(shouldResetTaskValues('', currentTask), true)
  assert.equal(shouldResetTaskValues(taskIdentityKey('semir-cloud-drive', currentTask), refreshedTask, 'semir-cloud-drive'), false)
  assert.equal(shouldResetTaskValues(taskIdentityKey('semir-cloud-drive', currentTask), otherTask, 'semir-cloud-drive'), true)
})

test('mergeTaskLiveStatus preserves progress fields when status-only events arrive', () => {
  const task = {
    adapter_id: 'tmall-ops-assistant',
    task_id: 'tmall_ai_image_test_chain',
    live: {
      status: 'running',
      search_total_codes: 6,
      search_completed_codes: 6,
      generation_total_jobs: 20,
      generation_completed_jobs: 8,
    },
  }

  const merged = mergeTaskLiveStatus(task, { status: 'pausing' })

  assert.equal(merged.live.status, 'pausing')
  assert.equal(merged.live.search_completed_codes, 6)
  assert.equal(merged.live.generation_total_jobs, 20)
  assert.equal(merged.live.generation_completed_jobs, 8)
})

test('mergeTaskLiveStatus applies full live progress snapshots for instance runners', () => {
  const task = {
    adapter_id: 'tmall-ops-assistant',
    task_id: 'tmall_ai_image_test_chain',
    live: { status: 'running' },
  }

  const merged = mergeTaskLiveStatus(task, {
    status: 'running',
    phase: 'tmall_ai_chain_generate',
    buyer_id: '208326100202',
    search_total_codes: 6,
    search_completed_codes: 6,
    generation_total_jobs: 20,
    generation_completed_jobs: 12,
  })

  assert.equal(merged.live.phase, 'tmall_ai_chain_generate')
  assert.equal(merged.live.buyer_id, '208326100202')
  assert.equal(merged.live.search_completed_codes, 6)
  assert.equal(merged.live.generation_completed_jobs, 12)
})
