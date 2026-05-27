;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const API_BASE = 'https://ai-platform-api.semir.com'
  const UPLOAD_INPUT_ID = 'crawshrimp-dasen-upload-input'
  const UPLOAD_INPUT_SELECTOR = `#${UPLOAD_INPUT_ID}`
  const VALUE_TYPES = ['提效', '增收', '降本', '其他']
  const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])
  const DOC_EXTS = new Set(['pdf', 'ppt', 'pptx'])
  const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'webm', 'mkv', 'm4v'])
  const CLEAR_TOKENS = new Set(['__clear__', '__empty__', '__blank__', '__清空__', '<清空>', '（清空）', '(清空)', '清空'])

  const FIELD_ALIASES = Object.freeze({
    caseId: ['案例ID', '案例 Id', '案例 id', 'caseId', 'case_id', 'id'],
    editUrl: ['编辑页链接', '案例链接', '详情链接', 'URL', 'url'],
    name: ['案例名称', '名称', '案例名', 'case name', 'name'],
    iconPath: ['封面图路径', '封面路径', '封面图', 'icon', 'iconUrl'],
    category: ['案例类型', '类型', '案例分类', 'category', 'categoryCode', 'appCategory'],
    useLink: ['使用链接', '在线使用地址', '应用链接', 'useLink'],
    downloadLink: ['下载链接', '安装包下载地址', 'downloadLink'],
    aiTeam: ['所属AI纵队', '所属 AI 纵队', 'AI纵队', 'aiTeam'],
    dept: ['所属部门', '钉钉部门', '部门', 'dept', 'dingDeptId'],
    description: ['案例描述', '描述', 'description'],
    instructions: ['案例说明', '使用说明', '正文', 'instructions', 'useDescription'],
    developers: ['案例开发者', '开发者', 'developer', 'developers'],
    skills: ['涉及技能', '技能', 'skill', 'skills', 'skillIds'],
    positions: ['可复用岗位', '复用岗位', '岗位', 'positionNames'],
    frequency: ['使用频次', '频次', 'frequency'],
    valueTypes: ['价值分类', '价值类型', '价值类别', 'valueTypes'],
    originalHours: ['原工时', '原始工时', '人工工时', 'originalHours', 'originalTime'],
    currentHours: ['现工时', '当前工时', 'AI工时', 'currentHours', 'currentTime'],
    revenueAmount: ['增收金额', '增收', 'revenueAmount'],
    costAmount: ['降低成本', '降本金额', '降本', 'costAmount'],
    otherDesc: ['其他介绍', '其他价值', 'otherDesc'],
    documentPaths: ['操作文档路径', '文档路径', '操作文档', 'documents'],
    videoPaths: ['视频路径', '视频介绍', '视频文件', 'videos'],
    dingTalkContact: ['钉钉联系人', '钉钉号', '联系人', 'dingTalkContact'],
  })

  const EDIT_FIELD_LABELS = Object.freeze({
    name: '案例名称',
    iconPath: '封面图路径',
    category: '案例类型',
    useLink: '使用链接',
    downloadLink: '下载链接',
    aiTeam: '所属AI纵队',
    dept: '所属部门',
    description: '案例描述',
    instructions: '案例说明',
    developers: '案例开发者',
    skills: '涉及技能',
    positions: '可复用岗位',
    frequency: '使用频次',
    valueTypes: '价值分类',
    originalHours: '原工时',
    currentHours: '现工时',
    revenueAmount: '增收金额',
    costAmount: '降低成本',
    otherDesc: '其他介绍',
    documentPaths: '操作文档路径',
    videoPaths: '视频路径',
    dingTalkContact: '钉钉联系人',
  })

  const EDITABLE_KEYS = Object.freeze(Object.keys(EDIT_FIELD_LABELS))

  function compact(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  }

  function cleanText(value) {
    return String(value == null ? '' : value).trim()
  }

  function cleanPath(value) {
    return cleanText(value).replace(/^['"]|['"]$/g, '')
  }

  function normalizeHeader(value) {
    return compact(value)
      .toLowerCase()
      .replace(/[\s_./\\\-：:（）()【】\[\]{}]+/g, '')
  }

  function getRowEntries(row) {
    if (!row || typeof row !== 'object') return []
    return Object.entries(row)
      .filter(([key]) => key != null && String(key).trim())
      .map(([key, value]) => ({ key, normalizedKey: normalizeHeader(key), value }))
  }

  function pickRowValue(row, aliases) {
    const aliasSet = new Set((aliases || []).map(normalizeHeader))
    const entry = getRowEntries(row).find(item => aliasSet.has(item.normalizedKey))
    return entry ? cleanText(entry.value) : ''
  }

  function pickRowEntry(row, aliases) {
    const aliasSet = new Set((aliases || []).map(normalizeHeader))
    return getRowEntries(row).find(item => aliasSet.has(item.normalizedKey)) || null
  }

  function isClearToken(value) {
    const text = cleanText(value).toLowerCase()
    return CLEAR_TOKENS.has(text)
  }

  function hasPatchValue(value) {
    return Boolean(cleanText(value)) || isClearToken(value)
  }

  function parseCaseId(value) {
    const text = cleanText(value)
    if (!text) return ''
    const queryMatch = text.match(/[?&]id=(\d{8,})\b/)
    if (queryMatch) return queryMatch[1]
    const plainMatch = text.match(/\b\d{8,}\b/)
    return plainMatch ? plainMatch[0] : ''
  }

  function pickCaseId(row) {
    return parseCaseId(pickRowValue(row, FIELD_ALIASES.caseId)) || parseCaseId(pickRowValue(row, FIELD_ALIASES.editUrl))
  }

  function buildEditPageUrl(caseId) {
    return caseId ? `https://ai.semir.com/console/studio/showcase/create/?id=${caseId}` : ''
  }

  function isBlankRow(row) {
    if (!row || typeof row !== 'object') return true
    return !Object.values(row).some(value => cleanText(value))
  }

  function splitMultiValues(value) {
    if (Array.isArray(value)) {
      return value.map(cleanPath).filter(Boolean)
    }
    return cleanText(value)
      .split(/\r?\n|[；;|]+/g)
      .map(cleanPath)
      .filter(Boolean)
  }

  function basename(value) {
    const text = cleanPath(value).split(/[?#]/)[0].replace(/\\/g, '/')
    return text.split('/').filter(Boolean).pop() || text || ''
  }

  function extensionOf(value) {
    const name = basename(value)
    const index = name.lastIndexOf('.')
    return index >= 0 ? name.slice(index + 1).toLowerCase() : ''
  }

  function isHttpUrl(value) {
    return /^https?:\/\//i.test(cleanText(value))
  }

  function isProbablyLocalPath(value) {
    const text = cleanPath(value)
    return /^~?\//.test(text) || /^[a-zA-Z]:[\\/]/.test(text)
  }

  function isNumericText(value) {
    return /^-?\d+(?:\.\d+)?$/.test(cleanText(value).replace(/,/g, ''))
  }

  function toNumberOrNull(value) {
    const text = cleanText(value).replace(/,/g, '')
    if (!text) return null
    const matched = text.match(/-?\d+(?:\.\d+)?/)
    if (!matched) return null
    const number = Number(matched[0])
    return Number.isFinite(number) ? number : null
  }

  function roundNumber(value) {
    const number = Number(value)
    if (!Number.isFinite(number)) return 0
    return Math.round(number * 10000) / 10000
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function stripHtml(value) {
    return cleanText(value)
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function normalizeInstructions(value) {
    const text = cleanText(value)
    if (!text) return ''
    if (/<[a-z][\s\S]*>/i.test(text)) return text
    return text
      .split(/\r?\n+/)
      .map(line => cleanText(line))
      .filter(Boolean)
      .map(line => `<p>${escapeHtml(line)}</p>`)
      .join('')
  }

  function normalizeCompareText(value) {
    return cleanText(value).slice(0, 200)
  }

  function extractList(raw) {
    const candidates = [
      raw,
      raw?.list,
      raw?.records,
      raw?.rows,
      raw?.items,
      raw?.data,
      raw?.data?.list,
      raw?.data?.records,
      raw?.data?.rows,
      raw?.data?.items,
    ]
    const list = candidates.find(Array.isArray)
    return Array.isArray(list) ? list : []
  }

  function normalizeCategoryItems(raw) {
    return extractList(raw)
      .map(item => ({
        categoryCode: cleanText(item?.categoryCode || item?.code || item?.value || item?.id).toUpperCase(),
        name: cleanText(item?.name || item?.label || item?.title),
        raw: item,
      }))
      .filter(item => item.categoryCode && item.name)
  }

  function normalizeAiTeamItems(raw) {
    return extractList(raw)
      .map(item => ({
        name: cleanText(item?.name || item?.label || item?.value || item),
        value: cleanText(item?.value || item?.name || item?.label || item),
        raw: item,
      }))
      .filter(item => item.name)
  }

  function normalizeDeveloperItems(raw) {
    return extractList(raw)
      .map(item => ({
        userId: cleanText(item?.userId || item?.id || item?.value || item?.user_id),
        userName: cleanText(item?.userName || item?.name || item?.label || item?.nickName),
        phone: cleanText(item?.phone || item?.mobile || item?.telephone),
        dept: cleanText(item?.dept || item?.deptName || item?.department),
        raw: item,
      }))
      .filter(item => item.userId || item.userName)
  }

  function normalizeSkillItems(raw) {
    return extractList(raw)
      .map(item => ({
        id: cleanText(item?.id || item?.skillId || item?.value),
        name: cleanText(item?.name || item?.skillName || item?.label),
        raw: item,
      }))
      .filter(item => item.id || item.name)
  }

  function getDeptChildren(node) {
    return node?.children || node?.childList || node?.deptList || node?.childrenList || []
  }

  function normalizeDeptId(id) {
    const text = cleanText(id)
    if (!text) return ''
    if (/^\d+$/.test(text)) {
      const number = Number(text)
      return Number.isSafeInteger(number) ? number : text
    }
    return text
  }

  function flattenDepartmentTree(raw) {
    const roots = extractList(raw)
    const rows = []

    function visit(node, ancestors) {
      if (!node || typeof node !== 'object') return
      const id = cleanText(node.deptId || node.id || node.value || node.dingDeptId)
      const name = cleanText(node.deptName || node.name || node.label || node.title)
      if (!id && !name) return

      const pathNodes = [...ancestors, { id, name }].filter(item => item.id || item.name)
      const pathNames = pathNodes.map(item => item.name).filter(Boolean)
      const idPath = pathNodes.map(item => item.id).filter(Boolean)
      if (id && name) {
        rows.push({
          id,
          payloadId: normalizeDeptId(id),
          name,
          path: pathNames.join(' / '),
          dingDeptIdChain: idPath.slice().reverse().join(','),
          raw: node,
        })
      }

      for (const child of getDeptChildren(node)) {
        visit(child, pathNodes)
      }
    }

    roots.forEach(root => visit(root, []))
    return rows
  }

  function normalizeFlatDepartmentRows(rawRows) {
    const sourceRows = Array.isArray(rawRows) ? rawRows : []
    const byId = new Map()
    sourceRows.forEach(item => {
      const id = cleanText(item?.id || item?.deptId || item?.value || item?.dingDeptId)
      if (id) byId.set(id, item)
    })

    function buildChainIds(item) {
      if (item?.dingDeptIdChain || item?.idChain) return cleanText(item.dingDeptIdChain || item.idChain)
      const ids = []
      let cursor = item
      const seen = new Set()
      while (cursor) {
        const id = cleanText(cursor.id || cursor.deptId || cursor.value || cursor.dingDeptId)
        if (!id || seen.has(id)) break
        ids.push(id)
        seen.add(id)
        const parentId = cleanText(cursor.parentId || cursor.parentDeptId || cursor.pid)
        cursor = parentId ? byId.get(parentId) : null
      }
      return ids.join(',')
    }

    return sourceRows
      .map(item => {
        const id = cleanText(item?.id || item?.deptId || item?.value || item?.dingDeptId)
        const name = cleanText(item?.name || item?.deptName || item?.label || item?.title)
        const path = cleanText(item?.path || item?.namePath || name)
        return {
          id,
          payloadId: item?.payloadId != null ? item.payloadId : normalizeDeptId(id),
          name,
          path,
          dingDeptIdChain: buildChainIds(item),
          raw: item?.raw || item,
        }
      })
      .filter(item => item.id && item.name)
  }

  function normalizeDepartmentSource(rawValue) {
    if (Array.isArray(rawValue)) {
      const hasTreeChildren = rawValue.some(item => Array.isArray(getDeptChildren(item)) && getDeptChildren(item).length)
      return hasTreeChildren ? flattenDepartmentTree(rawValue) : normalizeFlatDepartmentRows(rawValue)
    }
    return flattenDepartmentTree(rawValue)
  }

  function normalizeCatalogs(rawCatalogs = {}) {
    const departmentSource = rawCatalogs.departments || rawCatalogs.deptRows || rawCatalogs.deptTree || []
    return {
      categories: normalizeCategoryItems(rawCatalogs.categories || rawCatalogs.categoryList || []),
      aiTeams: normalizeAiTeamItems(rawCatalogs.aiTeams || rawCatalogs.aiTeamList || []),
      departments: normalizeDepartmentSource(departmentSource),
    }
  }

  function normalizeLookupText(value) {
    return compact(value).replace(/[：:]/g, '').toLowerCase()
  }

  function resolveCategory(value, categories) {
    const text = cleanText(value)
    if (!text) return { error: '案例类型必填' }
    const code = (text.match(/PL\d+/i) || [])[0]?.toUpperCase() || text.toUpperCase()
    const byCode = categories.find(item => item.categoryCode.toUpperCase() === code)
    if (byCode) return byCode

    const stripped = text.replace(/^PL\d+\s*/i, '')
    const normalized = normalizeLookupText(stripped)
    const byName = categories.find(item => normalizeLookupText(item.name) === normalized)
    if (byName) return byName
    return { error: `案例类型无法匹配：${text}` }
  }

  function resolveAiTeam(value, aiTeams) {
    const text = cleanText(value)
    if (!text) return { error: '所属AI纵队必填' }
    const normalized = normalizeLookupText(text)
    const found = aiTeams.find(item => normalizeLookupText(item.name) === normalized || normalizeLookupText(item.value) === normalized)
    if (found) return found
    return { error: `所属AI纵队无法匹配：${text}` }
  }

  function normalizeDeptPath(value) {
    return cleanText(value)
      .replace(/[>＞\\]+/g, '/')
      .split('/')
      .map(part => compact(part))
      .filter(Boolean)
      .join('/')
      .toLowerCase()
  }

  function resolveDepartment(value, departments) {
    const text = cleanText(value)
    if (!text) return { error: '所属部门必填' }
    const rows = Array.isArray(departments) ? departments : []
    const byId = rows.find(item => cleanText(item.id || item.deptId) === text)
    if (byId) return normalizeResolvedDepartment(byId)

    const pathValue = normalizeDeptPath(text)
    if (/[/>＞\\]/.test(text)) {
      const exactPath = rows.find(item => normalizeDeptPath(item.path || item.namePath) === pathValue)
      if (exactPath) return normalizeResolvedDepartment(exactPath)
      const suffixMatches = rows.filter(item => normalizeDeptPath(item.path || item.namePath).endsWith(`/${pathValue}`))
      if (suffixMatches.length === 1) return normalizeResolvedDepartment(suffixMatches[0])
      if (suffixMatches.length > 1) return { error: `所属部门路径不唯一：${text}` }
      return { error: `所属部门路径无法匹配：${text}` }
    }

    const normalizedName = normalizeLookupText(text)
    const matches = rows.filter(item => normalizeLookupText(item.name || item.deptName) === normalizedName)
    if (matches.length === 1) return normalizeResolvedDepartment(matches[0])
    if (matches.length > 1) {
      const hints = matches.slice(0, 5).map(item => item.path || item.name).filter(Boolean).join('；')
      return { error: `所属部门名称不唯一：${text}，请填写完整路径或 deptId。候选：${hints}` }
    }
    return { error: `所属部门无法匹配：${text}` }
  }

  function normalizeResolvedDepartment(item) {
    const id = cleanText(item.id || item.deptId)
    const path = cleanText(item.path || item.name || item.deptName)
    const chain = cleanText(item.dingDeptIdChain || item.idChain)
    return {
      id,
      payloadId: item.payloadId != null ? item.payloadId : normalizeDeptId(id),
      name: cleanText(item.name || item.deptName || path),
      path,
      dingDeptIdChain: chain || id,
      raw: item.raw || item,
    }
  }

  async function searchDevelopers(term, apiClient, cache) {
    const key = normalizeLookupText(term)
    if (cache.developers[key]) return cache.developers[key]
    if (apiClient.searchDevelopers) {
      cache.developers[key] = normalizeDeveloperItems(await apiClient.searchDevelopers(term))
      return cache.developers[key]
    }
    cache.developers[key] = normalizeDeveloperItems(await apiClient.request('/portal/agent/member/search', {
      params: { currentPage: 1, pageSize: 20, userNames: term },
    }))
    return cache.developers[key]
  }

  async function searchSkills(term, apiClient, cache) {
    const key = normalizeLookupText(term)
    if (cache.skills[key]) return cache.skills[key]
    if (apiClient.searchSkills) {
      cache.skills[key] = normalizeSkillItems(await apiClient.searchSkills(term))
      return cache.skills[key]
    }
    cache.skills[key] = normalizeSkillItems(await apiClient.request('/portal/skill/page', {
      params: { currentPage: 1, pageSize: 20, keyword: term },
    }))
    return cache.skills[key]
  }

  async function resolveDeveloperTerm(term, apiClient, cache) {
    const text = cleanText(term)
    if (!text) return { error: '开发者为空' }
    const list = await searchDevelopers(text, apiClient, cache)
    const normalized = normalizeLookupText(text)
    const exact = list.filter(item => [item.userId, item.userName, item.phone].some(value => normalizeLookupText(value) === normalized))
    if (exact.length === 1) return exact[0]
    if (exact.length > 1) return { error: `开发者匹配不唯一：${text}` }
    if (list.length === 1) return list[0]
    if (/^[a-zA-Z0-9._-]+$/.test(text)) {
      return { userId: text, userName: text, phone: '', dept: '', raw: { inferred: true } }
    }
    return { error: `开发者无法唯一匹配：${text}` }
  }

  async function resolveSkillTerm(term, apiClient, cache) {
    const text = cleanText(term)
    if (!text) return { error: '技能为空' }
    const list = await searchSkills(text, apiClient, cache)
    const normalized = normalizeLookupText(text)
    const exact = list.filter(item => [item.id, item.name].some(value => normalizeLookupText(value) === normalized))
    if (exact.length === 1) return exact[0]
    if (exact.length > 1) return { error: `技能匹配不唯一：${text}` }
    if (list.length === 1) return list[0]
    if (/^\d{8,}$/.test(text)) {
      return { id: text, name: text, raw: { inferred: true } }
    }
    return { error: `技能无法唯一匹配：${text}` }
  }

  function normalizeValueTypes(rawValue) {
    const values = splitMultiValues(rawValue)
    const result = []
    const errors = []
    for (const value of values) {
      const found = VALUE_TYPES.find(item => normalizeLookupText(item) === normalizeLookupText(value))
      if (!found) {
        errors.push(`价值分类无效：${value}`)
        continue
      }
      if (!result.includes(found)) result.push(found)
    }
    if (!result.length) errors.push('价值分类必填')
    return { values: result, errors }
  }

  function normalizeFileRefs(rawValue, kind, options = {}) {
    const values = splitMultiValues(rawValue)
    const errors = []
    const refs = []
    const allowed = kind === 'icon' ? IMAGE_EXTS : kind === 'document' ? DOC_EXTS : VIDEO_EXTS
    const label = kind === 'icon' ? '封面图路径' : kind === 'document' ? '操作文档路径' : '视频路径'

    if (options.required && !values.length) {
      errors.push(`${label}必填，请填写本地路径或 URL。嵌入 Excel 的图片不会被 file_excel 读取`)
      return { refs, errors }
    }

    for (const value of values) {
      const ext = extensionOf(value)
      if (isHttpUrl(value)) {
        if (ext && !allowed.has(ext)) errors.push(`${label}扩展名不支持：${value}`)
        refs.push({ kind, source: value, isUrl: true, name: basename(value) || label, url: value })
        continue
      }

      if (!isProbablyLocalPath(value)) {
        errors.push(`${label}请填写本地绝对路径或 URL：${value}`)
        continue
      }
      if (!ext || !allowed.has(ext)) {
        errors.push(`${label}扩展名不支持：${value}`)
        continue
      }
      refs.push({ kind, source: value, isUrl: false, name: basename(value) || label })
    }

    if (options.single && refs.length > 1) {
      errors.push(`${label}只支持 1 个文件`)
    }
    return { refs: options.single ? refs.slice(0, 1) : refs, errors }
  }

  function collectHighlights(row) {
    const highlights = []
    const errors = []
    for (let index = 1; index <= 3; index += 1) {
      const desc = cleanText(pickRowValue(row, [`亮点${index}描述`, `亮点${index}`, `highlight${index}desc`]))
      const metric = cleanText(pickRowValue(row, [`亮点${index}指标`, `亮点${index}数值`, `highlight${index}metric`]))
      if (!desc && !metric) continue
      if (!desc || !metric) {
        errors.push(`亮点${index}需要同时填写描述和指标`)
        continue
      }
      highlights.push({ desc: desc.slice(0, 50), metric: metric.slice(0, 20) })
    }
    return { highlights, errors }
  }

  function collectComparisons(row) {
    const comparisons = []
    const errors = []
    for (let index = 1; index <= 10; index += 1) {
      const before = normalizeCompareText(pickRowValue(row, [`对比${index}之前`, `对比${index}前`, `before${index}`]))
      const after = normalizeCompareText(pickRowValue(row, [`对比${index}之后`, `对比${index}后`, `after${index}`]))
      if (!before && !after) continue
      if (!before || !after) {
        errors.push(`对比${index}需要同时填写之前和之后`)
        continue
      }
      comparisons.push({ before, after })
    }
    return { comparisons, errors }
  }

  function resolveRowNo(row, index) {
    const value = cleanText(row?.__row_number || row?.__row_no || row?.row_no || row?.行号)
    if (/^\d+$/.test(value)) return Number(value)
    return index + 2
  }

  async function normalizeShowcaseRows(inputRows, options = {}) {
    const rows = Array.isArray(inputRows?.rows)
      ? inputRows.rows
      : Array.isArray(inputRows)
        ? inputRows
        : []
    const apiClient = options.apiClient || createApiClient()
    const catalogs = normalizeCatalogs(options.catalogs || await fetchCatalogs(apiClient))
    const cache = { developers: Object.create(null), skills: Object.create(null) }
    const jobs = []
    const previewRows = []

    for (const [index, row] of rows.entries()) {
      if (isBlankRow(row)) continue
      const normalized = await normalizeOneRow(row, index, catalogs, apiClient, cache)
      if (normalized.errors.length) {
        previewRows.push(buildOutputRow(normalized.job, '预检失败', '', normalized.errors.join('；')))
      } else {
        jobs.push(normalized.job)
        previewRows.push(buildOutputRow(normalized.job, '预检通过', '', buildPlanNote(normalized.job)))
      }
    }

    return {
      catalogs,
      jobs,
      previewRows: previewRows.sort((a, b) => Number(a.表格行号 || 0) - Number(b.表格行号 || 0)),
      invalidRows: previewRows.filter(row => row.执行结果 === '预检失败'),
    }
  }

  async function normalizeOneRow(row, index, catalogs, apiClient, cache) {
    const errors = []
    const rowNo = resolveRowNo(row, index)
    const name = cleanText(pickRowValue(row, FIELD_ALIASES.name))
    const description = cleanText(pickRowValue(row, FIELD_ALIASES.description))
    const instructionsHtml = normalizeInstructions(pickRowValue(row, FIELD_ALIASES.instructions))
    const useLink = cleanText(pickRowValue(row, FIELD_ALIASES.useLink))
    const downloadLink = cleanText(pickRowValue(row, FIELD_ALIASES.downloadLink))
    const dingTalkContact = cleanText(pickRowValue(row, FIELD_ALIASES.dingTalkContact))
    const frequency = toNumberOrNull(pickRowValue(row, FIELD_ALIASES.frequency))
    const positions = splitMultiValues(pickRowValue(row, FIELD_ALIASES.positions))
    const originalHours = toNumberOrNull(pickRowValue(row, FIELD_ALIASES.originalHours))
    const currentHours = toNumberOrNull(pickRowValue(row, FIELD_ALIASES.currentHours))
    const revenueAmount = toNumberOrNull(pickRowValue(row, FIELD_ALIASES.revenueAmount))
    const costAmount = toNumberOrNull(pickRowValue(row, FIELD_ALIASES.costAmount))
    const otherDesc = cleanText(pickRowValue(row, FIELD_ALIASES.otherDesc))

    if (!name) errors.push('案例名称必填')
    if (name.length > 100) errors.push('案例名称最多 100 字')
    if (!description) errors.push('案例描述必填')
    if (description.length > 100) errors.push('案例描述最多 100 字')
    if (!instructionsHtml || !stripHtml(instructionsHtml)) errors.push('案例说明必填')
    if (!useLink) errors.push('使用链接必填')
    if (useLink && !isHttpUrl(useLink)) errors.push('使用链接必须以 http:// 或 https:// 开头')
    if (downloadLink && !isHttpUrl(downloadLink)) errors.push('下载链接必须以 http:// 或 https:// 开头')
    if (frequency != null && frequency < 0) errors.push('使用频次不能小于 0')

    const category = resolveCategory(pickRowValue(row, FIELD_ALIASES.category), catalogs.categories)
    if (category.error) errors.push(category.error)
    const aiTeam = resolveAiTeam(pickRowValue(row, FIELD_ALIASES.aiTeam), catalogs.aiTeams)
    if (aiTeam.error) errors.push(aiTeam.error)
    const department = resolveDepartment(pickRowValue(row, FIELD_ALIASES.dept), catalogs.departments)
    if (department.error) errors.push(department.error)

    const valueTypes = normalizeValueTypes(pickRowValue(row, FIELD_ALIASES.valueTypes))
    errors.push(...valueTypes.errors)
    if (valueTypes.values.includes('提效')) {
      if (!(originalHours > 0)) errors.push('选择“提效”时原工时必须大于 0')
      if (!(currentHours > 0)) errors.push('选择“提效”时现工时必须大于 0')
      if (originalHours > 0 && currentHours > originalHours) errors.push('现工时不能大于原工时')
    }
    if (valueTypes.values.includes('增收') && !(revenueAmount > 0)) errors.push('选择“增收”时增收金额必须大于 0')
    if (valueTypes.values.includes('降本') && !(costAmount > 0)) errors.push('选择“降本”时降低成本必须大于 0')
    if (valueTypes.values.includes('其他') && !otherDesc) errors.push('选择“其他”时其他介绍必填')

    const iconRefs = normalizeFileRefs(pickRowValue(row, FIELD_ALIASES.iconPath), 'icon', { required: true, single: true })
    const docRefs = normalizeFileRefs(pickRowValue(row, FIELD_ALIASES.documentPaths), 'document')
    const videoRefs = normalizeFileRefs(pickRowValue(row, FIELD_ALIASES.videoPaths), 'video')
    errors.push(...iconRefs.errors, ...docRefs.errors, ...videoRefs.errors)

    const highlights = collectHighlights(row)
    const comparisons = collectComparisons(row)
    errors.push(...highlights.errors, ...comparisons.errors)

    const developerTerms = splitMultiValues(pickRowValue(row, FIELD_ALIASES.developers))
    if (!developerTerms.length) errors.push('案例开发者必填')
    const developers = []
    for (const term of developerTerms) {
      const resolved = await resolveDeveloperTerm(term, apiClient, cache)
      if (resolved.error) errors.push(resolved.error)
      else developers.push(resolved)
    }

    const skillTerms = splitMultiValues(pickRowValue(row, FIELD_ALIASES.skills))
    if (!skillTerms.length) errors.push('涉及技能必填')
    const skills = []
    for (const term of skillTerms) {
      const resolved = await resolveSkillTerm(term, apiClient, cache)
      if (resolved.error) errors.push(resolved.error)
      else skills.push(resolved)
    }

    const job = {
      rowNo,
      name,
      description,
      instructionsHtml,
      useLink,
      downloadLink,
      dingTalkContact,
      categoryCode: category.categoryCode || '',
      categoryName: category.name || cleanText(pickRowValue(row, FIELD_ALIASES.category)),
      aiTeam: aiTeam.value || aiTeam.name || cleanText(pickRowValue(row, FIELD_ALIASES.aiTeam)),
      departmentName: department.path || department.name || cleanText(pickRowValue(row, FIELD_ALIASES.dept)),
      dingDeptId: department.payloadId,
      dingDeptIdChain: department.dingDeptIdChain || '',
      developers,
      developerIds: developers.map(item => item.userId).filter(Boolean),
      developerNames: developers.map(item => item.userName || item.userId).filter(Boolean),
      skills,
      skillIds: skills.map(item => item.id).filter(Boolean),
      skillNames: skills.map(item => item.name || item.id).filter(Boolean),
      reusableRoles: positions,
      frequency: frequency == null ? 0 : Math.round(frequency),
      valueTypes: valueTypes.values,
      originalHours,
      currentHours,
      revenueAmount,
      costAmount,
      otherDesc,
      highlights: highlights.highlights,
      comparisons: comparisons.comparisons,
      assets: {
        icon: iconRefs.refs[0] || null,
        documents: docRefs.refs,
        videos: videoRefs.refs,
      },
      uploaded: {
        icon: iconRefs.refs[0]?.isUrl ? iconRefs.refs[0].url : '',
        documents: docRefs.refs.filter(item => item.isUrl).map(item => ({ name: item.name, url: item.url })),
        videos: videoRefs.refs.filter(item => item.isUrl).map(item => ({ name: item.name, url: item.url })),
      },
    }

    if (!job.developerIds.length) errors.push('案例开发者未解析到 userId')
    if (!job.skillIds.length) errors.push('涉及技能未解析到 skillId')
    return { job, errors }
  }

  function buildPlanNote(job) {
    const localFiles = collectUploadQueue(job).length
    const changeText = (job?.changedFields || []).length
      ? `将更新：${job.changedFields.join('、')}`
      : '未检测到字段变化，live 模式将跳过'
    return localFiles ? `${changeText}；将上传 ${localFiles} 个本地文件` : changeText
  }

  function buildOutputRow(job, result, caseId = '', note = '') {
    return {
      表格行号: job?.rowNo || '',
      案例ID: job?.caseId || caseId || '',
      编辑页链接: buildEditPageUrl(job?.caseId || caseId || ''),
      案例名称: job?.name || '',
      案例类型: job?.categoryName || job?.categoryCode || '',
      所属AI纵队: job?.aiTeam || '',
      所属部门: job?.departmentName || '',
      案例开发者: (job?.developerNames || []).join('；'),
      涉及技能: (job?.skillNames || []).join('；'),
      更新字段: (job?.changedFields || job?.patchFields || []).join('；'),
      价值分类: (job?.valueTypes || []).join('；'),
      封面图: job?.uploaded?.icon || job?.assets?.icon?.source || '',
      操作文档: (job?.uploaded?.documents || []).map(item => item.url || item.name).join('；') || (job?.assets?.documents || []).map(item => item.source).join('；'),
      视频介绍: (job?.uploaded?.videos || []).map(item => item.url || item.name).join('；') || (job?.assets?.videos || []).map(item => item.source).join('；'),
      执行结果: result,
      备注: note || '',
    }
  }

  function normalizeUploadedList(rawValue) {
    if (!rawValue) return []
    const values = Array.isArray(rawValue) ? rawValue : splitMultiValues(rawValue)
    return values
      .map(item => {
        if (typeof item === 'string') {
          const url = cleanText(item)
          return url ? { name: basename(url), url } : null
        }
        const url = cleanText(item?.url || item?.path || item?.fileUrl)
        const name = cleanText(item?.name || item?.originalName || basename(url))
        return url ? { name: name || basename(url), url } : null
      })
      .filter(Boolean)
  }

  function uploadedListToCell(rawValue) {
    return normalizeUploadedList(rawValue).map(item => item.url).filter(Boolean).join('|')
  }

  function valueTypesFromDetail(detail) {
    const explicitValues = Array.isArray(detail?.valueTypes) ? detail.valueTypes : []
    const values = explicitValues.filter(item => VALUE_TYPES.includes(item))
    const efficiency = detail?.efficiency || {}
    const increase = detail?.increase || {}
    const cost = detail?.cost || {}
    const other = detail?.other || {}
    if (!values.includes('提效') && (toNumberOrNull(efficiency.originalTime) > 0 || toNumberOrNull(efficiency.currentTime) >= 0 && cleanText(efficiency.currentTime) !== '')) values.push('提效')
    if (!values.includes('增收') && toNumberOrNull(increase.value) > 0) values.push('增收')
    if (!values.includes('降本') && toNumberOrNull(cost.value) > 0) values.push('降本')
    if (!values.includes('其他') && cleanText(other.value)) values.push('其他')
    return values
  }

  function detailToEditableRow(detail, rowNo, caseId = '') {
    const id = cleanText(caseId || detail?.id || detail?.caseId)
    const developers = Array.isArray(detail?.developers)
      ? detail.developers.map(item => cleanText(item?.userId || item?.id || item?.name || item?.userName)).filter(Boolean)
      : splitMultiValues(detail?.developerIds || '')
    const skills = Array.isArray(detail?.skills)
      ? detail.skills.map(item => cleanText(item?.id || item?.skillId || item?.name)).filter(Boolean)
      : splitMultiValues(detail?.skillIds || '')
    const positions = Array.isArray(detail?.casePosition)
      ? detail.casePosition.map(item => cleanText(item?.name || item?.positionName || item)).filter(Boolean)
      : splitMultiValues(detail?.positionNames || '')
    const indicators = Array.isArray(detail?.indicator) ? detail.indicator : []
    const comparisons = Array.isArray(detail?.diff) ? detail.diff : []
    const row = {
      __row_number: rowNo,
      案例ID: id,
      编辑页链接: buildEditPageUrl(id),
      案例名称: cleanText(detail?.name),
      封面图路径: cleanText(detail?.icon),
      案例类型: cleanText(detail?.categoryCode || detail?.categoryName),
      使用链接: cleanText(detail?.useLink),
      下载链接: cleanText(detail?.downloadLink),
      所属AI纵队: cleanText(detail?.aiTeam),
      所属部门: cleanText(detail?.dingDeptId || detail?.departmentName || detail?.deptName),
      案例描述: cleanText(detail?.description),
      案例说明: cleanText(detail?.useDescription),
      案例开发者: developers.join('|'),
      涉及技能: skills.join('|'),
      可复用岗位: positions.join('|'),
      使用频次: detail?.frequency ?? '',
      价值分类: valueTypesFromDetail(detail).join('|'),
      原工时: detail?.efficiency?.originalTime ?? '',
      现工时: detail?.efficiency?.currentTime ?? '',
      增收金额: detail?.increase?.value ?? '',
      降低成本: detail?.cost?.value ?? '',
      其他介绍: cleanText(detail?.other?.value),
      操作文档路径: uploadedListToCell(detail?.document),
      视频路径: uploadedListToCell(detail?.video),
      钉钉联系人: cleanText(detail?.dingtalkLink),
    }
    for (let index = 1; index <= 3; index += 1) {
      row[`亮点${index}描述`] = cleanText(indicators[index - 1]?.description)
      row[`亮点${index}指标`] = cleanText(indicators[index - 1]?.value)
    }
    for (let index = 1; index <= 10; index += 1) {
      row[`对比${index}之前`] = normalizeCompareText(comparisons[index - 1]?.before)
      row[`对比${index}之后`] = normalizeCompareText(comparisons[index - 1]?.after)
    }
    return row
  }

  function detailToCasePayload(detail) {
    const developerIds = Array.isArray(detail?.developers)
      ? detail.developers.map(item => cleanText(item?.userId || item?.id || item?.userName || item?.name)).filter(Boolean)
      : splitMultiValues(detail?.developerIds || '')
    const skillIds = Array.isArray(detail?.skills)
      ? detail.skills.map(item => cleanText(item?.id || item?.skillId || item?.name)).filter(Boolean)
      : splitMultiValues(detail?.skillIds || '')
    const positions = Array.isArray(detail?.casePosition)
      ? detail.casePosition.map(item => cleanText(item?.name || item?.positionName || item)).filter(Boolean)
      : splitMultiValues(detail?.positionNames || '')
    return {
      categoryCode: cleanText(detail?.categoryCode || ''),
      status: 1,
      name: cleanText(detail?.name),
      description: cleanText(detail?.description),
      useDescription: cleanText(detail?.useDescription),
      useLink: cleanText(detail?.useLink),
      downloadLink: cleanText(detail?.downloadLink),
      dingtalkLink: cleanText(detail?.dingtalkLink),
      developerIds,
      skillIds,
      frequency: detail?.frequency ?? 0,
      indicator: (Array.isArray(detail?.indicator) ? detail.indicator : [])
        .filter(item => cleanText(item?.description) && cleanText(item?.value))
        .map(item => ({
          description: cleanText(item.description),
          value: cleanText(item.value),
        })),
      diff: (Array.isArray(detail?.diff) ? detail.diff : [])
        .filter(item => cleanText(item?.before) && cleanText(item?.after))
        .map(item => ({
          before: cleanText(item.before),
          after: cleanText(item.after),
        })),
      efficiency: detail?.efficiency || {},
      increase: detail?.increase || {},
      cost: detail?.cost || {},
      other: detail?.other || {},
      document: normalizeUploadedList(detail?.document),
      video: normalizeUploadedList(detail?.video),
      icon: cleanText(detail?.icon),
      positionNames: positions,
      aiTeam: cleanText(detail?.aiTeam),
      dingDeptId: detail?.dingDeptId,
      dingDeptIdChain: cleanText(detail?.dingDeptIdChain) || undefined,
    }
  }

  function applyProvidedCell(targetRow, sourceRow, aliases, outputLabel, patchFields) {
    const entry = pickRowEntry(sourceRow, aliases)
    if (!entry || !hasPatchValue(entry.value)) return
    targetRow[outputLabel] = isClearToken(entry.value) ? '' : cleanText(entry.value)
    if (!patchFields.includes(outputLabel)) patchFields.push(outputLabel)
  }

  function mergeEditRow(baseRow, sourceRow) {
    const merged = { ...baseRow }
    const patchFields = []
    for (const key of EDITABLE_KEYS) {
      applyProvidedCell(merged, sourceRow, FIELD_ALIASES[key], EDIT_FIELD_LABELS[key], patchFields)
    }
    for (let index = 1; index <= 3; index += 1) {
      applyProvidedCell(merged, sourceRow, [`亮点${index}描述`, `亮点${index}`, `highlight${index}desc`], `亮点${index}描述`, patchFields)
      applyProvidedCell(merged, sourceRow, [`亮点${index}指标`, `亮点${index}数值`, `highlight${index}metric`], `亮点${index}指标`, patchFields)
    }
    for (let index = 1; index <= 10; index += 1) {
      applyProvidedCell(merged, sourceRow, [`对比${index}之前`, `对比${index}前`, `before${index}`], `对比${index}之前`, patchFields)
      applyProvidedCell(merged, sourceRow, [`对比${index}之后`, `对比${index}后`, `after${index}`], `对比${index}之后`, patchFields)
    }
    return { row: merged, patchFields }
  }

  function normalizeForDiff(value) {
    if (Array.isArray(value)) return value.map(normalizeForDiff)
    if (value && typeof value === 'object') {
      return Object.keys(value).sort().reduce((acc, key) => {
        const item = normalizeForDiff(value[key])
        if (item !== undefined && item !== '' && !(Array.isArray(item) && !item.length) && !(item && typeof item === 'object' && !Array.isArray(item) && !Object.keys(item).length)) {
          acc[key] = item
        }
        return acc
      }, {})
    }
    if (typeof value === 'number') return roundNumber(value)
    return cleanText(value)
  }

  function valuesDiffer(left, right) {
    return JSON.stringify(normalizeForDiff(left)) !== JSON.stringify(normalizeForDiff(right))
  }

  function diffPayloadFields(basePayload, nextPayload) {
    const fields = [
      ['name', '案例名称'],
      ['icon', '封面图'],
      ['categoryCode', '案例类型'],
      ['useLink', '使用链接'],
      ['downloadLink', '下载链接'],
      ['aiTeam', '所属AI纵队'],
      ['dingDeptId', '所属部门'],
      ['dingDeptIdChain', '所属部门链路'],
      ['description', '案例描述'],
      ['useDescription', '案例说明'],
      ['developerIds', '案例开发者'],
      ['skillIds', '涉及技能'],
      ['positionNames', '可复用岗位'],
      ['frequency', '使用频次'],
      ['efficiency', '提效指标'],
      ['increase', '增收金额'],
      ['cost', '降低成本'],
      ['other', '其他介绍'],
      ['indicator', '亮点指标'],
      ['diff', '前后对比'],
      ['document', '操作文档'],
      ['video', '视频介绍'],
      ['dingtalkLink', '钉钉联系人'],
    ]
    return fields
      .filter(([key]) => valuesDiffer(basePayload?.[key], nextPayload?.[key]))
      .map(([, label]) => label)
  }

  async function fetchCaseInfo(caseId, apiClient = createApiClient()) {
    const data = await apiClient.request('/portal/digital/employee/v2/case/info', {
      method: 'GET',
      params: { id: caseId },
    })
    if (!data || typeof data !== 'object') throw new Error(`案例详情为空：${caseId}`)
    return data
  }

  async function normalizeEditRows(inputRows, options = {}) {
    const rows = Array.isArray(inputRows?.rows)
      ? inputRows.rows
      : Array.isArray(inputRows)
        ? inputRows
        : []
    const apiClient = options.apiClient || createApiClient()
    const catalogs = normalizeCatalogs(options.catalogs || await fetchCatalogs(apiClient))
    const cache = { developers: Object.create(null), skills: Object.create(null) }
    const jobs = []
    const previewRows = []

    for (const [index, row] of rows.entries()) {
      if (isBlankRow(row)) continue
      const rowNo = resolveRowNo(row, index)
      const caseId = pickCaseId(row)
      const fallbackJob = {
        rowNo,
        caseId,
        name: cleanText(pickRowValue(row, FIELD_ALIASES.name)),
        categoryName: cleanText(pickRowValue(row, FIELD_ALIASES.category)),
      }
      if (!caseId) {
        previewRows.push(buildOutputRow(fallbackJob, '预检失败', '', '案例ID必填，可填写案例ID或编辑页链接'))
        continue
      }

      try {
        const detail = await fetchCaseInfo(caseId, apiClient)
        const baseRow = detailToEditableRow(detail, rowNo, caseId)
        const merged = mergeEditRow(baseRow, row)
        const normalized = await normalizeOneRow(merged.row, index, catalogs, apiClient, cache)
        const job = {
          ...normalized.job,
          caseId,
          basePayload: detailToCasePayload(detail),
          patchFields: merged.patchFields,
          sourceDetail: detail,
        }
        job.nextPayload = buildCasePayload(job)
        job.changedFields = diffPayloadFields(job.basePayload, job.nextPayload)

        if (normalized.errors.length) {
          previewRows.push(buildOutputRow(job, '预检失败', caseId, normalized.errors.join('；')))
        } else {
          jobs.push(job)
          previewRows.push(buildOutputRow(job, '预检通过', caseId, buildPlanNote(job)))
        }
      } catch (error) {
        previewRows.push(buildOutputRow(fallbackJob, '预检失败', caseId, `读取案例详情失败：${error?.message || error}`))
      }
    }

    return {
      catalogs,
      jobs,
      previewRows: previewRows.sort((a, b) => Number(a.表格行号 || 0) - Number(b.表格行号 || 0)),
      invalidRows: previewRows.filter(row => row.执行结果 === '预检失败'),
    }
  }

  function collectUploadQueue(job) {
    const queue = []
    if (job?.assets?.icon && !job.assets.icon.isUrl && !job.uploaded.icon) {
      queue.push({ kind: 'icon', path: job.assets.icon.source, name: job.assets.icon.name })
    }
    for (const item of job?.assets?.documents || []) {
      if (!item.isUrl) queue.push({ kind: 'document', path: item.source, name: item.name })
    }
    for (const item of job?.assets?.videos || []) {
      if (!item.isUrl) queue.push({ kind: 'video', path: item.source, name: item.name })
    }
    return queue
  }

  function uploadCacheKey(uploadItem) {
    return `${cleanText(uploadItem?.kind)}:${cleanPath(uploadItem?.path)}`
  }

  function getAccessToken() {
    try {
      if (typeof localStorage === 'undefined') return ''
      return JSON.parse(localStorage.getItem('authStorage') || '{}')?.state?.authData?.oauth2Token?.access_token || ''
    } catch (error) {
      return ''
    }
  }

  function buildApiUrl(path, queryParams = {}) {
    const url = `${API_BASE}${path}`
    const query = new URLSearchParams()
    Object.entries(queryParams || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
    })
    const qs = query.toString()
    return qs ? `${url}?${qs}` : url
  }

  function unwrapApiPayload(payload) {
    if (payload && typeof payload === 'object' && ('code' in payload || 'data' in payload || 'msg' in payload)) {
      if (Number(payload.code) === 200) return payload.data
      if (!('code' in payload) && 'data' in payload) return payload.data
      throw new Error(cleanText(payload.msg || payload.message || '接口返回失败'))
    }
    return payload
  }

  function createApiClient() {
    return {
      async request(path, options = {}) {
        const method = String(options.method || (options.body ? 'POST' : 'GET')).toUpperCase()
        const headers = { ...(options.headers || {}) }
        const token = getAccessToken()
        if (token) headers.satoken = token

        let body
        if (options.body !== undefined) {
          headers['Content-Type'] = 'application/json'
          body = JSON.stringify(options.body)
        }

        const response = await fetch(buildApiUrl(path, options.params), {
          method,
          headers,
          body,
          credentials: 'include',
        })
        if (!response.ok) {
          const text = await response.text().catch(() => '')
          throw new Error(`HTTP ${response.status}: ${text.slice(0, 240) || response.statusText}`)
        }
        return unwrapApiPayload(await response.json())
      },
    }
  }

  async function fetchCatalogs(apiClient) {
    const [categories, aiTeams, deptTree] = await Promise.all([
      apiClient.request('/portal/digital/employee/v2/case/category/list'),
      apiClient.request('/portal/digital/employee/v2/case/ai/team/list'),
      apiClient.request('/portal/digital-employees/dept/tree'),
    ])
    return { categories, aiTeams, deptTree }
  }

  function nextPhase(name, sleepMs = 0, newShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: {
        action: 'next_phase',
        next_phase: name,
        sleep_ms: Number(sleepMs || 0),
        shared: newShared,
      },
    }
  }

  function injectFiles(items, nextPhaseName, sleepMs = 500, newShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: {
        action: 'inject_files',
        items,
        next_phase: nextPhaseName,
        sleep_ms: Number(sleepMs || 0),
        shared: newShared,
      },
    }
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

  function fail(message) {
    return { success: false, error: String(message || '批量编辑案例执行失败') }
  }

  function ensureUploadInput() {
    if (typeof document === 'undefined') throw new Error('当前页面没有 document，无法注入本地文件')
    let input = document.querySelector?.(UPLOAD_INPUT_SELECTOR)
    if (!input) {
      input = document.createElement('input')
      input.type = 'file'
      input.id = UPLOAD_INPUT_ID
      input.setAttribute('data-crawshrimp-upload', 'dasen-showcase')
      input.style.position = 'fixed'
      input.style.left = '-9999px'
      input.style.top = '-9999px'
      input.style.width = '1px'
      input.style.height = '1px'
      input.style.opacity = '0'
      ;(document.body || document.documentElement).appendChild(input)
    }
    return input
  }

  function validateInjectedFile(file, uploadItem) {
    if (!file) return '文件注入后未读取到 File 对象'
    const ext = extensionOf(file.name || uploadItem?.path || '')
    if (uploadItem.kind === 'icon') {
      if (file.size > 2 * 1024 * 1024) return `封面图超过 2MB：${file.name}`
      if (!IMAGE_EXTS.has(ext) && !String(file.type || '').startsWith('image/')) return `封面图类型不支持：${file.name}`
    }
    if (uploadItem.kind === 'document' && !DOC_EXTS.has(ext)) return `操作文档类型不支持：${file.name}`
    if (uploadItem.kind === 'video' && !VIDEO_EXTS.has(ext) && !String(file.type || '').startsWith('video/')) return `视频类型不支持：${file.name}`
    return ''
  }

  async function uploadBrowserFile(file) {
    const token = getAccessToken()
    if (!token) throw new Error('未读取到登录 token，请先在森马 AI 工作台完成登录')
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch(`${API_BASE}/portal/file/upload`, {
      method: 'POST',
      headers: { satoken: token },
      body: formData,
      credentials: 'include',
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`上传失败 HTTP ${response.status}: ${text.slice(0, 240) || response.statusText}`)
    }
    const data = unwrapApiPayload(await response.json())
    if (!data?.path) throw new Error(`上传接口未返回 path：${file.name}`)
    return {
      name: cleanText(data.originalName || file.name),
      url: cleanText(data.path),
      raw: data,
    }
  }

  function applyUploadedFile(job, activeUpload, uploaded) {
    const nextJob = JSON.parse(JSON.stringify(job || {}))
    nextJob.uploaded = nextJob.uploaded || { icon: '', documents: [], videos: [] }
    if (activeUpload.kind === 'icon') {
      nextJob.uploaded.icon = uploaded.url
    } else if (activeUpload.kind === 'document') {
      nextJob.uploaded.documents = [...(nextJob.uploaded.documents || []), { name: uploaded.name, url: uploaded.url }]
    } else if (activeUpload.kind === 'video') {
      nextJob.uploaded.videos = [...(nextJob.uploaded.videos || []), { name: uploaded.name, url: uploaded.url }]
    }
    return nextJob
  }

  function replaceJobInShared(newShared, jobIndex, job) {
    const jobs = Array.isArray(newShared.jobs) ? newShared.jobs.slice() : []
    jobs[jobIndex] = job
    return { ...newShared, jobs }
  }

  function buildCasePayload(job) {
    const efficiency = job.valueTypes.includes('提效')
      ? {
          originalTime: roundNumber(job.originalHours),
          currentTime: roundNumber(job.currentHours),
          economizeTime: roundNumber(Number(job.originalHours || 0) - Number(job.currentHours || 0)),
        }
      : {}
    return {
      categoryCode: job.categoryCode || '',
      status: 1,
      name: cleanText(job.name),
      description: cleanText(job.description),
      useDescription: job.instructionsHtml || '',
      useLink: cleanText(job.useLink),
      downloadLink: cleanText(job.downloadLink),
      dingtalkLink: cleanText(job.dingTalkContact),
      developerIds: job.developerIds || [],
      skillIds: job.skillIds || [],
      frequency: job.frequency ?? 0,
      indicator: (job.highlights || []).filter(item => item.desc && item.metric).map(item => ({
        description: cleanText(item.desc),
        value: cleanText(item.metric),
      })),
      diff: (job.comparisons || []).filter(item => item.before && item.after).map(item => ({
        before: cleanText(item.before),
        after: cleanText(item.after),
      })),
      efficiency,
      increase: job.valueTypes.includes('增收') ? { value: roundNumber(job.revenueAmount) } : {},
      cost: job.valueTypes.includes('降本') ? { value: roundNumber(job.costAmount) } : {},
      other: job.valueTypes.includes('其他') ? { value: cleanText(job.otherDesc) } : {},
      document: job.uploaded?.documents || [],
      video: job.uploaded?.videos || [],
      icon: job.uploaded?.icon || '',
      positionNames: job.reusableRoles || [],
      aiTeam: job.aiTeam || '',
      dingDeptId: job.dingDeptId,
      dingDeptIdChain: job.dingDeptIdChain || undefined,
    }
  }

  async function updateCase(job, apiClient = createApiClient()) {
    const payload = buildCasePayload(job)
    if (!payload.icon) throw new Error('封面图未上传或未填写 URL')
    if (!job.caseId) throw new Error('案例ID缺失，无法编辑')
    const data = await apiClient.request('/portal/digital/employee/v2/case/update', {
      method: 'POST',
      body: { id: job.caseId, ...payload },
    })
    return {
      id: cleanText(data?.id || data?.caseId || data?.caseInfo?.id || job.caseId),
      payload: { id: job.caseId, ...payload },
      raw: data,
    }
  }

  function buildRunShared(jobs, requestDelayMs) {
    const firstJob = jobs[0] || {}
    return {
      jobs,
      results: [],
      job_index: 0,
      upload_queue: [],
      active_upload: null,
      request_delay_ms: Math.max(0, Number(requestDelayMs || 0)),
      total_rows: jobs.length,
      current_exec_no: jobs.length ? 1 : 0,
      current_row_no: firstJob.rowNo || 0,
      current_buyer_id: firstJob.name || '',
      current_store: '大森运营助手 · 批量编辑案例',
    }
  }

  function finishCurrentJob(newShared, resultRow) {
    const results = [...(Array.isArray(newShared.results) ? newShared.results : []), resultRow]
    const nextIndex = Number(newShared.job_index || 0) + 1
    const nextJob = (newShared.jobs || [])[nextIndex] || null
    return {
      ...newShared,
      results,
      job_index: nextIndex,
      upload_queue: [],
      active_upload: null,
      upload_cache: newShared.upload_cache || {},
      current_exec_no: nextJob ? nextIndex + 1 : results.length,
      current_row_no: nextJob?.rowNo || 0,
      current_buyer_id: nextJob?.name || '',
    }
  }

  function startNextUploadOrCreate(newShared, sleepMs = 0) {
    let nextShared = { ...newShared }
    let uploadQueue = Array.isArray(nextShared.upload_queue) ? nextShared.upload_queue.slice() : []
    const jobIndex = Number(nextShared.job_index || 0)
    let job = (nextShared.jobs || [])[jobIndex] || null

    while (job && uploadQueue.length) {
      const cached = (nextShared.upload_cache || {})[uploadCacheKey(uploadQueue[0])]
      if (!cached) break
      job = applyUploadedFile(job, uploadQueue[0], cached)
      uploadQueue = uploadQueue.slice(1)
      nextShared = replaceJobInShared({
        ...nextShared,
        upload_queue: uploadQueue,
        active_upload: null,
      }, jobIndex, job)
    }

    if (!uploadQueue.length) return nextPhase('update_case', sleepMs, nextShared)
    ensureUploadInput()
    const activeUpload = uploadQueue[0]
    return injectFiles([{ selector: UPLOAD_INPUT_SELECTOR, files: [activeUpload.path] }], 'after_upload_file', 500, {
      ...nextShared,
      upload_queue: uploadQueue,
      active_upload: activeUpload,
    })
  }

  async function runMainPhase() {
    const executeMode = cleanText(params.execute_mode || 'plan').toLowerCase() === 'live' ? 'live' : 'plan'
    const parsed = await normalizeEditRows(params.input_file || [])
    if (!parsed.previewRows.length) {
      throw new Error('Excel 中没有可执行行，请检查是否填写了案例数据')
    }
    if (executeMode !== 'live') {
      return complete(parsed.previewRows, {
        total_rows: parsed.previewRows.length,
        current_exec_no: parsed.previewRows.length,
        current_store: '大森运营助手 · 批量编辑预检',
      })
    }
    if (parsed.invalidRows.length) {
      const validWaitingRows = parsed.jobs.map(job => buildOutputRow(job, '未执行', job.caseId, '存在预检失败行，本次 live 未开始提交'))
      return complete([...parsed.invalidRows, ...validWaitingRows].sort((a, b) => Number(a.表格行号 || 0) - Number(b.表格行号 || 0)), {
        total_rows: parsed.previewRows.length,
        current_exec_no: parsed.invalidRows.length,
        current_store: '大森运营助手 · 批量编辑预检失败',
      })
    }
    return nextPhase('prepare_row', 0, buildRunShared(parsed.jobs, params.request_delay_ms || 600))
  }

  async function runPrepareRowPhase() {
    const jobs = Array.isArray(shared.jobs) ? shared.jobs : []
    const jobIndex = Number(shared.job_index || 0)
    const job = jobs[jobIndex]
    if (!job) {
      return complete(Array.isArray(shared.results) ? shared.results : [], {
        ...shared,
        current_exec_no: Array.isArray(shared.results) ? shared.results.length : 0,
        current_buyer_id: '',
        current_row_no: 0,
      })
    }
    const uploadQueue = collectUploadQueue(job)
    const nextShared = {
      ...shared,
      upload_queue: uploadQueue,
      active_upload: null,
      current_exec_no: jobIndex + 1,
      current_row_no: job.rowNo || 0,
      current_buyer_id: job.name || '',
    }
    return startNextUploadOrCreate(nextShared)
  }

  async function runAfterUploadPhase() {
    const jobIndex = Number(shared.job_index || 0)
    const jobs = Array.isArray(shared.jobs) ? shared.jobs : []
    const job = jobs[jobIndex]
    const activeUpload = shared.active_upload || null
    if (!job || !activeUpload) {
      return nextPhase('prepare_row', 0, shared)
    }
    try {
      const input = document.querySelector(UPLOAD_INPUT_SELECTOR)
      const file = input?.files?.[0]
      const validationError = validateInjectedFile(file, activeUpload)
      if (validationError) throw new Error(validationError)
      const uploaded = await uploadBrowserFile(file)
      const nextJob = applyUploadedFile(job, activeUpload, uploaded)
      const nextQueue = (Array.isArray(shared.upload_queue) ? shared.upload_queue : []).slice(1)
      const updatedShared = replaceJobInShared({
        ...shared,
        upload_queue: nextQueue,
        active_upload: null,
        upload_cache: {
          ...(shared.upload_cache || {}),
          [uploadCacheKey(activeUpload)]: uploaded,
        },
      }, jobIndex, nextJob)
      return startNextUploadOrCreate(updatedShared)
    } catch (error) {
      const failedShared = finishCurrentJob(shared, buildOutputRow(job, '编辑失败', job.caseId, `上传失败：${error?.message || error}`))
      return nextPhase('prepare_row', shared.request_delay_ms || 0, failedShared)
    }
  }

  async function runUpdateCasePhase() {
    const jobIndex = Number(shared.job_index || 0)
    const jobs = Array.isArray(shared.jobs) ? shared.jobs : []
    const job = jobs[jobIndex]
    if (!job) return nextPhase('prepare_row', 0, shared)
    if (!Array.isArray(job.changedFields) || !job.changedFields.length) {
      const skippedShared = finishCurrentJob(shared, buildOutputRow(job, '无需更新', job.caseId, '未检测到字段变化'))
      return nextPhase('prepare_row', shared.request_delay_ms || 0, skippedShared)
    }
    try {
      const saved = await updateCase(job)
      const successShared = finishCurrentJob(shared, buildOutputRow(job, '编辑成功', saved.id, ''))
      return nextPhase('prepare_row', shared.request_delay_ms || 0, successShared)
    } catch (error) {
      const failedShared = finishCurrentJob(shared, buildOutputRow(job, '编辑失败', job.caseId, error?.message || error))
      return nextPhase('prepare_row', shared.request_delay_ms || 0, failedShared)
    }
  }

  function exposeHelpers() {
    if (!testExports || typeof testExports !== 'object') return
    Object.assign(testExports, {
      splitMultiValues,
      normalizeInstructions,
      normalizeCategoryItems,
      normalizeAiTeamItems,
      normalizeDeveloperItems,
      normalizeSkillItems,
      flattenDepartmentTree,
      normalizeFlatDepartmentRows,
      normalizeDepartmentSource,
      normalizeCatalogs,
      resolveCategory,
      resolveAiTeam,
      resolveDepartment,
      normalizeFileRefs,
      collectHighlights,
      collectComparisons,
      normalizeShowcaseRows,
      normalizeEditRows,
      detailToEditableRow,
      mergeEditRow,
      diffPayloadFields,
      fetchCaseInfo,
      buildCasePayload,
      collectUploadQueue,
      uploadCacheKey,
      buildRunShared,
      buildOutputRow,
      updateCase,
    })
  }

  exposeHelpers()

  if (phase === '__exports__') {
    return complete([], shared)
  }

  try {
    if (phase === 'main' || phase === 'init') return await runMainPhase()
    if (phase === 'prepare_row') return await runPrepareRowPhase()
    if (phase === 'after_upload_file') return await runAfterUploadPhase()
    if (phase === 'update_case') return await runUpdateCasePhase()
    return fail(`未知 phase: ${phase}`)
  } catch (error) {
    return fail(error?.message || error)
  }
})()
