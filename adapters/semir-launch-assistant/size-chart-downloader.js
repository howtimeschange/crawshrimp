;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const REQUEST_HANDLER = '/csi-requesthandler/RequestHandler?'
  const DEFAULT_STAGE = '当前修订版（阶段未确认）'
  const DEFAULT_PAGE_SIZE = 100
  const DEFAULT_DELAY_MS = 500

  const STYLE_DEP_PATHS = [
    'Child:Attributes',
    'Child:Attributes/Child:__Parent__',
    'Child:DataSheets',
    'Child:DataSheets/Child:CurrentRevision',
    'Child:DataSheets/Child:Subtype',
    'Child:DataSheets/Child:C8_SC_Stage',
    'Child:DataSheets/Child:DataSheetSamples',
    'Child:SizeCharts',
    'Child:SizeCharts/Child:CurrentRevision',
    'Child:SizeCharts/Child:Subtype',
    'Child:SizeCharts/Child:C8_SC_Stage',
    'Child:SizeCharts/Child:DataSheetSamples',
    'Child:SizeCharts/Child:CurrentRevision/Child:SizeRange',
    'Child:SizeCharts/Child:CurrentRevision/Child:SizeChartSubSizeRanges',
  ]

  const SIZE_CHART_DEP_PATHS = [
    'Child:CurrentRevision',
    'Child:CurrentRevision/Child:__Parent__',
    'Child:CurrentRevision/Child:SizeRange',
    'Child:CurrentRevision/Child:SizeRange/Child:Sizes',
    'Child:CurrentRevision/Child:Sizes',
    'Child:CurrentRevision/Child:Sizes/Child:Dimension1Size',
    'Child:CurrentRevision/Child:Sizes/Child:Dimension2Size',
    'Child:CurrentRevision/Child:SizeChartDimension1Sizes',
    'Child:CurrentRevision/Child:SizeChartDimension2Sizes',
    'Child:CurrentRevision/Child:SizeChartSubSizeRanges',
    'Child:CurrentRevision/Child:SizeChartSubSizeRanges/Index:0/Child:BaseSize',
    'Child:CurrentRevision/Child:SizeChartSubSizeRanges/Index:0/Child:__Parent__',
    'Child:CurrentRevision/Child:Items',
    'Child:CurrentRevision/Child:Items/Child:Actual',
    'Child:CurrentRevision/Child:Items/Child:Original',
    'Child:CurrentRevision/Child:Items/Child:MeasurementPoint',
    'Child:CurrentRevision/Child:Items/Child:MeasurementPoint/Child:CurrentRevision',
    'Child:CurrentRevision/Child:__Parent__/Child:__Parent__',
    'Child:CurrentRevision/Child:__Parent__/Child:__Parent__/Child:Attributes',
    'Child:CurrentRevision/Child:__Parent__/Child:__Parent__/Child:Attributes/Child:__Parent__',
  ]

  function compact(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim()
  }

  function normalizeToken(value) {
    return compact(value).replace(/[\/\s_：:（）()\[\]【】\-]+/g, '').toLowerCase()
  }

  function normalizeUrl(value) {
    return compact(value).replace(/^centric:\/\//, '').replace(/^centric:/, '')
  }

  function isPlmUrl(value) {
    return /^C\d+/.test(compact(value)) || /^C0\//.test(compact(value)) || /^centric:\/\//.test(compact(value))
  }

  function nodeName(node) {
    return compact(node?.['Node Name'] || node?.$Name || node?.Name || '')
  }

  function nodeType(node) {
    return compact(node?.['Node Type'] || node?.$Type || '')
  }

  function nodeUrl(node) {
    return compact(node?.$URL || node?.URL || '')
  }

  function escapeXml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function nodeFieldTexts(node) {
    const texts = [nodeName(node), nodeType(node)]
    for (const [key, value] of Object.entries(node || {})) {
      if (/url/i.test(key)) continue
      if (typeof value === 'string' || typeof value === 'number') {
        texts.push(value)
      } else if (Array.isArray(value)) {
        value.forEach(item => {
          if (typeof item === 'string' || typeof item === 'number') texts.push(item)
        })
      }
    }
    return texts.map(compact).filter(Boolean)
  }

  function nodeContainsStyleCode(node, styleCode) {
    const needle = normalizeToken(styleCode)
    if (!needle) return false
    return nodeFieldTexts(node).some(text => normalizeToken(text).includes(needle))
  }

  function isStyleNode(node) {
    const type = nodeType(node)
    if (!type) return false
    if (type === 'Style') return true
    if (/Style/i.test(type) && !/SizeChart|Dimension|Revision|Attribute|Sample/i.test(type)) return true
    return false
  }

  function asArray(value) {
    if (Array.isArray(value)) return value
    if (value == null || value === '') return []
    return [value]
  }

  function uniqueValues(values) {
    const seen = new Set()
    const output = []
    for (const raw of values || []) {
      const value = compact(raw)
      if (!value || seen.has(value)) continue
      seen.add(value)
      output.push(value)
    }
    return output
  }

  function findNodeByUrl(nodes, url) {
    const target = normalizeUrl(url)
    if (!target) return null
    return (nodes || []).find(node => normalizeUrl(nodeUrl(node)) === target) || null
  }

  function parentStyleFromNode(node, nodes) {
    const parentUrls = [
      node?.__Parent__,
      node?.Parent,
      node?.Master,
      node?.Style,
      node?.Product,
      node?.ParentStyle,
      node?.C8_Style,
    ].flatMap(asArray)

    for (const parentUrl of parentUrls) {
      const parent = findNodeByUrl(nodes, parentUrl)
      if (isStyleNode(parent)) return parent
      const grandParent = parent ? parentStyleFromNode(parent, nodes) : null
      if (grandParent) return grandParent
    }
    return null
  }

  function resolveStyleNode(nodes, styleCode = '', preferredUrl = '') {
    const allNodes = nodes || []
    const preferred = findNodeByUrl(allNodes, preferredUrl)
    if (isStyleNode(preferred)) return preferred

    const styleNodes = allNodes.filter(isStyleNode)
    const exactStyle = styleNodes.find(node => nodeContainsStyleCode(node, styleCode))
    if (exactStyle) return exactStyle

    const matchingNodes = allNodes.filter(node => nodeContainsStyleCode(node, styleCode))
    for (const node of matchingNodes) {
      if (isStyleNode(node)) return node
      const parent = parentStyleFromNode(node, allNodes)
      if (parent) return parent
    }

    if (preferred) {
      const parent = parentStyleFromNode(preferred, allNodes)
      if (parent) return parent
    }
    if (styleNodes.length === 1) return styleNodes[0]
    return null
  }

  function normalizeStyleCodes(rawValue) {
    const text = String(rawValue || '').replace(/[，、；;, \t]+/g, '\n')
    const codes = []
    for (const line of text.split(/\r?\n/)) {
      const cleaned = compact(line)
      if (!cleaned) continue
      const matches = cleaned.match(/[A-Za-z0-9][A-Za-z0-9_-]{5,}/g) || []
      if (matches.length) codes.push(...matches)
      else codes.push(cleaned)
    }
    return uniqueValues(codes.map(item => item.replace(/^款号[:：]?/, '')))
  }

  function targetStage() {
    return compact(params.stage || shared.stage || DEFAULT_STAGE) || DEFAULT_STAGE
  }

  function isDefaultStageRequest(stageName) {
    return normalizeToken(stageName || DEFAULT_STAGE) === normalizeToken(DEFAULT_STAGE)
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  function nextPhase(name, sleepMs = DEFAULT_DELAY_MS, nextShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: {
        action: 'next_phase',
        next_phase: name,
        sleep_ms: sleepMs,
        shared: nextShared,
      },
    }
  }

  function complete(data = [], nextShared = shared) {
    return {
      success: true,
      data,
      meta: {
        action: 'complete',
        has_more: false,
        shared: nextShared,
      },
    }
  }

  function fail(message, data = []) {
    return {
      success: false,
      data,
      error: compact(message) || 'PLM 尺码表下载失败',
    }
  }

  function parsePlmResponseText(rawText) {
    const text = String(rawText || '').trim()
    if (!text) return {}
    try {
      return JSON.parse(text)
    } catch (error) {
      // Centric returns JavaScript object literal text: ({Status:"Successful", ...})
    }

    try {
      return Function(`"use strict"; return (${text.replace(/^\s*\(|\)\s*$/g, '')});`)()
    } catch (error) {
      throw new Error(`PLM 接口返回无法解析：${error.message}`)
    }
  }

  function parsePlmNodes(payload) {
    const nodes = []
    const buckets = payload?.NODES && typeof payload.NODES === 'object' ? payload.NODES : {}
    for (const value of Object.values(buckets)) {
      if (Array.isArray(value)) nodes.push(...value)
    }
    return nodes.filter(item => item && typeof item === 'object')
  }

  function indexNodes(nodes) {
    const map = new Map()
    for (const node of nodes || []) {
      const url = nodeUrl(node)
      if (url) map.set(url, node)
    }
    return map
  }

  function buildRequestEntries({ urls = [], module = 'Search', operation = 'QueryByURL', depPaths = [], extra = {} }) {
    const entries = [
      ['Fmt.AC.Rights', 'Current'],
      ['Fmt.Attr.Info', 'Mid'],
      ['Crew.Scope', 'Result'],
      ['Fmt.Crew', 'Name'],
      ['Module', module],
      ['Operation', operation],
      ['OutputJSON', '1'],
    ]
    for (const [key, value] of Object.entries(extra || {})) {
      if (Array.isArray(value)) value.forEach(item => entries.push([key, item]))
      else if (value != null && value !== '') entries.push([key, value])
    }
    for (const url of asArray(urls)) entries.push(['Qry.URL', url])
    for (const depPath of depPaths || []) entries.push(['Dep.Path', depPath])
    return entries
  }

  function formDataFromEntries(entries) {
    const formData = new FormData()
    for (const [key, value] of entries) formData.append(key, value)
    return formData
  }

  function getCsrfToken() {
    if (location.hostname !== 'smplm.semirapp.com') throw new Error('请在已登录的森马 PLM 页面运行')
    const token = window.localStorage?.getItem('CSRFToken')
    if (!token) throw new Error('未取得森马 PLM 会话防护信息，请重新登录或刷新页面')
    return token
  }

  async function requestPlm(entries, options = {}) {
    const query = `&request.preventCache=${Date.now()}`
    const response = await fetch(`${REQUEST_HANDLER}${query}`, {
      method: 'POST',
      body: formDataFromEntries(entries),
      credentials: 'include',
      headers: { ...(options.headers || {}), 'X-CSRF-Token': getCsrfToken(), 'X-Requested-With': 'XMLHttpRequest' },
    })
    const rawText = await response.text()
    if (!response.ok) {
      throw new Error(`森马 PLM 接口 HTTP ${response.status}`)
    }
    const payload = parsePlmResponseText(rawText)
    const status = compact(payload?.Status || payload?.status)
    if (status && !/^Successful$/i.test(status)) {
      throw new Error(/csrf|token/i.test(String(payload?.ErrorAdmin || payload?.Error || '')) ? '森马 PLM 会话校验失败，请刷新登录页面' : `森马 PLM 接口状态异常：${status}`)
    }
    return {
      payload,
      nodes: parsePlmNodes(payload),
      rawText,
    }
  }

  async function queryByUrls(urls, depPaths = []) {
    const safeUrls = uniqueValues(asArray(urls).filter(isPlmUrl))
    if (!safeUrls.length) return { nodes: [], payload: {}, rawText: '' }
    return await requestPlm(buildRequestEntries({ urls: safeUrls, depPaths }))
  }

  function extractStyleCode(text) {
    const matches = String(text || '').match(/\d{9,}/g) || []
    return matches[matches.length - 1] || ''
  }

  function buildSearchXml(styleCode) {
    const escaped = escapeXml(styleCode)
    return [
      '<?xml version="1.0" encoding="utf-8" ?>',
      '<Query>',
      `  <Node Parameter="Name" Op="RE" Value="%${escaped}%"/>`,
      '  <Attribute Id="IsTemplate" Op="EQ" SValue="false"/>',
      '  <Node Parameter="Type" Op="EQ" Value="Style"/>',
      '</Query>',
    ].join('')
  }

  async function findStyleByCode(styleCode) {
    const entries = [
      ['Fmt.AC.Rights', 'No'], ['Fmt.Attr.Info', 'Mid'], ['Crew.Scope', 'No'],
      ['Fmt.Crew', 'Name'], ['Module', 'Search'], ['Operation', 'QueryByXML'],
      ['OutputJSON', '1'], ['Qry.Limit.Begin', '1'], ['Qry.Limit.End', '100'],
      ['Fmt.Complete.Max', '200'], ['Fmt.Complete', 'Ref'], ['Qry.XML', buildSearchXml(styleCode)],
      ['Dep.Path', 'Child:ParentSeason'],
    ]
    STYLE_DEP_PATHS.forEach(depPath => entries.push(['Dep.Path', depPath]))
    const result = await requestPlm(entries)
    if (result.payload?.HasMoreResults === true || result.payload?.HasMoreResults === 'true') {
      throw new Error(`款号 ${styleCode} 的查询结果未完整返回，请缩小查询范围`)
    }
    const matches = result.nodes.filter(node => nodeType(node) === 'Style' &&
      (nodeName(node) === styleCode || compact(node.Code) === styleCode))
    if (matches.length > 1) throw new Error(`款号 ${styleCode} 匹配多个款式，请人工核对`)
    if (!matches.length) {
      throw new Error(`当前账号按款号 ${styleCode} 未查询到款式，请核对权限、来源或款号`)
    }
    return { styleNode: matches[0], nodes: result.nodes, source: 'query_xml_name_re' }
  }

  function selectStageSizeChart(styleNode, nodes) {
    const styleUrl = normalizeUrl(nodeUrl(styleNode))
    const refs = new Set(asArray(styleNode?.DataSheets).map(normalizeUrl).filter(Boolean))
    const charts = nodes.filter(node => nodeType(node) === 'SizeChart' &&
      (refs.has(normalizeUrl(nodeUrl(node))) || normalizeUrl(node.__Parent__ || node.Master) === styleUrl))
    if (!charts.length) throw new Error(`款式 ${nodeName(styleNode)} 当前账号未读取到尺寸表，请核对权限或资料来源`)
    if (charts.length > 1) throw new Error(`款式 ${nodeName(styleNode)} 有 ${charts.length} 张尺寸表，请人工确认目标表`)
    const chart = charts[0]
    chart.__selectedStageName = '未确认'
    chart.__stageFallbackNote = '当前修订版；业务阶段未确认，请勿直接视为大货或初版'
    return chart
  }

  async function loadSizeChartDetail(sizeChartUrl) {
    const result = await queryByUrls(sizeChartUrl, SIZE_CHART_DEP_PATHS)
    const byUrl = indexNodes(result.nodes)
    const chart = byUrl.get(sizeChartUrl)
    if (!chart || nodeType(chart) !== 'SizeChart') throw new Error('无法读取目标尺寸表，请核对权限或重新登录')
    const revisionUrl = chart?.CurrentRevision
    if (!revisionUrl) throw new Error(`尺码表 ${sizeChartUrl} 没有 CurrentRevision`)

    let revision = byUrl.get(revisionUrl)
    let nodes = result.nodes
    if (!revision?.Items?.length) {
      const revisionResult = await queryByUrls(revisionUrl, [
        'Child:__Parent__',
        'Child:SizeRange',
        'Child:SizeRange/Child:Sizes',
        'Child:Sizes',
        'Child:Sizes/Child:Dimension1Size',
        'Child:Sizes/Child:Dimension2Size',
        'Child:SizeChartDimension1Sizes',
        'Child:SizeChartDimension2Sizes',
        'Child:SizeChartSubSizeRanges',
        'Child:SizeChartSubSizeRanges/Index:0/Child:BaseSize',
        'Child:Items',
        'Child:Items/Child:Actual',
        'Child:Items/Child:Original',
        'Child:Items/Child:MeasurementPoint',
      ])
      nodes = uniqueNodes([...result.nodes, ...revisionResult.nodes])
      const nextByUrl = indexNodes(nodes)
      revision = nextByUrl.get(revisionUrl)
    }

    if (!revision) throw new Error(`无法加载尺码表修订版 ${revisionUrl}`)
    return { chart, revision, nodes }
  }

  function uniqueNodes(nodes) {
    const byUrl = new Map()
    const output = []
    for (const node of nodes || []) {
      const url = nodeUrl(node)
      if (url && byUrl.has(url)) {
        Object.assign(byUrl.get(url), node)
        continue
      }
      if (url) byUrl.set(url, node)
      output.push(node)
    }
    return output
  }

  function cleanMeasurementName(name) {
    return compact(name).replace(/-复制$/, '')
  }

  function roundValue(value) {
    if (value == null || value === '') return ''
    const number = Number(value)
    if (!Number.isFinite(number)) return compact(value)
    const rounded = Math.round((number + Number.EPSILON) * 1000) / 1000
    return Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded)
  }

  function valuesFromIncrements(increments, baseIndex) {
    const values = Array.isArray(increments) ? increments.map(value => value === null || value === undefined || value === '' ? null : Number(value)) : []
    if (!values.length || !Number.isInteger(baseIndex) || baseIndex < 0 || baseIndex >= values.length) return []
    const output = new Array(values.length).fill('')
    const base = values[baseIndex]
    if (base === null || !Number.isFinite(base)) return output
    output[baseIndex] = base
    for (let i = baseIndex - 1; i >= 0; i--) {
      if (values[i] !== null && Number.isFinite(values[i]) && output[i + 1] !== '') output[i] = output[i + 1] + values[i]
    }
    for (let i = baseIndex + 1; i < values.length; i++) {
      if (values[i] !== null && Number.isFinite(values[i]) && output[i - 1] !== '') output[i] = output[i - 1] + values[i]
    }
    return output
  }

  function findBaseSizeIndex(revision, subSizeRange, sizes) {
    const baseUrl = subSizeRange?.BaseSize || revision?.BaseSize || ''
    if (baseUrl) {
      const index = sizes.findIndex(size => nodeUrl(size) === baseUrl)
      if (index >= 0) return index
    }
    const rawIndex = subSizeRange?.BaseSizeIndex
    const explicitIndex = rawIndex === null || rawIndex === undefined || rawIndex === '' ? NaN : Number(rawIndex)
    if (Number.isInteger(explicitIndex) && explicitIndex >= 0 && explicitIndex < sizes.length) return explicitIndex
    const baseName = normalizeToken(nodeName(subSizeRange?.BaseSize) || '')
    if (baseName) {
      const index = sizes.findIndex(size => normalizeToken(nodeName(size)) === baseName)
      if (index >= 0) return index
    }
    throw new Error('未能确定基础尺码，不能可靠计算尺码值')
  }

  function getSizeNodes(revision, byUrl) {
    const urls = asArray(revision?.Sizes).length
      ? asArray(revision.Sizes)
      : asArray(revision?.SizeChartDimension1Sizes)
    return urls.map(url => byUrl.get(url)).filter(Boolean)
  }

  function getSubSizeRange(revision, byUrl) {
    const url = asArray(revision?.SizeChartSubSizeRanges)[0]
    return url ? byUrl.get(url) : null
  }

  function describeRef(node, byUrl) {
    const refUrl = compact(node?.Actual || node?.Original || node?.MeasurementPoint || '')
    return byUrl.get(refUrl) || null
  }

  function formatBoolean(value) {
    if (value === true) return '是'
    if (value === false) return ''
    return compact(value)
  }

  function epochToLocalText(value) {
    const number = Number(value)
    if (!Number.isFinite(number) || number <= 0) return ''
    try {
      return new Date(number * 1000).toLocaleString('zh-CN', { hour12: false })
    } catch (error) {
      return ''
    }
  }

  function buildRowsForChart({ styleCode, styleNode, chart, revision, nodes, stageName, outputShape = 'both' }) {
    const byUrl = indexNodes(nodes)
    const sizes = getSizeNodes(revision, byUrl)
    const subSizeRange = getSubSizeRange(revision, byUrl)
    const baseIndex = findBaseSizeIndex(revision, subSizeRange, sizes)
    const sizeRefs = asArray(revision?.Sizes).length ? asArray(revision.Sizes) : asArray(revision?.SizeChartDimension1Sizes)
    if (!sizes.length || sizes.length !== sizeRefs.length) throw new Error('尺码表尺码为空或读取不完整')
    const selectedRefs = new Set(asArray(revision.SelectedSizes).map(normalizeUrl).filter(Boolean))
    const selectedKnown = selectedRefs.size > 0
    if (selectedKnown && [...selectedRefs].some(ref => !sizes.some(size => normalizeUrl(nodeUrl(size)) === ref))) {
      throw new Error('尺码表所选尺码无法完整解析')
    }
    const sizeScope = compact(params.size_scope || shared.size_scope || 'selected')
    if (!['selected', 'all'].includes(sizeScope)) throw new Error('不支持的尺码范围')
    if (sizeScope === 'selected' && !selectedKnown) throw new Error('尺码表未提供所选尺码，无法确认导出范围；可改选全部尺码并人工核对')
    const exportSizes = sizes.map((size, index) => ({ size, index, selected: selectedRefs.has(normalizeUrl(nodeUrl(size))) }))
      .filter(item => sizeScope === 'all' || item.selected)
    const sizeNames = exportSizes.map(({ size }) => nodeName(size))
    if (sizeNames.some(name => !name) || new Set(sizeNames).size !== sizeNames.length) throw new Error('尺码名称缺失或重复，不能可靠导出')
    const baseSizeName = nodeName(sizes[baseIndex]) || nodeName(byUrl.get(subSizeRange?.BaseSize)) || ''
    const sizeRangeName = nodeName(byUrl.get(revision.SizeRange)) || nodeName(byUrl.get(subSizeRange?.SubrangeSizeRange)) || ''
    const items = asArray(revision.Items).map(url => byUrl.get(url)).filter(Boolean)
    const selectedStageName = '未确认'
    const fallbackNote = compact(chart.__stageFallbackNote || '')

    const common = {
      款号: styleCode || extractStyleCode(nodeName(styleNode)),
      款式名称: nodeName(styleNode),
      款式URL: nodeUrl(styleNode),
      尺码表阶段: selectedStageName,
      尺码表名称: nodeName(chart),
      尺码表URL: nodeUrl(chart),
      修订版: nodeName(revision),
      修订版URL: nodeUrl(revision),
      状态: compact(revision.State || chart.State || ''),
      尺码范围: sizeRangeName || nodeName(subSizeRange),
      基础尺码: baseSizeName,
      已选尺码: selectedKnown ? sizes.filter(size => selectedRefs.has(normalizeUrl(nodeUrl(size)))).map(nodeName).join(' / ') : '未提供',
      导出范围: sizeScope === 'selected' ? '页面所选尺码' : '全部尺码',
      抓取时间: new Date().toISOString(),
    }

    if (!items.length || items.length !== asArray(revision.Items).length) throw new Error('测量点为空或读取不完整')
    const wideRows = []
    const longRows = []
    items.forEach((item, index) => {
      const ref = describeRef(item, byUrl)
      if (asArray(item.Increments).length !== sizes.length) throw new Error(`测量点 ${index + 1} 的尺码值不完整`)
      const values = valuesFromIncrements(item.Increments, baseIndex)
      const measurementName = cleanMeasurementName(nodeName(ref) || nodeName(item))
      const measurementBase = {
        测量点序号: index + 1,
        测量点: measurementName,
        测量点编码: compact(ref?.DimDescAlt1 || item.Actual || item.Original || item.MeasurementPoint || ''),
        描述: compact(ref?.Description || item.Description || item.Comment || item['ReviewComment.Comment'] || ''),
        '公差(-)': roundValue(item.ToleranceNegative ?? item.InspectionToleranceNegative),
        '公差(+)': roundValue(item.Tolerance ?? item.InspectionTolerance),
      }
      const resultBase = {
        修改确认: formatBoolean(item.C8_SI_CONFIRM),
        抓取结果: '成功',
        备注: fallbackNote,
        抓取时间: common.抓取时间,
      }
      const wideRow = {
        __sheet_name: '宽表',
        输出表: '宽表',
        ...common,
        ...measurementBase,
      }
      sizeNames.forEach((sizeName, sizeIndex) => {
        wideRow[sizeName] = roundValue(values[exportSizes[sizeIndex].index])
      })
      Object.assign(wideRow, resultBase)
      wideRows.push(wideRow)

      const longBase = {
        __sheet_name: '长表',
        输出表: '长表',
        ...common,
        ...measurementBase,
        ...resultBase,
      }

      sizeNames.forEach((sizeName, sizeIndex) => {
        longRows.push({
          ...longBase,
          尺码: sizeName,
          尺码值: roundValue(values[exportSizes[sizeIndex].index]),
          页面所选: selectedKnown ? (exportSizes[sizeIndex].selected ? '是' : '否') : '未确认',
        })
      })
    })

    const shape = compact(outputShape || 'both')
    if (shape === 'wide') return wideRows
    if (shape === 'long') return longRows
    return [...wideRows, ...longRows]
  }

  function errorRow(styleCode, message, extra = {}) {
    return {
      __sheet_name: '错误',
      输出表: '错误',
      款号: styleCode,
      款式名称: extra.styleName || '',
      款式URL: extra.styleUrl || '',
      尺码表阶段: extra.stageName || targetStage(),
      尺码表名称: '',
      尺码表URL: '',
      修订版: '',
      修订版URL: '',
      状态: '',
      尺码范围: '',
      基础尺码: '',
      测量点序号: '',
      测量点: '',
      测量点编码: '',
      描述: '',
      '公差(-)': '',
      '公差(+)': '',
      尺码: '',
      尺码值: '',
      修改确认: '',
      抓取结果: '失败',
      备注: compact(message),
      抓取时间: new Date().toISOString(),
    }
  }

  function buildRunShared(styleCodes, overrides = {}) {
    const targetCodes = uniqueValues(styleCodes || shared.target_style_codes || [])
    const currentIndex = Number.isInteger(Number(overrides.current_index))
      ? Number(overrides.current_index)
      : Number(shared.current_index || 0)
    const completedCount = Number.isInteger(Number(overrides.completed_count))
      ? Number(overrides.completed_count)
      : Number(shared.completed_count || 0)
    const successCount = Number.isInteger(Number(overrides.success_count))
      ? Number(overrides.success_count)
      : Number(shared.success_count || 0)
    const failedCount = Number.isInteger(Number(overrides.failed_count))
      ? Number(overrides.failed_count)
      : Number(shared.failed_count || 0)
    const currentCode = overrides.current_buyer_id !== undefined
      ? compact(overrides.current_buyer_id)
      : compact(targetCodes[currentIndex] || shared.current_buyer_id || '')
    return {
      ...shared,
      target_style_codes: targetCodes,
      style_codes: targetCodes,
      stage: targetStage(),
      output_shape: params.output_shape || shared.output_shape || 'both',
      size_scope: params.size_scope || shared.size_scope || 'selected',
      total_rows: targetCodes.length,
      current_index: currentIndex,
      completed_count: completedCount,
      current_exec_no: Math.min(targetCodes.length, Math.max(1, completedCount + 1)),
      current_row_no: currentIndex + 1,
      current_buyer_id: currentCode,
      current_store: targetStage(),
      success_count: successCount,
      failed_count: failedCount,
      ...overrides,
    }
  }

  async function collectOneStyle(styleCode, options = {}) {
    const stageName = compact(options.stageName || targetStage())
    const found = await findStyleByCode(styleCode)
    const styleNode = found.styleNode
    const chart = selectStageSizeChart(styleNode, found.nodes)
    const detail = await loadSizeChartDetail(nodeUrl(chart))
    const nodes = uniqueNodes([...found.nodes, ...detail.nodes])
    const selectedChart = detail.chart || chart
    selectedChart.__selectedStageName = chart.__selectedStageName || selectedChart.__selectedStageName
    selectedChart.__stageFallbackNote = chart.__stageFallbackNote || selectedChart.__stageFallbackNote
    return buildRowsForChart({
      styleCode,
      styleNode,
      chart: selectedChart,
      revision: detail.revision,
      nodes,
      stageName,
      outputShape: options.outputShape || params.output_shape || 'both',
    })
  }

  function prepareRun() {
    const styleCodes = normalizeStyleCodes(params.style_codes)
    if (!styleCodes.length) throw new Error('请至少输入一个款号')
    return buildRunShared(styleCodes, {
      current_index: 0,
      completed_count: 0,
      success_count: 0,
      failed_count: 0,
      current_exec_no: 1,
      current_row_no: 1,
      current_buyer_id: styleCodes[0],
    })
  }

  async function collectStylePhase() {
    const styleCodes = uniqueValues(shared.target_style_codes || normalizeStyleCodes(params.style_codes))
    if (!styleCodes.length) throw new Error('请至少输入一个款号')
    const index = Math.min(Math.max(Number(shared.current_index || 0), 0), styleCodes.length)
    if (index >= styleCodes.length) {
      return complete([], buildRunShared(styleCodes, {
        current_index: styleCodes.length,
        completed_count: styleCodes.length,
        current_exec_no: styleCodes.length,
        current_buyer_id: '',
      }))
    }

    const styleCode = styleCodes[index]
    let rows = []
    let successCount = Number(shared.success_count || 0)
    let failedCount = Number(shared.failed_count || 0)
    try {
      rows = await collectOneStyle(styleCode, {
        stageName: shared.stage || targetStage(),
        outputShape: shared.output_shape || params.output_shape || 'both',
      })
      if (!rows.length) throw new Error('没有生成尺码数据')
      successCount += 1
    } catch (error) {
      rows = [errorRow(styleCode, error.message, { stageName: shared.stage || targetStage() })]
      failedCount += 1
    }

    const nextIndex = index + 1
    const done = nextIndex >= styleCodes.length
    const nextShared = buildRunShared(styleCodes, {
      current_index: nextIndex,
      completed_count: nextIndex,
      current_exec_no: done ? styleCodes.length : nextIndex + 1,
      current_row_no: done ? styleCodes.length : nextIndex + 1,
      current_buyer_id: done ? styleCode : styleCodes[nextIndex],
      success_count: successCount,
      failed_count: failedCount,
      last_style_code: styleCode,
      last_result: rows.some(row => row.抓取结果 === '成功') ? '成功' : '失败',
    })
    if (done) return complete(rows, nextShared)
    return nextPhase('collect_style', DEFAULT_DELAY_MS, nextShared, rows)
  }

  if (testExports) {
    Object.assign(testExports, {
      normalizeStyleCodes,
      parsePlmResponseText,
      parsePlmNodes,
      indexNodes,
      buildRequestEntries,
      valuesFromIncrements,
      buildRowsForChart,
      selectStageSizeChart,
      cleanMeasurementName,
      roundValue,
      findBaseSizeIndex,
      errorRow,
      buildSearchXml,
      resolveStyleNode,
      buildRunShared,
      prepareRun,
    })
    return { success: true, data: [], meta: { has_more: false } }
  }

  try {
    if (phase === 'main') {
      getCsrfToken()
      const runShared = prepareRun()
      return nextPhase('collect_style', 0, runShared)
    }
    if (phase === 'collect_style') return await collectStylePhase()
    return complete([])
  } catch (error) {
    return fail(error.message)
  }
})()
