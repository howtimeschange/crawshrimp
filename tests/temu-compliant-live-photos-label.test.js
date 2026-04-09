import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const SCRIPT_PATH = path.resolve('adapters/temu/compliant-live-photos-label.js')
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8')

class FakeElement {
  constructor(options = {}) {
    this.tagName = String(options.tagName || 'DIV').toUpperCase()
    this.className = String(options.className || '')
    this._text = String(options.text || '')
    this._rect = options.rect || { x: 0, y: 0, width: 240, height: 40 }
    this._style = {
      display: 'block',
      visibility: 'visible',
      cursor: 'default',
      zIndex: '0',
      ...options.style,
    }
    this._attrs = { ...(options.attrs || {}) }
    this._selectors = new Map()
    this.parentElement = options.parentElement || null
  }

  get innerText() {
    return this._text
  }

  get textContent() {
    return this._text
  }

  getClientRects() {
    if (this._style.display === 'none' || this._style.visibility === 'hidden') return []
    if (!this._rect.width || !this._rect.height) return []
    return [this._rect]
  }

  getBoundingClientRect() {
    const { x, y, width, height } = this._rect
    return {
      left: x,
      top: y,
      width,
      height,
      right: x + width,
      bottom: y + height,
    }
  }

  querySelectorAll(selector) {
    return this._selectors.get(selector) || []
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }

  setSelector(selector, items) {
    const list = Array.isArray(items) ? items : []
    for (const item of list) {
      if (item && !item.parentElement) item.parentElement = this
    }
    this._selectors.set(selector, list)
    return this
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this._attrs, name)
  }

  setAttribute(name, value) {
    this._attrs[name] = value
  }

  matches(selector) {
    const selectors = String(selector || '').split(',').map(item => item.trim()).filter(Boolean)
    for (const item of selectors) {
      if (item === '.rocket-drawer.rocket-drawer-open') {
        if (this.className.includes('rocket-drawer') && this.className.includes('rocket-drawer-open')) return true
      }
      if (item === '.rocket-modal' && this.className.includes('rocket-modal')) return true
      if (item === '.rocket-dialog' && this.className.includes('rocket-dialog')) return true
      if (item === '.rocket-modal-wrap' && this.className.includes('rocket-modal-wrap')) return true
      if (item === '[role="dialog"]' && this.getAttribute('role') === 'dialog') return true
    }
    return false
  }

  closest(selector) {
    if (this.matches(selector)) return this
    return this.parentElement?.closest?.(selector) || null
  }

  scrollIntoView() {}
  focus() {}
  click() {}
  dispatchEvent() { return true }
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement({ tagName: 'body', rect: { x: 0, y: 0, width: 1920, height: 1080 } })
    this._selectors = new Map()
    this.title = '合规中心'
  }

  setSelector(selector, items) {
    const list = Array.isArray(items) ? items : []
    for (const item of list) {
      if (item && !item.parentElement) item.parentElement = this.body
    }
    this._selectors.set(selector, list)
    return this
  }

  querySelectorAll(selector) {
    return this._selectors.get(selector) || []
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }
}

function styleFor(el) {
  return el?._style || {
    display: 'block',
    visibility: 'visible',
    cursor: 'default',
    zIndex: '0',
  }
}

async function runAdapter({ phase, params = {}, shared = {}, document }) {
  const window = {
    __CRAWSHRIMP_PARAMS__: params,
    __CRAWSHRIMP_PHASE__: phase,
    __CRAWSHRIMP_SHARED__: shared,
  }

  const context = {
    window,
    document,
    location: {
      href: 'https://agentseller.temu.com/govern/compliant-live-photos',
    },
    getComputedStyle: styleFor,
    MouseEvent: class MouseEvent {
      constructor(type, init = {}) {
        this.type = type
        Object.assign(this, init)
      }
    },
    Event: class Event {
      constructor(type, init = {}) {
        this.type = type
        Object.assign(this, init)
      }
    },
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    Math,
    Number,
    String,
    Boolean,
    RegExp,
    Array,
    Object,
    Map,
    Set,
    JSON,
    parseInt,
    parseFloat,
    isNaN,
  }

  context.globalThis = context
  return await vm.runInNewContext(SCRIPT_SOURCE, context, { filename: SCRIPT_PATH })
}

function buildRow({ spu, name, status = '系统识别能力待建设', suggestion = '--', actionText = '修改' }) {
  const productCell = new FakeElement({ tagName: 'td', text: `预览 ${name} SPU：${spu}` })
  const requirementCell = new FakeElement({ tagName: 'td', text: '实物标签类型' })
  const checkTypeCell = new FakeElement({ tagName: 'td', text: 'GPSR欧盟进口商信息（本体）' })
  const statusCell = new FakeElement({ tagName: 'td', text: status })
  const suggestionCell = new FakeElement({ tagName: 'td', text: suggestion })
  const sensitiveCell = new FakeElement({ tagName: 'td', text: '--' })
  const button = new FakeElement({
    tagName: 'button',
    text: actionText,
    style: { cursor: 'pointer' },
    rect: { x: 1700, y: 300, width: 90, height: 32 },
  })
  const row = new FakeElement({
    tagName: 'tr',
    text: `预览 ${name} SPU：${spu} 实物标签类型 GPSR欧盟进口商信息（本体） ${status} ${suggestion} -- ${actionText}`,
    rect: { x: 0, y: 260, width: 1800, height: 56 },
  })
  row.setSelector('td', [
    productCell,
    requirementCell,
    checkTypeCell,
    statusCell,
    suggestionCell,
    sensitiveCell,
  ])
  row.setSelector('button', [button])
  return row
}

test('pick_row keeps shoe products eligible and classifies them as shoes', async () => {
  const document = new FakeDocument()
  const shoeRow = buildRow({
    spu: '6436530692',
    name: 'Balabala儿童公主鞋女童新款春甜美休闲软底鞋',
  })
  document.setSelector('table tbody tr', [shoeRow])

  const result = await runAdapter({
    phase: 'pick_row',
    document,
    params: {
      mode: 'current',
      shoe_package_label_images: { paths: ['/tmp/shoe-package.jpg'] },
    },
    shared: {
      scope_name: '图中标签有异常',
      processed_spus: {},
      processed_count: 0,
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'open_row')
  assert.equal(result.meta.shared.current_spu, '6436530692')
  assert.equal(result.meta.shared.product_kind, 'shoes')
  assert.equal(result.meta.shared.current_action_text, '修改')
})

test('pick_row keeps clothing products on the clothing path', async () => {
  const document = new FakeDocument()
  const clothingRow = buildRow({
    spu: '888123456',
    name: 'Balabala儿童短袖T恤夏季纯棉上衣',
  })
  document.setSelector('table tbody tr', [clothingRow])

  const result = await runAdapter({
    phase: 'pick_row',
    document,
    params: {
      mode: 'current',
      clothing_subject_label_images: { paths: ['/tmp/clothing-subject.jpg'] },
      clothing_package_label_images: { paths: ['/tmp/clothing-package.jpg'] },
    },
    shared: {
      scope_name: '图中标签有异常',
      processed_spus: {},
      processed_count: 0,
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'open_row')
  assert.equal(result.meta.shared.current_spu, '888123456')
  assert.equal(result.meta.shared.product_kind, 'clothing')
  assert.equal(result.meta.shared.current_action_text, '修改')
})

test('pick_row waits for table rows before advancing scope when the table is temporarily empty', async () => {
  const document = new FakeDocument()
  document.setSelector('table tbody tr', [])

  const startedAt = Date.now()
  const result = await runAdapter({
    phase: 'pick_row',
    document,
    params: {
      mode: 'current',
      max_products: 10,
      shoe_package_label_images: { paths: ['/tmp/shoe-package.jpg'] },
    },
    shared: {
      scope_name: '仓库实收商品不合规',
      scope_retry: 0,
      processed_spus: {},
      processed_count: 0,
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'pick_row')
  assert.equal(result.meta.shared.scope_retry, 1)
  assert.ok(Date.now() - startedAt >= 1000)
})

test('wait_drawer accepts a drawer that exposes upload controls even without SPU text', async () => {
  const document = new FakeDocument()
  const uploadButton = new FakeElement({
    tagName: 'button',
    text: '上传并识别',
    style: { cursor: 'pointer' },
    rect: { x: 1500, y: 820, width: 120, height: 36 },
  })
  const drawer = new FakeElement({
    className: 'rocket-drawer rocket-drawer-right rocket-drawer-open',
    text: '修改 商品信息 商品主体实拍图 商品外包装实拍图 上传并识别',
    rect: { x: 192, y: 0, width: 1728, height: 893 },
    style: { zIndex: '1000' },
  })
  drawer.setSelector('button,span,div,a,[role="button"]', [uploadButton])
  drawer.setSelector('input[type=file]', [])

  document.setSelector('.rocket-drawer.rocket-drawer-open', [drawer])
  document.setSelector('.rocket-drawer-content-wrapper', [drawer])
  document.setSelector('.rocket-drawer-content', [drawer])

  const result = await runAdapter({
    phase: 'wait_drawer',
    document,
    shared: {
      current_spu: '999999',
      current_name: '鞋品测试款',
      current_action_text: '修改',
      current_status_text: '系统识别能力待建设',
      current_suggestion: '--',
      product_kind: 'shoes',
      open_retry: 0,
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'prepare_upload')
})

test('wait_drawer keeps waiting before it gives up when no drawer is visible', async () => {
  const document = new FakeDocument()
  document.setSelector('.rocket-drawer.rocket-drawer-open', [])
  document.setSelector('.rocket-drawer-content-wrapper', [])
  document.setSelector('.rocket-drawer-content', [])

  const result = await runAdapter({
    phase: 'wait_drawer',
    document,
    shared: {
      current_spu: '123456',
      current_name: '鞋品测试款',
      current_action_text: '修改',
      current_status_text: '系统识别能力待建设',
      current_suggestion: '--',
      product_kind: 'shoes',
      open_retry: 0,
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'wait_drawer')
  assert.equal(result.meta.shared.open_retry, 1)
})

test('wait_drawer failure reason includes drawer diagnostics after retries are exhausted', async () => {
  const document = new FakeDocument()
  document.setSelector('.rocket-drawer.rocket-drawer-open', [])
  document.setSelector('.rocket-drawer-content-wrapper', [])
  document.setSelector('.rocket-drawer-content', [])

  const result = await runAdapter({
    phase: 'wait_drawer',
    document,
    shared: {
      current_spu: '123456',
      current_name: '鞋品测试款',
      current_action_text: '修改',
      current_status_text: '系统识别能力待建设',
      current_suggestion: '--',
      product_kind: 'shoes',
      open_retry: 4,
      processed_spus: {},
      processed_count: 0,
    },
  })

  assert.equal(result.success, true)
  assert.match(result.data[0].原因, /drawer=未出现/)
})

test('wait_drawer diverts to the upload-later dialog flow when qualification gating modal appears', async () => {
  const document = new FakeDocument()
  const laterButton = new FakeElement({
    tagName: 'button',
    text: '先传图，稍后再传资质',
    style: { cursor: 'pointer' },
    rect: { x: 1100, y: 210, width: 180, height: 40 },
  })
  const dialog = new FakeElement({
    className: 'rocket-modal',
    text: '该商品需要先上传CE-EMC(Electric)资质，先传图，稍后再传资质',
    rect: { x: 760, y: 120, width: 420, height: 180 },
    style: { zIndex: '1200' },
    attrs: { role: 'dialog' },
  })
  dialog.setSelector('button,span,div,a,[role="button"]', [laterButton])
  document.setSelector('.rocket-modal, .rocket-dialog, [role="dialog"], .rocket-modal-wrap, .rocket-drawer-content-wrapper', [dialog])
  document.setSelector('.rocket-drawer.rocket-drawer-open', [])
  document.setSelector('.rocket-drawer-content-wrapper', [])
  document.setSelector('.rocket-drawer-content', [])

  const result = await runAdapter({
    phase: 'wait_drawer',
    document,
    shared: {
      current_spu: '123456',
      current_name: '鞋品测试款',
      current_action_text: '修改',
      current_status_text: '系统识别能力待建设',
      current_suggestion: '--',
      product_kind: 'shoes',
      open_retry: 0,
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'accept_upload_later_dialog')
})

test('prepare_upload keeps clothing subject/package asset routing unchanged', async () => {
  const document = new FakeDocument()
  const drawer = new FakeElement({
    className: 'rocket-drawer rocket-drawer-right rocket-drawer-open',
    text: '修改 商品信息 商品主体实拍图 标签图 (0/5) 商品外包装实拍图 标签图 (0/5) 上传并识别',
    rect: { x: 192, y: 0, width: 1728, height: 893 },
    style: { zIndex: '1000' },
  })

  const subjectSection = new FakeElement({
    text: '商品主体实拍图 标签图 (0/5)',
  })
  const packageSection = new FakeElement({
    text: '商品外包装实拍图 标签图 (0/5)',
  })
  const subjectLabel = new FakeElement({ tagName: 'span', text: '标签图 (0/5)', parentElement: subjectSection })
  const packageLabel = new FakeElement({ tagName: 'span', text: '标签图 (0/5)', parentElement: packageSection })
  const subjectInput = new FakeElement({ tagName: 'input', parentElement: subjectSection })
  const packageInput = new FakeElement({ tagName: 'input', parentElement: packageSection })

  subjectSection.setSelector('input[type=file]', [subjectInput])
  packageSection.setSelector('input[type=file]', [packageInput])
  drawer.setSelector('div,span,p,li,label,strong', [subjectLabel, packageLabel])

  document.setSelector('.rocket-drawer.rocket-drawer-open', [drawer])
  document.setSelector('.rocket-drawer-content-wrapper', [drawer])
  document.setSelector('.rocket-drawer-content', [drawer])

  const result = await runAdapter({
    phase: 'prepare_upload',
    document,
    params: {
      clothing_subject_label_images: { paths: ['/tmp/clothing-subject.jpg'] },
      clothing_package_label_images: { paths: ['/tmp/clothing-package.jpg'] },
      shoe_package_label_images: { paths: ['/tmp/shoe-package.jpg'] },
    },
    shared: {
      current_spu: '888123456',
      current_name: 'Balabala儿童短袖T恤夏季纯棉上衣',
      current_row_text: 'Balabala儿童短袖T恤夏季纯棉上衣 SPU：888123456 修改',
      current_action_text: '修改',
      current_status_text: '系统识别能力待建设',
      current_suggestion: '--',
      product_kind: 'clothing',
      subject_before: 0,
      package_before: 0,
      field_retry: 0,
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'inject_files')
  assert.equal(result.meta.next_phase, 'wait_upload_ready')
  assert.equal(result.meta.items.length, 2)
  assert.equal(result.meta.items[0].selector, 'input[data-crawshrimp-upload-key="clothing-subject-label"]')
  assert.deepEqual(Array.from(result.meta.items[0].files), ['/tmp/clothing-subject.jpg'])
  assert.equal(result.meta.items[1].selector, 'input[data-crawshrimp-upload-key="clothing-package-label"]')
  assert.deepEqual(Array.from(result.meta.items[1].files), ['/tmp/clothing-package.jpg'])
  assert.equal(subjectInput.getAttribute('data-crawshrimp-upload-key'), 'clothing-subject-label')
  assert.equal(packageInput.getAttribute('data-crawshrimp-upload-key'), 'clothing-package-label')
})

test('wait_after_submit diverts to the save-live-photos flow when the exception modal appears', async () => {
  const saveButton = new FakeElement({
    tagName: 'button',
    text: '保存实拍图，暂不处理异常',
    style: { cursor: 'pointer' },
    rect: { x: 560, y: 720, width: 220, height: 40 },
  })
  const saveDialog = new FakeElement({
    className: 'rocket-modal',
    text: '识别结果有异常，请及时整改实物后重新上传，防止影响商品售卖！ 保存实拍图，暂不处理异常 立即修改',
    rect: { x: 380, y: 110, width: 1160, height: 620 },
    style: { zIndex: '1300' },
    attrs: { role: 'dialog' },
  })
  saveDialog.setSelector('button,span,div,a,[role="button"]', [saveButton])

  const drawer = new FakeElement({
    className: 'rocket-drawer rocket-drawer-right rocket-drawer-open',
    text: '上传并识别 商品主体实拍图 商品外包装实拍图',
    rect: { x: 192, y: 0, width: 1728, height: 893 },
    style: { zIndex: '1000' },
  })
  drawer.setSelector('button,span,div,a,[role="button"]', [
    new FakeElement({
      tagName: 'button',
      text: '上传并识别',
      style: { cursor: 'pointer' },
      rect: { x: 1500, y: 820, width: 120, height: 36 },
    }),
  ])
  drawer.setSelector('input[type=file]', [])

  const document = new FakeDocument()
  document.setSelector('.rocket-modal, .rocket-dialog, [role="dialog"], .rocket-modal-wrap, .rocket-drawer-content-wrapper', [saveDialog, drawer])
  document.setSelector('.rocket-drawer.rocket-drawer-open', [drawer])
  document.setSelector('.rocket-drawer-content-wrapper', [drawer])
  document.setSelector('.rocket-drawer-content', [drawer])

  const result = await runAdapter({
    phase: 'wait_after_submit',
    document,
    shared: {
      current_spu: '123456',
      current_name: '鞋品测试款',
      current_action_text: '修改',
      current_status_text: '系统识别能力待建设',
      current_suggestion: '--',
      product_kind: 'shoes',
      submit_retry: 0,
      confirm_retry: 0,
      toast_retry: 0,
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'save_live_photos_without_fix')
})

test('wait_after_submit prioritizes deep recognition when the exception dialog also exposes a deep-recognition entry', async () => {
  const deepButton = new FakeElement({
    tagName: 'button',
    text: '深度识别',
    style: { cursor: 'pointer' },
    rect: { x: 1080, y: 630, width: 96, height: 32 },
  })
  const saveButton = new FakeElement({
    tagName: 'button',
    text: '保存实拍图，暂不处理异常',
    style: { cursor: 'pointer' },
    rect: { x: 560, y: 720, width: 220, height: 40 },
  })
  const saveDialog = new FakeElement({
    className: 'rocket-modal',
    text: '识别结果有异常，请及时整改实物后重新上传，防止影响商品售卖！ 保存实拍图，暂不处理异常 立即修改 如果您坚信实拍图清晰且信息完整，可以申请深度识别',
    rect: { x: 380, y: 110, width: 1160, height: 620 },
    style: { zIndex: '1300' },
    attrs: { role: 'dialog' },
  })
  saveDialog.setSelector('button,span,div,a,[role="button"]', [saveButton, deepButton])

  const drawer = new FakeElement({
    className: 'rocket-drawer rocket-drawer-right rocket-drawer-open',
    text: '上传并识别 商品主体实拍图 商品外包装实拍图',
    rect: { x: 192, y: 0, width: 1728, height: 893 },
    style: { zIndex: '1000' },
  })
  drawer.setSelector('button,span,div,a,[role="button"]', [
    new FakeElement({
      tagName: 'button',
      text: '上传并识别',
      style: { cursor: 'pointer' },
      rect: { x: 1500, y: 820, width: 120, height: 36 },
    }),
  ])
  drawer.setSelector('input[type=file]', [])

  const document = new FakeDocument()
  document.setSelector('.rocket-modal, .rocket-dialog, [role="dialog"], .rocket-modal-wrap, .rocket-drawer-content-wrapper', [saveDialog, drawer])
  document.setSelector('.rocket-drawer.rocket-drawer-open', [drawer])
  document.setSelector('.rocket-drawer-content-wrapper', [drawer])
  document.setSelector('.rocket-drawer-content', [drawer])

  const result = await runAdapter({
    phase: 'wait_after_submit',
    document,
    shared: {
      current_spu: '123456',
      current_name: '鞋品测试款',
      current_action_text: '修改',
      current_status_text: '系统识别能力待建设',
      current_suggestion: '--',
      product_kind: 'shoes',
      submit_retry: 0,
      confirm_retry: 0,
      toast_retry: 0,
      deep_recognition_request_count: 0,
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.next_phase, 'request_deep_recognition')
})
