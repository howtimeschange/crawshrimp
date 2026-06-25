import test from 'node:test'
import assert from 'node:assert/strict'

import {
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
