;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const PLM_HOME_URL = 'http://plm.balabala.com/WebAccess/home.html'
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

  function styleUrlFromHref(href) {
    const match = String(href || '').match(/(?:#URL=|[?&]URL=)([^&]+)/)
    return match ? decodeURIComponent(match[1]) : ''
  }

  function firstTitleSegment() {
    return compact(String(document.title || '').split(' - ')[0].split('>')[0])
  }

  function currentStyleFromDom() {
    const href = String(location.href || '')
    const currentUrl = styleUrlFromHref(href)
    const titleStyleName = firstTitleSegment()
    const titleStyleCode = extractStyleCode(titleStyleName)
    if (/^C\d+/.test(currentUrl) && titleStyleCode) {
      return { styleUrl: currentUrl, styleName: titleStyleName, styleCode: titleStyleCode }
    }

    const scopedSelectors = [
      '.csi-breadcrumb-view a.browse[href*="#URL=C"]',
      '.csi-breadcrumb-view [data-csi-url]',
      '.breadcrumb a[href*="#URL=C"]',
      '.breadcrumb [data-csi-url]',
      '.breadcrumbs a[href*="#URL=C"]',
      '.breadcrumbs [data-csi-url]',
      '[id*="breadcrumb"] a[href*="#URL=C"]',
      '[class*="breadcrumb"] a[href*="#URL=C"]',
      'a.browse[href*="#URL=C"]',
      '#searchResultsGrid a[href*="#URL=C"]',
      '#searchResultsGrid [data-csi-url]',
    ]
    const seenElements = new Set()
    const crumbs = [...document.querySelectorAll(scopedSelectors.join(','))]
      .filter(el => {
        if (seenElements.has(el)) return false
        seenElements.add(el)
        return true
      })
      .map(el => ({
        text: compact(el.innerText || el.textContent || el.title),
        href: compact(el.href || ''),
        url: compact(el.getAttribute?.('data-csi-url') || ''),
      }))
    const styleCrumb = crumbs.find(item => /\d{9,}/.test(item.text) && /^C\d+/.test(styleUrlFromHref(item.href)))
      || crumbs.find(item => /\d{9,}/.test(item.text) && /^C\d+/.test(item.url))
    const styleUrl = styleUrlFromHref(styleCrumb?.href) || styleCrumb?.url || ''
    const styleName = styleCrumb?.text || ''
    const styleCode = extractStyleCode(styleName)
    return { styleUrl, styleName, styleCode }
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
    const current = currentStyleFromDom()
    if (current.styleUrl && (!styleCode || current.styleCode === styleCode || current.styleName.includes(styleCode))) {
      const result = await queryByUrls(current.styleUrl, STYLE_DEP_PATHS)
      const styleNode = resolveStyleNode(result.nodes, styleCode, current.styleUrl)
      if (styleNode) return { styleNode, nodes: result.nodes, source: 'current_page' }
    }

    const apiSearch = await searchStyleByXml(styleCode)
    if (apiSearch?.styleNode) return apiSearch

    const directSearch = await searchStyleByDomGrid(styleCode)
    if (directSearch?.styleUrl) {
      const result = await queryByUrls(directSearch.styleUrl, STYLE_DEP_PATHS)
      const styleNode = resolveStyleNode(result.nodes, styleCode, directSearch.styleUrl)
      if (styleNode) return { styleNode, nodes: result.nodes, source: directSearch.source || 'header_search' }
    }

    throw new Error(`未找到款号 ${styleCode} 对应的 PLM 款式`)
  }

  async function searchStyleByXml(styleCode) {
    try {
      const entries = [
        ['Fmt.AC.Rights', 'No'],
        ['Fmt.Attr.Info', 'Mid'],
        ['Crew.Scope', 'No'],
        ['Fmt.Crew', 'Name'],
        ['Module', 'Search'],
        ['Operation', 'QueryByXML'],
        ['OutputJSON', '1'],
        ['Qry.Limit.Begin', '1'],
        ['Qry.Limit.End', '20'],
        ['Fmt.Complete.Max', '200'],
        ['Fmt.Complete', 'Ref'],
        ['Qry.XML', buildSearchXml(styleCode)],
        ['Dep.Path', 'Child:ParentSeason'],
      ]
      STYLE_DEP_PATHS.forEach(depPath => entries.push(['Dep.Path', depPath]))
      const result = await requestPlm(entries)
      const styleNode = resolveStyleNode(result.nodes, styleCode)
      if (!styleNode) return null
      return { styleNode, nodes: result.nodes, source: 'query_xml_name_re' }
    } catch (error) {
      return null
    }
  }

  async function searchStyleByDomGrid(styleCode) {
    if (!styleCode || !document.querySelector('#headerSearchText')) return null
    const input = document.querySelector('#headerSearchText')
    const beforeText = compact(document.querySelector('#searchResultsGrid')?.innerText || '')
    const inputWidget = getDijitWidget(input)
    if (inputWidget?.set) inputWidget.set('value', styleCode)
    input.value = styleCode
    input.focus?.()
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))

    const form = input.closest('form')
    const searchWidget = getDijitWidget(document.querySelector('#dijit__WidgetsInTemplateMixin_0'))
      || getDijitWidget(form)
    const submitButton = document.querySelector('.header-search-button, [widgetid="dijit_form_Button_0"]')
    const buttonWidget = getDijitWidget(submitButton)

    if (searchWidget?._onSubmit) searchWidget._onSubmit({ preventDefault() {}, stopPropagation() {} })
    else if (searchWidget?.onSubmit) searchWidget.onSubmit({ preventDefault() {}, stopPropagation() {} })
    else if (buttonWidget?.onClick) buttonWidget.onClick()
    else if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    else submitButton?.click()

    const refreshed = await waitFor(() => {
      const text = compact(document.querySelector('#searchResultsGrid')?.innerText || '')
      return text.includes(styleCode) && text !== beforeText && !/加载中/.test(text)
    }, 12000, 250)
    if (!refreshed) return null

    const resultLinks = [...document.querySelectorAll('#searchResultsGrid a[href*="#URL=C"], #searchResultsGrid [data-csi-url]')]
      .map(element => ({
        text: compact(element.innerText || element.textContent || element.title || element.closest('[id*="row"], .dgrid-row, .csi-card')?.innerText),
        href: compact(element.href || ''),
        dataUrl: compact(element.getAttribute?.('data-csi-url') || element.closest?.('[data-csi-url]')?.getAttribute('data-csi-url') || ''),
      }))
      .filter(item => item.text.includes(styleCode))

    const matched = resultLinks.find(item => item.text.includes(styleCode)) || resultLinks[0]
    const url = matched?.href?.match(/#URL=([^&]+)/)?.[1]
      ? decodeURIComponent(matched.href.match(/#URL=([^&]+)/)[1])
      : matched?.dataUrl || ''
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
      resolveStyleNode,
      currentStyleFromDom,
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
