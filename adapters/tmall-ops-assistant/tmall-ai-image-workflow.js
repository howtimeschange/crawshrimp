;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'init'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const WORKFLOW_CODE_ALIASES = ['款号', '编码', '货号', '款号/编码', '款号/款色号', '款号/款色编码', 'spu', 'stylecode']
  const ITEM_ID_ALIASES = ['ID（用于测图的ID）', '测图ID', '天猫商品ID', '商品ID', '宝贝ID', 'itemId', 'item_id']
  const CATEGORY_ALIASES = ['品类（后期匹配）', '品类', '类目', '提示词分组', 'promptSheet', 'prompt_sheet']
  const GENDER_ALIASES = ['模特性别', '性别', '男女', '性别偏好', 'gender']
  const PROMPT_NAME_ALIASES = ['提示词字段名', '提示词名称', '字段名', 'promptName', 'prompt_name']
  const MATERIAL_PATH_ALIASES = ['素材图文件', '参考图文件', '本地素材图', '本地参考图', '图片路径', 'image_path']
  const MATERIAL_URL_ALIASES = ['素材图URL', '参考图URL', '图片URL', 'image_url']
  const COUNT_ALIASES = ['生成数量', '张数', 'n']

  function compact(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim()
  }

  function normalizeKey(value) {
    return compact(value).toLowerCase().replace(/[\s_./\\\-：:（）()]+/g, '')
  }

  function parseListInput(value) {
    if (Array.isArray(value)) return value.map(compact).filter(Boolean)
    return String(value || '')
      .split(/[\n\r,，、；;]+/)
      .map(compact)
      .filter(Boolean)
  }

  function rowEntries(row) {
    if (!row || typeof row !== 'object') return []
    return Object.entries(row).map(([key, value]) => ({
      rawKey: String(key || ''),
      key: normalizeKey(key),
      value: compact(value),
    }))
  }

  function rowValue(row, aliases) {
    const aliasSet = new Set((Array.isArray(aliases) ? aliases : []).map(normalizeKey))
    const found = rowEntries(row).find(entry => aliasSet.has(entry.key) && entry.value)
    return found ? found.value : ''
  }

  function normalizeNumber(value, fallback = 0) {
    const number = Number(compact(value))
    return Number.isFinite(number) ? number : fallback
  }

  function toSafeToken(value, fallback = 'item') {
    const original = compact(value)
    const text = original
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/[^A-Za-z0-9._~-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
    if (text) return text
    return `${fallback}_${stableHash(original)}`
  }

  function stableHash(value) {
    const text = String(value || '')
    let hash = 2166136261
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(16).padStart(8, '0')
  }

  function isTruthy(value) {
    if (value === true) return true
    const text = compact(value).toLowerCase()
    return ['1', 'true', 'yes', 'y', '是', '启用', '生成'].includes(text)
  }

  function normalizeOutputFormat(value, fallback = 'png') {
    const text = compact(value).toLowerCase()
    if (['jpg', 'jpeg'].includes(text)) return 'jpeg'
    if (['png', 'webp'].includes(text)) return text
    return fallback
  }

  function sizeFromLabel(value, fallback = '1024x1024') {
    const text = compact(value)
    if (/^\d{3,5}x\d{3,5}$/i.test(text)) return text.toLowerCase()
    if (/4k/i.test(text)) return '3840x2160'
    if (/2k/i.test(text)) return '2048x2048'
    if (/1k|1024/i.test(text)) return '1024x1024'
    return fallback
  }

  function keyTierFromSize(size, requested = 'auto') {
    const explicit = compact(requested).toLowerCase()
    if (explicit === '2k' || explicit === '4k') return explicit
    const match = compact(size).match(/^(\d+)x(\d+)$/i)
    if (!match) return '2k'
    return Math.max(Number(match[1]), Number(match[2])) > 2048 ? '4k' : '2k'
  }

  function complete(data = [], newShared = shared) {
    return {
      success: true,
      data,
      meta: {
        action: 'complete',
        has_more: false,
        shared: newShared,
      },
    }
  }

  function normalizeWorkflowRows(rows = [], options = {}) {
    const normalized = []
    const invalidRows = []
    const sourceRows = Array.isArray(rows) ? rows : []

    for (const [index, row] of sourceRows.entries()) {
      const styleCode = rowValue(row, WORKFLOW_CODE_ALIASES)
      const itemId = rowValue(row, ITEM_ID_ALIASES)
      const rowNo = Number(row?.__row_no || index + 2)
      if (!styleCode) {
        invalidRows.push({
          表格行号: rowNo,
          款号: '',
          商品ID: itemId,
          执行结果: '参数缺失',
          备注: '缺少款号',
        })
        continue
      }

      normalized.push({
        row_no: rowNo,
        style_code: styleCode,
        item_id: itemId,
        category: rowValue(row, CATEGORY_ALIASES) || compact(options.default_category),
        gender: rowValue(row, GENDER_ALIASES) || compact(options.default_gender),
        prompt_name: rowValue(row, PROMPT_NAME_ALIASES),
        material_paths: parseListInput(rowValue(row, MATERIAL_PATH_ALIASES)),
        material_urls: parseListInput(rowValue(row, MATERIAL_URL_ALIASES)),
        count: Math.max(1, normalizeNumber(rowValue(row, COUNT_ALIASES), 1)),
        raw: row,
      })
    }

    if (!normalized.length && compact(options.fallback_style_code)) {
      normalized.push({
        row_no: 2,
        style_code: compact(options.fallback_style_code),
        item_id: compact(options.fallback_item_id),
        category: compact(options.default_category),
        gender: compact(options.default_gender),
        prompt_name: compact(options.default_prompt_name),
        material_paths: parseListInput(options.material_paths),
        material_urls: parseListInput(options.material_urls),
        count: Math.max(1, normalizeNumber(options.count, 1)),
        raw: {},
      })
    }

    return { rows: normalized, invalidRows }
  }

  function rowToCellArray(row, headers) {
    return (Array.isArray(headers) ? headers : []).map(header => row?.[header] ?? '')
  }

  function tableToRawRows(table) {
    const headers = Array.isArray(table?.headers) ? table.headers : []
    const rows = Array.isArray(table?.rows) ? table.rows : []
    if (!headers.length && !rows.length) return []
    return [
      headers,
      ...rows.map(row => rowToCellArray(row, headers)),
    ]
  }

  function normalizeHeaderRow(rawRows) {
    const rows = Array.isArray(rawRows) ? rawRows : []
    const headerIndex = rows.findIndex(row => {
      const values = (Array.isArray(row) ? row : []).map(normalizeKey)
      return values.includes(normalizeKey('字段名')) && values.includes(normalizeKey('描述内容'))
    })
    if (headerIndex < 0) return { headers: [], rows: [] }
    const headers = rows[headerIndex].map(value => compact(value) || '')
    const dataRows = []
    for (const raw of rows.slice(headerIndex + 1)) {
      if (!Array.isArray(raw) || raw.every(value => !compact(value))) continue
      const row = {}
      headers.forEach((header, index) => {
        row[header || `列${index + 1}`] = compact(raw[index])
      })
      dataRows.push(row)
    }
    return { headers, rows: dataRows }
  }

  function normalizePromptLibrary(promptFile = {}, options = {}) {
    const sheets = promptFile?.sheets && typeof promptFile.sheets === 'object'
      ? promptFile.sheets
      : {
          [promptFile?.sheet_name || 'Sheet1']: {
            headers: promptFile?.headers || [],
            rows: promptFile?.rows || [],
          },
        }
    const prompts = []

    for (const [sheetName, table] of Object.entries(sheets)) {
      const hasDirectHeader = (table?.headers || []).some(header => normalizeKey(header) === normalizeKey('描述内容'))
      const parsedTable = hasDirectHeader
        ? { headers: table.headers || [], rows: table.rows || [] }
        : normalizeHeaderRow(tableToRawRows(table))

      for (const [index, row] of (parsedTable.rows || []).entries()) {
        const fieldName = rowValue(row, ['字段名'])
        const prompt = rowValue(row, ['描述内容', '提示词', 'prompt'])
        if (!fieldName || !prompt) continue
        const inView = rowValue(row, ['在当前视图'])
        if (!isTruthy(options.include_hidden_prompts) && inView && !/^是|true|1$/i.test(inView)) continue
        prompts.push({
          sheet_name: compact(sheetName),
          field_name: fieldName,
          field_id: rowValue(row, ['字段 ID', '字段ID']),
          field_order: normalizeNumber(rowValue(row, ['字段顺序']), index + 1),
          size_label: rowValue(row, ['尺寸']) || compact(options.default_size_label),
          output_format: normalizeOutputFormat(rowValue(row, ['格式']), 'png'),
          reference_field: rowValue(row, ['引用字段']),
          prompt,
          word_count: normalizeNumber(rowValue(row, ['字数']), 0),
          field_type: rowValue(row, ['字段类型']),
          female_priority: normalizeNumber(rowValue(row, ['女性优先度']), 0),
          neutral_priority: normalizeNumber(rowValue(row, ['男性/中性优先度', '男性优先度', '中性优先度']), 0),
          raw: row,
        })
      }
    }

    return prompts
  }

  function promptMatchesWorkflow(prompt, workflow, options = {}) {
    const requestedNames = parseListInput(workflow.prompt_name || options.prompt_names)
    if (requestedNames.length && !requestedNames.some(name => compact(name) === prompt.field_name)) return false
    const group = compact(workflow.category || options.prompt_sheet)
    if (!group) return true
    return prompt.sheet_name === group || prompt.field_name.includes(group)
  }

  function promptSortKey(prompt, workflow = {}) {
    const gender = compact(workflow.gender).toLowerCase()
    const priority = /女|female|girl/.test(gender) ? prompt.female_priority : prompt.neutral_priority
    const normalizedPriority = priority > 0 ? priority : 9999
    return [normalizedPriority, prompt.field_order || 9999, prompt.field_name]
  }

  function comparePrompts(a, b, workflow) {
    const left = promptSortKey(a, workflow)
    const right = promptSortKey(b, workflow)
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] < right[index]) return -1
      if (left[index] > right[index]) return 1
    }
    return 0
  }

  function buildPromptText(prompt, workflow) {
    const metadata = [
      workflow.style_code ? `款号=${workflow.style_code}` : '',
      workflow.item_id ? `天猫商品ID=${workflow.item_id}` : '',
      workflow.category ? `品类=${workflow.category}` : '',
      workflow.gender ? `性别=${workflow.gender}` : '',
    ].filter(Boolean)
    const suffix = metadata.length ? `\n\n商品属性：${metadata.join('；')}` : ''
    return `${prompt.prompt}${suffix}`
      .replace(/\{\{款号\}\}/g, workflow.style_code || '')
      .replace(/\{\{商品ID\}\}/g, workflow.item_id || '')
      .replace(/\{\{品类\}\}/g, workflow.category || '')
      .replace(/\{\{性别\}\}/g, workflow.gender || '')
  }

  function buildGenerationRows(workflowRows = [], prompts = [], options = {}) {
    const rows = []
    const invalidRows = []
    const executeMode = compact(options.execute_mode || 'plan').toLowerCase()
    const shouldGenerate = executeMode === 'generate'
    const maxPrompts = Math.max(1, normalizeNumber(options.max_prompts_per_style, 1))
    const defaultSize = sizeFromLabel(options.default_size || options.image_size || '1024x1024', '1024x1024')
    const requestedFormat = compact(options.output_format || 'from_prompt').toLowerCase()

    for (const workflow of Array.isArray(workflowRows) ? workflowRows : []) {
      const matched = prompts
        .filter(prompt => promptMatchesWorkflow(prompt, workflow, options))
        .sort((a, b) => comparePrompts(a, b, workflow))
        .slice(0, maxPrompts)

      if (!matched.length) {
        invalidRows.push({
          表格行号: workflow.row_no,
          款号: workflow.style_code,
          商品ID: workflow.item_id,
          品类: workflow.category,
          执行结果: '未匹配到提示词',
          备注: workflow.category ? `提示词库中未找到分组：${workflow.category}` : '未填写品类/提示词分组，且未命中默认提示词',
        })
        continue
      }

      matched.forEach((prompt, promptIndex) => {
        const size = compact(options.image_size) === 'from_prompt'
          ? sizeFromLabel(prompt.size_label, defaultSize)
          : sizeFromLabel(options.image_size || prompt.size_label, defaultSize)
        const outputFormat = requestedFormat === 'from_prompt'
          ? normalizeOutputFormat(prompt.output_format, 'png')
          : normalizeOutputFormat(requestedFormat, normalizeOutputFormat(prompt.output_format, 'png'))
        const finalPrompt = buildPromptText(prompt, workflow)
        const idempotencyBase = [
          workflow.style_code,
          prompt.sheet_name,
          prompt.field_name,
          size,
          outputFormat,
          stableHash(finalPrompt),
        ].map(value => toSafeToken(value, 'x')).join('_')
        const idempotencyKey = `tmall_ai_${idempotencyBase}`.slice(0, 180)
        rows.push({
          表格行号: workflow.row_no,
          款号: workflow.style_code,
          商品ID: workflow.item_id,
          品类: workflow.category,
          性别: workflow.gender,
          提示词分组: prompt.sheet_name,
          提示词字段名: prompt.field_name,
          尺寸: size,
          格式: outputFormat,
          质量: compact(options.quality || 'auto'),
          参考图文件: workflow.material_paths.join('\n'),
          参考图URL: workflow.material_urls.join('\n'),
          最终提示词: finalPrompt,
          完整Prompt: finalPrompt,
          '1XM任务ID': '',
          '1XM轮询URL': '',
          生成图URL: '',
          生成图数量: '',
          执行结果: shouldGenerate ? '待生成' : '已生成计划',
          备注: shouldGenerate ? '等待后端 1XM 异步任务生成' : '计划模式未调用 1XM',
          __1xm_generate: shouldGenerate,
          __1xm_key_tier: keyTierFromSize(size, options.one_xm_key_tier),
          __1xm_idempotency_key: idempotencyKey,
          __1xm_reference_paths: workflow.material_paths,
          __1xm_reference_urls: workflow.material_urls,
          __1xm_prompt_index: promptIndex,
          __1xm_payload: {
            model: 'gpt-image-2',
            prompt: finalPrompt,
            size,
            quality: compact(options.quality || 'auto'),
            output_format: outputFormat,
            n: Math.max(1, normalizeNumber(workflow.count || options.n, 1)),
          },
        })
      })
    }

    return { rows, invalidRows }
  }

  function exposeHelpers() {
    if (!testExports || typeof testExports !== 'object') return
    Object.assign(testExports, {
      normalizeWorkflowRows,
      normalizePromptLibrary,
      buildPromptText,
      buildGenerationRows,
      sizeFromLabel,
      keyTierFromSize,
    })
  }

  exposeHelpers()

  if (phase === '__exports__') {
    return complete([], shared)
  }

  try {
    const workflow = normalizeWorkflowRows(params?.workflow_file?.rows || [], {
      fallback_style_code: params.style_code,
      fallback_item_id: params.item_id,
      default_category: params.prompt_sheet || params.category,
      default_gender: params.gender,
      default_prompt_name: params.prompt_names,
      material_paths: params?.material_images_paths || params?.material_images?.paths || params?.material_paths || params?.material_images_paths,
      material_urls: params.material_urls,
      count: params.n,
    })
    const prompts = normalizePromptLibrary(params.prompt_file || {}, {
      prompt_sheet: params.prompt_sheet,
      include_hidden_prompts: params.include_hidden_prompts,
    })
    const built = buildGenerationRows(workflow.rows, prompts, params)
    const data = [
      ...workflow.invalidRows,
      ...built.invalidRows,
      ...built.rows,
    ]
    const total = Math.max(1, built.rows.length + built.invalidRows.length + workflow.invalidRows.length)

    return complete(data, {
      ...shared,
      total_rows: total,
      current_exec_no: total,
      current_buyer_id: workflow.rows[0]?.style_code || '',
      current_row_no: workflow.rows[0]?.row_no || 0,
      current_store: params.execute_mode === 'generate' ? '1XM 生图计划已生成' : '1XM 计划模式',
      generation_total_jobs: built.rows.length,
      generation_completed_jobs: 0,
    })
  } catch (error) {
    return {
      success: false,
      error: String(error?.message || error || '天猫 AI 测图生图任务失败'),
    }
  }
})()
