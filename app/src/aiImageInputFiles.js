'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const MAX_IMAGE_INPUT_BYTES = 20 * 1024 * 1024

function assertImageInputSize(size, name = '图片') {
  if (size > MAX_IMAGE_INPUT_BYTES) {
    throw new Error(`${path.basename(name)}：${(size / 1024 / 1024).toFixed(2)} MB，超过单张 20 MB 上限`)
  }
  if (!size) throw new Error(`${path.basename(name)}：图片文件为空`)
}

function imageExtension(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg'
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  throw new Error('仅支持 PNG、JPEG、WebP 图片，请检查文件内容')
}

function importImageInput(input, { dataDir, canDecode }) {
  const name = String(input?.name || input?.path || '剪贴板图片')
  let bytes
  if (input?.path) {
    const fd = fs.openSync(String(input.path), 'r')
    try {
      const stat = fs.fstatSync(fd)
      if (!stat.isFile()) throw new Error(`${path.basename(name)}：请选择图片文件`)
      assertImageInputSize(stat.size, name)
      // Bound reads even if the selected file grows after stat.
      const buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_IMAGE_INPUT_BYTES + 1))
      let length = 0
      while (length < buffer.length) {
        const read = fs.readSync(fd, buffer, length, buffer.length - length, null)
        if (!read) break
        length += read
      }
      if (length !== stat.size) throw new Error(`${path.basename(name)}：文件正在变化，请重新导入`)
      bytes = buffer.subarray(0, length)
    } finally { fs.closeSync(fd) }
  } else {
    if (!(input?.bytes instanceof Uint8Array)) throw new Error('未读取到图片数据')
    assertImageInputSize(input.bytes.byteLength, name)
    bytes = Buffer.from(input.bytes)
  }
  assertImageInputSize(bytes.length, name)
  const extension = imageExtension(bytes)
  if (!canDecode(bytes)) throw new Error(`${path.basename(name)}：图片损坏或无法解码`)
  const digest = crypto.createHash('sha256').update(bytes).digest('hex')
  const directory = path.join(dataDir, 'ai-image-inputs')
  fs.mkdirSync(directory, { recursive: true })
  const target = path.join(directory, `${digest}.${extension}`)
  // Stable local copy: moving the original cannot break saved generation inputs.
  try { fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 }) }
  catch (error) { if (error.code !== 'EEXIST') throw error }
  return { ok: true, path: target, name: path.basename(name), size: bytes.length,
    mime: { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[extension], sha256: digest,
    source: input?.path ? 'file' : 'clipboard', imported_at: new Date().toISOString() }
}
function imageInputDirectory(dataDir, role) {
  try {
    const remembered = JSON.parse(fs.readFileSync(path.join(dataDir, 'image-input-directories.json'), 'utf8'))[role]
    return remembered && fs.statSync(remembered).isDirectory() ? remembered : undefined
  } catch { return undefined }
}
function rememberImageInputDirectory(dataDir, role, sourcePath) {
  if (!['main', 'reference'].includes(role) || !sourcePath) return
  try { if (!fs.statSync(sourcePath).isFile()) return } catch { return }
  const file = path.join(dataDir, 'image-input-directories.json')
  let saved = {}
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')) } catch {}
  saved[role] = path.dirname(path.resolve(sourcePath))
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(file + '.tmp', JSON.stringify(saved), { mode: 0o600 })
  fs.renameSync(file + '.tmp', file)
}
module.exports = { MAX_IMAGE_INPUT_BYTES, assertImageInputSize, importImageInput, imageInputDirectory, rememberImageInputDirectory }
