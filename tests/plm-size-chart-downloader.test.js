import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const SCRIPT_PATH = path.resolve('adapters/plm-ops-assistant/size-chart-downloader.js')
const MANIFEST_PATH = path.resolve('adapters/plm-ops-assistant/manifest.yaml')

async function loadExports({ params = {}, shared = {}, documentOverrides = {}, locationHref = 'http://plm.balabala.com/WebAccess/home.html#URL=C117391077' } = {}) {
  const source = fs.readFileSync(SCRIPT_PATH, 'utf8')
  const exportsBox = {}
  const document = {
    querySelector() { return null },
    querySelectorAll() { return [] },
    body: { innerText: '' },
    title: '',
    ...documentOverrides,
  }
  const context = {
    window: {
      __CRAWSHRIMP_EXPORTS__: exportsBox,
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: '__exports__',
      __CRAWSHRIMP_SHARED__: shared,
    },
    document,
    location: { href: locationHref },
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

async function runScript({ params = {}, phase = 'main', shared = {}, documentOverrides = {}, fetchImpl = null } = {}) {
  const source = fs.readFileSync(SCRIPT_PATH, 'utf8')
  const document = {
    querySelector() { return null },
    querySelectorAll() { return [] },
    body: { innerText: '' },
    title: '',
    ...documentOverrides,
  }
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: phase,
      __CRAWSHRIMP_SHARED__: shared,
    },
    document,
    location: { href: 'http://plm.balabala.com/WebAccess/home.html#URL=C117391077' },
    FormData,
    URL,
    console,
    setTimeout,
    clearTimeout,
    fetch: fetchImpl || (async () => {
      throw new Error('fetch not implemented')
    }),
    Event: class Event {
      constructor(type, options = {}) {
        this.type = type
        this.bubbles = !!options.bubbles
        this.cancelable = !!options.cancelable
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
    Promise,
    Error,
    Function,
  }
  context.globalThis = context
  return await vm.runInNewContext(source, context, { filename: SCRIPT_PATH })
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

test('buildSearchXml mirrors PLM header search Name RE query', async () => {
  const helpers = await loadExports()
  const xml = helpers.buildSearchXml('208326100020')

  assert.match(xml, /<Node Parameter="Name" Op="RE" Value="%208326100020%"\/>/)
  assert.match(xml, /<Attribute Id="IsTemplate" Op="EQ" SValue="false"\/>/)
  assert.match(xml, /<Node Parameter="Type" Op="EQ" Value="Style"\/>/)
  assert.doesNotMatch(xml, /Attribute Id="Node Name"/)
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

test('selectStageSizeChart falls back from default stage to available chart with note', async () => {
  const helpers = await loadExports()
  const style = { $URL: 'STYLE1', $Type: 'Style', 'Node Name': '326DY-BS-801/208326108101', DataSheets: ['CHART1', 'CHART2'] }
  const chart = helpers.selectStageSizeChart(style, [
    style,
    { $URL: 'STAGE_ORDER', $Type: 'C8_DevStage', 'Node Name': '订货' },
    { $URL: 'STAGE_FIRST', $Type: 'C8_DevStage', 'Node Name': '初版' },
    { $URL: 'CHART1', $Type: 'SizeChart', 'Node Name': '326DY-BS-801订货_尺寸表', __Parent__: 'STYLE1', C8_SC_Stage: 'STAGE_ORDER', CurrentRevision: 'REV1' },
    { $URL: 'CHART2', $Type: 'SizeChart', 'Node Name': '326DY-BS-801初版_尺寸表', __Parent__: 'STYLE1', C8_SC_Stage: 'STAGE_FIRST', CurrentRevision: 'REV2' },
  ], '大货')

  assert.equal(chart.$URL, 'CHART1')
  assert.equal(chart.__selectedStageName, '订货')
  assert.equal(chart.__stageFallbackNote, '未找到「大货」阶段，已自动选择「订货」阶段尺码表')
})

test('selectStageSizeChart keeps explicit non-default stage strict', async () => {
  const helpers = await loadExports()
  const style = { $URL: 'STYLE1', $Type: 'Style', 'Node Name': '326DY-BS-801/208326108101', DataSheets: ['CHART1'] }

  assert.throws(() => helpers.selectStageSizeChart(style, [
    style,
    { $URL: 'STAGE_ORDER', $Type: 'C8_DevStage', 'Node Name': '订货' },
    { $URL: 'CHART1', $Type: 'SizeChart', 'Node Name': '326DY-BS-801订货_尺寸表', __Parent__: 'STYLE1', C8_SC_Stage: 'STAGE_ORDER', CurrentRevision: 'REV1' },
  ], '内评'), /没有找到阶段为「内评」的尺码表；可用阶段：订货/)
})

test('resolveStyleNode picks the exact Style node from live PLM search-like nodes', async () => {
  const helpers = await loadExports()
  const nodes = [
    { $URL: 'STYLE1', $Type: 'Style', 'Node Name': '326DY-GZ-111/208326100020', DataSheets: ['CHART1'] },
    { $URL: 'ATTR1', $Type: 'StyleAttributes', 'Node Name': '', __Parent__: 'STYLE1', C8_SA_StyleCode: '208326100020' },
    { $URL: 'CHART1', $Type: 'SizeChart', 'Node Name': '326DY-GZ-111大货_尺寸表', __Parent__: 'STYLE1' },
  ]

  assert.equal(helpers.resolveStyleNode(nodes, '208326100020').$URL, 'STYLE1')
})

test('currentStyleFromDom ignores broad unrelated data-csi-url nodes', async () => {
  const unrelated = {
    innerText: '华喆（数字零售在用） 208326169101',
    textContent: '华喆（数字零售在用） 208326169101',
    title: '',
    href: '',
    getAttribute(name) {
      return name === 'data-csi-url' ? 'C21176841' : ''
    },
  }
  const helpers = await loadExports({
    documentOverrides: {
      title: 'PLM Home',
      querySelectorAll(selector) {
        assert.doesNotMatch(selector, /(^|,)\s*\[data-csi-url\]/)
        void unrelated
        return []
      },
    },
    locationHref: 'http://plm.balabala.com/WebAccess/home.html#URL=C21176841',
  })

  assert.deepEqual(plain(helpers.currentStyleFromDom()), {
    styleUrl: '',
    styleName: '',
    styleCode: '',
  })
})

test('main phase initializes style-code progress before collecting', async () => {
  const result = await runScript({
    params: {
      style_codes: '208326169101\n208326100020',
      stage: '大货',
      output_shape: 'both',
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'collect_style')
  assert.equal(result.meta.shared.total_rows, 2)
  assert.equal(result.meta.shared.current_exec_no, 1)
  assert.equal(result.meta.shared.current_row_no, 1)
  assert.equal(result.meta.shared.current_buyer_id, '208326169101')
  assert.deepEqual(plain(result.meta.shared.target_style_codes), ['208326169101', '208326100020'])
})

test('collect_style emits current rows and advances progress to next style', async () => {
  const fetchCalls = []
  const fetchImpl = async (url, options = {}) => {
    const entries = [...options.body.entries()]
    fetchCalls.push(entries)
    const get = key => entries.filter(([name]) => name === key).map(([, value]) => String(value))
    const operation = get('Operation')[0]
    const queryUrl = get('Qry.URL')[0] || ''

    let nodes = []
    if (operation === 'QueryByXML') {
      nodes = [
        { $URL: 'C100', $Type: 'Style', 'Node Name': '326DY-GZ-111/208326100020', DataSheets: ['C200'] },
        { $URL: 'C150', $Type: 'SizeChartSubtype', 'Node Name': '大货' },
        { $URL: 'C200', $Type: 'SizeChart', 'Node Name': '326DY-GZ-111大货_尺寸表', __Parent__: 'C100', Subtype: 'C150', CurrentRevision: 'C300' },
      ]
    } else if (operation === 'QueryByURL' && queryUrl === 'C200') {
      nodes = [
        { $URL: 'C200', $Type: 'SizeChart', 'Node Name': '326DY-GZ-111大货_尺寸表', __Parent__: 'C100', CurrentRevision: 'C300' },
        {
          $URL: 'C300',
          $Type: 'SizeChartRevision',
          'Node Name': '1',
          SizeRange: 'C400',
          SizeChartSubSizeRanges: ['C500'],
          Sizes: ['C601', 'C602', 'C603'],
          Items: ['C700'],
        },
        { $URL: 'C400', $Type: 'SizeRange', 'Node Name': '婴童80-100' },
        { $URL: 'C500', $Type: 'SizeChartSubSizeRange', 'Node Name': '婴童80-100', BaseSize: 'C602', BaseSizeIndex: 1 },
        { $URL: 'C601', $Type: 'ProductSize', 'Node Name': '80/' },
        { $URL: 'C602', $Type: 'ProductSize', 'Node Name': '90/' },
        { $URL: 'C603', $Type: 'ProductSize', 'Node Name': '100/' },
        { $URL: 'C700', $Type: 'SizeChartDimension', 'Node Name': '衣长', Actual: 'C800', Increments: [-2, 40, 2], ToleranceNegative: -1, Tolerance: 1 },
        { $URL: 'C800', $Type: 'ApparelDimension', 'Node Name': '衣长', DimDescAlt1: '101', Description: '后中量' },
      ]
    }

    return {
      ok: true,
      status: 200,
      text: async () => `({Status:"Successful",NODES:{ResultNode:${JSON.stringify(nodes)}}})`,
    }
  }

  const result = await runScript({
    params: {
      style_codes: '208326100020\n208326111001',
      stage: '大货',
      output_shape: 'wide',
    },
    phase: 'collect_style',
    shared: {
      target_style_codes: ['208326100020', '208326111001'],
      stage: '大货',
      output_shape: 'wide',
      total_rows: 2,
      current_index: 0,
      current_exec_no: 1,
      current_buyer_id: '208326100020',
      success_count: 0,
      failed_count: 0,
    },
    fetchImpl,
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'collect_style')
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].款号, '208326100020')
  assert.equal(result.data[0].抓取结果, '成功')
  assert.equal(result.meta.shared.completed_count, 1)
  assert.equal(result.meta.shared.current_exec_no, 2)
  assert.equal(result.meta.shared.current_row_no, 2)
  assert.equal(result.meta.shared.current_buyer_id, '208326111001')
  assert.equal(result.meta.shared.success_count, 1)
  assert.equal(result.meta.shared.failed_count, 0)
  assert.equal(fetchCalls[0].some(([key, value]) => key === 'Qry.XML' && String(value).includes('Parameter="Name" Op="RE" Value="%208326100020%"')), true)
})
