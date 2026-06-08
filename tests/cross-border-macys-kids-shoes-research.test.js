import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

async function loadExports() {
  const scriptPath = path.resolve('adapters/cross-border-research/macys-kids-shoes-research.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  const exportsBox = {}
  const locationUrl = new URL('https://www.macys.com/shop/kids-baby/shoes/Pageindex/2?id=48561')
  const context = {
    window: {
      __CRAWSHRIMP_PARAMS__: {},
      __CRAWSHRIMP_SHARED__: {},
      __CRAWSHRIMP_EXPORTS__: exportsBox,
      location: locationUrl,
    },
    document: {
      querySelectorAll: () => [],
      body: { innerText: '' },
      documentElement: { innerHTML: '' },
    },
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

function productCardFixture() {
  return `
    <li class="productThumbnail" data-product_id="18969706">
      <a href="/shop/product/nike-big-kids-air-max?ID=18969706">Nike Big Kids Air Max</a>
      <img src="https://slimages.macysassets.com/is/image/MCY/products/0/optimized/123.jpg" alt="Nike Big Kids Air Max" />
      <div class="productBrand">Nike</div>
      <div class="productName">Big Kids Air Max Shoes</div>
      <div class="prices">
        <span class="regular">Reg. $75.00</span>
        <span class="sale">Sale $52.50</span>
        <span class="discount">30% off</span>
      </div>
    </li>
    <li class="productThumbnail" data-product_id="200">
      <a href="/shop/product/carter-little-kids-sandals?ID=200">Carter's Little Kids Sandals</a>
      <img data-src="//slimages.macysassets.com/is/image/MCY/products/1/optimized/456.jpg" alt="Carter's Little Kids Sandals" />
      <div class="productBrand">Carter's</div>
      <div class="productName">Little Kids Sandals</div>
      <span class="price">Orig. $44.00 Now $22.00</span>
    </li>
  `
}

test('macys helper extracts product fields from SSR product cards', async () => {
  const helpers = await loadExports()
  const rows = helpers.extractProductsFromHtml(productCardFixture(), helpers.DEFAULT_SOURCE_URL)

  assert.equal(rows.length, 2)
  assert.deepEqual(plain(rows.map(item => ({
    id: item.productId,
    brand: item.brand,
    age: item.age,
    category: item.category,
    original: item.originalPrice,
    sale: item.salePrice,
    discount: item.discountPercent,
  }))), [
    {
      id: '18969706',
      brand: 'Nike',
      age: 'Big Kid',
      category: 'Sneakers',
      original: 75,
      sale: 52.5,
      discount: 30,
    },
    {
      id: '200',
      brand: "Carter's",
      age: 'Little Kid',
      category: 'Sandals',
      original: 44,
      sale: 22,
      discount: 50,
    },
  ])
  assert.match(rows[1].imageUrl, /^https:\/\/slimages\.macysassets\.com\//)
})

test('macys helper aggregates rows by brand and by category with price bands and images', async () => {
  const helpers = await loadExports()
  const products = [
    {
      productId: '1',
      brand: 'Nike',
      productName: 'Big Kids Air Max Shoes',
      category: 'Sneakers',
      age: 'Big Kid',
      originalPrice: 75,
      salePrice: 52.5,
      discountPercent: 30,
      productUrl: 'https://www.macys.com/shop/product/nike?ID=1',
      imageUrl: 'https://img/1.jpg',
    },
    {
      productId: '2',
      brand: 'Nike',
      productName: 'Little Kids Court Shoes',
      category: 'Sneakers',
      age: 'Little Kid',
      originalPrice: 60,
      salePrice: 48,
      discountPercent: 20,
      productUrl: 'https://www.macys.com/shop/product/nike?ID=2',
      imageUrl: 'https://img/2.jpg',
    },
    {
      productId: '3',
      brand: "Carter's",
      productName: 'Toddler Sandals',
      category: 'Sandals',
      age: 'Toddler',
      originalPrice: 44,
      salePrice: 22,
      discountPercent: 50,
      productUrl: 'https://www.macys.com/shop/product/carters?ID=3',
      imageUrl: 'https://img/3.jpg',
    },
  ]

  const rows = helpers.buildResearchRows(products)
  const brandRows = rows.filter(row => row.__sheet_name === helpers.BRAND_SHEET)
  const categoryRows = rows.filter(row => row.__sheet_name === helpers.CATEGORY_SHEET)

  assert.equal(brandRows.length, 2)
  assert.equal(categoryRows.length, 2)
  assert.deepEqual(plain(brandRows[0]), {
    __sheet_name: '品牌维度',
    '品牌': 'Nike',
    '产品宽度': 2,
    '品类': 'Sneakers',
    '品类价格带': 'Sneakers: $48.00 - $52.50',
    '年龄维度': 'Big Kid / Little Kid',
    '销售价格带': '$60.00 - $75.00',
    '折扣力度': '-20% 至 -30%',
    '折扣后价格带': '$48.00 - $52.50',
    '代表产品': 'Big Kids Air Max Shoes / Little Kids Court Shoes',
    '产品图片': 'https://img/1.jpg\nhttps://img/2.jpg',
    '商品链接': 'https://www.macys.com/shop/product/nike?ID=1\nhttps://www.macys.com/shop/product/nike?ID=2',
    '来源 URL': helpers.DEFAULT_SOURCE_URL,
  })
  assert.deepEqual(plain(categoryRows.map(row => [row['品类'], row['产品宽度'], row['品牌'], row['年龄维度']])), [
    ['Sneakers', 2, 'Nike', 'Big Kid / Little Kid'],
    ['Sandals', 1, "Carter's", 'Toddler'],
  ])
})

test('macys helper collects products from page HTML and emits two research sheets', async () => {
  const helpers = await loadExports()
  const rows = await helpers.collectResearchRows({
    category_url: helpers.DEFAULT_SOURCE_URL,
    request_delay_ms: 0,
  }, async url => {
    assert.equal(url, helpers.DEFAULT_SOURCE_URL)
    return productCardFixture()
  })

  assert.equal(rows.filter(row => row.__sheet_name === helpers.BRAND_SHEET).length, 2)
  assert.equal(rows.filter(row => row.__sheet_name === helpers.CATEGORY_SHEET).length, 2)
})
