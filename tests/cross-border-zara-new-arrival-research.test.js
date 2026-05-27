import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

async function loadExports() {
  const scriptPath = path.resolve('adapters/cross-border-research/zara-new-arrival-research.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const exportsBox = {}
  const locationUrl = new URL('https://www.zara.com/us/en/')
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: {},
      __CRAWSHRIMP_SHARED__: {},
      __CRAWSHRIMP_EXPORTS__: exportsBox,
      location: locationUrl,
    },
    document: {},
    location: locationUrl,
    console,
    fetch: async () => {
      throw new Error('fetch should be mocked by collectResearchRows tests')
    },
    setTimeout: (callback) => {
      Promise.resolve().then(callback)
      return 1
    },
    clearTimeout: () => {},
    URL,
    Intl,
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
  context.globalThis = context
  await vm.runInNewContext(source, context, { filename: scriptPath })
  return exportsBox
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function categoriesFixture() {
  return {
    categories: [
      {
        id: 100,
        name: 'WOMAN',
        sectionName: 'WOMAN',
        subcategories: [
          {
            id: 110,
            name: 'NEW ARRIVALS',
            sectionName: 'WOMAN',
            seo: { keyword: 'woman-highlight-new', seoCategoryId: 17359 },
            subcategories: [
              {
                id: 111,
                name: 'THE NEW',
                sectionName: 'WOMAN',
                seo: { keyword: 'woman-new-in', seoCategoryId: 1180 },
                subcategories: [],
              },
              {
                id: 112,
                name: 'SUMMER EDIT',
                sectionName: 'WOMAN',
                seo: { keyword: 'woman-summer', seoCategoryId: 9001 },
                subcategories: [],
              },
            ],
          },
          {
            id: 120,
            name: 'SPECIAL PRICES',
            sectionName: 'WOMAN',
            seo: { keyword: 'woman-special-prices', seoCategoryId: 1314 },
            subcategories: [
              {
                id: 121,
                name: 'VIEW ALL',
                sectionName: 'WOMAN',
                seo: { keyword: 'woman-special-prices', seoCategoryId: 1314 },
                subcategories: [],
              },
            ],
          },
        ],
      },
      {
        id: 200,
        name: 'MAN',
        sectionName: 'MAN',
        subcategories: [],
      },
    ],
  }
}

function productPayload(products) {
  return {
    productGroups: [
      {
        id: 'group-1',
        type: 'main',
        elements: [
          {
            id: 'editorial-1',
            type: 'editorial',
            commercialComponents: products,
          },
        ],
      },
    ],
  }
}

test('zara helper resolves new-arrival targets from official category trees', async () => {
  const helpers = await loadExports()
  const targets = helpers.collectNewArrivalTargets(categoriesFixture(), helpers.MARKETS.us, ['WOMAN'], 10)

  assert.deepEqual(plain(targets.map(item => [item.sectionLabel, item.branchName, item.categoryName, item.categoryId])), [
    ['女装', 'NEW ARRIVALS', 'THE NEW', 111],
    ['女装', 'NEW ARRIVALS', 'SUMMER EDIT', 112],
  ])
  assert.equal(
    helpers.productApiUrl(helpers.MARKETS.us, 111),
    'https://www.zara.com/us/en/category/111/products?ajax=true',
  )
})

test('zara helper aggregates SKU width, price bands, and rule-based style by product family', async () => {
  const helpers = await loadExports()
  const products = productPayload([
    {
      id: 1,
      reference: '07223038-V2026',
      type: 'Product',
      kind: 'Wear',
      name: 'Z1975 DENIM SHORTS',
      price: 4590,
      familyName: 'BERMUDA',
      subfamilyName: 'SHORTS',
    },
    {
      id: 2,
      reference: '07223039-V2026',
      type: 'Product',
      kind: 'Wear',
      name: 'LINEN BERMUDA SHORTS',
      price: 5990,
      familyName: 'BERMUDA',
      subfamilyName: 'SHORTS',
    },
    {
      id: 3,
      reference: '02637111-V2026',
      type: 'Product',
      kind: 'Wear',
      name: 'SATIN MIDI DRESS',
      price: 12900,
      familyName: 'VESTIDO',
      subfamilyName: 'DRESS',
    },
  ])

  const rows = await helpers.collectResearchRows({
    site_scope: 'us',
    section_scope: 'woman',
    include_homepage_banners: false,
    max_new_categories: 1,
    request_delay_ms: 0,
  }, async url => {
    if (url.includes('/categories?ajax=true')) return categoriesFixture()
    if (url.includes('/category/111/products')) return products
    throw new Error(`unexpected URL ${url}`)
  })

  assert.equal(rows.length, 2)
  assert.deepEqual(plain(rows.map(row => [row.__sheet_name, row['品类'], row['SKU 宽度'], row['价格带']])), [
    ['上新SKU宽度', '短裤/百慕大 (BERMUDA)', 2, '$45.90 - $59.90'],
    ['上新SKU宽度', '连衣裙/裙装 (VESTIDO)', 1, '$129.00'],
  ])
  assert.match(rows[0]['产品风格'], /牛仔休闲|度假/)
  assert.match(rows[0]['代表商品'], /DENIM SHORTS/)
})

test('zara helper emits homepage theme and promotion discount rows', async () => {
  const helpers = await loadExports()
  const promoProducts = productPayload([
    {
      id: 10,
      reference: 'promo-1',
      type: 'Product',
      kind: 'Wear',
      name: 'POLKA DOT STRAPPY MINI DRESS',
      price: 3594,
      oldPrice: 5990,
      displayDiscountPercentage: 40,
      familyName: 'VESTIDO',
    },
    {
      id: 11,
      reference: 'promo-2',
      type: 'Product',
      kind: 'Wear',
      name: 'TEXTURED TOP',
      price: 3493,
      oldPrice: 4990,
      discountLabel: '-30%',
      familyName: 'BLUSA',
    },
  ])

  const rows = await helpers.collectResearchRows({
    site_scope: 'us',
    section_scope: 'woman',
    include_homepage_banners: true,
    include_promotion_discount: true,
    max_new_categories: 1,
    max_promo_categories: 1,
    request_delay_ms: 0,
  }, async url => {
    if (url.includes('/categories?ajax=true')) return categoriesFixture()
    if (url.includes('/category/111/products')) return productPayload([])
    if (url.includes('/category/120/products')) return promoProducts
    if (url.includes('/category/121/products')) return promoProducts
    throw new Error(`unexpected URL ${url}`)
  })

  const bannerRows = rows.filter(row => row.__sheet_name === helpers.BANNER_SHEET)
  assert.equal(bannerRows.length, 2)
  assert.equal(bannerRows[0]['Banner 类型'], '上新主题')
  assert.match(bannerRows[0]['上新主体'], /THE NEW/)
  assert.equal(bannerRows[1]['Banner 类型'], '促销折扣')
  assert.equal(bannerRows[1]['促销折扣'], '-30% 至 -40%')
  assert.equal(bannerRows[1]['价格带'], '$34.93 - $35.94')
})
