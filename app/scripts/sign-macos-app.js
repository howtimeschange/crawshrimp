'use strict'

const fs = require('fs')
const { signAsync } = require('@electron/osx-sign')

const MACH_O_MAGICS = new Set([
  0xfeedface,
  0xfeedfacf,
  0xcefaedfe,
  0xcffaedfe,
  0xcafebabe,
  0xcafebabf,
  0xbebafeca,
  0xbfbafeca,
])

function isMachOFile(filePath) {
  const header = Buffer.alloc(4)
  let descriptor
  try {
    descriptor = fs.openSync(filePath, 'r')
    if (fs.readSync(descriptor, header, 0, header.length, 0) !== header.length) return false
    return MACH_O_MAGICS.has(header.readUInt32BE(0))
  } catch {
    return false
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

function createPythonDataIgnore(existingIgnore = () => false) {
  return filePath => {
    if (existingIgnore(filePath)) return true
    const normalizedPath = String(filePath || '').replace(/\\\\/g, '/')
    if (!normalizedPath.includes('/Contents/Resources/python/')) return false
    return !isMachOFile(filePath)
  }
}

async function signMacApp(options) {
  return signAsync({
    ...options,
    ignore: createPythonDataIgnore(options.ignore),
  })
}

module.exports = signMacApp
module.exports.default = signMacApp
module.exports.createPythonDataIgnore = createPythonDataIgnore
module.exports.isMachOFile = isMachOFile
