import fs from 'node:fs'
import { Miniflare } from 'miniflare'

export type D1MigrationTestDatabase = Pick<D1Database, 'exec' | 'prepare' | 'batch'> & {
  assets: R2Bucket
  database: D1Database
  dispose: () => Promise<void>
}

export async function executeD1SqlScript(db: Pick<D1Database, 'exec'>, sql: string): Promise<void> {
  for (const statement of splitSqlStatements(sql)) {
    await db.exec(statement)
  }
}

export async function createD1MigrationTestDatabase(): Promise<D1MigrationTestDatabase> {
  const miniflare = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: ['DB'],
    r2Buckets: ['ASSETS'],
  })
  const db = await miniflare.getD1Database('DB')

  return {
    exec: db.exec.bind(db),
    prepare: db.prepare.bind(db),
    batch: db.batch.bind(db),
    database: db as unknown as D1Database,
    assets: await miniflare.getR2Bucket('ASSETS') as unknown as R2Bucket,
    dispose: () => miniflare.dispose(),
  }
}

export async function applyWorkflowMigrations(db: D1MigrationTestDatabase): Promise<void> {
  for (const migration of [
    '0001_init', '0002_prompt_excel_fields', '0003_generation_jobs', '0004_image_resources',
    '0005_material_test_data', '0006_dispatch_job_cancel_requested', '0007_direct_cloud_generation_tracking',
    '0008_task_machine_uniqueness_and_runtime',
  ]) {
    await executeD1SqlScript(db, fs.readFileSync(`migrations/${migration}.sql`, 'utf8'))
  }
}

function splitSqlStatements(sql: string): string[] {
  return String(sql || '')
    .split(';')
    .map(statement => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}
