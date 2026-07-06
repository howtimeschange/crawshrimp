import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

class FakeDocument {
  constructor({ inputFiber = null } = {}) {
    this.readyState = 'complete'
    this.body = { innerText: '', textContent: '' }
    this._inputs = []
    if (inputFiber) {
      const input = { value: '6942652703790' }
      input.__reactFiber$test = inputFiber
      this._inputs.push(input)
    }
  }

  querySelectorAll(selector) {
    if (selector === 'input') return this._inputs
    return []
  }

  querySelector() {
    return null
  }
}

function makeLocation(href) {
  return {
    href,
    assign(next) {
      this.href = String(next || '')
    },
    replace(next) {
      this.href = String(next || '')
    },
    get hostname() {
      return new URL(this.href).hostname
    },
    get pathname() {
      return new URL(this.href).pathname
    },
    get search() {
      return new URL(this.href).search
    },
  }
}

function fakeReactFiberWithGoodsInfo(goodsInfo) {
  return {
    memoizedProps: {},
    return: {
      memoizedProps: {},
      return: {
        memoizedProps: { goodsInfo },
        return: null,
      },
    },
  }
}

async function runScript({
  phase = 'main',
  params = {},
  shared = {},
  href = 'https://master.weimob.com/bos/products/ecGoodsmanage/4000547814432/4diuahndgX5o74sooX4di628kby/goods/list',
  fetch: fetchImpl,
  document = new FakeDocument(),
  localStorageItems = {},
} = {}) {
  const scriptPath = path.resolve('adapters/weimob-ops-assistant/goods-new-arrival-automation.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const location = makeLocation(href)
  const localStorage = {
    getItem(key) {
      return localStorageItems[key] || null
    },
  }
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: params,
      __CRAWSHRIMP_PHASE__: phase,
      __CRAWSHRIMP_SHARED__: shared,
      wm: {
        getCurrentWOSCoreInfoSync() {
          return { bosId: 4000547814432, vid: 6001042272432 }
        },
        getMemoryState(key) {
          return key === 'saas-token' ? 'fake-saas-token' : ''
        },
      },
      location,
      localStorage,
    },
    document,
    location,
    localStorage,
    console,
    fetch: fetchImpl,
    URL,
    URLSearchParams,
    JSON,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Set,
    Map,
    Promise,
    Error,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout,
    clearTimeout,
  }
  context.globalThis = context
  return await vm.runInNewContext(source, context, { filename: scriptPath })
}

function jsonResponse(payload) {
  return {
    status: 200,
    async json() {
      return payload
    },
  }
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test('main searches Weimob goods one code at a time and defaults to warehouse duplicate', async () => {
  const calls = []
  const result = await runScript({
    params: { style_codes: '653514A6602Z;653514A6101Z;655139G2112Z' },
    async fetch(url, options) {
      const body = JSON.parse(options.body)
      calls.push({ url, body })
      assert.equal(url, '/api3/mall/goods/queryGoodsListWithPageForManagement')
      const search = body.queryParameter.search
      assert.equal(body.queryParameter.goodsSaleStatus, '2')
      const rowsBySearch = {
        '653514A6602Z': [
          { goodsId: 154550908297432, outerGoodsCode: '653514A6602Z', title: '半裙', saleChannelType: 1, isCanSell: false, isOnline: false },
        ],
        '653514A6101Z': [
          { goodsId: 143097407297432, outerGoodsCode: '653514A6101Z', title: '旧线下开衫', saleChannelType: 2, isCanSell: false, isOnline: false },
          { goodsId: 154550689297432, outerGoodsCode: '653514A6101Z', title: '新线上开衫', saleChannelType: 1, isCanSell: false, isOnline: false },
        ],
        '655139G2112Z': [
          { goodsId: 154549091297432, outerGoodsCode: '655139G2112Z', title: '连衣裙', saleChannelType: 1, isCanSell: false, isOnline: false },
        ],
      }
      return jsonResponse({
        data: {
          totalCount: (rowsBySearch[search] || []).length,
          pageList: rowsBySearch[search] || [],
        },
      })
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'next_phase')
  assert.equal(result.meta.next_phase, 'read_weimob_sku')
  assert.equal(result.meta.shared.goods_record_preference, 'warehouse')
  assert.equal(calls.length, 3)
  assert.deepEqual(calls.map(call => call.body.queryParameter.search), ['653514A6602Z', '653514A6101Z', '655139G2112Z'])
  assert.deepEqual(calls.map(call => call.body.queryParameter.searchList), [['653514A6602Z'], ['653514A6101Z'], ['655139G2112Z']])
  assert.equal(calls[0].body.queryParameter.searchType, 2)
  assert.equal(calls[0].body.pageNum, 1)
  assert.equal(result.meta.shared.products.length, 3)
  assert.equal(result.meta.shared.products[0].editUrl.includes('editNoMenu?id=154550908297432'), true)
  assert.equal(result.meta.shared.products[1].editUrl.includes('saleChannelType=2'), true)
  assert.equal(result.meta.shared.products[1].goodsId, 143097407297432)
  assert.equal(result.meta.shared.products[1].saleChannelType, 2)
})

test('main prefers already launched online-offline duplicate before warehouse row', async () => {
  const calls = []
  const result = await runScript({
    params: { style_codes: '655139G4002Z', goods_record_preference: 'online_offline' },
    async fetch(url, options) {
      const body = JSON.parse(options.body)
      calls.push({ url, body })
      assert.equal(url, '/api3/mall/goods/queryGoodsListWithPageForManagement')
      return jsonResponse({
        data: {
          totalCount: 2,
          pageList: [
            {
              goodsId: 154548826297432,
              outerGoodsCode: '655139G4002Z',
              title: '线上+线下新记录',
              saleChannelType: 3,
              isCanSell: true,
              isOnline: true,
            },
            {
              goodsId: 145379122297432,
              outerGoodsCode: '655139G4002Z',
              title: '旧仓库记录',
              saleChannelType: 2,
              isCanSell: false,
              isOnline: false,
            },
          ],
        },
      })
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.shared.goods_record_preference, 'online_offline')
  assert.equal(calls.length, 1)
  assert.equal(result.meta.shared.products.length, 1)
  assert.equal(result.meta.shared.products[0].goodsId, 154548826297432)
  assert.equal(result.meta.shared.products[0].saleChannelType, 3)
  assert.equal(result.meta.shared.products[0].editUrl.includes('saleChannelType=3'), true)
})

test('mdm lookup maps EANs to SKU codes and returns a dry run preview by default', async () => {
  const result = await runScript({
    phase: 'mdm_lookup',
    href: 'https://mdm.semirapp.com/demdm/336912503927767040/application/application-custom/712740841071886336?name=goodsManage',
    localStorageItems: {
      __vuex__local: JSON.stringify({ authModule: { token: 'fake-mdm-token' } }),
    },
    shared: {
      products: [
        {
          styleCode: '653514A6602Z',
          goodsId: 154550908297432,
          title: '半裙',
          skuRows: [
            { itemSkuId: 295363620297432, skuId: 311359893297432, outerSkuCode: '6942652703790', skuBarCode: 'K000010176990504' },
          ],
        },
      ],
    },
    async fetch(url, options) {
      assert.equal(url.startsWith('/demdm-api/sku/getSkuInfoList?timestamp='), true)
      const body = JSON.parse(options.body)
      assert.deepEqual(body.eanCodes, ['6942652703790'])
      return jsonResponse({
        code: 'ok',
        data: [
          {
            skuCode: '653514A6602Z10025',
            eanCode: '6942652703790',
            mdmCode: '653514A6602Z',
            skcCode: '653514A6602Z100',
            colorDesc: 'white',
            sizeDesc: 'XXS',
          },
        ],
      })
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(result.meta.shared.execute_mode, 'plan')
  assert.deepEqual(plain(result.data[0]), {
    款号: '653514A6602Z',
    商品ID: 154550908297432,
    商品名称: '半裙',
    规格ID: 311359893297432,
    原规格编码: '6942652703790',
    目标规格编码: '653514A6602Z10025',
    原规格条码: 'K000010176990504',
    目标规格条码: '6942652703790',
    MDM_SKC编码: '653514A6602Z100',
    MDM颜色: 'white',
    MDM尺码: 'XXS',
    执行结果: '待更新',
    备注: '预演模式，未保存微盟',
  })
})

test('update phase patches channel status delivery and SKU identifiers before saving', async () => {
  const calls = []
  const goodsInfo = {
    goodsId: 154550908297432,
    outerGoodsCode: '653514A6602Z',
    saleChannelType: 1,
    isCanSell: false,
    isOnline: false,
    goodsDeliveryMode: 0,
    performanceWay: {
      deliveryList: [{ deliveryId: 207476, deliveryType: 1, deliveryNodeShipId: 0, templateId: 10003147950 }],
      mallCycleGoodsConfig: null,
      goodsAppointment: null,
      mallServiceAppointmentDTO: null,
    },
    skuList: [
      {
        itemSkuId: 295363620297432,
        skuId: 311359893297432,
        outerSkuCode: '6942652703790',
        skuBarCode: 'K000010176990504',
      },
    ],
  }

  const result = await runScript({
    phase: 'update_weimob',
    params: { execute_mode: 'update' },
    href: 'https://master.weimob.com/bos/products/ecGoodsmanage/4000547814432/4diuahndgX5o74sooX4di628kby/goods/editNoMenu?id=154550908297432&type=sale&saleChannelType=1',
    document: new FakeDocument({ inputFiber: fakeReactFiberWithGoodsInfo(goodsInfo) }),
    shared: {
      execute_mode: 'update',
      update_index: 0,
      deliveryOption: {
        id: 1613854860199858176,
        deliveryId: 214669,
        deliveryType: 3,
        deliveryTypeName: '到店自提',
        isSupported: 1,
        isDefault: 0,
        deliveryNodeShipId: 1613854860199858176,
        templateId: 40870,
        checked: true,
      },
      products: [
        {
          styleCode: '653514A6602Z',
          goodsId: 154550908297432,
          title: '半裙',
          editUrl: 'https://master.weimob.com/bos/products/ecGoodsmanage/4000547814432/4diuahndgX5o74sooX4di628kby/goods/editNoMenu?id=154550908297432&type=sale&saleChannelType=1',
          skuRows: [
            { itemSkuId: 295363620297432, skuId: 311359893297432, outerSkuCode: '6942652703790', skuBarCode: 'K000010176990504' },
          ],
        },
      ],
      mdmMapping: {
        '6942652703790': { skuCode: '653514A6602Z10025', eanCode: '6942652703790', skcCode: '653514A6602Z100' },
      },
    },
    async fetch(url, options) {
      calls.push({ url, body: JSON.parse(options.body) })
      assert.equal(url, '/api3/mall/goods/update')
      return jsonResponse({ errcode: '0', errmsg: '处理成功', data: { goodsId: 154550908297432 } })
    },
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.action, 'complete')
  assert.equal(calls.length, 1)
  const payload = calls[0].body
  assert.equal(payload.saleChannelType, 3)
  assert.equal(payload.isCanSell, true)
  assert.equal(payload.isOnline, true)
  assert.deepEqual(payload.performanceWay.deliveryList, [
    {
      deliveryId: 207476,
      deliveryType: 1,
      deliveryNodeShipId: 0,
      templateId: 10003147950,
      deliveryTypeName: '商家配送',
      checked: true,
    },
    {
      id: 1613854860199858176,
      deliveryId: 214669,
      deliveryType: 3,
      deliveryTypeName: '到店自提',
      isSupported: 1,
      isDefault: 0,
      deliveryNodeShipId: 1613854860199858176,
      templateId: 40870,
      checked: true,
    },
  ])
  assert.equal(payload.skuList[0].outerSkuCode, '653514A6602Z10025')
  assert.equal(payload.skuList[0].skuBarCode, '6942652703790')
  assert.equal(result.data[0].执行结果, '已保存')
})

test('update phase queries default merchant and pickup templates when current goods only has pickup', async () => {
  const calls = []
  const goodsInfo = {
    goodsId: 154548826297432,
    outerGoodsCode: '655139G4002Z',
    saleChannelType: 3,
    isCanSell: true,
    isOnline: true,
    goodsDeliveryMode: 0,
    performanceWay: {
      deliveryList: [{ deliveryId: 214669, deliveryType: 3, deliveryNodeShipId: 0, templateId: 40870 }],
    },
    skuList: [
      {
        itemSkuId: 295363620297432,
        skuId: 311359893297432,
        outerSkuCode: '6942652703790',
        skuBarCode: 'K000010176990504',
      },
    ],
  }

  const result = await runScript({
    phase: 'update_weimob',
    params: { execute_mode: 'update' },
    href: 'https://master.weimob.com/bos/products/ecGoodsmanage/4000547814432/4diuahndgX5o74sooX4di628kby/goods/editNoMenu?id=154548826297432&type=sale&saleChannelType=3',
    document: new FakeDocument({ inputFiber: fakeReactFiberWithGoodsInfo(goodsInfo) }),
    shared: {
      execute_mode: 'update',
      update_index: 0,
      products: [
        {
          styleCode: '655139G4002Z',
          goodsId: 154548826297432,
          title: 'T恤',
          editUrl: 'https://master.weimob.com/bos/products/ecGoodsmanage/4000547814432/4diuahndgX5o74sooX4di628kby/goods/editNoMenu?id=154548826297432&type=sale&saleChannelType=3',
          skuRows: [
            { itemSkuId: 295363620297432, skuId: 311359893297432, outerSkuCode: '6942652703790', skuBarCode: 'K000010176990504' },
          ],
        },
      ],
      mdmMapping: {
        '6942652703790': { skuCode: '655139G4002Z10025', eanCode: '6942652703790', skcCode: '655139G4002Z100' },
      },
    },
    async fetch(url, options) {
      const body = JSON.parse(options.body || '{}')
      calls.push({ url, body })
      if (url === '/api3/mall/mgr/fulfill/merchant/node/registration/queryNodeSupportDeliveryType') {
        return jsonResponse({
          errcode: '0',
          data: {
            nodeDeliveryDtoList: [
              { id: 1613854860199858176, deliveryId: 207476, deliveryType: 1, deliveryTypeName: '商家配送', isSupported: 1, isDefault: 1 },
              { id: 1613854860199858176, deliveryId: 214669, deliveryType: 3, deliveryTypeName: '到店自提', isSupported: 1, isDefault: 0 },
            ],
          },
        })
      }
      if (url === '/api3/mall/mgr/fulfill/goodsTemplate/findMerchantTemplateList') {
        return jsonResponse({
          errcode: '0',
          data: {
            defaultFreightTemplate: { templateId: 10003147950, templateName: '顺丰包邮' },
            freightTemplateList: [{ templateId: 10003147950, templateName: '顺丰包邮' }],
          },
        })
      }
      if (url === '/api3/mall/mgr/fulfill/pickup/delivery/findNodeTemplateList') {
        return jsonResponse({
          errcode: '0',
          data: {
            defaultTemplate: { id: 40870, templateName: '默认自提模板' },
            templateList: [{ id: 40870, templateName: '默认自提模板' }],
          },
        })
      }
      assert.equal(url, '/api3/mall/goods/update')
      return jsonResponse({ errcode: '0', errmsg: '处理成功', data: { goodsId: 154548826297432 } })
    },
  })

  assert.equal(result.success, true)
  const updateCall = calls.find(call => call.url === '/api3/mall/goods/update')
  assert.ok(updateCall)
  assert.deepEqual(updateCall.body.performanceWay.deliveryList, [
    {
      id: 1613854860199858176,
      deliveryId: 207476,
      deliveryType: 1,
      deliveryTypeName: '商家配送',
      isSupported: 1,
      isDefault: 1,
      deliveryNodeShipId: 1613854860199858176,
      templateId: 10003147950,
      checked: true,
    },
    {
      deliveryId: 214669,
      deliveryType: 3,
      deliveryNodeShipId: 0,
      templateId: 40870,
      deliveryTypeName: '到店自提',
      checked: true,
    },
  ])
})

test('update phase treats nonzero Weimob errcode as save failure', async () => {
  const goodsInfo = {
    goodsId: 154550908297432,
    outerGoodsCode: '653514A6602Z',
    saleChannelType: 1,
    isCanSell: false,
    isOnline: false,
    performanceWay: {
      deliveryList: [{ deliveryId: 207476, deliveryType: 1, deliveryNodeShipId: 0, templateId: 10003147950 }],
    },
    skuList: [
      {
        itemSkuId: 295363620297432,
        skuId: 311359893297432,
        outerSkuCode: '6942652703790',
        skuBarCode: 'K000010176990504',
      },
    ],
  }

  const result = await runScript({
    phase: 'update_weimob',
    params: { execute_mode: 'update' },
    href: 'https://master.weimob.com/bos/products/ecGoodsmanage/4000547814432/4diuahndgX5o74sooX4di628kby/goods/editNoMenu?id=154550908297432&type=sale&saleChannelType=1',
    document: new FakeDocument({ inputFiber: fakeReactFiberWithGoodsInfo(goodsInfo) }),
    shared: {
      execute_mode: 'update',
      update_index: 0,
      deliveryOption: { deliveryId: 214669, deliveryType: 3, deliveryTypeName: '到店自提' },
      products: [
        {
          styleCode: '653514A6602Z',
          goodsId: 154550908297432,
          title: '半裙',
          editUrl: 'https://master.weimob.com/bos/products/ecGoodsmanage/4000547814432/4diuahndgX5o74sooX4di628kby/goods/editNoMenu?id=154550908297432&type=sale&saleChannelType=1',
          skuRows: [
            { itemSkuId: 295363620297432, skuId: 311359893297432, outerSkuCode: '6942652703790', skuBarCode: 'K000010176990504' },
          ],
        },
      ],
      mdmMapping: {
        '6942652703790': { skuCode: '653514A6602Z10025', eanCode: '6942652703790', skcCode: '653514A6602Z100' },
      },
    },
    async fetch(url) {
      assert.equal(url, '/api3/mall/goods/update')
      return jsonResponse({ errcode: '001450020000101', errmsg: '履约templateId 为空', data: null })
    },
  })

  assert.equal(result.success, false)
  assert.match(result.error, /履约templateId 为空/)
})
