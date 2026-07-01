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
  assert.match(buildYml, /^  notarize:\n    teamId: 62AR7GLNK3$/m)
  assert.equal(fs.existsSync(path.join(repoRoot, 'app/assets/entitlements.mac.plist')), true)
  assert.equal(fs.existsSync(path.join(repoRoot, 'app/assets/entitlements.mac.inherit.plist')), true)
})

test('desktop workflow provides mac signing and notarization secrets to electron-builder', () => {
  const workflow = readRepoFile('.github/workflows/build-desktop.yml')

  assert.match(workflow, /Prepare Apple notarization credentials/)
  assert.match(workflow, /APPLE_API_KEY_BASE64: \$\{\{ secrets\.APPLE_API_KEY_BASE64 \}\}/)
  assert.match(workflow, /APPLE_API_KEY_ID_SECRET: \$\{\{ secrets\.APPLE_API_KEY_ID \}\}/)
  assert.match(workflow, /APPLE_API_ISSUER_SECRET: \$\{\{ secrets\.APPLE_API_ISSUER \}\}/)
  assert.match(workflow, /echo "APPLE_API_KEY=\$\{key_path\}"/)
  assert.match(workflow, /echo "APPLE_API_KEY_ID=\$\{APPLE_API_KEY_ID_SECRET\}"/)
  assert.match(workflow, /echo "APPLE_API_ISSUER=\$\{APPLE_API_ISSUER_SECRET\}"/)
  assert.match(workflow, /CSC_LINK: \$\{\{ secrets\.MAC_CSC_LINK \}\}/)
  assert.match(workflow, /CSC_KEY_PASSWORD: \$\{\{ secrets\.MAC_CSC_KEY_PASSWORD \}\}/)
  assert.match(workflow, /CSC_NAME: "Developer ID Application: yicheng xing \(62AR7GLNK3\)"/)
})
