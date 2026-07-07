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
import {
  createPromptLibrary,
  listPromptLibraries,
  publishPromptLibrary,
  resolvePrompts,
  updatePromptTemplate,
} from './prompt-routes'
import {
  createAssetUploadPlan,
  getAssetDownload,
} from './asset-routes'
import {
  createManualStyleAsset,
  createRegenerationJobs,
  createSubmitJob,
  exportReviewDetail,
  getBatch,
  getSubmitPlan,
  getSubmitResult,
  listBatches,
  markBatchReady,
  saveAssetDecision,
  syncBatch,
  syncBatchComplete,
} from './batch-routes'
import {
  getDashboardSummary,
  getMachinePerformance,
  getPromptPerformance,
} from './dashboard-routes'

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
    if (url.pathname === '/api/prompt-libraries' && request.method === 'GET') return listPromptLibraries(request, env)
    if (url.pathname === '/api/prompt-libraries' && request.method === 'POST') return createPromptLibrary(request, env)
    if (/^\/api\/prompt-templates\/\d+$/.test(url.pathname) && request.method === 'PATCH') return updatePromptTemplate(request, env)
    if (/^\/api\/prompt-libraries\/\d+\/publish-version$/.test(url.pathname) && request.method === 'POST') return publishPromptLibrary(request, env)
    if (/^\/api\/prompt-libraries\/\d+\/resolved$/.test(url.pathname) && request.method === 'GET') return resolvePrompts(request, env)
    if (url.pathname === '/api/assets/presign' && request.method === 'POST') return createAssetUploadPlan(request, env)
    if (/^\/api\/assets\/[^/]+\/download$/.test(url.pathname) && request.method === 'GET') return getAssetDownload(request, env)
    if (url.pathname === '/api/dashboard/summary' && request.method === 'GET') return getDashboardSummary(request, env)
    if (url.pathname === '/api/dashboard/prompt-performance' && request.method === 'GET') return getPromptPerformance(request, env)
    if (url.pathname === '/api/dashboard/machine-performance' && request.method === 'GET') return getMachinePerformance(request, env)
    if (url.pathname === '/api/ai-image-batches' && request.method === 'GET') return listBatches(request, env)
    if (url.pathname === '/api/ai-image-batches/sync' && request.method === 'POST') return syncBatch(request, env)
    if (/^\/api\/ai-image-batches\/[^/]+\/sync-complete$/.test(url.pathname) && request.method === 'POST') return syncBatchComplete(request, env)
    if (/^\/api\/ai-image-batches\/[^/]+\/assets\/[^/]+\/decision$/.test(url.pathname) && request.method === 'PATCH') return saveAssetDecision(request, env)
    if (/^\/api\/ai-image-batches\/[^/]+\/manual-assets$/.test(url.pathname) && request.method === 'POST') return createManualStyleAsset(request, env)
    if (/^\/api\/ai-image-batches\/[^/]+\/regenerate$/.test(url.pathname) && request.method === 'POST') return createRegenerationJobs(request, env)
    if (/^\/api\/ai-image-batches\/[^/]+\/review-detail$/.test(url.pathname) && request.method === 'GET') return exportReviewDetail(request, env)
    if (/^\/api\/ai-image-batches\/[^/]+\/mark-ready$/.test(url.pathname) && request.method === 'POST') return markBatchReady(request, env)
    if (/^\/api\/ai-image-batches\/[^/]+\/submit-plan$/.test(url.pathname) && request.method === 'GET') return getSubmitPlan(request, env)
    if (/^\/api\/ai-image-batches\/[^/]+\/submit$/.test(url.pathname) && request.method === 'POST') return createSubmitJob(request, env)
    if (/^\/api\/ai-image-batches\/[^/]+\/submit-result$/.test(url.pathname) && request.method === 'GET') return getSubmitResult(request, env)
    if (/^\/api\/ai-image-batches\/[^/]+$/.test(url.pathname) && request.method === 'GET') return getBatch(request, env)
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, { status: 404 })

    return new Response('Crawshrimp cloud approval workbench scaffold', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  },
} satisfies ExportedHandler<Env>
