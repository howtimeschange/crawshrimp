export type MachineAuthStatus = 'pending_approval' | 'active' | 'disabled' | 'revoked' | 'rejected'
export type MachineHealth = 'offline' | 'online_idle' | 'online_busy' | 'needs_login' | 'config_missing' | 'version_blocked'
export type DispatchStatus = 'created' | 'queued' | 'leased' | 'running' | 'uploading_results' | 'succeeded' | 'cancelled' | 'lease_expired' | 'retryable_failed' | 'terminal_failed' | 'blocked_needs_login' | 'blocked_config_missing' | 'cancel_requested'

export interface ClaimInput {
  jobStatus: DispatchStatus
  assignedMachineId: string
  requiredCapabilities: string[]
  machineId: string
  machineAuthStatus: MachineAuthStatus
  machineHealth: MachineHealth
  machineCapabilities: string[]
}

export function canClaimJob(input: ClaimInput): boolean {
  if (input.jobStatus !== 'queued') return false
  if (input.machineAuthStatus !== 'active') return false
  if (!['online_idle', 'online_busy'].includes(input.machineHealth)) return false
  if (input.assignedMachineId && input.assignedMachineId !== input.machineId) return false
  const machineCaps = new Set(input.machineCapabilities)
  return input.requiredCapabilities.every((capability) => machineCaps.has(capability))
}

export function nextJobStatusAfterLeaseExpiry(status: DispatchStatus): DispatchStatus {
  if (status === 'leased') return 'queued'
  if (status === 'running' || status === 'uploading_results') return 'retryable_failed'
  return status
}

export function validateLease(currentLeaseId: string | null | undefined, suppliedLeaseId: string | null | undefined): boolean {
  return Boolean(currentLeaseId && suppliedLeaseId && currentLeaseId === suppliedLeaseId)
}
