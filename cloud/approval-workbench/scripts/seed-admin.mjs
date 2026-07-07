#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'

export const SEED_BUILT_IN_ROLES = [
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

export async function hashPasswordForSeed(password, salt = randomUUID()) {
  const hash = createHash('sha256').update(`${salt}:${password}`).digest('hex')
  return `sha256:${salt}:${hash}`
}

export function readPasswordFromEnv(env = process.env, envName = 'CLOUD_APPROVAL_ADMIN_PASSWORD') {
  const password = String(env[envName] || '')
  if (!password) throw new Error(`${envName} is required`)
  if (password.length < 8) throw new Error(`${envName} must be at least 8 characters`)
  return password
}

export async function buildSeedSql({ email, name, password, salt, now = new Date().toISOString() }) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const displayName = String(name || '').trim()
  if (!normalizedEmail || !normalizedEmail.includes('@')) throw new Error('valid email is required')
  if (!displayName) throw new Error('name is required')
  if (String(password || '').length < 8) throw new Error('password must be at least 8 characters')

  const passwordHash = await hashPasswordForSeed(password, salt)
  const statements = []

  for (const role of SEED_BUILT_IN_ROLES) {
    statements.push(
      `INSERT OR IGNORE INTO roles (role_key, name, description, built_in, created_at, updated_at) VALUES (${q(role.roleKey)}, ${q(role.name)}, '', 1, ${q(now)}, ${q(now)});`,
    )
    for (const permission of role.permissions) {
      statements.push(
        `INSERT OR IGNORE INTO role_permissions (role_id, permission_key, created_at) SELECT id, ${q(permission)}, ${q(now)} FROM roles WHERE role_key = ${q(role.roleKey)};`,
      )
    }
  }

  statements.push(
    `INSERT INTO users (email, name, status, password_hash, created_by, created_at, updated_at) VALUES (${q(normalizedEmail)}, ${q(displayName)}, 'active', ${q(passwordHash)}, NULL, ${q(now)}, ${q(now)}) ON CONFLICT(email) DO UPDATE SET name = excluded.name, status = 'active', password_hash = excluded.password_hash, updated_at = excluded.updated_at;`,
  )
  statements.push(
    `INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_by, assigned_at) SELECT u.id, r.id, u.id, ${q(now)} FROM users u JOIN roles r ON r.role_key = 'super_admin' WHERE lower(u.email) = lower(${q(normalizedEmail)});`,
  )
  statements.push(
    `INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, payload_json, created_at) SELECT u.id, 'seed.first_admin', 'user', CAST(u.id AS TEXT), json_object('email', u.email), ${q(now)} FROM users u WHERE lower(u.email) = lower(${q(normalizedEmail)});`,
  )

  return `${statements.join('\n')}\n`
}

function q(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`
}

function parseArgs(argv) {
  const args = { email: '', name: 'Cloud Approval Admin', passwordEnv: 'CLOUD_APPROVAL_ADMIN_PASSWORD' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--email') args.email = argv[++index] || ''
    else if (arg === '--name') args.name = argv[++index] || ''
    else if (arg === '--password-env') args.passwordEnv = argv[++index] || ''
    else if (arg === '-h' || arg === '--help') args.help = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  return args
}

function usage() {
  return [
    'Usage:',
    '  CLOUD_APPROVAL_ADMIN_PASSWORD=... node scripts/seed-admin.mjs --email admin@example.com --name "Admin" > /tmp/cloud-approval-seed.sql',
    '  npx wrangler d1 execute crawshrimp_cloud_approval --remote --file /tmp/cloud-approval-seed.sql',
  ].join('\n')
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.help) {
    console.log(usage())
    return 0
  }
  const password = readPasswordFromEnv(process.env, args.passwordEnv)
  const sql = await buildSeedSql({ email: args.email, name: args.name, password })
  process.stdout.write(sql)
  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message || String(error))
    process.exit(1)
  })
}
