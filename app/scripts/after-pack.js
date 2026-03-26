/**
 * after-pack.js — electron-builder afterPack hook
 *
 * Copies the correct Python interpreter for each platform/arch
 * into Resources/python/ after Electron is packaged.
 *
 * Expected python-dist/ layout (inside app/):
 *   python-dist/
 *     mac-arm64/   macOS arm64
 *     mac-x64/     macOS x64
 *     win-x64/     Windows x64
 *
 * Download with: app/scripts/download-python.sh
 */

const fs   = require('fs')
const path = require('path')

exports.default = async function afterPack(context) {
  const { electronPlatformName, arch, appOutDir } = context
  // arch: 0=ia32, 1=x64, 2=armv7l, 3=arm64
  const archName = arch === 3 ? 'arm64' : 'x64'

  let srcKey
  if (electronPlatformName === 'darwin') {
    srcKey = archName === 'arm64' ? 'mac-arm64' : 'mac-x64'
  } else if (electronPlatformName === 'win32') {
    srcKey = 'win-x64'
  } else {
    console.log(`[after-pack] skip unsupported platform: ${electronPlatformName}`)
    return
  }

  const scriptDir = path.dirname(__dirname)  // app/
  const srcPython = path.join(scriptDir, 'python-dist', srcKey)

  if (!fs.existsSync(srcPython)) {
    console.warn(`[after-pack] WARN: bundled Python not found at ${srcPython}`)
    console.warn('[after-pack] Run app/scripts/download-python.sh first')
    return
  }

  let resourcesPath
  if (electronPlatformName === 'darwin') {
    resourcesPath = path.join(
      appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents', 'Resources'
    )
  } else {
    resourcesPath = path.join(appOutDir, 'resources')
  }

  const destPython = path.join(resourcesPath, 'python')
  console.log(`[after-pack] Copying Python ${srcKey} → ${destPython}`)
  fs.mkdirSync(destPython, { recursive: true })
  copyDirSync(srcPython, destPython)
  console.log(`[after-pack] Python bundled (${srcKey})`)
}

function copyDirSync(src, dest) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true })
      copyDirSync(s, d)
    } else if (entry.isSymbolicLink()) {
      try {
        const realSrc = fs.realpathSync(s)
        fs.copyFileSync(realSrc, d)
      } catch {
        try {
          if (fs.existsSync(d)) fs.unlinkSync(d)
          fs.symlinkSync(fs.readlinkSync(s), d)
        } catch (e) {
          console.warn(`[after-pack] WARN: symlink ${s}: ${e.message}`)
        }
      }
    } else {
      fs.copyFileSync(s, d)
    }
  }
}
