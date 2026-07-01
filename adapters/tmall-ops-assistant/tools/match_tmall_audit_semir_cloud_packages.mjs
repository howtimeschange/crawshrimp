#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import {
  CdpClient,
} from './probe_tmall_packaging_structure.mjs'

const DEFAULT_AUDIT_JSONL = '/private/tmp/tmall-packaging-structure-probe-10000/full-latest-logic-audit-20260630233800/audit-results.jsonl'
const DEFAULT_OUT_ROOT = '/private/tmp/tmall-packaging-structure-probe-10000'
const DEFAULT_CDP = 'http://127.0.0.1:9222'
const NO_EXACT_PATH = '__crawshrimp_semir_cloud_match_no_exact_path__'
const CATEGORY_ORDER = ['main_1x1', 'micro_1x1', 'main_3x4', 'micro_3x4', 'vertical', 'pc_detail']
const DEFAULT_MOUNT_NAMES = [
  '巴拉巴拉品牌事业部-市场系统',
  '巴拉营运BU-商品',
]

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function compact(value) {
  return cleanText(value).replace(/\s+/g, '')
}

function arrayFromMaybe(value) {
  return Array.isArray(value) ? value : []
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function csvEscape(value) {
  const text = cleanText(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function markdownCell(value) {
  return cleanText(value).replace(/\|/g, '\\|')
}

function safeFilename(value, fallback = 'match') {
  const text = cleanText(value)
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
  return text || fallback
}

function parseArgs(argv) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '')
  const options = {
    auditJsonl: DEFAULT_AUDIT_JSONL,
    outDir: path.join(DEFAULT_OUT_ROOT, `semir-cloud-package-match-${stamp}`),
    cdp: DEFAULT_CDP,
    pageId: '',
    limit: 0,
    folderScanDepth: 6,
    resume: true,
    delayMs: 300,
    mountNames: [...DEFAULT_MOUNT_NAMES],
    mountIds: [],
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--audit-jsonl') options.auditJsonl = next, index += 1
    else if (arg === '--out') options.outDir = next, index += 1
    else if (arg === '--cdp') options.cdp = next, index += 1
    else if (arg === '--page-id') options.pageId = next, index += 1
    else if (arg === '--limit') options.limit = Number(next), index += 1
    else if (arg === '--folder-scan-depth') options.folderScanDepth = Number(next), index += 1
    else if (arg === '--delay-ms') options.delayMs = Number(next), index += 1
    else if (arg === '--mount-name') options.mountNames.push(next), index += 1
    else if (arg === '--mount-id') options.mountIds.push(next), index += 1
    else if (arg === '--all-visible-mounts') options.mountNames = [], options.mountIds = []
    else if (arg === '--no-resume') options.resume = false
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`未知参数：${arg}`)
  }
  options.mountNames = [...new Set(options.mountNames.map(cleanText).filter(Boolean))]
  options.mountIds = [...new Set(options.mountIds.map(cleanText).filter(Boolean))]
  return options
}

function helpText() {
  return [
    'Usage: node adapters/tmall-ops-assistant/tools/match_tmall_audit_semir_cloud_packages.mjs [options]',
    '',
    'Read-only matcher: take probed Tmall style codes from audit-results.jsonl, search Semir cloud, and summarize package/image path formats.',
    '',
    `  --audit-jsonl FILE        Audit jsonl, default ${DEFAULT_AUDIT_JSONL}`,
    `  --out DIR                 Output dir, default ${DEFAULT_OUT_ROOT}/semir-cloud-package-match-{timestamp}`,
    `  --cdp URL                 Chrome CDP endpoint, default ${DEFAULT_CDP}`,
    '  --page-id ID              Use a specific fmp.semirapp.com CDP page',
    '  --limit N                 Limit style codes, default 0 means all currently probed styles',
    '  --mount-name NAME         Restrict to a mount name; can be repeated',
    '  --mount-id ID             Restrict to a mount id; can be repeated',
    '  --all-visible-mounts      Search every visible mount',
    '  --folder-scan-depth N     Descendant folder depth when a package folder is found, default 6',
    '  --no-resume               Ignore existing match-results.jsonl',
  ].join('\n')
}

function readAuditStyles(file) {
  const byStyle = new Map()
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\n/g) : []
  for (const line of lines) {
    if (!line.trim()) continue
    let record
    try {
      record = JSON.parse(line)
    } catch (error) {
      continue
    }
    const styleCode = cleanText(record.merchantCode || record.styleCode)
    if (!styleCode) continue
    const entry = byStyle.get(styleCode) || {
      styleCode,
      firstSequence: Number(record.sequence || 0) || 0,
      itemIds: [],
      titles: [],
      auditRows: 0,
      replaceRanges: [],
      preserveRanges: [],
    }
    entry.auditRows += 1
    if (record.itemId && !entry.itemIds.includes(cleanText(record.itemId))) entry.itemIds.push(cleanText(record.itemId))
    if (record.title && !entry.titles.includes(cleanText(record.title))) entry.titles.push(cleanText(record.title))
    if (record.replaceRange && !entry.replaceRanges.includes(cleanText(record.replaceRange))) entry.replaceRanges.push(cleanText(record.replaceRange))
    const preserve = [record.preserveTopRange, record.preserveBottomRange].map(cleanText).filter(Boolean).join(';')
    if (preserve && !entry.preserveRanges.includes(preserve)) entry.preserveRanges.push(preserve)
    if (!entry.firstSequence || Number(record.sequence || 0) < entry.firstSequence) {
      entry.firstSequence = Number(record.sequence || 0) || entry.firstSequence
    }
    byStyle.set(styleCode, entry)
  }
  return [...byStyle.values()].sort((a, b) => {
    const sequenceDelta = Number(a.firstSequence || 0) - Number(b.firstSequence || 0)
    return sequenceDelta || a.styleCode.localeCompare(b.styleCode, 'zh-Hans-CN', { numeric: true })
  })
}

function readExistingResults(file) {
  const results = new Map()
  if (!fs.existsSync(file)) return results
  for (const line of fs.readFileSync(file, 'utf8').split(/\n/g)) {
    if (!line.trim()) continue
    try {
      const record = JSON.parse(line)
      if (record.styleCode) results.set(cleanText(record.styleCode), record)
    } catch (error) {}
  }
  return results
}

async function resolveFmpPage(options) {
  const base = String(options.cdp || DEFAULT_CDP).replace(/\/+$/, '')
  const pages = await fetch(`${base}/json`).then(response => response.json())
  const candidates = Array.isArray(pages) ? pages : []
  const page = options.pageId
    ? candidates.find(item => item.id === options.pageId)
    : candidates.find(item => item.type === 'page' && /fmp\.semirapp\.com/i.test(String(item.url || '')))
  if (!page) {
    throw new Error(`未找到森马云盘 CDP 页面；请在 9222 浏览器打开并登录 https://fmp.semirapp.com/web/index#/home/file`)
  }
  return page
}

function browserInstallExpression(scriptSource) {
  return `(async () => {
    window.__CRAWSHRIMP_PARAMS__ = {};
    window.__CRAWSHRIMP_PHASE__ = '__exports__';
    window.__CRAWSHRIMP_SHARED__ = {};
    window.__CRAWSHRIMP_EXPORTS__ = {};
    await (0, eval)(${JSON.stringify(scriptSource)});
    const helpers = window.__CRAWSHRIMP_EXPORTS__;
    const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff']);
    function cleanText(value) { return String(value ?? '').replace(/\\s+/g, ' ').trim(); }
    function getExt(itemOrFilename) {
      if (itemOrFilename && typeof itemOrFilename === 'object') {
        const explicit = String(itemOrFilename.ext || '').trim().toLowerCase();
        if (explicit) return explicit.replace(/^\\./, '');
        return getExt(itemOrFilename.filename || itemOrFilename.name || '');
      }
      const name = String(itemOrFilename || '').trim();
      const index = name.lastIndexOf('.');
      return index >= 0 ? name.slice(index + 1).trim().toLowerCase() : '';
    }
    function isImageItem(item) {
      const dir = item?.dir;
      const isDir = dir === 1 || dir === '1' || dir === true;
      return !isDir && IMAGE_EXTS.has(getExt(item));
    }
    function mountDisplayName(item) { return cleanText(item?.org_name || item?.name || item?.title); }
    function mountIdValue(item) { return String(item?.mount_id || item?.id || '').trim(); }
    async function fetchJson(url, init = {}) {
      const response = await fetch(url, { credentials: 'include', ...init });
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : {}; } catch (error) {}
      if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + (text || response.statusText).slice(0, 240));
      if (!payload) throw new Error('接口未返回 JSON: ' + url);
      return payload;
    }
    async function fetchMounts() {
      const payload = await fetchJson('/fengcloud/1/account/mount');
      const list = Array.isArray(payload)
        ? payload
        : (Array.isArray(payload?.list)
          ? payload.list
          : (Array.isArray(payload?.data?.list)
            ? payload.data.list
            : (Array.isArray(payload?.data) ? payload.data : [])));
      return list.map(item => ({
        mountId: mountIdValue(item),
        mountName: mountDisplayName(item),
        raw: item,
      })).filter(item => item.mountId && item.mountName);
    }
    function selectedCategoryCounts(plan) {
      const counts = {};
      for (const [category, rows] of Object.entries(plan?.byCategory || {})) counts[category] = Array.isArray(rows) ? rows.length : 0;
      return counts;
    }
    window.__crawshrimpSemirCloudPackageMatcher = {
      async fetchMounts() {
        return fetchMounts();
      },
      async matchStyle(args) {
        const styleCode = cleanText(args?.styleCode);
        const mounts = Array.isArray(args?.mounts) ? args.mounts : [];
        const folderScanDepth = Number(args?.folderScanDepth || 6);
        const mountResults = [];
        for (const mount of mounts) {
          try {
            const plan = await helpers.collectPackagingAssets(
              { style_code: styleCode, item_id: String(args?.itemId || ''), folder_scan_depth: folderScanDepth },
              { mountId: mount.mountId, mountName: mount.mountName, relativePath: ${JSON.stringify(NO_EXACT_PATH)}, rawPath: mount.mountName + '//' }
            );
            const items = Array.isArray(plan?.items) ? plan.items : [];
            const images = items.filter(isImageItem);
            mountResults.push({
              mountId: mount.mountId,
              mountName: mount.mountName,
              ok: true,
              totalItems: items.length,
              imageCount: images.length,
              selected: Number(plan?.selected || 0),
              totalClassified: Number(plan?.total || 0),
              missing: Array.isArray(plan?.missing) ? plan.missing : [],
              searchCount: Number(plan?.searchCount || 0),
              folderCount: Number(plan?.folderCount || 0),
              searchScope: cleanText(plan?.searchScope || ''),
              categoryCounts: selectedCategoryCounts(plan),
              selectedItems: Object.fromEntries(Object.entries(plan?.byCategory || {}).map(([category, rows]) => [
                category,
                (Array.isArray(rows) ? rows : []).map(item => ({
                  filename: cleanText(item?.filename || item?.name),
                  fullpath: cleanText(item?.fullpath || item?.path),
                  ext: cleanText(item?.ext || getExt(item)),
                })),
              ])),
              items: images.map(item => ({
                filename: cleanText(item?.filename || item?.name),
                fullpath: cleanText(item?.fullpath || item?.path),
                ext: cleanText(item?.ext || getExt(item)),
              })),
              errors: Array.isArray(plan?.errors) ? plan.errors.map(cleanText).filter(Boolean) : [],
            });
          } catch (error) {
            mountResults.push({
              mountId: mount.mountId,
              mountName: mount.mountName,
              ok: false,
              error: String(error?.message || error),
            });
          }
        }
        return { styleCode, mountResults };
      },
    };
    return true;
  })()`
}

function pickMounts(availableMounts, options) {
  if (!options.mountNames.length && !options.mountIds.length) return availableMounts
  const idSet = new Set(options.mountIds)
  const nameSet = new Set(options.mountNames)
  return availableMounts.filter(mount => idSet.has(cleanText(mount.mountId)) || nameSet.has(cleanText(mount.mountName)))
}

function pathSegments(fullpath) {
  return String(fullpath || '').replace(/\\/g, '/').split('/').map(cleanText).filter(Boolean)
}

function pathFormat(fullpath, styleCode) {
  const pathText = String(fullpath || '').replace(/\\/g, '/')
  if (!pathText) return 'empty'
  if (/\/[^/]*优化[^/]*\/[^/]+-优化\/images\//.test(pathText)) return 'optimized_detail_images'
  if (/(^|\/)2-详情(\/|$)/.test(pathText)) return '2-detail'
  if (/(^|\/)详情(\/|$)/.test(pathText)) return 'detail-folder'
  if (/\/images(\/|$)/i.test(pathText)) return 'images-folder'
  if (/主图微详情|微详情/.test(pathText)) return 'micro-detail'
  if (/(^|\/)1-主图(\/|$)|创意拍切图|导购切图/.test(pathText)) return 'main-image'
  if (/导购素材|商品竖图|竖图/.test(pathText)) return 'vertical-guide'
  if (/(^|\/)(?:01-|2-)产品包装(\/|$)/.test(pathText)) return 'product-packaging'
  if (/包装图|包装图示/.test(pathText)) return 'packaging-image'
  const segments = pathSegments(pathText)
  if (segments.some(segment => segment === styleCode)) return 'exact-style-folder'
  if (segments.some(segment => segment === `${styleCode}-优化`)) return 'optimized-style-folder'
  return 'other'
}

function packagePattern(fullpath, styleCode) {
  const segments = pathSegments(fullpath)
  if (!segments.length) return ''
  const styleIndex = segments.findIndex(segment => segment === styleCode || segment === `${styleCode}-优化` || segment.startsWith(`${styleCode}-`))
  const parentSegments = styleIndex >= 0 ? segments.slice(0, styleIndex + 1) : segments.slice(0, -1)
  return parentSegments.map(segment => {
    if (segment === styleCode) return '{style}'
    if (segment === `${styleCode}-优化`) return '{style}-优化'
    if (segment.startsWith(`${styleCode}-`)) return segment.replace(styleCode, '{style}')
    return segment
  }).join('/')
}

function flattenResult(record) {
  const matchedMounts = arrayFromMaybe(record.mountResults).filter(mount => mount.ok && Number(mount.imageCount || 0) > 0)
  const selectedMounts = arrayFromMaybe(record.mountResults).filter(mount => mount.ok && Number(mount.selected || 0) > 0)
  const categoryCounts = Object.fromEntries(CATEGORY_ORDER.map(category => [category, 0]))
  for (const mount of selectedMounts) {
    for (const category of CATEGORY_ORDER) {
      categoryCounts[category] += Number(mount.categoryCounts?.[category] || 0)
    }
  }
  return {
    matchedMounts,
    selectedMounts,
    categoryCounts,
    imageCount: matchedMounts.reduce((sum, mount) => sum + Number(mount.imageCount || 0), 0),
    selected: selectedMounts.reduce((sum, mount) => sum + Number(mount.selected || 0), 0),
    searchCount: arrayFromMaybe(record.mountResults).reduce((sum, mount) => sum + Number(mount.searchCount || 0), 0),
    errors: arrayFromMaybe(record.mountResults).filter(mount => !mount.ok || mount.errors?.length).flatMap(mount => [
      mount.error,
      ...arrayFromMaybe(mount.errors),
    ]
      .map(cleanText)
      .filter(Boolean)
      .filter(error => !error.includes(NO_EXACT_PATH))),
  }
}

function writeCsv(file, rows, fields) {
  const lines = [fields.join(',')]
  for (const row of rows) lines.push(fields.map(field => csvEscape(row[field])).join(','))
  fs.writeFileSync(file, `${lines.join('\n')}\n`)
}

function writeTargetFiles(outDir, styles) {
  fs.writeFileSync(path.join(outDir, 'target-styles.json'), `${JSON.stringify(styles, null, 2)}\n`)
  writeCsv(path.join(outDir, 'target-styles.csv'), styles, [
    'styleCode',
    'firstSequence',
    'auditRows',
    'itemIds',
    'titles',
    'replaceRanges',
    'preserveRanges',
  ])
}

function buildArtifacts(outDir, styles, results, state = {}) {
  const resultRows = []
  const imageRows = []
  const formatCounts = new Map()
  const patternCounts = new Map()
  const categoryTotals = Object.fromEntries(CATEGORY_ORDER.map(category => [category, 0]))
  let matchedStyles = 0
  let selectedStyles = 0
  let errorStyles = 0

  const styleByCode = new Map(styles.map(style => [style.styleCode, style]))
  for (const result of results) {
    const style = styleByCode.get(result.styleCode) || { styleCode: result.styleCode }
    const flat = flattenResult(result)
    const hasMatch = flat.imageCount > 0
    const hasSelected = flat.selected > 0
    if (hasMatch) matchedStyles += 1
    if (hasSelected) selectedStyles += 1
    if (flat.errors.length && !hasMatch) errorStyles += 1
    for (const [category, count] of Object.entries(flat.categoryCounts)) categoryTotals[category] += count

    resultRows.push({
      styleCode: result.styleCode,
      itemIds: arrayFromMaybe(style.itemIds).join(' '),
      title: arrayFromMaybe(style.titles)[0] || '',
      auditRows: style.auditRows || 0,
      matched: hasMatch ? 'yes' : 'no',
      classifiedSelected: hasSelected ? 'yes' : 'no',
      imageCount: flat.imageCount,
      selected: flat.selected,
      searchCount: flat.searchCount,
      mounts: flat.matchedMounts.map(mount => `${mount.mountName}(${mount.mountId})`).join(' | '),
      main_1x1: flat.categoryCounts.main_1x1,
      micro_1x1: flat.categoryCounts.micro_1x1,
      main_3x4: flat.categoryCounts.main_3x4,
      micro_3x4: flat.categoryCounts.micro_3x4,
      vertical: flat.categoryCounts.vertical,
      pc_detail: flat.categoryCounts.pc_detail,
      packagePatterns: '',
      errors: flat.errors.slice(0, 3).join(' | '),
    })

    const patternSet = new Set()
    for (const mount of arrayFromMaybe(result.mountResults)) {
      const selectedPaths = new Set()
      for (const [category, rows] of Object.entries(mount.selectedItems || {})) {
        for (const item of arrayFromMaybe(rows)) {
          if (item.fullpath) selectedPaths.add(`${category}\n${item.fullpath}`)
        }
      }
      for (const item of arrayFromMaybe(mount.items)) {
        const format = pathFormat(item.fullpath, result.styleCode)
        const pattern = packagePattern(item.fullpath, result.styleCode)
        if (format) formatCounts.set(format, (formatCounts.get(format) || 0) + 1)
        if (pattern) {
          patternCounts.set(pattern, (patternCounts.get(pattern) || 0) + 1)
          patternSet.add(pattern)
        }
        const selectedCategories = [...selectedPaths]
          .filter(value => value.endsWith(`\n${item.fullpath}`))
          .map(value => value.split('\n')[0])
          .join('|')
        imageRows.push({
          styleCode: result.styleCode,
          itemIds: arrayFromMaybe(style.itemIds).join(' '),
          mountName: cleanText(mount.mountName),
          mountId: cleanText(mount.mountId),
          filename: cleanText(item.filename),
          fullpath: cleanText(item.fullpath),
          ext: cleanText(item.ext),
          pathFormat: format,
          packagePattern: pattern,
          selectedCategories,
        })
      }
    }
    resultRows[resultRows.length - 1].packagePatterns = [...patternSet].slice(0, 5).join(' | ')
  }

  const formatRows = [...formatCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([pathFormatName, count]) => ({ pathFormat: pathFormatName, imageCount: count }))
  const patternRows = [...patternCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hans-CN', { numeric: true }))
    .map(([pattern, count]) => ({ packagePattern: pattern, imageCount: count }))

  const summary = {
    generatedAt: new Date().toISOString(),
    ...state,
    targetStyles: styles.length,
    processedStyles: results.length,
    matchedStyles,
    selectedStyles,
    noMatchStyles: results.length - matchedStyles,
    errorStyles,
    categoryTotals,
    pathFormats: Object.fromEntries(formatRows.map(row => [row.pathFormat, row.imageCount])),
  }

  fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  fs.writeFileSync(path.join(outDir, 'match-results.json'), `${JSON.stringify({ ...summary, results }, null, 2)}\n`)
  writeCsv(path.join(outDir, 'match-results.csv'), resultRows, [
    'styleCode',
    'itemIds',
    'title',
    'auditRows',
    'matched',
    'classifiedSelected',
    'imageCount',
    'selected',
    'searchCount',
    'mounts',
    'main_1x1',
    'micro_1x1',
    'main_3x4',
    'micro_3x4',
    'vertical',
    'pc_detail',
    'packagePatterns',
    'errors',
  ])
  writeCsv(path.join(outDir, 'matched-images.csv'), imageRows, [
    'styleCode',
    'itemIds',
    'mountName',
    'mountId',
    'filename',
    'fullpath',
    'ext',
    'pathFormat',
    'packagePattern',
    'selectedCategories',
  ])
  writeCsv(path.join(outDir, 'path-format-summary.csv'), formatRows, ['pathFormat', 'imageCount'])
  writeCsv(path.join(outDir, 'package-pattern-summary.csv'), patternRows.slice(0, 500), ['packagePattern', 'imageCount'])
  fs.writeFileSync(path.join(outDir, 'match-report.md'), renderMarkdown(summary, resultRows, formatRows, patternRows, outDir))
  return summary
}

function renderMarkdown(summary, resultRows, formatRows, patternRows, outDir) {
  const lines = []
  lines.push('# 天猫探查款号 x 森马云盘图包匹配')
  lines.push('')
  lines.push(`- 生成时间：${summary.generatedAt}`)
  lines.push(`- 输出目录：${outDir}`)
  lines.push(`- 目标款号：${summary.targetStyles}`)
  lines.push(`- 已处理：${summary.processedStyles}`)
  lines.push(`- 找到图片：${summary.matchedStyles}`)
  lines.push(`- 可按上传分类选图：${summary.selectedStyles}`)
  lines.push(`- 未匹配：${summary.noMatchStyles}`)
  lines.push(`- 错误款号：${summary.errorStyles}`)
  lines.push(`- 说明：只读搜索和列目录，不下载、不提交、不发布、不写草稿。`)
  if (summary.authBlocked) lines.push(`- 阻塞：${summary.authBlocked}`)
  lines.push('')
  lines.push('## 路径格式')
  lines.push('')
  for (const row of formatRows.slice(0, 30)) {
    lines.push(`- ${row.pathFormat}: ${row.imageCount}`)
  }
  lines.push('')
  lines.push('## 主要图包路径模板')
  lines.push('')
  for (const row of patternRows.slice(0, 30)) {
    lines.push(`- ${row.packagePattern}: ${row.imageCount}`)
  }
  lines.push('')
  lines.push('## 前 100 款')
  lines.push('')
  lines.push('| 款号 | 商品ID | 找到图片 | 选中图 | 主图1:1 | 微详情1:1 | 主图3:4 | 微详情3:4 | 竖图 | PC详情 | 挂载点 | 图包模板 | 错误 |')
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |')
  for (const row of resultRows.slice(0, 100)) {
    lines.push(`| ${[
      row.styleCode,
      row.itemIds,
      row.imageCount,
      row.selected,
      row.main_1x1,
      row.micro_1x1,
      row.main_3x4,
      row.micro_3x4,
      row.vertical,
      row.pc_detail,
      row.mounts,
      row.packagePatterns,
      row.errors,
    ].map(markdownCell).join(' | ')} |`)
  }
  return `${lines.join('\n')}\n`
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0))))
}

async function run(options) {
  ensureDir(options.outDir)
  const allStyles = readAuditStyles(options.auditJsonl)
  const styles = options.limit > 0 ? allStyles.slice(0, options.limit) : allStyles
  writeTargetFiles(options.outDir, styles)

  const jsonlPath = path.join(options.outDir, 'match-results.jsonl')
  if (!options.resume && fs.existsSync(jsonlPath)) fs.rmSync(jsonlPath)
  const latestByStyle = options.resume ? readExistingResults(jsonlPath) : new Map()

  const page = await resolveFmpPage(options)
  const cdp = new CdpClient(page.webSocketDebuggerUrl)
  await cdp.connect()
  try {
    const scriptSource = fs.readFileSync(path.resolve('adapters/tmall-ops-assistant/tmall-packaging-upload.js'), 'utf8')
    await cdp.evaluate(browserInstallExpression(scriptSource), 120000)

    let availableMounts
    try {
      availableMounts = await cdp.evaluate('window.__crawshrimpSemirCloudPackageMatcher.fetchMounts()', 60000)
    } catch (error) {
      const summary = buildArtifacts(options.outDir, styles, [...latestByStyle.values()], {
        authBlocked: `森马云盘登录态不可用：${cleanText(error?.message || error)}`,
        processedThisRun: 0,
      })
      throw new Error(`${summary.authBlocked}\n已写入待查款号清单：${options.outDir}`)
    }
    fs.writeFileSync(path.join(options.outDir, 'mounts.json'), `${JSON.stringify(availableMounts, null, 2)}\n`)

    const targetMounts = pickMounts(availableMounts, options)
    fs.writeFileSync(path.join(options.outDir, 'target-mounts.json'), `${JSON.stringify(targetMounts, null, 2)}\n`)
    if (!targetMounts.length) {
      throw new Error(`没有匹配的云盘挂载点；可见挂载点：${availableMounts.map(mount => `${mount.mountName}(${mount.mountId})`).join('、') || '无'}`)
    }

    let processedThisRun = 0
    for (const style of styles) {
      if (latestByStyle.has(style.styleCode)) continue
      const result = await cdp.evaluate(`window.__crawshrimpSemirCloudPackageMatcher.matchStyle(${JSON.stringify({
        styleCode: style.styleCode,
        itemId: style.itemIds?.[0] || '',
        mounts: targetMounts,
        folderScanDepth: options.folderScanDepth,
      })})`, 300000)
      const record = {
        ...style,
        ...result,
        matchedAt: new Date().toISOString(),
      }
      latestByStyle.set(style.styleCode, record)
      fs.appendFileSync(jsonlPath, `${JSON.stringify(record)}\n`)
      processedThisRun += 1
      const flat = flattenResult(record)
      console.log(`[semir-match] ${latestByStyle.size}/${styles.length} ${style.styleCode} images=${flat.imageCount} selected=${flat.selected} search=${flat.searchCount}`)
      if (processedThisRun % 10 === 0) {
        buildArtifacts(options.outDir, styles, [...latestByStyle.values()], { processedThisRun, targetMounts })
      }
      await sleep(options.delayMs)
    }
    return buildArtifacts(options.outDir, styles, [...latestByStyle.values()], { processedThisRun, targetMounts })
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
  const summary = await run(options)
  console.log(`[semir-match] wrote ${summary.processedStyles}/${summary.targetStyles} styles to ${options.outDir}`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath && invokedPath === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch(error => {
    console.error(`[semir-match] ${error?.stack || error}`)
    process.exitCode = 1
  })
}
