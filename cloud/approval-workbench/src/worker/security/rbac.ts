export type Permission =
  | 'users:write'
  | 'roles:read'
  | 'audit:read'
  | 'prompts:read'
  | 'prompts:write'
  | 'batches:read'
  | 'batches:review'
  | 'jobs:regenerate'
  | 'jobs:submit'
  | 'machines:read'
  | 'machines:write'
  | 'machines:own:write'
  | 'dashboard:read'

export interface BuiltInRole {
  roleKey: string
  name: string
  permissions: Permission[]
}

export const BUILT_IN_ROLES: BuiltInRole[] = [
  {
    roleKey: 'super_admin',
    name: '超级管理员',
    permissions: [
      'users:write',
      'roles:read',
      'audit:read',
      'prompts:read',
      'prompts:write',
      'batches:read',
      'batches:review',
      'jobs:regenerate',
      'jobs:submit',
      'machines:read',
      'machines:write',
      'machines:own:write',
      'dashboard:read',
    ],
  },
  {
    roleKey: 'admin',
    name: '管理员',
    permissions: ['users:write', 'roles:read', 'audit:read', 'prompts:read', 'prompts:write', 'batches:read', 'batches:review', 'jobs:regenerate', 'jobs:submit', 'machines:read', 'machines:write', 'dashboard:read'],
  },
  {
    roleKey: 'prompt_manager',
    name: 'Prompt 管理',
    permissions: ['prompts:read', 'prompts:write', 'batches:read', 'dashboard:read'],
  },
  {
    roleKey: 'reviewer',
    name: '审图人员',
    permissions: ['prompts:read', 'batches:read', 'batches:review', 'jobs:regenerate', 'dashboard:read'],
  },
  {
    roleKey: 'operator',
    name: '提交操作员',
    permissions: ['batches:read', 'jobs:regenerate', 'jobs:submit', 'machines:read', 'dashboard:read'],
  },
  {
    roleKey: 'machine_operator',
    name: '任务机维护',
    permissions: ['machines:read', 'machines:own:write', 'batches:read', 'dashboard:read'],
  },
  {
    roleKey: 'viewer',
    name: '只读查看',
    permissions: ['prompts:read', 'batches:read', 'machines:read', 'dashboard:read'],
  },
]

export function permissionsForRoles(roleKeys: string[]): Set<Permission> {
  const keys = new Set(roleKeys)
  const permissions = new Set<Permission>()
  for (const role of BUILT_IN_ROLES) {
    if (!keys.has(role.roleKey)) continue
    for (const permission of role.permissions) permissions.add(permission)
  }
  return permissions
}

export function hasPermission(roleKeys: string[], permission: Permission): boolean {
  return permissionsForRoles(roleKeys).has(permission)
}
