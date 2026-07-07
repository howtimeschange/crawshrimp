import { describe, expect, it } from 'vitest'
import worker from '../worker/index'

interface UserRow {
  id: number
  email: string
  name: string
  status: string
  password_hash: string
}

interface RoleRow {
  id: number
  role_key: string
  name: string
}

interface UserRoleRow {
  user_id: number
  role_id: number
}

interface SessionRow {
  user_id: number
  session_hash: string
  expires_at: string
  revoked_at: string | null
}

interface AuditRow {
  actor_user_id: number | null
  action: string
  resource_type: string
  resource_id: string
  payload_json: string
}

interface FakeState {
  users: UserRow[]
  roles: RoleRow[]
  userRoles: UserRoleRow[]
  sessions: SessionRow[]
  audits: AuditRow[]
}

class FakeD1Statement {
  private params: unknown[] = []

  constructor(
    private readonly state: FakeState,
    private readonly sql: string,
  ) {}

  bind(...params: unknown[]): FakeD1Statement {
    this.params = params
    return this
  }

  async first<T>(): Promise<T | null> {
    const normalized = this.sql.replace(/\s+/g, ' ').trim().toLowerCase()
    if (normalized.includes('from users') && normalized.includes('lower(email)')) {
      const email = String(this.params[0]).toLowerCase()
      return (this.state.users.find((user) => user.email.toLowerCase() === email) ?? null) as T | null
    }
    if (normalized.includes('from sessions') && normalized.includes('session_hash')) {
      const sessionHash = String(this.params[0])
      const session = this.state.sessions.find(
        (row) => row.session_hash === sessionHash && !row.revoked_at && row.expires_at > new Date().toISOString(),
      )
      if (!session) return null
      const user = this.state.users.find((row) => row.id === session.user_id && row.status === 'active')
      return (user ?? null) as T | null
    }
    return null
  }

  async all<T>(): Promise<{ results: T[] }> {
    const normalized = this.sql.replace(/\s+/g, ' ').trim().toLowerCase()
    if (normalized.includes('from roles') && normalized.includes('user_roles')) {
      const userId = Number(this.params[0])
      const results = this.state.userRoles
        .filter((userRole) => userRole.user_id === userId)
        .map((userRole) => this.state.roles.find((role) => role.id === userRole.role_id))
        .filter((role): role is RoleRow => Boolean(role))
      return { results: results as T[] }
    }
    if (normalized.includes('from users')) {
      return { results: this.state.users.map(({ password_hash: _passwordHash, ...user }) => user) as T[] }
    }
    if (normalized.includes('from audit_logs')) {
      return { results: this.state.audits as T[] }
    }
    if (normalized.includes('from roles')) {
      return { results: this.state.roles as T[] }
    }
    return { results: [] }
  }

  async run(): Promise<D1Result> {
    const normalized = this.sql.replace(/\s+/g, ' ').trim().toLowerCase()
    if (normalized.startsWith('insert into users')) {
      const id = this.state.users.length + 1
      this.state.users.push({
        id,
        email: String(this.params[0]),
        name: String(this.params[1]),
        status: String(this.params[2]),
        password_hash: String(this.params[3]),
      })
      return { success: true, meta: { last_row_id: id } } as D1Result
    }
    if (normalized.startsWith('delete from user_roles')) {
      const userId = Number(this.params[0])
      this.state.userRoles = this.state.userRoles.filter((userRole) => userRole.user_id !== userId)
    }
    if (normalized.startsWith('insert or ignore into user_roles')) {
      const userId = Number(this.params[0])
      const roleId = Number(this.params[1])
      const exists = this.state.userRoles.some((userRole) => userRole.user_id === userId && userRole.role_id === roleId)
      if (!exists) this.state.userRoles.push({ user_id: userId, role_id: roleId })
    }
    if (normalized.startsWith('insert into sessions')) {
      this.state.sessions.push({
        user_id: Number(this.params[0]),
        session_hash: String(this.params[1]),
        expires_at: String(this.params[2]),
        revoked_at: null,
      })
    }
    if (normalized.startsWith('update sessions')) {
      const sessionHash = String(this.params[this.params.length - 1])
      const session = this.state.sessions.find((row) => row.session_hash === sessionHash)
      if (session) session.revoked_at = new Date().toISOString()
    }
    if (normalized.startsWith('insert into audit_logs')) {
      this.state.audits.push({
        actor_user_id: this.params[0] === null ? null : Number(this.params[0]),
        action: String(this.params[2]),
        resource_type: String(this.params[3]),
        resource_id: String(this.params[4]),
        payload_json: String(this.params[5]),
      })
    }
    return { success: true, meta: {} } as D1Result
  }
}

class FakeD1Database {
  constructor(private readonly state: FakeState) {}

  prepare(sql: string): FakeD1Statement {
    return new FakeD1Statement(this.state, sql)
  }
}

function fakeEnv(state: FakeState) {
  return {
    DB: new FakeD1Database(state) as unknown as D1Database,
    ASSETS: {} as R2Bucket,
    SESSION_TTL_SECONDS: '604800',
  }
}

function fetchWorker(request: Request, env: ReturnType<typeof fakeEnv>): Promise<Response> {
  return (worker.fetch as unknown as (request: Request, env: ReturnType<typeof fakeEnv>) => Promise<Response>)(request, env)
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function passwordHash(password: string): Promise<string> {
  const salt = 'test-salt'
  return `sha256:${salt}:${await sha256Hex(`${salt}:${password}`)}`
}

async function stateWithUsers(): Promise<FakeState> {
  return {
    users: [
      { id: 1, email: 'admin@example.com', name: 'Admin', status: 'active', password_hash: await passwordHash('admin-pass') },
      { id: 2, email: 'reviewer@example.com', name: 'Reviewer', status: 'active', password_hash: await passwordHash('review-pass') },
      { id: 3, email: 'inactive@example.com', name: 'Inactive', status: 'inactive', password_hash: await passwordHash('inactive-pass') },
    ],
    roles: [
      { id: 1, role_key: 'admin', name: '管理员' },
      { id: 2, role_key: 'reviewer', name: '审图人员' },
      { id: 3, role_key: 'viewer', name: '只读查看' },
    ],
    userRoles: [
      { user_id: 1, role_id: 1 },
      { user_id: 2, role_id: 2 },
    ],
    sessions: [],
    audits: [],
  }
}

async function addSession(state: FakeState, userId: number, token: string): Promise<string> {
  const sessionHash = await sha256Hex(token)
  state.sessions.push({
    user_id: userId,
    session_hash: sessionHash,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    revoked_at: null,
  })
  return `cs_session=${token}`
}

describe('auth routes', () => {
  it('POST /api/auth/login rejects inactive users', async () => {
    const state = await stateWithUsers()
    const response = await fetchWorker(
      new Request('https://example.test/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'inactive@example.com', password: 'inactive-pass' }),
      }),
      fakeEnv(state),
    )

    expect(response.status).toBe(401)
    expect(state.sessions).toHaveLength(0)
  })

  it('GET /api/auth/me rejects missing sessions', async () => {
    const state = await stateWithUsers()
    const response = await fetchWorker(new Request('https://example.test/api/auth/me'), fakeEnv(state))

    expect(response.status).toBe(401)
  })

  it('POST /api/admin/users is rejected for a reviewer session', async () => {
    const state = await stateWithUsers()
    const cookie = await addSession(state, 2, 'reviewer-token')
    const response = await fetchWorker(
      new Request('https://example.test/api/admin/users', {
        method: 'POST',
        headers: { cookie },
        body: JSON.stringify({ email: 'new@example.com', name: 'New User', password: 'secret-pass', roleKeys: ['viewer'] }),
      }),
      fakeEnv(state),
    )

    expect(response.status).toBe(403)
    expect(state.users).toHaveLength(3)
  })

  it('POST /api/admin/users succeeds for admin and stores no plain password', async () => {
    const state = await stateWithUsers()
    const cookie = await addSession(state, 1, 'admin-token')
    const response = await fetchWorker(
      new Request('https://example.test/api/admin/users', {
        method: 'POST',
        headers: { cookie },
        body: JSON.stringify({ email: 'new@example.com', name: 'New User', password: 'secret-pass', roleKeys: ['viewer'] }),
      }),
      fakeEnv(state),
    )

    expect(response.status).toBe(201)
    expect(state.users).toHaveLength(4)
    expect(state.users[3].password_hash).not.toBe('secret-pass')
    expect(state.users[3].password_hash).toMatch(/^sha256:/)
    expect(state.userRoles).toContainEqual({ user_id: 4, role_id: 3 })
  })

  it('POST /api/admin/users rejects unknown roleKeys without creating a user', async () => {
    const state = await stateWithUsers()
    const cookie = await addSession(state, 1, 'admin-token')
    const response = await fetchWorker(
      new Request('https://example.test/api/admin/users', {
        method: 'POST',
        headers: { cookie },
        body: JSON.stringify({ email: 'new@example.com', name: 'New User', password: 'secret-pass', roleKeys: ['viewer', 'missing_role'] }),
      }),
      fakeEnv(state),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'unknown roleKeys: missing_role' })
    expect(state.users).toHaveLength(3)
    expect(state.userRoles).toEqual([
      { user_id: 1, role_id: 1 },
      { user_id: 2, role_id: 2 },
    ])
    expect(state.audits).toHaveLength(0)
  })

  it('PUT /api/admin/users/:id/roles rejects unknown roleKeys without clearing existing assignments', async () => {
    const state = await stateWithUsers()
    const cookie = await addSession(state, 1, 'admin-token')
    const response = await fetchWorker(
      new Request('https://example.test/api/admin/users/2/roles', {
        method: 'PUT',
        headers: { cookie },
        body: JSON.stringify({ roleKeys: ['viewer', 'missing_role'] }),
      }),
      fakeEnv(state),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'unknown roleKeys: missing_role' })
    expect(state.userRoles).toContainEqual({ user_id: 2, role_id: 2 })
    expect(state.userRoles).not.toContainEqual({ user_id: 2, role_id: 3 })
    expect(state.audits).toHaveLength(0)
  })

  it('PATCH /api/admin/users/:id/roles rejects unknown roleKeys without clearing existing assignments', async () => {
    const state = await stateWithUsers()
    const cookie = await addSession(state, 1, 'admin-token')
    const response = await fetchWorker(
      new Request('https://example.test/api/admin/users/2/roles', {
        method: 'PATCH',
        headers: { cookie },
        body: JSON.stringify({ roleKeys: ['missing_role'] }),
      }),
      fakeEnv(state),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'unknown roleKeys: missing_role' })
    expect(state.userRoles).toContainEqual({ user_id: 2, role_id: 2 })
    expect(state.audits).toHaveLength(0)
  })
})
