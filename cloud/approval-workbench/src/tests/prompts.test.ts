import { describe, expect, it } from 'vitest'
import worker from '../worker/index'
import { sha256Hex } from '../worker/security/tokens'

interface UserRow {
  id: number
  email: string
  name: string
  status: string
}

interface RoleRow {
  id: number
  role_key: string
  name: string
}

interface UserRoleRow {
  user_id: number
  role_id: number
}

interface SessionRow {
  user_id: number
  session_hash: string
  expires_at: string
  revoked_at: string | null
}

interface PromptLibraryRow {
  id: number
  name: string
  scenario: string
  status: string
  created_at: string
  updated_at: string
}

interface PromptTemplateRow {
  id: number
  library_id: number
  group_name: string
  field_name: string
  source_field_id: string
  field_order: number | null
  visible: number
  prompt_text: string
  size_label: string
  output_format: string
  quality: string
  reference_fields_json: string
  word_count: number | null
  field_type: string
  excel_meta_json: string
  category_rules_json: string
  gender_rules_json: string
  priority_json: string
  enabled: number
  updated_at: string
}

interface PromptTemplateVersionRow {
  id: number
  template_id: number
  version_no: number
  snapshot_json: string
  created_at: string
  created_by: number | null
}

interface AuditRow {
  actor_user_id: number | null
  action: string
  resource_type: string
  resource_id: string
  payload_json: string
}

interface FakeState {
  users: UserRow[]
  roles: RoleRow[]
  userRoles: UserRoleRow[]
  sessions: SessionRow[]
  libraries: PromptLibraryRow[]
  templates: PromptTemplateRow[]
  versions: PromptTemplateVersionRow[]
  audits: AuditRow[]
}

class FakeD1Statement {
  private params: unknown[] = []

  constructor(
    private readonly state: FakeState,
    private readonly sql: string,
  ) {}

  bind(...params: unknown[]): FakeD1Statement {
    this.params = params
    return this
  }

  async first<T>(): Promise<T | null> {
    const normalized = normalizeSql(this.sql)
    if (normalized.includes('from sessions') && normalized.includes('join users')) {
      const sessionHash = String(this.params[0])
      const now = String(this.params[1])
      const session = this.state.sessions.find((row) => row.session_hash === sessionHash && !row.revoked_at && row.expires_at > now)
      if (!session) return null
      return (this.state.users.find((user) => user.id === session.user_id && user.status === 'active') ?? null) as T | null
    }
    if (normalized.includes('select max(version_no)') && normalized.includes('from prompt_template_versions')) {
      const templateId = Number(this.params[0])
      const maxVersion = Math.max(0, ...this.state.versions.filter((row) => row.template_id === templateId).map((row) => row.version_no))
      return { version_no: maxVersion } as T
    }
    if (normalized.includes('from prompt_libraries') && normalized.includes('where id = ?')) {
      const libraryId = Number(this.params[0])
      return (this.state.libraries.find((row) => row.id === libraryId) ?? null) as T | null
    }
    if (normalized.includes('from prompt_templates') && normalized.includes('where id = ?')) {
      const templateId = Number(this.params[0])
      return (this.state.templates.find((row) => row.id === templateId) ?? null) as T | null
    }
    return null
  }

  async all<T>(): Promise<{ results: T[] }> {
    const normalized = normalizeSql(this.sql)
    if (normalized.includes('from roles') && normalized.includes('join user_roles')) {
      const userId = Number(this.params[0])
      const results = this.state.userRoles
        .filter((userRole) => userRole.user_id === userId)
        .map((userRole) => this.state.roles.find((role) => role.id === userRole.role_id))
        .filter((role): role is RoleRow => Boolean(role))
      return { results: results as T[] }
    }
    if (normalized.includes('from prompt_libraries') && normalized.includes('left join prompt_templates')) {
      const results = this.state.libraries.map((library) => ({
        ...library,
        templates: this.state.templates.filter((template) => template.library_id === library.id),
      }))
      return { results: results as T[] }
    }
    if (normalized.includes('from prompt_libraries')) {
      return { results: this.state.libraries as T[] }
    }
    if (normalized.includes('from prompt_templates')) {
      const libraryId = Number(this.params[0])
      return { results: this.state.templates.filter((template) => template.library_id === libraryId) as T[] }
    }
    if (normalized.includes('from prompt_template_versions')) {
      const templateIds = new Set(this.params.map((param) => Number(param)))
      return { results: this.state.versions.filter((version) => templateIds.has(version.template_id)) as T[] }
    }
    return { results: [] }
  }

  async run(): Promise<D1Result> {
    const normalized = normalizeSql(this.sql)
    if (normalized.startsWith('insert into prompt_libraries')) {
      const id = this.state.libraries.length + 1
      this.state.libraries.push({
        id,
        name: String(this.params[0]),
        scenario: String(this.params[1]),
        status: String(this.params[2]),
        created_at: String(this.params[3]),
        updated_at: String(this.params[4]),
      })
      return result(1, id)
    }
    if (normalized.startsWith('insert into prompt_templates')) {
      const id = this.state.templates.length + 1
      this.state.templates.push({
        id,
        library_id: Number(this.params[0]),
        group_name: String(this.params[1]),
        field_name: String(this.params[2]),
        source_field_id: String(this.params[3]),
        field_order: numberOrNull(this.params[4]),
        visible: Number(this.params[5]),
        prompt_text: String(this.params[6]),
        size_label: String(this.params[7]),
        output_format: String(this.params[8]),
        quality: String(this.params[9]),
        reference_fields_json: String(this.params[10]),
        word_count: numberOrNull(this.params[11]),
        field_type: String(this.params[12]),
        excel_meta_json: String(this.params[13]),
        category_rules_json: String(this.params[14]),
        gender_rules_json: String(this.params[15]),
        priority_json: String(this.params[16]),
        enabled: Number(this.params[17]),
        updated_at: String(this.params[18]),
      })
      return result(1, id)
    }
    if (normalized.startsWith('update prompt_templates set')) {
      const checksLibraryId = normalized.includes('and library_id = ?')
      const templateId = Number(this.params[checksLibraryId ? this.params.length - 2 : this.params.length - 1])
      const libraryId = checksLibraryId ? Number(this.params[this.params.length - 1]) : null
      const template = this.state.templates.find((row) => row.id === templateId && (libraryId === null || row.library_id === libraryId))
      if (!template) return result(0)
      template.group_name = String(this.params[0])
      template.field_name = String(this.params[1])
      template.source_field_id = String(this.params[2])
      template.field_order = numberOrNull(this.params[3])
      template.visible = Number(this.params[4])
      template.prompt_text = String(this.params[5])
      template.size_label = String(this.params[6])
      template.output_format = String(this.params[7])
      template.quality = String(this.params[8])
      template.reference_fields_json = String(this.params[9])
      template.word_count = numberOrNull(this.params[10])
      template.field_type = String(this.params[11])
      template.excel_meta_json = String(this.params[12])
      template.category_rules_json = String(this.params[13])
      template.gender_rules_json = String(this.params[14])
      template.priority_json = String(this.params[15])
      template.enabled = Number(this.params[16])
      template.updated_at = String(this.params[17])
      return result(1)
    }
    if (normalized.startsWith('insert into prompt_template_versions')) {
      const id = this.state.versions.length + 1
      this.state.versions.push({
        id,
        template_id: Number(this.params[0]),
        version_no: Number(this.params[1]),
        snapshot_json: String(this.params[2]),
        created_at: String(this.params[3]),
        created_by: numberOrNull(this.params[4]),
      })
      return result(1, id)
    }
    if (normalized.startsWith('update prompt_libraries set status')) {
      const library = this.state.libraries.find((row) => row.id === Number(this.params[2]))
      if (!library) return result(0)
      library.status = String(this.params[0])
      library.updated_at = String(this.params[1])
      return result(1)
    }
    if (normalized.startsWith('insert into audit_logs')) {
      this.state.audits.push({
        actor_user_id: numberOrNull(this.params[0]),
        action: String(this.params[2]),
        resource_type: String(this.params[3]),
        resource_id: String(this.params[4]),
        payload_json: String(this.params[5]),
      })
    }
    return result(1)
  }
}

class FakeD1Database {
  constructor(private readonly state: FakeState) {}

  prepare(sql: string): FakeD1Statement {
    return new FakeD1Statement(this.state, sql)
  }
}

function fakeEnv(state: FakeState) {
  return {
    DB: new FakeD1Database(state) as unknown as D1Database,
    ASSETS: {} as R2Bucket,
    SESSION_TTL_SECONDS: '604800',
  }
}

function fetchWorker(request: Request, env: ReturnType<typeof fakeEnv>): Promise<Response> {
  return (worker.fetch as unknown as (request: Request, env: ReturnType<typeof fakeEnv>) => Promise<Response>)(request, env)
}

async function stateWithPrompts(): Promise<FakeState> {
  const state: FakeState = {
    users: [
      { id: 1, email: 'manager@example.com', name: 'Manager', status: 'active' },
      { id: 2, email: 'reviewer@example.com', name: 'Reviewer', status: 'active' },
    ],
    roles: [
      { id: 1, role_key: 'prompt_manager', name: 'Prompt 管理' },
      { id: 2, role_key: 'reviewer', name: '审图人员' },
    ],
    userRoles: [
      { user_id: 1, role_id: 1 },
      { user_id: 2, role_id: 2 },
    ],
    sessions: [],
    libraries: [],
    templates: [],
    versions: [],
    audits: [],
  }
  await addSession(state, 1, 'manager-token')
  await addSession(state, 2, 'reviewer-token')
  return state
}

async function addSession(state: FakeState, userId: number, token: string): Promise<void> {
  state.sessions.push({
    user_id: userId,
    session_hash: await sha256Hex(token),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    revoked_at: null,
  })
}

function managerHeaders(): HeadersInit {
  return { cookie: 'cs_session=manager-token' }
}

function reviewerHeaders(): HeadersInit {
  return { cookie: 'cs_session=reviewer-token' }
}

async function createLibraryWithTemplates(state: FakeState): Promise<number> {
  const response = await fetchWorker(
    new Request('https://example.test/api/prompt-libraries', {
      method: 'POST',
      headers: managerHeaders(),
      body: JSON.stringify({
        name: 'Bala AI prompts',
        scenario: '裂变图',
        templates: [
          {
            group_name: 'main',
            field_name: 'white_background',
            prompt_text: 'published prompt A',
            size_label: '960x1280',
            output_format: 'jpeg',
            quality: 'high',
            category_rules: ['童装'],
            gender_rules: ['女童'],
            priority: 20,
          },
          {
            group_name: 'main',
            field_name: 'creative_scene',
            prompt_text: 'published prompt B',
            category_rules: ['童装'],
            gender_rules: ['女童'],
            priority: 10,
          },
          {
            group_name: 'main',
            field_name: 'boys_only',
            prompt_text: 'boys only prompt',
            category_rules: ['童装'],
            gender_rules: ['男童'],
            priority: 1,
          },
        ],
      }),
    }),
    fakeEnv(state),
  )
  expect(response.status).toBe(201)
  const body = await response.json() as { library: { id: number } }
  return body.library.id
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase()
}

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value)
}

function result(changes: number, lastRowId = 0): D1Result {
  return { success: true, meta: { changes, last_row_id: lastRowId } } as D1Result
}

describe('prompt routes', () => {
  it('lets prompt_manager create a library with templates', async () => {
    const state = await stateWithPrompts()
    const libraryId = await createLibraryWithTemplates(state)
    const creativeResponse = await fetchWorker(
      new Request('https://example.test/api/prompt-libraries', {
        method: 'POST',
        headers: managerHeaders(),
        body: JSON.stringify({ name: 'Creative shoot prompts', scenario: '创意拍摄', templates: [] }),
      }),
      fakeEnv(state),
    )

    expect(libraryId).toBe(1)
    expect(creativeResponse.status).toBe(201)
    expect(state.libraries[0]).toMatchObject({ name: 'Bala AI prompts', scenario: '裂变图', status: 'draft' })
    expect(state.libraries[1]).toMatchObject({ name: 'Creative shoot prompts', scenario: '创意拍摄', status: 'draft' })
    expect(state.templates).toHaveLength(3)
    expect(state.templates[0]).toMatchObject({
      library_id: 1,
      group_name: 'main',
      field_name: 'white_background',
      prompt_text: 'published prompt A',
      size_label: '960x1280',
      output_format: 'jpeg',
      quality: 'high',
      enabled: 1,
    })
  })

  it('imports, edits, and exports workbook-mapped prompt templates', async () => {
    const state = await stateWithPrompts()
    const importResponse = await fetchWorker(
      new Request('https://example.test/api/prompt-libraries/import', {
        method: 'POST',
        headers: managerHeaders(),
        body: JSON.stringify({
          templates: [{
            group_name: '上装',
            field_name: '正面标准站姿',
            source_field_id: 'rX2NWyE',
            field_order: 4,
            visible: true,
            size_label: '2K',
            output_format: 'jpeg',
            reference_fields: '图片 (ghzXVED)',
            prompt_text: '引用图片，8K 超清',
            word_count: 159,
            field_type: 'file',
            female_priority: 1,
            male_neutral_priority: 2,
          }],
        }),
      }),
      fakeEnv(state),
    )

    expect(importResponse.status).toBe(201)
    const importBody = await importResponse.json() as { library: { id: number, templates: Array<{ id: number }> } }
    const templateId = importBody.library.templates[0].id

    const bulkResponse = await fetchWorker(
      new Request(`https://example.test/api/prompt-libraries/${importBody.library.id}/templates/bulk`, {
        method: 'POST',
        headers: managerHeaders(),
        body: JSON.stringify({
          templates: [{
            id: templateId,
            group_name: '上装',
            field_name: '正面标准站姿',
            source_field_id: 'rX2NWyE',
            field_order: 4,
            visible: false,
            size_label: '4K',
            output_format: 'png',
            reference_fields: ['图片 (ghzXVED)'],
            prompt_text: '在线表格更新后的提示词',
            word_count: 88,
            field_type: 'file',
            female_priority: 3,
            male_neutral_priority: 4,
            enabled: true,
          }],
        }),
      }),
      fakeEnv(state),
    )
    expect(bulkResponse.status).toBe(200)

    const exportResponse = await fetchWorker(
      new Request(`https://example.test/api/prompt-libraries/${importBody.library.id}/export`, {
        headers: managerHeaders(),
      }),
      fakeEnv(state),
    )

    expect(exportResponse.status).toBe(200)
    const exportBody = await exportResponse.json() as { templates: Array<Record<string, unknown>> }
    expect(exportBody.templates[0]).toMatchObject({
      group_name: '上装',
      field_name: '正面标准站姿',
      source_field_id: 'rX2NWyE',
      field_order: 4,
      visible: false,
      prompt_text: '在线表格更新后的提示词',
      size_label: '4K',
      output_format: 'png',
      word_count: 88,
      field_type: 'file',
      female_priority: 3,
      male_neutral_priority: 4,
    })
  })

  it('rejects bulk updates for templates outside the URL-scoped library', async () => {
    const state = await stateWithPrompts()
    const libraryAId = await createLibraryWithTemplates(state)
    const libraryBId = await createLibraryWithTemplates(state)
    const libraryBTemplate = state.templates.find((template) => template.library_id === libraryBId)
    expect(libraryBTemplate).toBeDefined()
    const originalPromptText = libraryBTemplate?.prompt_text

    const response = await fetchWorker(
      new Request(`https://example.test/api/prompt-libraries/${libraryAId}/templates/bulk`, {
        method: 'POST',
        headers: managerHeaders(),
        body: JSON.stringify({
          templates: [{
            id: libraryBTemplate?.id,
            group_name: 'cross-library',
            field_name: 'should_not_update',
            prompt_text: 'mutated through wrong library',
          }],
        }),
      }),
      fakeEnv(state),
    )

    expect(response.status).toBe(404)
    expect(state.templates.find((template) => template.id === libraryBTemplate?.id)?.prompt_text).toBe(originalPromptText)
  })

  it('lets reviewer read resolved prompts but not publish versions', async () => {
    const state = await stateWithPrompts()
    const libraryId = await createLibraryWithTemplates(state)

    const readResponse = await fetchWorker(
      new Request(`https://example.test/api/prompt-libraries/${libraryId}/resolved?category=童装&gender=女童`, {
        headers: reviewerHeaders(),
      }),
      fakeEnv(state),
    )
    expect(readResponse.status).toBe(200)
    const readBody = await readResponse.json() as { templates: unknown[] }
    expect(readBody.templates).toHaveLength(2)

    const publishResponse = await fetchWorker(
      new Request(`https://example.test/api/prompt-libraries/${libraryId}/publish-version`, {
        method: 'POST',
        headers: reviewerHeaders(),
      }),
      fakeEnv(state),
    )
    expect(publishResponse.status).toBe(403)
    expect(state.versions).toHaveLength(0)
  })

  it('publishes immutable prompt_template_versions', async () => {
    const state = await stateWithPrompts()
    const libraryId = await createLibraryWithTemplates(state)

    const response = await fetchWorker(
      new Request(`https://example.test/api/prompt-libraries/${libraryId}/publish-version`, {
        method: 'POST',
        headers: managerHeaders(),
      }),
      fakeEnv(state),
    )

    expect(response.status).toBe(200)
    const body = await response.json() as { version_set: Array<{ template_id: number, version_id: number, version_no: number }> }
    expect(body.version_set).toHaveLength(3)
    expect(state.versions).toHaveLength(3)
    expect(JSON.parse(state.versions[0].snapshot_json)).toMatchObject({
      template_id: 1,
      group_name: 'main',
      field_name: 'white_background',
      prompt_text: 'published prompt A',
      scenario: '裂变图',
    })
  })

  it('resolves prompts by category and gender ordered by priority', async () => {
    const state = await stateWithPrompts()
    const libraryId = await createLibraryWithTemplates(state)
    await fetchWorker(
      new Request(`https://example.test/api/prompt-libraries/${libraryId}/publish-version`, {
        method: 'POST',
        headers: managerHeaders(),
      }),
      fakeEnv(state),
    )

    const response = await fetchWorker(
      new Request(`https://example.test/api/prompt-libraries/${libraryId}/resolved?category=童装&gender=女童&limit=1`, {
        headers: reviewerHeaders(),
      }),
      fakeEnv(state),
    )

    expect(response.status).toBe(200)
    const body = await response.json() as { templates: Array<Record<string, unknown>> }
    expect(body.templates).toEqual([
      {
        template_id: 2,
        version_id: 2,
        group_name: 'main',
        field_name: 'creative_scene',
        prompt_text: 'published prompt B',
        size_label: '960x1280',
        output_format: 'jpeg',
        quality: 'auto',
      },
    ])
  })

  it('does not mutate published snapshot when a template draft is updated', async () => {
    const state = await stateWithPrompts()
    const libraryId = await createLibraryWithTemplates(state)
    await fetchWorker(
      new Request(`https://example.test/api/prompt-libraries/${libraryId}/publish-version`, {
        method: 'POST',
        headers: managerHeaders(),
      }),
      fakeEnv(state),
    )

    const updateResponse = await fetchWorker(
      new Request('https://example.test/api/prompt-templates/2', {
        method: 'PATCH',
        headers: managerHeaders(),
        body: JSON.stringify({ prompt_text: 'draft prompt B changed after publish', priority: 1 }),
      }),
      fakeEnv(state),
    )
    expect(updateResponse.status).toBe(200)

    const response = await fetchWorker(
      new Request(`https://example.test/api/prompt-libraries/${libraryId}/resolved?category=童装&gender=女童`, {
        headers: reviewerHeaders(),
      }),
      fakeEnv(state),
    )

    const body = await response.json() as { templates: Array<Record<string, unknown>> }
    expect(body.templates.map((template) => template.prompt_text)).toContain('published prompt B')
    expect(body.templates.map((template) => template.prompt_text)).not.toContain('draft prompt B changed after publish')
    expect(JSON.parse(state.versions.find((version) => version.template_id === 2)?.snapshot_json || '{}').prompt_text).toBe('published prompt B')
  })

  it('excludes a disabled template even when it has a published version', async () => {
    const state = await stateWithPrompts()
    const libraryId = await createLibraryWithTemplates(state)
    await fetchWorker(
      new Request(`https://example.test/api/prompt-libraries/${libraryId}/publish-version`, {
        method: 'POST',
        headers: managerHeaders(),
      }),
      fakeEnv(state),
    )

    const updateResponse = await fetchWorker(
      new Request('https://example.test/api/prompt-templates/2', {
        method: 'PATCH',
        headers: managerHeaders(),
        body: JSON.stringify({ enabled: false }),
      }),
      fakeEnv(state),
    )
    expect(updateResponse.status).toBe(200)

    const response = await fetchWorker(
      new Request(`https://example.test/api/prompt-libraries/${libraryId}/resolved?category=童装&gender=女童`, {
        headers: reviewerHeaders(),
      }),
      fakeEnv(state),
    )

    const body = await response.json() as { templates: Array<Record<string, unknown>> }
    expect(body.templates.map((template) => template.template_id)).toEqual([1])
    expect(body.templates.map((template) => template.prompt_text)).not.toContain('published prompt B')
    expect(state.versions.some((version) => version.template_id === 2)).toBe(true)
  })
})
