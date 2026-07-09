import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildCloudPromptLibraryPayload,
  normalizePromptLibrary,
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
