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
  assert.match(buildYml, /^afterSign: scripts\/notarize-macos-app\.js$/m)
  assert.doesNotMatch(buildYml, /^  notarize:\n    teamId:/m)
  assert.equal(fs.existsSync(path.join(repoRoot, 'app/assets/entitlements.mac.plist')), true)
  assert.equal(fs.existsSync(path.join(repoRoot, 'app/assets/entitlements.mac.inherit.plist')), true)
})

test('mac desktop signing ignores bundled Python bytecode but not native runtime binaries', () => {
  const buildYml = readRepoFile('app/build.yml')
  const signIgnoreMatch = buildYml.match(/^  signIgnore:\n    - '([^']+)'$/m)

  assert.ok(signIgnoreMatch, 'mac signIgnore contains one scoped regex')
  const signIgnore = new RegExp(signIgnoreMatch[1])
  assert.match('/抓虾.app/Contents/Resources/python/pkg/__pycache__/module.pyc', signIgnore)
  assert.doesNotMatch('/抓虾.app/Contents/Resources/python/bin/python3', signIgnore)
  assert.doesNotMatch('/抓虾.app/Contents/Resources/python/lib/native.so', signIgnore)
})

test('desktop workflow signs with electron-builder and notarizes apps before DMGs on formal tags', () => {
  const workflow = readRepoFile('.github/workflows/build-desktop.yml')
  const notarizeScript = readRepoFile('app/scripts/notarize-macos-dmgs.sh')
  const appBridge = readRepoFile('app/scripts/notarize-macos-app.js')
  const appNotarizeScript = readRepoFile('app/scripts/notarize-macos-app.sh')

  assert.match(workflow, /Prepare Apple notarization credentials/)
  assert.match(workflow, /APPLE_API_KEY_BASE64: \$\{\{ secrets\.APPLE_API_KEY_BASE64 \}\}/)
  assert.match(workflow, /APPLE_API_KEY_ID_SECRET: \$\{\{ secrets\.APPLE_API_KEY_ID \}\}/)
  assert.match(workflow, /APPLE_API_ISSUER_SECRET: \$\{\{ secrets\.APPLE_API_ISSUER \}\}/)
  assert.match(workflow, /MAC_CSC_LINK_SECRET: \$\{\{ secrets\.MAC_CSC_LINK \}\}/)
  assert.match(workflow, /MAC_CSC_KEY_PASSWORD_SECRET: \$\{\{ secrets\.MAC_CSC_KEY_PASSWORD \}\}/)
  assert.match(workflow, /::error::Missing Apple notarization or CSC signing credentials for formal macOS tag build/)
  assert.match(workflow, /exit 1/)
  assert.match(workflow, /echo "APPLE_NOTARY_KEY=\$\{key_path\}"/)
  assert.match(workflow, /echo "APPLE_NOTARY_KEY_ID=\$\{APPLE_API_KEY_ID_SECRET\}"/)
  assert.match(workflow, /echo "APPLE_NOTARY_ISSUER=\$\{APPLE_API_ISSUER_SECRET\}"/)
  assert.match(workflow, /echo "CRAWSHRIMP_NOTARIZE_APP=1"/)
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
  assert.match(workflow, /Validate notarized macOS ZIP apps/)
  assert.match(workflow, /unzip -Z1 "\$\{zip_file\}" > "\$\{zip_listing\}"/)
  assert.match(workflow, /Unsafe ZIP entry/)
  assert.match(workflow, /case "\$\{zip_entry\}" in/)
  assert.match(workflow, /\[A-Za-z\]:\*/)
  assert.match(workflow, /\*\\\\\*/)
  assert.match(workflow, /if \[ "\$\{zip_part\}" = "\.\." \]/)
  assert.match(workflow, /unzip -q "\$\{zip_file\}" -d "\$\{extract_dir\}"/)
  assert.match(workflow, /codesign --verify --deep --strict --verbose=2 "\$\{app_path\}"/)
  assert.match(workflow, /codesign -dv --verbose=4 "\$\{app_path\}"/)
  assert.match(workflow, /TeamIdentifier=62AR7GLNK3/)
  assert.match(workflow, /spctl --assess --type execute --verbose=2 "\$\{app_path\}"/)
  assert.match(workflow, /xcrun stapler validate "\$\{app_path\}"/)
  assert.match(workflow, /publish-release:[\s\S]*?if: startsWith\(github\.ref, 'refs\/tags\/v'\)/)
  assert.doesNotMatch(workflow, /if: github\.ref == 'refs\/heads\/main'/)

  assert.match(appBridge, /context\.electronPlatformName !== 'darwin'/)
  assert.match(appBridge, /process\.env\.CRAWSHRIMP_NOTARIZE_APP !== '1'/)
  assert.match(appBridge, /spawnSync\('bash', \[script, appPath\]/)

  assert.match(appNotarizeScript, /if \[ "\$#" -ne 1 \]/)
  assert.match(appNotarizeScript, /codesign --verify --deep --strict --verbose=2 "\$\{app_path\}"/)
  assert.match(appNotarizeScript, /codesign -dv --verbose=4 "\$\{app_path\}"/)
  assert.match(appNotarizeScript, /TeamIdentifier=62AR7GLNK3/)
  assert.match(appNotarizeScript, /Authority=Developer ID Application: yicheng xing \(62AR7GLNK3\)/)
  assert.match(appNotarizeScript, /ditto -c -k --keepParent "\$\{app_path\}"/)
  assert.match(appNotarizeScript, /xcrun notarytool submit "\$\{zip_path\}"/)
  assert.doesNotMatch(appNotarizeScript, /--wait/)
  assert.match(appNotarizeScript, /APPLE_NOTARY_POLL_INTERVAL/)
  assert.match(appNotarizeScript, /xcrun notarytool info/)
  assert.match(appNotarizeScript, /xcrun notarytool log/)
  assert.match(appNotarizeScript, /xcrun stapler staple "\$\{app_path\}"/)
  assert.match(appNotarizeScript, /xcrun stapler validate "\$\{app_path\}"/)
  assert.match(appNotarizeScript, /spctl --assess --type execute --verbose=2 "\$\{app_path\}"/)

  assert.match(notarizeScript, /xcrun notarytool submit/)
  assert.doesNotMatch(notarizeScript, /--wait/)
  assert.match(notarizeScript, /mktemp "\$\{RUNNER_TEMP:-\/tmp\}\/notary-result\.XXXXXX"/)
  assert.match(notarizeScript, /mktemp "\$\{RUNNER_TEMP:-\/tmp\}\/notary-info\.XXXXXX"/)
  assert.doesNotMatch(notarizeScript, /mktemp [^\n]+XXXXXX\.json/)
  assert.match(notarizeScript, /xcrun notarytool info/)
  assert.match(notarizeScript, /APPLE_NOTARY_POLL_INTERVAL/)
  assert.match(notarizeScript, /xcrun stapler staple/)
  assert.match(notarizeScript, /xcrun stapler validate/)
})

test('app identity proof and safe ZIP listing happen before upload and extraction', () => {
  const workflow = readRepoFile('.github/workflows/build-desktop.yml')
  const appNotarizeScript = readRepoFile('app/scripts/notarize-macos-app.sh')

  const appDetailsIndex = appNotarizeScript.indexOf('codesign -dv --verbose=4 "${app_path}"')
  const appTeamIndex = appNotarizeScript.indexOf('TeamIdentifier=62AR7GLNK3')
  const appAuthorityIndex = appNotarizeScript.indexOf('Authority=Developer ID Application: yicheng xing (62AR7GLNK3)')
  const appZipIndex = appNotarizeScript.indexOf('ditto -c -k --keepParent "${app_path}"')
  const appSubmitIndex = appNotarizeScript.indexOf('xcrun notarytool submit "${zip_path}"')

  assert.ok(appDetailsIndex !== -1, 'app signing details are inspected')
  assert.ok(appTeamIndex > appDetailsIndex && appTeamIndex < appZipIndex, 'TeamIdentifier is checked before zipping')
  assert.ok(appAuthorityIndex > appDetailsIndex && appAuthorityIndex < appZipIndex, 'Developer ID Application authority is checked before zipping')
  assert.ok(appZipIndex < appSubmitIndex, 'app is zipped before notarization submit')

  const zipListIndex = workflow.indexOf('unzip -Z1 "${zip_file}" > "${zip_listing}"')
  const unsafeIndex = workflow.indexOf('Unsafe ZIP entry')
  const zipExtractIndex = workflow.indexOf('unzip -q "${zip_file}" -d "${extract_dir}"')

  assert.ok(zipListIndex !== -1, 'ZIP entries are listed before extraction')
  assert.ok(unsafeIndex > zipListIndex && unsafeIndex < zipExtractIndex, 'unsafe ZIP entries are rejected before extraction')
})

test('desktop Python bundle install does not use user site packages', () => {
  const downloadPythonScript = readRepoFile('app/scripts/download-python.sh')

  assert.match(downloadPythonScript, /PYTHONNOUSERSITE=1 "\$py_bin" -m pip install/)
})
