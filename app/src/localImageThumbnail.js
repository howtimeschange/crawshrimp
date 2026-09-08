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
  return async function readThumbnail(imagePath, opts = {}) {
    if (active >= limit) await new Promise(resolve => waiting.push(resolve))
    else active += 1
    try {
      const stat = await fs.stat(imagePath)
      if (!stat.isFile()) throw new Error('图片文件不存在')
      if (stat.size > 80 * 1024 * 1024) throw new Error('图片超过 80MB，无法生成缩略图')
      const maxEdge = Math.max(64, Math.min(Number(opts.maxEdge || opts.max_edge || 320) || 320, 1280))
      const quality = Math.round(Math.max(0.4, Math.min(Number(opts.quality || 0.72) || 0.72, 0.95)) * 100)
      const result = await decode(imagePath, maxEdge, quality)
      if (!result?.data_url || !(result.width > 0) || !(result.height > 0)) throw new Error('图片解码失败')
      return { ...result, ok: true, path: imagePath, thumbnail: true }
    } catch (error) {
      throw new Error(`本地缩略图不可用：${error?.stderr || error?.message || String(error)}`)
    } finally {
      const next = waiting.shift()
      if (next) next()
      else active -= 1
    }
  }
}

module.exports = { createThumbnailReader }
