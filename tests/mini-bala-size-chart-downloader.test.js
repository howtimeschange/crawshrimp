import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync('adapters/mini-bala-launch-assistant/size-chart-downloader.js', 'utf8')
async function helpers(fetchImpl) {
  const box = {}
  await vm.runInNewContext(source, {
    window: { __CRAWSHRIMP_EXPORTS__: box },
    location: { hostname: 'plm.balabala.com' },
    document: {}, FormData, AbortController, setTimeout, clearTimeout,
    fetch: fetchImpl,
  })
  return box
}
const response = nodes => ({ ok: true, text: async () => JSON.stringify({ Status: 'Successful', NODES: { ResultNode: nodes } }) })
const style = { $URL: 'C1', $Type: 'Style', $Name: '127MDB-UM-105/230127103202', C8_Style_ProductCode: '230127103202', DataSheets: ['C2'] }

test('exact product code first, then load its own detail without navigating the page', async () => {
  const queries = []
  const h = await helpers(async (_, { body }) => {
    queries.push(body)
    return response([style])
  })
  const r = await h.findStyleByCode('230127103202')
  assert.equal(r.styleNode.$URL, 'C1')
  assert.match(queries[0].get('Qry.XML'), /C8_Style_ProductCode" Op="EQ" SValue="230127103202"/)
  assert.equal(queries[1].get('Qry.URL'), 'C1')
})

test('name fallback requires an exact token and rejects conflicting product codes', async () => {
  const queries = []
  const h = await helpers(async (_, { body }) => {
    const xml = body.get('Qry.XML') || ''
    queries.push(xml)
    return response(xml.includes('C8_Style_ProductCode') ? [] : [{ ...style, C8_Style_ProductCode: '' }])
  })
  assert.equal((await h.findStyleByCode('230127103202')).styleNode.$URL, 'C1')
  assert.match(queries[1], /Parameter="Name"/)
  assert.equal(h.exactStyleMatch({ ...style, C8_Style_ProductCode: 'other' }, '230127103202', 'name'), false)
  assert.equal(h.exactStyleMatch({ ...style, C8_Style_ProductCode: '', $Name: '2301271032029' }, '230127103202', 'name'), false)
})

test('duplicate matches must not silently pick the first result', async () => {
  const h = await helpers(async () => response([style, { ...style, $URL: 'C9' }]))
  await assert.rejects(h.findStyleByCode('230127103202'), /多个款式/)
})

test('a successful empty search is distinguished from failed API and expired login', async () => {
  let h = await helpers(async () => ({ ok: true, text: async () => '({Status:"Successful",NODES:"",HasMoreResults:"false"})' }))
  await assert.rejects(h.findStyleByCode('236127137002'), /查询成功.*未找到/)
  h = await helpers(async () => ({ ok: true, text: async () => '({Status:"Failed"})' }))
  await assert.rejects(h.findStyleByCode('236127137002'), /查询未成功/)
  h = await helpers(async () => ({ ok: true, text: async () => '<html>登录</html>' }))
  await assert.rejects(h.findStyleByCode('236127137002'), /登录已失效/)
})

test('transient network error retries once; auth errors do not retry', async () => {
  let calls = 0
  const h = await helpers(async () => {
    if (++calls === 1) { const e = new Error('network'); e.name = 'TypeError'; throw e }
    return response([style])
  })
  await h.requestPlm([])
  assert.equal(calls, 2)
  calls = 0
  const denied = await helpers(async () => { calls++; return { ok: false, status: 403 } })
  await assert.rejects(denied.requestPlm([]), /403/)
  assert.equal(calls, 1)
})

test('stage selection excludes charts from unrelated styles and preserves fallback note', async () => {
  const h = await helpers()
  const own = { $URL: 'C2', $Type: 'SizeChart', $Name: '初版_尺寸表', CurrentRevision: 'C3' }
  const other = { $URL: 'C4', $Type: 'SizeChart', $Name: '230127103202大货_尺寸表', __Parent__: 'C999' }
  const selected = h.selectStageSizeChart(style, [own, other], '大货')
  assert.equal(selected.$URL, 'C2')
  assert.match(selected.__stageFallbackNote, /初版/)
  assert.throws(() => h.selectStageSizeChart(style, [own], '订货'), /没有找到阶段/)
})

test('empty chart is not reported as success; increments preserve original calculation', async () => {
  const h = await helpers()
  assert.throws(() => h.buildRowsForChart({ styleCode: '230127103202', styleNode: style, chart: {}, revision: {}, nodes: [], stageName: '大货' }), /没有可导出/)
  assert.deepEqual(Array.from(h.valuesFromIncrements([-2, 40, 3], 1)), [38, 40, 43])
})

test('name query continues past a full page and rejects repeated pagination', async () => {
  const full = Array.from({ length: 100 }, (_, i) => ({ $URL: `C${i + 100}`, $Type: 'Style', $Name: `230127103202${i}` }))
  const h = await helpers(async (_, { body }) => {
    if (body.get('Operation') === 'QueryByURL') return response([style])
    if (body.get('Qry.XML').includes('C8_Style_ProductCode')) return response([])
    return response(body.get('Qry.Limit.Begin') === '1' ? full : [{ ...style, C8_Style_ProductCode: '' }])
  })
  assert.equal((await h.findStyleByCode('230127103202')).styleNode.$URL, 'C1')
  const repeated = await helpers(async (_, { body }) => response(body.get('Qry.XML').includes('C8_Style_ProductCode') ? [] : full))
  await assert.rejects(repeated.findStyleByCode('230127103202'), /分页重复/)
})

test('exhausted timeout is reported as timeout rather than no matching style', async () => {
  let calls = 0
  const h = await helpers(async () => { calls++; const e = new Error('aborted'); e.name = 'AbortError'; throw e })
  await assert.rejects(h.findStyleByCode('230127103202'), /查询超时.*已重试/)
  assert.equal(calls, 2)
})
