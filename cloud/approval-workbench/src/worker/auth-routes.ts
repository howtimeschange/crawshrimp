import { recordAudit } from './audit'
import { nowIso } from './db'
import type { Env } from './env'
import { sessionTtlSeconds } from './env'
import { badRequest, forbidden, json, readJsonObject, unauthorized } from './http'
import { hashPassword, verifyPassword } from './security/password'
import { type Permission, permissionsForRoles } from './security/rbac'
import { randomToken, sha256Hex } from './security/tokens'

const SESSION_COOKIE = 'cs_session'

interface UserRow {
  id: number
  email: string
  name: string
  status: string
  password_hash?: string
  created_at?: string
  updated_at?: string
}

interface RoleRow {
  id?: number
  role_key: string
  name: string
}

interface CurrentUser {
  user: UserRow
  roles: RoleRow[]
  permissions: Permission[]
  token: string
  sessionHash: string
}

function publicUser(user: UserRow): Omit<UserRow, 'password_hash'> {
  const { password_hash: _passwordHash, ...safeUser } = user
  return safeUser
}

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get('cookie') || ''
  for (const part of cookie.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=')
    if (rawKey === name) return rawValue.join('=')
  }
  return null
}

function sessionCookie(token: string, ttlSeconds: number): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ttlSeconds}`
}

function expiredSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

function responseFor(user: UserRow, roles: RoleRow[]): Record<string, unknown> {
  const roleKeys = roles.map((role) => role.role_key)
  return {
    user: publicUser(user),
    roles,
    permissions: Array.from(permissionsForRoles(roleKeys)),
  }
}

async function rolesForUser(env: Env, userId: number): Promise<RoleRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.role_key, r.name
     FROM roles r
     JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = ?
     ORDER BY r.role_key`,
  )
    .bind(userId)
    .all<RoleRow>()
  return results
}

async function currentUser(request: Request, env: Env): Promise<CurrentUser | null> {
  const token = cookieValue(request, SESSION_COOKIE)
  if (!token) return null
  const sessionHash = await sha256Hex(token)
  const user = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.status, u.created_at, u.updated_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.session_hash = ?
       AND s.revoked_at IS NULL
       AND s.expires_at > ?
       AND u.status = 'active'
     LIMIT 1`,
  )
    .bind(sessionHash, nowIso())
    .first<UserRow>()
  if (!user) return null
  const roles = await rolesForUser(env, user.id)
  const permissions = Array.from(permissionsForRoles(roles.map((role) => role.role_key)))
  return { user, roles, permissions, token, sessionHash }
}

async function requirePermission(request: Request, env: Env, permission: Permission): Promise<CurrentUser | Response> {
  const actor = await currentUser(request, env)
  if (!actor) return unauthorized()
  if (!actor.permissions.includes(permission)) return forbidden()
  return actor
}

export async function login(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !password) return badRequest('email and password are required')

  const user = await env.DB.prepare(
    `SELECT id, email, name, status, password_hash, created_at, updated_at
     FROM users
     WHERE lower(email) = lower(?)
     LIMIT 1`,
  )
    .bind(email)
    .first<UserRow>()

  if (!user || user.status !== 'active' || !user.password_hash || !(await verifyPassword(password, user.password_hash))) {
    return unauthorized('Invalid email or password')
  }

  const token = randomToken('sess')
  const sessionHash = await sha256Hex(token)
  const ttlSeconds = sessionTtlSeconds(env)
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()
  await env.DB.prepare('INSERT INTO sessions (user_id, session_hash, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(user.id, sessionHash, expiresAt, nowIso())
    .run()
  await env.DB.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').bind(nowIso(), nowIso(), user.id).run()
  const roles = await rolesForUser(env, user.id)
  await recordAudit(env, { userId: user.id }, 'auth.login', 'user', String(user.id), { email: user.email }, request)

  return json(responseFor(user, roles), {
    headers: { 'set-cookie': sessionCookie(token, ttlSeconds) },
  })
}

export async function logout(request: Request, env: Env): Promise<Response> {
  const actor = await currentUser(request, env)
  if (actor) {
    await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE session_hash = ?').bind(nowIso(), actor.sessionHash).run()
    await recordAudit(env, { userId: actor.user.id }, 'auth.logout', 'user', String(actor.user.id), {}, request)
  }
  return json({ ok: true }, { headers: { 'set-cookie': expiredSessionCookie() } })
}

export async function me(request: Request, env: Env): Promise<Response> {
  const actor = await currentUser(request, env)
  if (!actor) return unauthorized()
  return json(responseFor(actor.user, actor.roles))
}

export async function listUsers(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'users:write')
  if (actor instanceof Response) return actor
  const { results } = await env.DB.prepare('SELECT id, email, name, status, created_at, updated_at FROM users ORDER BY id DESC').all()
  return json({ users: results })
}

export async function createUser(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'users:write')
  if (actor instanceof Response) return actor
  const body = await readJsonObject(request)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const status = typeof body.status === 'string' ? body.status : 'active'
  const roleKeys = Array.isArray(body.roleKeys) ? body.roleKeys.filter((roleKey): roleKey is string => typeof roleKey === 'string') : []
  if (!email || !name || password.length < 8) return badRequest('email, name, and password of at least 8 characters are required')

  const now = nowIso()
  const passwordHash = await hashPassword(password)
  const result = await env.DB.prepare(
    'INSERT INTO users (email, name, status, password_hash, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(email, name, status, passwordHash, actor.user.id, now, now)
    .run()
  const userId = Number(result.meta.last_row_id)
  if (roleKeys.length > 0) {
    await assignUserRoles(env, userId, roleKeys, actor.user.id)
  }
  await recordAudit(env, { userId: actor.user.id }, 'users.create', 'user', String(userId), { email, roleKeys }, request)
  return json({ user: { id: userId, email, name, status } }, { status: 201 })
}

export async function updateUser(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'users:write')
  if (actor instanceof Response) return actor
  const userId = Number(new URL(request.url).pathname.split('/').at(-1))
  if (!Number.isInteger(userId) || userId <= 0) return badRequest('valid user id is required')
  const body = await readJsonObject(request)
  const name = typeof body.name === 'string' ? body.name.trim() : null
  const status = typeof body.status === 'string' ? body.status : null
  if (!name && !status) return badRequest('name or status is required')
  await env.DB.prepare(
    `UPDATE users
     SET name = COALESCE(?, name),
         status = COALESCE(?, status),
         updated_at = ?
     WHERE id = ?`,
  )
    .bind(name, status, nowIso(), userId)
    .run()
  await recordAudit(env, { userId: actor.user.id }, 'users.update', 'user', String(userId), { name, status }, request)
  return json({ ok: true })
}

export async function listRoles(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'roles:read')
  if (actor instanceof Response) return actor
  const { results } = await env.DB.prepare('SELECT id, role_key, name FROM roles ORDER BY role_key').all()
  return json({ roles: results })
}

export async function updateUserRoles(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'users:write')
  if (actor instanceof Response) return actor
  const userId = Number(new URL(request.url).pathname.match(/^\/api\/admin\/users\/(\d+)\/roles$/)?.[1])
  if (!Number.isInteger(userId) || userId <= 0) return badRequest('valid user id is required')
  const body = await readJsonObject(request)
  const roleKeys = Array.isArray(body.roleKeys) ? body.roleKeys.filter((roleKey): roleKey is string => typeof roleKey === 'string') : []
  await env.DB.prepare('DELETE FROM user_roles WHERE user_id = ?').bind(userId).run()
  await assignUserRoles(env, userId, roleKeys, actor.user.id)
  await recordAudit(env, { userId: actor.user.id }, 'users.roles.update', 'user', String(userId), { roleKeys }, request)
  return json({ ok: true })
}

export async function listAuditLogs(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'audit:read')
  if (actor instanceof Response) return actor
  const { results } = await env.DB.prepare(
    `SELECT id, actor_user_id, actor_machine_id, action, resource_type, resource_id, payload_json, ip_address, user_agent, created_at
     FROM audit_logs
     ORDER BY id DESC
     LIMIT 100`,
  ).all()
  return json({ auditLogs: results })
}

async function assignUserRoles(env: Env, userId: number, roleKeys: string[], assignedBy: number): Promise<void> {
  if (roleKeys.length === 0) return
  const { results } = await env.DB.prepare('SELECT id, role_key, name FROM roles ORDER BY role_key').all<RoleRow>()
  const rolesByKey = new Map(results.map((role) => [role.role_key, role.id]))
  for (const roleKey of roleKeys) {
    const roleId = rolesByKey.get(roleKey)
    if (!roleId) continue
    await env.DB.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?)')
      .bind(userId, roleId, assignedBy, nowIso())
      .run()
  }
}
