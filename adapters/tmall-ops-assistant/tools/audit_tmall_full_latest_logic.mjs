#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import {
  analyzePublishModel,
  browserInstallExpression,
  buildOcrAnchorsFromResults,
  classifyWhiteBlackFeature,
  CdpClient,
  extractSellManageItems,
  resolveCdpPage,
} from './probe_tmall_packaging_structure.mjs'

const DEFAULT_OUT_ROOT = '/private/tmp/tmall-packaging-structure-probe-10000'
const DEFAULT_CDP = 'http://127.0.0.1:9222'
const HANDLED_MODES = new Set(['anchored_replace', 'no_detail_images'])

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function compact(value) {
  return cleanText(value).replace(/\s+/g, '')
}

function arrayFromMaybe(value) {
  return Array.isArray(value) ? value : []
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0))))
}

function jitter(ms) {
  const max = Math.max(0, Number(ms || 0))
  return max ? Math.floor(Math.random() * max) : 0
}

function safeFilename(value, fallback = 'case') {
  const text = cleanText(value)
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
  return text || fallback
}

function writeDataUrlPng(file, dataUrl) {
  const match = String(dataUrl || '').match(/^data:image\/png;base64,(.+)$/)
  if (!match) throw new Error('screenshot is not PNG data URL')
  fs.writeFileSync(file, Buffer.from(match[1], 'base64'))
}

function csvEscape(value) {
  const text = cleanText(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function markdownCell(value) {
  return cleanText(value).replace(/\|/g, '\\|')
}

function parseArgs(argv) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '')
  const options = {
    outDir: path.join(DEFAULT_OUT_ROOT, `full-latest-logic-audit-${stamp}`),
    cdp: DEFAULT_CDP,
    pageId: '',
    limit: 12000,
    pageSize: 20,
    startPage: 1,
    resume: true,
    maxAttempts: 3,
    delayMs: 800,
    jitterMs: 400,
    listDelayMs: 1200,
    retryDelayMs: 5000,
    cooldownEvery: 100,
    cooldownMs: 20000,
    artifactEvery: 10,
    ocrAssetBaseUrl: 'http://127.0.0.1:18765',
    ocrPerImageTimeoutMs: 18000,
    visualPerImageTimeoutMs: 8000,
    timeoutMs: 1800000,
    screenshots: true,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--out') options.outDir = next, index += 1
    else if (arg === '--cdp') options.cdp = next, index += 1
    else if (arg === '--page-id') options.pageId = next, index += 1
    else if (arg === '--limit') options.limit = Number(next), index += 1
    else if (arg === '--page-size') options.pageSize = Number(next), index += 1
    else if (arg === '--start-page') options.startPage = Number(next), index += 1
    else if (arg === '--max-attempts') options.maxAttempts = Number(next), index += 1
    else if (arg === '--delay-ms') options.delayMs = Number(next), index += 1
    else if (arg === '--jitter-ms') options.jitterMs = Number(next), index += 1
    else if (arg === '--list-delay-ms') options.listDelayMs = Number(next), index += 1
    else if (arg === '--retry-delay-ms') options.retryDelayMs = Number(next), index += 1
    else if (arg === '--cooldown-every') options.cooldownEvery = Number(next), index += 1
    else if (arg === '--cooldown-ms') options.cooldownMs = Number(next), index += 1
    else if (arg === '--artifact-every') options.artifactEvery = Number(next), index += 1
    else if (arg === '--ocr-asset-base-url') options.ocrAssetBaseUrl = next, index += 1
    else if (arg === '--ocr-per-image-timeout-ms') options.ocrPerImageTimeoutMs = Number(next), index += 1
    else if (arg === '--visual-per-image-timeout-ms') options.visualPerImageTimeoutMs = Number(next), index += 1
    else if (arg === '--timeout-ms') options.timeoutMs = Number(next), index += 1
    else if (arg === '--no-resume') options.resume = false
    else if (arg === '--no-screenshots') options.screenshots = false
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`unknown arg: ${arg}`)
  }
  return options
}

function helpText() {
  return [
    'Usage: node adapters/tmall-ops-assistant/tools/audit_tmall_full_latest_logic.mjs [options]',
    '',
    'Full read-only audit for on-sale Tmall items: fetch detail, OCR/visual anchor, screenshot all detail images, retry failed/blocked items.',
    '',
    `  --out DIR          Output dir, default ${DEFAULT_OUT_ROOT}/full-latest-logic-audit-{timestamp}`,
    `  --cdp URL          Chrome CDP endpoint, default ${DEFAULT_CDP}`,
    '  --limit N          Max on-sale items, default 12000',
    '  --page-size N      On-sale list page size, default 20',
    '  --max-attempts N   Retry failed/blocked items up to N attempts, default 3',
    '  --no-screenshots   Skip contact-sheet PNGs',
    '  --no-resume        Ignore existing audit-results.jsonl in output dir',
  ].join('\n')
}

function safeParseJson(value, fallback = null) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value
  try {
    return JSON.parse(String(value || ''))
  } catch (error) {
    return fallback
  }
}

function extractPagination(data) {
  const raw = data?.result || data?.model || data
  const parsed = safeParseJson(raw, raw)
  const payload = parsed?.data || parsed?.result || parsed
  const table = payload?.table || payload?.data?.table || {}
  const pagination = table.pagination || payload?.pagination || payload?.data?.pagination || {}
  return {
    current: Number(pagination.current || pagination.pageNo || 0),
    pageSize: Number(pagination.pageSize || 0),
    total: Number(pagination.total || pagination.totalCount || payload?.total || 0),
  }
}

function imageEntriesFromSample(sample) {
  return arrayFromMaybe(sample?.pcDetail?.images)
    .filter(image => cleanText(image?.src))
    .map((image, index) => ({
      index: Number(image.globalIndex ?? index),
      imageIndex: Number(image.imageIndex ?? index),
      moduleIndex: Number(image.moduleIndex ?? 0),
      moduleName: cleanText(image.moduleName),
      url: cleanText(image.src),
      src: cleanText(image.src),
    }))
}

function imageListForAnchors(entries) {
  return entries.map(entry => ({
    globalIndex: entry.index,
    imageIndex: entry.imageIndex,
    moduleIndex: entry.moduleIndex,
    moduleName: entry.moduleName,
    src: entry.url,
  }))
}

function anchorPriority(kind) {
  const normalized = compact(kind)
  if (normalized === 'wanted_info') return 50
  if (normalized === 'wash_fallback') return 40
  if (normalized === 'white_black_fallback') return 30
  if (normalized === 'size' || normalized === 'visual_size') return 20
  if (normalized === 'lower_preserve' || normalized === 'visual_lower_preserve') return 10
  return 0
}

function shouldRunWhiteBlackFallback(anchors) {
  return anchorPriority(anchors?.stopAnchorKind) < anchorPriority('white_black_fallback')
}

function detectWhiteBlackFallback(entries, features, anchors) {
  if (!shouldRunWhiteBlackFallback(anchors)) return null
  const rawFixedTop = anchors?.fixedTopImageIndex
  const fixedTopIndex = Number(rawFixedTop)
  const minIndex = rawFixedTop !== null && rawFixedTop !== undefined && Number.isFinite(fixedTopIndex)
    ? fixedTopIndex + 1
    : 0
  const byIndex = new Map(arrayFromMaybe(features).map(feature => [Number(feature.index), feature]))
  for (const entry of entries) {
    if (Number(entry.index) < minIndex) continue
    const feature = byIndex.get(Number(entry.index))
    if (!classifyWhiteBlackFeature(feature)) continue
    return {
      stopImageIndex: Number(entry.index),
      stopAnchorKind: 'white_black_fallback',
      source: 'visual_canvas_white_black',
      confidence: 0.74,
      feature,
    }
  }
  return null
}

function mergeAnchors(ocrAnchors, visualFallback) {
  if (!visualFallback) return ocrAnchors
  if (anchorPriority(visualFallback.stopAnchorKind) <= anchorPriority(ocrAnchors?.stopAnchorKind)) return ocrAnchors
  return {
    ...ocrAnchors,
    ocrStatus: 'recognized',
    source: visualFallback.source,
    confidence: visualFallback.confidence,
    stopImageIndex: visualFallback.stopImageIndex,
    stopAnchorKind: visualFallback.stopAnchorKind,
    visualFeature: visualFallback.feature,
  }
}

function replacementPlanFromAnchors(sample, anchors, imageCount) {
  if (!imageCount) {
    return {
      mode: 'no_detail_images',
      shouldReplace: false,
      replaceRange: '',
      preserveTopRange: '',
      preserveBottomRange: '',
      reason: '原商详未识别到图片',
    }
  }
  const rawFixedTop = anchors?.fixedTopImageIndex
  const fixedTop = Number(rawFixedTop)
  const hasFixedTop = rawFixedTop !== null && rawFixedTop !== undefined && Number.isFinite(fixedTop) && fixedTop >= 0
  const stopIndex = Number(anchors?.stopImageIndex)
  if (!Number.isFinite(stopIndex) || stopIndex < 0) {
    return {
      mode: sample?.detailKind === 'tmDescription' ? 'blocked_legacy_visual_anchor_missing' : 'blocked_stop_anchor_missing',
      shouldReplace: false,
      preserveTopRange: hasFixedTop ? `#0-#${fixedTop}` : '',
      replaceRange: '',
      preserveBottomRange: '',
      reason: '最新 OCR/视觉逻辑仍未识别到底部保留锚点',
    }
  }
  const replaceStartIndex = hasFixedTop ? fixedTop + 1 : 0
  const replacedImageCount = Math.max(0, stopIndex - replaceStartIndex)
  if (replacedImageCount <= 0) {
    return {
      mode: 'blocked_empty_replace_range',
      shouldReplace: false,
      preserveTopRange: hasFixedTop ? `#0-#${fixedTop}` : '',
      replaceRange: '',
      preserveBottomRange: `#${stopIndex}-#${Math.max(0, imageCount - 1)}`,
      stopImageIndex: stopIndex,
      stopAnchorKind: anchors.stopAnchorKind || '',
      reason: '顶部保留区和底部锚点之间没有可替换图片',
    }
  }
  return {
    mode: 'anchored_replace',
    shouldReplace: true,
    preserveTopRange: hasFixedTop ? `#0-#${fixedTop}` : '',
    replaceRange: `#${replaceStartIndex}-#${stopIndex - 1}`,
    preserveBottomRange: `#${stopIndex}-#${Math.max(0, imageCount - 1)}`,
    replaceStartIndex,
    stopImageIndex: stopIndex,
    stopAnchorKind: anchors.stopAnchorKind || '',
    replacedImageCount,
    reason: '最新 OCR/视觉逻辑识别到安全替换区间',
  }
}

function anchorLabel(kind) {
  const normalized = cleanText(kind)
  if (normalized === 'fixed_top') return '亚洲第一/全球大奖固定头图'
  if (normalized === 'marketing_top') return '顶部营销承接图'
  if (normalized === 'wanted_info') return '想要的信息看这里'
  if (normalized === 'wash_fallback') return '不同材质/洗涤'
  if (normalized === 'white_black_fallback') return '白底黑字视觉兜底'
  if (normalized === 'size') return '尺码'
  if (normalized === 'lower_preserve') return '泛下半区保留'
  return normalized || '未识别'
}

function evidenceText(anchors) {
  const parts = []
  if (anchors?.fixedTopImageIndex !== undefined && anchors?.fixedTopImageIndex !== null) {
    parts.push(`顶部：${anchorLabel(anchors.fixedTopAnchorKind || 'fixed_top')} #${anchors.fixedTopImageIndex}`)
  }
  if (anchors?.stopImageIndex !== undefined && anchors?.stopImageIndex !== null) {
    parts.push(`底部：${anchorLabel(anchors.stopAnchorKind)} #${anchors.stopImageIndex}`)
  }
  if (anchors?.fixedTopText) parts.push(`顶部OCR="${cleanText(anchors.fixedTopText).slice(0, 80)}"`)
  if (anchors?.matchedText) parts.push(`底部OCR="${cleanText(anchors.matchedText).slice(0, 80)}"`)
  if (anchors?.visualFeature) {
    parts.push(`视觉白底黑字 white=${Number(anchors.visualFeature.whiteRatio || 0).toFixed(2)} black=${Number(anchors.visualFeature.blackRatio || 0).toFixed(2)}`)
  }
  return parts.join('；')
}

function readExistingRecords(file) {
  const latestByItem = new Map()
  if (!fs.existsSync(file)) return latestByItem
  for (const line of fs.readFileSync(file, 'utf8').split(/\n/g)) {
    if (!line.trim()) continue
    try {
      const record = JSON.parse(line)
      if (record.itemId) latestByItem.set(cleanText(record.itemId), record)
    } catch (error) {}
  }
  return latestByItem
}

function writeCsv(file, rows, fields) {
  const lines = [fields.join(',')]
  for (const row of rows) lines.push(fields.map(field => csvEscape(row[field])).join(','))
  fs.writeFileSync(file, `${lines.join('\n')}\n`)
}

function summarize(records, state = {}) {
  const countsByMode = {}
  const countsByStopAnchor = {}
  const countsByOcrStatus = {}
  let replaceCount = 0
  let blockedCount = 0
  let failedCount = 0
  for (const record of records) {
    const mode = record.latestMode || (record.error ? 'failed' : '')
    countsByMode[mode || '(missing)'] = (countsByMode[mode || '(missing)'] || 0) + 1
    countsByStopAnchor[record.stopAnchorKind || '(missing)'] = (countsByStopAnchor[record.stopAnchorKind || '(missing)'] || 0) + 1
    countsByOcrStatus[record.ocrStatus || '(missing)'] = (countsByOcrStatus[record.ocrStatus || '(missing)'] || 0) + 1
    if (record.shouldReplace === 'yes') replaceCount += 1
    if (mode && !HANDLED_MODES.has(mode)) blockedCount += 1
    if (record.error) failedCount += 1
  }
  return {
    generatedAt: new Date().toISOString(),
    ...state,
    records: records.length,
    replaceCount,
    blockedCount,
    failedCount,
    countsByMode,
    countsByStopAnchor,
    countsByOcrStatus,
  }
}

function renderMarkdown(report) {
  const lines = []
  lines.push('# 天猫包装商详最新逻辑全量探查')
  lines.push('')
  lines.push(`- 生成时间：${report.generatedAt}`)
  lines.push(`- 来源：天猫后台在售中商品列表`)
  lines.push(`- 总量接口返回：${report.totalItems || 0}`)
  lines.push(`- 已完成：${report.records}`)
  lines.push(`- 可替换：${report.replaceCount}`)
  lines.push(`- 仍阻塞：${report.blockedCount}`)
  lines.push(`- 失败：${report.failedCount}`)
  lines.push(`- 说明：只读 OCR/视觉重判和截图，没有提交、发布或写草稿。`)
  lines.push('')
  lines.push('## 模式分布')
  lines.push('')
  for (const [key, count] of Object.entries(report.countsByMode || {}).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${key}: ${count}`)
  }
  lines.push('')
  lines.push('## 汇总')
  lines.push('')
  lines.push('| 序号 | 款号 | 商品ID | 标题 | 原模式 | 最新判断 | 替换 | 保留 | 证据 | 尝试 | 截图 |')
  lines.push('| ---: | --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- |')
  for (const row of report.rowRecords) {
    const screenshot = row.screenshotAbs ? `[查看](${row.screenshotAbs})` : ''
    lines.push(`| ${[
      row.sequence,
      row.merchantCode,
      row.itemId,
      row.title,
      row.originalMode,
      row.latestMode,
      row.replaceRange || '不替换',
      [row.preserveTopRange, row.preserveBottomRange].filter(Boolean).join('；') || '未形成安全保留区',
      row.evidence || row.error || '',
      row.attempts,
      screenshot,
    ].map(markdownCell).join(' | ')} |`)
  }
  lines.push('')
  lines.push('## 逐款截图')
  lines.push('')
  for (const row of report.rowRecords) {
    lines.push(`### ${row.sequence}. ${row.merchantCode || '(no-code)'} / ${row.itemId}`)
    lines.push('')
    lines.push(`- 原模式：${row.originalMode || ''}`)
    lines.push(`- 最新判断：${row.latestMode || (row.error ? 'failed' : '')}`)
    lines.push(`- 替换：${row.replaceRange || '不替换'}`)
    lines.push(`- 保留：${[row.preserveTopRange, row.preserveBottomRange].filter(Boolean).join('；') || '未形成安全保留区'}`)
    lines.push(`- 证据：${row.evidence || row.error || '无可靠锚点'}`)
    lines.push('')
    if (row.screenshotAbs) lines.push(`![${row.merchantCode}-${row.itemId}](${row.screenshotAbs})`)
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

function writeArtifacts(outDir, latestByItem, state = {}) {
  const records = [...latestByItem.values()].sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0))
  const summary = summarize(records, state)
  const report = { ...summary, outDir, rowRecords: records }
  fs.writeFileSync(path.join(outDir, 'audit-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  fs.writeFileSync(path.join(outDir, 'audit-results.json'), `${JSON.stringify(report, null, 2)}\n`)
  fs.writeFileSync(path.join(outDir, 'audit-report.md'), renderMarkdown(report))
  writeCsv(path.join(outDir, 'audit-results.csv'), records, [
    'sequence',
    'merchantCode',
    'itemId',
    'title',
    'detailKind',
    'modulePattern',
    'imageCount',
    'originalMode',
    'latestMode',
    'shouldReplace',
    'replaceRange',
    'preserveTopRange',
    'preserveBottomRange',
    'stopAnchorKind',
    'stopImageIndex',
    'fixedTopAnchorKind',
    'fixedTopImageIndex',
    'ocrStatus',
    'ocrMatchedText',
    'ocrFixedTopText',
    'evidence',
    'reason',
    'attempts',
    'error',
    'screenshot',
    'screenshotAbs',
  ])
  return summary
}

async function listOnSalePage(cdp, pageNo, options) {
  for (let attempt = 1; attempt <= Math.max(1, Number(options.maxAttempts || 1)); attempt += 1) {
    try {
      return await cdp.evaluate(`window.__crawshrimpTmallProbeListOnSale(${JSON.stringify({
        current: pageNo,
        pageSize: options.pageSize,
      })})`, Math.max(60000, Number(options.timeoutMs || 60000)))
    } catch (error) {
      if (attempt >= Number(options.maxAttempts || 1)) throw error
      console.log(`[full-audit] list page ${pageNo} attempt ${attempt} failed: ${error?.message || error}`)
      await sleep(options.retryDelayMs)
    }
  }
  return null
}

async function withFreshCdp(options, task) {
  const page = await resolveCdpPage(options)
  const cdp = new CdpClient(page.webSocketDebuggerUrl)
  await cdp.connect()
  try {
    await cdp.evaluate(browserInstallExpression(), Math.max(60000, Number(options.sessionSetupTimeoutMs || 60000)))
    return await task(cdp, page)
  } finally {
    cdp.close()
  }
}

async function listOnSalePageFresh(pageNo, options) {
  return withFreshCdp(options, cdp => listOnSalePage(cdp, pageNo, options))
}

async function auditItemOnce(cdp, item, sequence, options) {
  const fetched = await cdp.evaluate(`window.__crawshrimpTmallProbeFetchModel(${JSON.stringify({ itemId: item.itemId })})`, Math.max(60000, Number(options.timeoutMs || 60000)))
  const sample = analyzePublishModel({
    itemId: item.itemId,
    item,
    html: fetched.hasReturnOld ? '返回旧版图文描述' : '',
    model: fetched.model,
  })
  const entries = imageEntriesFromSample(sample)
  const imageList = imageListForAnchors(entries)
  let ocr = { ok: false, results: [] }
  let features = []
  if (entries.length) {
    const ocrTimeout = Math.max(
      Number(options.timeoutMs || 0),
      entries.length * Number(options.ocrPerImageTimeoutMs || 18000) + 60000,
    )
    ocr = await cdp.evaluate(`window.__crawshrimpTmallProbeOcrImages(${JSON.stringify({
      entries,
      assetBaseUrl: options.ocrAssetBaseUrl,
      perImageTimeoutMs: options.ocrPerImageTimeoutMs,
      totalTimeoutMs: ocrTimeout,
    })})`, ocrTimeout + 10000)
  }
  const ocrResults = arrayFromMaybe(ocr?.results)
  const ocrAnchors = buildOcrAnchorsFromResults({ pcDetail: { images: imageList } }, ocrResults, { source: 'tesseract_ocr_full' })
  if (entries.length && shouldRunWhiteBlackFallback(ocrAnchors)) {
    features = await cdp.evaluate(`window.__crawshrimpTmallProbeImageFeatures(${JSON.stringify({
      entries,
      timeoutMs: options.visualPerImageTimeoutMs,
    })})`, Math.max(60000, entries.length * (Number(options.visualPerImageTimeoutMs || 8000) + 1000)))
  }
  const visualFallback = detectWhiteBlackFallback(entries, features, ocrAnchors)
  const anchors = mergeAnchors(ocrAnchors, visualFallback)
  const latestPlan = replacementPlanFromAnchors(sample, anchors, entries.length)

  const filename = `${String(sequence).padStart(5, '0')}-${safeFilename(item.merchantCode)}-${safeFilename(item.itemId)}.png`
  const screenshotRel = `sheets/${filename}`
  const screenshotAbs = path.join(options.outDir, screenshotRel)
  if (options.screenshots && entries.length) {
    const sheet = await cdp.evaluate(`window.__crawshrimpTmallProbeCaseSheet(${JSON.stringify({
      title: `${item.merchantCode || ''} / ${item.itemId || ''}`,
      subtitle: `on_sale -> ${latestPlan.mode} ${anchors.stopAnchorKind || 'no_anchor'}${anchors.stopImageIndex !== undefined ? ` stop #${anchors.stopImageIndex}` : ''}`,
      entries,
      ocrResults,
      maxImages: entries.length,
    })})`, Math.max(60000, entries.length * 9000))
    if (sheet?.dataUrl) writeDataUrlPng(screenshotAbs, sheet.dataUrl)
  }

  return {
    sequence,
    sourceGroup: 'on_sale',
    merchantCode: cleanText(item.merchantCode || sample.merchantCode),
    itemId: cleanText(item.itemId),
    title: cleanText(item.title || sample.title),
    detailKind: cleanText(sample.detailKind),
    modulePattern: cleanText(sample.pcDetail?.modulePattern),
    imageCount: entries.length,
    originalMode: cleanText(sample.replacementPlan?.mode),
    originalStopAnchorKind: cleanText(sample.replacementPlan?.stopAnchorKind),
    originalStopImageIndex: sample.replacementPlan?.stopImageIndex ?? '',
    latestMode: latestPlan.mode,
    shouldReplace: latestPlan.shouldReplace ? 'yes' : 'no',
    replaceRange: latestPlan.replaceRange || '',
    preserveTopRange: latestPlan.preserveTopRange || '',
    preserveBottomRange: latestPlan.preserveBottomRange || '',
    stopAnchorKind: cleanText(anchors.stopAnchorKind),
    stopImageIndex: anchors.stopImageIndex ?? '',
    fixedTopAnchorKind: cleanText(anchors.fixedTopAnchorKind),
    fixedTopImageIndex: anchors.fixedTopImageIndex ?? '',
    ocrStatus: cleanText(anchors.ocrStatus),
    ocrMatchedText: cleanText(anchors.matchedText),
    ocrFixedTopText: cleanText(anchors.fixedTopText),
    evidence: evidenceText(anchors),
    reason: latestPlan.reason,
    screenshot: options.screenshots && entries.length ? screenshotRel : '',
    screenshotAbs: options.screenshots && entries.length ? screenshotAbs : '',
    fetchedAt: new Date().toISOString(),
  }
}

async function auditItemWithRetry(cdp, item, sequence, options) {
  let lastRecord = null
  for (let attempt = 1; attempt <= Math.max(1, Number(options.maxAttempts || 1)); attempt += 1) {
    try {
      const record = await auditItemOnce(cdp, item, sequence, options)
      record.attempts = attempt
      lastRecord = record
      if (HANDLED_MODES.has(record.latestMode)) return record
      console.log(`[full-audit] blocked retry ${attempt}/${options.maxAttempts} ${item.merchantCode || ''}/${item.itemId} mode=${record.latestMode}`)
    } catch (error) {
      lastRecord = {
        sequence,
        sourceGroup: 'on_sale',
        merchantCode: cleanText(item.merchantCode),
        itemId: cleanText(item.itemId),
        title: cleanText(item.title),
        latestMode: 'failed',
        shouldReplace: 'no',
        attempts: attempt,
        error: cleanText(error?.message || error),
        fetchedAt: new Date().toISOString(),
      }
      console.log(`[full-audit] failed retry ${attempt}/${options.maxAttempts} ${item.merchantCode || ''}/${item.itemId}: ${lastRecord.error}`)
    }
    if (attempt < Number(options.maxAttempts || 1)) await sleep(options.retryDelayMs)
  }
  return lastRecord
}

async function auditItemWithFreshRetry(item, sequence, options) {
  let lastRecord = null
  for (let attempt = 1; attempt <= Math.max(1, Number(options.maxAttempts || 1)); attempt += 1) {
    try {
      const record = await withFreshCdp(options, cdp => auditItemOnce(cdp, item, sequence, options))
      record.attempts = attempt
      lastRecord = record
      if (HANDLED_MODES.has(record.latestMode)) return record
      console.log(`[full-audit] blocked retry ${attempt}/${options.maxAttempts} ${item.merchantCode || ''}/${item.itemId} mode=${record.latestMode}`)
    } catch (error) {
      lastRecord = {
        sequence,
        sourceGroup: 'on_sale',
        merchantCode: cleanText(item.merchantCode),
        itemId: cleanText(item.itemId),
        title: cleanText(item.title),
        latestMode: 'failed',
        shouldReplace: 'no',
        attempts: attempt,
        error: cleanText(error?.message || error),
        fetchedAt: new Date().toISOString(),
      }
      console.log(`[full-audit] failed retry ${attempt}/${options.maxAttempts} ${item.merchantCode || ''}/${item.itemId}: ${lastRecord.error}`)
    }
    if (attempt < Number(options.maxAttempts || 1)) await sleep(options.retryDelayMs)
  }
  return lastRecord
}

async function runFullAudit(options) {
  ensureDir(options.outDir)
  ensureDir(path.join(options.outDir, 'sheets'))
  const jsonlPath = path.join(options.outDir, 'audit-results.jsonl')
  if (!options.resume && fs.existsSync(jsonlPath)) fs.rmSync(jsonlPath)
  const latestByItem = options.resume ? readExistingRecords(jsonlPath) : new Map()
  let processedThisRun = 0
  let totalItems = 0

  const page = await resolveCdpPage(options)
  console.log(`[full-audit] CDP page=${page.id} ${page.url}`)
  console.log(`[full-audit] out=${options.outDir}`)
  console.log(`[full-audit] resume=${latestByItem.size}`)
  let currentPage = Math.max(1, Number(options.startPage || 1))
  let sequence = (currentPage - 1) * Number(options.pageSize || 20)
  while (latestByItem.size < Number(options.limit || 0)) {
    try {
      const listData = await listOnSalePageFresh(currentPage, options)
      const items = extractSellManageItems(listData)
      const pagination = extractPagination(listData)
      totalItems = pagination.total || totalItems
      console.log(`[full-audit] page=${currentPage} items=${items.length} total=${totalItems || '?'} done=${latestByItem.size}`)
      if (!items.length) break
      for (const item of items) {
        sequence += 1
        if (sequence > Number(options.limit || 0)) break
        const key = cleanText(item.itemId)
        if (latestByItem.has(key)) continue
        const record = await auditItemWithFreshRetry(item, sequence, options)
        latestByItem.set(key, record)
        fs.appendFileSync(jsonlPath, `${JSON.stringify(record)}\n`)
        processedThisRun += 1
        console.log(`[full-audit] ${latestByItem.size}/${Math.min(Number(options.limit || 0), totalItems || Number(options.limit || 0))} ${record.merchantCode || ''}/${record.itemId} ${record.latestMode} replace=${record.replaceRange || '-'} preserve=${[record.preserveTopRange, record.preserveBottomRange].filter(Boolean).join(';') || '-'} attempts=${record.attempts}`)
        if (processedThisRun % Math.max(1, Number(options.artifactEvery || 10)) === 0) {
          writeArtifacts(options.outDir, latestByItem, { totalItems, currentPage, processedThisRun })
        }
        if (options.cooldownEvery > 0 && processedThisRun % Number(options.cooldownEvery) === 0) {
          console.log(`[full-audit] cooldown ${options.cooldownMs}ms after ${processedThisRun} new records`)
          await sleep(options.cooldownMs)
        } else {
          await sleep(Number(options.delayMs || 0) + jitter(options.jitterMs))
        }
      }
      if (sequence >= Number(options.limit || 0)) break
      const totalPages = totalItems && options.pageSize ? Math.ceil(totalItems / Number(options.pageSize)) : 0
      if (totalPages && currentPage >= totalPages) break
      currentPage += 1
      await sleep(options.listDelayMs)
    } catch (error) {
      console.log(`[full-audit] page ${currentPage} failed: ${error?.message || error}`)
      await sleep(options.retryDelayMs)
    }
  }
  const summary = writeArtifacts(options.outDir, latestByItem, { totalItems, processedThisRun })
  return summary
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(helpText())
    return
  }
  const summary = await runFullAudit(options)
  console.log(`[full-audit] wrote ${summary.records} records to ${options.outDir}`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath && invokedPath === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch(error => {
    console.error(`[full-audit] ${error?.stack || error}`)
    process.exitCode = 1
  })
}
