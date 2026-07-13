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

function cssRule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  return match?.[1] || ''
}

test('desktop updater dependency and state service are restored', () => {
  const packageJson = JSON.parse(readRepoFile('app/package.json'))
  const updateServicePath = path.join(repoRoot, 'app/src/updateService.js')
  const updateService = readRepoFile('app/src/updateService.js')
  const main = readRepoFile('app/src/main.js')
  const preload = readRepoFile('app/src/preload.js')

  assert.equal(packageJson.dependencies['electron-updater'], '6.8.9')
  assert.equal(packageJson.crawshrimpUpdateFeedUrl, 'https://updates.crawshrimp.com/')
  assert.equal(fs.existsSync(updateServicePath), true)
  assert.match(updateService, /autoDownload = false/)
  assert.match(updateService, /autoInstallOnAppQuit = false/)
  assert.match(main, /require\('electron-updater'\)/)
  assert.match(main, /resolveUpdateFeedUrl/)
  assert.match(main, /configuredFeedUrl: APP_METADATA\.crawshrimpUpdateFeedUrl/)
  assert.match(main, /createUpdateService/)
  assert.match(main, /createUpdateInstallCoordinator/)
  assert.match(main, /createUpdateCheckScheduler/)
  assert.match(main, /update:get-status/)
  assert.match(main, /update:check/)
  assert.match(main, /update:download/)
  assert.match(main, /update:install/)
  assert.match(preload, /getUpdateStatus/)
  assert.match(preload, /checkForUpdates/)
  assert.match(preload, /downloadUpdate/)
  assert.match(preload, /installUpdate/)
  assert.match(preload, /onUpdateStatus/)
  assert.doesNotMatch(preload, /setFeedURL/)
})

test('desktop schedules resilient automatic update checks and visible availability notifications', () => {
  const main = readRepoFile('app/src/main.js')
  const startup = main.slice(main.indexOf('app.whenReady().then(async () => {'), main.indexOf("app.on('window-all-closed'"))

  assert.match(main, /createUpdateCheckScheduler/)
  assert.match(main, /notifyUpdateAvailable/)
  assert.match(main, /browser-window-focus/)
  assert.match(main, /powerMonitor\.on\('resume'/)
  assert.match(main, /updateCheckScheduler\.onAppFocus\(\)/)
  assert.match(main, /updateCheckScheduler\.dispose\(\)/)
  assert.ok(
    startup.indexOf('scheduleInitialUpdateCheck()') < startup.indexOf('await ensureDesktopServicesStarted()'),
    'automatic update scheduling does not wait for backend startup'
  )
})

test('desktop packages the supported Electron 43.1.0 runtime', () => {
  const packageJson = JSON.parse(readRepoFile('app/package.json'))

  assert.equal(packageJson.devDependencies.electron, '43.1.0')
})

test('desktop builder packages the Electron version declared by the app', () => {
  const packageJson = JSON.parse(readRepoFile('app/package.json'))
  const buildConfig = readRepoFile('app/build.yml')
  const escapedVersion = packageJson.devDependencies.electron.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  assert.match(buildConfig, new RegExp(`electronVersion:\\s*["']?${escapedVersion}["']?`))
})

test('desktop CI uses the Node floor required by Electron 43', () => {
  const workflow = readRepoFile('.github/workflows/build-desktop.yml')
  const nodeSetupVersions = workflow.match(/node-version:\s*["']?22\.12\.0["']?/g) || []

  assert.equal(nodeSetupVersions.length, 3)
})

test('manual update check after download refreshes readiness but returns updater status shape', () => {
  const main = readRepoFile('app/src/main.js')
  const checkHandler = main.slice(
    main.indexOf("secureHandle('update:check'"),
    main.indexOf("secureHandle('update:download'"),
  )

  assert.match(checkHandler, /updateService\.getStatus\(\)\.downloaded/)
  assert.match(checkHandler, /await updateCoordinator\.refreshReadiness\(\)/)
  assert.match(checkHandler, /return updateService\.getStatus\(\)/)
  assert.doesNotMatch(checkHandler, /return updateCoordinator\.refreshReadiness\(\)/)
})

test('update install recovery resets lifecycle state before restarting desktop services', () => {
  const lifecycle = readRepoFile('app/src/lifecycleController.js')
  const main = readRepoFile('app/src/main.js')
  const coordinatorOptions = main.slice(
    main.indexOf('const updateCoordinator = createUpdateInstallCoordinator'),
    main.indexOf('const updateCheckScheduler = createUpdateCheckScheduler'),
  )

  assert.match(lifecycle, /recoverFromUpdateInstallFailure/)
  assert.match(lifecycle, /updateInstallShutdownPrepared/)
  assert.match(coordinatorOptions, /recoverAfterCleanupFailure:\s*async \(\) => \{/)
  assert.match(coordinatorOptions, /lifecycleController\.recoverFromUpdateInstallFailure\(\)/)
  assert.match(coordinatorOptions, /await ensureDesktopServicesStarted\(\)/)
  assert.ok(
    coordinatorOptions.indexOf('lifecycleController.recoverFromUpdateInstallFailure()') <
      coordinatorOptions.indexOf('await ensureDesktopServicesStarted()'),
    'lifecycle update-install state resets before service restart'
  )
})

test('updater IPC action handlers always return the stable status snapshot', () => {
  const main = readRepoFile('app/src/main.js')
  const checkHandler = main.slice(
    main.indexOf("secureHandle('update:check'"),
    main.indexOf("secureHandle('update:download'"),
  )
  const downloadHandler = main.slice(
    main.indexOf("secureHandle('update:download'"),
    main.indexOf("secureHandle('update:install'"),
  )

  assert.match(checkHandler, /await updateService\.checkForUpdates\(\{ manual: true \}\)/)
  assert.match(checkHandler, /return updateService\.getStatus\(\)/)
  assert.doesNotMatch(checkHandler, /return updateService\.checkForUpdates/)
  assert.match(downloadHandler, /await updateService\.downloadUpdate\(\)/)
  assert.match(downloadHandler, /return updateService\.getStatus\(\)/)
  assert.doesNotMatch(downloadHandler, /async \(\) => updateService\.downloadUpdate\(\)/)
})

test('renderer shell wires the collapsible update footer without remounting content', () => {
  const app = readRepoFile('app/src/renderer/App.vue')

  assert.match(app, /import \{ createUpdateActionRunner \} from '\.\/utils\/updateActions\.js'/)
  assert.match(app, /const updateActionBusy = ref\(false\)/)
  assert.match(app, /const updateActionRunner = createUpdateActionRunner\(/)
  assert.match(app, /:busy="updateActionBusy"/)
  assert.match(app, /:update-action-busy="updateActionBusy"/)
  assert.match(app, /import SidebarUpdateFooter from '\.\/components\/SidebarUpdateFooter\.vue'/)
  assert.match(app, /import \{ readSidebarCollapsed,\s*writeSidebarCollapsed \} from '\.\/utils\/sidebarState\.js'/)
  assert.match(app, /readSidebarCollapsed\(window\.localStorage\)/)
  assert.match(app, /writeSidebarCollapsed\(window\.localStorage,\s*sidebarCollapsed\.value\)/)
  assert.match(app, /const effectiveSidebarCollapsed = computed\(\(\) => !activeScript\.value && sidebarCollapsed\.value\)/)
  assert.match(app, /grid-template-columns:\s*168px 1fr/)
  assert.match(app, /grid-template-columns:\s*56px 1fr/)
  assert.match(app, /let updateStatusCleanup = null/)
  assert.match(app, /updateStatusCleanup = window\.cs\.onUpdateStatus\(/)
  assert.match(app, /if \(typeof updateStatusCleanup === 'function'\) updateStatusCleanup\(\)/)
  assert.match(app, /<SidebarUpdateFooter[\s\S]*:update-status="updateStatus"[\s\S]*@download="downloadUpdate"[\s\S]*@install="installUpdate"[\s\S]*@retry="retryUpdateCheck"/)
  assert.match(app, /updateActionRunner\.run\(\(\) => window\.cs\.downloadUpdate\(\)\)/)
  assert.match(app, /updateActionRunner\.run\(\(\) => window\.cs\.checkForUpdates\(\)\)/)
  assert.match(app, /updateActionRunner\.run\(\(\) => window\.cs\.installUpdate\(\)\)/)
  assert.doesNotMatch(app, /\.sidebar-update-footer\s*\{[^}]*display:\s*none/)
  assert.match(app, /grid-template-rows:\s*40px minmax\(0,\s*1fr\) 56px/)
  assert.match(cssRule(app, '.layout-ai-image .sidebar'), /padding:\s*0\b/)
  assert.doesNotMatch(cssRule(app, '.layout-ai-image .sidebar'), /env\(safe-area-inset-bottom\)/)
  assert.match(cssRule(app, '.layout-ai-image .sidebar-update-footer'), /height:\s*56px/)
  assert.match(cssRule(app, '.layout-ai-image .sidebar-update-footer'), /padding:\s*0 4px/)
  assert.match(cssRule(app, '.layout-ai-image .sidebar-update-footer :deep(.update-control)'), /min-height:\s*44px/)
  assert.match(cssRule(app, '.layout-ai-image .sidebar-update-footer :deep(.update-control:focus-visible)'), /box-shadow:\s*inset 0 0 0 2px var\(--orange\)/)
  assert.match(app, /function shouldClearActiveScriptForNav\(item\)/)
  assert.match(app, /return Boolean\(activeScript\.value\) && item\.id !== currentView\.value/)
  assert.match(app, /if \(shouldClearActiveScriptForNav\(item\)\) \{[\s\S]*?activeScript\.value = null[\s\S]*?activeTaskId\.value = null[\s\S]*?\}/)
  assert.match(app, /'sidebar-collapsed': effectiveSidebarCollapsed/)
  assert.match(app, /<button\s+v-if="!activeScript"[\s\S]*?class="collapse-btn"/)
  assert.match(app, /<nav v-if="!activeScript"/)
  assert.doesNotMatch(app, /<nav v-if="!activeScript \|\|/)
  assert.match(app, /:collapsed="effectiveSidebarCollapsed"/)
  assert.match(app, /function toggleSidebar\(\) \{\s*if \(activeScript\.value\) return[\s\S]*?writeSidebarCollapsed\(window\.localStorage,\s*sidebarCollapsed\.value\)/)

  const sidebarStart = app.indexOf('<aside class="sidebar">')
  const navBranchStart = app.indexOf('v-if="!activeScript"', sidebarStart)
  const navBranchEnd = app.indexOf('<!-- 主内容区 -->', sidebarStart)
  const footerIndex = app.indexOf('<SidebarUpdateFooter', sidebarStart)
  assert.ok(footerIndex > navBranchStart && footerIndex < navBranchEnd)

  const contentStart = app.indexOf('<main class="content">')
  const contentEnd = app.indexOf('</main>', contentStart)
  const contentTemplate = app.slice(contentStart, contentEnd)
  assert.match(contentTemplate, /<TaskRunner/)
  assert.doesNotMatch(contentTemplate, /sidebarCollapsed/)
  assert.doesNotMatch(app, /currentVersion:\s*['"][0-9]+\.[0-9]+\.[0-9]+/)
})

test('titlebar reserves the macOS window-control area only on macOS', () => {
  const app = readRepoFile('app/src/renderer/App.vue')

  assert.match(app, /const isMacTitlebar = \/mac\//)
  assert.match(app, /'titlebar-macos': isMacTitlebar/)
  assert.match(cssRule(app, '.titlebar'), /padding:\s*0 20px 0 12px/)
  assert.match(cssRule(app, '.titlebar-macos .titlebar'), /padding-left:\s*88px/)
  assert.match(cssRule(app, '.sidebar-collapsed .titlebar'), /padding-left:\s*0/)
  assert.match(cssRule(app, '.titlebar-macos.sidebar-collapsed .titlebar'), /padding-left:\s*88px/)
  assert.match(cssRule(app, '.sidebar-collapsed .brand'), /margin-left:\s*0/)
  assert.match(cssRule(app, '.titlebar-macos.sidebar-collapsed .brand'), /margin-left:\s*-32px/)
})

test('collapsed primary navigation exposes immediate hover and keyboard tooltips', () => {
  const app = readRepoFile('app/src/renderer/App.vue')

  assert.match(app, /:data-tooltip="effectiveSidebarCollapsed \? item\.label : null"/)
  assert.match(app, /:title="effectiveSidebarCollapsed \? undefined : item\.label"/)
  assert.match(cssRule(app, '.sidebar-collapsed .sidebar'), /overflow:\s*visible/)
  assert.match(cssRule(app, '.sidebar-collapsed .sidebar'), /z-index:\s*20/)
  assert.match(cssRule(app, '.sidebar-collapsed nav'), /overflow:\s*visible/)
  assert.doesNotMatch(app, /(?:^|\n)\.nav-btn::after\s*\{/)
  assert.match(app, /\.sidebar-collapsed \.nav-btn::after\s*\{[^}]*content:\s*attr\(data-tooltip\)[^}]*position:\s*absolute/s)
  assert.match(app, /\.sidebar-collapsed \.nav-btn:hover::after[\s\S]*\.sidebar-collapsed \.nav-btn:focus-visible::after/)
})

test('collapsed update footer exposes immediate hover and keyboard tooltip without clipping', () => {
  const footer = readRepoFile('app/src/renderer/components/SidebarUpdateFooter.vue')

  assert.match(footer, /busy:\s*\{\s*type:\s*Boolean/)
  assert.match(footer, /:disabled="busy"/)
  assert.match(footer, /:aria-busy="busy \? 'true' : undefined"/)
  assert.match(footer, /:tabindex="collapsed \? 0 : undefined"/)
  assert.match(footer, /:role="collapsed \? 'status' : undefined"/)
  assert.match(footer, /aria-live="polite"/)
  assert.match(footer, /:data-tooltip="collapsed \? tooltipText : null"/)
  assert.match(footer, /:aria-label="ariaLabel"/)
  assert.match(cssRule(footer, '.sidebar-update-footer.collapsed'), /overflow:\s*visible/)
  assert.match(footer, /\.collapsed \.update-control::after\s*\{[^}]*content:\s*attr\(data-tooltip\)[^}]*position:\s*absolute/s)
  assert.match(footer, /\.collapsed \.update-control:hover::after[\s\S]*\.collapsed \.update-control:focus-visible::after/)
})

test('settings exposes a read-only application update panel with pinned manual release fallback', () => {
  const settings = readRepoFile('app/src/renderer/views/SettingsPage.vue')

  assert.match(settings, /const OFFICIAL_RELEASE_URL = 'https:\/\/github\.com\/howtimeschange\/crawshrimp\/releases\/latest'/)
  assert.match(settings, /defineProps\(\['status', 'focusPanelId', 'updateStatus', 'updateActionBusy'\]\)/)
  assert.match(settings, /defineEmits\(\['runtime-refresh', 'check-update'\]\)/)
  assert.match(settings, /id: 'application'/)
  assert.match(settings, /id: 'application-update', label: '桌面更新'/)
  assert.match(settings, /activePanelId === 'application-update'/)
  assert.match(settings, /检查更新|重新检查/)
  assert.match(settings, /:disabled="updateActionBusy \|\| updateStatus\.status === 'checking'"/)
  assert.match(settings, /v-if="showManualDownload"[\s\S]*class="btn-ghost"[\s\S]*:disabled="updateActionBusy"[\s\S]*@click="openManualDownload"/)
  assert.match(settings, /emit\('check-update'\)/)
  assert.match(settings, /manualDownloadUrl === OFFICIAL_RELEASE_URL/)
  assert.match(settings, /status === 'unsupported'/)
  assert.match(settings, /if \(status === 'unsupported'\) return '不可用'/)
  assert.match(settings, /status === 'error' \|\| status === 'disabled' \|\| status === 'unsupported'/)
  assert.match(settings, /function openManualDownload\(\) \{\s*if \(updateActionBusy\.value\) return/)
  assert.match(settings, /openExternalUrl\(updateStatus\.value\.manualDownloadUrl\)/)
  assert.doesNotMatch(settings, /downloadUpdate|installUpdate|onUpdateStatus|getUpdateStatus/)
  assert.doesNotMatch(settings, /currentVersion:\s*['"][0-9]+\.[0-9]+\.[0-9]+/)
})

test('desktop package config generates GitHub provider update metadata for Windows and macOS', () => {
  const buildYml = readRepoFile('app/build.yml')

  assert.match(buildYml, /provider: github/)
  assert.match(buildYml, /owner: howtimeschange/)
  assert.match(buildYml, /repo: crawshrimp/)
  assert.match(buildYml, /generateUpdatesFilesForAllChannels: false/)
  assert.match(buildYml, /target:\s*\n\s*- target: dmg[\s\S]*- target: zip/)
  assert.match(buildYml, /artifactName: crawshrimp-v\$\{version\}-mac-\$\{arch\}\.\$\{ext\}/)
  assert.match(buildYml, /artifactName: crawshrimp-v\$\{version\}-win-\$\{arch\}\.\$\{ext\}/)
  assert.match(buildYml, /oneClick: false/)
  assert.match(buildYml, /perMachine: false/)
})

test('desktop build workflow collects generated update metadata artifacts', () => {
  const workflow = readRepoFile('.github/workflows/build-desktop.yml')
  const expectedFilesMatch = workflow.match(/expected_files=\(\n([\s\S]*?)\n\s*\)/)
  const packageJson = JSON.parse(readRepoFile('app/package.json'))

  assert.match(workflow, /app\/dist\/\*\.exe/)
  assert.match(workflow, /app\/dist\/\*\.exe\.blockmap/)
  assert.match(workflow, /app\/dist\/\*\.dmg/)
  assert.match(workflow, /app\/dist\/\*\.zip/)
  assert.match(workflow, /app\/dist\/\*\.zip\.blockmap/)
  assert.match(workflow, /app\/dist\/latest\*\.yml/)
  assert.equal(packageJson.scripts['test:update-artifacts'], 'node --test scripts/validate-update-artifacts.test.js')
  assert.match(workflow, /mac-arm64\.dmg[\s\S]*mac-x64\.dmg[\s\S]*mac-arm64\.zip[\s\S]*mac-x64\.zip[\s\S]*latest-mac\.yml/)
  assert.ok(expectedFilesMatch, 'mac fallback expected_files block is present')
  assert.match(expectedFilesMatch[1], /"dist\/crawshrimp-v\$\{APP_VERSION\}-mac-arm64\.zip\.blockmap"/)
  assert.match(expectedFilesMatch[1], /"dist\/crawshrimp-v\$\{APP_VERSION\}-mac-x64\.zip\.blockmap"/)
})

test('desktop workflow validates update metadata before upload and formal publication', () => {
  const workflow = readRepoFile('.github/workflows/build-desktop.yml')
  const buildValidateIndex = workflow.indexOf('name: Validate update artifacts')
  const uploadIndex = workflow.indexOf('name: Upload build artifacts')
  const releaseValidateIndex = workflow.indexOf('name: Validate release update artifacts')
  const prepareMetadataIndex = workflow.indexOf('name: Prepare release metadata', workflow.indexOf('publish-version-release:'))
  const publishVersionIndex = workflow.indexOf('name: Publish versioned release')

  assert.ok(buildValidateIndex !== -1, 'build validation step is present')
  assert.ok(buildValidateIndex < uploadIndex, 'build validation runs before artifact upload')
  assert.match(workflow, /node scripts\/validate-update-artifacts\.js dist/)
  assert.ok(releaseValidateIndex !== -1, 'release validation step is present')
  assert.ok(releaseValidateIndex < prepareMetadataIndex, 'release validation runs before metadata preparation')
  assert.ok(prepareMetadataIndex < publishVersionIndex, 'metadata gates publication')
  assert.match(workflow, /node app\/scripts\/validate-update-artifacts\.js release-assets --formal-release --version "\$\{APP_VERSION\}"/)
})

test('desktop workflow mirrors verified updater artifacts to Cloudflare R2 before GitHub publication', () => {
  const workflow = readRepoFile('.github/workflows/build-desktop.yml')
  const r2JobStart = workflow.indexOf('publish-cloudflare-r2:')
  const versionJobStart = workflow.indexOf('publish-version-release:')
  const r2Job = workflow.slice(r2JobStart, versionJobStart)
  const versionJob = workflow.slice(versionJobStart)

  assert.ok(r2JobStart !== -1, 'Cloudflare R2 publication job is present')
  assert.match(r2Job, /needs: build/)
  assert.match(r2Job, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_R2_API_TOKEN \}\}/)
  assert.match(r2Job, /CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/)
  assert.match(r2Job, /CLOUDFLARE_R2_BUCKET: crawshrimp-desktop-updates/)
  assert.match(r2Job, /r2 object put/)
  assert.match(r2Job, /public, max-age=31536000, immutable/)
  assert.match(r2Job, /no-cache, max-age=0, must-revalidate/)
  assert.match(r2Job, /find release-assets\/macos -type f/)
  assert.match(r2Job, /find release-assets\/windows -type f/)
  assert.doesNotMatch(r2Job, /find release-assets -type f/)
  assert.match(r2Job, /latest-mac\.yml/)
  assert.match(r2Job, /latest\.yml/)
  assert.match(versionJob, /needs: \[build, publish-cloudflare-r2\]/)
})

test('desktop workflow keeps GitHub updater bridge assets for pre-R2 clients', () => {
  const workflow = readRepoFile('.github/workflows/build-desktop.yml')
  const rollingStep = workflow.slice(
    workflow.indexOf('name: Publish rolling release'),
    workflow.indexOf('publish-cloudflare-r2:'),
  )

  assert.match(rollingStep, /bridge_assets=\(/)
  assert.match(rollingStep, /release-assets\/macos\/\*\.dmg/)
  assert.match(rollingStep, /release-assets\/macos\/\*\.zip/)
  assert.match(rollingStep, /release-assets\/macos\/\*\.zip\.blockmap/)
  assert.match(rollingStep, /release-assets\/macos\/latest-mac\.yml/)
  assert.match(rollingStep, /release-assets\/windows\/\*\.exe/)
  assert.match(rollingStep, /release-assets\/windows\/\*\.exe\.blockmap/)
  assert.match(rollingStep, /release-assets\/windows\/latest\.yml/)
  assert.match(rollingStep, /gh release create desktop-latest[\s\S]*"\$\{bridge_assets\[@\]\}"[\s\S]*--latest=false/)
})

test('desktop workflow validates GitHub updater bridge assets before rolling release mutation', () => {
  const workflow = readRepoFile('.github/workflows/build-desktop.yml')
  const rollingJob = workflow.slice(
    workflow.indexOf('publish-release:'),
    workflow.indexOf('publish-cloudflare-r2:'),
  )
  const validateIndex = rollingJob.indexOf('name: Validate GitHub updater bridge assets')
  const publishIndex = rollingJob.indexOf('name: Publish rolling release')

  assert.ok(validateIndex !== -1, 'GitHub updater bridge validation step is present')
  assert.ok(validateIndex < publishIndex, 'bridge assets are validated before rolling release mutation')
  assert.match(rollingJob, /expected-bridge-assets\.txt/)
  assert.match(rollingJob, /crawshrimp-v\$\{APP_VERSION\}-mac-arm64\.dmg/)
  assert.match(rollingJob, /crawshrimp-v\$\{APP_VERSION\}-mac-x64\.dmg/)
  assert.match(rollingJob, /crawshrimp-v\$\{APP_VERSION\}-win-x64\.exe/)
  assert.match(rollingJob, /crawshrimp-v\$\{APP_VERSION\}-win-x64\.exe\.blockmap/)
  assert.match(rollingJob, /latest-mac\.yml/)
  assert.match(rollingJob, /latest\.yml/)
})

test('desktop workflow updates desktop-latest in place and verifies its moved tag without delete-first mutation', () => {
  const workflow = readRepoFile('.github/workflows/build-desktop.yml')
  const rollingJob = workflow.slice(
    workflow.indexOf('publish-release:'),
    workflow.indexOf('publish-cloudflare-r2:'),
  )
  const versionReleaseDependencyIndex = rollingJob.indexOf('needs: publish-version-release')
  const bridgeValidationIndex = rollingJob.indexOf('name: Validate GitHub updater bridge assets')
  const publishIndex = rollingJob.indexOf('name: Publish rolling release')
  const existingReleaseUploadIndex = rollingJob.indexOf('gh release upload desktop-latest')
  const newReleaseCreateIndex = rollingJob.indexOf('gh release create desktop-latest')
  const finalAssetValidationIndex = rollingJob.indexOf('Unexpected desktop-latest GitHub updater bridge asset set')
  const tagMovementIndex = rollingJob.indexOf('git push --force origin "${GITHUB_SHA}:refs/tags/desktop-latest"')
  const tagReadbackIndex = rollingJob.indexOf('git ls-remote --refs origin refs/tags/desktop-latest')

  assert.match(rollingJob, /gh release view desktop-latest/)
  assert.match(rollingJob, /gh release upload desktop-latest[\s\S]*--clobber/)
  assert.match(rollingJob, /gh release create desktop-latest[\s\S]*--target "\$\{GITHUB_SHA\}"[\s\S]*--latest=false/)
  assert.match(rollingJob, /gh release view desktop-latest --json assets/)
  assert.match(rollingJob, /Unexpected desktop-latest GitHub updater bridge asset set/)
  assert.ok(versionReleaseDependencyIndex !== -1, 'rolling publication waits for version release success')
  assert.ok(versionReleaseDependencyIndex < bridgeValidationIndex, 'version release succeeds before bridge asset preflight')
  assert.ok(bridgeValidationIndex < publishIndex, 'bridge assets are prevalidated before rolling mutation')
  assert.ok(existingReleaseUploadIndex < finalAssetValidationIndex, 'existing release updates converge on final asset verification')
  assert.ok(newReleaseCreateIndex < finalAssetValidationIndex, 'new release creation converges on final asset verification')
  assert.ok(finalAssetValidationIndex < tagMovementIndex, 'rolling assets are verified before moving the tag')
  assert.ok(tagMovementIndex < tagReadbackIndex, 'remote tag is read back after movement')
  assert.match(rollingJob, /REMOTE_DESKTOP_LATEST_SHA=.*git ls-remote --refs origin refs\/tags\/desktop-latest/)
  assert.match(rollingJob, /if \[ "\$\{REMOTE_DESKTOP_LATEST_SHA\}" != "\$\{GITHUB_SHA\}" \]/)
  assert.match(rollingJob, /Remote desktop-latest tag did not resolve to \$\{GITHUB_SHA\}/)
  assert.doesNotMatch(rollingJob, /gh release delete(?!-asset)[^\n]*desktop-latest/)
  assert.doesNotMatch(rollingJob, /git push[^\n]*(?:\s|"):refs\/tags\/desktop-latest/)
  assert.doesNotMatch(rollingJob, /git push[^\n]*--delete[^\n]*desktop-latest/)
  assert.doesNotMatch(rollingJob, /git tag -d desktop-latest/)
})

test('desktop workflow gates rolling release mutation on exact stable tag and package version', () => {
  const workflow = readRepoFile('.github/workflows/build-desktop.yml')
  const rollingJob = workflow.slice(
    workflow.indexOf('publish-release:'),
    workflow.indexOf('publish-cloudflare-r2:'),
  )
  const gateIndex = rollingJob.indexOf('name: Validate release tag and package version')
  const publishIndex = rollingJob.indexOf('name: Publish rolling release')

  assert.ok(gateIndex !== -1, 'rolling release gate step is present')
  assert.ok(gateIndex < publishIndex, 'stable/package gate runs before publishing desktop-latest')
  assert.match(rollingJob, /\[\[ "\$\{GITHUB_REF_NAME\}" =~ \^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$ \]\]/)
  assert.match(rollingJob, /APP_VERSION=\$\(python3 -c "import json; print\(json\.load\(open\('app\/package\.json'\)\)\['version'\]\)"\)/)
  assert.match(rollingJob, /TAG_VERSION="\$\{GITHUB_REF_NAME#v\}"/)
  assert.match(rollingJob, /if \[ "\$\{APP_VERSION\}" != "\$\{TAG_VERSION\}" \]/)
  assert.match(rollingJob, /Only exact stable vX\.Y\.Z tags can publish desktop-latest/)
})

test('desktop updater e2e server is loopback-only and rejects unsafe file access', () => {
  const server = readRepoFile('app/scripts/update-e2e-server.js')

  assert.match(server, /server\.listen\(port, '127\.0\.0\.1'/)
  assert.match(server, /provider: PROVIDER/)
  assert.match(server, /crawshrimp-update-e2e/)
  assert.match(server, /decodeURIComponent/)
  assert.match(server, /return \{ status: 403 \}/)
  assert.match(server, /accept-ranges': 'bytes'/)
  assert.match(server, /content-range/)
  assert.match(server, /bytes \*\/\$\{size\}/)
  assert.doesNotMatch(server, /readdirSync\(resolved\.path/)
})

test('desktop update release checklist captures required acceptance evidence without fabrication', () => {
  const checklist = readRepoFile('docs/desktop-update-release-checklist.md')

  for (const required of [
    'Source commit',
    'Old version under test',
    'New version under test',
    'GitHub main build run ID',
    'GitHub tag build run ID',
    'Formal release URL',
    'Rolling `desktop-latest` release URL',
    'Asset name',
    'SHA512 from metadata',
    'codesign --verify --deep --strict --verbose=2',
    'Team ID readback',
    'spctl --assess --type execute --verbose=4',
    'stapler validate',
    'Installer path before update',
    'Installer path after update',
    'User-data sentinel path',
    'User-data checksum before',
    'Active-task blocker screenshot/log',
    '“普通退出未安装” proof',
    '“任务结束后仅提示重启安装” proof',
    'New version after restart',
    'Backend `/health` after restart',
    'Rollback Or Unpublish',
  ]) {
    assert.match(checklist, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.match(checklist, /crawshrimpUpdateTestBuild=true/)
  assert.match(checklist, /Formal `vX\.Y\.Z` builds must never include/)
  assert.match(checklist, /Windows x64/)
  assert.match(checklist, /macOS ARM/)
  assert.match(checklist, /macOS Intel/)
  assert.match(checklist, /DMG-only success is bridge\/fallback evidence/)
  assert.match(checklist, /PENDING/)
})

test('README documents desktop update install semantics and footer decisions', () => {
  const readme = readRepoFile('README.md')

  assert.match(readme, /updates\.crawshrimp\.com/)
  assert.match(readme, /Cloudflare R2/)
  assert.match(readme, /bridge 版本/)
  assert.match(readme, /不需要卸载旧版/)
  assert.match(readme, /Windows 使用 NSIS 在原安装路径就地更新/)
  assert.match(readme, /macOS 的应用内更新使用 ZIP\/ShipIt/)
  assert.match(readme, /DMG 只用于首次安装、bridge 覆盖或应用内更新失败后的手动 fallback/)
  assert.match(readme, /运行数据、Chrome profile、任务缓存和配置保存在系统用户数据目录/)
  assert.match(readme, /普通退出不会偷偷安装/)
  assert.match(readme, /点击 `重启安装`/)
  assert.match(readme, /Unknown Publisher/)
  assert.match(readme, /侧边栏底部默认只显示当前版本/)
  assert.match(readme, /只有检测到可用更新时才显示 `更新`/)
  assert.match(readme, /具体脚本视图后，侧边栏保持展开/)
  assert.match(readme, /desktop-latest` 用于手动 QA\/bridge 安装包/)
  assert.match(readme, /优先读取 `https:\/\/updates\.crawshrimp\.com\/` 的 Cloudflare R2 元数据，失败时自动回退 GitHub/)
  assert.doesNotMatch(readme, /应用内自动更新当前保持关闭/)
})
