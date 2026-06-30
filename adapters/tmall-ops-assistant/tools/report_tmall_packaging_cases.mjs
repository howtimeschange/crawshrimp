#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import {
  browserInstallExpression,
  buildOcrAnchorsFromResults,
  buildRuleCoverageCases,
  CdpClient,
  resolveCdpPage,
} from './probe_tmall_packaging_structure.mjs'

const DEFAULT_SAMPLES = '/private/tmp/tmall-packaging-structure-probe-10000/samples.jsonl'
const DEFAULT_OUT_DIR = '/private/tmp/tmall-packaging-structure-probe-10000/case-report'
const HANDLED_MODES = new Set(['anchored_replace', 'no_detail_images'])

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function arrayFromMaybe(value) {
  return Array.isArray(value) ? value : []
}

function markdownCell(value) {
  return cleanText(value).replace(/\|/g, '\\|')
}

function readJsonl(file) {
  const rows = []
  if (!fs.existsSync(file)) return rows
  for (const line of fs.readFileSync(file, 'utf8').split(/\n/g)) {
    if (!line.trim()) continue
    try {
      rows.push(JSON.parse(line))
    } catch (error) {}
  }
  return rows
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function writeDataUrlPng(file, dataUrl) {
  const match = String(dataUrl || '').match(/^data:image\/png;base64,(.+)$/)
  if (!match) throw new Error('截图返回的不是 PNG data URL')
  fs.writeFileSync(file, Buffer.from(match[1], 'base64'))
}

function caseImageEntries(sample, limit) {
  return arrayFromMaybe(sample?.pcDetail?.images)
    .slice(0, Math.max(0, Number(limit || 0)))
    .filter(image => cleanText(image?.src))
    .map((image, index) => ({
      index: Number(image.globalIndex ?? index),
      imageIndex: Number(image.imageIndex ?? index),
      url: image.src,
    }))
}

export function selectCaseSamples(samples = [], options = {}) {
  const limit = Math.max(0, Number(options.limit || 30))
  const source = arrayFromMaybe(samples).filter(sample => !HANDLED_MODES.has(sample?.replacementPlan?.mode))
  const selected = []
  const seenGroups = new Set()
  for (const sample of source) {
    const group = [
      sample?.replacementPlan?.mode || 'fetch_failed',
      sample?.detailKind || '',
      sample?.pcDetail?.modulePattern || '',
    ].join('|')
    if (seenGroups.has(group)) continue
    seenGroups.add(group)
    selected.push(sample)
    if (limit > 0 && selected.length >= limit) return selected
  }
  for (const sample of source) {
    if (selected.includes(sample)) continue
    selected.push(sample)
    if (limit > 0 && selected.length >= limit) break
  }
  return selected
}

function countBy(items, getKey) {
  const counts = {}
  for (const item of items) {
    const key = cleanText(getKey(item)) || '(missing)'
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}

function topEntries(counts, limit = 12) {
  return Object.entries(counts)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit)
}

export function renderCaseReportMarkdown(report) {
  const cases = arrayFromMaybe(report?.cases)
  const generatedAt = cleanText(report?.generatedAt || new Date().toISOString())
  const totalSamples = Number(report?.totalSamples || 0)
  const recognized = cases.filter(item => item.ocrStatus === 'recognized').length
  const lines = []
  lines.push('# 天猫包装详情规则外案例报告')
  lines.push('')
  lines.push(`- 生成时间：${generatedAt}`)
  lines.push(`- 当前样本数：${totalSamples}`)
  lines.push(`- 规则外案例数：${cases.length}`)
  lines.push(`- OCR 可归入现有锚点：${recognized}`)
  lines.push(`- OCR 后仍需人工判断：${Math.max(0, cases.length - recognized)}`)
  lines.push('')
  lines.push('## 规则外模式')
  lines.push('')
  for (const entry of topEntries(countBy(cases, item => item.mode))) {
    lines.push(`- ${entry.key}: ${entry.count}`)
  }
  lines.push('')
  lines.push('## 高频结构')
  lines.push('')
  for (const entry of topEntries(countBy(cases, item => item.modulePattern), 20)) {
    lines.push(`- ${entry.key}: ${entry.count}`)
  }
  lines.push('')
  lines.push('## 代表案例')
  lines.push('')
  lines.push('| 款号 | 商品ID | 模式 | 结构 | OCR | OCR锚点 | OCR命中文本 | 截图 |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const item of cases) {
    const screenshot = item.screenshot ? `[查看](${item.screenshot})` : ''
    lines.push([
      markdownCell(item.merchantCode),
      markdownCell(item.itemId),
      markdownCell(item.mode),
      markdownCell(item.modulePattern),
      markdownCell(item.ocrStatus),
      markdownCell(item.ocrStopAnchorKind),
      markdownCell(item.ocrMatchedText || item.ocrFixedTopText),
      screenshot,
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'))
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}

function parseArgs(argv) {
  const options = {
    samples: DEFAULT_SAMPLES,
    outDir: DEFAULT_OUT_DIR,
    limit: 30,
    cdp: 'http://127.0.0.1:9222',
    pageId: '',
    ocr: false,
    screenshots: false,
    ocrMaxImages: 24,
    screenshotMaxImages: 12,
    ocrAssetBaseUrl: 'http://127.0.0.1:18765',
    timeoutMs: 120000,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--samples') options.samples = next, index += 1
    else if (arg === '--out') options.outDir = next, index += 1
    else if (arg === '--limit') options.limit = Number(next), index += 1
    else if (arg === '--cdp') options.cdp = next, index += 1
    else if (arg === '--page-id') options.pageId = next, index += 1
    else if (arg === '--ocr') options.ocr = true
    else if (arg === '--screenshots') options.screenshots = true
    else if (arg === '--ocr-max-images') options.ocrMaxImages = Number(next), index += 1
    else if (arg === '--screenshot-max-images') options.screenshotMaxImages = Number(next), index += 1
    else if (arg === '--ocr-asset-base-url') options.ocrAssetBaseUrl = next, index += 1
    else if (arg === '--timeout-ms') options.timeoutMs = Number(next), index += 1
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`未知参数：${arg}`)
  }
  return options
}

function helpText() {
  return [
    'Usage: node adapters/tmall-ops-assistant/tools/report_tmall_packaging_cases.mjs [options]',
    '',
    'Options:',
    `  --samples FILE      Probe samples.jsonl, default ${DEFAULT_SAMPLES}`,
    `  --out DIR           Report output directory, default ${DEFAULT_OUT_DIR}`,
    '  --limit N           Representative case limit, default 30',
    '  --ocr               Run Tesseract OCR for selected cases',
    '  --screenshots       Create image contact-sheet PNGs for selected cases',
    '  --ocr-max-images N  Max detail images per OCR case, default 24',
    '  --screenshot-max-images N  Max detail images per screenshot, default 12',
  ].join('\n')
}

async function analyzeSelectedCasesWithBrowser(selectedSamples, options) {
  if (!options.ocr && !options.screenshots) return
  const page = await resolveCdpPage(options)
  const cdp = new CdpClient(page.webSocketDebuggerUrl)
  await cdp.connect()
  try {
    await cdp.evaluate(browserInstallExpression(), options.timeoutMs)
    const casesDir = path.join(options.outDir, 'cases')
    ensureDir(casesDir)
    for (const sample of selectedSamples) {
      const ocrEntries = caseImageEntries(sample, options.ocrMaxImages)
      let ocrResults = []
      if (options.ocr && ocrEntries.length) {
        const ocr = await cdp.evaluate(`window.__crawshrimpTmallProbeOcrImages(${JSON.stringify({
          entries: ocrEntries,
          assetBaseUrl: options.ocrAssetBaseUrl,
          totalTimeoutMs: options.timeoutMs,
        })})`, options.timeoutMs + 10000)
        ocrResults = arrayFromMaybe(ocr?.results)
        const anchors = buildOcrAnchorsFromResults(sample, ocrResults, { source: 'tesseract_ocr' })
        sample.ocr = {
          ok: !!ocr?.ok,
          engine: ocr?.engine || 'tesseract.js',
          lang: ocr?.lang || '',
          scanned: Number(ocr?.scanned || ocrResults.length),
          results: ocrResults,
          anchors,
        }
      }
      if (options.screenshots) {
        const screenshotEntries = caseImageEntries(sample, options.screenshotMaxImages)
        if (screenshotEntries.length) {
          const safeItemId = cleanText(sample.itemId).replace(/[^A-Za-z0-9._-]+/g, '_') || 'case'
          const safeStyle = cleanText(sample.merchantCode).replace(/[^A-Za-z0-9._-]+/g, '_') || 'style'
          const filename = `${safeStyle}-${safeItemId}.png`
          const relative = `cases/${filename}`
          const sheet = await cdp.evaluate(`window.__crawshrimpTmallProbeCaseSheet(${JSON.stringify({
            title: `${sample.merchantCode || ''} / ${sample.itemId || ''}`,
            subtitle: `${sample.replacementPlan?.mode || ''} · ${sample.pcDetail?.modulePattern || ''}`,
            entries: screenshotEntries,
            ocrResults,
            maxImages: options.screenshotMaxImages,
          })})`, 60000)
          if (sheet?.dataUrl) {
            writeDataUrlPng(path.join(options.outDir, relative), sheet.dataUrl)
            sample.caseAssets = {
              ...(sample.caseAssets || {}),
              screenshot: relative,
            }
          }
        }
      }
    }
  } finally {
    cdp.close()
  }
}

export async function writeCaseReport(options = {}) {
  ensureDir(options.outDir)
  const samples = readJsonl(options.samples)
  const selectedSamples = selectCaseSamples(samples, { limit: options.limit })
  await analyzeSelectedCasesWithBrowser(selectedSamples, options)
  const cases = buildRuleCoverageCases(selectedSamples)
  const report = {
    generatedAt: new Date().toISOString(),
    totalSamples: samples.length,
    selectedCount: selectedSamples.length,
    cases,
  }
  fs.writeFileSync(path.join(options.outDir, 'case-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  fs.writeFileSync(path.join(options.outDir, 'case-report.md'), renderCaseReportMarkdown(report))
  return report
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(helpText())
    return
  }
  const report = await writeCaseReport(options)
  console.log(`[case-report] samples=${report.totalSamples} cases=${report.cases.length} out=${options.outDir}`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath && invokedPath === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch(error => {
    console.error(`[case-report] ${error?.stack || error}`)
    process.exitCode = 1
  })
}
