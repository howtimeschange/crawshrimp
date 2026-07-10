import { describe, expect, it } from 'vitest'
import { BUILT_IN_ROLES, hasPermission } from '../worker/security/rbac'

describe('RBAC matrix', () => {
  it('lets admins manage users and machines', () => {
    expect(hasPermission(['admin'], 'users:write')).toBe(true)
    expect(hasPermission(['admin'], 'machines:write')).toBe(true)
    expect(hasPermission(['admin'], 'audit:read')).toBe(true)
  })

  it('keeps reviewers away from submit and admin actions', () => {
    expect(hasPermission(['reviewer'], 'batches:review')).toBe(true)
    expect(hasPermission(['reviewer'], 'jobs:generate')).toBe(true)
    expect(hasPermission(['reviewer'], 'jobs:regenerate')).toBe(true)
    expect(hasPermission(['reviewer'], 'jobs:submit')).toBe(false)
    expect(hasPermission(['reviewer'], 'users:write')).toBe(false)
  })

  it('keeps machine operators scoped to machine maintenance', () => {
    expect(hasPermission(['machine_operator'], 'machines:own:write')).toBe(true)
    expect(hasPermission(['machine_operator'], 'machines:write')).toBe(false)
    expect(hasPermission(['machine_operator'], 'batches:review')).toBe(false)
  })

  it('defines every built-in role with at least one permission', () => {
    for (const role of BUILT_IN_ROLES) {
      expect(role.permissions.length, role.roleKey).toBeGreaterThan(0)
    }
  })
})
