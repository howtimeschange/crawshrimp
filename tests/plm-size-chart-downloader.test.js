import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const SCRIPT_PATH = path.resolve('adapters/plm-ops-assistant/size-chart-downloader.js')
const MANIFEST_PATH = path.resolve('adapters/plm-ops-assistant/manifest.yaml')

async function loadExports() {
  const source = fs.readFileSync(SCRIPT_PATH, 'utf8')
  const exportsBox = {}
  const context = {
    window: {
      __CRAWSHRIMP_EXPORTS__: exportsBox,
      __CRAWSHRIMP_PARAMS__: {},
      __CRAWSHRIMP_PHASE__: '__exports__',
      __CRAWSHRIMP_SHARED__: {},
    },
    document: {
      querySelector() { return null },
      querySelectorAll() { return [] },
      body: { innerText: '' },
    },
    location: { href: 'http://plm.balabala.com/WebAccess/home.html#URL=C117391077' },
    FormData,
    URL,
    console,
    setTimeout,
    clearTimeout,
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
    Promise,
    Error,
    Function,
  }
  context.globalThis = context
  await vm.runInNewContext(source, context, { filename: SCRIPT_PATH })
  return exportsBox
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test('normalizes pasted style codes and dedupes in order', async () => {
  const helpers = await loadExports()

  assert.deepEqual(plain(helpers.normalizeStyleCodes('201326105103\n款号:201326105103，326FY-BS-507')), [
    '201326105103',
    '326FY-BS-507',
  ])
})

test('parses Centric JavaScript object literal API response', async () => {
  const helpers = await loadExports()
  const payload = helpers.parsePlmResponseText('({Status:"Successful",NODES:{ResultNode:[{$Name:"7",$Type:"SizeChartRevision",$URL:"C1"}]}})')

  assert.equal(payload.Status, 'Successful')
  assert.equal(helpers.parsePlmNodes(payload)[0].$URL, 'C1')
})

test('converts SizeChart increments into absolute size values around base size', async () => {
  const helpers = await loadExports()

  assert.deepEqual(plain(helpers.valuesFromIncrements([-2.5, -3.5, 41.5, 3.5, 4, 4], 2)), [
    35.5,
    38,
    41.5,
    45,
    49,
    53,
  ])
  assert.deepEqual(plain(helpers.valuesFromIncrements([-4, -5, 85, 5, 5, 5], 2)), [
    76,
    80,
    85,
    90,
    95,
    100,
  ])
})

test('buildRowsForChart exports wide and long rows with measurement descriptions', async () => {
  const helpers = await loadExports()
  const nodes = [
    { $URL: 'STYLE1', $Type: 'Style', 'Node Name': '326FY-BS-507/201326105103' },
    { $URL: 'CHART1', $Type: 'SizeChart', 'Node Name': '326FY-BS-507大货_尺寸表', CurrentRevision: 'REV1', __Parent__: 'STYLE1' },
    {
      $URL: 'REV1',
      $Type: 'SizeChartRevision',
      'Node Name': '7',
      State: 'Revision.State:DRAFT',
      SizeRange: 'RANGE1',
      SizeChartSubSizeRanges: ['SUB1'],
      Sizes: ['S80', 'S90', 'S100', 'S110', 'S120', 'S130'],
      Items: ['ITEM1', 'ITEM2'],
    },
    { $URL: 'RANGE1', $Type: 'SizeRange', 'Node Name': '婴幼童80-130' },
    { $URL: 'SUB1', $Type: 'SizeChartSubSizeRange', 'Node Name': '婴幼童80-130', BaseSize: 'S100', BaseSizeIndex: 2 },
    { $URL: 'S80', $Type: 'ProductSize', 'Node Name': '80/' },
    { $URL: 'S90', $Type: 'ProductSize', 'Node Name': '90/' },
    { $URL: 'S100', $Type: 'ProductSize', 'Node Name': '100/' },
    { $URL: 'S110', $Type: 'ProductSize', 'Node Name': '110/' },
    { $URL: 'S120', $Type: 'ProductSize', 'Node Name': '120/' },
    { $URL: 'S130', $Type: 'ProductSize', 'Node Name': '130/' },
    {
      $URL: 'ITEM1',
      $Type: 'SizeChartDimension',
      'Node Name': '衣长-复制',
      Actual: 'DIM101',
      Original: 'DIM101',
      Increments: [-2.5, -3.5, 41.5, 3.5, 4, 4],
      ToleranceNegative: -1,
      Tolerance: 1,
      C8_SI_CONFIRM: false,
    },
    {
      $URL: 'ITEM2',
      $Type: 'SizeChartDimension',
      'Node Name': '肩宽',
      Actual: 'DIM502',
      Original: 'DIM502',
      Increments: [-2, -2.5, 38, 2.5, 2.5, 2.5],
      ToleranceNegative: -0.5,
      Tolerance: 0.5,
      C8_SI_CONFIRM: true,
    },
    { $URL: 'DIM101', $Type: 'ApparelDimension', 'Node Name': '衣长', DimDescAlt1: '101', Description: '后中领缝垂直量至下摆边' },
    { $URL: 'DIM502', $Type: 'ApparelDimension', 'Node Name': '肩宽', DimDescAlt1: '502', Description: '放平后肩点两端处平量' },
  ]
  const rows = helpers.buildRowsForChart({
    styleCode: '201326105103',
    styleNode: nodes[0],
    chart: nodes[1],
    revision: nodes[2],
    nodes,
    stageName: '大货',
    outputShape: 'both',
  })

  assert.equal(rows.length, 14)
  assert.equal(rows[0].输出表, '宽表')
  assert.equal(rows[0].测量点, '衣长')
  assert.equal(rows[0].测量点编码, '101')
  assert.equal(rows[0].描述, '后中领缝垂直量至下摆边')
  assert.equal(rows[0]['公差(-)'], '-1.0')
  assert.equal(rows[0]['80/'], '35.5')
  assert.equal(rows[0]['90/'], '38.0')
  assert.equal(rows[0]['100/'], '41.5')
  assert.equal(rows[0]['110/'], '45.0')
  assert.equal(rows[0]['120/'], '49.0')
  assert.equal(rows[0]['130/'], '53.0')
  assert.equal(rows[1].修改确认, '是')

  const long = rows.filter(row => row.输出表 === '长表' && row.测量点 === '衣长')
  assert.equal(long.length, 6)
  assert.equal(long[0].尺码, '80/')
  assert.equal(long[0].尺码值, '35.5')
  assert.equal(long[0]['80/'], undefined)
  assert.equal(long[0]['90/'], undefined)
  assert.equal(rows[0].__sheet_name, '宽表')
  assert.equal(long[0].__sheet_name, '长表')
})

test('selectStageSizeChart chooses the requested stage from style nodes', async () => {
  const helpers = await loadExports()
  const style = { $URL: 'STYLE1', $Type: 'Style', 'Node Name': '326FY-BS-507/201326105103' }
  const chart = helpers.selectStageSizeChart(style, [
    style,
    { $URL: 'CHART1', $Type: 'SizeChart', 'Node Name': '326FY-BS-507初版_尺寸表', __Parent__: 'STYLE1', CurrentRevision: 'REV1' },
    { $URL: 'CHART2', $Type: 'SizeChart', 'Node Name': '326FY-BS-507大货_尺寸表', __Parent__: 'STYLE1', CurrentRevision: 'REV2' },
  ], '大货')

  assert.equal(chart.$URL, 'CHART2')
})

test('selectStageSizeChart follows Style.DataSheets refs for size charts', async () => {
  const helpers = await loadExports()
  const style = {
    $URL: 'STYLE1',
    $Type: 'Style',
    'Node Name': '326FY-BS-507/201326105103',
    DataSheets: ['BOM1', 'CHART2'],
  }
  const chart = helpers.selectStageSizeChart(style, [
    style,
    { $URL: 'BOM1', $Type: 'ApparelBOM', 'Node Name': '326FY-BS-507_大货BOM', __Parent__: 'STYLE1', CurrentRevision: 'BOMREV' },
    { $URL: 'CHART2', $Type: 'SizeChart', 'Node Name': '326FY-BS-507大货_尺寸表', __Parent__: 'STYLE1', CurrentRevision: 'REV2' },
  ], '大货')

  assert.equal(chart.$URL, 'CHART2')
})
