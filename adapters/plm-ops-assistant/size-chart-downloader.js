;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const PLM_HOME_URL = 'http://plm.balabala.com/WebAccess/home.html'
  const REQUEST_HANDLER = '/csi-requesthandler/RequestHandler?'
  const DEFAULT_STAGE = '大货'
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
    return compact(value).replace(/^centric:$/, '')
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

  async function requestPlm(entries, options = {}) {
    const query = `&request.preventCache=${Date.now()}`
    const response = await fetch(`${REQUEST_HANDLER}${query}`, {
      method: 'POST',
      body: formDataFromEntries(entries),
      credentials: 'include',
      headers: options.headers || undefined,
    })
    const rawText = await response.text()
    if (!response.ok) {
      throw new Error(`PLM 接口 HTTP ${response.status}: ${rawText.slice(0, 300)}`)
    }
    const payload = parsePlmResponseText(rawText)
    const status = compact(payload?.Status || payload?.status)
    if (status && !/^Successful$/i.test(status)) {
      throw new Error(`PLM 接口状态异常：${status}`)
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

  function currentStyleFromDom() {
    const href = String(location.href || '')
    const hashMatch = href.match(/[#&?]URL=([^&]+)/)
    const currentUrl = hashMatch ? decodeURIComponent(hashMatch[1]) : ''
    const crumbs = [...document.querySelectorAll('a.browse, .crumb, .crumbSearch, [data-csi-url]')]
      .map(el => ({
        text: compact(el.innerText || el.textContent || el.title),
        href: compact(el.href || ''),
        url: compact(el.getAttribute?.('data-csi-url') || ''),
      }))
    const styleCrumb = crumbs.find(item => /\d{9,}/.test(item.text) && /\/WebAccess\/home\.html#URL=C\d+/.test(item.href))
      || crumbs.find(item => /\d{9,}/.test(item.text) && /^C\d+/.test(item.url))
    const styleUrl = styleCrumb?.href?.match(/#URL=([^&]+)/)?.[1]
      ? decodeURIComponent(styleCrumb.href.match(/#URL=([^&]+)/)[1])
      : styleCrumb?.url || (/^C\d+/.test(currentUrl) ? currentUrl : '')
    const styleName = styleCrumb?.text || compact(document.title.split('>')[0] || '')
    const styleCode = extractStyleCode(styleName)
    return { styleUrl, styleName, styleCode }
  }

  function extractStyleCode(text) {
    const matches = String(text || '').match(/\d{9,}/g) || []
    return matches[matches.length - 1] || ''
  }

  function buildSearchXml(styleCode) {
    const escaped = String(styleCode || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    return [
      '<Query>',
      '  <Node Parameter="Type" Op="EQ" Value="Style"/>',
      `  <Attribute Id="Node Name" Op="MATCHES" Value="${escaped}"/>`,
      '</Query>',
    ].join('')
  }

  async function findStyleByCode(styleCode) {
    const current = currentStyleFromDom()
    if (current.styleUrl && (!styleCode || current.styleCode === styleCode || current.styleName.includes(styleCode))) {
      const result = await queryByUrls(current.styleUrl, STYLE_DEP_PATHS)
      const styleNode = result.nodes.find(node => nodeUrl(node) === current.styleUrl) || result.nodes.find(node => nodeType(node) === 'Style')
      if (styleNode) return { styleNode, nodes: result.nodes, source: 'current_page' }
    }

    const directSearch = await searchStyleByDomGrid(styleCode)
    if (directSearch?.styleUrl) {
      const result = await queryByUrls(directSearch.styleUrl, STYLE_DEP_PATHS)
      const styleNode = result.nodes.find(node => nodeUrl(node) === directSearch.styleUrl) || result.nodes.find(node => nodeType(node) === 'Style')
      if (styleNode) return { styleNode, nodes: result.nodes, source: directSearch.source || 'header_search' }
    }

    const apiSearch = await searchStyleByXml(styleCode)
    if (apiSearch?.styleNode) return apiSearch

    throw new Error(`未找到款号 ${styleCode} 对应的 PLM 款式`)
  }

  async function searchStyleByXml(styleCode) {
    try {
      const result = await requestPlm(buildRequestEntries({
        module: 'Search',
        operation: 'QueryByXML',
        depPaths: STYLE_DEP_PATHS,
        extra: {
          'Qry.XML': buildSearchXml(styleCode),
          'Qry.Limit.Begin': '0',
          'Qry.Limit.End': String(DEFAULT_PAGE_SIZE - 1),
          'Fmt.Complete.Max': String(DEFAULT_PAGE_SIZE),
        },
      }))
      const candidates = result.nodes.filter(node => nodeType(node) === 'Style' || /\d{9,}/.test(nodeName(node)))
      const exact = candidates.find(node => nodeName(node).includes(styleCode)) || candidates[0]
      if (!exact) return null
      return { styleNode: exact, nodes: result.nodes, source: 'query_xml' }
    } catch (error) {
      return null
    }
  }

  async function searchStyleByDomGrid(styleCode) {
    if (!styleCode || !document.querySelector('#headerSearchText')) return null
    const input = document.querySelector('#headerSearchText')
    const inputWidget = getDijitWidget(input)
    if (inputWidget?.set) inputWidget.set('value', styleCode)
    else {
      input.value = styleCode
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }

    const form = input.closest('form')
    const formWidget = getDijitWidget(form)
    const submitButton = document.querySelector('.header-search-button, [widgetid="dijit_form_Button_0"]')
    const buttonWidget = getDijitWidget(submitButton)

    if (formWidget?.onSubmit) formWidget.onSubmit()
    else if (buttonWidget?.onClick) buttonWidget.onClick()
    else if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    else submitButton?.click()

    await waitFor(() => {
      const text = compact(document.querySelector('#searchResultsGrid')?.innerText || '')
      return text.includes(styleCode) || /完成结果加载|总共\d+个结果/.test(text)
    }, 8000, 250)

    const resultLinks = [...document.querySelectorAll('#searchResultsGrid a[href*="#URL=C"], a.csi-card-anchor[href*="#URL=C"]')]
      .map(anchor => ({
        text: compact(anchor.innerText || anchor.textContent || anchor.title || anchor.closest('[id*="row"]')?.innerText),
        href: anchor.href,
      }))
      .filter(item => item.text.includes(styleCode) || item.href)

    const matched = resultLinks.find(item => item.text.includes(styleCode)) || resultLinks[0]
    const url = matched?.href?.match(/#URL=([^&]+)/)?.[1] ? decodeURIComponent(matched.href.match(/#URL=([^&]+)/)[1]) : ''
    return url ? { styleUrl: url, source: 'header_search_dom' } : null
  }

  function getDijitWidget(element) {
    if (!element || typeof require !== 'function') return null
    let widget = null
    try {
      require(['dijit/registry'], registry => {
        widget = registry.byNode(element) || registry.byId(element.id || element.getAttribute?.('widgetid') || '')
      })
    } catch (error) {
      return null
    }
    return widget
  }

  async function waitFor(check, timeoutMs = 8000, intervalMs = 250) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        if (check()) return true
      } catch (error) {
        // keep waiting
      }
      await sleep(intervalMs)
    }
    return false
  }

  function selectStageSizeChart(styleNode, nodes, stageName = DEFAULT_STAGE) {
    const byUrl = indexNodes(nodes)
    const styleUrl = nodeUrl(styleNode)
    const dataSheetUrls = new Set(asArray(styleNode?.DataSheets).map(normalizeUrl).filter(Boolean))
    const chartCandidates = nodes.filter(node => {
      if (nodeType(node) !== 'SizeChart') return false
      const parent = normalizeUrl(node.__Parent__ || node.Master)
      const url = normalizeUrl(nodeUrl(node))
      return dataSheetUrls.has(url) || !styleUrl || parent === styleUrl || nodeName(node).includes(extractStyleCode(nodeName(styleNode)))
    })

    const stageNeedle = normalizeToken(stageName)
    const scored = chartCandidates.map(chart => {
      const name = nodeName(chart)
      const subtypeName = nodeName(byUrl.get(chart.Subtype)) || compact(chart.Subtype)
      const stageRefName = nodeName(byUrl.get(chart.C8_SC_Stage)) || compact(chart.C8_SC_Stage)
      const haystack = normalizeToken([name, subtypeName, stageRefName].join(' '))
      let score = 0
      if (stageNeedle && haystack.includes(stageNeedle)) score += 10
      if (/大货/.test(name)) score += stageNeedle === normalizeToken('大货') ? 5 : 1
      if (chart.CurrentRevision) score += 2
      return { chart, score, name, subtypeName, stageRefName }
    }).sort((a, b) => b.score - a.score)

    const selected = scored[0]?.chart
    if (!selected) throw new Error(`款式 ${nodeName(styleNode)} 没有找到尺寸表单中的尺码表`)
    if (stageNeedle && scored[0].score < 10) {
      throw new Error(`款式 ${nodeName(styleNode)} 没有找到阶段为「${stageName}」的尺码表`)
    }
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

    const common = {
      款号: styleCode || extractStyleCode(nodeName(styleNode)),
      款式名称: nodeName(styleNode),
      款式URL: nodeUrl(styleNode),
      尺码表阶段: stageName,
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
        备注: '',
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

  async function collectOneStyle(styleCode, options = {}) {
    const stageName = compact(options.stageName || targetStage())
    const found = await findStyleByCode(styleCode)
    const styleNode = found.styleNode
    const chart = selectStageSizeChart(styleNode, found.nodes, stageName)
    const detail = await loadSizeChartDetail(nodeUrl(chart))
    const nodes = uniqueNodes([...found.nodes, ...detail.nodes])
    return buildRowsForChart({
      styleCode,
      styleNode,
      chart: detail.chart || chart,
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
    })
    return { success: true, data: [], meta: { has_more: false } }
  }

  if (phase !== 'main') return complete([])

  try {
    const rows = await collectAllStyles()
    const successRows = rows.filter(row => row.抓取结果 === '成功').length
    return complete(rows, {
      ...shared,
      stage: targetStage(),
      total_rows: rows.length,
      success_rows: successRows,
      failed_rows: rows.length - successRows,
    })
  } catch (error) {
    return fail(error.message)
  }
})()
