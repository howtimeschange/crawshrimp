#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'

const DEFAULT_ROOT = '/private/tmp/tmall-packaging-structure-probe-10000'
const DEFAULT_AUDIT_SCREEN = 'tmall_packaging_full_latest_audit_10316'
const DEFAULT_MATCH_SCREEN = 'tmall_semir_cloud_package_match_1363'
const DEFAULT_AUDIT_OUT = path.join(DEFAULT_ROOT, 'full-latest-logic-audit-20260630233800')
const DEFAULT_MATCH_OUT = path.join(DEFAULT_ROOT, 'semir-cloud-package-match-20260701121900')
const HANDLED_MODES = new Set(['anchored_replace', 'no_detail_images'])

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function parseArgs(argv) {
  const options = {
    auditOut: DEFAULT_AUDIT_OUT,
    matchOut: DEFAULT_MATCH_OUT,
    auditScreen: DEFAULT_AUDIT_SCREEN,
    matchScreen: DEFAULT_MATCH_SCREEN,
    intervalMs: 2000,
    recent: 8,
    once: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--audit-out') options.auditOut = next, index += 1
    else if (arg === '--match-out') options.matchOut = next, index += 1
    else if (arg === '--audit-screen') options.auditScreen = next, index += 1
    else if (arg === '--match-screen') options.matchScreen = next, index += 1
    else if (arg === '--interval-ms') options.intervalMs = Number(next), index += 1
    else if (arg === '--recent') options.recent = Number(next), index += 1
    else if (arg === '--once') options.once = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`unknown arg: ${arg}`)
  }
  return options
}

function helpText() {
  return [
    'Usage: node adapters/tmall-ops-assistant/tools/watch_tmall_background_tasks.mjs [options]',
    '',
    'Combined terminal TUI for:',
    '- Tmall full latest logic audit',
    '- Semir cloud package match',
    '',
    `  --audit-out DIR       Default ${DEFAULT_AUDIT_OUT}`,
    `  --match-out DIR       Default ${DEFAULT_MATCH_OUT}`,
    `  --audit-screen NAME   Default ${DEFAULT_AUDIT_SCREEN}`,
    `  --match-screen NAME   Default ${DEFAULT_MATCH_SCREEN}`,
    '  --interval-ms N       Refresh interval, default 2000',
    '  --recent N            Recent records per task, default 8',
    '  --once                Render one snapshot and exit',
  ].join('\n')
}

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    return fallback
  }
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return []
  const rows = []
  for (const line of fs.readFileSync(file, 'utf8').split(/\n/g)) {
    if (!line.trim()) continue
    try {
      rows.push(JSON.parse(line))
    } catch (error) {}
  }
  return rows
}

function countFiles(dir, predicate) {
  try {
    return fs.readdirSync(dir).filter(predicate).length
  } catch (error) {
    return 0
  }
}

function countCsvRows(file) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split(/\n/g).filter(Boolean)
    return Math.max(0, lines.length - 1)
  } catch (error) {
    return 0
  }
}

function fileMtime(file) {
  try {
    return fs.statSync(file).mtime
  } catch (error) {
    return null
  }
}

function screenStatus(name) {
  let output = ''
  try {
    output = execFileSync('screen', ['-ls'], { encoding: 'utf8' })
  } catch (error) {
    output = String(error?.stdout || error?.message || error)
  }
  const line = output.split(/\n/g).find(item => item.includes(`.${name}`) || item.includes(name))
  if (!line) return { running: false, text: 'not found' }
  return { running: /\(Detached\)|\(Attached\)/.test(line), text: cleanText(line) }
}

function progressBar(done, total, width = 28) {
  const safeTotal = Math.max(1, Number(total || 0))
  const ratio = Math.max(0, Math.min(1, Number(done || 0) / safeTotal))
  const filled = Math.round(width * ratio)
  return `[${'#'.repeat(filled)}${'-'.repeat(Math.max(0, width - filled))}]`
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatTime(date) {
  return date ? date.toLocaleString('zh-CN', { hour12: false }) : '--'
}

function truncate(value, width) {
  const text = cleanText(value)
  if (text.length <= width) return text
  return `${text.slice(0, Math.max(0, width - 1))}…`
}

function topCounts(counts, limit = 5) {
  return Object.entries(counts || {})
    .sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0], 'zh-Hans-CN', { numeric: true }))
    .slice(0, limit)
    .map(([key, value]) => `${key}:${value}`)
    .join('  ')
}

function uniqueRecords(records, keyName) {
  const byKey = new Map()
  for (const record of records) {
    const key = cleanText(record?.[keyName])
    if (key) byKey.set(key, record)
  }
  return [...byKey.values()]
}

function estimateRate(records, timeField) {
  const dated = records
    .map(record => ({ time: Date.parse(record?.[timeField] || '') }))
    .filter(item => Number.isFinite(item.time))
  if (dated.length < 2) return { rate: 0, secondsPerItem: 0, etaSeconds: NaN }
  const sample = dated.slice(-Math.min(30, dated.length))
  const elapsed = (sample[sample.length - 1].time - sample[0].time) / 1000
  const items = Math.max(1, sample.length - 1)
  const rate = elapsed > 0 ? items / elapsed : 0
  return {
    rate,
    secondsPerItem: rate > 0 ? 1 / rate : 0,
  }
}

function readTail(file, limit = 5) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\n/g).filter(Boolean).slice(-limit)
  } catch (error) {
    return []
  }
}

function tmallStats(outDir) {
  const summaryFile = path.join(outDir, 'audit-summary.json')
  const jsonlFile = path.join(outDir, 'audit-results.jsonl')
  const logFile = path.join(outDir, 'full-audit.log')
  const summary = readJson(summaryFile, {})
  const records = uniqueRecords(readJsonl(jsonlFile), 'itemId').sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0))
  const total = Number(summary.totalItems || 0) || 0
  const done = records.length
  const rate = estimateRate(records, 'fetchedAt')
  return {
    summaryFile,
    jsonlFile,
    logFile,
    records,
    total,
    done,
    percent: total ? done / total * 100 : 0,
    rate,
    eta: rate.rate > 0 && total > done ? (total - done) / rate.rate : NaN,
    replace: records.filter(record => record.shouldReplace === 'yes').length,
    blocked: records.filter(record => record.latestMode && !HANDLED_MODES.has(record.latestMode)).length,
    failed: records.filter(record => record.error || record.latestMode === 'failed').length,
    retried: records.filter(record => Number(record.attempts || 0) > 1).length,
    sheets: countFiles(path.join(outDir, 'sheets'), name => name.endsWith('.png')),
    modes: summary.countsByMode || {},
    anchors: summary.countsByStopAnchor || {},
    ocr: summary.countsByOcrStatus || {},
    logTail: readTail(logFile),
    summaryMtime: fileMtime(summaryFile),
    jsonlMtime: fileMtime(jsonlFile),
  }
}

function flattenMatchRecord(record) {
  const mountResults = Array.isArray(record?.mountResults) ? record.mountResults : []
  const imageCount = mountResults.reduce((sum, mount) => sum + Number(mount.imageCount || 0), 0)
  const selected = mountResults.reduce((sum, mount) => sum + Number(mount.selected || 0), 0)
  const searchCount = mountResults.reduce((sum, mount) => sum + Number(mount.searchCount || 0), 0)
  return { imageCount, selected, searchCount }
}

function semirStats(outDir) {
  const summaryFile = path.join(outDir, 'summary.json')
  const jsonlFile = path.join(outDir, 'match-results.jsonl')
  const logFile = path.join(outDir, 'semir-match.log')
  const summary = readJson(summaryFile, {})
  const targets = readJson(path.join(outDir, 'target-styles.json'), [])
  const records = uniqueRecords(readJsonl(jsonlFile), 'styleCode')
  const total = Number(summary.targetStyles || targets.length || 0)
  const done = records.length
  const rate = estimateRate(records, 'matchedAt')
  const matched = summary.matchedStyles ?? records.filter(record => flattenMatchRecord(record).imageCount > 0).length
  const selected = summary.selectedStyles ?? records.filter(record => flattenMatchRecord(record).selected > 0).length
  const noMatch = summary.noMatchStyles ?? Math.max(0, done - matched)
  const errors = summary.errorStyles ?? 0
  return {
    summaryFile,
    jsonlFile,
    logFile,
    records,
    total,
    done,
    percent: total ? done / total * 100 : 0,
    rate,
    eta: rate.rate > 0 && total > done ? (total - done) / rate.rate : NaN,
    matched,
    selected,
    noMatch,
    errors,
    imageRows: countCsvRows(path.join(outDir, 'matched-images.csv')),
    pathFormats: summary.pathFormats || {},
    categoryTotals: summary.categoryTotals || {},
    logTail: readTail(logFile),
    summaryMtime: fileMtime(summaryFile),
    jsonlMtime: fileMtime(jsonlFile),
  }
}

function pushTaskHeader(lines, title, status, outDir, stats) {
  const total = stats.total || 0
  const done = stats.done || 0
  lines.push(`${title}`)
  lines.push(`screen: ${status.running ? 'RUNNING' : 'STOPPED'}  ${status.text}`)
  lines.push(`out: ${outDir}`)
  lines.push(`${progressBar(done, total)} ${done}/${total || '?'} ${total ? stats.percent.toFixed(2) : '--'}%  rate=${stats.rate.rate ? (stats.rate.rate * 60).toFixed(2) : '--'}/min  ETA=${formatDuration(stats.eta)}`)
}

function renderTmallPanel(options, width) {
  const stats = tmallStats(options.auditOut)
  const status = screenStatus(options.auditScreen)
  const lines = []
  pushTaskHeader(lines, 'Tmall Detail Audit', status, options.auditOut, stats)
  lines.push(`replace=${stats.replace}  blocked=${stats.blocked}  failed=${stats.failed}  retried=${stats.retried}  sheets=${stats.sheets}`)
  lines.push(`modes: ${topCounts(stats.modes) || '--'}`)
  lines.push(`anchors: ${topCounts(stats.anchors) || '--'}`)
  lines.push(`ocr: ${topCounts(stats.ocr) || '--'}`)
  lines.push(`mtime: summary=${formatTime(stats.summaryMtime)}  jsonl=${formatTime(stats.jsonlMtime)}`)
  lines.push('recent:')
  for (const record of stats.records.slice(-Math.max(1, Number(options.recent || 8)))) {
    const preserve = [record.preserveTopRange, record.preserveBottomRange].filter(Boolean).join(';') || '-'
    lines.push(`  ${String(record.sequence || '').padStart(5)} ${truncate(`${record.merchantCode || '-'}/${record.itemId || '-'}`, 25).padEnd(25)} ${truncate(record.latestMode || record.error || '-', 24).padEnd(24)} replace=${truncate(record.replaceRange || '-', 10)} preserve=${truncate(preserve, 20)} att=${record.attempts || 0}`)
  }
  lines.push('log:')
  for (const line of stats.logTail.slice(-3)) lines.push(`  ${truncate(line, width - 4)}`)
  return lines
}

function renderSemirPanel(options, width) {
  const stats = semirStats(options.matchOut)
  const status = screenStatus(options.matchScreen)
  const lines = []
  pushTaskHeader(lines, 'Semir Cloud Package Match', status, options.matchOut, stats)
  lines.push(`matched=${stats.matched}  selected=${stats.selected}  noMatch=${stats.noMatch}  errors=${stats.errors}  imageRows=${stats.imageRows}`)
  lines.push(`formats: ${topCounts(stats.pathFormats) || '--'}`)
  lines.push(`categories: ${topCounts(stats.categoryTotals) || '--'}`)
  lines.push(`mtime: summary=${formatTime(stats.summaryMtime)}  jsonl=${formatTime(stats.jsonlMtime)}`)
  lines.push('recent:')
  for (const record of stats.records.slice(-Math.max(1, Number(options.recent || 8)))) {
    const flat = flattenMatchRecord(record)
    const itemIds = Array.isArray(record.itemIds) ? record.itemIds.join(' ') : ''
    lines.push(`  ${truncate(record.styleCode || '-', 14).padEnd(14)} ${truncate(itemIds, 18).padEnd(18)} images=${String(flat.imageCount).padStart(3)} selected=${String(flat.selected).padStart(3)} search=${String(flat.searchCount).padStart(4)}`)
  }
  lines.push('log:')
  for (const line of stats.logTail.slice(-3)) lines.push(`  ${truncate(line, width - 4)}`)
  return lines
}

export function renderDashboard(rawOptions = {}) {
  const options = {
    auditOut: rawOptions.auditOut || DEFAULT_AUDIT_OUT,
    matchOut: rawOptions.matchOut || DEFAULT_MATCH_OUT,
    auditScreen: rawOptions.auditScreen || DEFAULT_AUDIT_SCREEN,
    matchScreen: rawOptions.matchScreen || DEFAULT_MATCH_SCREEN,
    recent: Number(rawOptions.recent || 8),
  }
  const width = process.stdout.columns || 120
  const divider = '='.repeat(Math.min(width, 120))
  const lines = []
  lines.push(`Tmall Background Tasks Dashboard  ${new Date().toLocaleString('zh-CN', { hour12: false })}`)
  lines.push(divider)
  lines.push(...renderTmallPanel(options, width))
  lines.push(divider)
  lines.push(...renderSemirPanel(options, width))
  lines.push(divider)
  lines.push('Press Ctrl-C to exit viewer; background screen tasks keep running.')
  return lines.join('\n')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(helpText())
    return
  }
  if (options.once || !process.stdout.isTTY) {
    console.log(renderDashboard(options))
    return
  }
  process.stdout.write('\x1b[?25l')
  const draw = () => {
    process.stdout.write('\x1b[2J\x1b[H')
    process.stdout.write(renderDashboard(options))
    process.stdout.write('\n')
  }
  const timer = setInterval(draw, Math.max(500, Number(options.intervalMs || 2000)))
  const stop = () => {
    clearInterval(timer)
    process.stdout.write('\x1b[?25h\n')
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  draw()
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath && invokedPath === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch(error => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}
