import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { createD1MigrationTestDatabase, executeD1SqlScript } from './migration-test-helper'

const schema = fs.readFileSync('migrations/0001_init.sql', 'utf8')
const generationSchema = fs.readFileSync('migrations/0003_generation_jobs.sql', 'utf8')
const imageResourceSchema = fs.readFileSync('migrations/0004_image_resources.sql', 'utf8')
const machineUniquenessMigration = fs.readFileSync('migrations/0008_task_machine_uniqueness_and_runtime.sql', 'utf8')
const wranglerConfig = fs.readFileSync('wrangler.toml', 'utf8')

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

  it('executes the task machine fingerprint migration against duplicate D1 rows', async () => {
    const db = await createD1MigrationTestDatabase()
    try {
      await executeD1SqlScript(db, `
        CREATE TABLE task_machines (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          machine_uid TEXT NOT NULL,
          fingerprint_hash TEXT NOT NULL
        );
        CREATE TABLE dispatch_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          assigned_machine_id INTEGER,
          status TEXT NOT NULL DEFAULT 'pending',
          lease_expires_at TEXT
        );
        INSERT INTO task_machines (machine_uid, fingerprint_hash)
        VALUES ('machine-old-a', 'same-fingerprint'),
               ('machine-new-a', 'same-fingerprint'),
               ('machine-b', 'other-fingerprint');
      `)

      await executeD1SqlScript(db, machineUniquenessMigration)

      const rows = await db.prepare(`
        SELECT machine_uid, fingerprint_hash
        FROM task_machines
        ORDER BY id
      `).all<{ machine_uid: string; fingerprint_hash: string }>()

      expect(rows.results).toEqual([
        { machine_uid: 'machine-old-a', fingerprint_hash: 'same-fingerprint:legacy-duplicate:1' },
        { machine_uid: 'machine-new-a', fingerprint_hash: 'same-fingerprint' },
        { machine_uid: 'machine-b', fingerprint_hash: 'other-fingerprint' },
      ])

      await expect(db.prepare(`
        INSERT INTO task_machines (machine_uid, fingerprint_hash)
        VALUES ('machine-conflict', 'same-fingerprint')
      `).run()).rejects.toThrow(/UNIQUE constraint failed/i)
    } finally {
      await db.dispose()
    }
  })

  it('can be rerun after a successful migration without mutating normalized rows', async () => {
    const db = await createD1MigrationTestDatabase()
    try {
      await executeD1SqlScript(db, `
        CREATE TABLE task_machines (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          machine_uid TEXT NOT NULL,
          fingerprint_hash TEXT NOT NULL
        );
        CREATE TABLE dispatch_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          assigned_machine_id INTEGER,
          status TEXT NOT NULL DEFAULT 'pending',
          lease_expires_at TEXT
        );
        INSERT INTO task_machines (machine_uid, fingerprint_hash)
        VALUES ('machine-old-a', 'same-fingerprint'),
               ('machine-new-a', 'same-fingerprint');
      `)

      await executeD1SqlScript(db, machineUniquenessMigration)
      const afterFirstRun = await db.prepare(`
        SELECT machine_uid, fingerprint_hash
        FROM task_machines
        ORDER BY id
      `).all()

      await executeD1SqlScript(db, machineUniquenessMigration)
      const afterSecondRun = await db.prepare(`
        SELECT machine_uid, fingerprint_hash
        FROM task_machines
        ORDER BY id
      `).all()

      expect(afterSecondRun.results).toEqual(afterFirstRun.results)
    } finally {
      await db.dispose()
    }
  })

  it('keeps the production workbench on the approval.crawshrimp.com custom domain', () => {
    expect(wranglerConfig).toContain('pattern = "approval.crawshrimp.com"')
    expect(wranglerConfig).toContain('custom_domain = true')
  })
})
