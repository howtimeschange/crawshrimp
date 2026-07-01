import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

test('mac desktop packaging is configured for Developer ID notarization', () => {
  const buildYml = readRepoFile('app/build.yml')

  assert.match(buildYml, /^  hardenedRuntime: true$/m)
  assert.match(buildYml, /^  entitlements: assets\/entitlements\.mac\.plist$/m)
  assert.match(buildYml, /^  entitlementsInherit: assets\/entitlements\.mac\.inherit\.plist$/m)
  assert.doesNotMatch(buildYml, /^  notarize:\n    teamId:/m)
  assert.equal(fs.existsSync(path.join(repoRoot, 'app/assets/entitlements.mac.plist')), true)
  assert.equal(fs.existsSync(path.join(repoRoot, 'app/assets/entitlements.mac.inherit.plist')), true)
})

test('desktop workflow signs with electron-builder and notarizes DMGs in a separate step', () => {
  const workflow = readRepoFile('.github/workflows/build-desktop.yml')
  const notarizeScript = readRepoFile('app/scripts/notarize-macos-dmgs.sh')

  assert.match(workflow, /Prepare Apple notarization credentials/)
  assert.match(workflow, /APPLE_API_KEY_BASE64: \$\{\{ secrets\.APPLE_API_KEY_BASE64 \}\}/)
  assert.match(workflow, /APPLE_API_KEY_ID_SECRET: \$\{\{ secrets\.APPLE_API_KEY_ID \}\}/)
  assert.match(workflow, /APPLE_API_ISSUER_SECRET: \$\{\{ secrets\.APPLE_API_ISSUER \}\}/)
  assert.match(workflow, /echo "APPLE_NOTARY_KEY=\$\{key_path\}"/)
  assert.match(workflow, /echo "APPLE_NOTARY_KEY_ID=\$\{APPLE_API_KEY_ID_SECRET\}"/)
  assert.match(workflow, /echo "APPLE_NOTARY_ISSUER=\$\{APPLE_API_ISSUER_SECRET\}"/)
  assert.doesNotMatch(workflow, /echo "APPLE_API_KEY=\$\{key_path\}"/)
  assert.match(workflow, /CSC_LINK: \$\{\{ secrets\.MAC_CSC_LINK \}\}/)
  assert.match(workflow, /CSC_KEY_PASSWORD: \$\{\{ secrets\.MAC_CSC_KEY_PASSWORD \}\}/)
  assert.match(workflow, /CSC_NAME: "yicheng xing \(62AR7GLNK3\)"/)
  assert.match(workflow, /Prepare Apple notarization credentials\n        if: matrix\.artifact_suffix == 'mac' && startsWith\(github\.ref, 'refs\/tags\/v'\)/)
  assert.match(workflow, /Notarize and staple macOS DMGs/)
  assert.match(workflow, /Notarize and staple macOS DMGs\n        if: matrix\.artifact_suffix == 'mac' && startsWith\(github\.ref, 'refs\/tags\/v'\)/)
  assert.match(workflow, /APPLE_NOTARY_TIMEOUT: 2h/)
  assert.match(workflow, /APPLE_NOTARY_POLL_INTERVAL: 60/)
  assert.match(workflow, /bash scripts\/notarize-macos-dmgs\.sh/)
  assert.match(workflow, /publish-release:[\s\S]*?if: startsWith\(github\.ref, 'refs\/tags\/v'\)/)
  assert.doesNotMatch(workflow, /if: github\.ref == 'refs\/heads\/main'/)

  assert.match(notarizeScript, /xcrun notarytool submit/)
  assert.doesNotMatch(notarizeScript, /--wait/)
  assert.match(notarizeScript, /xcrun notarytool info/)
  assert.match(notarizeScript, /APPLE_NOTARY_POLL_INTERVAL/)
  assert.match(notarizeScript, /xcrun stapler staple/)
  assert.match(notarizeScript, /xcrun stapler validate/)
})
