#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import {
  browserInstallExpression,
  buildOcrAnchorsFromResults,
  classifyWhiteBlackFeature,
  CdpClient,
  resolveCdpPage,
} from './probe_tmall_packaging_structure.mjs'

const DEFAULT_PATTERN = '/private/tmp/tmall-packaging-structure-probe-10000/pattern-analysis-20260630194036/pattern-analysis.json'
const DEFAULT_SAMPLES = '/private/tmp/tmall-packaging-structure-probe-10000/samples.json'
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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
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
  if (!match) throw new Error('截图返回的不是 PNG data URL')
  fs.writeFileSync(file, Buffer.from(match[1], 'base64'))
}

function parseArgs(argv) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '')
  const options = {
    pattern: DEFAULT_PATTERN,
    samples: DEFAULT_SAMPLES,
    outDir: path.join(DEFAULT_OUT_ROOT, `latest-logic-audit-${stamp}`),
    successLimit: 10,
    blockedLimit: 10,
    cdp: DEFAULT_CDP,
    pageId: '',
    ocrAssetBaseUrl: 'http://127.0.0.1:18765',
    timeoutMs: 1800000,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--pattern') options.pattern = next, index += 1
    else if (arg === '--samples') options.samples = next, index += 1
    else if (arg === '--out') options.outDir = next, index += 1
    else if (arg === '--success-limit') options.successLimit = Number(next), index += 1
    else if (arg === '--blocked-limit') options.blockedLimit = Number(next), index += 1
    else if (arg === '--cdp') options.cdp = next, index += 1
    else if (arg === '--page-id') options.pageId = next, index += 1
    else if (arg === '--ocr-asset-base-url') options.ocrAssetBaseUrl = next, index += 1
    else if (arg === '--timeout-ms') options.timeoutMs = Number(next), index += 1
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`未知参数：${arg}`)
  }
  return options
}

function helpText() {
  return [
    'Usage: node adapters/tmall-ops-assistant/tools/audit_tmall_latest_logic_sample.mjs [options]',
    '',
    'Read-only audit: re-runs latest OCR/visual anchor logic for sampled successful and blocked items.',
    '',
    'Options:',
    `  --pattern FILE       pattern-analysis.json, default ${DEFAULT_PATTERN}`,
    `  --samples FILE       samples.json, default ${DEFAULT_SAMPLES}`,
    '  --out DIR            Output directory',
    '  --success-limit N    Successful sample count, default 10',
    '  --blocked-limit N    Blocked sample count, default 10',
    `  --cdp URL            Chrome CDP endpoint, default ${DEFAULT_CDP}`,
    '  --page-id ID         CDP page id to run OCR/canvas in',
    '  --timeout-ms N       OCR timeout budget, default 1800000',
  ].join('\n')
}

function sampleKey(value) {
  return cleanText(value?.itemId || value?.id)
}

function imageEntriesFromSample(sample) {
  const images = arrayFromMaybe(sample?.pcDetail?.images)
  if (images.length) {
    return images
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
  return cleanText(sample?.imageUrls)
    .split(/\s+/g)
    .filter(Boolean)
    .map((url, index) => ({ index, imageIndex: index, moduleIndex: 0, moduleName: '', url, src: url }))
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

function detectWhiteBlackFallback(entries, features, anchors) {
  if (anchorPriority(anchors?.stopAnchorKind) >= anchorPriority('white_black_fallback')) return null
  const fixedTopIndex = Number(anchors?.fixedTopImageIndex)
  const minIndex = Number.isFinite(fixedTopIndex) ? fixedTopIndex + 1 : 0
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
  if (normalized === 'fixed_top') return '亚洲第一/童装销售额固定头图'
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

function markdownCell(value) {
  return cleanText(value).replace(/\|/g, '\\|')
}

function csvEscape(value) {
  const text = cleanText(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function writeCsv(file, rows, fields) {
  const lines = [fields.join(',')]
  for (const row of rows) lines.push(fields.map(field => csvEscape(row[field])).join(','))
  fs.writeFileSync(file, `${lines.join('\n')}\n`)
}

function renderMarkdown(report) {
  const lines = []
  lines.push('# 天猫包装商详最新逻辑抽查')
  lines.push('')
  lines.push(`- 生成时间：${report.generatedAt}`)
  lines.push(`- 来源：${report.pattern}`)
  lines.push(`- 成功抽样：${report.successCount}`)
  lines.push(`- 阻碍抽样：${report.blockedCount}`)
  lines.push(`- 说明：只读 OCR/视觉重判和截图，没有提交、发布或写草稿。`)
  lines.push('')
  lines.push('## 汇总')
  lines.push('')
  lines.push('| 来源 | 款号 | 商品ID | 原模式 | 最新判断 | 替换 | 保留 | 证据 | 截图 |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const row of report.records) {
    const screenshot = row.screenshotAbs ? `[查看](${row.screenshotAbs})` : ''
    lines.push(`| ${[
      row.sourceGroup,
      row.merchantCode,
      row.itemId,
      row.originalMode,
      row.latestMode,
      row.replaceRange || '不替换',
      [row.preserveTopRange, row.preserveBottomRange].filter(Boolean).join('；') || '未形成安全保留区',
      row.evidence,
      screenshot,
    ].map(markdownCell).join(' | ')} |`)
  }
  lines.push('')
  lines.push('## 逐款截图')
  lines.push('')
  for (const row of report.records) {
    lines.push(`### ${row.sourceGroup} ${row.merchantCode} / ${row.itemId}`)
    lines.push('')
    lines.push(`- 原模式：${row.originalMode}`)
    lines.push(`- 最新判断：${row.latestMode}`)
    lines.push(`- 替换：${row.replaceRange || '不替换'}`)
    lines.push(`- 保留：${[row.preserveTopRange, row.preserveBottomRange].filter(Boolean).join('；') || '未形成安全保留区'}`)
    lines.push(`- 证据：${row.evidence || '无可靠锚点'}`)
    lines.push('')
    if (row.screenshotAbs) lines.push(`![${row.merchantCode}-${row.itemId}](${row.screenshotAbs})`)
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

async function runAudit(options) {
  ensureDir(options.outDir)
  ensureDir(path.join(options.outDir, 'sheets'))

  const pattern = readJson(options.pattern)
  const sampleList = readJson(options.samples)
  const samplesByItem = new Map(arrayFromMaybe(sampleList).map(sample => [sampleKey(sample), sample]))
  const targets = [
    ...arrayFromMaybe(pattern.successSample).slice(0, options.successLimit).map(row => ({ sourceGroup: 'success', row })),
    ...arrayFromMaybe(pattern.blockedAll).slice(0, options.blockedLimit).map(row => ({ sourceGroup: 'blocked', row })),
  ]

  const page = await resolveCdpPage(options)
  const cdp = new CdpClient(page.webSocketDebuggerUrl)
  const records = []
  await cdp.connect()
  try {
    await cdp.evaluate(browserInstallExpression(), options.timeoutMs)
    console.log(`[audit] CDP page: ${page.id} ${page.url}`)
    for (let index = 0; index < targets.length; index += 1) {
      const { sourceGroup, row } = targets[index]
      const sample = samplesByItem.get(cleanText(row.itemId)) || row
      const entries = imageEntriesFromSample(sample)
      const imageList = imageListForAnchors(entries)
      const label = `${row.merchantCode}/${row.itemId}`
      console.log(`[audit] ${index + 1}/${targets.length} ${sourceGroup} ${label} images=${entries.length}`)

      let ocr = { ok: false, results: [] }
      let features = []
      if (entries.length) {
        ocr = await cdp.evaluate(`window.__crawshrimpTmallProbeOcrImages(${JSON.stringify({
          entries,
          assetBaseUrl: options.ocrAssetBaseUrl,
          perImageTimeoutMs: 18000,
          totalTimeoutMs: options.timeoutMs,
        })})`, options.timeoutMs + 10000)
        features = await cdp.evaluate(`window.__crawshrimpTmallProbeImageFeatures(${JSON.stringify({
          entries,
          timeoutMs: 8000,
        })})`, Math.max(60000, entries.length * 9000))
      }

      const ocrResults = arrayFromMaybe(ocr?.results)
      const ocrAnchors = buildOcrAnchorsFromResults({ pcDetail: { images: imageList } }, ocrResults, { source: 'tesseract_ocr_full' })
      const visualFallback = detectWhiteBlackFallback(entries, features, ocrAnchors)
      const anchors = mergeAnchors(ocrAnchors, visualFallback)
      const latestPlan = replacementPlanFromAnchors(sample, anchors, entries.length)
      const filename = `${String(index + 1).padStart(2, '0')}-${sourceGroup}-${safeFilename(row.merchantCode)}-${safeFilename(row.itemId)}.png`
      const screenshotRel = `sheets/${filename}`
      const screenshotAbs = path.join(options.outDir, screenshotRel)
      const sheet = await cdp.evaluate(`window.__crawshrimpTmallProbeCaseSheet(${JSON.stringify({
        title: `${row.merchantCode || ''} / ${row.itemId || ''}`,
        subtitle: `${sourceGroup} -> ${latestPlan.mode} ${anchors.stopAnchorKind || 'no_anchor'}${anchors.stopImageIndex !== undefined ? ` stop #${anchors.stopImageIndex}` : ''}`,
        entries,
        ocrResults,
        maxImages: entries.length,
      })})`, Math.max(60000, entries.length * 9000))
      if (sheet?.dataUrl) writeDataUrlPng(screenshotAbs, sheet.dataUrl)

      records.push({
        sourceGroup,
        merchantCode: cleanText(row.merchantCode),
        itemId: cleanText(row.itemId),
        title: cleanText(row.title),
        detailKind: cleanText(sample.detailKind || row.detailKind),
        modulePattern: cleanText(sample.pcDetail?.modulePattern || row.modulePattern),
        imageCount: entries.length,
        originalMode: cleanText(row.mode || sample.replacementPlan?.mode),
        originalStopAnchorKind: cleanText(row.stopAnchorKind || sample.replacementPlan?.stopAnchorKind),
        originalStopImageIndex: cleanText(row.stopImageIndex || sample.replacementPlan?.stopImageIndex),
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
        screenshot: screenshotRel,
        screenshotAbs,
      })
    }
  } finally {
    cdp.close()
  }

  const report = {
    generatedAt: new Date().toISOString(),
    pattern: options.pattern,
    samples: options.samples,
    outDir: options.outDir,
    successCount: records.filter(row => row.sourceGroup === 'success').length,
    blockedCount: records.filter(row => row.sourceGroup === 'blocked').length,
    records,
  }
  fs.writeFileSync(path.join(options.outDir, 'audit-results.json'), `${JSON.stringify(report, null, 2)}\n`)
  fs.writeFileSync(path.join(options.outDir, 'audit-report.md'), renderMarkdown(report))
  writeCsv(path.join(options.outDir, 'audit-results.csv'), records, [
    'sourceGroup',
    'merchantCode',
    'itemId',
    'title',
    'detailKind',
    'modulePattern',
    'imageCount',
    'originalMode',
    'originalStopAnchorKind',
    'originalStopImageIndex',
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
    'screenshot',
    'screenshotAbs',
  ])
  return report
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(helpText())
    return
  }
  const report = await runAudit(options)
  console.log(`[audit] wrote ${report.records.length} records to ${options.outDir}`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath && invokedPath === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch(error => {
    console.error(`[audit] ${error?.stack || error}`)
    process.exitCode = 1
  })
}
