'use strict'

const path = require('path')
const { spawnSync } = require('child_process')

async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.CRAWSHRIMP_NOTARIZE_APP !== '1') return

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  )
  const script = path.join(__dirname, 'notarize-macos-app.sh')
  const result = spawnSync('bash', [script, appPath], {
    cwd: path.dirname(__dirname),
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`macOS app notarization failed with exit code ${result.status}`)
  }
}

exports.default = afterSign
