'use strict'

const fs = require('node:fs/promises')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const execute = promisify(execFile)

// Decode actual pixels outside Electron's main thread. Shell thumbnail APIs may
// return a nonempty generic file icon even when the source image is damaged.
const thumbnailScript = `
import base64, io, json, sys, warnings
from PIL import Image, ImageOps
Image.MAX_IMAGE_PIXELS = 40_000_000
warnings.simplefilter("error", Image.DecompressionBombWarning)
with Image.open(sys.argv[1]) as source:
    if source.format not in ("PNG", "JPEG", "WEBP", "GIF"):
        raise ValueError("不支持的图片格式")
    source.seek(0)
    source.load()
    image = ImageOps.exif_transpose(source)
    image.thumbnail((int(sys.argv[2]), int(sys.argv[2])), Image.Resampling.LANCZOS)
    if image.mode in ("RGBA", "LA") or "transparency" in image.info:
        rgba = image.convert("RGBA")
        image = Image.new("RGB", rgba.size, "white")
        image.paste(rgba, mask=rgba.getchannel("A"))
    else:
        image = image.convert("RGB")
    output = io.BytesIO()
    image.save(output, format="JPEG", quality=int(sys.argv[3]))
    raw = output.getvalue()
    print(json.dumps({"width": image.width, "height": image.height, "bytes": len(raw), "data_url": "data:image/jpeg;base64," + base64.b64encode(raw).decode("ascii")}))
`

function createThumbnailReader({ getPythonBin, concurrency = 2, decodeImage } = {}) {
  const limit = Math.max(1, Math.min(4, Number(concurrency) || 2))
  const decode = decodeImage || (async (imagePath, maxEdge, quality) => {
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8' }
    delete env.ELECTRON_RUN_AS_NODE
    const { stdout } = await execute(getPythonBin(), ['-c', thumbnailScript, imagePath, String(maxEdge), String(quality)], {
      env, encoding: 'utf8', timeout: 20000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
    })
    return JSON.parse(stdout)
  })
  let active = 0
  const waiting = []
  const inFlight = new Map()
  const inspecting = new Set()
  const maxWaiting = 64
  function pump() {
    while (active < limit && waiting.length) {
      const job = waiting.shift()
      active++
      job.run().then(job.resolve, job.reject).finally(() => { active--; pump() })
    }
  }
  function cancelScope(scope) {
    for (const request of inspecting) if (request.scope === scope) request.cancelled = true
    for (let i = waiting.length - 1; i >= 0; i--) {
      if (waiting[i].scope !== scope) continue
      const [job] = waiting.splice(i, 1)
      job.reject(new Error('缩略图请求已取消'))
    }
  }
  async function readThumbnail(imagePath, opts = {}) {
    const inspection = { scope: String(opts.scope || ''), cancelled: false }
    inspecting.add(inspection)
    let stat
    try { stat = await fs.stat(imagePath) } finally { inspecting.delete(inspection) }
    if (inspection.cancelled) throw new Error('缩略图请求已取消')
    if (!stat.isFile()) throw new Error('图片文件不存在')
    if (stat.size > 80 * 1024 * 1024) throw new Error('图片超过 80MB，无法生成缩略图')
    const maxEdge = Math.max(64, Math.min(Number(opts.maxEdge || opts.max_edge || 320) || 320, 1280))
    const quality = Math.round(Math.max(0.4, Math.min(Number(opts.quality || 0.72) || 0.72, 0.95)) * 100)
    const scope = String(opts.scope || '')
    const key = JSON.stringify([scope, imagePath, stat.mtimeMs, stat.ctimeMs, stat.size, maxEdge, quality])
    if (inFlight.has(key)) return inFlight.get(key)
    if (waiting.length >= maxWaiting) throw new Error('缩略图队列已满，请稍后重试')
    const promise = new Promise((resolve, reject) => {
      const job = { scope, resolve, reject, async run() {
        try {
          const result = await decode(imagePath, maxEdge, quality)
          if (!result?.data_url || !(result.width > 0) || !(result.height > 0)) throw new Error('图片解码失败')
          return { ...result, ok: true, path: imagePath, thumbnail: true }
        } catch (error) {
          throw new Error(`本地缩略图不可用：${error?.stderr || error?.message || String(error)}`)
        }
      } }
      if (opts.priority === 'visible') waiting.unshift(job)
      else waiting.push(job)
      pump()
    })
    inFlight.set(key, promise)
    try { return await promise } finally { if (inFlight.get(key) === promise) inFlight.delete(key) }
  }
  readThumbnail.cancelScope = cancelScope
  return readThumbnail
}

module.exports = { createThumbnailReader }
