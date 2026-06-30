import test from 'node:test'
import assert from 'node:assert/strict'

import {
  analyzePublishModel,
  buildOcrAnchorsFromResults,
  buildRuleCoverageCases,
  classifyWhiteBlackFeature,
  extractWindowJson,
  summarizeSamples,
  visualAnchorsFromImageFeatures,
} from '../adapters/tmall-ops-assistant/tools/probe_tmall_packaging_structure.mjs'
import {
  renderCaseReportMarkdown,
  selectCaseSamples,
} from '../adapters/tmall-ops-assistant/tools/report_tmall_packaging_cases.mjs'

test('extractWindowJson reads window.Json object before following script code', () => {
  const html = '<script>window.Json = {"models":{"formValues":{"title":"A;B"}}}; window.noIcmpJson = {"x":1};</script>'
  assert.deepEqual(extractWindowJson(html), {
    models: {
      formValues: {
        title: 'A;B',
      },
    },
  })
})

test('analyzePublishModel classifies modularDesc top and wanted-info bottom anchors', () => {
  const sample = analyzePublishModel({
    itemId: '1001',
    item: { itemId: '1001', merchantCode: '208425107212', title: '测试商品' },
    html: '返回旧版图文描述 window.Json = {}',
    model: {
      models: {
        formValues: {
          modularDesc: [
            {
              id: 30,
              name: '促销专区',
              content: [
                '<p>童装销售额全亚洲第一<img src="https://img.example/top.jpg"/></p>',
                '<p><img src="https://img.example/old-middle.jpg"/></p>',
                '<div data-title="想要的信息看这里"><img src="https://img.example/wanted.jpg"/></div>',
                '<h3>尺码表</h3><img src="https://img.example/size.jpg"/>',
              ].join(''),
            },
          ],
          mainImagesGroup: { images: [{ url: 'main.jpg' }] },
          threeToFourImages: [{ url: 'ratio.jpg' }],
          guideImageGroup: { verticalImage: [{ url: 'vertical.jpg' }] },
        },
      },
    },
  })

  assert.equal(sample.detailKind, 'modularDesc')
  assert.equal(sample.hasReturnOld, true)
  assert.equal(sample.pcDetail.imageCount, 4)
  assert.equal(sample.anchors.top.kind, 'asia_first')
  assert.equal(sample.anchors.bottom.kind, 'wanted_info')
  assert.equal(sample.replacementPlan.mode, 'anchored_replace')
  assert.equal(sample.replacementPlan.preserveFirstImage, true)
})

test('summarizeSamples groups handled and blocked probe scenarios', () => {
  const summary = summarizeSamples([
    {
      itemId: '1001',
      ok: true,
      detailKind: 'modularDesc',
      hasReturnOld: true,
      pcDetail: { modulePattern: '促销专区>商品尺码表' },
      anchors: { top: { kind: 'asia_first' }, bottom: { kind: 'wanted_info' } },
      replacementPlan: { mode: 'anchored_replace' },
    },
    {
      itemId: '1002',
      ok: true,
      detailKind: 'empty_pc_detail',
      hasReturnOld: false,
      pcDetail: { modulePattern: '' },
      anchors: { top: { kind: '' }, bottom: { kind: '' } },
      replacementPlan: { mode: 'blocked_empty_pc_detail', reason: 'empty' },
    },
  ])

  assert.equal(summary.sampleCount, 2)
  assert.equal(summary.countsByDetailKind.modularDesc, 1)
  assert.equal(summary.countsByDetailKind.empty_pc_detail, 1)
  assert.equal(summary.countsByReplacementMode.anchored_replace, 1)
  assert.equal(summary.countsByReplacementMode.blocked_empty_pc_detail, 1)
  assert.equal(summary.unhandled.length, 1)
})

test('visual feature pass can propose white-black fallback anchors', () => {
  const sample = {
    anchors: { top: { detected: false }, bottom: { detected: false } },
    pcDetail: {
      images: [
        { globalIndex: 0, src: 'https://img.example/old-0.jpg' },
        { globalIndex: 1, src: 'https://img.example/old-1.jpg' },
        { globalIndex: 2, src: 'https://img.example/white-black.jpg' },
      ],
    },
  }
  const features = [
    { index: 0, ok: true, whiteRatio: 0.2, blackRatio: 0.02, saturationAvg: 0.5 },
    { index: 1, ok: true, whiteRatio: 0.3, blackRatio: 0.01, saturationAvg: 0.4 },
    { index: 2, ok: true, whiteRatio: 0.82, blackRatio: 0.08, saturationAvg: 0.05, largestBlackComponentRatio: 0.02 },
  ]

  assert.equal(classifyWhiteBlackFeature(features[2]), true)
  assert.deepEqual(visualAnchorsFromImageFeatures(sample, features), {
    stopImageIndex: 2,
    stopAnchorKind: 'white_black_fallback',
    source: 'visual_canvas_white_black',
    confidence: 0.74,
    ocrStatus: 'not_configured',
  })
})

test('white-black visual fallback rejects white product images with a large black object', () => {
  assert.equal(classifyWhiteBlackFeature({
    ok: true,
    whiteRatio: 0.81,
    blackRatio: 0.12,
    saturationAvg: 0.01,
    largestBlackComponentRatio: 0.11,
  }), false)
})

test('visual feature pass starts after non-first fixed top and can outrank size anchors', () => {
  const sample = {
    anchors: {
      top: { detected: true, imageIndex: 2 },
      bottom: { detected: true, kind: 'size', imageIndex: 6 },
    },
    pcDetail: {
      images: [
        { globalIndex: 1, src: 'https://img.example/pre-top.jpg' },
        { globalIndex: 2, src: 'https://img.example/asia-first.jpg' },
        { globalIndex: 3, src: 'https://img.example/white-black.jpg' },
        { globalIndex: 6, src: 'https://img.example/size.jpg' },
      ],
    },
  }
  const features = [
    { index: 1, ok: true, whiteRatio: 0.9, blackRatio: 0.08, saturationAvg: 0.04, largestBlackComponentRatio: 0.02 },
    { index: 3, ok: true, whiteRatio: 0.82, blackRatio: 0.08, saturationAvg: 0.05, largestBlackComponentRatio: 0.02 },
  ]

  assert.deepEqual(visualAnchorsFromImageFeatures(sample, features), {
    stopImageIndex: 3,
    stopAnchorKind: 'white_black_fallback',
    source: 'visual_canvas_white_black',
    confidence: 0.74,
    ocrStatus: 'not_configured',
  })
})

test('visual feature pass does not outrank wanted-info or wash anchors', () => {
  const features = [
    { index: 1, ok: true, whiteRatio: 0.82, blackRatio: 0.08, saturationAvg: 0.05, largestBlackComponentRatio: 0.02 },
  ]
  for (const bottomKind of ['wanted_info', 'wash_fallback']) {
    const sample = {
      anchors: {
        top: { detected: false },
        bottom: { detected: true, kind: bottomKind, imageIndex: 4 },
      },
      pcDetail: { images: [{ globalIndex: 1, src: 'https://img.example/white-black.jpg' }] },
    }
    assert.deepEqual(visualAnchorsFromImageFeatures(sample, features), { ocrStatus: 'not_configured' })
  }
})

test('OCR results can recover fixed top and wash fallback anchors for probe samples', () => {
  const sample = {
    anchors: { top: { detected: false }, bottom: { detected: false } },
    pcDetail: {
      images: [
        { globalIndex: 0, src: 'https://img.example/top.jpg' },
        { globalIndex: 1, src: 'https://img.example/detail.jpg' },
        { globalIndex: 2, src: 'https://img.example/wash.jpg' },
      ],
    },
  }

  const anchors = buildOcrAnchorsFromResults(sample, [
    { globalIndex: 0, text: '童装销售额 全亚洲 第一', confidence: 86 },
    { globalIndex: 2, text: '不同材质这样洗 水洗注意事项', confidence: 82 },
  ])

  assert.equal(anchors.ocrStatus, 'recognized')
  assert.equal(anchors.preserveFirstImage, true)
  assert.equal(anchors.fixedTopImageIndex, 0)
  assert.equal(anchors.stopImageIndex, 2)
  assert.equal(anchors.stopAnchorKind, 'wash_fallback')
  assert.equal(anchors.source, 'tesseract_ocr')
})

test('OCR results can preserve top marketing promo before wanted-info anchors', () => {
  const sample = {
    anchors: { top: { detected: false }, bottom: { detected: false } },
    pcDetail: {
      images: [
        { globalIndex: 0, src: 'https://img.example/member-gift.jpg' },
        { globalIndex: 1, src: 'https://img.example/old-product.jpg' },
        { globalIndex: 2, src: 'https://img.example/wanted-info.jpg' },
      ],
    },
  }

  const anchors = buildOcrAnchorsFromResults(sample, [
    { globalIndex: 0, text: '会员专属礼赠 送IP周边礼盒 送T恤水杯 抢! 千款满300减120 淘金币补贴下单链路', confidence: 79 },
    { globalIndex: 2, text: '想要的信息看这里 产品名称 渔夫帽 尺码表', confidence: 88 },
  ])

  assert.equal(anchors.ocrStatus, 'recognized')
  assert.equal(anchors.preserveFirstImage, true)
  assert.equal(anchors.fixedTopImageIndex, 0)
  assert.equal(anchors.fixedTopAnchorKind, 'marketing_top')
  assert.equal(anchors.stopImageIndex, 2)
  assert.equal(anchors.stopAnchorKind, 'wanted_info')
})

test('OCR results do not treat marketing promo after wanted-info as fixed top', () => {
  const sample = {
    anchors: { top: { detected: false }, bottom: { detected: false } },
    pcDetail: {
      images: [
        { globalIndex: 0, src: 'https://img.example/wanted-info.jpg' },
        { globalIndex: 1, src: 'https://img.example/detail.jpg' },
        { globalIndex: 2, src: 'https://img.example/member-gift.jpg' },
      ],
    },
  }

  const anchors = buildOcrAnchorsFromResults(sample, [
    { globalIndex: 0, text: '想要的信息看这里 产品名称 渔夫帽 尺码表', confidence: 88 },
    { globalIndex: 2, text: '会员专属礼赠 淘金币补贴下单链路 抢! 千款满300减120', confidence: 79 },
  ])

  assert.equal(anchors.ocrStatus, 'recognized')
  assert.equal(anchors.preserveFirstImage, false)
  assert.equal(anchors.fixedTopImageIndex, null)
  assert.equal(anchors.stopImageIndex, 0)
  assert.equal(anchors.stopAnchorKind, 'wanted_info')
})

test('analyzePublishModel preserves through non-first OCR fixed top anchor', () => {
  const sample = analyzePublishModel({
    itemId: '1003',
    item: { itemId: '1003', merchantCode: '208325103003' },
    model: {
      models: {
        formValues: {
          modularDesc: [
            {
              id: 30,
              name: '促销专区',
              content: [
                '<p><img src="https://img.example/pre-brand.jpg"/></p>',
                '<p><img src="https://img.example/campaign.jpg"/></p>',
                '<p><img src="https://img.example/asia-first.jpg"/></p>',
                '<p><img src="https://img.example/old-product.jpg"/></p>',
                '<p><img src="https://img.example/wanted-info.jpg"/></p>',
              ].join(''),
            },
          ],
        },
      },
    },
    visualAnchors: {
      fixedTopImageIndex: 2,
      stopImageIndex: 4,
      stopAnchorKind: 'wanted_info',
      source: 'tesseract_ocr',
    },
  })

  assert.equal(sample.anchors.top.imageIndex, 2)
  assert.equal(sample.replacementPlan.replaceStartIndex, 3)
  assert.equal(sample.replacementPlan.stopImageIndex, 4)
  assert.equal(sample.replacementPlan.replacedImageCount, 1)
})

test('rule coverage cases summarize out-of-rule samples with OCR and screenshot metadata', () => {
  const cases = buildRuleCoverageCases([
    {
      itemId: '1001',
      merchantCode: '208425107212',
      title: '可处理商品',
      detailKind: 'modularDesc',
      pcDetail: { modulePattern: '宝贝参数>宝贝尺码表', imageCount: 3, images: [] },
      anchors: { bottom: { kind: 'size' } },
      replacementPlan: { mode: 'anchored_replace' },
    },
    {
      itemId: '1002',
      merchantCode: '208425107213',
      title: '规则外商品',
      detailKind: 'tmDescription',
      pcDetail: {
        modulePattern: '旧描述',
        imageCount: 2,
        images: [
          { globalIndex: 0, src: 'https://img.example/a.jpg' },
          { globalIndex: 1, src: 'https://img.example/b.jpg' },
        ],
      },
      anchors: { bottom: { kind: '' } },
      replacementPlan: { mode: 'blocked_stop_anchor_missing', reason: '未识别到底部保留锚点' },
      ocr: {
        anchors: { ocrStatus: 'recognized', source: 'tesseract_ocr', stopAnchorKind: 'wash_fallback' },
        results: [{ globalIndex: 0, text: '模糊文案', confidence: 31 }],
      },
      caseAssets: { screenshot: 'cases/1002.png' },
    },
  ])

  assert.equal(cases.length, 1)
  assert.equal(cases[0].itemId, '1002')
  assert.equal(cases[0].merchantCode, '208425107213')
  assert.equal(cases[0].status, 'out_of_rule')
  assert.equal(cases[0].ocrStatus, 'recognized')
  assert.equal(cases[0].ocrStopAnchorKind, 'wash_fallback')
  assert.equal(cases[0].screenshot, 'cases/1002.png')
  assert.equal(cases[0].imageCount, 2)
})

test('case reporter selects representative out-of-rule samples and renders screenshot links', () => {
  const samples = [
    {
      itemId: '1001',
      merchantCode: '208425107212',
      replacementPlan: { mode: 'anchored_replace' },
      pcDetail: { modulePattern: '宝贝参数>尺码表', imageCount: 3 },
    },
    {
      itemId: '1002',
      merchantCode: '208425107213',
      title: '规则外 A',
      detailKind: 'tmDescription',
      replacementPlan: { mode: 'blocked_stop_anchor_missing', reason: 'missing stop' },
      pcDetail: { modulePattern: '旧描述', imageCount: 8, images: [{ src: 'https://img.example/a.jpg' }] },
      ocr: { anchors: { ocrStatus: 'recognized', stopAnchorKind: 'wash_fallback', matchedText: '不同材质这样洗' } },
      caseAssets: { screenshot: 'cases/1002.png' },
    },
    {
      itemId: '1003',
      merchantCode: '208425107214',
      title: '规则外 B',
      detailKind: 'tmDescription',
      replacementPlan: { mode: 'blocked_stop_anchor_missing', reason: 'missing stop' },
      pcDetail: { modulePattern: '旧描述', imageCount: 9, images: [{ src: 'https://img.example/b.jpg' }] },
    },
  ]

  const selected = selectCaseSamples(samples, { limit: 1 })
  assert.equal(selected.length, 1)
  assert.equal(selected[0].itemId, '1002')

  const markdown = renderCaseReportMarkdown({
    generatedAt: '2026-06-30T10:00:00.000Z',
    totalSamples: 3,
    cases: buildRuleCoverageCases(samples),
    selectedSamples: selected,
  })
  assert.match(markdown, /# 天猫包装详情规则外案例报告/)
  assert.match(markdown, /208425107213/)
  assert.match(markdown, /cases\/1002\.png/)
  assert.match(markdown, /不同材质这样洗/)
  assert.match(markdown, /wash_fallback/)
})
