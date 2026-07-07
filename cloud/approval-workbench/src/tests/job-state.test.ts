import { describe, expect, it } from 'vitest'
import { canClaimJob, nextJobStatusAfterLeaseExpiry, validateLease } from '../worker/job-state'

describe('dispatch job state machine', () => {
  it('allows active healthy capable machines to claim queued jobs', () => {
    expect(canClaimJob({
      jobStatus: 'queued',
      assignedMachineId: 'machine-1',
      requiredCapabilities: ['regenerate_ai_image'],
      machineId: 'machine-1',
      machineAuthStatus: 'active',
      machineHealth: 'online_idle',
      machineCapabilities: ['regenerate_ai_image', 'submit_tmall_material_test'],
    })).toBe(true)
  })

  it('blocks disabled machines and capability mismatches', () => {
    expect(canClaimJob({
      jobStatus: 'queued',
      assignedMachineId: '',
      requiredCapabilities: ['submit_tmall_material_test'],
      machineId: 'machine-1',
      machineAuthStatus: 'disabled',
      machineHealth: 'online_idle',
      machineCapabilities: ['regenerate_ai_image'],
    })).toBe(false)
  })

  it('requeues leased jobs after lease expiry', () => {
    expect(nextJobStatusAfterLeaseExpiry('leased')).toBe('queued')
    expect(nextJobStatusAfterLeaseExpiry('running')).toBe('retryable_failed')
    expect(nextJobStatusAfterLeaseExpiry('uploading_results')).toBe('retryable_failed')
    expect(nextJobStatusAfterLeaseExpiry('terminal_failed')).toBe('terminal_failed')
  })

  it('rejects stale lease writes', () => {
    expect(validateLease('lease-current', 'lease-current')).toBe(true)
    expect(validateLease('lease-current', 'lease-old')).toBe(false)
  })
})
