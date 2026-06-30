import test from 'node:test'
import assert from 'node:assert/strict'

import {
  analyzePublishModel,
  classifyWhiteBlackFeature,
  extractWindowJson,
  summarizeSamples,
  visualAnchorsFromImageFeatures,
} from '../adapters/tmall-ops-assistant/tools/probe_tmall_packaging_structure.mjs'

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
