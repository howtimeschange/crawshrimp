import { recordAudit } from './audit'
import { fromJsonObject, nowIso, toJson } from './db'
import type { Env } from './env'
import { badRequest, json, readJsonObject } from './http'
import { requirePermission } from './auth-routes'

const ALLOWED_SCENARIOS = new Set(['裂变图', '创意拍摄'])
const TEMPLATE_COLUMNS = `id, library_id, group_name, field_name, source_field_id, field_order, visible,
  prompt_text, size_label, output_format, quality, reference_fields_json, word_count, field_type,
  excel_meta_json, category_rules_json, gender_rules_json, priority_json, enabled, updated_at`

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

interface VersionNoRow {
  version_no: number | null
}

interface TemplateInput {
  group_name: string
  field_name: string
  source_field_id: string
  field_order: number | null
  visible: boolean
  prompt_text: string
  size_label: string
  output_format: string
  quality: string
  reference_fields: string[]
  word_count: number | null
  field_type: string
  female_priority: number | null
  male_neutral_priority: number | null
  category_rules: string[]
  gender_rules: string[]
  priority: number
  enabled: number
}

interface ResolvedTemplate {
  template_id: number
  version_id: number | null
  group_name: string
  field_name: string
  source_field_id: string
  field_order: number | null
  visible: boolean
  prompt_text: string
  size_label: string
  output_format: string
  quality: string
  reference_fields: string[]
  word_count: number | null
  field_type: string
  female_priority: number | null
  male_neutral_priority: number | null
  category_rules: string[]
  gender_rules: string[]
  priority: number
}

export async function listPromptLibraries(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'prompts:read')
  if (actor instanceof Response) return actor

  const { results: libraries } = await env.DB.prepare(
    'SELECT id, name, scenario, status, created_at, updated_at FROM prompt_libraries ORDER BY id DESC',
  ).all<PromptLibraryRow>()
  const libraryIds = libraries.map((library) => library.id)
  const templatesByLibrary = new Map<number, PromptTemplateRow[]>()
  for (const libraryId of libraryIds) {
    const { results } = await env.DB.prepare(
      `SELECT ${TEMPLATE_COLUMNS}
       FROM prompt_templates
       WHERE library_id = ?
       ORDER BY id`,
    )
      .bind(libraryId)
      .all<PromptTemplateRow>()
    templatesByLibrary.set(libraryId, results)
  }

  return json({
    libraries: libraries.map((library) => ({
      ...library,
      templates: (templatesByLibrary.get(library.id) || []).map(publicTemplate),
    })),
  })
}

export async function createPromptLibrary(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'prompts:write')
  if (actor instanceof Response) return actor

  const body = await readJsonObject(request)
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const scenario = typeof body.scenario === 'string' ? body.scenario.trim() : ''
  if (!name) return badRequest('name is required')
  if (!ALLOWED_SCENARIOS.has(scenario)) return badRequest('scenario must be 裂变图 or 创意拍摄')

  const now = nowIso()
  const result = await env.DB.prepare(
    'INSERT INTO prompt_libraries (name, scenario, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(name, scenario, 'draft', now, now)
    .run()
  const libraryId = Number(result.meta.last_row_id)
  const templates = Array.isArray(body.templates) ? body.templates : []
  const createdTemplates = []
  for (const rawTemplate of templates) {
    const template = templateInput(rawTemplate)
    if (template instanceof Response) return template
    const templateResult = await insertTemplate(env, libraryId, template, now)
    createdTemplates.push({ id: Number(templateResult.meta.last_row_id), ...template })
  }
  await recordAudit(env, { userId: actor.user.id }, 'prompts.library.create', 'prompt_library', String(libraryId), { name, scenario }, request)
  return json({ library: { id: libraryId, name, scenario, status: 'draft', templates: createdTemplates } }, { status: 201 })
}

export async function importPromptLibrary(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'prompts:write')
  if (actor instanceof Response) return actor

  const body = await readJsonObject(request)
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'AI 测图提示词库 默认版'
  const scenario = typeof body.scenario === 'string' && body.scenario.trim() ? body.scenario.trim() : '裂变图'
  const templates = Array.isArray(body.templates) ? body.templates : []
  if (!ALLOWED_SCENARIOS.has(scenario)) return badRequest('scenario must be 裂变图 or 创意拍摄')
  if (templates.length === 0) return badRequest('templates are required')

  const now = nowIso()
  const result = await env.DB.prepare(
    'INSERT INTO prompt_libraries (name, scenario, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(name, scenario, 'draft', now, now)
    .run()
  const libraryId = Number(result.meta.last_row_id)
  const createdTemplates = []
  for (const rawTemplate of templates) {
    const template = templateInput(rawTemplate)
    if (template instanceof Response) return template
    const templateResult = await insertTemplate(env, libraryId, template, now)
    createdTemplates.push({ id: Number(templateResult.meta.last_row_id), ...template })
  }
  await recordAudit(env, { userId: actor.user.id }, 'prompts.library.import', 'prompt_library', String(libraryId), { name, scenario, rows: createdTemplates.length }, request)
  return json({ library: { id: libraryId, name, scenario, status: 'draft', templates: createdTemplates } }, { status: 201 })
}

export async function bulkUpdatePromptTemplates(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'prompts:write')
  if (actor instanceof Response) return actor
  const libraryId = libraryIdFromPath(request, 'templates/bulk')
  if (!Number.isInteger(libraryId) || libraryId <= 0) return badRequest('valid library id is required')
  const library = await env.DB.prepare('SELECT id, name, scenario, status, created_at, updated_at FROM prompt_libraries WHERE id = ? LIMIT 1')
    .bind(libraryId)
    .first<PromptLibraryRow>()
  if (!library) return json({ error: 'Not found' }, { status: 404 })

  const body = await readJsonObject(request)
  const rawTemplates = Array.isArray(body.templates) ? body.templates : []
  if (rawTemplates.length === 0) return badRequest('templates are required')

  const now = nowIso()
  const savedTemplates = []
  for (const rawTemplate of rawTemplates) {
    const input = rawTemplate && typeof rawTemplate === 'object' && !Array.isArray(rawTemplate) ? rawTemplate as Record<string, unknown> : {}
    const template = templateInput(input)
    if (template instanceof Response) return template
    const id = Number(input.id)
    if (Number.isInteger(id) && id > 0) {
      const update = await updateTemplateRecord(env, id, libraryId, template, now)
      if (Number(update.meta.changes ?? 0) === 0) return json({ error: 'Not found' }, { status: 404 })
      savedTemplates.push({ id, ...template })
    } else {
      const templateResult = await insertTemplate(env, libraryId, template, now)
      savedTemplates.push({ id: Number(templateResult.meta.last_row_id), ...template })
    }
  }
  await env.DB.prepare('UPDATE prompt_libraries SET status = ?, updated_at = ? WHERE id = ?')
    .bind('draft', now, libraryId)
    .run()
  await recordAudit(env, { userId: actor.user.id }, 'prompts.templates.bulk_update', 'prompt_library', String(libraryId), { rows: savedTemplates.length }, request)
  return json({ library_id: libraryId, templates: savedTemplates })
}

export async function exportPromptLibrary(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'prompts:read')
  if (actor instanceof Response) return actor
  const libraryId = libraryIdFromPath(request, 'export')
  if (!Number.isInteger(libraryId) || libraryId <= 0) return badRequest('valid library id is required')
  const library = await env.DB.prepare('SELECT id, name, scenario, status, created_at, updated_at FROM prompt_libraries WHERE id = ? LIMIT 1')
    .bind(libraryId)
    .first<PromptLibraryRow>()
  if (!library) return json({ error: 'Not found' }, { status: 404 })
  const { results: templates } = await env.DB.prepare(
    `SELECT ${TEMPLATE_COLUMNS}
     FROM prompt_templates
     WHERE library_id = ?
     ORDER BY COALESCE(field_order, 999999), id`,
  )
    .bind(libraryId)
    .all<PromptTemplateRow>()
  return json({
    library,
    templates: templates.map((template) => publicTemplate(template)),
  })
}

export async function updatePromptTemplate(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'prompts:write')
  if (actor instanceof Response) return actor
  const templateId = Number(new URL(request.url).pathname.match(/^\/api\/prompt-templates\/(\d+)$/)?.[1])
  if (!Number.isInteger(templateId) || templateId <= 0) return badRequest('valid template id is required')

  const existing = await env.DB.prepare(
    `SELECT ${TEMPLATE_COLUMNS}
     FROM prompt_templates
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(templateId)
    .first<PromptTemplateRow>()
  if (!existing) return json({ error: 'Not found' }, { status: 404 })

  const body = await readJsonObject(request)
  const merged = templateInput({
    group_name: body.group_name ?? existing.group_name,
    field_name: body.field_name ?? existing.field_name,
    source_field_id: body.source_field_id ?? existing.source_field_id,
    field_order: body.field_order ?? existing.field_order,
    visible: body.visible ?? Boolean(existing.visible),
    prompt_text: body.prompt_text ?? existing.prompt_text,
    size_label: body.size_label ?? existing.size_label,
    output_format: body.output_format ?? existing.output_format,
    quality: body.quality ?? existing.quality,
    reference_fields: body.reference_fields ?? parseStringArray(existing.reference_fields_json),
    word_count: body.word_count ?? existing.word_count,
    field_type: body.field_type ?? existing.field_type,
    female_priority: body.female_priority ?? priorityValue(existing.excel_meta_json, 'female_priority'),
    male_neutral_priority: body.male_neutral_priority ?? priorityValue(existing.excel_meta_json, 'male_neutral_priority'),
    category_rules: body.category_rules ?? parseStringArray(existing.category_rules_json),
    gender_rules: body.gender_rules ?? parseStringArray(existing.gender_rules_json),
    priority: body.priority ?? priorityFor(existing.priority_json),
    enabled: body.enabled ?? Boolean(existing.enabled),
  })
  if (merged instanceof Response) return merged

  const now = nowIso()
  const update = await env.DB.prepare(
    `UPDATE prompt_templates
     SET group_name = ?,
         field_name = ?,
         source_field_id = ?,
         field_order = ?,
         visible = ?,
         prompt_text = ?,
         size_label = ?,
         output_format = ?,
         quality = ?,
         reference_fields_json = ?,
         word_count = ?,
         field_type = ?,
         excel_meta_json = ?,
         category_rules_json = ?,
         gender_rules_json = ?,
         priority_json = ?,
         enabled = ?,
         updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      merged.group_name,
      merged.field_name,
      merged.source_field_id,
      merged.field_order,
      merged.visible ? 1 : 0,
      merged.prompt_text,
      merged.size_label,
      merged.output_format,
      merged.quality,
      toJson(merged.reference_fields),
      merged.word_count,
      merged.field_type,
      toJson(excelMetaFor(merged)),
      toJson(merged.category_rules),
      toJson(merged.gender_rules),
      toJson({ default: merged.priority }),
      merged.enabled,
      now,
      templateId,
    )
    .run()
  if (Number(update.meta.changes ?? 0) === 0) return json({ error: 'Not found' }, { status: 404 })
  await recordAudit(env, { userId: actor.user.id }, 'prompts.template.update', 'prompt_template', String(templateId), { templateId }, request)
  return json({ ok: true, template: { id: templateId, ...merged } })
}

export async function publishPromptLibrary(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'prompts:write')
  if (actor instanceof Response) return actor
  const libraryId = libraryIdFromPath(request, 'publish-version')
  if (!Number.isInteger(libraryId) || libraryId <= 0) return badRequest('valid library id is required')
  const library = await env.DB.prepare('SELECT id, name, scenario, status, created_at, updated_at FROM prompt_libraries WHERE id = ? LIMIT 1')
    .bind(libraryId)
    .first<PromptLibraryRow>()
  if (!library) return json({ error: 'Not found' }, { status: 404 })

  const { results: templates } = await env.DB.prepare(
    `SELECT ${TEMPLATE_COLUMNS}
     FROM prompt_templates
     WHERE library_id = ?
     ORDER BY id`,
  )
    .bind(libraryId)
    .all<PromptTemplateRow>()
  const enabledTemplates = templates.filter((template) => Boolean(template.enabled))
  const now = nowIso()
  const versionSet = []

  for (const template of enabledTemplates) {
    const versionRow = await env.DB.prepare('SELECT MAX(version_no) AS version_no FROM prompt_template_versions WHERE template_id = ?')
      .bind(template.id)
      .first<VersionNoRow>()
    const versionNo = Number(versionRow?.version_no || 0) + 1
    const snapshot = snapshotFor(template, versionNo, library.scenario)
    const versionResult = await env.DB.prepare(
      'INSERT INTO prompt_template_versions (template_id, version_no, snapshot_json, created_at, created_by) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(template.id, versionNo, toJson(snapshot), now, actor.user.id)
      .run()
    versionSet.push({
      template_id: template.id,
      version_id: Number(versionResult.meta.last_row_id),
      version_no: versionNo,
    })
  }

  await env.DB.prepare('UPDATE prompt_libraries SET status = ?, updated_at = ? WHERE id = ?')
    .bind('published', now, libraryId)
    .run()
  await recordAudit(env, { userId: actor.user.id }, 'prompts.library.publish', 'prompt_library', String(libraryId), { version_set: versionSet }, request)
  return json({ library_id: libraryId, version_set: versionSet })
}

export async function resolvePrompts(request: Request, env: Env): Promise<Response> {
  const actor = await requirePermission(request, env, 'prompts:read')
  if (actor instanceof Response) return actor
  const url = new URL(request.url)
  const libraryId = libraryIdFromPath(request, 'resolved')
  if (!Number.isInteger(libraryId) || libraryId <= 0) return badRequest('valid library id is required')
  const category = url.searchParams.get('category') || ''
  const gender = url.searchParams.get('gender') || ''
  const limit = limitFromSearch(url)

  const { results: templates } = await env.DB.prepare(
    `SELECT ${TEMPLATE_COLUMNS}
     FROM prompt_templates
     WHERE library_id = ?
     ORDER BY id`,
  )
    .bind(libraryId)
    .all<PromptTemplateRow>()

  const enabledTemplates = templates.filter((template) => Boolean(template.enabled))
  const latestVersions = await latestVersionsByTemplate(env, enabledTemplates.map((template) => template.id))
  const resolved = enabledTemplates
    .flatMap((template) => resolvedTemplateFor(template, latestVersions.get(template.id)))
    .filter((template) => matchesRules(template.category_rules, category) && matchesRules(template.gender_rules, gender))
    .sort((a, b) => a.priority - b.priority || a.template_id - b.template_id)
    .slice(0, limit)
    .map(({
      category_rules: _categoryRules,
      gender_rules: _genderRules,
      priority: _priority,
      source_field_id: _sourceFieldId,
      field_order: _fieldOrder,
      visible: _visible,
      reference_fields: _referenceFields,
      word_count: _wordCount,
      field_type: _fieldType,
      female_priority: _femalePriority,
      male_neutral_priority: _maleNeutralPriority,
      ...template
    }) => template)

  return json({ library_id: libraryId, templates: resolved })
}

async function insertTemplate(env: Env, libraryId: number, template: TemplateInput, now: string): Promise<D1Result> {
  return env.DB.prepare(
    `INSERT INTO prompt_templates
       (library_id, group_name, field_name, source_field_id, field_order, visible, prompt_text,
        size_label, output_format, quality, reference_fields_json, word_count, field_type, excel_meta_json,
        category_rules_json, gender_rules_json, priority_json, enabled, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      libraryId,
      template.group_name,
      template.field_name,
      template.source_field_id,
      template.field_order,
      template.visible ? 1 : 0,
      template.prompt_text,
      template.size_label,
      template.output_format,
      template.quality,
      toJson(template.reference_fields),
      template.word_count,
      template.field_type,
      toJson(excelMetaFor(template)),
      toJson(template.category_rules),
      toJson(template.gender_rules),
      toJson({ default: template.priority }),
      template.enabled,
      now,
    )
    .run()
}

async function updateTemplateRecord(env: Env, templateId: number, libraryId: number, template: TemplateInput, now: string): Promise<D1Result> {
  return env.DB.prepare(
    `UPDATE prompt_templates
     SET group_name = ?,
         field_name = ?,
         source_field_id = ?,
         field_order = ?,
         visible = ?,
         prompt_text = ?,
         size_label = ?,
         output_format = ?,
         quality = ?,
         reference_fields_json = ?,
         word_count = ?,
         field_type = ?,
         excel_meta_json = ?,
         category_rules_json = ?,
         gender_rules_json = ?,
         priority_json = ?,
         enabled = ?,
         updated_at = ?
     WHERE id = ?
       AND library_id = ?`,
  )
    .bind(
      template.group_name,
      template.field_name,
      template.source_field_id,
      template.field_order,
      template.visible ? 1 : 0,
      template.prompt_text,
      template.size_label,
      template.output_format,
      template.quality,
      toJson(template.reference_fields),
      template.word_count,
      template.field_type,
      toJson(excelMetaFor(template)),
      toJson(template.category_rules),
      toJson(template.gender_rules),
      toJson({ default: template.priority }),
      template.enabled,
      now,
      templateId,
      libraryId,
    )
    .run()
}

function templateInput(raw: unknown): TemplateInput | Response {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const groupName = typeof input.group_name === 'string' ? input.group_name.trim() : ''
  const fieldName = typeof input.field_name === 'string' ? input.field_name.trim() : ''
  const promptText = typeof input.prompt_text === 'string' ? input.prompt_text.trim() : ''
  if (!groupName || !fieldName || !promptText) return badRequest('group_name, field_name, and prompt_text are required')
  return {
    group_name: groupName,
    field_name: fieldName,
    source_field_id: stringInput(input.source_field_id),
    field_order: integerOrNull(input.field_order),
    visible: input.visible === false || input.visible === 0 ? false : true,
    prompt_text: promptText,
    size_label: typeof input.size_label === 'string' && input.size_label.trim() ? input.size_label.trim() : '960x1280',
    output_format: typeof input.output_format === 'string' && input.output_format.trim() ? input.output_format.trim() : 'jpeg',
    quality: typeof input.quality === 'string' && input.quality.trim() ? input.quality.trim() : 'auto',
    reference_fields: Array.isArray(input.reference_fields) ? arrayOfStrings(input.reference_fields) : splitReferenceFields(input.reference_fields),
    word_count: integerOrNull(input.word_count),
    field_type: stringInput(input.field_type),
    female_priority: integerOrNull(input.female_priority),
    male_neutral_priority: integerOrNull(input.male_neutral_priority),
    category_rules: arrayOfStrings(input.category_rules),
    gender_rules: arrayOfStrings(input.gender_rules),
    priority: integerOrDefault(input.priority ?? input.female_priority ?? input.male_neutral_priority, 100),
    enabled: input.enabled === false || input.enabled === 0 ? 0 : 1,
  }
}

function publicTemplate(template: PromptTemplateRow): Record<string, unknown> {
  return {
    id: template.id,
    library_id: template.library_id,
    group_name: template.group_name,
    field_name: template.field_name,
    source_field_id: stringFrom(template.source_field_id, ''),
    field_order: numberOrNull(template.field_order),
    visible: template.visible !== 0,
    prompt_text: template.prompt_text,
    size_label: template.size_label,
    output_format: template.output_format,
    quality: template.quality,
    reference_fields: parseStringArray(template.reference_fields_json),
    word_count: numberOrNull(template.word_count),
    field_type: stringFrom(template.field_type, ''),
    female_priority: priorityValue(template.excel_meta_json, 'female_priority'),
    male_neutral_priority: priorityValue(template.excel_meta_json, 'male_neutral_priority'),
    category_rules: parseStringArray(template.category_rules_json),
    gender_rules: parseStringArray(template.gender_rules_json),
    priority: priorityFor(template.priority_json),
    enabled: Boolean(template.enabled),
    updated_at: template.updated_at,
  }
}

function snapshotFor(template: PromptTemplateRow, versionNo: number, scenario: string): Record<string, unknown> {
  return {
    template_id: template.id,
    library_id: template.library_id,
    version_no: versionNo,
    group_name: template.group_name,
    field_name: template.field_name,
    source_field_id: stringFrom(template.source_field_id, ''),
    field_order: numberOrNull(template.field_order),
    visible: template.visible !== 0,
    prompt_text: template.prompt_text,
    size_label: template.size_label,
    output_format: template.output_format,
    quality: template.quality,
    reference_fields: parseStringArray(template.reference_fields_json),
    word_count: numberOrNull(template.word_count),
    field_type: stringFrom(template.field_type, ''),
    female_priority: priorityValue(template.excel_meta_json, 'female_priority'),
    male_neutral_priority: priorityValue(template.excel_meta_json, 'male_neutral_priority'),
    category_rules: parseStringArray(template.category_rules_json),
    gender_rules: parseStringArray(template.gender_rules_json),
    priority: priorityFor(template.priority_json),
    enabled: Boolean(template.enabled),
    scenario,
  }
}

async function latestVersionsByTemplate(env: Env, templateIds: number[]): Promise<Map<number, PromptTemplateVersionRow>> {
  const latest = new Map<number, PromptTemplateVersionRow>()
  if (templateIds.length === 0) return latest
  const placeholders = templateIds.map(() => '?').join(', ')
  const { results } = await env.DB.prepare(
    `SELECT id, template_id, version_no, snapshot_json, created_at, created_by
     FROM prompt_template_versions
     WHERE template_id IN (${placeholders})
     ORDER BY template_id, version_no DESC, id DESC`,
  )
    .bind(...templateIds)
    .all<PromptTemplateVersionRow>()
  for (const version of results) {
    if (!latest.has(version.template_id)) latest.set(version.template_id, version)
  }
  return latest
}

function resolvedTemplateFor(template: PromptTemplateRow, version?: PromptTemplateVersionRow): ResolvedTemplate[] {
  if (version) {
    const snapshot = fromJsonObject(version.snapshot_json)
    return [{
      template_id: numberFrom(snapshot.template_id, version.template_id),
      version_id: version.id,
      group_name: stringFrom(snapshot.group_name, template.group_name),
      field_name: stringFrom(snapshot.field_name, template.field_name),
      source_field_id: stringFrom(snapshot.source_field_id, stringFrom(template.source_field_id, '')),
      field_order: numberOrNull(snapshot.field_order ?? template.field_order),
      visible: snapshot.visible === false ? false : template.visible !== 0,
      prompt_text: stringFrom(snapshot.prompt_text, template.prompt_text),
      size_label: stringFrom(snapshot.size_label, template.size_label),
      output_format: stringFrom(snapshot.output_format, template.output_format),
      quality: stringFrom(snapshot.quality, template.quality),
      reference_fields: arrayOfStrings(snapshot.reference_fields),
      word_count: numberOrNull(snapshot.word_count ?? template.word_count),
      field_type: stringFrom(snapshot.field_type, stringFrom(template.field_type, '')),
      female_priority: numberOrNull(snapshot.female_priority ?? priorityValue(template.excel_meta_json, 'female_priority')),
      male_neutral_priority: numberOrNull(snapshot.male_neutral_priority ?? priorityValue(template.excel_meta_json, 'male_neutral_priority')),
      category_rules: arrayOfStrings(snapshot.category_rules),
      gender_rules: arrayOfStrings(snapshot.gender_rules),
      priority: integerOrDefault(snapshot.priority, priorityFor(template.priority_json)),
    }]
  }
  if (!template.enabled) return []
  return [{
    template_id: template.id,
    version_id: null,
    group_name: template.group_name,
    field_name: template.field_name,
    source_field_id: stringFrom(template.source_field_id, ''),
    field_order: numberOrNull(template.field_order),
    visible: template.visible !== 0,
    prompt_text: template.prompt_text,
    size_label: template.size_label,
    output_format: template.output_format,
    quality: template.quality,
    reference_fields: parseStringArray(template.reference_fields_json),
    word_count: numberOrNull(template.word_count),
    field_type: stringFrom(template.field_type, ''),
    female_priority: priorityValue(template.excel_meta_json, 'female_priority'),
    male_neutral_priority: priorityValue(template.excel_meta_json, 'male_neutral_priority'),
    category_rules: parseStringArray(template.category_rules_json),
    gender_rules: parseStringArray(template.gender_rules_json),
    priority: priorityFor(template.priority_json),
  }]
}

function matchesRules(rules: string[], value: string): boolean {
  return rules.length === 0 || !value || rules.includes(value)
}

function libraryIdFromPath(request: Request, suffix: string): number {
  return Number(new URL(request.url).pathname.match(new RegExp(`^/api/prompt-libraries/(\\d+)/${suffix}$`))?.[1])
}

function limitFromSearch(url: URL): number {
  const limit = Number(url.searchParams.get('limit') || 50)
  return Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 50
}

function parseStringArray(value: string): string[] {
  try {
    return arrayOfStrings(JSON.parse(value))
  } catch {
    return []
  }
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()) : []
}

function splitReferenceFields(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return value.split(/[,\n，、]/).map((item) => item.trim()).filter(Boolean)
}

function priorityFor(value: string): number {
  const priority = fromJsonObject(value).default
  return integerOrDefault(priority, 100)
}

function priorityValue(value: string, key: string): number | null {
  return integerOrNull(fromJsonObject(value)[key])
}

function excelMetaFor(template: TemplateInput): Record<string, unknown> {
  return {
    female_priority: template.female_priority,
    male_neutral_priority: template.male_neutral_priority,
  }
}

function integerOrDefault(value: unknown, fallback: number): number {
  const numberValue = Number(value)
  return Number.isInteger(numberValue) ? numberValue : fallback
}

function integerOrNull(value: unknown): number | null {
  const numberValue = Number(value)
  return Number.isInteger(numberValue) ? numberValue : null
}

function numberOrNull(value: unknown): number | null {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function stringInput(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stringFrom(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function numberFrom(value: unknown, fallback: number): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : fallback
}
