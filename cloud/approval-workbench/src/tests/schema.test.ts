import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

const schema = fs.readFileSync('migrations/0001_init.sql', 'utf8')
const generationSchema = fs.readFileSync('migrations/0003_generation_jobs.sql', 'utf8')
const imageResourceSchema = fs.readFileSync('migrations/0004_image_resources.sql', 'utf8')
const machineUniquenessMigration = fs.readFileSync('migrations/0008_task_machine_uniqueness_and_runtime.sql', 'utf8')

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
    expect(schema).toContain('UNIQUE(fingerprint_hash)')
    expect(schema).toContain('UNIQUE(job_type, idempotency_key)')
  })

  it('adds generation request tracking in the task 4 migration', () => {
    expect(generationSchema).toContain('CREATE TABLE IF NOT EXISTS ai_generation_requests')
    expect(generationSchema).toContain('request_uid TEXT NOT NULL UNIQUE')
    expect(generationSchema).toContain('dispatch_job_uid TEXT NOT NULL DEFAULT')
  })

  it('adds image resource library tracking in the task 5 migration', () => {
    expect(imageResourceSchema).toContain('CREATE TABLE IF NOT EXISTS image_resources')
    expect(imageResourceSchema).toContain('resource_uid TEXT NOT NULL UNIQUE')
    expect(imageResourceSchema).toContain('asset_uid TEXT NOT NULL')
    expect(imageResourceSchema).toContain('idx_image_resources_batch_style_item')
  })

  it('normalizes historical duplicate machine fingerprints before adding the unique index', () => {
    const normalizationIndex = machineUniquenessMigration.indexOf('UPDATE task_machines')
    const uniqueIndex = machineUniquenessMigration.indexOf('CREATE UNIQUE INDEX')

    expect(normalizationIndex).toBeGreaterThanOrEqual(0)
    expect(uniqueIndex).toBeGreaterThan(normalizationIndex)
    expect(machineUniquenessMigration).toContain("':legacy-duplicate:'")
  })
})
