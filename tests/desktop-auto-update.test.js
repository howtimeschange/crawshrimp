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
  assert.equal(fs.existsSync(updateServicePath), true)
  assert.match(updateService, /autoDownload = false/)
  assert.match(updateService, /autoInstallOnAppQuit = false/)
  assert.match(main, /require\('electron-updater'\)/)
  assert.match(main, /createUpdateService/)
  assert.match(main, /createUpdateInstallCoordinator/)
  assert.match(main, /15000/)
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

test('renderer shell wires the collapsible update footer without remounting content', () => {
  const app = readRepoFile('app/src/renderer/App.vue')

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

test('settings exposes a read-only application update panel with pinned manual release fallback', () => {
  const settings = readRepoFile('app/src/renderer/views/SettingsPage.vue')

  assert.match(settings, /const OFFICIAL_RELEASE_URL = 'https:\/\/github\.com\/howtimeschange\/crawshrimp\/releases\/latest'/)
  assert.match(settings, /defineProps\(\['status', 'focusPanelId', 'updateStatus'\]\)/)
  assert.match(settings, /defineEmits\(\['launch-chrome', 'check-update'\]\)/)
  assert.match(settings, /id: 'application'/)
  assert.match(settings, /id: 'application-update', label: '桌面更新'/)
  assert.match(settings, /activePanelId === 'application-update'/)
  assert.match(settings, /检查更新|重新检查/)
  assert.match(settings, /emit\('check-update'\)/)
  assert.match(settings, /manualDownloadUrl === OFFICIAL_RELEASE_URL/)
  assert.match(settings, /status === 'unsupported'/)
  assert.match(settings, /if \(status === 'unsupported'\) return '不可用'/)
  assert.match(settings, /status === 'error' \|\| status === 'disabled' \|\| status === 'unsupported'/)
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

  assert.match(workflow, /app\/dist\/\*\.exe/)
  assert.match(workflow, /app\/dist\/\*\.exe\.blockmap/)
  assert.match(workflow, /app\/dist\/\*\.dmg/)
  assert.match(workflow, /app\/dist\/\*\.zip/)
  assert.match(workflow, /app\/dist\/\*\.zip\.blockmap/)
  assert.match(workflow, /app\/dist\/latest\*\.yml/)
  assert.match(workflow, /mac-arm64\.dmg[\s\S]*mac-x64\.dmg[\s\S]*mac-arm64\.zip[\s\S]*mac-x64\.zip[\s\S]*latest-mac\.yml/)
})
