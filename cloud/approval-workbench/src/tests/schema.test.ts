import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

const schema = fs.readFileSync('migrations/0001_init.sql', 'utf8')
const generationSchema = fs.readFileSync('migrations/0003_generation_jobs.sql', 'utf8')

describe('initial D1 schema', () => {
  it('contains auth rbac machine job prompt batch and audit tables', () => {
    for (const table of [
      'users',
      'roles',
      'user_roles',
      'role_permissions',
      'sessions',
      'audit_logs',
      'machine_enrollment_tokens',
      'task_machines',
      'machine_tokens',
      'dispatch_jobs',
      'dispatch_job_events',
      'prompt_libraries',
      'prompt_templates',
      'prompt_template_versions',
      'ai_image_batches',
      'ai_image_styles',
      'ai_image_assets',
      'approval_events',
    ]) {
      expect(schema).toContain(`CREATE TABLE IF NOT EXISTS ${table}`)
    }
  })

  it('defines uniqueness for idempotency and machine identity', () => {
    expect(schema).toContain('UNIQUE(email)')
    expect(schema).toContain('UNIQUE(machine_id)')
    expect(schema).toContain('UNIQUE(job_type, idempotency_key)')
  })

  it('adds generation request tracking in the task 4 migration', () => {
    expect(generationSchema).toContain('CREATE TABLE IF NOT EXISTS ai_generation_requests')
    expect(generationSchema).toContain('request_uid TEXT NOT NULL UNIQUE')
    expect(generationSchema).toContain('dispatch_job_uid TEXT NOT NULL DEFAULT')
  })
})
