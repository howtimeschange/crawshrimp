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
import {
  approveMachine,
  claimJob,
  completeJob,
  createEnrollmentToken,
  disableMachine,
  enrollMachine,
  failJob,
  heartbeat,
  listEnrollmentTokens,
  listMachines,
  progressJob,
  renewJob,
  revokeEnrollmentToken,
  revokeMachine,
  rotateMachineToken,
} from './machine-routes'

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
    if (/^\/api\/admin\/users\/\d+\/roles$/.test(url.pathname) && ['PATCH', 'PUT'].includes(request.method)) return updateUserRoles(request, env)
    if (url.pathname === '/api/admin/roles' && request.method === 'GET') return listRoles(request, env)
    if (url.pathname === '/api/admin/audit-logs' && request.method === 'GET') return listAuditLogs(request, env)
    if (url.pathname === '/api/admin/machine-enrollment-tokens' && request.method === 'GET') return listEnrollmentTokens(request, env)
    if (url.pathname === '/api/admin/machine-enrollment-tokens' && request.method === 'POST') return createEnrollmentToken(request, env)
    if (/^\/api\/admin\/machine-enrollment-tokens\/\d+$/.test(url.pathname) && request.method === 'DELETE') return revokeEnrollmentToken(request, env)
    if (url.pathname === '/api/admin/machines' && request.method === 'GET') return listMachines(request, env)
    if (/^\/api\/admin\/machines\/[^/]+\/approve$/.test(url.pathname) && request.method === 'POST') return approveMachine(request, env)
    if (/^\/api\/admin\/machines\/[^/]+\/disable$/.test(url.pathname) && request.method === 'POST') return disableMachine(request, env)
    if (/^\/api\/admin\/machines\/[^/]+\/revoke$/.test(url.pathname) && request.method === 'POST') return revokeMachine(request, env)
    if (/^\/api\/admin\/machines\/[^/]+\/rotate-token$/.test(url.pathname) && request.method === 'POST') return rotateMachineToken(request, env)
    if (url.pathname === '/api/machines/enroll' && request.method === 'POST') return enrollMachine(request, env)
    if (url.pathname === '/api/machines/heartbeat' && request.method === 'POST') return heartbeat(request, env)
    if (url.pathname === '/api/machines/jobs/claim' && request.method === 'POST') return claimJob(request, env)
    if (/^\/api\/jobs\/[^/]+\/renew$/.test(url.pathname) && request.method === 'POST') return renewJob(request, env)
    if (/^\/api\/jobs\/[^/]+\/progress$/.test(url.pathname) && request.method === 'POST') return progressJob(request, env)
    if (/^\/api\/jobs\/[^/]+\/complete$/.test(url.pathname) && request.method === 'POST') return completeJob(request, env)
    if (/^\/api\/jobs\/[^/]+\/fail$/.test(url.pathname) && request.method === 'POST') return failJob(request, env)
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, { status: 404 })

    return new Response('Crawshrimp cloud approval workbench scaffold', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  },
} satisfies ExportedHandler<Env>
