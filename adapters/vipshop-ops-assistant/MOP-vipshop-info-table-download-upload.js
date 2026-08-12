;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const SUMMARY_SHEET = '执行摘要'
  const DETAIL_SHEET = '商品信息表'
  const VIPSHOP_ENTRY_URL = 'https://nov-admin.vip.com/admin/index.html#/normal/normalMerchandise'
  const SEMIR_ENTRY_URL = 'https://fmp.semirapp.com/web/index#/home/file'
  const MERCHANDISE_QUERY_URL = 'https://nov-admin.vip.com/normal/normalMerchandiseQuery'
  const DEFAULT_SEMIR_PATH = '品牌电商项目部//MOP品牌/4.运营/02-唯品/历史资料/唯品每日商品货表汇总/2026/8月-12月/'
  const DEFAULT_PAGE_SIZE = 500
  const DEFAULT_MAX_PAGES = 200
  const DEFAULT_DELAY_MS = 80
  const DEFAULT_UPLOAD_CHUNK_SIZE = 5242880
  const INFO_COLUMNS = [
    '商品ID', '款号', '货号', '商品名称', '品牌编码', '品牌名称', '一级品类', '二级品类', '三级品类',
    '售卖渠道', '市场价', '唯品价', '到手价', '在售库存', '库存天数', '售龄', '商品状态', '商品标签', '图片链接',
  ]

  function compact(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim()
  }

  function normalizeCode(value) {
    return compact(value).replace(/[\s"'`]+/g, '').toUpperCase()
  }

  function toSafeFilename(value, fallback = 'file') {
    const text = compact(value)
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/^\.+|\.+$/g, '')
      .replace(/^_+|_+$/g, '')
    return text || fallback
  }

  function timestampText(date = new Date()) {
    const pad = value => String(value).padStart(2, '0')
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  }

  function normalizeCloudPath(value) {
    return String(value || DEFAULT_SEMIR_PATH).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\//, '').replace(/\/?$/, '/')
  }

  function parseList(value) {
    if (Array.isArray(value)) return value.map(normalizeCode).filter(Boolean)
    return compact(value).split(/[\n,，、;；\s]+/).map(normalizeCode).filter(Boolean)
  }

  function normalizeVipshopStatus(value) {
    const text = compact(value)
    if (text === '0') return '已下架'
    if (text === '1') return '上架中'
    if (text === '2') return '部分上架'
    if (text === '11') return '草稿/可编辑'
    if (text === '12') return '审核通过'
    if (text === '13') return '已提交审核'
    if (text === '14') return '审核驳回/可编辑'
    return text
  }

  function getPageSize(rawParams = params) {
    return Math.max(20, Math.min(500, Number(rawParams.page_size || DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE))
  }

  function getMaxPages(rawParams = params) {
    return Math.max(1, Math.min(1000, Number(rawParams.max_pages || DEFAULT_MAX_PAGES) || DEFAULT_MAX_PAGES))
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  function buildMerchandiseQueryPayload(pageNo, pageSize, rawParams = params) {
    const param = {}
    const goodsCodes = parseList(rawParams.goods_codes || rawParams.msn_set)
    const styleCodes = parseList(rawParams.style_codes || rawParams.osn_set)
    if (goodsCodes.length) param.msnSet = goodsCodes
    if (styleCodes.length) param.osn = styleCodes
    return { pageNo, pageSize, param }
  }

  async function postJson(url, payload) {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify(payload),
    })
    const text = await response.text()
    let json
    try {
      json = JSON.parse(text)
    } catch (error) {
      throw new Error(`${url} 返回非 JSON：${text.slice(0, 160)}`)
    }
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}：${compact(json.message || json.msg || text.slice(0, 160))}`)
    if (json.code && String(json.code) !== '200') throw new Error(`${url} 返回 code=${json.code}：${compact(json.message || json.msg || '接口失败')}`)
    return json
  }

  async function collectMerchandiseRows(rawParams = params) {
    const pageSize = getPageSize(rawParams)
    const maxPages = getMaxPages(rawParams)
    const rows = []
    let total = null
    let pages = 0
    for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
      const json = await postJson(MERCHANDISE_QUERY_URL, buildMerchandiseQueryPayload(pageNo, pageSize, rawParams))
      const pageRows = Array.isArray(json?.data) ? json.data : []
      const reportedTotal = Number(json?.total || 0)
      if (Number.isFinite(reportedTotal) && reportedTotal > 0 && total == null) total = reportedTotal
      pages = pageNo
      rows.push(...pageRows)
      if (!pageRows.length) break
      if (total && rows.length >= total) break
      if (pageRows.length < pageSize) break
      await sleep(DEFAULT_DELAY_MS)
    }
    return { rows, total: total || rows.length, pages }
  }

  function normalizeInfoRow(row) {
    return {
      __sheet_name: DETAIL_SHEET,
      商品ID: compact(row.merchandiseNo),
      款号: normalizeCode(row.osn || row.styleCode),
      货号: normalizeCode(row.msn || row.goodsNo),
      商品名称: compact(row.name || row.goodsName),
      品牌编码: compact(row.brandStoreSn),
      品牌名称: compact(row.brandName || row.brandStoreName),
      一级品类: compact(row.newCategory1stName),
      二级品类: compact(row.newCategory2ndName),
      三级品类: compact(row.newCategory3rdName),
      售卖渠道: compact(row.sellChannel),
      市场价: compact(row.marketPrice),
      唯品价: compact(row.vipshopPrice),
      到手价: compact(row.strikePrice ?? row.promoPrice),
      在售库存: compact(row.merLeavingNum ?? row.bindMerLeavingNum),
      库存天数: compact(row.canSellStockDay),
      售龄: compact(row.productSellAge),
      商品状态: normalizeVipshopStatus(row.skuStatus ?? row.status),
      商品标签: compact(row.merTagMap ? JSON.stringify(row.merTagMap) : row.visTagMap ? JSON.stringify(row.visTagMap) : ''),
      图片链接: compact(row.imageUrl),
      数据来源接口: '/normal/normalMerchandiseQuery',
      执行结果: '已下载到商品信息表',
      备注: '',
    }
  }

  function csvEscape(value) {
    const text = String(value ?? '')
    if (!/[",\n\r]/.test(text)) return text
    return `"${text.replace(/"/g, '""')}"`
  }

  function rowsToCsv(rows, columns) {
    const lines = [columns.map(csvEscape).join(',')]
    for (const row of rows || []) {
      lines.push(columns.map(column => csvEscape(row[column])).join(','))
    }
    return lines.join('\n')
  }

  function dataUrlForCsv(rows, columns) {
    const csv = rowsToCsv(rows, columns)
    return `data:text/csv;charset=utf-8,${encodeURIComponent(`\ufeff${csv}`)}`
  }

  function buildInfoFilename(rawParams = params, nowText = timestampText()) {
    const base = compact(rawParams.output_filename || rawParams.filename || '')
    if (base) return /\.csv$/i.test(base) ? toSafeFilename(base, `唯品商品信息表_${nowText}.csv`) : `${toSafeFilename(base, `唯品商品信息表_${nowText}`)}.csv`
    return `唯品商品信息表_${nowText}.csv`
  }

  function buildDownloadItem(rows, rawParams = params, nowText = timestampText()) {
    const filename = buildInfoFilename(rawParams, nowText)
    const exportDir = compact(rawParams.local_download_dir || rawParams.export_dir || rawParams.download_dir)
    return {
      url: dataUrlForCsv(rows, INFO_COLUMNS),
      filename,
      label: `唯品商品信息表 ${rows.length} 行`,
      target_dir: exportDir,
      target_relative_path: exportDir ? filename : '',
      no_proxy: true,
    }
  }

  function findButtonByText(pattern) {
    return [...document.querySelectorAll('button,a,[role="button"],.ant-btn,.el-button,.semi-button,.gk-button,.upload-btn,.gk-uploader-buttons,.gk-menu-item')]
      .filter(element => element && element.getClientRects?.().length)
      .find(element => pattern.test(compact(element.innerText || element.textContent || element.getAttribute?.('title'))))
  }

  function rectCenter(element) {
    const rect = element?.getBoundingClientRect?.()
    if (!rect) return null
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }

  function isSemirPage() {
    return /^https:\/\/fmp\.semirapp\.com\//i.test(String(location.href || ''))
  }

  function currentSemirDirectoryLooksLikeTarget(target) {
    const bodyText = compact(document?.body?.innerText || document?.body?.textContent || '')
    const fullPath = normalizeCloudPath(target?.fullPath || '')
    const parts = fullPath.split('/').filter(Boolean)
    if (parts.length < 2) return false
    const mountName = parts[0]
    const leaf = parts[parts.length - 1]
    const parent = parts[parts.length - 2]
    if (bodyText.includes(mountName) && bodyText.includes(parent) && bodyText.includes(leaf)) return true
    const href = String(location.href || '')
    const mountId = compact(target?.mountId)
    const relativePath = compact(target?.relativePath)
    if (!mountId || !relativePath) return false
    try {
      const parsed = new URL(href)
      const hash = parsed.hash || ''
      const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
      const routePath = new URLSearchParams(hashQuery).get('path') || ''
      return hash.includes(`/mount/${encodeURIComponent(mountId)}`) && normalizeCloudPath(routePath) === normalizeCloudPath(relativePath)
    } catch (_error) {
      return false
    }
  }

  async function fetchSemirJson(url, init = {}) {
    const response = await fetch(url, { credentials: 'include', ...init })
    const text = await response.text()
    let payload = null
    try {
      payload = text ? JSON.parse(text) : {}
    } catch (error) {
      payload = null
    }
    if (payload == null) throw new Error(`森马云盘接口未返回 JSON：${url}；${text.slice(0, 160)}`)
    if (!response.ok) throw new Error(`森马云盘接口失败 ${response.status}：${compact(payload.msg || payload.message || text.slice(0, 160))}`)
    return payload
  }

  async function fetchMounts() {
    const payload = await fetchSemirJson('/fengcloud/1/account/mount')
    if (Array.isArray(payload)) return payload
    if (Array.isArray(payload?.list)) return payload.list
    return []
  }

  function mountDisplayName(item) {
    return compact(item?.org_name || item?.name || item?.title)
  }

  function mountIdValue(item) {
    return String(item?.mount_id || item?.id || '').trim()
  }

  async function resolveSemirTarget(rawPath = DEFAULT_SEMIR_PATH) {
    const normalized = normalizeCloudPath(rawPath)
    const parts = normalized.split('/').filter(Boolean)
    if (!parts.length) throw new Error('森马云盘目标路径为空')
    const mounts = await fetchMounts()
    const mount = mounts.find(item => mountDisplayName(item) === parts[0])
    if (!mount) {
      const available = mounts.map(mountDisplayName).filter(Boolean).join('、')
      throw new Error(`未找到云盘挂载点「${parts[0]}」；当前可见：${available || '无'}`)
    }
    return {
      mountId: mountIdValue(mount),
      mountName: mountDisplayName(mount),
      relativePath: parts.slice(1).join('/'),
      fullPath: normalized,
    }
  }

  function buildSemirFolderUrl(target) {
    const mountId = compact(target?.mountId)
    const relativePath = compact(target?.relativePath)
    if (!mountId) return SEMIR_ENTRY_URL
    const hash = `#/home/file/mount/${encodeURIComponent(mountId)}`
    return relativePath ? `${SEMIR_ENTRY_URL.replace(/#.*$/, '')}${hash}?path=${encodeURIComponent(relativePath)}` : `${SEMIR_ENTRY_URL.replace(/#.*$/, '')}${hash}`
  }

  async function listCurrentSemirFolder(target) {
    const mountId = compact(target?.mountId)
    if (!mountId) return []
    const query = new URLSearchParams({
      order: 'filename asc',
      size: '100',
      start: '0',
      fullpath: compact(target?.relativePath || ''),
      mount_id: mountId,
      current: '1',
    })
    const payload = await fetchSemirJson(`/fengcloud/1/file/ls?${query.toString()}`)
    if (Array.isArray(payload)) return payload
    if (Array.isArray(payload?.list)) return payload.list
    if (Array.isArray(payload?.data?.list)) return payload.data.list
    if (Array.isArray(payload?.result?.list)) return payload.result.list
    return []
  }

  function randomUploadSession() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
    return `${Date.now()}${Math.random().toString(31).slice(2)}`
  }

  function semirRelativeFilePath(target, filename) {
    const folder = compact(target?.relativePath || '').replace(/^\/+|\/+$/g, '')
    return folder ? `${folder}/${filename}` : filename
  }

  async function getSemirAccountToken() {
    const payload = await fetchSemirJson('/fengcloud/1/account/info')
    const token = compact(payload?.token)
    if (!token) throw new Error('森马云盘账号接口未返回上传 token')
    return token
  }

  async function checkSemirFileExists(target, filename) {
    const query = new URLSearchParams({
      mount_id: compact(target?.mountId),
      fullpath: semirRelativeFilePath(target, filename),
    })
    const response = await fetch(`/fengcloud/2/file/exist?${query.toString()}`, { credentials: 'include' })
    const text = await response.text()
    let payload = {}
    try {
      payload = text ? JSON.parse(text) : {}
    } catch (_error) {
      payload = {}
    }
    if (response.status === 404 || String(payload?.error_code || '') === '40402') {
      return { exists: false, status: response.status, errorCode: payload?.error_code || '' }
    }
    if (!response.ok && payload?.error_code) {
      throw new Error(`森马云盘重复文件检查失败：${payload.error_msg || payload.message || payload.error_code}`)
    }
    return { exists: !payload?.error_code, status: response.status, errorCode: payload?.error_code || '' }
  }

  function semirOverwriteValue(rawParams = params) {
    const value = compact(rawParams.semir_overwrite ?? rawParams.overwrite_existing ?? '')
    if (/^(1|true|yes|replace|替换)$/i.test(value)) return '1'
    return '0'
  }

  function buildSemirUploadMeta(target, token, filename, rawParams = params, fileExists = false) {
    const configuredChunkSize = Number(rawParams.semir_chunk_size || rawParams.chunk_size || DEFAULT_UPLOAD_CHUNK_SIZE)
    const chunkSize = Number.isFinite(configuredChunkSize) && configuredChunkSize > 0 ? configuredChunkSize : DEFAULT_UPLOAD_CHUNK_SIZE
    return {
      filefield: 'file',
      mount_id: compact(target?.mountId),
      path: compact(target?.relativePath || '').replace(/^\/+|\/+$/g, ''),
      chunkSize: String(chunkSize),
      session: randomUploadSession(),
      token,
      overwrite: fileExists ? semirOverwriteValue(rawParams) : '0',
      name: filename,
    }
  }

  function buildSemirUploadFormData(meta, blob, filename, chunkIndex = 0, chunkCount = 1) {
    const formData = new FormData()
    for (const [key, value] of Object.entries(meta)) {
      if (value !== undefined && value !== null && value !== '') formData.append(key, String(value))
    }
    if (chunkCount > 1) {
      const chunkSize = Number(meta.chunkSize || DEFAULT_UPLOAD_CHUNK_SIZE)
      const start = chunkIndex * chunkSize
      const end = Math.min(start + chunkSize, blob.size)
      formData.append('chunk', String(chunkIndex))
      formData.append('chunks', String(chunkCount))
      formData.append('chunkSize', String(chunkSize))
      formData.append('file', blob.slice(start, end, blob.type), filename)
    } else {
      formData.append('file', blob, filename)
    }
    return formData
  }

  async function postSemirUploadChunk(uploadUrl, formData) {
    const response = await fetch(uploadUrl, { method: 'POST', body: formData })
    const text = await response.text()
    let payload = {}
    try {
      payload = text ? JSON.parse(text) : {}
    } catch (_error) {
      throw new Error(`森马云盘上传接口未返回 JSON：${text.slice(0, 160)}`)
    }
    if (!response.ok) {
      throw new Error(`森马云盘上传失败 ${response.status}：${compact(payload.error_msg || payload.message || payload.msg || text.slice(0, 160))}`)
    }
    if (payload.error_code || payload.error) {
      throw new Error(`森马云盘上传失败：${compact(payload.error_msg || payload.message || payload.msg || payload.error_code || payload.error)}`)
    }
    return payload
  }

  async function waitForSemirFileReadback(target, filename, uploadPayload = {}, attempts = 8) {
    const uploadedFullpath = compact(uploadPayload.fullpath)
    const uploadedName = uploadedFullpath.split('/').filter(Boolean).pop() || filename
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const list = await listCurrentSemirFolder(target)
      const found = list.find(item => {
        const itemName = compact(item?.filename || item?.name)
        const itemFullpath = compact(item?.fullpath || item?.path || item?.webpath)
        return itemName === filename || itemName === uploadedName || itemFullpath === uploadedFullpath
      })
      if (found) return { found: true, file: found, attempts: attempt + 1 }
      await sleep(600)
    }
    return { found: false, file: null, attempts }
  }

  async function uploadInfoRowsToSemir(target, rows, filename, rawParams = params) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('缺少待上传的商品信息表行')
    const mountId = compact(target?.mountId)
    if (!mountId) throw new Error('缺少森马云盘 mount_id，无法上传')
    const uploadConfig = await fetchSemirJson(`/web/get_upload?${new URLSearchParams({ mount_id: mountId, v: '2' }).toString()}`)
    const uploadUrl = compact(uploadConfig?.uploadUrl)
    if (!uploadUrl) throw new Error('森马云盘未返回上传服务地址')
    const token = await getSemirAccountToken()
    const fileExists = await checkSemirFileExists(target, filename)
    const meta = buildSemirUploadMeta(target, token, filename, rawParams, fileExists.exists)
    const csv = rowsToCsv(rows, INFO_COLUMNS)
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' })
    const chunkSize = Number(meta.chunkSize || DEFAULT_UPLOAD_CHUNK_SIZE)
    const shouldChunk = Boolean(uploadConfig?.chunked) && blob.size > chunkSize
    const chunkCount = shouldChunk ? Math.ceil(blob.size / chunkSize) : 1
    let payload = {}
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      payload = await postSemirUploadChunk(uploadUrl, buildSemirUploadFormData(meta, blob, filename, chunkIndex, chunkCount))
    }
    const readback = await waitForSemirFileReadback(target, filename, payload)
    return {
      filename,
      bytes: blob.size,
      chunks: chunkCount,
      existedBeforeUpload: fileExists.exists,
      uploadedFullpath: compact(payload?.fullpath),
      uploadedFilehash: compact(payload?.filehash),
      apiReadback: readback.found,
      readbackFile: readback.file || null,
    }
  }

  function buildSummaryRows(options) {
    const body = [
      '### MOP 唯品商品信息表下载',
      `- 商品信息行数：${options.records}`,
      `- 下载文件：${options.filename || '等待下载结果'}`,
      `- 森马云盘目标目录：${options.cloudPath}`,
      `- 网页上传状态：${options.uploadStatus}`,
      options.downloadPath ? `- 本地文件：${options.downloadPath}` : '',
    ].filter(Boolean).join('\n')
    return [{
      __sheet_name: SUMMARY_SHEET,
      处理环节: '唯品商品信息表下载与云盘网页上传',
      商品信息行数: options.records,
      下载文件名: options.filename || '',
      本地文件: options.downloadPath || '',
      森马云盘目标目录: options.cloudPath || '',
      网页上传状态: options.uploadStatus || '',
      数据来源接口: '/normal/normalMerchandiseQuery',
      执行结果: options.result || '完成',
      备注: options.note || '',
      __notify_title: 'MOP 唯品商品信息表下载',
      __notify_body: body,
    }]
  }

  function navigateTo(url, nextPhaseName, sleepMs = 1800, nextShared = shared, data = []) {
    if (String(location.href || '') !== String(url || '')) location.href = url
    return {
      success: true,
      data,
      meta: {
        action: 'next_phase',
        next_phase: nextPhaseName,
        sleep_ms: sleepMs,
        shared: nextShared,
      },
    }
  }

  function downloadUrls(items, nextPhaseName, nextShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: {
        action: 'download_urls',
        items,
        shared_key: 'download_result',
        strict: true,
        concurrency: 1,
        retry_attempts: 1,
        next_phase: nextPhaseName,
        sleep_ms: 500,
        shared: nextShared,
      },
    }
  }

  function fileChooserUpload(items, nextPhaseName, nextShared = shared) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'file_chooser_upload',
        items,
        shared_key: 'upload_result',
        strict: true,
        next_phase: nextPhaseName,
        sleep_ms: 1500,
        shared: nextShared,
      },
    }
  }

  function complete(data = [], nextShared = shared) {
    return {
      success: true,
      data,
      meta: {
        action: 'complete',
        has_more: false,
        shared: nextShared,
      },
    }
  }

  function exposeHelpers() {
    if (!testExports || typeof testExports !== 'object') return
    Object.assign(testExports, {
      normalizeCloudPath,
      buildMerchandiseQueryPayload,
      normalizeInfoRow,
      rowsToCsv,
      buildInfoFilename,
      buildDownloadItem,
      buildSummaryRows,
      resolveSemirTarget,
      buildSemirFolderUrl,
      listCurrentSemirFolder,
      currentSemirDirectoryLooksLikeTarget,
      semirRelativeFilePath,
      buildSemirUploadMeta,
      buildSemirUploadFormData,
      uploadInfoRowsToSemir,
    })
  }

  exposeHelpers()
  if (phase === '__exports__') return complete([], shared)

  try {
    if (phase === 'main') {
      if (!/^https:\/\/nov-admin\.vip\.com\//i.test(String(location.href || ''))) return navigateTo(VIPSHOP_ENTRY_URL, 'main')
      const result = await collectMerchandiseRows(params)
      const rows = result.rows.map(normalizeInfoRow)
      if (!rows.length) {
        return complete(buildSummaryRows({
          records: 0,
          cloudPath: normalizeCloudPath(params.semir_cloud_path),
          uploadStatus: '未上传',
          result: '无数据',
          note: '商品信息接口没有返回可下载行',
        }))
      }
      const nowText = timestampText()
      const item = buildDownloadItem(rows, params, nowText)
      return downloadUrls([item], 'open_semir_cloud', {
        ...shared,
        info_rows: rows,
        info_filename: item.filename,
        semir_cloud_path: normalizeCloudPath(params.semir_cloud_path),
        total_rows: rows.length,
        current_store: '唯品商品信息表下载',
      })
    }

    if (phase === 'open_semir_cloud') {
      if (!isSemirPage()) return navigateTo(SEMIR_ENTRY_URL, 'resolve_semir_target', 2200, shared)
      return navigateTo(String(location.href || SEMIR_ENTRY_URL), 'resolve_semir_target', 500, shared)
    }

    if (phase === 'resolve_semir_target') {
      const target = await resolveSemirTarget(shared.semir_cloud_path || params.semir_cloud_path || DEFAULT_SEMIR_PATH)
      return navigateTo(buildSemirFolderUrl(target), 'prepare_web_upload', 1800, {
        ...shared,
        semir_target: target,
        current_store: `森马云盘 Web 上传目录：${target.fullPath}`,
      })
    }

    if (phase === 'prepare_web_upload') {
      const downloadItems = Array.isArray(shared.download_result?.items) ? shared.download_result.items : []
      const downloaded = downloadItems.find(item => item.success && item.path)
      if (!downloaded) {
        return complete(buildSummaryRows({
          records: Number(shared.total_rows || 0),
          filename: shared.info_filename,
          cloudPath: shared.semir_cloud_path,
          uploadStatus: '未上传',
          result: '下载失败',
          note: '抓虾运行器未返回商品信息表下载文件',
        }), shared)
      }

      if (!currentSemirDirectoryLooksLikeTarget(shared.semir_target)) {
        const directoryAttempts = Number(shared.semir_directory_wait_attempts || 0)
        if (directoryAttempts < 8) {
          return navigateTo(buildSemirFolderUrl(shared.semir_target || {}), 'prepare_web_upload', 1000, {
            ...shared,
            semir_directory_wait_attempts: directoryAttempts + 1,
          })
        }
        return complete(buildSummaryRows({
          records: Number(shared.total_rows || 0),
          filename: shared.info_filename || downloaded.filename,
          downloadPath: downloaded.path,
          cloudPath: shared.semir_cloud_path,
          uploadStatus: '等待打开目标目录',
          result: '待上传',
          note: '已生成本地商品信息表；为避免传错目录，请先在森马云盘 Web 打开目标目录后重跑上传。',
        }), shared)
      }

      let apiUpload
      try {
        apiUpload = await uploadInfoRowsToSemir(
          shared.semir_target || {},
          Array.isArray(shared.info_rows) ? shared.info_rows : [],
          shared.info_filename || downloaded.filename,
          params,
        )
      } catch (uploadError) {
        return complete(buildSummaryRows({
          records: Number(shared.total_rows || 0),
          filename: shared.info_filename || downloaded.filename,
          downloadPath: downloaded.path,
          cloudPath: shared.semir_cloud_path,
          uploadStatus: '网页 API 上传失败',
          result: '上传失败',
          note: uploadError.message || String(uploadError),
        }), {
          ...shared,
          downloaded_path: downloaded.path,
          downloaded_filename: shared.info_filename || downloaded.filename || '',
        })
      }

      return complete(buildSummaryRows({
        records: Number(shared.total_rows || 0),
        filename: apiUpload.filename || shared.info_filename || downloaded.filename,
        downloadPath: downloaded.path,
        cloudPath: shared.semir_cloud_path,
        uploadStatus: apiUpload.apiReadback ? '网页 API 上传完成接口读回' : '网页 API 上传完成待读回',
        result: apiUpload.apiReadback ? '完成' : '待核验',
        note: apiUpload.apiReadback
          ? `森马云盘目录接口已读回上传文件名；上传字节数 ${apiUpload.bytes}，分片 ${apiUpload.chunks}。`
          : `上传接口已返回，但目录列表暂未读回；上传字节数 ${apiUpload.bytes}，分片 ${apiUpload.chunks}。`,
      }), {
        ...shared,
        downloaded_path: downloaded.path,
        downloaded_filename: shared.info_filename || downloaded.filename || '',
        semir_api_upload: apiUpload,
      })
    }

    if (phase === 'open_upload_file_menu') {
      if (!currentSemirDirectoryLooksLikeTarget(shared.semir_target)) {
        const directoryAttempts = Number(shared.semir_upload_menu_directory_wait_attempts || 0)
        if (directoryAttempts < 4) {
          return navigateTo(buildSemirFolderUrl(shared.semir_target || {}), 'open_upload_file_menu', 1000, {
            ...shared,
            semir_upload_menu_directory_wait_attempts: directoryAttempts + 1,
          })
        }
        return complete(buildSummaryRows({
          records: Number(shared.total_rows || 0),
          filename: shared.info_filename || shared.downloaded_filename,
          downloadPath: shared.downloaded_path,
          cloudPath: shared.semir_cloud_path,
          uploadStatus: '等待打开目标目录',
          result: '待上传',
          note: '森马云盘页面不在目标目录，已停止上传以避免传错目录。',
        }), shared)
      }

      const uploadFileButton = findButtonByText(/^上传文件$|Upload file/i)
      const center = rectCenter(uploadFileButton)
      if (!center) {
        const attempts = Number(shared.upload_menu_wait_attempts || 0)
        if (attempts < 4) {
          return navigateTo(String(location.href || SEMIR_ENTRY_URL), 'open_upload_file_menu', 500, {
            ...shared,
            upload_menu_wait_attempts: attempts + 1,
          })
        }
        return complete(buildSummaryRows({
          records: Number(shared.total_rows || 0),
          filename: shared.info_filename || shared.downloaded_filename,
          downloadPath: shared.downloaded_path,
          cloudPath: shared.semir_cloud_path,
          uploadStatus: '等待人工定位上传文件菜单',
          result: '待上传',
          note: '已找到上传入口，但未展开或未找到「上传文件」菜单项。',
        }), shared)
      }

      return fileChooserUpload([{
        label: `上传 ${shared.downloaded_filename || shared.info_filename || '商品信息表'} 到森马云盘 Web`,
        files: [shared.downloaded_path],
        clicks: [{ ...center, delay_ms: 250 }],
        timeout_ms: 15000,
        settle_ms: 1500,
      }], 'verify_web_upload', {
        ...shared,
      })
    }

    if (phase === 'verify_web_upload') {
      const uploadItems = Array.isArray(shared.upload_result?.items) ? shared.upload_result.items : []
      const success = uploadItems.some(item => item.success)
      const bodyText = compact(document?.body?.innerText || document?.body?.textContent || '')
      const filename = shared.downloaded_filename || shared.info_filename
      const visibleReadback = Boolean(filename && bodyText.includes(filename.replace(/\.csv$/i, '')))
      const note = success
        ? visibleReadback
          ? '森马云盘页面已读回上传文件名。'
          : '已通过森马云盘网页上传控件选择文件；请以云盘页面上传完成状态为最终读回。'
        : compact(uploadItems.map(item => item.error).filter(Boolean).join('；')) || '网页上传控件未返回成功'
      let apiReadback = false
      if (success && filename) {
        try {
          const listed = await listCurrentSemirFolder(shared.semir_target || {})
          const targetName = filename.replace(/\.csv$/i, '')
          apiReadback = listed.some(item => compact(item?.filename || item?.name).includes(filename) || compact(item?.filename || item?.name).includes(targetName))
        } catch (_error) {
          apiReadback = false
        }
      }
      return complete(buildSummaryRows({
        records: Number(shared.total_rows || 0),
        filename: shared.downloaded_filename || shared.info_filename,
        downloadPath: shared.downloaded_path,
        cloudPath: shared.semir_cloud_path,
        uploadStatus: success ? apiReadback ? '网页上传完成接口读回' : visibleReadback ? '网页上传完成页面读回' : '网页上传已触发' : '网页上传失败',
        result: success ? '完成' : '上传失败',
        note: apiReadback ? '森马云盘目录接口已读回上传文件名。' : note,
      }), shared)
    }

    return { success: false, error: `未知执行相位：${phase}` }
  } catch (error) {
    return { success: false, error: error.message || String(error) }
  }
})()
