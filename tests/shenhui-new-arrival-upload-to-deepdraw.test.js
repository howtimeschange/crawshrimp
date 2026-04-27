import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

function createContext(params = {}, phase = '__exports__', shared = {}, exportsBox = null, deepdrawFrame = null, documentOverride = null) {
  const document = documentOverride || {
    querySelectorAll: (selector) => selector === 'iframe' && deepdrawFrame ? [deepdrawFrame] : [],
  }
  return {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: phase,
      __CRAWSHRIMP_SHARED__: shared,
      ...(exportsBox ? { __CRAWSHRIMP_EXPORTS__: exportsBox } : {}),
    },
    document,
    location: { href: 'https://www.deepdraw.biz/authorized/merchant/index' },
    console,
    setTimeout,
    clearTimeout,
    Event: class Event {
      constructor(type, options = {}) {
        this.type = type
        this.bubbles = !!options.bubbles
      }
    },
    Date,
    Math,
    JSON,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    Set,
    Map,
  }
}

async function runScript(params = {}, phase = '__exports__', shared = {}, exportsBox = null, deepdrawFrame = null, documentOverride = null) {
  const scriptPath = path.resolve('adapters/shenhui-new-arrival/upload-to-deepdraw.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const context = createContext(params, phase, shared, exportsBox, deepdrawFrame, documentOverride)
  context.globalThis = context
  return vm.runInNewContext(source, context, { filename: scriptPath })
}

async function loadExports(params = {}, phase = '__exports__', shared = {}) {
  const exportsBox = {}
  await runScript(params, phase, shared, exportsBox)
  return exportsBox
}

test('normalizeZipInputs derives style codes from local zip basenames', async () => {
  const helpers = await loadExports()
  const zipFiles = helpers.normalizeZipInputs({
    paths: [
      '/tmp/208226103201.zip',
      '~/Desktop/208226103202.zip',
      '/tmp/深绘上新总包.zip',
      '/tmp/not-a-zip.txt',
    ],
  })

  assert.deepEqual([...zipFiles.map(item => item.code)], ['208226103201', '208226103202'])
  assert.equal(zipFiles[0].filename, '208226103201.zip')
})

test('resolveUploadPlan defaults to dry run and allows real upload from execution mode only', async () => {
  const helpers = await loadExports()
  const zipFiles = helpers.normalizeZipInputs('/tmp/208226103201.zip')

  const dryRun = helpers.resolveUploadPlan({ upload_mode: 'dry_run' }, zipFiles)
  assert.equal(dryRun.realUpload, false)
  assert.equal(dryRun.cleanupAfterQueue, true)

  const plan = helpers.resolveUploadPlan({ upload_mode: 'upload' }, zipFiles)
  assert.equal(plan.realUpload, true)
  assert.equal(plan.cleanupAfterQueue, false)
})

test('buildInitialRows marks all zip files as pending search without exposing local paths as uploaded', async () => {
  const helpers = await loadExports()
  const zipFiles = helpers.normalizeZipInputs('/tmp/208226103201.zip')
  const rows = helpers.buildInitialRows(zipFiles)

  assert.equal(rows.length, 1)
  assert.equal(rows[0]['款号'], '208226103201')
  assert.equal(rows[0]['ZIP文件'], '208226103201.zip')
  assert.equal(rows[0]['处理阶段'], '待搜索')
  assert.equal(rows[0]['上传结果'], '')
})

test('main phase initializes upload queue and routes to ensure page', async () => {
  const result = await runScript(
    {
      package_zip_paths: {
        paths: ['/tmp/208226103201.zip', '/tmp/208226103202.zip'],
      },
      upload_mode: 'dry_run',
    },
    'main',
  )

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'ensure_page')
  assert.equal(result.meta.shared.total_rows, 2)
  assert.equal(result.meta.shared.current_exec_no, 1)
  assert.equal(result.meta.shared.current_buyer_id, '208226103201')
  assert.equal(result.meta.shared.matched_zip_files.length, 0)
  assert.equal(JSON.stringify(result.meta.shared.target_codes), JSON.stringify(['208226103201', '208226103202']))
  assert.equal(result.meta.shared.rows[0]['处理阶段'], '待搜索')
})

test('batch_search submits all zip style codes through DeepDraw batch search field', async () => {
  let searchCalled = false
  const fields = {
    searchKeyword: {
      tagName: 'INPUT',
      value: 'old',
      dispatchEvent: () => {},
    },
    searchKeywordTextArea: {
      tagName: 'TEXTAREA',
      value: '',
      textContent: '',
      dispatchEvent: () => {},
    },
    pageSize: {
      tagName: 'INPUT',
      value: '',
      dispatchEvent: () => {},
    },
  }
  const contentDocument = {
    querySelector: (selector) => {
      if (selector === '#searchKeyword') return fields.searchKeyword
      if (selector === '#searchKeywordTextArea') return fields.searchKeywordTextArea
      if (selector === '#pageSize') return fields.pageSize
      return null
    },
    querySelectorAll: () => [],
  }
  const contentWindow = {
    searchKeyword: 'old',
    keywordType: '',
    matchingMode: '',
    search: (pageNo) => {
      searchCalled = pageNo === 1
    },
  }

  const result = await runScript(
    {},
    'batch_search',
    {
      zip_files: [
        { path: '/tmp/208226103201.zip', filename: '208226103201.zip', code: '208226103201' },
        { path: '/tmp/208226103202.zip', filename: '208226103202.zip', code: '208226103202' },
      ],
      rows: [
        { '款号': '208226103201', '处理阶段': '待搜索', '搜索结果': '' },
        { '款号': '208226103202', '处理阶段': '待搜索', '搜索结果': '' },
      ],
    },
    null,
    {
      src: 'https://www.deepdraw.biz/authorized/merchant/product/uploadPictures',
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      contentDocument,
      contentWindow,
    },
  )

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'await_batch_search')
  assert.equal(searchCalled, true)
  assert.equal(fields.searchKeyword.value, '')
  assert.equal(fields.searchKeywordTextArea.value, '208226103201,208226103202')
  assert.equal(fields.pageSize.value, '20')
  assert.equal(contentWindow.keywordType, 'CODE')
  assert.equal(contentWindow.matchingMode, 'EQ')
  assert.equal(result.meta.shared.rows[0]['处理阶段'], '已提交批量搜索')
})

test('await_batch_search selects matching rows and marks missing zip codes', async () => {
  const selectorItems = []
  function createCheckbox(code, id, day) {
    return {
      value: code,
      checked: false,
      id,
      getAttribute: (name) => ({
        'data-code': code,
        'data-id': id,
        'data-day': day,
        'data-status': 'true',
      })[name] || '',
      click() {
        this.checked = !this.checked
      },
    }
  }
  const checkboxes = [
    createCheckbox('208226103201', 'p1', '2026-02-07'),
    createCheckbox('208226103202', 'p2', '2026-02-08'),
  ]
  const rows = checkboxes.map(checkbox => ({
    querySelector: () => checkbox,
    innerText: checkbox.value,
    textContent: checkbox.value,
  }))
  const contentDocument = {
    querySelector: (selector) => {
      if (selector === '#searchKeyword') return { value: '', dispatchEvent: () => {} }
      if (selector === '#searchKeywordTextArea') return { value: '输入的货号：208226103201,208226103202,208226103203' }
      return null
    },
    querySelectorAll: (selector) => selector === '#tbodyTable tr' ? rows : [],
  }
  const contentWindow = {
    batchSelector: {
      getItems: () => selectorItems,
      addItem: (item) => selectorItems.push(item),
      parseItem: (wrapped) => {
        const checkbox = wrapped.checkbox
        return {
          code: checkbox.value,
          id: checkbox.getAttribute('data-id'),
          day: checkbox.getAttribute('data-day'),
        }
      },
    },
    jQuery: (checkbox) => ({ checkbox }),
  }

  const result = await runScript(
    {},
    'await_batch_search',
    {
      zip_files: [
        { path: '/tmp/208226103201.zip', filename: '208226103201.zip', code: '208226103201' },
        { path: '/tmp/208226103202.zip', filename: '208226103202.zip', code: '208226103202' },
        { path: '/tmp/208226103203.zip', filename: '208226103203.zip', code: '208226103203' },
      ],
      target_codes: ['208226103201', '208226103202', '208226103203'],
      rows: [
        { '款号': '208226103201', '处理阶段': '查询中', '搜索结果': '' },
        { '款号': '208226103202', '处理阶段': '查询中', '搜索结果': '' },
        { '款号': '208226103203', '处理阶段': '查询中', '搜索结果': '' },
      ],
    },
    null,
    {
      src: 'https://www.deepdraw.biz/authorized/merchant/product/uploadPictures',
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      contentDocument,
      contentWindow,
    },
  )

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'open_modal')
  assert.equal(JSON.stringify(result.meta.shared.matched_zip_files.map(item => item.code)), JSON.stringify(['208226103201', '208226103202']))
  assert.equal(JSON.stringify(result.meta.shared.selected_products.map(item => item.productId)), JSON.stringify(['p1', 'p2']))
  assert.equal(result.meta.shared.rows[0]['处理阶段'], '已选择')
  assert.equal(result.meta.shared.rows[2]['搜索结果'], '未找到')
  assert.equal(result.meta.shared.rows[2]['上传结果'], '未上传')
})

test('await_batch_search retries when products are found but batch selector does not confirm selection', async () => {
  const checkbox = {
    value: '208226103201',
    checked: false,
    id: 'p1',
    getAttribute: (name) => ({
      'data-code': '208226103201',
      'data-id': 'p1',
      'data-day': '2026-02-07',
      'data-status': 'true',
    })[name] || '',
    click() {
      this.checked = !this.checked
    },
  }
  const contentDocument = {
    querySelector: (selector) => {
      if (selector === '#searchKeywordTextArea') return { value: '208226103201' }
      return null
    },
    querySelectorAll: (selector) => {
      if (selector === '#tbodyTable tr') {
        return [{
          querySelector: () => checkbox,
          innerText: '208226103201',
          textContent: '208226103201',
        }]
      }
      return []
    },
  }
  const contentWindow = {
    batchSelector: {
      getItems: () => [],
      addItem: () => {},
      parseItem: () => ({ id: 'p1', code: '208226103201', day: '2026-02-07' }),
      clear: () => {},
      initSelectedItems: () => {},
    },
    jQuery: () => ({}),
  }

  const result = await runScript(
    {},
    'await_batch_search',
    {
      zip_files: [{ path: '/tmp/208226103201.zip', filename: '208226103201.zip', code: '208226103201' }],
      target_codes: ['208226103201'],
      rows: [{ '款号': '208226103201', '处理阶段': '查询中', '搜索结果': '' }],
    },
    null,
    {
      src: 'https://www.deepdraw.biz/authorized/merchant/product/uploadPictures',
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      contentDocument,
      contentWindow,
    },
  )

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'await_batch_search')
  assert.equal(result.meta.shared.selection_attempts, 1)
})

test('await_modal waits until the DeepDraw upload modal and uploader are ready', async () => {
  const modal = {
    getBoundingClientRect: () => ({ width: 729, height: 520 }),
    innerText: '图片包上传(ZIP)',
    textContent: '图片包上传(ZIP)',
  }
  const selectButton = {
    disabled: false,
    getBoundingClientRect: () => ({ width: 88, height: 28 }),
  }
  const contentDocument = {
    querySelector: (selector) => {
      if (selector === '#uploadBatchModal') return modal
      if (selector === '#selectFilesButton') return selectButton
      return null
    },
    querySelectorAll: () => [],
  }
  const contentWindow = {
    getComputedStyle: (element) => (
      element === modal
        ? { display: 'block', visibility: 'visible' }
        : { display: 'inline-block', visibility: 'visible' }
    ),
    uploader: {},
    batchSelector: {
      getItems: () => [{ code: '208226103201' }],
    },
  }

  const result = await runScript(
    {},
    'await_modal',
    { modal_attempts: 2 },
    null,
    {
      src: 'https://www.deepdraw.biz/authorized/merchant/product/uploadPictures',
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      contentDocument,
      contentWindow,
    },
  )

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'prepare_file_chooser')
  assert.equal(result.meta.shared.modal_attempts, 0)
})

test('ensure_page uses CDP click when the DeepDraw upload menu is visible', async () => {
  const menuItem = {
    tagName: 'LI',
    innerText: '图片包上传',
    textContent: '图片包上传',
    getBoundingClientRect: () => ({ left: 40, top: 130, width: 160, height: 42 }),
  }
  const document = {
    querySelectorAll: (selector) => {
      if (selector === 'iframe') return []
      if (String(selector).includes('[role="menuitem"]')) return [menuItem]
      return []
    },
  }

  const result = await runScript({}, 'ensure_page', {}, null, null, document)

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'cdp_clicks')
  assert.equal(result.meta.next_phase, 'ensure_page')
  assert.equal(result.meta.shared.menu_click_stage, 'upload_clicked')
  assert.equal(result.meta.clicks[0].x, 120)
  assert.equal(result.meta.clicks[0].y, 151)
})

test('start_upload phase starts when upload mode selected without confirmation text', async () => {
  let started = false
  const result = await runScript(
    { upload_mode: 'upload' },
    'start_upload',
    {
      upload_plan: { realUpload: true },
      matched_zip_files: [{ code: '208226103201', filename: '208226103201.zip' }],
      rows: [{ '款号': '208226103201', '处理阶段': '已入队', '上传结果': '' }],
    },
    null,
    {
      src: 'https://www.deepdraw.biz/authorized/merchant/product/uploadPictures',
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      contentDocument: {
        querySelector: (selector) => selector === '#uploadFilesButton' ? { disabled: false } : null,
      },
      contentWindow: {
        uploader: { start: () => { started = true } },
      },
    },
  )

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'wait_upload')
  assert.equal(started, true)
})
