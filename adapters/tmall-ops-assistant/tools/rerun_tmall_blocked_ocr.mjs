#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import {
  analyzePublishModel,
  browserInstallExpression,
  buildOcrAnchorsFromResults,
  CdpClient,
  resolveCdpPage,
} from './probe_tmall_packaging_structure.mjs'

const DEFAULT_BLOCKED_CSV = '/private/tmp/tmall-packaging-structure-probe-10000/pattern-analysis-20260630194036/blocked-all.csv'
const DEFAULT_OUT_DIR = '/private/tmp/tmall-packaging-structure-probe-10000/blocked-ocr-rerun'
const DEFAULT_CDP = 'http://127.0.0.1:9222'
const HANDLED_MODES = new Set(['anchored_replace', 'no_detail_images'])

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
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

function parseCsvLine(line) {
  const cells = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      cells.push(cell)
      cell = ''
    } else {
      cell += char
    }
  }
  cells.push(cell)
  return cells
}

function parseCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/g).filter(line => line.trim())
  if (!lines.length) return []
  const headers = parseCsvLine(lines[0]).map(cleanText)
  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line)
    const row = {}
    headers.forEach((header, index) => {
      row[header] = cleanText(cells[index])
    })
    return row
  })
}

function csvEscape(value) {
  const text = cleanText(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function writeCsv(file, rows, fields) {
  const lines = [fields.join(',')]
  for (const row of rows) {
    lines.push(fields.map(field => csvEscape(row[field])).join(','))
  }
  fs.writeFileSync(file, `${lines.join('\n')}\n`)
}

function readExistingResults(file) {
  const rows = []
  const ids = new Set()
  if (!fs.existsSync(file)) return { rows, ids }
  for (const line of fs.readFileSync(file, 'utf8').split(/\n/g)) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line)
      rows.push(row)
      if (row.itemId) ids.add(cleanText(row.itemId))
    } catch (error) {}
  }
  return { rows, ids }
}

function topEntries(counts, limit = 20) {
  return Object.entries(counts)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit)
}

function increment(counter, key) {
  const normalized = cleanText(key) || '(missing)'
  counter[normalized] = (counter[normalized] || 0) + 1
}

function imageEntries(sample, maxImages) {
  return arrayFromMaybe(sample?.pcDetail?.images)
    .filter(image => cleanText(image?.src))
    .slice(0, Math.max(0, Number(maxImages || 0)))
    .map((image, index) => ({
      index: Number(image.globalIndex ?? index),
      imageIndex: Number(image.imageIndex ?? index),
      url: cleanText(image.src),
    }))
}

function resultRow(record) {
  return {
    merchantCode: record.merchantCode,
    itemId: record.itemId,
    title: record.title,
    beforeMode: record.before?.mode,
    afterMode: record.after?.mode,
    planChanged: record.planChanged ? 'yes' : 'no',
    changedToHandled: record.changedToHandled ? 'yes' : 'no',
    beforeStopAnchorKind: record.before?.stopAnchorKind,
    afterStopAnchorKind: record.after?.stopAnchorKind,
    beforeStopImageIndex: record.before?.stopImageIndex,
    afterStopImageIndex: record.after?.stopImageIndex,
    beforeReplacedImageCount: record.before?.replacedImageCount,
    afterReplacedImageCount: record.after?.replacedImageCount,
    ocrStatus: record.ocr?.anchors?.ocrStatus,
    ocrStopAnchorKind: record.ocr?.anchors?.stopAnchorKind,
    ocrMatchedText: record.ocr?.anchors?.matchedText,
    ocrFixedTopText: record.ocr?.anchors?.fixedTopText,
    scannedImages: record.ocr?.scanned,
    textImages: record.ocr?.textImages,
    imageCount: record.before?.imageCount,
    modulePattern: record.after?.modulePattern || record.before?.modulePattern,
    reason: record.after?.reason || record.before?.reason,
  }
}

function summarize(records, options, totalTargets) {
  const countsByAfterMode = {}
  const countsByBeforeMode = {}
  const countsByOcrStatus = {}
  const countsByOcrStopAnchor = {}
  let changedToHandled = 0
  let planChanged = 0
  let stillBlocked = 0
  let failed = 0
  let scannedImages = 0
  let textImages = 0

  for (const record of records) {
    increment(countsByBeforeMode, record.before?.mode)
    increment(countsByAfterMode, record.after?.mode || (record.error ? 'rerun_failed' : ''))
    increment(countsByOcrStatus, record.ocr?.anchors?.ocrStatus || (record.error ? 'failed' : ''))
    increment(countsByOcrStopAnchor, record.ocr?.anchors?.stopAnchorKind || '')
    if (record.changedToHandled) changedToHandled += 1
    if (record.planChanged) planChanged += 1
    if (record.error) failed += 1
    else if (!HANDLED_MODES.has(record.after?.mode)) stillBlocked += 1
    scannedImages += Number(record.ocr?.scanned || 0)
    textImages += Number(record.ocr?.textImages || 0)
  }

  return {
    generatedAt: new Date().toISOString(),
    blockedCsv: options.blockedCsv,
    outDir: options.outDir,
    totalTargets,
    processed: records.length,
    remaining: Math.max(0, totalTargets - records.length),
    changedToHandled,
    planChanged,
    stillBlocked,
    failed,
    scannedImages,
    textImages,
    countsByBeforeMode,
    countsByAfterMode,
    countsByOcrStatus,
    countsByOcrStopAnchor,
    topAfterModes: topEntries(countsByAfterMode, 20),
    topOcrStatus: topEntries(countsByOcrStatus, 20),
    topOcrStopAnchors: topEntries(countsByOcrStopAnchor, 20),
  }
}

function markdownCell(value) {
  return cleanText(value).replace(/\|/g, '\\|')
}

function writeSummary(outDir, records, options, totalTargets) {
  const summary = summarize(records, options, totalTargets)
  const rows = records.map(resultRow)
  const recovered = rows.filter(row => row.changedToHandled === 'yes')
  const changedPlans = rows.filter(row => row.planChanged === 'yes')
  const stillBlocked = rows.filter(row => row.changedToHandled !== 'yes')
  const fields = Object.keys(resultRow({ before: {}, after: {}, ocr: { anchors: {} } }))

  fs.writeFileSync(path.join(outDir, 'ocr-rerun-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  writeCsv(path.join(outDir, 'ocr-rerun-results.csv'), rows, fields)
  writeCsv(path.join(outDir, 'recovered-after-ocr.csv'), recovered, fields)
  writeCsv(path.join(outDir, 'changed-plan-after-ocr.csv'), changedPlans, fields)
  writeCsv(path.join(outDir, 'still-blocked-after-ocr.csv'), stillBlocked, fields)

  const lines = []
  lines.push('# 阻碍商品 OCR 全图复跑报告')
  lines.push('')
  lines.push(`- 生成时间：${summary.generatedAt}`)
  lines.push(`- 阻碍清单：${options.blockedCsv}`)
  lines.push(`- 目标商品：${summary.totalTargets}`)
  lines.push(`- 已处理：${summary.processed}`)
  lines.push(`- 待处理：${summary.remaining}`)
  lines.push(`- OCR 扫描图片：${summary.scannedImages}`)
  lines.push(`- OCR 有文本图片：${summary.textImages}`)
  lines.push(`- OCR 后切点变化：${summary.planChanged}`)
  lines.push(`- OCR 后归入现有规则：${summary.changedToHandled}`)
  lines.push(`- OCR 后仍阻碍：${summary.stillBlocked}`)
  lines.push(`- 复跑失败：${summary.failed}`)
  lines.push('')
  lines.push('## OCR 后模式')
  lines.push('')
  for (const entry of summary.topAfterModes) lines.push(`- ${entry.key}: ${entry.count}`)
  lines.push('')
  lines.push('## OCR 锚点状态')
  lines.push('')
  for (const entry of summary.topOcrStatus) lines.push(`- ${entry.key}: ${entry.count}`)
  lines.push('')
  lines.push('## OCR 命中锚点')
  lines.push('')
  for (const entry of summary.topOcrStopAnchors) lines.push(`- ${entry.key}: ${entry.count}`)
  lines.push('')
  lines.push('## OCR 后归入现有规则的商品')
  lines.push('')
  lines.push('| 款号 | 商品ID | 原模式 | 新模式 | OCR锚点 | 命中文本 | 图片数 |')
  lines.push('| --- | --- | --- | --- | --- | --- | ---: |')
  for (const row of recovered.slice(0, 200)) {
    lines.push(`| ${[
      row.merchantCode,
      row.itemId,
      row.beforeMode,
      row.afterMode,
      row.ocrStopAnchorKind,
      row.ocrMatchedText,
      row.scannedImages,
    ].map(markdownCell).join(' | ')} |`)
  }
  if (!recovered.length) lines.push('| 暂无 |  |  |  |  |  |  |')
  lines.push('')
  lines.push('## OCR 后切点变化的商品')
  lines.push('')
  lines.push('| 款号 | 商品ID | 原锚点 | 新锚点 | 原停止图 | 新停止图 | 原替换数 | 新替换数 |')
  lines.push('| --- | --- | --- | --- | ---: | ---: | ---: | ---: |')
  for (const row of changedPlans.slice(0, 300)) {
    lines.push(`| ${[
      row.merchantCode,
      row.itemId,
      row.beforeStopAnchorKind,
      row.afterStopAnchorKind,
      row.beforeStopImageIndex,
      row.afterStopImageIndex,
      row.beforeReplacedImageCount,
      row.afterReplacedImageCount,
    ].map(markdownCell).join(' | ')} |`)
  }
  if (!changedPlans.length) lines.push('| 暂无 |  |  |  |  |  |  |  |')
  lines.push('')
  lines.push('## OCR 后仍阻碍的商品')
  lines.push('')
  lines.push('| 款号 | 商品ID | 原模式 | 新模式 | OCR状态 | 原因 | 图片数 |')
  lines.push('| --- | --- | --- | --- | --- | --- | ---: |')
  for (const row of stillBlocked.slice(0, 300)) {
    lines.push(`| ${[
      row.merchantCode,
      row.itemId,
      row.beforeMode,
      row.afterMode,
      row.ocrStatus,
      row.reason,
      row.scannedImages,
    ].map(markdownCell).join(' | ')} |`)
  }
  if (!stillBlocked.length) lines.push('| 暂无 |  |  |  |  |  |  |')
  lines.push('')
  fs.writeFileSync(path.join(outDir, 'ocr-rerun-report.md'), `${lines.join('\n')}\n`)
  return summary
}

function parseArgs(argv) {
  const options = {
    blockedCsv: DEFAULT_BLOCKED_CSV,
    outDir: DEFAULT_OUT_DIR,
    cdp: DEFAULT_CDP,
    pageId: '',
    ocrAssetBaseUrl: 'http://127.0.0.1:18765',
    maxImages: 999,
    limit: 0,
    timeoutMs: 600000,
    perImageTimeoutMs: 18000,
    delayMs: 300,
    jitterMs: 300,
    summaryEvery: 1,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--blocked-csv') options.blockedCsv = next, index += 1
    else if (arg === '--out') options.outDir = next, index += 1
    else if (arg === '--cdp') options.cdp = next, index += 1
    else if (arg === '--page-id') options.pageId = next, index += 1
    else if (arg === '--ocr-asset-base-url') options.ocrAssetBaseUrl = next, index += 1
    else if (arg === '--max-images') options.maxImages = Number(next), index += 1
    else if (arg === '--limit') options.limit = Number(next), index += 1
    else if (arg === '--timeout-ms') options.timeoutMs = Number(next), index += 1
    else if (arg === '--per-image-timeout-ms') options.perImageTimeoutMs = Number(next), index += 1
    else if (arg === '--delay-ms') options.delayMs = Number(next), index += 1
    else if (arg === '--jitter-ms') options.jitterMs = Number(next), index += 1
    else if (arg === '--summary-every') options.summaryEvery = Number(next), index += 1
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`未知参数：${arg}`)
  }
  return options
}

function helpText() {
  return [
    'Usage: node adapters/tmall-ops-assistant/tools/rerun_tmall_blocked_ocr.mjs [options]',
    '',
    `  --blocked-csv FILE       blocked-all.csv, default ${DEFAULT_BLOCKED_CSV}`,
    `  --out DIR                output directory, default ${DEFAULT_OUT_DIR}`,
    '  --max-images N           max detail images per item, default 999 (effectively all)',
    '  --limit N                process first N targets only, default all',
    '  --timeout-ms N           per-item OCR total timeout, default 600000',
    '  --per-image-timeout-ms N per-image OCR timeout, default 18000',
  ].join('\n')
}

async function rerunItem(cdp, target, options) {
  const itemId = cleanText(target.itemId)
  const fetched = await cdp.evaluate(`window.__crawshrimpTmallProbeFetchModel(${JSON.stringify({ itemId })})`, options.timeoutMs)
  const item = {
    itemId,
    id: itemId,
    merchantCode: cleanText(target.merchantCode),
    title: cleanText(target.title),
  }
  const before = analyzePublishModel({
    itemId,
    item,
    html: fetched.hasReturnOld ? '返回旧版图文描述' : '',
    model: fetched.model,
  })
  const entries = imageEntries(before, options.maxImages)
  const timeoutMs = Math.max(
    Number(options.timeoutMs || 0),
    entries.length * Number(options.perImageTimeoutMs || 0) + 60000,
  )
  const ocr = entries.length
    ? await cdp.evaluate(`window.__crawshrimpTmallProbeOcrImages(${JSON.stringify({
      entries,
      assetBaseUrl: options.ocrAssetBaseUrl,
      perImageTimeoutMs: options.perImageTimeoutMs,
      totalTimeoutMs: timeoutMs,
    })})`, timeoutMs + 30000)
    : { ok: true, engine: 'tesseract.js', lang: '', scanned: 0, results: [] }
  const ocrResults = arrayFromMaybe(ocr?.results)
  const ocrAnchors = buildOcrAnchorsFromResults(before, ocrResults, { source: 'tesseract_ocr_full' })
  const after = ocrAnchors.stopImageIndex !== undefined
    ? analyzePublishModel({
      itemId,
      item,
      html: fetched.hasReturnOld ? '返回旧版图文描述' : '',
      model: fetched.model,
      visualAnchors: ocrAnchors,
    })
    : before
  const beforeMode = before.replacementPlan?.mode || 'fetch_failed'
  const afterMode = after.replacementPlan?.mode || 'fetch_failed'
  const planChanged = beforeMode !== afterMode ||
    cleanText(before.replacementPlan?.stopAnchorKind) !== cleanText(after.replacementPlan?.stopAnchorKind) ||
    Number(before.replacementPlan?.stopImageIndex ?? -1) !== Number(after.replacementPlan?.stopImageIndex ?? -1) ||
    Number(before.replacementPlan?.replacedImageCount ?? -1) !== Number(after.replacementPlan?.replacedImageCount ?? -1)
  return {
    itemId,
    merchantCode: after.merchantCode || before.merchantCode || item.merchantCode,
    title: after.title || before.title || item.title,
    fetchedAt: new Date().toISOString(),
    fetch: {
      status: fetched.status,
      htmlLength: fetched.htmlLength,
      url: fetched.url,
    },
    before: {
      mode: beforeMode,
      reason: before.replacementPlan?.reason || '',
      detailKind: before.detailKind,
      modulePattern: before.pcDetail?.modulePattern || '',
      imageCount: before.pcDetail?.imageCount || entries.length,
      topAnchor: before.anchors?.top?.kind || '',
      bottomAnchor: before.anchors?.bottom?.kind || '',
      stopAnchorKind: before.replacementPlan?.stopAnchorKind || before.anchors?.bottom?.kind || '',
      replaceStartIndex: before.replacementPlan?.replaceStartIndex ?? null,
      stopImageIndex: before.replacementPlan?.stopImageIndex ?? null,
      replacedImageCount: before.replacementPlan?.replacedImageCount ?? null,
    },
    after: {
      mode: afterMode,
      reason: after.replacementPlan?.reason || '',
      detailKind: after.detailKind,
      modulePattern: after.pcDetail?.modulePattern || '',
      imageCount: after.pcDetail?.imageCount || entries.length,
      topAnchor: after.anchors?.top?.kind || '',
      bottomAnchor: after.anchors?.bottom?.kind || '',
      stopAnchorKind: after.replacementPlan?.stopAnchorKind || after.anchors?.bottom?.kind || '',
      replaceStartIndex: after.replacementPlan?.replaceStartIndex ?? null,
      stopImageIndex: after.replacementPlan?.stopImageIndex ?? null,
      replacedImageCount: after.replacementPlan?.replacedImageCount ?? null,
    },
    planChanged,
    changedToHandled: !HANDLED_MODES.has(beforeMode) && HANDLED_MODES.has(afterMode),
    ocr: {
      ok: !!ocr?.ok,
      engine: ocr?.engine || 'tesseract.js',
      lang: ocr?.lang || '',
      scanned: Number(ocr?.scanned || ocrResults.length),
      textImages: ocrResults.filter(result => cleanText(result?.text)).length,
      anchors: ocrAnchors,
      results: ocrResults.map(result => ({
        globalIndex: Number(result?.globalIndex ?? result?.index ?? 0),
        imageIndex: Number(result?.imageIndex ?? result?.globalIndex ?? result?.index ?? 0),
        src: cleanText(result?.src),
        confidence: Number(result?.confidence || 0),
        text: cleanText(result?.text),
        error: cleanText(result?.error),
      })),
    },
  }
}

export async function runBlockedOcrRerun(options) {
  ensureDir(options.outDir)
  const resultsFile = path.join(options.outDir, 'ocr-rerun-results.jsonl')
  let targets = parseCsv(options.blockedCsv).filter(row => cleanText(row.itemId))
  if (Number(options.limit || 0) > 0) targets = targets.slice(0, Number(options.limit))
  const { rows: records, ids: doneIds } = readExistingResults(resultsFile)

  const page = await resolveCdpPage(options)
  const cdp = new CdpClient(page.webSocketDebuggerUrl)
  await cdp.connect()
  try {
    await cdp.evaluate(browserInstallExpression(), options.timeoutMs)
    console.log(`[blocked-ocr] page=${page.id} ${page.url}`)
    console.log(`[blocked-ocr] targets=${targets.length} done=${doneIds.size} out=${options.outDir}`)

    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index]
      const itemId = cleanText(target.itemId)
      if (!itemId || doneIds.has(itemId)) continue
      const startedAt = Date.now()
      let record
      try {
        record = await rerunItem(cdp, target, options)
      } catch (error) {
        record = {
          itemId,
          merchantCode: cleanText(target.merchantCode),
          title: cleanText(target.title),
          fetchedAt: new Date().toISOString(),
          before: { mode: cleanText(target.mode), reason: cleanText(target.reason), imageCount: Number(target.imageCount || 0), modulePattern: cleanText(target.modulePattern) },
          after: { mode: 'rerun_failed', reason: cleanText(error?.message || error), imageCount: Number(target.imageCount || 0), modulePattern: cleanText(target.modulePattern) },
          planChanged: false,
          changedToHandled: false,
          error: cleanText(error?.stack || error?.message || error),
          ocr: { ok: false, scanned: 0, textImages: 0, anchors: { ocrStatus: 'failed', source: 'tesseract_ocr_full' }, results: [] },
        }
      }
      records.push(record)
      doneIds.add(itemId)
      fs.appendFileSync(resultsFile, `${JSON.stringify(record)}\n`)
      const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1)
      console.log(`[blocked-ocr] ${records.length}/${targets.length} item=${itemId} before=${record.before?.mode} after=${record.after?.mode} ocr=${record.ocr?.anchors?.ocrStatus || ''}/${record.ocr?.anchors?.stopAnchorKind || ''} images=${record.ocr?.scanned || 0} text=${record.ocr?.textImages || 0} ${elapsedSec}s`)
      if (records.length % Math.max(1, Number(options.summaryEvery || 1)) === 0) {
        writeSummary(options.outDir, records, options, targets.length)
      }
      await sleep(Number(options.delayMs || 0) + Math.floor(Math.random() * Math.max(0, Number(options.jitterMs || 0))))
    }
    return writeSummary(options.outDir, records, options, targets.length)
  } finally {
    cdp.close()
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(helpText())
    return
  }
  const summary = await runBlockedOcrRerun(options)
  console.log(`[blocked-ocr] done processed=${summary.processed}/${summary.totalTargets} recovered=${summary.changedToHandled} stillBlocked=${summary.stillBlocked} failed=${summary.failed}`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath && invokedPath === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch(error => {
    console.error(`[blocked-ocr] ${error?.stack || error}`)
    process.exitCode = 1
  })
}
