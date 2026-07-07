import { sessionTtlSeconds, type Env } from './env'
import { json } from './http'
import {
  createUser,
  listAuditLogs,
  listRoles,
  listUsers,
  login,
  logout,
  me,
  updateUser,
  updateUserRoles,
} from './auth-routes'

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return json({
        ok: true,
        service: 'crawshrimp-cloud-approval-workbench',
        sessionTtlSeconds: sessionTtlSeconds(env),
      })
    }

    if (url.pathname === '/api/auth/login' && request.method === 'POST') return login(request, env)
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') return logout(request, env)
    if (url.pathname === '/api/auth/me' && request.method === 'GET') return me(request, env)
    if (url.pathname === '/api/admin/users' && request.method === 'GET') return listUsers(request, env)
    if (url.pathname === '/api/admin/users' && request.method === 'POST') return createUser(request, env)
    if (/^\/api\/admin\/users\/\d+$/.test(url.pathname) && request.method === 'PATCH') return updateUser(request, env)
    if (/^\/api\/admin\/users\/\d+\/roles$/.test(url.pathname) && request.method === 'PUT') return updateUserRoles(request, env)
    if (url.pathname === '/api/admin/roles' && request.method === 'GET') return listRoles(request, env)
    if (url.pathname === '/api/admin/audit-logs' && request.method === 'GET') return listAuditLogs(request, env)
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, { status: 404 })

    return new Response('Crawshrimp cloud approval workbench scaffold', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  },
} satisfies ExportedHandler<Env>
