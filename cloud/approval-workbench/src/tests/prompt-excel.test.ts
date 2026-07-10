import { describe, expect, it } from 'vitest'
import { rowsToPromptTemplates } from '../app/promptExcel'

describe('prompt Excel mapping', () => {
  it('maps the row-4 header format from the AI prompt workbook', () => {
    const rows = [
      ['上装 字段描述'],
      ['Sheet ID：hERWDMS ｜ 记录数：233 ｜ AI 描述字段数：13'],
      [],
      ['字段名', '字段 ID', '字段顺序', '在当前视图', '尺寸', '格式', '引用字段', '描述内容', '字数', '字段类型', '女性优先度', '男性/中性优先度'],
      ['正面标准站姿', 'rX2NWyE', '4', '是', '2K', 'jpeg', '图片 (ghzXVED)', '引用图片，8K 超清', '159', 'file', '1', '2'],
    ]
    const templates = rowsToPromptTemplates('上装', rows)
    expect(templates[0]).toMatchObject({
      group_name: '上装',
      field_name: '正面标准站姿',
      source_field_id: 'rX2NWyE',
      prompt_text: '引用图片，8K 超清',
      size_label: '2K',
      output_format: 'jpeg',
      female_priority: 1,
      male_neutral_priority: 2,
    })
  })
})
