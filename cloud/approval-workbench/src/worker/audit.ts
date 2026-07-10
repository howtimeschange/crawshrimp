import { nowIso, toJson } from './db'
import type { Env } from './env'
import { redactSensitiveJson } from './security/redact'

export interface AuditActor {
  userId?: number | null
  machineId?: string | null
}

export async function recordAudit(
  env: Env,
  actor: AuditActor | null,
  action: string,
  resourceType: string,
  resourceId: string,
  payload: unknown,
  request: Request,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_logs (
      actor_user_id,
      actor_machine_id,
      action,
      resource_type,
      resource_id,
      payload_json,
      ip_address,
      user_agent,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      actor?.userId ?? null,
      actor?.machineId ?? null,
      action,
      resourceType,
      resourceId,
      toJson(redactSensitiveJson(payload)),
      request.headers.get('cf-connecting-ip') || '',
      request.headers.get('user-agent') || '',
      nowIso(),
    )
    .run()
}
