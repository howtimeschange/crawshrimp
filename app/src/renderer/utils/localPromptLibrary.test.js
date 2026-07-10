import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildCloudPromptLibraryPayload,
  normalizePromptLibrary,
  parsePromptWorkbookImportCandidates,
  parsePromptWorkbookSheets,
} from './localPromptLibrary.js'

test('parsePromptWorkbookSheets reads cloud prompt template sheets into local templates', () => {
  const templates = parsePromptWorkbookSheets({
    sheets: {
      裂变图: {
        rows: [
          {
            字段名: '正面标准站姿',
            '字段 ID': 'front_pose',
            字段顺序: '10',
            在当前视图: '是',
            尺寸: '2K',
            格式: 'jpeg',
            引用字段: '主图，参考图',
            描述内容: '保留商品主体与版型，生成测图主图。',
            字数: '80',
            字段类型: '长文本',
            女性优先度: '1',
            '男性/中性优先度': '3',
          },
        ],
      },
      创意拍摄: {
        rows: [
          {
            字段名: '场景棚拍',
            在当前视图: '否',
            描述内容: '生成干净的创意棚拍背景。',
          },
        ],
      },
    },
  })

  assert.equal(templates.length, 2)
  assert.deepEqual(templates[0], {
    local_uid: '',
    id: undefined,
    library_id: undefined,
    group_name: '裂变图',
    field_name: '正面标准站姿',
    source_field_id: 'front_pose',
    field_order: 10,
    visible: true,
    size_label: '2K',
    output_format: 'jpeg',
    quality: 'auto',
    reference_fields: ['主图', '参考图'],
    prompt_text: '保留商品主体与版型，生成测图主图。',
    word_count: 80,
    field_type: '长文本',
    female_priority: 1,
    male_neutral_priority: 3,
    category_rules: [],
    gender_rules: [],
    priority: 1,
    enabled: true,
    updated_at: '',
  })
  assert.equal(templates[1].group_name, '创意拍摄')
  assert.equal(templates[1].visible, false)
  assert.equal(templates[1].output_format, 'jpeg')
})

test('parsePromptWorkbookImportCandidates falls back to the first candidate with prompt rows', () => {
  const result = parsePromptWorkbookImportCandidates([
    {
      header_row: 4,
      workbook: {
        sheets: {
          上装: {
            headers: ['上装 字段描述'],
            rows: [
              { '上装 字段描述': 'Sheet ID：hERWDMS ｜ 记录数：233 ｜ AI 描述字段数：13' },
              { '上装 字段描述': '字段名' },
            ],
          },
        },
      },
    },
    {
      header_row: 3,
      workbook: {
        sheets: {
          上装: {
            rows: [
              {
                字段名: '正面标准站姿',
                '字段 ID': 'rX2NWyE',
                字段顺序: '4',
                在当前视图: '是',
                尺寸: '2K',
                格式: 'jpeg',
                引用字段: '图片 (ghzXVED)',
                描述内容: '引用图片，8K 超清，天猫电商童装主图。',
                字数: '24',
                字段类型: 'file',
              },
            ],
          },
        },
      },
    },
  ])

  assert.equal(result.header_row, 3)
  assert.equal(result.templates.length, 1)
  assert.equal(result.templates[0].group_name, '上装')
  assert.equal(result.templates[0].field_name, '正面标准站姿')
  assert.equal(result.templates[0].prompt_text, '引用图片，8K 超清，天猫电商童装主图。')
})

test('normalizePromptLibrary keeps local and cloud library source types distinct', () => {
  const local = normalizePromptLibrary({
    library_uid: 'local-1',
    name: '本地库',
    templates: [{ group_name: '上装', field_name: '正面', prompt_text: '本地 Prompt' }],
  })
  const cloud = normalizePromptLibrary({
    id: 7,
    source_type: 'cloud',
    name: '线上库',
    status: 'published',
    templates: [{ id: 70, group_name: '上装', field_name: '正面', prompt_text: '线上 Prompt' }],
  })

  assert.equal(local.source_type, 'local')
  assert.equal(local.library_type, 'local')
  assert.equal(local.library_uid, 'local-1')
  assert.equal(cloud.source_type, 'cloud')
  assert.equal(cloud.library_type, 'cloud')
  assert.equal(cloud.library_uid, 'cloud:7')
  assert.equal(cloud.cloud_library_id, 7)
})

test('buildPromptLibraryPickerLibraries combines local and cloud libraries for AI image confirmation', async () => {
  const helpers = await import('./localPromptLibrary.js')

  assert.equal(typeof helpers.buildPromptLibraryPickerLibraries, 'function')

  const libraries = helpers.buildPromptLibraryPickerLibraries({
    localLibraries: [
      {
        library_uid: 'local-1',
        name: '本地库',
        templates: [
          { local_uid: 'local-prompt-1', group_name: '上装', field_name: '正面图', prompt_text: '本地 Prompt' },
          { local_uid: 'local-prompt-off', group_name: '上装', field_name: '停用图', prompt_text: '停用 Prompt', enabled: false },
        ],
      },
    ],
    cloudLibraries: [
      {
        id: 7,
        name: '线上草稿库',
        status: 'draft',
        templates: [
          { id: 70, group_name: '上装', field_name: '草稿正面图', prompt_text: '线上草稿 Prompt' },
          { id: 71, group_name: '上装', field_name: '停用草稿图', prompt_text: '停用线上 Prompt', enabled: false },
        ],
      },
    ],
  })

  assert.deepEqual(libraries.map(library => ({
    id: library.id,
    picker_key: library.picker_key,
    name: library.name,
    source_type: library.source_type,
    source_label: library.source_label,
  })), [
    { id: 'local:local-1', picker_key: 'local:local-1', name: '本地库', source_type: 'local', source_label: '本地' },
    { id: 'cloud:7', picker_key: 'cloud:7', name: '线上草稿库', source_type: 'cloud', source_label: '线上' },
  ])
  assert.deepEqual(libraries[0].templates.map(template => ({
    template_id: template.template_id,
    field_name: template.field_name,
    prompt_text: template.prompt_text,
    source_type: template.source_type,
  })), [
    { template_id: 'local:local-1:local-prompt-1', field_name: '正面图', prompt_text: '本地 Prompt', source_type: 'local' },
  ])
  assert.equal(libraries[1].cloud_library_id, 7)
  assert.deepEqual(libraries[1].templates.map(template => ({
    template_id: template.template_id,
    field_name: template.field_name,
    prompt_text: template.prompt_text,
    source_type: template.source_type,
  })), [
    { template_id: 'cloud:7:70', field_name: '草稿正面图', prompt_text: '线上草稿 Prompt', source_type: 'cloud' },
  ])
})

test('buildCloudPromptLibraryPayload strips local metadata and keeps cloud-compatible template fields', () => {
  const library = normalizePromptLibrary({
    library_uid: 'local-1',
    name: '本地 AI 测图提示词库',
    scenario: '裂变图',
    cloud_library_id: 99,
    templates: [
      {
        local_uid: 'row-1',
        group_name: '上装',
        field_name: '正面图',
        prompt_text: '保留衣服版型。',
        reference_fields: '主图, 细节图',
        female_priority: 2,
        enabled: false,
      },
    ],
  })

  assert.deepEqual(buildCloudPromptLibraryPayload(library), {
    name: '本地 AI 测图提示词库',
    scenario: '裂变图',
    templates: [
      {
        group_name: '上装',
        field_name: '正面图',
        source_field_id: '',
        field_order: null,
        visible: true,
        prompt_text: '保留衣服版型。',
        size_label: '2K',
        output_format: 'jpeg',
        quality: 'auto',
        reference_fields: ['主图', '细节图'],
        word_count: null,
        field_type: '',
        female_priority: 2,
        male_neutral_priority: null,
        category_rules: [],
        gender_rules: [],
        priority: 2,
        enabled: false,
      },
    ],
  })
})
