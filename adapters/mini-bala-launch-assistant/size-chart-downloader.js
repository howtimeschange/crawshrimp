;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const PLM_HOME_URL = 'https://plm.balabala.com/WebAccess/home.html'
  const REQUEST_HANDLER = '/csi-requesthandler/RequestHandler?'
  const DEFAULT_STAGE = '大货'
  const STAGE_FALLBACK_ORDER = ['大货', '订货', '试销单', '内评', '初版']
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

  function isStyleNode(node) {
    return nodeType(node) === 'Style'
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

  async function requestPlm(entries) {
    if (location.hostname !== 'plm.balabala.com') throw new Error('请在已登录的巴拉 PLM 页面运行迷你巴拉下载器')
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10000)
      let retryable = false
      try {
        const response = await fetch(`${REQUEST_HANDLER}&request.preventCache=${Date.now()}`, {
          method: 'POST', body: formDataFromEntries(entries), credentials: 'include', signal: controller.signal,
        })
        if (!response.ok) {
          retryable = response.status === 429 || response.status >= 500
          throw new Error(`PLM 查询接口 HTTP ${response.status}`)
        }
        const rawText = await response.text()
        if (/^\s*</.test(rawText) || /\/login\.html/i.test(response.url || '')) throw new Error('PLM 登录已失效或返回非数据页面，请重新登录')
        const payload = parsePlmResponseText(rawText)
        const status = compact(payload?.Status || payload?.status)
        // Centric represents a successful empty search as NODES:"".
        const emptyResult = payload.NODES === '' && String(payload.HasMoreResults) === 'false'
        if (status !== 'Successful' || (!emptyResult && (!payload.NODES || typeof payload.NODES !== 'object'))) {
          throw new Error(`PLM 查询未成功：${status || '响应缺少状态或节点数据'}；请检查会话和访问权限`)
        }
        return { payload, nodes: parsePlmNodes(payload) }
      } catch (error) {
        retryable = retryable || error.name === 'AbortError' || error.name === 'TypeError'
        if (attempt === 1 || !retryable) {
          throw new Error(error.name === 'AbortError' ? 'PLM 查询超时（已重试），请稍后重试' : error.message)
        }
      } finally {
        clearTimeout(timer)
      }
      await sleep(500)
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

  function buildSearchXml(styleCode, mode = 'code') {
    const escaped = escapeXml(styleCode)
    const condition = mode === 'code'
      ? `<Attribute Id="C8_Style_ProductCode" Op="EQ" SValue="${escaped}"/>`
      : `<Node Parameter="Name" Op="RE" Value="%${escaped}%"/>`
    return `<Query>${condition}<Attribute Id="IsTemplate" Op="EQ" SValue="false"/><Node Parameter="Type" Op="EQ" Value="Style"/></Query>`
  }

  function exactStyleMatch(node, styleCode, mode) {
    if (!isStyleNode(node) || node.IsTemplate === true) return false
    const productCode = compact(node.C8_Style_ProductCode)
    if (productCode) return productCode === styleCode
    return mode === 'name' && (nodeName(node).match(/[A-Za-z0-9_-]+/g) || []).includes(styleCode)
  }

  async function searchStyleByXml(styleCode, mode) {
    const matches = new Map()
    const seenPages = new Set()
    for (let begin = 1; ; begin += 100) {
      const result = await requestPlm([
        ['Module', 'Search'], ['Operation', 'QueryByXML'], ['OutputJSON', '1'],
        ['Qry.XML', buildSearchXml(styleCode, mode)],
        ['Qry.Limit.Begin', String(begin)], ['Qry.Limit.End', String(begin + 99)],
      ])
      const roots = result.nodes.filter(isStyleNode)
      for (const node of roots) {
        if (exactStyleMatch(node, styleCode, mode)) matches.set(nodeUrl(node), node)
      }
      if (matches.size > 1) throw new Error(`款号 ${styleCode} 匹配到多个款式，需人工确认`)
      if (roots.length < 100) break
      const fingerprint = roots.map(nodeUrl).sort().join('|')
      if (seenPages.has(fingerprint)) throw new Error('PLM 查询分页重复，无法确认唯一款式')
      seenPages.add(fingerprint)
    }
    return [...matches.values()][0] || null
  }

  async function findStyleByCode(styleCode) {
    // No current-page shortcut: a size-chart URL is not a Style URL. Avoid
    // following cyclic __Parent__ links or inheriting a season/UI search scope.
    const style = await searchStyleByXml(styleCode, 'code')
      || await searchStyleByXml(styleCode, 'name')
    if (!style) throw new Error(`查询成功，但当前账号可见范围内未找到款号 ${styleCode}（大货款号、款式名称均无精确匹配）`)
    const detail = await queryByUrls(nodeUrl(style), STYLE_DEP_PATHS)
    const styleNode = findNodeByUrl(detail.nodes, nodeUrl(style))
    if (!styleNode || !isStyleNode(styleNode)) throw new Error(`已找到款号 ${styleCode}，但款式详情读取失败`)
    return { styleNode, nodes: detail.nodes }
  }

  function cleanStageName(value) {
    return compact(value).replace(/^C8_[^:：]+[:：]/, '')
  }

  function chartStageLabel(chart, byUrl) {
    const values = [
      nodeName(byUrl.get(chart?.C8_SC_Stage)),
      cleanStageName(chart?.C8_SC_Stage),
      nodeName(byUrl.get(chart?.Subtype)),
      cleanStageName(chart?.Subtype),
      nodeName(chart).replace(/_?尺寸表.*$/, ''),
    ].map(cleanStageName).filter(Boolean)

    for (const stage of STAGE_FALLBACK_ORDER) {
      if (values.some(value => normalizeToken(value).includes(normalizeToken(stage)))) return stage
    }
    return cleanStageName(values[0] || '')
  }

  function chartStagePriority(label) {
    const normalized = normalizeToken(label)
    const index = STAGE_FALLBACK_ORDER.findIndex(stage => normalized.includes(normalizeToken(stage)))
    return index >= 0 ? STAGE_FALLBACK_ORDER.length - index : 0
  }

  function selectStageSizeChart(styleNode, nodes, stageName = DEFAULT_STAGE) {
    const byUrl = indexNodes(nodes)
    const styleUrl = nodeUrl(styleNode)
    const dataSheetUrls = new Set([...asArray(styleNode?.DataSheets), ...asArray(styleNode?.SizeCharts)].map(normalizeUrl).filter(Boolean))
    const chartCandidates = nodes.filter(node => {
      if (nodeType(node) !== 'SizeChart') return false
      const parent = normalizeUrl(node.__Parent__ || node.Master)
      const url = normalizeUrl(nodeUrl(node))
      return dataSheetUrls.has(url) || (styleUrl && parent === normalizeUrl(styleUrl))
    })

    const stageNeedle = normalizeToken(stageName)
    const scored = chartCandidates.map(chart => {
      const name = nodeName(chart)
      const subtypeName = nodeName(byUrl.get(chart.Subtype)) || compact(chart.Subtype)
      const stageRefName = chartStageLabel(chart, byUrl) || nodeName(byUrl.get(chart.C8_SC_Stage)) || compact(chart.C8_SC_Stage)
      const haystack = normalizeToken([name, subtypeName, stageRefName, chart.C8_SC_Stage].join(' '))
      let score = 0
      if (stageNeedle && haystack.includes(stageNeedle)) score += 10
      if (/大货/.test(name)) score += stageNeedle === normalizeToken('大货') ? 5 : 1
      if (chart.CurrentRevision) score += 2
      score += chartStagePriority(stageRefName)
      return { chart, score, name, subtypeName, stageRefName }
    }).sort((a, b) => b.score - a.score)

    const selected = scored[0]?.chart
    if (!selected) throw new Error(`款式 ${nodeName(styleNode)} 没有找到尺寸表单中的尺码表`)
    if (stageNeedle && scored[0].score < 10) {
      if (isDefaultStageRequest(stageName)) {
        const fallback = scored[0]
        const actualStage = fallback.stageRefName || chartStageLabel(fallback.chart, byUrl) || nodeName(fallback.chart)
        fallback.chart.__selectedStageName = actualStage
        fallback.chart.__stageFallbackNote = `未找到「${stageName}」阶段，已自动选择「${actualStage}」阶段尺码表`
        return fallback.chart
      }
      const availableStages = uniqueValues(scored.map(item => item.stageRefName).filter(Boolean))
      const suffix = availableStages.length ? `；可用阶段：${availableStages.join('、')}` : ''
      throw new Error(`款式 ${nodeName(styleNode)} 没有找到阶段为「${stageName}」的尺码表${suffix}`)
    }
    selected.__selectedStageName = scored[0].stageRefName || stageName
    return selected
  }

  async function loadSizeChartDetail(sizeChartUrl) {
    const result = await queryByUrls(sizeChartUrl, SIZE_CHART_DEP_PATHS)
    const byUrl = indexNodes(result.nodes)
    const chart = byUrl.get(sizeChartUrl) || result.nodes.find(node => nodeType(node) === 'SizeChart')
    const revisionUrl = chart?.CurrentRevision || result.nodes.find(node => nodeType(node) === 'SizeChartRevision')?.$URL
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
    const values = Array.isArray(increments) ? increments.map(Number) : []
    if (!values.length) return []
    const base = Number.isFinite(Number(values[baseIndex])) ? Number(values[baseIndex]) : 0
    const output = new Array(values.length).fill('')
    output[baseIndex] = base
    for (let index = baseIndex - 1; index >= 0; index -= 1) {
      const delta = Number(values[index])
      output[index] = Number.isFinite(delta) && output[index + 1] !== '' ? output[index + 1] + delta : ''
    }
    for (let index = baseIndex + 1; index < values.length; index += 1) {
      const delta = Number(values[index])
      output[index] = Number.isFinite(delta) && output[index - 1] !== '' ? output[index - 1] + delta : ''
    }
    return output
  }

  function findBaseSizeIndex(revision, subSizeRange, sizes) {
    const baseUrl = subSizeRange?.BaseSize || revision?.BaseSize || ''
    if (baseUrl) {
      const index = sizes.findIndex(size => nodeUrl(size) === baseUrl)
      if (index >= 0) return index
    }
    const explicitIndex = Number(subSizeRange?.BaseSizeIndex)
    if (Number.isInteger(explicitIndex) && explicitIndex >= 0 && explicitIndex < sizes.length) return explicitIndex
    const baseName = normalizeToken(nodeName(subSizeRange?.BaseSize) || '')
    if (baseName) {
      const index = sizes.findIndex(size => normalizeToken(nodeName(size)) === baseName)
      if (index >= 0) return index
    }
    return Math.max(0, Math.floor(sizes.length / 2))
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
    const sizeNames = sizes.map(nodeName)
    const baseSizeName = nodeName(sizes[baseIndex]) || nodeName(byUrl.get(subSizeRange?.BaseSize)) || ''
    const sizeRangeName = nodeName(byUrl.get(revision.SizeRange)) || nodeName(byUrl.get(subSizeRange?.SubrangeSizeRange)) || ''
    const items = asArray(revision.Items).map(url => byUrl.get(url)).filter(Boolean)
    const selectedStageName = compact(chart.__selectedStageName || stageName)
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
      抓取时间: new Date().toISOString(),
    }

    const wideRows = []
    const longRows = []
    items.forEach((item, index) => {
      const ref = describeRef(item, byUrl)
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
        wideRow[sizeName] = roundValue(values[sizeIndex])
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
          尺码值: roundValue(values[sizeIndex]),
        })
      })
    })

    if (!wideRows.length || !sizeNames.length) throw new Error('尺码表没有可导出的测量点或尺码，不能标记成功')
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
    const chart = selectStageSizeChart(styleNode, found.nodes, stageName)
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

  async function collectAllStyles() {
    const styleCodes = normalizeStyleCodes(params.style_codes)
    if (!styleCodes.length) throw new Error('请至少输入一个款号')
    const stageName = targetStage()
    const rows = []
    for (let index = 0; index < styleCodes.length; index += 1) {
      const styleCode = styleCodes[index]
      try {
        const collected = await collectOneStyle(styleCode, {
          stageName,
          outputShape: params.output_shape || 'both',
        })
        rows.push(...collected)
      } catch (error) {
        rows.push(errorRow(styleCode, error.message, { stageName }))
      }
      if (index < styleCodes.length - 1) await sleep(DEFAULT_DELAY_MS)
    }
    return rows
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
      exactStyleMatch,
      findStyleByCode,
      requestPlm,
      buildRunShared,
      prepareRun,
    })
    return { success: true, data: [], meta: { has_more: false } }
  }

  try {
    if (phase === 'main') {
      const runShared = prepareRun()
      return nextPhase('collect_style', 0, runShared)
    }
    if (phase === 'collect_style') return await collectStylePhase()
    return complete([])
  } catch (error) {
    return fail(error.message)
  }
})()
