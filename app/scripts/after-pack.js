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

const REQUIRED_BACKEND_IMPORTS = [
  'fastapi',
  'uvicorn',
  'websockets',
  'yaml',
  'apscheduler',
  'openpyxl',
  'xlrd',
  'pydantic',
  'aiofiles',
  'jsonschema',
  'tzdata',
  'PIL',
  'fitz',
]

const REQUIRED_VIDEO_INTEGRATION_FILES = [
  'seedanceCLI/package.json',
  'seedanceCLI/bin/seedance.js',
  'seedanceCLI/src/ark-client.js',
  'seedanceCLI/src/config.js',
  'bailianCLI/package.json',
  'bailianCLI/bin/bailian.js',
  'bailianCLI/src/bailian-client.js',
  'bailianCLI/src/config.js',
]

function getPythonExecutable(srcPython, srcKey = '') {
  if (srcKey === 'win-x64') return path.join(srcPython, 'python.exe')
  if (srcKey === 'mac-arm64' || srcKey === 'mac-x64') return path.join(srcPython, 'bin', 'python3')
  return null
}

function getSitePackagesDir(srcPython, srcKey = '') {
  if (srcKey === 'win-x64') return path.join(srcPython, 'Lib', 'site-packages')
  if (srcKey === 'mac-arm64' || srcKey === 'mac-x64') return path.join(srcPython, 'lib', 'python3.12', 'site-packages')
  return null
}

function requirePythonBundle(srcPython, srcKey = '') {
  if (!fs.existsSync(srcPython)) {
    throw new Error(
      `[after-pack] bundled Python not found at ${srcPython}. ` +
      'Run app/scripts/download-python.sh before building the desktop package.'
    )
  }

  const executable = getPythonExecutable(srcPython, srcKey)
  if (executable && !fs.existsSync(executable)) {
    throw new Error(`[after-pack] bundled Python executable not found: ${executable}`)
  }

  const sitePackages = getSitePackagesDir(srcPython, srcKey)
  if (!sitePackages) return
  if (!fs.existsSync(sitePackages)) {
    throw new Error(`[after-pack] bundled Python site-packages not found: ${sitePackages}`)
  }

  const missing = REQUIRED_BACKEND_IMPORTS.filter(name => !fs.existsSync(path.join(sitePackages, name)))
  if (missing.length) {
    throw new Error(
      `[after-pack] missing bundled Python dependencies in ${sitePackages}: ${missing.join(', ')}. ` +
      'Run app/scripts/download-python.sh to refresh python-dist.'
    )
  }
}

function requireAdapterManifests(adaptersDir) {
  if (!fs.existsSync(adaptersDir)) {
    throw new Error(`[after-pack] bundled adapter manifest not found under ${adaptersDir}`)
  }
  let adapterCount = 0
  for (const entry of fs.readdirSync(adaptersDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    adapterCount += 1
    const adapterDir = path.join(adaptersDir, entry.name)
    const manifestPath = path.join(adapterDir, 'manifest.yaml')
    try {
      fs.accessSync(adapterDir, fs.constants.R_OK)
      fs.accessSync(manifestPath, fs.constants.R_OK)
      if (!fs.statSync(manifestPath).isFile()) {
        throw new Error('manifest.yaml is not a file')
      }
    } catch (e) {
      throw new Error(`[after-pack] adapter ${entry.name} missing manifest.yaml or unreadable: ${e.message}`)
    }
  }
  if (!adapterCount) {
    throw new Error(`[after-pack] bundled adapter manifest not found under ${adaptersDir}`)
  }
}

function requirePythonScriptsBundle(resourcesPath) {
  const scriptsDir = path.join(resourcesPath, 'python-scripts')
  const apiServer = path.join(scriptsDir, 'core', 'api_server.py')
  if (!fs.existsSync(apiServer)) {
    throw new Error(`[after-pack] bundled backend api_server.py not found: ${apiServer}`)
  }

  const adaptersDir = path.join(scriptsDir, 'adapters')
  requireAdapterManifests(adaptersDir)

  const integrationsDir = path.join(scriptsDir, 'integrations')
  const missingIntegrations = REQUIRED_VIDEO_INTEGRATION_FILES.filter(relativePath => {
    const target = path.join(integrationsDir, relativePath)
    return !fs.existsSync(target) || !fs.statSync(target).isFile()
  })
  if (missingIntegrations.length) {
    throw new Error(
      `[after-pack] shared video integration files are missing under ${integrationsDir}: ` +
      missingIntegrations.join(', ')
    )
  }
}

async function afterPack(context) {
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
  requirePythonBundle(srcPython, srcKey)

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

  requirePythonScriptsBundle(resourcesPath)

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

exports.default = afterPack
exports.requirePythonBundle = requirePythonBundle
exports.requirePythonScriptsBundle = requirePythonScriptsBundle
exports.REQUIRED_BACKEND_IMPORTS = REQUIRED_BACKEND_IMPORTS
exports.REQUIRED_VIDEO_INTEGRATION_FILES = REQUIRED_VIDEO_INTEGRATION_FILES
