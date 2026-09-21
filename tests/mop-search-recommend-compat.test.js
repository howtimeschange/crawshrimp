import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const source = fs.readFileSync('adapters/mop-ops-assistant/search-recommend-material-publish.js', 'utf8')
const row = { 商品ID: '973749667985', 商家编码: '55X081F7404H', 添加标题: '测试标题', 内容描述: '测试描述', 素材张数: 3 }
const root = 'D:\\搜推\\2026_09_20_明星款号'
const files = (folder, middle = '主图') => ['uuid.jpg', '1280X1280 (1).png', 'other.webp'].map(name => `${root}\\${folder}\\${middle}\\${name}`)
async function run(rows, paths, extra = {}) {
  return vm.runInNewContext(source, { window: { __CRAWSHRIMP_PARAMS__: { input_file: { rows }, execute_mode: 'plan', material_root: root, material_root_files: { paths }, ...extra } } })
}
test('recovers displaced headers and uses real files for screenshot layout', async () => {
  const keys = Object.keys(row)
  const headers = Object.fromEntries(keys.map((key, i) => [`列${i}`, key]))
  const data = Object.fromEntries(keys.map((key, i) => [`列${i}`, row[key]]))
  const result = await run([{ 列0: '说明' }, headers, data], files('55X081F7404H（刘老板'))
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].执行结果, '预检通过')
  assert.equal(result.data[0].达人, '刘老板')
  assert.match(result.data[0].素材明细, /uuid.jpg/)
})
test('keeps creator packages separate and honors explicit creator', async () => {
  const paths = [...files('55X081F7404H（甲）'), ...files('55X081F7404H（乙）')]
  assert.equal((await run([row], paths)).data.length, 2)
  const result = await run([{ ...row, 达人: '乙' }], paths)
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].达人, '乙')
  assert.equal(result.data[0].执行结果, '预检通过')
  const repeated = await run([row, row], paths)
  assert.equal(new Set(repeated.data.map(r => r.达人)).size, 2)
})
test('rejects prefix matches and reports missing scanned files', async () => {
  const result = await run([row], files('55X081F7404H9（甲）'))
  assert.equal(result.data[0].执行结果, '预检失败')
  assert.match(result.data[0].备注, /未匹配到素材图片包/)
})
test('preserves legacy layout and direct Excel paths', async () => {
  assert.equal((await run([row], files('55X081F7404H', '图片\\主图\\甲'))).data[0].执行结果, '预检通过')
  const result = await run([{ ...row, 素材图片: files('自选').join(';') }], [])
  assert.equal(result.data[0].执行结果, '预检通过')
})
test('unrecognized headers produce an actionable result instead of zero rows', async () => {
  const result = await run([{ 错误列: 'something' }], [])
  assert.equal(result.data.length, 1)
  assert.match(result.data[0].备注, /表头/)
})
test('preserves repeated spaces in directory, filename and explicit paths', async () => {
  const paths = files('55X081F7404H  (刘老板').map(p => p.replace('uuid.jpg', 'image  01.jpg'))
  for (const input of [row, { ...row, 素材图片: paths.join(';') }]) {
    const result = await run([input], paths)
    assert.equal(result.data[0].执行结果, '预检通过')
    assert.match(result.data[0].素材明细, /55X081F7404H  \(刘老板/)
    assert.match(result.data[0].素材明细, /image  01.jpg/)
  }
})
test('uses current ImageSpaceUploader when legacy upload helper is absent', async () => {
  const exports = {}, handlers = {}; let destroyed = false
  class Uploader {
    on(name, fn) { handlers[name] = fn }
    addBase64File(data, name) { assert.equal(data, 'data:image/jpeg;base64,AA'); assert.equal(name, 'photo.jpg'); this.start() }
    start() { handlers.FileSuccess({ url: 'https://img.example/photo.jpg' }); handlers.UploadComplete([]) }
    destroy() { destroyed = true }
  }
  await vm.runInNewContext(source, { window: { __CRAWSHRIMP_PHASE__: '__exports__', __CRAWSHRIMP_EXPORTS__: exports, ImageSpaceUploader: Uploader }, document: { createElement: () => ({ style: {}, remove() {} }), body: { appendChild() {} } }, setTimeout, clearTimeout })
  const result = await exports.uploadDataUrlWithPageHelper('data:image/jpeg;base64,AA', 'photo.jpg')
  assert.equal(result.url, 'https://img.example/photo.jpg')
  assert.equal(destroyed, true)
})
test('waits for uploader Init before queuing the file', async () => {
  const exports = {}, handlers = {}; let init; let added = 0
  class Uploader {
    constructor() { this._uploader = { bind(event, fn) { assert.equal(event, 'Init'); init = fn } } }
    on(event, fn) { handlers[event] = fn }
    addBase64File() { added++; handlers.FileSuccess({ url: 'https://img.example/ready.jpg' }); handlers.UploadComplete([]) }
    destroy() {}
  }
  await vm.runInNewContext(source, { window: { __CRAWSHRIMP_PHASE__: '__exports__', __CRAWSHRIMP_EXPORTS__: exports, ImageSpaceUploader: Uploader }, document: { createElement: () => ({ style: {}, remove() {} }), body: { appendChild() {} } }, setTimeout, clearTimeout })
  const promise = exports.uploadDataUrlWithPageHelper('data:image/jpeg;base64,AA', 'photo.jpg')
  assert.equal(added, 0)
  init(); init()
  assert.equal((await promise).url, 'https://img.example/ready.jpg')
  assert.equal(added, 1)
})
test('queries current itemIds array and never accepts an unrelated first product', async () => {
  const exports = {}; let matched = false
  await vm.runInNewContext(source, { window: { __CRAWSHRIMP_PHASE__: '__exports__', __CRAWSHRIMP_EXPORTS__: exports, lib: { mtop: { async request(p) {
    assert.deepEqual(JSON.parse(p.data.condition), { itemIds: ['123456789'] })
    return { ret: ['SUCCESS::ok'], data: { model: { data: [{ itemId: matched ? '123456789' : '999999999' }] } } }
  } } } } })
  assert.equal(await exports.fetchItemFromFeedsList('123456789'), null)
  matched = true
  assert.equal((await exports.fetchItemFromFeedsList('123456789')).itemId, '123456789')
})
test('compresses oversized upload output while preserving crop dimensions', async () => {
  const exports = {}; const qualities = []
  class ImageMock { set src(v) { this.naturalWidth=1200; this.naturalHeight=1600; this.onload() } }
  class Reader { readAsDataURL(blob) { this.result='data:image/jpeg;base64,' + (blob.size || 'source'); this.onload() } }
  const canvas = { getContext: () => ({ drawImage() {} }), toBlob(fn, type, quality) { qualities.push(quality); fn({size:quality>0.82 ? 4000000 : 2000000}) } }
  await vm.runInNewContext(source, { window: { __CRAWSHRIMP_PHASE__: '__exports__', __CRAWSHRIMP_EXPORTS__: exports }, Image:ImageMock, FileReader:Reader, document:{createElement:()=>canvas} })
  const r=await exports.cropFileToDataUrl({name:'large.jpg',size:5000000,type:'image/jpeg'},'3:4')
  assert.equal(r.width,1200);assert.equal(r.height,1600);assert.equal(qualities.at(-1),0.82)
})
