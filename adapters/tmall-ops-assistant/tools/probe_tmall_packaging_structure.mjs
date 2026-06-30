#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_OUT_DIR = '/private/tmp/tmall-packaging-structure-probe-10000'
const DEFAULT_CDP = 'http://127.0.0.1:9222'
const DEFAULT_LIMIT = 10000
const DEFAULT_PAGE_SIZE = 20
const DEFAULT_DELAY_MS = 1200
const DEFAULT_JITTER_MS = 600
const DEFAULT_LIST_DELAY_MS = 1800
const DEFAULT_COOLDOWN_EVERY = 100
const DEFAULT_COOLDOWN_MS = 30000
const DEFAULT_ARTIFACT_EVERY = 10
const DEFAULT_CONCURRENCY = 1

const ASIA_TOP_ANCHOR_RE = /(童装销售额|全亚洲|亚洲第一)/i
const WANTED_INFO_ANCHOR_RE = /(想要的信息看这里|想看的信息在这里|想要的信息|信息看这里)/i
const WASH_FALLBACK_ANCHOR_RE = /(不同材质这样洗|不同材质|衣物洗涤|洗涤|水洗|洗唛)/i
const SIZE_ANCHOR_RE = /(尺码表|尺码测量|尺码推荐|尺码推荐表|宝贝尺寸|宝贝尺码|商品尺码表|尺码信息|测量图)/i
const LOWER_PRESERVE_ANCHOR_RE = /(模特信息|模特展示|宝贝模特|吊牌|吊牌展示|洗涤|水洗|洗唛|不同材质这样洗|不同材质|衣物洗涤|品牌介绍|品牌故事|宝贝故事|品牌说明|底部固定|宝贝底部|售后)/i
const INFO_ANCHOR_RE = /(商品信息|宝贝信息|产品信息|基础信息|基本信息|商品参数|宝贝参数)/i
const MARKETING_TOP_ANCHOR_RE = /(会员专属礼赠|淘金币补贴|下单链路|送IP周边|IP周边礼盒|周边礼盒|送T恤水杯|送T恤|加购商品|加购过tab|加购过|千款满\s*\d+\s*减\s*\d+|满\s*\d+\s*减\s*\d+)/i
const ASIA_REFERENCE_URL_TOKENS = [
  'O1CN01OMbu9v1IH8VfuT2Vh_!!642320867',
]
const HANDLED_MODES = new Set(['anchored_replace', 'no_detail_images'])

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function compact(value) {
  return cleanText(value).replace(/\s+/g, '')
}

function safeParseJson(value, fallback = null) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value
  try {
    return JSON.parse(String(value || ''))
  } catch (error) {
    return fallback
  }
}

function decodeHtmlText(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function htmlAnchorText(value) {
  return decodeHtmlText(String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' '))
}

function normalizeRemoteUrl(value) {
  const text = cleanText(value)
  if (!text) return ''
  return text.startsWith('//') ? `https:${text}` : text
}

function extractImgSrc(imgTag) {
  const match = String(imgTag || '').match(/\s(?:src|data-src|data-ks-lazyload|data-lazy-src)=["']([^"']+)["']/i)
  return match ? normalizeRemoteUrl(decodeHtmlText(match[1])) : ''
}

function nearestAnchorContext(content, imgStart, previousImageEnd = 0) {
  const raw = String(content || '')
  const windowStart = Math.max(0, Math.min(previousImageEnd || 0, imgStart - 1800))
  const before = raw.slice(windowStart, imgStart)
  const text = htmlAnchorText(before)
  return `${before} ${text}`
}

function isAsiaTopAnchorText(value) {
  return ASIA_TOP_ANCHOR_RE.test(String(value || ''))
}

function isMarketingTopAnchorText(value) {
  return MARKETING_TOP_ANCHOR_RE.test(String(value || ''))
}

function isWantedInfoAnchorText(value) {
  return WANTED_INFO_ANCHOR_RE.test(String(value || ''))
}

function isWashFallbackAnchorText(value) {
  return WASH_FALLBACK_ANCHOR_RE.test(String(value || ''))
}

function isSizeAnchorText(value) {
  return SIZE_ANCHOR_RE.test(String(value || ''))
}

function isLowerPreserveAnchorText(value) {
  return LOWER_PRESERVE_ANCHOR_RE.test(String(value || ''))
}

function isInfoAnchorText(value) {
  return INFO_ANCHOR_RE.test(String(value || ''))
}

function ocrAnchorText(value) {
  const raw = compact(value)
  const joined = raw.replace(/[\s:：,，.。;；|｜_\\/\-—~～]+/g, '')
  return `${raw} ${joined}`
}

export function classifyOcrAnchorText(value) {
  const text = ocrAnchorText(value)
  if (isAsiaTopAnchorText(text)) return 'fixed_top'
  if (isWantedInfoAnchorText(text)) return 'wanted_info'
  if (isWashFallbackAnchorText(text)) return 'wash_fallback'
  if (isSizeAnchorText(text)) return 'size'
  if (isLowerPreserveAnchorText(text)) return 'lower_preserve'
  if (isMarketingTopAnchorText(text)) return 'marketing_top'
  return ''
}

function isKnownAsiaReferenceUrl(url) {
  const text = normalizeRemoteUrl(url)
  return ASIA_REFERENCE_URL_TOKENS.some(token => text.includes(token))
}

function countArray(value) {
  return Array.isArray(value) ? value.length : 0
}

function arrayFromMaybe(value) {
  return Array.isArray(value) ? value : []
}

function getFormValues(model) {
  return model?.models?.formValues || model?.formValues || model?.data?.models?.formValues || {}
}

function getModuleContent(module) {
  return String(module?.content || module?.html || '')
}

export function extractWindowJsonSource(html) {
  const text = String(html || '')
  const key = 'window.Json'
  const keyIndex = text.indexOf(key)
  if (keyIndex < 0) throw new Error('未找到 window.Json')
  const assignIndex = text.indexOf('=', keyIndex)
  const open = text.indexOf('{', assignIndex)
  if (open < 0) throw new Error('window.Json 后未找到 JSON 对象')
  let depth = 0
  let inString = false
  let escaped = false
  let quote = ''
  for (let index = open; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        inString = false
      }
      continue
    }
    if (char === '"' || char === "'") {
      inString = true
      quote = char
      continue
    }
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(open, index + 1)
    }
  }
  throw new Error('window.Json JSON 对象未闭合')
}

export function extractWindowJson(html) {
  return JSON.parse(extractWindowJsonSource(html))
}

export function flattenDetailImages(modules) {
  const images = []
  const sourceModules = Array.isArray(modules) ? modules : []
  sourceModules.forEach((module, moduleIndex) => {
    const content = getModuleContent(module)
    const moduleName = compact(module?.name)
    const imageMatches = [...content.matchAll(/<img\b[^>]*>/gi)]
    let previousImageEnd = 0
    imageMatches.forEach((match, imageIndex) => {
      const start = Number(match.index || 0)
      const tag = String(match[0] || '')
      const end = start + tag.length
      const context = `${moduleName} ${nearestAnchorContext(content, start, previousImageEnd)} ${tag}`
      const src = extractImgSrc(tag)
      images.push({
        moduleIndex,
        moduleName,
        imageIndex,
        globalIndex: images.length,
        src,
        contextText: htmlAnchorText(context).slice(0, 500),
        contextHash: hashString(context),
        flags: {
          asiaTop: isAsiaTopAnchorText(context) || isKnownAsiaReferenceUrl(src),
          wantedInfo: isWantedInfoAnchorText(context),
          washFallback: isWashFallbackAnchorText(context),
          size: isSizeAnchorText(context),
          lowerPreserve: isLowerPreserveAnchorText(context),
          info: isInfoAnchorText(context),
        },
      })
      previousImageEnd = end
    })
  })
  return images
}

function hashString(value) {
  let hash = 2166136261
  const text = String(value || '')
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function moduleSummary(modules) {
  return arrayFromMaybe(modules).map((module, index) => {
    const content = getModuleContent(module)
    const images = [...content.matchAll(/<img\b[^>]*>/gi)]
    const text = `${compact(module?.name)} ${htmlAnchorText(content).slice(0, 1000)}`
    return {
      index,
      id: module?.id ?? '',
      name: compact(module?.name),
      custom: !!module?.custom,
      imageCount: images.length,
      contentLength: content.length,
      flags: {
        asiaTop: isAsiaTopAnchorText(text),
        wantedInfo: isWantedInfoAnchorText(text),
        washFallback: isWashFallbackAnchorText(text),
        size: isSizeAnchorText(text),
        lowerPreserve: isLowerPreserveAnchorText(text),
        info: isInfoAnchorText(text),
      },
    }
  })
}

function classifyTopAnchor(images, visual = {}) {
  if (!images.length) return emptyAnchor()
  const fixedTopIndex = Number(visual.fixedTopImageIndex)
  if (Number.isFinite(fixedTopIndex) && fixedTopIndex >= 0) {
    const visualImage = images.find(image => Number(image.globalIndex) === fixedTopIndex)
    if (visualImage) {
      const isMarketingTop = visual.fixedTopAnchorKind === 'marketing_top'
      return {
        detected: true,
        kind: isMarketingTop ? 'marketing_top' : 'asia_first',
        imageIndex: visualImage.globalIndex,
        src: visualImage.src,
        method: cleanText(visual.source || 'visual_similarity'),
        confidence: Number(visual.confidence || 0.82),
      }
    }
  }
  const firstImage = images[0]
  const visualTop = visual.preserveFirstImage
  if (firstImage.flags.asiaTop || visualTop) {
    return {
      detected: true,
      kind: 'asia_first',
      imageIndex: 0,
      src: firstImage.src,
      method: firstImage.flags.asiaTop ? 'text_or_url' : cleanText(visual.source || 'visual_similarity'),
      confidence: firstImage.flags.asiaTop ? 0.95 : 0.82,
    }
  }
  return emptyAnchor()
}

function emptyAnchor() {
  return {
    detected: false,
    kind: '',
    imageIndex: null,
    src: '',
    method: '',
    confidence: 0,
  }
}

function visualStopAnchorForImage(image, visual = {}) {
  if (!image || Number(visual.stopImageIndex) !== image.globalIndex) return null
  const rawKind = compact(visual.stopAnchorKind || visual.anchorKind || 'visual_lower_preserve')
  const kind = /wanted|想要/.test(rawKind)
    ? 'wanted_info'
    : /wash|洗|材质/.test(rawKind)
      ? 'wash_fallback'
      : /white|black|白底|黑字/.test(rawKind)
        ? 'white_black_fallback'
        : /size|尺码/.test(rawKind)
          ? 'size'
          : 'visual_lower_preserve'
  return {
    detected: true,
    kind,
    imageIndex: image.globalIndex,
    src: image.src,
    method: cleanText(visual.source || 'visual_anchor'),
    confidence: Number(visual.confidence || 0.78),
  }
}

function textStopAnchorForImage(image) {
  if (!image) return null
  if (image.flags.wantedInfo) return anchorFromImage(image, 'wanted_info', 'text', 0.95)
  if (image.flags.washFallback) return anchorFromImage(image, 'wash_fallback', 'text', 0.88)
  if (image.flags.size) return anchorFromImage(image, 'size', 'text', 0.86)
  if (image.flags.lowerPreserve) return anchorFromImage(image, 'lower_preserve', 'text', 0.72)
  return null
}

function anchorFromImage(image, kind, method, confidence) {
  return {
    detected: true,
    kind,
    imageIndex: image.globalIndex,
    src: image.src,
    method,
    confidence,
  }
}

function classifyBottomAnchor(images, topAnchor, visual = {}) {
  if (!images.length) return emptyAnchor()
  const minIndex = topAnchor.detected ? 1 : 0
  const visualImage = images.find(image => image.globalIndex >= minIndex && Number(visual.stopImageIndex) === image.globalIndex)
  const visualAnchor = visualStopAnchorForImage(visualImage, visual)
  if (visualAnchor && visualAnchor.kind === 'wanted_info') return visualAnchor

  const wanted = images.find(image => image.globalIndex >= minIndex && image.flags.wantedInfo)
  if (wanted) return anchorFromImage(wanted, 'wanted_info', 'text', 0.95)

  if (visualAnchor && visualAnchor.kind === 'wash_fallback') return visualAnchor
  const wash = images.find(image => image.globalIndex >= minIndex && image.flags.washFallback)
  if (wash) return anchorFromImage(wash, 'wash_fallback', 'text', 0.88)

  if (visualAnchor && visualAnchor.kind === 'white_black_fallback') return visualAnchor

  if (visualAnchor && visualAnchor.kind === 'size') return visualAnchor
  const size = images.find(image => image.globalIndex >= minIndex && image.flags.size)
  if (size) return anchorFromImage(size, 'size', 'text', 0.86)

  if (visualAnchor) return visualAnchor
  const lower = images.find(image => image.globalIndex >= minIndex && image.flags.lowerPreserve)
  if (lower) return anchorFromImage(lower, 'lower_preserve', 'text', 0.72)
  return emptyAnchor()
}

function isLegacySingleDescription(detailKind, modules, images) {
  if (detailKind !== 'tmDescription') return false
  if (arrayFromMaybe(modules).length !== 1) return false
  return !images.some(image => image.flags.wantedInfo || image.flags.washFallback || image.flags.size || image.flags.info)
}

function buildReplacementPlan(detailKind, modules, images, anchors) {
  if (detailKind === 'empty_pc_detail') {
    return {
      mode: 'blocked_empty_pc_detail',
      reason: '未下发 modularDesc，且 tmDescription 为空或无图片',
    }
  }
  if (!images.length) {
    return {
      mode: 'blocked_no_images',
      reason: 'PC详情中未识别到图片',
    }
  }
  if (!anchors.bottom.detected) {
    const mode = isLegacySingleDescription(detailKind, modules, images)
      ? 'blocked_legacy_visual_anchor_missing'
      : 'blocked_stop_anchor_missing'
    return {
      mode,
      reason: '未识别到底部保留锚点：想要的信息看这里 / 不同材质这样洗 / 白底黑字图 / 尺码或下半区模块',
      preserveFirstImage: anchors.top.detected,
      replaceStartIndex: anchors.top.detected ? Number(anchors.top.imageIndex || 0) + 1 : 0,
    }
  }

  const fixedTopIndex = anchors.top.detected ? Number(anchors.top.imageIndex || 0) : null
  const replaceStartIndex = anchors.top.detected ? fixedTopIndex + 1 : 0
  const stopIndex = Number(anchors.bottom.imageIndex)
  const replacedImageCount = Math.max(0, stopIndex - replaceStartIndex)
  if (replacedImageCount <= 0) {
    return {
      mode: 'blocked_empty_replace_range',
      reason: '顶部或底部锚点之间没有可替换图片',
      preserveFirstImage: anchors.top.detected,
      replaceStartIndex,
      stopImageIndex: stopIndex,
      stopAnchorKind: anchors.bottom.kind,
    }
  }
  const fixedTopLabel = anchors.top.kind === 'marketing_top' ? '顶部营销固定图区' : '亚洲第一固定图区'
  return {
    mode: 'anchored_replace',
    preserveFirstImage: anchors.top.detected,
    preserveTopImageCount: anchors.top.detected ? fixedTopIndex + 1 : 0,
    replaceStartIndex,
    stopImageIndex: stopIndex,
    stopAnchorKind: anchors.bottom.kind,
    replacedImageCount,
    note: `${anchors.top.detected ? `保留第1到第${fixedTopIndex + 1}张${fixedTopLabel}；` : '未识别顶部固定图，从第1张开始替换；'}替换第${replaceStartIndex + 1}到第${stopIndex}张，${anchors.bottom.kind}及以下保留`,
  }
}

function detailModulesFromFormValues(formValues) {
  const modularDesc = Array.isArray(formValues.modularDesc)
    ? formValues.modularDesc
    : arrayFromMaybe(safeParseJson(formValues.modularDesc, []))
  if (modularDesc.length) {
    return {
      detailKind: 'modularDesc',
      modules: modularDesc,
    }
  }
  const tmDescription = typeof formValues.tmDescription === 'string' ? formValues.tmDescription : ''
  if (/<img\b/i.test(tmDescription)) {
    return {
      detailKind: 'tmDescription',
      modules: [{
        id: 'tmDescription',
        name: '文本PC详情',
        content: tmDescription,
        custom: true,
      }],
    }
  }
  return {
    detailKind: 'empty_pc_detail',
    modules: [],
  }
}

function layoutSignals(formValues) {
  const mainImages = arrayFromMaybe(formValues?.mainImagesGroup?.images)
  const threeToFourImages = arrayFromMaybe(formValues?.threeToFourImages)
  const guide = formValues?.guideImageGroup && typeof formValues.guideImageGroup === 'object' ? formValues.guideImageGroup : {}
  return {
    mainImagesGroupCount: mainImages.length,
    threeToFourImagesCount: threeToFourImages.length,
    guideImageGroupKeys: Object.keys(guide).sort(),
    guideVerticalCount: countArray(guide.verticalImage),
    guideWhiteBgCount: countArray(guide.whiteBgImage),
    descForShenbiMobileType: Array.isArray(formValues?.descForShenbiMobile) ? 'array' : typeof formValues?.descForShenbiMobile,
  }
}

export function analyzePublishModel({ itemId, item = {}, html = '', model, visualAnchors = {} }) {
  const formValues = getFormValues(model)
  const { detailKind, modules } = detailModulesFromFormValues(formValues)
  const images = flattenDetailImages(modules)
  const modulesInfo = moduleSummary(modules)
  const top = classifyTopAnchor(images, visualAnchors)
  const bottom = classifyBottomAnchor(images, top, visualAnchors)
  const anchors = {
    top,
    bottom,
    ocrStatus: visualAnchors.ocrStatus || 'not_configured',
  }
  const replacementPlan = buildReplacementPlan(detailKind, modules, images, anchors)
  return {
    itemId: cleanText(itemId || item?.itemId || item?.id),
    merchantCode: cleanText(item?.merchantCode || item?.outerId || item?.outer_id || getOuterIdFromFormValues(formValues)),
    title: cleanText(item?.title || item?.itemTitle || formValues?.title || ''),
    ok: true,
    hasReturnOld: /返回旧版图文描述/.test(String(html || '')),
    detailKind,
    layout: layoutSignals(formValues),
    pcDetail: {
      moduleCount: modulesInfo.length,
      modulePattern: modulesInfo.map(module => module.name || '(blank)').join('>'),
      modules: modulesInfo,
      imageCount: images.length,
      images: images.slice(0, 120),
      imageListTruncated: images.length > 120,
    },
    anchors,
    replacementPlan,
    formValueKeys: Object.keys(formValues || {}).sort().slice(0, 120),
  }
}

function getOuterIdFromFormValues(formValues) {
  const keyProp = formValues?.keyProp && typeof formValues.keyProp === 'object' ? formValues.keyProp : {}
  return cleanText(keyProp['p-13021751'] || keyProp.outerId || keyProp.outer_id || '')
}

function incrementCounter(counter, key, amount = 1) {
  const normalized = cleanText(key) || '(blank)'
  counter[normalized] = (counter[normalized] || 0) + amount
}

function topEntries(counter, limit = 30) {
  return Object.entries(counter)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }))
}

export function summarizeSamples(samples) {
  const list = Array.isArray(samples) ? samples : []
  const countsByDetailKind = {}
  const countsByReplacementMode = {}
  const countsByModulePattern = {}
  const countsByBottomAnchor = {}
  const countsByTopAnchor = {}
  const unhandled = []
  let hasReturnOldCount = 0
  let okCount = 0
  let modularDescCount = 0
  let tmDescriptionCount = 0
  let emptyPcDetailCount = 0

  for (const sample of list) {
    if (sample?.ok) okCount += 1
    if (sample?.hasReturnOld) hasReturnOldCount += 1
    if (sample?.detailKind === 'modularDesc') modularDescCount += 1
    if (sample?.detailKind === 'tmDescription') tmDescriptionCount += 1
    if (sample?.detailKind === 'empty_pc_detail') emptyPcDetailCount += 1
    incrementCounter(countsByDetailKind, sample?.detailKind || 'fetch_failed')
    incrementCounter(countsByReplacementMode, sample?.replacementPlan?.mode || 'fetch_failed')
    incrementCounter(countsByModulePattern, sample?.pcDetail?.modulePattern || '(none)')
    incrementCounter(countsByBottomAnchor, sample?.anchors?.bottom?.kind || '(missing)')
    incrementCounter(countsByTopAnchor, sample?.anchors?.top?.kind || '(missing)')
    if (!HANDLED_MODES.has(sample?.replacementPlan?.mode)) {
      unhandled.push({
        itemId: sample?.itemId || '',
        merchantCode: sample?.merchantCode || '',
        title: sample?.title || '',
        detailKind: sample?.detailKind || '',
        mode: sample?.replacementPlan?.mode || 'fetch_failed',
        reason: sample?.replacementPlan?.reason || sample?.error || '',
        modulePattern: sample?.pcDetail?.modulePattern || '',
        imageCount: sample?.pcDetail?.imageCount || 0,
      })
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    sampleCount: list.length,
    okCount,
    hasReturnOldCount,
    modularDescCount,
    tmDescriptionCount,
    emptyPcDetailCount,
    countsByDetailKind,
    countsByReplacementMode,
    countsByBottomAnchor,
    countsByTopAnchor,
    topModulePatterns: topEntries(countsByModulePattern, 50),
    topReplacementModes: topEntries(countsByReplacementMode, 50),
    unhandledCount: unhandled.length,
    unhandled: unhandled.slice(0, 500),
  }
}

export function classifyWhiteBlackFeature(feature) {
  if (!feature || feature.ok === false) return false
  const whiteRatio = Number(feature.whiteRatio || 0)
  const blackRatio = Number(feature.blackRatio || 0)
  const saturationAvg = Number(feature.saturationAvg || 0)
  const largestBlackComponentRatio = Number(feature.largestBlackComponentRatio || 0)
  return whiteRatio >= 0.62 &&
    blackRatio >= 0.025 &&
    blackRatio <= 0.28 &&
    saturationAvg <= 0.2 &&
    largestBlackComponentRatio <= 0.055
}

export function visualAnchorsFromImageFeatures(sample, features) {
  const images = arrayFromMaybe(sample?.pcDetail?.images)
  const featureList = arrayFromMaybe(features)
  const byIndex = new Map(featureList.map(feature => [Number(feature.index), feature]))
  const topImageIndex = Number(sample?.anchors?.top?.imageIndex)
  const startIndex = Number.isFinite(topImageIndex) && topImageIndex >= 0 ? topImageIndex + 1 : 0
  const bottomKind = cleanText(sample?.anchors?.bottom?.kind)
  if (bottomKind === 'wanted_info' || bottomKind === 'wash_fallback') return { ocrStatus: 'not_configured' }
  for (const image of images) {
    const index = Number(image.globalIndex)
    if (index < startIndex) continue
    const feature = byIndex.get(index)
    if (!classifyWhiteBlackFeature(feature)) continue
    return {
      stopImageIndex: index,
      stopAnchorKind: 'white_black_fallback',
      source: 'visual_canvas_white_black',
      confidence: 0.74,
      ocrStatus: 'not_configured',
    }
  }
  return { ocrStatus: 'not_configured' }
}

function ocrResultIndex(result, fallbackIndex = 0) {
  const candidates = [result?.globalIndex, result?.imageIndex, result?.index, fallbackIndex]
  for (const value of candidates) {
    const number = Number(value)
    if (Number.isFinite(number) && number >= 0) return number
  }
  return fallbackIndex
}

export function buildOcrAnchorsFromResults(sample, ocrResults = [], options = {}) {
  const images = arrayFromMaybe(sample?.pcDetail?.images || options.images)
  const imageByIndex = new Map(images.map((image, index) => [Number(image?.globalIndex ?? index), image]))
  const resultList = arrayFromMaybe(ocrResults)
    .map((result, index) => ({
      ...result,
      globalIndex: ocrResultIndex(result, index),
      text: compact(result?.text || result?.data?.text || ''),
      confidence: Number(result?.confidence ?? result?.data?.confidence ?? 0) || 0,
    }))
    .map(result => ({ ...result, anchorKind: classifyOcrAnchorText(result.text) }))
    .filter(result => result.text && !result.error)
    .sort((a, b) => a.globalIndex - b.globalIndex)

  const asiaTopResult = resultList.find(result => {
    if (images.length && !imageByIndex.has(result.globalIndex)) return false
    return result.anchorKind === 'fixed_top'
  })
  let fixedTopResult = asiaTopResult
  let fixedTopAnchorKind = fixedTopResult ? fixedTopResult.anchorKind : ''
  const priorities = ['wanted_info', 'wash_fallback', 'size', 'lower_preserve']

  function findStopAfter(minStopIndex) {
    for (const kind of priorities) {
      const found = resultList.find(result => {
        if (result.globalIndex < minStopIndex) return false
        if (images.length && !imageByIndex.has(result.globalIndex)) return false
        return result.anchorKind === kind
      })
      if (found) return { stop: found, stopAnchorKind: kind }
    }
    return { stop: null, stopAnchorKind: '' }
  }

  let minStopIndex = fixedTopResult ? fixedTopResult.globalIndex + 1 : 0
  let { stop, stopAnchorKind } = findStopAfter(minStopIndex)
  if (!fixedTopResult) {
    const marketingTopResult = resultList.find(result => {
      if (images.length && !imageByIndex.has(result.globalIndex)) return false
      if (result.anchorKind !== 'marketing_top') return false
      return !stop || result.globalIndex < stop.globalIndex
    })
    if (marketingTopResult) {
      fixedTopResult = marketingTopResult
      fixedTopAnchorKind = marketingTopResult.anchorKind
      minStopIndex = fixedTopResult.globalIndex + 1
      if (stop && stop.globalIndex < minStopIndex) {
        ;({ stop, stopAnchorKind } = findStopAfter(minStopIndex))
      }
    }
  }

  const anchors = {
    ocrStatus: stop ? 'recognized' : (resultList.length ? 'no_anchor' : 'no_text'),
    preserveFirstImage: !!fixedTopResult,
    source: compact(options.source || 'tesseract_ocr'),
    confidence: stop ? stop.confidence : (fixedTopResult?.confidence || 0),
    fixedTopImageIndex: fixedTopResult ? fixedTopResult.globalIndex : null,
    fixedTopAnchorKind,
    stopAnchorKind,
    matchedText: stop ? stop.text.slice(0, 120) : '',
    fixedTopText: fixedTopResult ? fixedTopResult.text.slice(0, 120) : '',
  }
  if (stop) anchors.stopImageIndex = stop.globalIndex
  return anchors
}

export function buildRuleCoverageCases(samples = [], options = {}) {
  const limit = Number(options.limit || 0)
  const cases = []
  for (const sample of arrayFromMaybe(samples)) {
    const mode = sample?.replacementPlan?.mode || 'fetch_failed'
    if (HANDLED_MODES.has(mode)) continue
    const images = arrayFromMaybe(sample?.pcDetail?.images)
    cases.push({
      itemId: sample?.itemId || '',
      merchantCode: sample?.merchantCode || '',
      title: sample?.title || '',
      status: 'out_of_rule',
      detailKind: sample?.detailKind || '',
      mode,
      reason: sample?.replacementPlan?.reason || sample?.error || '',
      modulePattern: sample?.pcDetail?.modulePattern || '',
      imageCount: Number(sample?.pcDetail?.imageCount || images.length || 0),
      bottomAnchor: sample?.anchors?.bottom?.kind || '(missing)',
      ocrStatus: sample?.ocr?.anchors?.ocrStatus || sample?.anchors?.ocrStatus || 'not_run',
      ocrStopAnchorKind: sample?.ocr?.anchors?.stopAnchorKind || '',
      ocrMatchedText: sample?.ocr?.anchors?.matchedText || '',
      ocrFixedTopText: sample?.ocr?.anchors?.fixedTopText || '',
      screenshot: sample?.caseAssets?.screenshot || '',
      imageUrls: images.slice(0, 12).map(image => image.src).filter(Boolean),
    })
    if (limit > 0 && cases.length >= limit) break
  }
  return cases
}

function scenarioMarkdown(summary, options = {}) {
  const lines = []
  lines.push('# 天猫包装详情结构探查场景统计')
  lines.push('')
  lines.push(`- 生成时间：${summary.generatedAt}`)
  lines.push(`- 样本数：${summary.sampleCount}`)
  lines.push(`- 正常解析：${summary.okCount}`)
  lines.push(`- 出现「返回旧版图文描述」：${summary.hasReturnOldCount}`)
  lines.push(`- modularDesc：${summary.modularDescCount}`)
  lines.push(`- tmDescription 旧描述：${summary.tmDescriptionCount}`)
  lines.push(`- 空 PC 详情：${summary.emptyPcDetailCount}`)
  if (options.outDir) lines.push(`- 输出目录：${options.outDir}`)
  lines.push('')
  lines.push('## 替换规则')
  lines.push('')
  lines.push('- 顶部：仅当第 1 张图命中「童装销售额 / 全亚洲 / 亚洲第一」文本、已知 URL 或视觉相似度时保留；没有命中就从第 1 张开始替换。')
  lines.push('- 底部优先级：先找「想要的信息看这里」；找不到再找「不同材质这样洗 / 不同材质 / 洗涤」；再找视觉白底黑字图；最后才使用尺码/吊牌/品牌故事等旧的下半区锚点。')
  lines.push('- 单个旧描述大模块如果没有文本或视觉锚点，默认只输出预检，不自动改页面。')
  lines.push('')
  lines.push('## 替换模式分布')
  lines.push('')
  for (const entry of summary.topReplacementModes) {
    lines.push(`- ${entry.key}: ${entry.count}`)
  }
  lines.push('')
  lines.push('## 底部锚点分布')
  lines.push('')
  for (const entry of topEntries(summary.countsByBottomAnchor, 20)) {
    lines.push(`- ${entry.key}: ${entry.count}`)
  }
  lines.push('')
  lines.push('## 高频模块结构')
  lines.push('')
  for (const entry of summary.topModulePatterns.slice(0, 30)) {
    lines.push(`- ${entry.key}: ${entry.count}`)
  }
  lines.push('')
  lines.push('## 需要人工定夺的场景')
  lines.push('')
  if (!summary.unhandled.length) {
    lines.push('- 暂无')
  } else {
    for (const item of summary.unhandled.slice(0, 120)) {
      lines.push(`- ${item.itemId || '(no itemId)'} / ${item.merchantCode || '(no code)'}: ${item.mode}；${item.reason}；${item.modulePattern || '无模块'}；图片 ${item.imageCount}`)
    }
  }
  lines.push('')
  lines.push('## OCR/相似度说明')
  lines.push('')
  lines.push('- 当前工具可记录 OCR/相似度分类字段；默认长跑优先低频读取结构化数据和文本锚点，避免对 1 万+ 商品额外拉取大量图片。')
  lines.push('- 如需启用图片视觉兜底，可加 `--visual-mode canvas --visual-max-images 80`，工具会在 CDP 页面里下载缩略图并计算白底黑字图特征；OCR 引擎未配置时会显式标记 `ocrStatus=not_configured`。')
  return `${lines.join('\n')}\n`
}

function parseArgs(argv) {
  const options = {
    cdp: DEFAULT_CDP,
    pageId: '',
    limit: DEFAULT_LIMIT,
    pageSize: DEFAULT_PAGE_SIZE,
    outDir: DEFAULT_OUT_DIR,
    delayMs: DEFAULT_DELAY_MS,
    jitterMs: DEFAULT_JITTER_MS,
    listDelayMs: DEFAULT_LIST_DELAY_MS,
    cooldownEvery: DEFAULT_COOLDOWN_EVERY,
    cooldownMs: DEFAULT_COOLDOWN_MS,
    artifactEvery: DEFAULT_ARTIFACT_EVERY,
    concurrency: DEFAULT_CONCURRENCY,
    startPage: 1,
    resume: true,
    visualMode: 'none',
    visualScope: 'blocked',
    visualMaxImages: 0,
    ocrMode: 'none',
    ocrScope: 'blocked',
    ocrMaxImages: 24,
    ocrAssetBaseUrl: 'http://127.0.0.1:18765',
    timeoutMs: 45000,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--cdp') options.cdp = next, index += 1
    else if (arg === '--page-id') options.pageId = next, index += 1
    else if (arg === '--limit') options.limit = Number(next), index += 1
    else if (arg === '--page-size') options.pageSize = Number(next), index += 1
    else if (arg === '--out') options.outDir = next, index += 1
    else if (arg === '--delay-ms') options.delayMs = Number(next), index += 1
    else if (arg === '--jitter-ms') options.jitterMs = Number(next), index += 1
    else if (arg === '--list-delay-ms') options.listDelayMs = Number(next), index += 1
    else if (arg === '--cooldown-every') options.cooldownEvery = Number(next), index += 1
    else if (arg === '--cooldown-ms') options.cooldownMs = Number(next), index += 1
    else if (arg === '--artifact-every') options.artifactEvery = Number(next), index += 1
    else if (arg === '--concurrency') options.concurrency = Number(next), index += 1
    else if (arg === '--start-page') options.startPage = Number(next), index += 1
    else if (arg === '--visual-mode') options.visualMode = next, index += 1
    else if (arg === '--visual-scope') options.visualScope = next, index += 1
    else if (arg === '--visual-max-images') options.visualMaxImages = Number(next), index += 1
    else if (arg === '--ocr-mode') options.ocrMode = next, index += 1
    else if (arg === '--ocr-scope') options.ocrScope = next, index += 1
    else if (arg === '--ocr-max-images') options.ocrMaxImages = Number(next), index += 1
    else if (arg === '--ocr-asset-base-url') options.ocrAssetBaseUrl = next, index += 1
    else if (arg === '--timeout-ms') options.timeoutMs = Number(next), index += 1
    else if (arg === '--no-resume') options.resume = false
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`未知参数：${arg}`)
  }
  return options
}

function helpText() {
  return [
    'Usage: node adapters/tmall-ops-assistant/tools/probe_tmall_packaging_structure.mjs [options]',
    '',
    'Options:',
    `  --cdp URL                 CDP endpoint, default ${DEFAULT_CDP}`,
    '  --page-id ID              Use a specific CDP page id',
    `  --limit N                 Item probe limit, default ${DEFAULT_LIMIT}`,
    `  --page-size N             MTop on_sale page size, default ${DEFAULT_PAGE_SIZE}`,
    `  --out DIR                 Output dir, default ${DEFAULT_OUT_DIR}`,
    `  --delay-ms N              Delay between publish fetches, default ${DEFAULT_DELAY_MS}`,
    `  --jitter-ms N             Random jitter added to item delay, default ${DEFAULT_JITTER_MS}`,
    `  --list-delay-ms N         Delay between list pages, default ${DEFAULT_LIST_DELAY_MS}`,
    `  --cooldown-every N        Cooldown every N items, default ${DEFAULT_COOLDOWN_EVERY}`,
    `  --cooldown-ms N           Cooldown duration, default ${DEFAULT_COOLDOWN_MS}`,
    `  --artifact-every N         Refresh samples.json/summary/scenarios every N processed items, default ${DEFAULT_ARTIFACT_EVERY}`,
    `  --concurrency N            Concurrent item probes within each list page, default ${DEFAULT_CONCURRENCY}`,
    '  --visual-mode none|canvas Optional browser-canvas image feature pass',
    '  --visual-scope blocked|all Only scan blocked samples by default',
    '  --visual-max-images N     Max images per item for canvas features',
    '  --ocr-mode none|tesseract Optional Tesseract OCR anchor pass',
    '  --ocr-scope blocked|all   OCR blocked samples by default',
    '  --ocr-max-images N        Max images per item for OCR, default 24',
    '  --ocr-asset-base-url URL  Local adapter asset base for Tesseract, default http://127.0.0.1:18765',
    '  --no-resume               Ignore existing samples.jsonl',
  ].join('\n')
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0))))
}

function jitter(ms) {
  const max = Math.max(0, Number(ms || 0))
  return max ? Math.floor(Math.random() * max) : 0
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function readExistingSamples(jsonlPath) {
  if (!fs.existsSync(jsonlPath)) return []
  const rows = []
  const lines = fs.readFileSync(jsonlPath, 'utf8').split(/\n+/g).filter(Boolean)
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line))
    } catch (error) {}
  }
  return rows
}

function appendJsonLine(file, value) {
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`)
}

function writeArtifacts(outDir, samples) {
  const summary = summarizeSamples(samples)
  fs.writeFileSync(path.join(outDir, 'samples.json'), `${JSON.stringify(samples, null, 2)}\n`)
  fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  fs.writeFileSync(path.join(outDir, 'scenarios.md'), scenarioMarkdown(summary, { outDir }))
  return summary
}

export class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl
    this.ws = null
    this.nextId = 0
    this.pending = new Map()
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl)
    this.ws.addEventListener('message', event => {
      const payload = JSON.parse(String(event.data || '{}'))
      if (!payload.id || !this.pending.has(payload.id)) return
      const entry = this.pending.get(payload.id)
      this.pending.delete(payload.id)
      if (payload.error) entry.reject(new Error(JSON.stringify(payload.error)))
      else entry.resolve(payload.result)
    })
    this.ws.addEventListener('close', () => {
      for (const entry of this.pending.values()) entry.reject(new Error('CDP WebSocket closed'))
      this.pending.clear()
    })
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`连接 CDP 超时：${this.wsUrl}`)), 15000)
      this.ws.addEventListener('open', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
      this.ws.addEventListener('error', error => {
        clearTimeout(timer)
        reject(error)
      }, { once: true })
    })
  }

  close() {
    try {
      this.ws?.close()
    } catch (error) {}
  }

  send(method, params = {}, timeoutMs = 30000) {
    const id = ++this.nextId
    const message = { id, method, params }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return
        this.pending.delete(id)
        reject(new Error(`CDP ${method} 超时 ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: value => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: error => {
          clearTimeout(timer)
          reject(error)
        },
      })
      this.ws.send(JSON.stringify(message))
    })
  }

  async evaluate(expression, timeoutMs = 30000) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    }, timeoutMs)
    if (result.exceptionDetails) {
      const text = result.exceptionDetails.text || result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails)
      throw new Error(text)
    }
    return result.result?.value
  }
}

export async function resolveCdpPage(options) {
  const base = String(options.cdp || DEFAULT_CDP).replace(/\/+$/, '')
  const pages = await fetch(`${base}/json`).then(response => response.json())
  const candidates = Array.isArray(pages) ? pages : []
  const page = options.pageId
    ? candidates.find(item => item.id === options.pageId)
    : candidates.find(item => /sell\.publish\.tmall\.com|myseller\.taobao\.com|seller\.taobao\.com|tmall\.com/i.test(String(item.url || '')))
  if (!page) {
    throw new Error(`未找到可用 CDP 页面；请确认 9222 浏览器已登录天猫后台。当前页面：${candidates.map(item => item.url).slice(0, 8).join(' | ')}`)
  }
  return page
}

export function browserInstallExpression() {
  return `(() => {
    function extractWindowJsonSource(html) {
      const text = String(html || '')
      const keyIndex = text.indexOf('window.Json')
      if (keyIndex < 0) throw new Error('no window.Json')
      const assignIndex = text.indexOf('=', keyIndex)
      const open = text.indexOf('{', assignIndex)
      if (open < 0) throw new Error('no object after window.Json')
      let depth = 0, inString = false, escaped = false, quote = ''
      for (let index = open; index < text.length; index += 1) {
        const char = text[index]
        if (inString) {
          if (escaped) escaped = false
          else if (char === '\\\\') escaped = true
          else if (char === quote) inString = false
          continue
        }
        if (char === '"' || char === "'") { inString = true; quote = char; continue }
        if (char === '{') depth += 1
        else if (char === '}') {
          depth -= 1
          if (depth === 0) return text.slice(open, index + 1)
        }
      }
      throw new Error('unclosed window.Json')
    }
    function unwrapMtopPayload(payload) {
      if (payload && typeof payload === 'object' && payload.data !== undefined) return payload.data
      return payload
    }
    window.__crawshrimpTmallProbeListOnSale = async args => {
      const client = window.lib?.mtop || window.mtop
      if (!client || typeof client.request !== 'function') throw new Error('missing mtop client')
      const current = Number(args.current || 1)
      const pageSize = Number(args.pageSize || 20)
      const payload = await client.request({
        api: 'mtop.tmall.sell.pc.manage.async',
        v: '1.0',
        type: 'POST',
        dataType: 'json',
        H5Request: true,
        preventFallback: true,
        data: {
          url: '/tmall/manager/table.htm',
          jsonBody: JSON.stringify({
            tab: 'on_sale',
            pagination: { current, pageSize },
            filtertab: '',
            filter: {},
            table: {},
          }),
        },
      })
      return unwrapMtopPayload(payload)
    }
    window.__crawshrimpTmallProbeFetchModel = async args => {
      const itemId = String(args.itemId || '').trim()
      if (!itemId) throw new Error('empty itemId')
      const url = 'https://sell.publish.tmall.com/tmall/publish.htm?id=' + encodeURIComponent(itemId)
      const response = await fetch(url, { credentials: 'include' })
      const html = await response.text()
      const model = JSON.parse(extractWindowJsonSource(html))
      return {
        ok: response.ok,
        status: response.status,
        url: response.url,
        htmlLength: html.length,
        hasReturnOld: html.includes('返回旧版图文描述'),
        model,
      }
    }
    function normalizeProbeImageUrl(value) {
      const text = String(value || '').trim()
      return text.startsWith('//') ? 'https:' + text : text
    }
    function probeThumbUrl(value) {
      const url = normalizeProbeImageUrl(value)
      if (!/alicdn\\.com/i.test(url)) return url
      if (/[._](?:jpg|jpeg|png|webp)(?:\\?.*)?$/i.test(url)) return url.replace(/(\\.(?:jpg|jpeg|png|webp))(\\?.*)?$/i, '$1_160x160.jpg$2')
      return url + '_160x160.jpg'
    }
    function averageHash(luminanceValues) {
      const avg = luminanceValues.reduce((sum, value) => sum + value, 0) / Math.max(1, luminanceValues.length)
      let bits = ''
      for (const value of luminanceValues) bits += value >= avg ? '1' : '0'
      let hex = ''
      for (let index = 0; index < bits.length; index += 4) {
        hex += parseInt(bits.slice(index, index + 4).padEnd(4, '0'), 2).toString(16)
      }
      return hex
    }
    function largestBlackComponentRatio(blackMask, width, height) {
      const seen = new Uint8Array(width * height)
      let largest = 0
      const queue = []
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const start = y * width + x
          if (!blackMask[start] || seen[start]) continue
          let size = 0
          queue.length = 0
          queue.push(start)
          seen[start] = 1
          while (queue.length) {
            const current = queue.pop()
            size += 1
            const cx = current % width
            const cy = Math.floor(current / width)
            const neighbors = [
              cy > 0 ? current - width : -1,
              cy < height - 1 ? current + width : -1,
              cx > 0 ? current - 1 : -1,
              cx < width - 1 ? current + 1 : -1,
            ]
            for (const next of neighbors) {
              if (next < 0 || !blackMask[next] || seen[next]) continue
              seen[next] = 1
              queue.push(next)
            }
          }
          if (size > largest) largest = size
        }
      }
      return largest / Math.max(1, width * height)
    }
    async function featureForImage(entry, timeoutMs) {
      const index = Number(entry.index)
      const url = normalizeProbeImageUrl(entry.url)
      const thumbUrl = probeThumbUrl(url)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), Math.max(500, Number(timeoutMs || 6000)))
      try {
        const response = await fetch(thumbUrl, { credentials: 'omit', signal: controller.signal })
        const blob = await response.blob()
        const bitmap = await createImageBitmap(blob)
        const canvas = document.createElement('canvas')
        canvas.width = 32
        canvas.height = 32
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(bitmap, 0, 0, 32, 32)
        const data = ctx.getImageData(0, 0, 32, 32).data
        let white = 0, black = 0, saturation = 0, luminanceSum = 0
        const blackMask = new Uint8Array(32 * 32)
        const luminanceValues = []
        for (let offset = 0; offset < data.length; offset += 4) {
          const r = data[offset], g = data[offset + 1], b = data[offset + 2]
          const max = Math.max(r, g, b)
          const min = Math.min(r, g, b)
          const lum = 0.299 * r + 0.587 * g + 0.114 * b
          if (r >= 235 && g >= 235 && b >= 235) white += 1
          if (r <= 65 && g <= 65 && b <= 65) {
            black += 1
            blackMask[offset / 4] = 1
          }
          saturation += max === 0 ? 0 : (max - min) / max
          luminanceSum += lum
          if (luminanceValues.length < 64 && offset % 64 === 0) luminanceValues.push(lum)
        }
        const pixels = data.length / 4
        return {
          index,
          url,
          thumbUrl,
          ok: true,
          width: bitmap.width,
          height: bitmap.height,
          whiteRatio: white / pixels,
          blackRatio: black / pixels,
          saturationAvg: saturation / pixels,
          brightnessAvg: luminanceSum / pixels,
          largestBlackComponentRatio: largestBlackComponentRatio(blackMask, 32, 32),
          ahash: averageHash(luminanceValues),
        }
      } catch (error) {
        return { index, url, thumbUrl, ok: false, error: String(error?.message || error) }
      } finally {
        clearTimeout(timer)
      }
    }
    window.__crawshrimpTmallProbeImageFeatures = async args => {
      const entries = Array.isArray(args.entries) ? args.entries : []
      const timeoutMs = Number(args.timeoutMs || 6000)
      const result = []
      for (const entry of entries) {
        result.push(await featureForImage(entry, timeoutMs))
      }
      return result
    }
    function probeWithTimeout(promise, timeoutMs, label) {
      let timer = null
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error((label || 'operation') + ' timeout ' + timeoutMs + 'ms')), Math.max(500, Number(timeoutMs || 30000)))
      })
      return Promise.race([promise, timeout]).finally(() => {
        if (timer) clearTimeout(timer)
      })
    }
    function probeOcrConfig(args) {
      const base = String(args.assetBaseUrl || 'http://127.0.0.1:18765').replace(/\\/+$/, '')
      const vendor = base + '/adapter-assets/tmall-ops-assistant/vendor/tesseract'
      return {
        scriptUrl: String(args.scriptUrl || vendor + '/tesseract.min.js'),
        workerPath: String(args.workerPath || vendor + '/worker.min.js'),
          corePath: String(args.corePath || vendor),
          langPath: String(args.langPath || vendor + '/lang'),
          lang: String(args.lang || 'chi_sim+eng'),
          perImageTimeoutMs: Number(args.perImageTimeoutMs || 18000),
          totalTimeoutMs: Number(args.totalTimeoutMs || 120000),
        }
      }
      async function probeLoadScriptTag(url) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script')
          script.src = url
          script.async = true
          script.onload = resolve
          script.onerror = () => reject(new Error('load script failed: ' + url))
          ;(document.head || document.documentElement || document.body).appendChild(script)
        })
      }
      async function probeLoadTesseract(config) {
        if (window.Tesseract) return window.Tesseract
        if (window.__CRAWSHRIMP_PROBE_TESSERACT_LOADING__) return window.__CRAWSHRIMP_PROBE_TESSERACT_LOADING__
        window.__CRAWSHRIMP_PROBE_TESSERACT_LOADING__ = (async () => {
          try {
            await probeLoadScriptTag(config.scriptUrl)
          } catch (scriptError) {
            const response = await fetch(config.scriptUrl, { credentials: 'omit' })
            if (!response.ok) throw scriptError
            const code = await response.text()
            ;(0, eval)(code + '\\n//# sourceURL=' + config.scriptUrl)
          }
          if (!window.Tesseract) throw new Error('Tesseract.js loaded without window.Tesseract')
          return window.Tesseract
        })()
        try {
          return await window.__CRAWSHRIMP_PROBE_TESSERACT_LOADING__
        } finally {
          window.__CRAWSHRIMP_PROBE_TESSERACT_LOADING__ = null
        }
      }
      async function probeCreateTesseractWorker(Tesseract, config) {
        const engineOptions = {
          workerPath: config.workerPath,
          corePath: config.corePath,
          langPath: config.langPath,
          logger: () => {},
        }
        if (!Tesseract?.createWorker) return null
        let firstError = null
        try {
          const worker = await Tesseract.createWorker(config.lang, 1, engineOptions)
          if (worker?.recognize) return worker
        } catch (error) {
          firstError = error
        }
        try {
          const worker = await Tesseract.createWorker(engineOptions)
          if (worker?.loadLanguage) await worker.loadLanguage(config.lang)
          if (worker?.initialize) await worker.initialize(config.lang)
          if (worker?.recognize) return worker
        } catch (error) {
          if (firstError) throw firstError
          throw error
        }
        return null
      }
      async function probeImageSourceForOcr(src) {
        const url = normalizeProbeImageUrl(src)
        if (!url || typeof URL === 'undefined' || !URL.createObjectURL) return { source: url, cleanup: () => {} }
        try {
          const response = await fetch(url, { credentials: 'omit' })
          if (!response.ok) throw new Error('HTTP ' + response.status)
          const blob = await response.blob()
          const objectUrl = URL.createObjectURL(blob)
          return {
            source: objectUrl,
            cleanup: () => {
              try { URL.revokeObjectURL(objectUrl) } catch (error) {}
            },
          }
        } catch (error) {
          return { source: url, cleanup: () => {} }
        }
      }
      async function probeRecognizeImage(Tesseract, worker, entry, config) {
        const prepared = await probeImageSourceForOcr(entry.url)
        try {
          if (!prepared.source) throw new Error('empty image URL')
          const run = worker?.recognize
            ? worker.recognize(prepared.source)
            : Tesseract.recognize(prepared.source, config.lang, {
              workerPath: config.workerPath,
              corePath: config.corePath,
              langPath: config.langPath,
              logger: () => {},
            })
          const result = await probeWithTimeout(run, config.perImageTimeoutMs, 'OCR image ' + (Number(entry.index) + 1))
          return {
            globalIndex: Number(entry.index),
            imageIndex: Number(entry.imageIndex ?? entry.index),
            src: normalizeProbeImageUrl(entry.url),
            text: String(result?.data?.text || result?.text || '').replace(/\\s+/g, ' ').trim(),
            confidence: Number(result?.data?.confidence ?? result?.confidence ?? 0) || 0,
          }
        } finally {
          prepared.cleanup()
        }
      }
      window.__crawshrimpTmallProbeOcrImages = async args => {
        const entries = (Array.isArray(args.entries) ? args.entries : []).filter(entry => entry?.url)
        const config = probeOcrConfig(args || {})
        return probeWithTimeout((async () => {
          const Tesseract = await probeLoadTesseract(config)
          let worker = null
          const results = []
          try {
            worker = await probeCreateTesseractWorker(Tesseract, config)
            for (const entry of entries) {
              try {
                results.push(await probeRecognizeImage(Tesseract, worker, entry, config))
              } catch (error) {
                results.push({
                  globalIndex: Number(entry.index),
                  imageIndex: Number(entry.imageIndex ?? entry.index),
                  src: normalizeProbeImageUrl(entry.url),
                  text: '',
                  confidence: 0,
                  error: String(error?.message || error),
                })
              }
            }
          } finally {
            try { await worker?.terminate?.() } catch (error) {}
          }
          return { ok: true, engine: 'tesseract.js', lang: config.lang, scanned: results.length, results }
        })(), config.totalTimeoutMs, 'Tesseract OCR')
      }
      function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
        const words = String(text || '').split(/\\s+/g).filter(Boolean)
        let line = ''
        let used = 0
        for (const word of words) {
          const test = line ? line + ' ' + word : word
          if (ctx.measureText(test).width > maxWidth && line) {
            ctx.fillText(line, x, y)
            y += lineHeight
            used += 1
            line = word
            if (used >= maxLines) return
          } else {
            line = test
          }
        }
        if (line && used < maxLines) ctx.fillText(line, x, y)
      }
      window.__crawshrimpTmallProbeCaseSheet = async args => {
        const entries = (Array.isArray(args.entries) ? args.entries : []).filter(entry => entry?.url).slice(0, Number(args.maxImages || 12))
        const ocrByIndex = new Map((Array.isArray(args.ocrResults) ? args.ocrResults : []).map(result => [Number(result.globalIndex ?? result.index), result]))
        const cardWidth = 220
        const cardHeight = 306
        const gap = 14
        const columns = Math.max(1, Math.min(4, Number(args.columns || 4)))
        const rows = Math.max(1, Math.ceil(entries.length / columns))
        const headerHeight = 72
        const canvas = document.createElement('canvas')
        canvas.width = columns * cardWidth + (columns + 1) * gap
        canvas.height = headerHeight + rows * cardHeight + (rows + 1) * gap
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#f7f7f2'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.fillStyle = '#111827'
        ctx.font = 'bold 24px sans-serif'
        ctx.fillText(String(args.title || 'Tmall packaging case'), gap, 32)
        ctx.font = '14px sans-serif'
        ctx.fillStyle = '#4b5563'
        ctx.fillText(String(args.subtitle || ''), gap, 56)
        for (let index = 0; index < entries.length; index += 1) {
          const entry = entries[index]
          const col = index % columns
          const row = Math.floor(index / columns)
          const x = gap + col * (cardWidth + gap)
          const y = headerHeight + gap + row * (cardHeight + gap)
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(x, y, cardWidth, cardHeight)
          ctx.strokeStyle = '#d1d5db'
          ctx.strokeRect(x, y, cardWidth, cardHeight)
          try {
            const response = await fetch(probeThumbUrl(entry.url), { credentials: 'omit' })
            const blob = await response.blob()
            const bitmap = await createImageBitmap(blob)
            const boxW = cardWidth - 20
            const boxH = 198
            const ratio = Math.min(boxW / bitmap.width, boxH / bitmap.height)
            const drawW = Math.max(1, bitmap.width * ratio)
            const drawH = Math.max(1, bitmap.height * ratio)
            ctx.drawImage(bitmap, x + 10 + (boxW - drawW) / 2, y + 34 + (boxH - drawH) / 2, drawW, drawH)
          } catch (error) {
            ctx.fillStyle = '#fee2e2'
            ctx.fillRect(x + 10, y + 34, cardWidth - 20, 198)
            ctx.fillStyle = '#991b1b'
            ctx.font = '12px sans-serif'
            ctx.fillText('image failed', x + 18, y + 60)
          }
          ctx.fillStyle = '#111827'
          ctx.font = 'bold 13px sans-serif'
          ctx.fillText('#' + String(entry.index), x + 10, y + 22)
          const ocr = ocrByIndex.get(Number(entry.index))
          ctx.font = '12px sans-serif'
          ctx.fillStyle = '#374151'
          drawWrappedText(ctx, ocr?.text || '', x + 10, y + 252, cardWidth - 20, 16, 3)
        }
        return { ok: true, dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
      }
      return true
    })()`
}

function extractMerchantCodeFromItem(item) {
  const direct = cleanText(item?.outerId || item?.outer_id || item?.outerID || item?.merchantCode || item?.sellerCode || item?.skuOuterId || '')
  if (direct) return direct
  const desc = arrayFromMaybe(item?.itemDesc?.desc)
  const text = desc.map(entry => cleanText(entry?.copyText || entry?.text)).join(' ')
  const match = text.match(/(?:编码|商家编码|outerId)[:：]\s*([A-Za-z0-9._-]+)/i)
  return match ? cleanText(match[1]) : ''
}

function normalizeSellManageItem(item) {
  const desc = arrayFromMaybe(item?.itemDesc?.desc)
  const descText = desc.map(entry => cleanText(entry?.copyText || entry?.text)).join(' ')
  const itemId = cleanText(item?.itemId || item?.id || item?.item_id || descText.match(/\d{8,}/)?.[0] || '')
  const titleEntry = desc.find(entry => cleanText(entry?.copyText || entry?.text) && !/^ID[:：]/i.test(cleanText(entry?.text)) && !/编码[:：]/.test(cleanText(entry?.text)))
  const title = cleanText(item?.title || item?.itemTitle || item?.name || titleEntry?.copyText || titleEntry?.text)
  const picUrl = normalizeRemoteUrl(item?.picUrl || item?.image || item?.itemPic || item?.itemDesc?.img || '')
  return {
    ...item,
    itemId,
    id: itemId,
    title,
    itemTitle: title,
    picUrl,
    merchantCode: extractMerchantCodeFromItem(item),
  }
}

export function extractSellManageItems(data) {
  const raw = data?.result || data?.model || data
  const parsed = safeParseJson(raw, raw)
  const payload = parsed?.data || parsed?.result || parsed
  const table = payload?.table || payload?.data?.table || {}
  const list = table.dataSource || table.list || payload?.dataSource || payload?.list || payload?.items || []
  return arrayFromMaybe(list).map(normalizeSellManageItem).filter(item => item.itemId)
}

function extractPagination(data) {
  const raw = data?.result || data?.model || data
  const parsed = safeParseJson(raw, raw)
  const payload = parsed?.data || parsed?.result || parsed
  const table = payload?.table || payload?.data?.table || {}
  const pagination = table.pagination || payload?.pagination || payload?.data?.pagination || {}
  return {
    current: Number(pagination.current || pagination.pageNo || 0),
    pageSize: Number(pagination.pageSize || 0),
    total: Number(pagination.total || pagination.totalCount || payload?.total || 0),
  }
}

async function probeItem(cdp, item, options) {
  const fetched = await cdp.evaluate(`window.__crawshrimpTmallProbeFetchModel(${JSON.stringify({ itemId: item.itemId })})`, options.timeoutMs)
  let sample = analyzePublishModel({
    itemId: item.itemId,
    item,
    html: fetched.hasReturnOld ? '返回旧版图文描述' : '',
    model: fetched.model,
  })
  const needsVisualScan = options.visualScope === 'all' || !HANDLED_MODES.has(sample.replacementPlan?.mode)
  if (options.visualMode === 'canvas' && needsVisualScan && Number(options.visualMaxImages || 0) > 0 && sample.pcDetail?.images?.length) {
    const entries = sample.pcDetail.images
      .slice(0, Math.max(0, Number(options.visualMaxImages || 0)))
      .filter(image => image.src)
      .map(image => ({ index: image.globalIndex, url: image.src }))
    if (entries.length) {
      const features = await cdp.evaluate(`window.__crawshrimpTmallProbeImageFeatures(${JSON.stringify({ entries, timeoutMs: Math.min(8000, options.timeoutMs || 8000) })})`, options.timeoutMs)
      const visualAnchors = visualAnchorsFromImageFeatures(sample, features)
      if (visualAnchors.stopImageIndex !== undefined) {
        sample = analyzePublishModel({
          itemId: item.itemId,
          item,
          html: fetched.hasReturnOld ? '返回旧版图文描述' : '',
          model: fetched.model,
          visualAnchors,
        })
      }
      sample.visual = {
        mode: 'canvas',
        scannedImageCount: entries.length,
        anchors: visualAnchors,
        features: arrayFromMaybe(features).slice(0, 120),
        featureListTruncated: arrayFromMaybe(features).length > 120,
      }
    }
  }
  const needsOcrScan = options.ocrScope === 'all' || !HANDLED_MODES.has(sample.replacementPlan?.mode)
  if (options.ocrMode === 'tesseract' && needsOcrScan && Number(options.ocrMaxImages || 0) > 0 && sample.pcDetail?.images?.length) {
    const entries = sample.pcDetail.images
      .slice(0, Math.max(0, Number(options.ocrMaxImages || 0)))
      .filter(image => image.src)
      .map(image => ({ index: image.globalIndex, imageIndex: image.imageIndex, url: image.src }))
    if (entries.length) {
      try {
        const ocr = await cdp.evaluate(`window.__crawshrimpTmallProbeOcrImages(${JSON.stringify({
          entries,
          assetBaseUrl: options.ocrAssetBaseUrl,
          totalTimeoutMs: options.timeoutMs,
        })})`, options.timeoutMs)
        const ocrResults = arrayFromMaybe(ocr?.results)
        const ocrAnchors = buildOcrAnchorsFromResults(sample, ocrResults, { source: 'tesseract_ocr' })
        if (ocrAnchors.stopImageIndex !== undefined) {
          sample = analyzePublishModel({
            itemId: item.itemId,
            item,
            html: fetched.hasReturnOld ? '返回旧版图文描述' : '',
            model: fetched.model,
            visualAnchors: ocrAnchors,
          })
        }
        sample.ocr = {
          ok: !!ocr?.ok,
          engine: ocr?.engine || 'tesseract.js',
          lang: ocr?.lang || '',
          scanned: Number(ocr?.scanned || ocrResults.length),
          results: ocrResults,
          anchors: ocrAnchors,
        }
      } catch (error) {
        sample.ocr = {
          ok: false,
          error: cleanText(error?.message || error),
          anchors: { ocrStatus: 'failed', source: 'tesseract_ocr' },
        }
      }
    }
  }
  sample.fetch = {
    status: fetched.status,
    htmlLength: fetched.htmlLength,
    url: fetched.url,
    fetchedAt: new Date().toISOString(),
  }
  return sample
}

async function runProbe(options) {
  ensureDir(options.outDir)
  const jsonlPath = path.join(options.outDir, 'samples.jsonl')
  const samples = options.resume ? readExistingSamples(jsonlPath) : []
  const seen = new Set(samples.map(sample => cleanText(sample.itemId)).filter(Boolean))
  if (!options.resume && fs.existsSync(jsonlPath)) fs.rmSync(jsonlPath)

  const page = await resolveCdpPage(options)
  const cdp = new CdpClient(page.webSocketDebuggerUrl)
  await cdp.connect()
  try {
    await cdp.evaluate(browserInstallExpression(), options.timeoutMs)
    console.log(`[probe] CDP page: ${page.id} ${page.url}`)
    console.log(`[probe] out: ${options.outDir}`)
    console.log(`[probe] resume samples: ${samples.length}`)

    let currentPage = Math.max(1, Number(options.startPage || 1))
    let processedThisRun = 0
    let listedTotal = 0
    let lastPaginationTotal = 0

    while (samples.length < options.limit) {
      const listData = await cdp.evaluate(`window.__crawshrimpTmallProbeListOnSale(${JSON.stringify({ current: currentPage, pageSize: options.pageSize })})`, options.timeoutMs)
      const items = extractSellManageItems(listData)
      const pagination = extractPagination(listData)
      if (pagination.total) lastPaginationTotal = pagination.total
      listedTotal += items.length
      console.log(`[probe] list page=${currentPage} items=${items.length} total=${lastPaginationTotal || 'unknown'} samples=${samples.length}`)
      if (!items.length) break

      const probeListItem = async item => {
        if (samples.length >= options.limit) return
        const itemId = cleanText(item.itemId)
        if (!itemId || seen.has(itemId)) return
        seen.add(itemId)
        let sample
        try {
          sample = await probeItem(cdp, item, options)
        } catch (error) {
          sample = {
            itemId: item.itemId,
            merchantCode: item.merchantCode || '',
            title: item.title || '',
            ok: false,
            error: cleanText(error?.message || error),
            detailKind: 'fetch_failed',
            hasReturnOld: false,
            pcDetail: { modulePattern: '', imageCount: 0 },
            anchors: { top: emptyAnchor(), bottom: emptyAnchor(), ocrStatus: 'not_configured' },
            replacementPlan: { mode: 'fetch_failed', reason: cleanText(error?.message || error) },
            fetch: { fetchedAt: new Date().toISOString() },
          }
        }
        samples.push(sample)
        appendJsonLine(jsonlPath, sample)
        processedThisRun += 1
        if (processedThisRun % 10 === 0) {
          console.log(`[probe] processed=${processedThisRun} totalSamples=${samples.length} last=${sample.itemId} mode=${sample.replacementPlan?.mode}`)
        }
        if (options.artifactEvery > 0 && processedThisRun % options.artifactEvery === 0) {
          writeArtifacts(options.outDir, samples)
        }
        if (options.cooldownEvery > 0 && processedThisRun > 0 && processedThisRun % options.cooldownEvery === 0) {
          console.log(`[probe] cooldown ${options.cooldownMs}ms after ${processedThisRun} items`)
          await sleep(options.cooldownMs)
        } else {
          await sleep(Number(options.delayMs || 0) + jitter(options.jitterMs))
        }
      }

      const concurrency = Math.max(1, Math.floor(Number(options.concurrency || 1)))
      if (concurrency === 1) {
        for (const item of items) {
          if (samples.length >= options.limit) break
          await probeListItem(item)
        }
      } else {
        let cursor = 0
        const workerCount = Math.min(concurrency, items.length)
        const workers = Array.from({ length: workerCount }, async () => {
          while (cursor < items.length && samples.length < options.limit) {
            const item = items[cursor]
            cursor += 1
            await probeListItem(item)
          }
        })
        await Promise.all(workers)
      }

      currentPage += 1
      await sleep(options.listDelayMs)
      if (lastPaginationTotal && listedTotal >= lastPaginationTotal) break
    }

    const summary = writeArtifacts(options.outDir, samples)
    console.log(`[probe] done samples=${summary.sampleCount} ok=${summary.okCount} unhandled=${summary.unhandledCount}`)
    return summary
  } finally {
    cdp.close()
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(helpText())
    return
  }
  await runProbe(options)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath && path.resolve(new URL(import.meta.url).pathname) === invokedPath) {
  main().catch(error => {
    console.error(`[probe] failed: ${error?.stack || error}`)
    process.exitCode = 1
  })
}
