import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const ROOT = path.resolve(import.meta.dirname, '..')

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8')
}

const METHODS = [
  ['getCloudApprovalStatus', 'get-cloud-approval-status', 'GET', '/cloud-approval/status'],
  ['saveCloudApprovalConfig', 'save-cloud-approval-config', 'POST', '/cloud-approval/config'],
  ['enrollCloudMachine', 'enroll-cloud-machine', 'POST', '/cloud-approval/enroll-machine'],
  ['startCloudMachine', 'start-cloud-machine', 'POST', '/cloud-approval/machine/start'],
  ['stopCloudMachine', 'stop-cloud-machine', 'POST', '/cloud-approval/machine/stop'],
  ['syncCloudApprovalBatch', 'sync-cloud-approval-batch', 'POST', '/cloud-approval/sync-batch'],
  ['listCloudPromptLibraries', 'list-cloud-prompt-libraries', 'GET', '/cloud-approval/prompt-libraries'],
]

test('main process exposes cloud approval IPC handlers to local API routes', () => {
  const source = read('app/src/main.js')

  for (const [_method, channel, verb, route] of METHODS) {
    assert.match(source, new RegExp(`secureHandle\\('${channel}'`))
    assert.match(source, new RegExp(`apiCall\\('${verb}', '${route.replaceAll('/', '\\/')}`))
  }
})

test('cloud prompt template IPC includes library-scoped resolved route', () => {
  const main = read('app/src/main.js')
  const preload = read('app/src/preload.js')
  const devBridge = read('app/src/renderer/utils/devCsBridge.js')

  assert.match(main, /secureHandle\('resolve-cloud-prompt-templates'/)
  assert.match(main, /\/cloud-approval\/prompt-libraries\/\$\{encodeURIComponent\(String\(libraryId \|\| ''\)\)\}\/resolved/)
  assert.match(preload, /resolveCloudPromptTemplates:/)
  assert.match(preload, /invokeWithApiFallback\('resolve-cloud-prompt-templates'/)
  assert.match(preload, /apiCall\('GET', `\/cloud-approval\/prompt-libraries\/\$\{encodePathPart\(libraryId\)\}\/resolved/)
  assert.match(devBridge, /resolveCloudPromptTemplates:/)
  assert.match(devBridge, /\/cloud-approval\/prompt-libraries\/\$\{encodePathPart\(libraryId\)\}\/resolved/)
})

test('desktop cloud prompt library IPC uses the logged-in cloud approval session before machine fallback', () => {
  const main = read('app/src/main.js')

  assert.match(main, /async function listCloudPromptLibrariesForDesktop/)
  assert.match(main, /cloudApprovalUserApiCall\(baseUrl,\s*'GET',\s*'\/api\/prompt-libraries'\)/)
  assert.match(main, /async function resolveCloudPromptTemplatesForDesktop/)
  assert.match(main, /cloudApprovalUserApiCall\(baseUrl,\s*'GET',\s*`\/api\/prompt-libraries\/\$\{encodeURIComponent\(String\(libraryId \|\| ''\)\)\}\/resolved/)
  assert.match(main, /secureHandle\('list-cloud-prompt-libraries', async \(\) =>\s*listCloudPromptLibrariesForDesktop\(\)\)/)
  assert.match(main, /secureHandle\('resolve-cloud-prompt-templates'[\s\S]*resolveCloudPromptTemplatesForDesktop\(libraryId, query\)/)
})

test('preload exposes cloud approval methods on window.cs', () => {
  const source = read('app/src/preload.js')

  for (const [method, channel] of METHODS.filter(([method]) => method !== 'listCloudPromptLibraries')) {
    assert.match(source, new RegExp(`${method}:`))
    assert.match(source, new RegExp(`ipcRenderer\\.invoke\\('${channel}'`))
  }
  assert.match(source, /listCloudPromptLibraries:/)
  assert.match(source, /invokeWithApiFallback\('list-cloud-prompt-libraries'/)
  assert.match(source, /apiCall\('GET', '\/cloud-approval\/prompt-libraries'\)/)
})

test('preload falls back to local API when cloud prompt IPC handlers are missing', async () => {
  const source = read('app/src/preload.js')
  const requests = []
  const exposed = { value: null }
  const storage = new Map()
  storage.set('crawshrimp.apiToken', 'local-api-token')

  const sandbox = {
    require: (specifier) => {
      assert.equal(specifier, 'electron')
      return {
        contextBridge: {
          exposeInMainWorld: (_key, value) => {
            exposed.value = value
          },
        },
        ipcRenderer: {
          invoke: async (channel) => {
            throw new Error(`Error invoking remote method '${channel}': Error: No handler registered for '${channel}'`)
          },
        },
      }
    },
    window: {
      location: { search: '' },
      localStorage: {
        getItem: (key) => storage.get(key) || '',
        setItem: (key, value) => storage.set(key, String(value)),
      },
    },
    URLSearchParams,
    fetch: async (url, options) => {
      const parsed = new URL(url)
      requests.push({ url: parsed, options })
      const payload = parsed.pathname.endsWith('/resolved')
        ? { templates: [{ template_id: 'p-1', prompt_text: '来自线上 Prompt 库' }] }
        : { libraries: [{ id: 7, name: '线上 Prompt 库' }] }
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      }
    },
  }

  vm.runInNewContext(source, sandbox, { filename: 'app/src/preload.js' })
  assert.ok(exposed.value)

  assert.deepEqual(await exposed.value.listCloudPromptLibraries(), {
    libraries: [{ id: 7, name: '线上 Prompt 库' }],
  })
  assert.equal(requests[0].url.pathname, '/cloud-approval/prompt-libraries')
  assert.equal(requests[0].options.headers['X-Crawshrimp-Token'], 'local-api-token')

  assert.deepEqual(await exposed.value.resolveCloudPromptTemplates(7, { limit: 500, category: '' }), {
    templates: [{ template_id: 'p-1', prompt_text: '来自线上 Prompt 库' }],
  })
  assert.equal(requests[1].url.pathname, '/cloud-approval/prompt-libraries/7/resolved')
  assert.equal(requests[1].url.searchParams.get('limit'), '500')
  assert.equal(requests[1].url.searchParams.has('category'), false)
  assert.equal(requests[1].options.headers['X-Crawshrimp-Token'], 'local-api-token')
})

test('browser dev bridge exposes cloud approval methods with API fallback routes', () => {
  const source = read('app/src/renderer/utils/devCsBridge.js')

  for (const [method, _channel, verb, route] of METHODS) {
    assert.match(source, new RegExp(`${method}:`))
    assert.match(source, new RegExp(`apiCall\\('${verb}', '${route.replaceAll('/', '\\/')}`))
  }
})
