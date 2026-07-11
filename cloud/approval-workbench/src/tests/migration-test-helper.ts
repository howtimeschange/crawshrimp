import { Miniflare } from 'miniflare'

export type D1MigrationTestDatabase = Pick<D1Database, 'exec' | 'prepare'> & {
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
  })
  const db = await miniflare.getD1Database('DB')

  return {
    exec: db.exec.bind(db),
    prepare: db.prepare.bind(db),
    dispose: () => miniflare.dispose(),
  }
}

function splitSqlStatements(sql: string): string[] {
  return String(sql || '')
    .split(';')
    .map(statement => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}
