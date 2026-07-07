import type { Env } from './env'
import { json } from './http'
import { requirePermission } from './auth-routes'

interface BatchRow {
  id: number
  batch_uid: string
  status: string
}

interface AssetRow {
  id: number
  asset_uid: string
  batch_uid: string
  kind: string
  status: string
  prompt_template_version_id: number | null
  parent_asset_uid: string | null
}

interface PromptTemplateVersionRow {
  id: number
  template_id: number
  version_no: number
  snapshot_json: string
}

interface DispatchJobRow {
  id: number
  job_uid: string
  batch_uid: string
  job_type: string
  status: string
  assigned_machine_id: string | null
}

export async function getDashboardSummary(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'dashboard:read')
  if (actor instanceof Response) return actor
  const { results: batches } = await env.DB.prepare('SELECT * FROM ai_image_batches').all<BatchRow>()
  const { results: assets } = await env.DB.prepare('SELECT * FROM ai_image_assets').all<AssetRow>()
  const batchTotalsByStatus = countBy(batches, (batch) => batch.status)
  const aiAssets = assets.filter((asset) => asset.kind === 'ai')
  return json({
    batch_totals_by_status: batchTotalsByStatus,
    image_funnel: {
      generated: aiAssets.length,
      approved: aiAssets.filter((asset) => asset.status === 'approved').length,
      rejected: aiAssets.filter((asset) => asset.status === 'rejected').length,
      regenerated: aiAssets.filter((asset) => Boolean(asset.parent_asset_uid)).length,
      submitted: aiAssets.filter((asset) => asset.status === 'submitted').length,
    },
  })
}

export async function getPromptPerformance(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'dashboard:read')
  if (actor instanceof Response) return actor
  const { results: assets } = await env.DB.prepare('SELECT * FROM ai_image_assets').all<AssetRow>()
  const { results: versions } = await env.DB.prepare('SELECT * FROM prompt_template_versions').all<PromptTemplateVersionRow>()
  const versionById = new Map(versions.map((version) => [version.id, version]))
  const byVersion = new Map<number, { version_id: number; template_id: number; generated: number; approved: number; rejected: number }>()
  for (const asset of assets.filter((row) => row.kind === 'ai' && row.prompt_template_version_id !== null)) {
    const versionId = Number(asset.prompt_template_version_id)
    const version = versionById.get(versionId)
    if (!version) continue
    const current = byVersion.get(versionId) ?? { version_id: versionId, template_id: version.template_id, generated: 0, approved: 0, rejected: 0 }
    current.generated += 1
    if (asset.status === 'approved') current.approved += 1
    if (asset.status === 'rejected') current.rejected += 1
    byVersion.set(versionId, current)
  }
  return json({
    prompt_templates: Array.from(byVersion.values())
      .sort((a, b) => a.template_id - b.template_id || a.version_id - b.version_id)
      .map((row) => ({ ...row, approval_rate: row.generated > 0 ? row.approved / row.generated : 0 })),
  })
}

export async function getMachinePerformance(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'dashboard:read')
  if (actor instanceof Response) return actor
  const { results: jobs } = await env.DB.prepare('SELECT * FROM dispatch_jobs').all<DispatchJobRow>()
  const byMachine = new Map<string, { machine_id: string; succeeded: number; failed: number }>()
  for (const job of jobs) {
    const machineId = job.assigned_machine_id || 'unassigned'
    const current = byMachine.get(machineId) ?? { machine_id: machineId, succeeded: 0, failed: 0 }
    if (job.status === 'succeeded') current.succeeded += 1
    if (['retryable_failed', 'terminal_failed'].includes(job.status)) current.failed += 1
    byMachine.set(machineId, current)
  }
  return json({ machines: Array.from(byMachine.values()).sort((a, b) => a.machine_id.localeCompare(b.machine_id)) })
}

function countBy<T>(rows: T[], keyFor: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const row of rows) counts[keyFor(row)] = (counts[keyFor(row)] ?? 0) + 1
  return counts
}
