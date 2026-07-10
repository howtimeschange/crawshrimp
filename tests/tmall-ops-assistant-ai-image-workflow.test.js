import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

async function loadExports() {
  const scriptPath = path.resolve('adapters/tmall-ops-assistant/tmall-ai-image-workflow.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const exportsBox = {}
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: {},
      __CRAWSHRIMP_PHASE__: '__exports__',
      __CRAWSHRIMP_SHARED__: {},
      __CRAWSHRIMP_EXPORTS__: exportsBox,
    },
    document: {},
    location: { href: 'https://myseller.taobao.com/home.htm/material-center/material-test/common_test' },
    URLSearchParams,
    console,
    Date,
    Math,
    JSON,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    Set,
    Map,
  }
  context.globalThis = context
  await vm.runInNewContext(source, context, { filename: scriptPath })
  return exportsBox
}

function readAsPromptLibraryAfterWrongHeaderImport() {
  return {
    sheets: {
      上装: {
        headers: [
          '上装 字段描述',
          '列2',
          '列3',
          '列4',
          '列5',
          '列6',
          '列7',
          '列8',
          '列9',
          '列10',
          '列11',
          '列12',
        ],
        rows: [
          {
            '上装 字段描述': 'Sheet ID：hERWDMS',
            列2: '',
            列3: '',
            列4: '',
            列5: '',
            列6: '',
            列7: '',
            列8: '',
            列9: '',
            列10: '',
            列11: '',
            列12: '',
          },
          {
            '上装 字段描述': '',
            列2: '',
            列3: '',
            列4: '',
            列5: '',
            列6: '',
            列7: '',
            列8: '',
            列9: '',
            列10: '',
            列11: '',
            列12: '',
          },
          {
            '上装 字段描述': '字段名',
            列2: '字段 ID',
            列3: '字段顺序',
            列4: '在当前视图',
            列5: '尺寸',
            列6: '格式',
            列7: '引用字段',
            列8: '描述内容',
            列9: '字数',
            列10: '字段类型',
            列11: '女性优先度',
            列12: '男性/中性优先度',
          },
          {
            '上装 字段描述': '正面标准站姿',
            列2: 'rX2NWyE',
            列3: '4',
            列4: '是',
            列5: '2K',
            列6: 'jpeg',
            列7: '图片 (ghzXVED)',
            列8: '引用图片，8K 超清，天猫电商童装主图，严格保留原有上衣图案',
            列9: '159',
            列10: 'file',
            列11: '1',
            列12: '8',
          },
          {
            '上装 字段描述': '街头潮酷风',
            列2: 'FaBxpfK',
            列3: '6',
            列4: '是',
            列5: '2K',
            列6: 'png',
            列7: '图片 (ghzXVED)',
            列8: '8K 超高清，天猫电商童装主图，潮流街头氛围感',
            列9: '346',
            列10: 'file',
            列11: '5',
            列12: '2',
          },
        ],
      },
    },
  }
}

test('normalizes prompt library sheets whose real header starts on row 4', async () => {
  const helpers = await loadExports()
  const prompts = helpers.normalizePromptLibrary(readAsPromptLibraryAfterWrongHeaderImport())

  assert.equal(prompts.length, 2)
  assert.equal(prompts[0].sheet_name, '上装')
  assert.equal(prompts[0].field_name, '正面标准站姿')
  assert.equal(prompts[0].size_label, '2K')
  assert.equal(prompts[0].output_format, 'jpeg')
  assert.match(prompts[0].prompt, /严格保留原有上衣图案/)
})

test('builds 1XM generation rows from workflow styles and prompt priorities', async () => {
  const helpers = await loadExports()
  const prompts = helpers.normalizePromptLibrary(readAsPromptLibraryAfterWrongHeaderImport())
  const workflow = helpers.normalizeWorkflowRows([
    {
      款号: '208326121203',
      天猫商品ID: '1060862679580',
      品类: '上装',
      性别: '女',
      素材图文件: '/tmp/source.png',
    },
  ])

  const result = helpers.buildGenerationRows(workflow.rows, prompts, {
    execute_mode: 'generate',
    image_size: 'from_prompt',
    output_format: 'from_prompt',
    quality: 'auto',
    max_prompts_per_style: 1,
    one_xm_key_tier: 'auto',
  })

  assert.equal(result.invalidRows.length, 0)
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].款号, '208326121203')
  assert.equal(result.rows[0].提示词字段名, '正面标准站姿')
  assert.equal(result.rows[0].尺寸, '2048x2048')
  assert.equal(result.rows[0].格式, 'jpeg')
  assert.equal(result.rows[0].执行结果, '待生成')
  assert.equal(result.rows[0].完整Prompt, result.rows[0].最终提示词)
  assert.equal(result.rows[0].__1xm_generate, true)
  assert.equal(result.rows[0].__1xm_key_tier, '2k')
  assert.equal(result.rows[0].__1xm_reference_paths[0], '/tmp/source.png')
  assert.match(result.rows[0].__1xm_idempotency_key, /^[\x20-\x7E]+$/)
  assert.deepEqual(JSON.parse(JSON.stringify(result.rows[0].__1xm_payload)), {
    model: 'gpt-image-2',
    prompt: result.rows[0].最终提示词,
    size: '2048x2048',
    quality: 'auto',
    output_format: 'jpeg',
    n: 1,
  })
  assert.match(result.rows[0].__1xm_idempotency_key, /^tmall_ai_208326121203_/)
})

test('manifest registers only the Bala full-chain AI image task with both import templates', () => {
  const manifest = fs.readFileSync(path.resolve('adapters/tmall-ops-assistant/manifest.yaml'), 'utf8')

  assert.doesNotMatch(manifest, /id: tmall_ai_image_generation/)
  assert.doesNotMatch(manifest, /script: tmall-ai-image-workflow\.js/)
  assert.doesNotMatch(manifest, /name: 天猫AI测图-1XM批量生图/)
  assert.match(manifest, /id: tmall_ai_image_test_chain/)
  assert.match(manifest, /name: 巴拉-AI测图全链路/)
  assert.match(manifest, /filename: "巴拉-AI测图全链路执行证据_\{timestamp\}\.xlsx"/)
  assert.match(manifest, /script: tmall-ai-image-test-chain\.js/)
  assert.match(manifest, /id: model_id[\s\S]*label: 生图模型[\s\S]*default: gpt-image-4k/)
  assert.match(manifest, /id: ratio[\s\S]*label: 比例[\s\S]*default: "3:4"/)
  assert.match(manifest, /id: image_size[\s\S]*label: 尺寸[\s\S]*default: 1536x2048/)
  assert.match(manifest, /id: generation_concurrency/)
  assert.match(manifest, /id: generation_concurrency[\s\S]*hidden: true/)
  assert.match(manifest, /default: 100/)
  assert.match(manifest, /id: one_xm_key_tier[\s\S]*default: 4k[\s\S]*hidden: true/)
  assert.match(manifest, /id: reference_mode/)
  assert.match(manifest, /value: main_only/)
  assert.match(manifest, /tmall-ai-image-test-workflow-template\.csv/)
  assert.match(manifest, /tmall-ai-prompt-library-template\.csv/)
})
