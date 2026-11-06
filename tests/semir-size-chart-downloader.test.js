import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync('adapters/semir-launch-assistant/size-chart-downloader.js', 'utf8')
async function run({ exports = false, params = {}, phase = '__exports__', shared = {}, token = 'test-token', fetchImpl } = {}) {
  const box = {}
  const window = { __CRAWSHRIMP_PARAMS__: params, __CRAWSHRIMP_PHASE__: phase, __CRAWSHRIMP_SHARED__: shared,
    localStorage: { getItem: () => token }, ...(exports ? { __CRAWSHRIMP_EXPORTS__: box } : {}) }
  const context = { window, location: { hostname: 'smplm.semirapp.com', href: 'https://smplm.semirapp.com/WebAccess/home.html' },
    document: { querySelector: () => null, querySelectorAll: () => [], title: '' }, FormData, URL, console, setTimeout, clearTimeout,
    fetch: fetchImpl, Date, Math, JSON, String, Number, Boolean, Array, Object, RegExp, Set, Map, Promise, Error, Function }
  const result = await vm.runInNewContext(source, context)
  return exports ? box : result
}
const plain = x => JSON.parse(JSON.stringify(x))
function fixture() {
  const style = { $URL: 'C1', $Type: 'Style', $Name: '101526106001', DataSheets: ['C2'] }
  const chart = { $URL: 'C2', $Type: 'SizeChart', $Name: '尺寸表', __Parent__: 'C1', CurrentRevision: 'C3' }
  const revision = { $URL: 'C3', $Type: 'SizeChartRevision', $Name: '23', Sizes: ['C4','C5','C6'], SelectedSizes: ['C5','C6'], SizeChartSubSizeRanges: ['C7'], Items: ['C8'] }
  return { style, chart, revision, nodes: [style, chart, revision,
    { $URL: 'C4', $Name: 'S' }, { $URL: 'C5', $Name: 'M' }, { $URL: 'C6', $Name: 'L' },
    { $URL: 'C7', BaseSize: 'C5' }, { $URL: 'C8', $Name: '身长', Increments: [-2, 50, 2] }] }
}
test('exports selected sizes only, keeps current stage unconfirmed and wide/long values aligned', async () => {
  const h = await run({ exports: true }), f = fixture()
  const chart = h.selectStageSizeChart(f.style, f.nodes)
  const rows = plain(h.buildRowsForChart({ styleCode: '101526106001', ...f, chart, outputShape: 'both' }))
  assert.equal(rows.length, 3); assert.equal(rows[0].尺码表阶段, '未确认'); assert.equal(rows[0].S, undefined)
  assert.equal(rows[0].M, '50.0'); assert.equal(rows[0].L, '52.0'); assert.equal(rows[1].页面所选, '是')
  assert.deepEqual(rows.slice(1).map(x => x.尺码值), ['50.0', '52.0'])
})
test('all sizes are marked, missing selected sizes fail closed, ambiguous charts fail', async () => {
  const h = await run({ exports: true, params: { size_scope: 'all' } }), f = fixture()
  const rows = plain(h.buildRowsForChart({ styleCode: '101526106001', ...f, outputShape: 'both' }))
  assert.equal(rows[0].S, '48.0'); assert.equal(rows[1].页面所选, '否')
  const selected = await run({ exports: true }); f.revision.SelectedSizes = []
  assert.throws(() => selected.buildRowsForChart({ ...f }), /未提供所选尺码/)
  f.nodes.push({ $URL: 'C9', $Type: 'SizeChart', __Parent__: 'C1' })
  assert.throws(() => selected.selectStageSizeChart(f.style, f.nodes), /多|2 张/)
})
test('missing measurement increment stays blank and propagates', async () => {
  const h = await run({ exports: true })
  assert.deepEqual(plain(h.valuesFromIncrements([-2, 50, null, 2], 1)), [48, 50, '', ''])
  assert.deepEqual(plain(h.valuesFromIncrements([-2, null, 2], 1)), ['', '', ''])
})
test('CSRF failure is an error, not a missing style, and token never appears in results', async () => {
  let header
  const result = await run({ phase: 'collect_style', params: { style_codes: '101526106001' },
    shared: { target_style_codes: ['101526106001'], current_index: 0 },
    fetchImpl: async (_url, options) => { header = options.headers['X-CSRF-Token']; return {ok: true, status: 200, text: async () => '({"Status":"Failed","ErrorAdmin":"Invalid CSRF token submitted"})'} } })
  assert.equal(header, 'test-token'); assert.match(result.data[0].备注, /会话校验失败/)
  assert.doesNotMatch(JSON.stringify(result), /test-token/); assert.equal(result.meta.shared.failed_count, 1)
})
test('missing CSRF prevents starting a run', async () => {
  const result = await run({ phase: 'main', token: '', params: { style_codes: '101526106001' } })
  assert.equal(result.success, false); assert.match(result.error, /会话防护信息/)
})
