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
