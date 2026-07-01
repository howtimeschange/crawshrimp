#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'

const DEFAULT_ROOT = '/private/tmp/tmall-packaging-structure-probe-10000'
const DEFAULT_SCREEN = 'tmall_packaging_full_latest_audit_10316'

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function parseArgs(argv) {
  const options = {
    outDir: '',
    root: DEFAULT_ROOT,
    screen: DEFAULT_SCREEN,
    intervalMs: 2000,
    recent: 10,
    once: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--out') options.outDir = next, index += 1
    else if (arg === '--root') options.root = next, index += 1
    else if (arg === '--screen') options.screen = next, index += 1
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
    'Usage: node adapters/tmall-ops-assistant/tools/watch_tmall_full_audit_progress.mjs [options]',
    '',
    'Simple terminal TUI for the full Tmall packaging audit screen task.',
    '',
    `  --out DIR          Output dir; default auto-detect latest ${DEFAULT_ROOT}/full-latest-logic-audit-*`,
    `  --screen NAME      screen session name, default ${DEFAULT_SCREEN}`,
    '  --interval-ms N    Refresh interval, default 2000',
    '  --recent N         Recent rows to display, default 10',
    '  --once             Render one snapshot and exit',
  ].join('\n')
}

function latestAuditDir(root) {
  const entries = fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }) : []
  const dirs = entries
    .filter(entry => entry.isDirectory() && /^full-latest-logic-audit-/.test(entry.name) && !/smoke/.test(entry.name))
    .map(entry => path.join(root, entry.name))
    .map(dir => ({ dir, mtimeMs: fs.statSync(dir).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  return dirs[0]?.dir || ''
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    return fallback
  }
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

function countFiles(dir, suffix) {
  try {
    return fs.readdirSync(dir).filter(name => name.endsWith(suffix)).length
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

function progressBar(done, total, width = 34) {
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

function topCounts(counts, limit = 6) {
  return Object.entries(counts || {})
    .sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, value]) => `${key}:${value}`)
    .join('  ')
}

function estimateRate(records) {
  const dated = records
    .map(record => ({ record, time: Date.parse(record.fetchedAt || '') }))
    .filter(item => Number.isFinite(item.time))
  if (dated.length < 2) return { rate: 0, secondsPerItem: 0 }
  const sample = dated.slice(-Math.min(25, dated.length))
  const elapsed = (sample[sample.length - 1].time - sample[0].time) / 1000
  const items = Math.max(1, sample.length - 1)
  const rate = elapsed > 0 ? items / elapsed : 0
  return {
    rate,
    secondsPerItem: rate > 0 ? 1 / rate : 0,
  }
}

function truncate(value, width) {
  const text = cleanText(value)
  if (text.length <= width) return text
  return `${text.slice(0, Math.max(0, width - 1))}…`
}

function render(options) {
  const outDir = options.outDir || latestAuditDir(options.root)
  const summaryFile = path.join(outDir, 'audit-summary.json')
  const jsonlFile = path.join(outDir, 'audit-results.jsonl')
  const logFile = path.join(outDir, 'full-audit.log')
  const sheetsDir = path.join(outDir, 'sheets')
  const summary = readJson(summaryFile, {})
  const records = readJsonl(jsonlFile)
  const latestByItem = new Map()
  for (const record of records) {
    if (record?.itemId) latestByItem.set(cleanText(record.itemId), record)
  }
  const uniqueRecords = [...latestByItem.values()].sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0))
  const total = Number(summary.totalItems || 0) || Number(uniqueRecords.at(-1)?.totalItems || 0) || 0
  const done = uniqueRecords.length
  const percent = total ? (done / total) * 100 : 0
  const replace = uniqueRecords.filter(record => record.shouldReplace === 'yes').length
  const blocked = uniqueRecords.filter(record => record.latestMode && !['anchored_replace', 'no_detail_images'].includes(record.latestMode)).length
  const failed = uniqueRecords.filter(record => record.error || record.latestMode === 'failed').length
  const retried = uniqueRecords.filter(record => Number(record.attempts || 0) > 1).length
  const sheetCount = countFiles(sheetsDir, '.png')
  const { rate, secondsPerItem } = estimateRate(uniqueRecords)
  const eta = rate > 0 && total > done ? (total - done) / rate : NaN
  const status = screenStatus(options.screen)
  const logTail = fs.existsSync(logFile)
    ? fs.readFileSync(logFile, 'utf8').split(/\n/g).filter(Boolean).slice(-5)
    : []
  const termWidth = process.stdout.columns || 120
  const lines = []
  lines.push(`Tmall Full Latest Logic Audit  ${new Date().toLocaleString('zh-CN', { hour12: false })}`)
  lines.push(`screen: ${status.running ? 'RUNNING' : 'STOPPED'}  ${status.text}`)
  lines.push(`out: ${outDir || '(not found)'}`)
  lines.push('')
  lines.push(`${progressBar(done, total)} ${done}/${total || '?'} ${total ? percent.toFixed(2) : '--'}%`)
  lines.push(`rate: ${rate ? `${(rate * 60).toFixed(2)} items/min` : '--'}  avg: ${secondsPerItem ? `${secondsPerItem.toFixed(1)}s/item` : '--'}  ETA: ${formatDuration(eta)}`)
  lines.push(`replace: ${replace}  blocked: ${blocked}  failed: ${failed}  retried: ${retried}  sheets: ${sheetCount}`)
  lines.push(`summary mtime: ${formatTime(fileMtime(summaryFile))}  jsonl mtime: ${formatTime(fileMtime(jsonlFile))}`)
  lines.push('')
  lines.push(`modes:   ${topCounts(summary.countsByMode) || '--'}`)
  lines.push(`anchors: ${topCounts(summary.countsByStopAnchor) || '--'}`)
  lines.push(`ocr:     ${topCounts(summary.countsByOcrStatus) || '--'}`)
  lines.push('')
  lines.push(`Recent ${Math.min(options.recent, uniqueRecords.length)} records`)
  lines.push('seq    style/item                 mode                         replace      preserve                 att')
  for (const record of uniqueRecords.slice(-Math.max(1, Number(options.recent || 10)))) {
    const styleItem = `${record.merchantCode || '-'} / ${record.itemId || '-'}`
    const preserve = [record.preserveTopRange, record.preserveBottomRange].filter(Boolean).join(';') || '-'
    lines.push([
      String(record.sequence || '').padStart(5),
      truncate(styleItem, 26).padEnd(26),
      truncate(record.latestMode || record.error || '-', 28).padEnd(28),
      truncate(record.replaceRange || '-', 12).padEnd(12),
      truncate(preserve, 24).padEnd(24),
      String(record.attempts || 0).padStart(2),
    ].join(' '))
  }
  lines.push('')
  lines.push('Log tail')
  for (const line of logTail) lines.push(truncate(line, termWidth))
  return lines.join('\n')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(helpText())
    return
  }
  if (options.once || !process.stdout.isTTY) {
    console.log(render(options))
    return
  }
  process.stdout.write('\x1b[?25l')
  const draw = () => {
    process.stdout.write('\x1b[2J\x1b[H')
    process.stdout.write(render(options))
    process.stdout.write('\n\nPress Ctrl-C to exit viewer; audit keeps running in screen.\n')
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

main().catch(error => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
