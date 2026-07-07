import { describe, expect, it } from 'vitest'
import { BUILT_IN_ROLES } from '../worker/security/rbac'
// @ts-ignore The operator script is plain ESM so it can run directly with Node.
import { buildSeedSql, hashPasswordForSeed, readPasswordFromEnv, SEED_BUILT_IN_ROLES } from '../../scripts/seed-admin.mjs'

describe('seed-admin operator SQL', () => {
  it('stays aligned with built-in RBAC roles', () => {
    expect(SEED_BUILT_IN_ROLES.map((role: { roleKey: string }) => role.roleKey)).toEqual(BUILT_IN_ROLES.map((role) => role.roleKey))
    for (const role of BUILT_IN_ROLES) {
      expect(SEED_BUILT_IN_ROLES.find((candidate: { roleKey: string }) => candidate.roleKey === role.roleKey)?.permissions).toEqual(role.permissions)
    }
  })

  it('builds first-admin SQL without leaking the plaintext password', async () => {
    const sql = await buildSeedSql({
      email: 'Admin@Example.COM',
      name: '首个管理员',
      password: 'Do-Not-Print-This-Password',
      salt: 'Zml4ZWQtc2FsdA==',
      now: '2026-07-07T17:20:00.000Z',
    })

    expect(sql).toContain("INSERT OR IGNORE INTO roles")
    expect(sql).toContain("'super_admin'")
    expect(sql).toContain("'users:write'")
    expect(sql).toContain("INSERT INTO users")
    expect(sql).toContain("admin@example.com")
    expect(sql).toContain("首个管理员")
    expect(sql).toContain("pbkdf2-sha256:210000:")
    expect(sql).toContain("INSERT OR IGNORE INTO user_roles")
    expect(sql).not.toContain("Do-Not-Print-This-Password")
  })

  it('hashes passwords in the same format as the worker auth module', async () => {
    const hash = await hashPasswordForSeed('password-123', 'Zml4ZWQtc2FsdA==')

    expect(hash).toMatch(/^pbkdf2-sha256:210000:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/)
    expect(hash).toBe('pbkdf2-sha256:210000:Zml4ZWQtc2FsdA==:53PQ6H7+AKTD2TO5NOi0Zj0e6j5TWOtqlAWpn/y6QnM=')
    expect(hash).not.toContain('password-123')
  })

  it('reads the admin password from an explicit environment variable', () => {
    expect(readPasswordFromEnv({ CLOUD_APPROVAL_ADMIN_PASSWORD: 'secret-pass' }, 'CLOUD_APPROVAL_ADMIN_PASSWORD')).toBe('secret-pass')
    expect(() => readPasswordFromEnv({}, 'CLOUD_APPROVAL_ADMIN_PASSWORD')).toThrow(/CLOUD_APPROVAL_ADMIN_PASSWORD/)
  })
})
