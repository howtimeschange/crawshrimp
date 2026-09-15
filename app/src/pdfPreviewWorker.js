'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { Worker, isMainThread, parentPort } = require('node:worker_threads')

function findQuickLookPdfPreview(pdfPath, outputDir) {
  const candidates = [
    path.join(outputDir, `${path.basename(pdfPath)}.png`),
    path.join(outputDir, `${path.basename(pdfPath, path.extname(pdfPath))}.png`),
  ]
  const stack = [outputDir]
  while (stack.length) {
    const dir = stack.pop()
    for (const name of fs.readdirSync(dir)) {
      const candidate = path.join(dir, name)
      const stat = fs.statSync(candidate)
      if (stat.isDirectory()) stack.push(candidate)
      if (stat.isFile() && /\.(png|jpg|jpeg)$/i.test(name)) candidates.push(candidate)
    }
  }
  return candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || ''
}

function pdfPreviewPageFromImage(imagePath, page, width = 0, height = 0) {
  const raw = fs.readFileSync(imagePath)
  const ext = path.extname(imagePath).toLowerCase()
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
  return {
    page,
    preview_path: '',
    width,
    height,
    data_url: `data:${mime};base64,${raw.toString('base64')}`,
  }
}

function renderPdfPreviewWithPyMuPDF(pdfPath, outputDir, pythonBin) {
  fs.mkdirSync(outputDir, { recursive: true })

  const script = `
import json
import sys
from pathlib import Path

import fitz

pdf_path = Path(sys.argv[1])
output_dir = Path(sys.argv[2])
output_dir.mkdir(parents=True, exist_ok=True)

doc = fitz.open(str(pdf_path))
pages = []
try:
    if doc.page_count > 100:
        raise ValueError("PDF_PREVIEW_LIMIT: PDF 超过 100 页，请拆分后预览")
    total_pixels = 0
    for index in range(doc.page_count):
        page = doc.load_page(index)
        rect = page.rect
        long_edge = max(float(rect.width or 0), float(rect.height or 0), 1.0)
        scale = min(8.0, 2400.0 / long_edge)
        total_pixels += max(1, int(rect.width * scale)) * max(1, int(rect.height * scale))
        if total_pixels > 120_000_000:
            raise ValueError("PDF_PREVIEW_LIMIT: PDF 预览总像素过大，请拆分后预览")
        pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        target = output_dir / f"page-{index + 1}.png"
        pixmap.save(str(target))
        pages.append({
            "page": index + 1,
            "preview_path": str(target),
            "width": pixmap.width,
            "height": pixmap.height,
        })
finally:
    doc.close()

print(json.dumps({"pages": pages}, ensure_ascii=False))
`.trim()

  try {
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8' }
    delete env.ELECTRON_RUN_AS_NODE
    const stdout = execFileSync(pythonBin, ['-c', script, pdfPath, outputDir], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    })
    const parsed = JSON.parse(String(stdout || '').trim() || '{}')
    const pages = Array.isArray(parsed.pages)
      ? parsed.pages
        .filter(page => page?.preview_path && fs.existsSync(page.preview_path))
        .map(page => pdfPreviewPageFromImage(
          page.preview_path,
          Number(page.page) || 1,
          Number(page.width) || 0,
          Number(page.height) || 0,
        ))
      : []
    if (!pages.length) return { ok: false, error: 'PyMuPDF 没有渲染出 PDF 页面。' }
    return {
      ok: true,
      engine: 'pymupdf',
      page_count: pages.length,
      pages,
      preview_path: pages[0].preview_path,
      data_url: pages[0].data_url,
    }
  } catch (error) {
    const stderr = String(error?.stderr || '').trim()
    const detail = stderr || error.message || String(error)
    return { ok: false, error: detail }
  }
}

function renderPdfPreviewWithQuickLook(pdfPath, pythonBin, dataDir) {
  if (!fs.existsSync(pdfPath) || !fs.statSync(pdfPath).isFile()) {
    return { ok: false, error: `PDF 文件不存在：${pdfPath}` }
  }
  if (path.extname(pdfPath).toLowerCase() !== '.pdf') {
    return { ok: false, error: '请选择 PDF 文件进行预览框选。' }
  }

  const previewRoot = path.join(dataDir, 'pdf-previews')
  if (fs.statSync(pdfPath).size > 256 * 1024 * 1024) return { ok: false, error: 'PDF 超过 256MB，请拆分后预览' }
  fs.mkdirSync(previewRoot, { recursive: true })
  // Recover abandoned outputs from older versions or interrupted sessions.
  for (const name of fs.readdirSync(previewRoot)) {
    if (!name.startsWith('preview-')) continue
    const candidate = path.join(previewRoot, name)
    const stat = fs.lstatSync(candidate)
    if (stat.isDirectory() && Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000) {
      fs.rmSync(candidate, { recursive: true, force: true })
    }
  }
  const outputDir = fs.mkdtempSync(path.join(previewRoot, 'preview-'))

  try {
    const pymupdfResult = renderPdfPreviewWithPyMuPDF(pdfPath, path.join(outputDir, 'pages'), pythonBin)
    if (pymupdfResult.ok) return pymupdfResult
    if (pymupdfResult.error?.includes('PDF_PREVIEW_LIMIT')) {
      fs.rmSync(outputDir, { recursive: true, force: true })
      return pymupdfResult
    }
    if (process.platform !== 'darwin') {
      return { ok: false, error: `PDF 预览图生成失败：PyMuPDF: ${pymupdfResult.error}` }
    }

    try {
      const quickLookBin = fs.existsSync('/usr/bin/qlmanage') ? '/usr/bin/qlmanage' : 'qlmanage'
      execFileSync(quickLookBin, ['-t', '-s', '1800', '-o', outputDir, pdfPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 45000,
      })
      const previewPath = findQuickLookPdfPreview(pdfPath, outputDir)
      if (!previewPath) {
        const produced = fs.readdirSync(outputDir).join(', ')
        return { ok: false, error: `PDF 预览图生成失败：PyMuPDF: ${pymupdfResult.error}；Quick Look 没有输出图片。输出目录：${produced || '空'}` }
      }
      const page = pdfPreviewPageFromImage(previewPath, 1)
      return {
        ok: true,
        engine: 'quicklook',
        page_count: 1,
        pages: [page],
        preview_path: '',
        data_url: page.data_url,
      }
    } catch (error) {
      const stderr = String(error?.stderr || '').trim()
      const detail = stderr || error.message || String(error)
      return { ok: false, error: `PDF 预览图生成失败：PyMuPDF: ${pymupdfResult.error}；Quick Look: ${detail}` }
    }
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true })
  }
}

if (!isMainThread) {
  parentPort.on('message', ({ id, args }) => {
    try {
      const result = renderPdfPreviewWithQuickLook(args.pdfPath, args.pythonBin, args.dataDir)
      parentPort.postMessage({ id, result })
    } catch (error) { parentPort.postMessage({ id, error: error.message }) }
  })
}

function createPdfPreviewWorker() {
  let worker = null
  let nextId = 0
  let closing = false
  const pending = new Map()
  function fail(error, source) {
    if (source !== worker) return
    worker = null
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }
  return {
    run(args) {
      if (closing) return Promise.reject(new Error('PDF 预览服务已关闭'))
      if (!worker) {
        const source = worker = new Worker(__filename)
        source.on('message', ({ id, result, error }) => {
          if (source !== worker) return
          const request = pending.get(id)
          if (!request) return
          pending.delete(id)
          if (error) request.reject(new Error(error))
          else request.resolve(result)
          if (!pending.size) source.unref()
        })
        source.on('error', error => fail(error, source))
        source.on('exit', () => fail(new Error('PDF 预览服务已退出，请重试'), source))
      }
      const id = ++nextId
      worker.ref()
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        try { worker.postMessage({ id, args }) } catch (error) {
          pending.delete(id)
          if (!pending.size) worker.unref()
          reject(error)
        }
      })
    },
    async close() {
      closing = true
      if (!worker) return
      const source = worker
      if (pending.size) await new Promise(resolve => {
        const check = () => { if (!pending.size || worker !== source) { source.removeListener('message', check); source.removeListener('exit', check); resolve() } }
        source.on('message', check)
        source.on('exit', check)
        check()
      })
      fail(new Error('PDF 预览服务已关闭'), source)
      await source.terminate()
    },
  }
}

module.exports = { createPdfPreviewWorker }
