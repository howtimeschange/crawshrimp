'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads')
function normalizeExtensionList(value) {
  return new Set((Array.isArray(value) ? value : []).map(item => String(item || '').trim().toLowerCase().replace(/^\./, '')).filter(Boolean))
}
function listDirectoryFilesSnapshot(rootPath, opts = {}) {
  const rawRoot = String(rootPath || '').trim()
  if (!rawRoot) throw new Error('目录路径不能为空')
  const root = fs.realpathSync.native(path.resolve(rawRoot))
  const stat = fs.statSync(root)
  if (!stat.isDirectory()) throw new Error(`不是有效目录：${rawRoot}`)

  const allowedExts = normalizeExtensionList(opts.extensions)
  const maxFiles = Math.max(1, Math.min(Number(opts.max_files || opts.maxFiles || 5000) || 5000, 20000))
  const results = []
  let visited = 0
  let budgetExceeded = false
  const maxEntries = Math.max(1, Math.min(Number(opts.maxEntries) || 100000, 200000))
  const deadline = Date.now() + Math.max(100, Math.min(Number(opts.timeoutMs) || 15000, 30000))

  function walk(dir) {
    if (results.length >= maxFiles || budgetExceeded) return
    const entries = []
    let directory
    try {
      directory = fs.opendirSync(dir, { bufferSize: 64 })
      while (visited < maxEntries && Date.now() <= deadline) {
        const entry = directory.readSync()
        if (!entry) break
        visited++
        entries.push(entry)
      }
      if (visited >= maxEntries || Date.now() > deadline) budgetExceeded = true
    } catch {
      return
    } finally {
      directory?.closeSync()
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))

    for (const entry of entries) {
      if (results.length >= maxFiles) return
      if (Date.now() > deadline) { budgetExceeded = true; return }
      if (!entry?.name || entry.name.startsWith('.')) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).slice(1).toLowerCase()
      if (allowedExts.size && !allowedExts.has(ext)) continue
      try {
        if (opts.canonicalFiles) {
          const real = fs.realpathSync.native(fullPath)
          if (path.resolve(real) !== path.resolve(fullPath) || !fs.lstatSync(fullPath).isFile()) continue
        }
        const fileStat = fs.statSync(fullPath)
        results.push({
          path: fullPath,
          relativePath: path.relative(root, fullPath).replace(/\\/g, '/'),
          mtimeMs: fileStat.mtimeMs,
          size: fileStat.size,
        })
      } catch {}
    }
  }

  walk(root)
  return {
    ok: true,
    root,
    paths: results,
    truncated: results.length >= maxFiles || budgetExceeded,
    budgetExceeded,
    visited,
  }
}

if (!isMainThread) {
  try { parentPort.postMessage({ result: listDirectoryFilesSnapshot(workerData.root, workerData.opts) }) }
  catch (error) { parentPort.postMessage({ error: error.message }) }
}
let active = 0
function scanDirectory(root, opts = {}, { signal } = {}) {
  if (signal?.aborted) return Promise.reject(new Error('目录扫描已取消'))
  if (active >= 2) return Promise.reject(new Error('目录扫描忙，请稍后重试'))
  active++
  return new Promise((resolve, reject) => {
    let worker, timer, settled = false
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      const done = () => { active--; error ? reject(error) : resolve(result) }
      if (worker) worker.terminate().then(done, done)
      else done()
    }
    const cancel = () => finish(new Error('目录扫描已取消'))
    try {
      worker = new Worker(__filename, { workerData: { root, opts } })
      worker.once('message', ({ error, result }) => finish(error ? new Error(error) : null, result))
      worker.once('error', error => finish(error))
      worker.once('exit', () => finish(new Error('目录扫描服务已退出')))
      signal?.addEventListener('abort', cancel, { once: true })
      timer = setTimeout(() => finish(new Error('目录扫描超时，请缩小扫描范围')), 35000)
    } catch (error) { finish(error) }
  })
}
module.exports = { scanDirectory }
