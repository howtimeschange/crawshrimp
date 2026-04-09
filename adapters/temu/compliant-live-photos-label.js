;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const mode = String(params.mode || 'new').trim().toLowerCase()

  const TARGET_URL = 'https://agentseller.temu.com/govern/compliant-live-photos'
  const QUICK_FILTERS = ['待传图', '图中标签有异常', '仓库实收商品不合规']
  const GOODS_STATUS_OPTIONS = ['在售中', '未发布到站点', '已下架', '已终止', '已删除']
  const URGENT_TEXT = '请立即处理异常，确保实物标签符合适用法律法规，避免影响商品发货入库'
  const ROW_ACTION_TEXTS = ['上传', '修改', '重新上传']
  const DRAWER_SELECTOR = '.rocket-drawer-content-wrapper'
  const DRAWER_CANDIDATE_SELECTORS = [
    '.rocket-drawer.rocket-drawer-open',
    '.rocket-drawer-content-wrapper',
    '.rocket-drawer-content',
  ]
  const OVERLAY_SELECTOR = '.rocket-modal, .rocket-dialog, [role="dialog"], .rocket-modal-wrap, .rocket-drawer-content-wrapper'
  const FILE_INPUT_MARK = 'data-crawshrimp-upload-key'

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

  function nextPhase(name, sleepMs = 800, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: { action: 'next_phase', next_phase: name, sleep_ms: sleepMs, shared: newShared },
    }
  }

  function cdpClicks(clicks, nextPhaseName, sleepMs = 800, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: { action: 'cdp_clicks', clicks, next_phase: nextPhaseName, sleep_ms: sleepMs, shared: newShared },
    }
  }

  function injectFiles(items, nextPhaseName, sleepMs = 1200, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: { action: 'inject_files', items, next_phase: nextPhaseName, sleep_ms: sleepMs, shared: newShared },
    }
  }

  function complete(data, hasMore = false, newShared = shared) {
    return {
      success: true,
      data,
      meta: { action: 'complete', has_more: hasMore, shared: newShared },
    }
  }

  function fail(message) {
    return { success: false, error: message }
  }

  function textOf(el) {
    return String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim()
  }

  function compact(value) {
    return String(value || '').replace(/\s+/g, '').trim()
  }

  function visible(el) {
    if (!el || !el.getClientRects().length) return false
    const style = getComputedStyle(el)
    return style.display !== 'none' && style.visibility !== 'hidden'
  }

  function styleOf(el) {
    try { return getComputedStyle(el) } catch (e) { return null }
  }

  function normalizeColor(value) {
    return String(value || '').replace(/\s+/g, '').toLowerCase()
  }

  function boxOf(el) {
    const rect = el?.getBoundingClientRect?.()
    if (!rect || !rect.width || !rect.height) return null
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    }
  }

  function parseZIndex(value) {
    const parsed = Number(String(value || '').trim())
    return Number.isFinite(parsed) ? parsed : 0
  }

  function domSiblingOrder(el) {
    let order = 0
    let current = el
    while (current?.previousElementSibling) {
      order += 1
      current = current.previousElementSibling
    }
    return order
  }

  function isClickableElement(el) {
    if (!el) return false
    const tagName = String(el.tagName || '')
    if (tagName === 'BUTTON' || tagName === 'A') return true
    if (String(el.getAttribute?.('role') || '') === 'button') return true
    if (/(^|\s)(btn|button)(\s|$)/i.test(String(el.className || ''))) return true
    const style = styleOf(el)
    return style?.cursor === 'pointer'
  }

  function resolveClickableElement(el) {
    let current = el
    while (current && current !== document.body) {
      if (isClickableElement(current)) return current
      current = current.parentElement
    }
    return null
  }

  function centerClick(el, delayMs = 120) {
    try { el?.scrollIntoView?.({ block: 'center', inline: 'center' }) } catch (e) {}
    const rect = el?.getBoundingClientRect?.()
    if (!rect || !rect.width || !rect.height) return null
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      delay_ms: delayMs,
    }
  }

  function clickLike(el) {
    if (!el) return false
    try { el.scrollIntoView({ block: 'center', inline: 'center' }) } catch (e) {}
    try { el.focus?.() } catch (e) {}
    try { el.click?.() } catch (e) {}
    for (const eventName of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']) {
      try {
        el.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true }))
      } catch (e) {}
    }
    return true
  }

  function gentleClick(el) {
    if (!el) return false
    try { el.scrollIntoView({ block: 'center', inline: 'center' }) } catch (e) {}
    try { el.focus?.() } catch (e) {}
    try {
      el.click?.()
      return true
    } catch (e) {}
    try {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      return true
    } catch (e) {}
    return false
  }

  function parseImagePaths(paramId, limit = 5) {
    const value = params[paramId]
    const raw = Array.isArray(value)
      ? value
      : (value && Array.isArray(value.paths) ? value.paths : [])
    const normalized = [...new Set(raw.map(v => String(v || '').trim()).filter(Boolean))]
    return limit > 0 ? normalized.slice(0, limit) : normalized
  }

  function parseCheckboxValues(paramId, allowedValues = []) {
    const value = params[paramId]
    const raw = Array.isArray(value)
      ? value
      : (value ? [value] : [])
    const normalized = [...new Set(raw.map(v => String(v || '').trim()).filter(Boolean))]
    if (!allowedValues.length) return normalized
    return normalized.filter(item => allowedValues.includes(item))
  }

  const ASSET_BANK = {
    clothing: {
      subject: parseImagePaths('clothing_subject_label_images'),
      package: parseImagePaths('clothing_package_label_images'),
    },
    shoes: {
      subject: parseImagePaths('shoe_subject_label_images'),
      package: parseImagePaths('shoe_package_label_images'),
    },
  }

  function productKindLabel(kind) {
    return kind === 'shoes' ? '鞋品' : '服装'
  }

  function resultStatusLabel(status) {
    if (status === 'submitted') return '已提交'
    if (status === 'skipped') return '跳过'
    if (status === 'failed') return '失败'
    return status || ''
  }

  function getAssetGroup(kind) {
    return ASSET_BANK[kind] || { subject: [], package: [] }
  }

  function getUploadRequest(kind) {
    const group = getAssetGroup(kind)
    const subjectPaths = Array.isArray(group.subject) ? group.subject.slice() : []
    const packagePaths = Array.isArray(group.package) ? group.package.slice() : []
    return {
      kind,
      subjectPaths,
      packagePaths,
      subjectRequested: subjectPaths.length > 0,
      packageRequested: packagePaths.length > 0,
    }
  }

  function uploadTargetLabel(request) {
    const labels = []
    if (request.subjectRequested) labels.push('主体')
    if (request.packageRequested) labels.push('外包装')
    return labels.join('/') || '标签'
  }

  function desiredGoodsStatuses() {
    return parseCheckboxValues('goods_statuses', GOODS_STATUS_OPTIONS)
  }

  function maxProducts() {
    const value = Number(params.max_products || 0)
    if (!Number.isFinite(value) || value <= 0) return 0
    return Math.floor(value)
  }

  function hasReachedLimit(nextCount = Number(shared.processed_count || 0)) {
    const limit = maxProducts()
    return limit > 0 && nextCount >= limit
  }

  const SHOE_KEYWORD_PATTERNS = [
    /鞋/,
    /靴/,
    /凉鞋/,
    /拖鞋/,
    /凉拖/,
    /洞洞鞋/,
    /高跟鞋/,
    /高帮/,
    /板鞋/,
    /运动鞋/,
    /跑鞋/,
    /球鞋/,
    /帆布鞋/,
    /皮鞋/,
    /童鞋/,
    /学步鞋/,
    /芭蕾鞋/,
    /舞蹈鞋/,
    /乐福鞋/,
    /玛丽珍/,
    /穆勒/,
    /雨靴/,
    /雪地靴/,
    /马丁靴/,
    /短靴/,
    /中筒靴/,
    /长靴/,
    /\bsneaker(?:s)?\b/i,
    /\btrainer(?:s)?\b/i,
    /\bboot(?:s|ies)?\b/i,
    /\bsandal(?:s)?\b/i,
    /\bslipper(?:s)?\b/i,
    /\bloafer(?:s)?\b/i,
    /\bflat(?:s)?\b/i,
    /\bheel(?:s)?\b/i,
    /\bpump(?:s)?\b/i,
    /\bmule(?:s)?\b/i,
    /\bclog(?:s)?\b/i,
    /\bslide(?:s)?\b/i,
    /\bflip[\s-]?flop(?:s)?\b/i,
    /\boxford(?:s)?\b/i,
    /\bderb(?:y|ies)\b/i,
    /\bbrogue(?:s)?\b/i,
    /\bespadrille(?:s)?\b/i,
    /\bmoccasin(?:s)?\b/i,
    /\bmary[\s-]?jane(?:s)?\b/i,
    /\bcourt[\s-]?shoe(?:s)?\b/i,
    /\brunning[\s-]?shoe(?:s)?\b/i,
    /\bbasketball[\s-]?shoe(?:s)?\b/i,
    /\bhiking[\s-]?shoe(?:s)?\b/i,
    /\bwalking[\s-]?shoe(?:s)?\b/i,
    /\bsoccer[\s-]?shoe(?:s)?\b/i,
    /\btennis[\s-]?shoe(?:s)?\b/i,
    /\bskate[\s-]?shoe(?:s)?\b/i,
  ]

  function classifyProduct(name, rowText = '') {
    const text = `${name || ''} ${rowText || ''}`.replace(/\s+/g, ' ').trim()
    return SHOE_KEYWORD_PATTERNS.some(pattern => pattern.test(text)) ? 'shoes' : 'clothing'
  }

  function parseSpu(text) {
    const match = String(text || '').match(/SPU[:：]\s*(\d+)/i)
    return match ? match[1] : ''
  }

  function cleanProductName(text) {
    return String(text || '')
      .replace(/^预览\s*/, '')
      .replace(/\s*SPU[:：]\s*\d+\s*$/i, '')
      .trim()
  }

  function getProcessedMap() {
    return shared.processed_spus && typeof shared.processed_spus === 'object'
      ? shared.processed_spus
      : {}
  }

  function buildResult(row, status, reason, extras = {}) {
    return {
      执行序号: Number(shared.processed_count || 0) + 1,
      快速筛选: shared.scope_name || '',
      SPU: row?.spu || shared.current_spu || '',
      商品名称: row?.name || shared.current_name || '',
      商品分类判断: productKindLabel(row?.product_kind || shared.product_kind || ''),
      操作按钮: row?.actionText || shared.current_action_text || '',
      当前识别状态: row?.status || shared.current_status_text || '',
      售卖影响及建议: row?.suggestion || shared.current_suggestion || '',
      处理结果: resultStatusLabel(status),
      原因: reason,
      主体标签图文件数: Number(shared.subject_asset_count || 0),
      外包装标签图文件数: Number(shared.package_asset_count || 0),
      ...extras,
    }
  }

  function emitRowResult(row, status, reason, extras = {}, sleepMs = 1200, overrides = {}) {
    const processedSpus = { ...getProcessedMap() }
    if (row?.spu) processedSpus[row.spu] = 1
    const processedCount = Number(shared.processed_count || 0) + 1
    const limitReached = hasReachedLimit(processedCount)

    return {
      success: true,
      data: [buildResult(row, status, reason, extras)],
      meta: {
        action: 'next_phase',
        next_phase: limitReached ? 'complete_run' : 'pick_row',
        sleep_ms: sleepMs,
        shared: {
          ...shared,
          processed_spus: processedSpus,
          processed_count: processedCount,
          current_exec_no: processedCount,
          current_row_no: processedCount,
          current_buyer_id: row?.spu || '',
          current_store: shared.scope_name || '',
          current_row_text: '',
          current_spu: '',
          current_name: '',
          current_action_text: '',
          current_status_text: '',
          current_suggestion: '',
          current_priority: false,
          product_kind: '',
          subject_before: 0,
          package_before: 0,
          subject_asset_count: 0,
          package_asset_count: 0,
          row_retry: 0,
          open_retry: 0,
          scope_retry: 0,
          upload_retry: 0,
          query_retry: 0,
          field_retry: 0,
          submit_retry: 0,
          confirm_retry: 0,
          deep_request_retry: 0,
          deep_recognition_request_count: 0,
          deep_recognition_requested_at: 0,
          confirm_clicked_at: 0,
          confirm_click_count: 0,
          toast_retry: 0,
          cleanup_retry: 0,
          page_signature: '',
          ...overrides,
        },
      },
    }
  }

  function currentPageNo() {
    const active = document.querySelector('li.rocket-pagination-item-active')
    const value = parseInt(textOf(active), 10)
    return Number.isFinite(value) && value > 0 ? value : 1
  }

  function pageSignature() {
    const rows = getProductRows().slice(0, 4)
    return `${currentPageNo()}::${rows.map(row => `${row.spu}:${row.status}:${row.suggestion.slice(0, 24)}`).join('||')}`
  }

  async function waitPageChange(oldSignature, timeout = 10000, baselinePageNo = null) {
    const startedAt = Date.now()
    const baseline = baselinePageNo == null ? null : Number(baselinePageNo)
    while (Date.now() - startedAt < timeout) {
      await sleep(300)
      const currentPage = currentPageNo()
      if (baseline != null && currentPage !== baseline) {
        return true
      }
      const current = pageSignature()
      if (current && current !== oldSignature) return true
    }
    return false
  }

  async function waitForTable(timeout = 15000) {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeout) {
      if (getProductRows().length > 0) return true
      await sleep(500)
    }
    return false
  }

  function getTargetReadyState() {
    const quickFilterHits = QUICK_FILTERS.map(label => ({
      label,
      found: !!findQuickFilterTab(label),
    }))

    return {
      hasStatusFilter: !!getGoodsStatusSelect(),
      hasQueryButton: !!findQueryButton(),
      quickFilterHits,
      hasQuickFilter: quickFilterHits.some(item => item.found),
    }
  }

  async function waitForTargetReady(timeout = 15000) {
    const startedAt = Date.now()
    let lastState = getTargetReadyState()
    while (Date.now() - startedAt < timeout) {
      lastState = getTargetReadyState()
      if (lastState.hasStatusFilter && lastState.hasQuickFilter) {
        return { ready: true, ...lastState }
      }
      await sleep(500)
    }
    return { ready: false, ...lastState }
  }

  function getProductRows() {
    return [...document.querySelectorAll('table tbody tr')]
      .map(tr => {
        const cells = [...tr.querySelectorAll('td')]
        const actionButton = [...tr.querySelectorAll('button')].find(btn => visible(btn) && ROW_ACTION_TEXTS.includes(textOf(btn)))
        if (!cells.length || !actionButton) return null

        const cellTexts = cells.map(td => textOf(td))
        const productCellText = cellTexts[0] || ''
        const spu = parseSpu(productCellText)
        if (!spu) return null

        return {
          tr,
          spu,
          name: cleanProductName(productCellText),
          product_kind: classifyProduct(productCellText, tr.innerText || ''),
          actionButton,
          actionText: textOf(actionButton),
          requirementType: cellTexts[1] || '',
          checkType: cellTexts[2] || '',
          status: cellTexts[3] || '',
          suggestion: cellTexts[4] || '',
          sensitiveResult: cellTexts[5] || '',
          rowText: textOf(tr),
        }
      })
      .filter(Boolean)
  }

  function isProcessableStatus(row) {
    const status = compact(row?.status || '')
    if (!status) return true
    if (/识别成功|深度识别中/.test(status)) return false
    return true
  }

  function isUrgentRow(row) {
    return String(row?.suggestion || '').includes(URGENT_TEXT) || String(row?.suggestion || '').includes('避免影响商品发货入库')
  }

  function chooseCandidate(rows) {
    const processed = getProcessedMap()
    const eligible = rows.filter(row =>
      row?.spu &&
      !processed[row.spu] &&
      isProcessableStatus(row) &&
      ROW_ACTION_TEXTS.includes(row.actionText)
    )

    if (!eligible.length) return null

    return [...eligible].sort((left, right) => {
      const urgentDiff = Number(isUrgentRow(right)) - Number(isUrgentRow(left))
      if (urgentDiff) return urgentDiff
      const uploadDiff = Number(right.actionText === '上传') - Number(left.actionText === '上传')
      if (uploadDiff) return uploadDiff
      return String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN')
    })[0]
  }

  function findQuickFilterTab(scopeName) {
    const normalizedScope = compact(scopeName)
    return [...document.querySelectorAll('div,button,span,a,li')]
      .filter(visible)
      .map(el => ({
        el,
        text: compact(textOf(el)),
        rawText: textOf(el),
        box: boxOf(el),
        style: styleOf(el),
        className: String(el.className || ''),
        role: String(el.getAttribute?.('role') || ''),
      }))
      .filter(item => item.box && item.box.w >= 80 && item.box.w <= 1200 && item.box.h >= 24 && item.box.h <= 100)
      .filter(item => item.text === normalizedScope || item.text.includes(normalizedScope))
      .map(item => {
        let score = 0
        const crossScopeMentions = QUICK_FILTERS.filter(label => label !== scopeName && compact(item.rawText).includes(compact(label))).length
        if (item.text === normalizedScope) score += 220
        if (item.text.startsWith(normalizedScope)) score += 120
        if (item.text.length <= normalizedScope.length + 12) score += 100
        if (item.style?.cursor === 'pointer') score += 200
        if (normalizeColor(item.style?.borderColor).includes('64,124,255')) score += 120
        if (/button|tab|item/i.test(item.className)) score += 30
        if (/button/i.test(item.role)) score += 30
        if (crossScopeMentions) score -= crossScopeMentions * 1000
        score += Math.max(0, 240 - Math.abs((item.box?.w || 0) - 180))
        return { ...item, score }
      })
      .sort((left, right) => right.score - left.score)[0]?.el || null
  }

  function hasNextPage() {
    const current = currentPageNo()
    const nextPageItem = findPageItem(current + 1)
    if (nextPageItem && !String(nextPageItem.className || '').includes('rocket-pagination-item-disabled')) {
      return true
    }
    const next = document.querySelector('li.rocket-pagination-next')
    return !!(next && !String(next.className || '').includes('rocket-pagination-disabled'))
  }

  function findPageItem(pageNo) {
    return document.querySelector(`li.rocket-pagination-item-${pageNo}`) || null
  }

  function nextPageClick() {
    const nextPageItem = findPageItem(currentPageNo() + 1)
    const pageItemTarget = nextPageItem?.querySelector('a,button') || nextPageItem
    if (pageItemTarget) return centerClick(pageItemTarget, 120)

    const next = document.querySelector('li.rocket-pagination-next')
    const target = next?.querySelector('a,button') || next
    return centerClick(target, 120)
  }

  async function waitForNextPageAvailability(timeout = 10000) {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeout) {
      if (hasNextPage()) return true
      await sleep(300)
    }
    return false
  }

  function firstPageClick() {
    const pageOne = findPageItem(1)
    const target = pageOne?.querySelector('a,button') || pageOne
    return centerClick(target, 120)
  }

  function getOpenDrawer() {
    const seen = new Set()
    const candidates = []

    for (const selector of DRAWER_CANDIDATE_SELECTORS) {
      for (const el of document.querySelectorAll(selector)) {
        if (seen.has(el)) continue
        seen.add(el)

        const box = boxOf(el)
        if (!visible(el) || !box || box.w <= 200 || box.h <= 120) continue

        const text = textOf(el)
        let score = 0
        if (selector === '.rocket-drawer.rocket-drawer-open') score += 320
        if (el.matches?.('.rocket-drawer.rocket-drawer-open')) score += 180
        if (el.closest?.('.rocket-drawer.rocket-drawer-open')) score += 120
        if (text.includes('上传并识别')) score += 260
        if (text.includes('商品主体实拍图') || text.includes('商品外包装实拍图')) score += 240
        if (/SPU\s*ID/i.test(text) || text.includes('商品信息') || text.includes('商品名称')) score += 120
        score += Math.min(140, Math.floor(text.length / 8))
        score += Math.min(120, Math.floor(box.w / 10))
        score += Math.max(0, parseZIndex(styleOf(el)?.zIndex))

        candidates.push({ el, box, score })
      }
    }

    return candidates
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score
        if (right.box.w !== left.box.w) return right.box.w - left.box.w
        if (right.box.h !== left.box.h) return right.box.h - left.box.h
        return left.box.x - right.box.x
      })[0]?.el || null
  }

  function readDrawerState(spu) {
    const drawer = getOpenDrawer()
    if (!drawer) {
      return {
        drawer: null,
        hasVisibleDrawer: false,
        hasSpu: false,
        hasProductInfo: false,
        hasUploadButton: false,
        hasSubjectSection: false,
        hasPackageSection: false,
        hasUploadSection: false,
        hasFileInput: false,
        ready: false,
      }
    }

    const text = textOf(drawer)
    const normalizedSpu = compact(spu)
    const hasSpu = normalizedSpu ? compact(text).includes(normalizedSpu) : false
    const hasProductInfo = /SPU\s*ID/i.test(text) || text.includes('商品信息') || text.includes('商品名称')
    const hasUploadButton = [...drawer.querySelectorAll('button,span,div,a,[role="button"]')]
      .some(el => visible(el) && compact(textOf(el)) === compact('上传并识别'))
    const hasSubjectSection = text.includes('商品主体实拍图')
    const hasPackageSection = text.includes('商品外包装实拍图')
    const hasUploadSection = hasSubjectSection || hasPackageSection
    const hasFileInput = !!drawer.querySelector('input[type=file]')

    return {
      drawer,
      hasVisibleDrawer: true,
      hasSpu,
      hasProductInfo,
      hasUploadButton,
      hasSubjectSection,
      hasPackageSection,
      hasUploadSection,
      hasFileInput,
      ready: hasUploadSection || hasUploadButton || hasFileInput || (hasProductInfo && hasSpu),
    }
  }

  function isDrawerOpenForSpu(spu) {
    return readDrawerState(spu).ready
  }

  function drawerStateSummary(state) {
    if (!state?.hasVisibleDrawer) return 'drawer=未出现'
    return [
      'drawer=已出现',
      `spu=${state.hasSpu ? 'yes' : 'no'}`,
      `商品信息=${state.hasProductInfo ? 'yes' : 'no'}`,
      `上传按钮=${state.hasUploadButton ? 'yes' : 'no'}`,
      `上传区=${state.hasUploadSection ? 'yes' : 'no'}`,
      `file=${state.hasFileInput ? 'yes' : 'no'}`,
    ].join('，')
  }

  function findUploadLabel(input) {
    let current = input?.parentElement || null
    while (current && current !== document.body) {
      const text = textOf(current)
      if (/^(正视图|侧视图|标签图|其他)\s*\(\d+\/\d+\)$/.test(text)) return text
      current = current.parentElement
    }
    return ''
  }

  function getDrawerFileInputs() {
    const drawer = getOpenDrawer()
    const scope = drawer || document
    return [...scope.querySelectorAll('input[type=file]')]
  }

  function findUploadSection(input) {
    let current = input?.parentElement || null
    while (current && current !== document.body) {
      const text = textOf(current)
      if (text.includes('商品外包装实拍图')) return '商品外包装实拍图'
      if (text.includes('商品主体实拍图')) return '商品主体实拍图'
      current = current.parentElement
    }
    return ''
  }

  function parseCountMeta(labelText) {
    const match = String(labelText || '').match(/\((\d+)\s*\/\s*(\d+)\)/)
    return {
      count: match ? Number(match[1]) : 0,
      max: match ? Number(match[2]) : 0,
    }
  }

  function getUploadFilledCount(field) {
    if (!field) return 0
    return Math.max(
      Number(field.count || 0),
      Number(field.previewCount || 0),
      field.hasSuccess ? 1 : 0,
    )
  }

  function findUploadField(sectionText, slotName) {
    const drawer = getOpenDrawer()
    if (!drawer) return null

    const slotLabelPattern = /^(正视图|侧视图|标签图|其他)\s*\((\d+)\s*\/\s*(\d+)\)$/
    const labelMap = new Map()
    const labelNodes = [...drawer.querySelectorAll('div,span,p,li,label,strong')]

    for (const el of labelNodes) {
      if (!visible(el)) continue
      const label = textOf(el)
      const match = label.match(slotLabelPattern)
      if (!match) continue
      if (findUploadSection(el) !== sectionText) continue
      const box = boxOf(el)
      if (!box) continue
      const prev = labelMap.get(label)
      const area = box.w * box.h
      const prevArea = prev ? prev.box.w * prev.box.h : Number.POSITIVE_INFINITY
      if (!prev || area < prevArea) {
        labelMap.set(label, {
          el,
          label,
          slot: match[1],
          box,
        })
      }
    }

    const orderedLabels = [...labelMap.values()]
      .sort((left, right) => (left.box.y - right.box.y) || (left.box.x - right.box.x))
    const target = orderedLabels.find(item => item.slot === slotName)
    if (!target) return null

    const row = target.el.closest('.rocket-row.rocket-form-field-item') ||
      target.el.closest('.rocket-row') ||
      target.el.parentElement ||
      null
    const previewCount = row ? row.querySelectorAll('img.rocket-image-img').length : 0
    const hasSuccess = !!row?.classList?.contains('rocket-form-field-item-has-success')

    let current = target.el
    while (current && current !== drawer.parentElement) {
      const scopedInputs = [...current.querySelectorAll('input[type=file]')]
        .filter(input => findUploadSection(input) === sectionText)
      if (scopedInputs.length === 1) {
        const meta = parseCountMeta(target.label)
        return {
          input: scopedInputs[0],
          section: sectionText,
          label: target.label,
          count: meta.count,
          max: meta.max,
          row,
          previewCount,
          hasSuccess,
          filledCount: getUploadFilledCount({ count: meta.count, previewCount, hasSuccess }),
        }
      }
      current = current.parentElement
    }

    const sectionInputs = getDrawerFileInputs()
      .filter(input => findUploadSection(input) === sectionText)
    const slotIndex = orderedLabels.findIndex(item => item.label === target.label)
    const input = slotIndex >= 0 ? sectionInputs[slotIndex] : null
    if (input) {
      const meta = parseCountMeta(target.label)
      return {
        input,
        section: sectionText,
        label: target.label,
        count: meta.count,
        max: meta.max,
        row,
        previewCount,
        hasSuccess,
        filledCount: getUploadFilledCount({ count: meta.count, previewCount, hasSuccess }),
      }
    }

    return null
  }

  function tagUploadField(input, key) {
    if (!input || !key) return ''
    input.setAttribute(FILE_INPUT_MARK, key)
    return `input[${FILE_INPUT_MARK}="${key}"]`
  }

  function findVisibleButtonByText(targetText, options = {}) {
    const normalizedTarget = compact(targetText)
    const preferPrimary = options.preferPrimary !== false
    const preferRight = !!options.preferRight
    const preferDrawer = options.preferDrawer !== false
    const minimumY = Number(options.minY || 0)
    const drawer = preferDrawer ? getOpenDrawer() : null

    const candidates = [...document.querySelectorAll('button,span,div,a,[role="button"]')]
      .filter(visible)
      .map(el => ({
        el,
        text: compact(textOf(el)),
        rawText: textOf(el),
        box: boxOf(el),
        className: String(el.className || ''),
        tagName: String(el.tagName || ''),
        insideDrawer: !!(drawer && drawer.contains(el)),
      }))
      .filter(item => item.box && item.text === normalizedTarget)
      .filter(item => item.box.y >= minimumY)
      .map(item => {
        let score = 0
        if (item.tagName === 'BUTTON') score += 80
        if (/primary/i.test(item.className)) score += preferPrimary ? 80 : 10
        if (/btn/i.test(item.className)) score += 20
        if (item.insideDrawer) score += 180
        if (preferRight) score += item.box.x
        score += item.box.w + item.box.h
        return { ...item, score }
      })
      .sort((left, right) => right.score - left.score)

    return candidates[0]?.el || null
  }

  function getVisibleDialogs() {
    return [...document.querySelectorAll(OVERLAY_SELECTOR)]
      .filter(visible)
      .map(el => ({
        el,
        text: textOf(el),
        box: boxOf(el),
        zIndex: parseZIndex(styleOf(el)?.zIndex),
        order: domSiblingOrder(el),
        isModal: el.matches('.rocket-modal, .rocket-dialog, [role="dialog"], .rocket-modal-wrap'),
      }))
      .filter(item => item.text || item.box)
  }

  function findDialogByTextPatterns(patterns = []) {
    if (!patterns.length) return null
    const normalizedPatterns = patterns.map(item => String(item || '').trim()).filter(Boolean)
    return getVisibleDialogs()
      .filter(item => normalizedPatterns.every(pattern => item.text.includes(pattern)))
      .sort((left, right) => {
        if (right.zIndex !== left.zIndex) return right.zIndex - left.zIndex
        if (right.isModal !== left.isModal) return Number(right.isModal) - Number(left.isModal)
        const leftArea = (left.box?.w || 0) * (left.box?.h || 0)
        const rightArea = (right.box?.w || 0) * (right.box?.h || 0)
        if (rightArea !== leftArea) return rightArea - leftArea
        return right.order - left.order
      })[0]?.el || null
  }

  function findScopedButtonByText(scope, targetText, options = {}) {
    if (!scope) return null
    const normalizedTarget = compact(targetText)
    const preferPrimary = options.preferPrimary !== false
    const preferActionArea = options.preferActionArea !== false
    const allowContains = !!options.allowContains

    const candidates = [...scope.querySelectorAll('button,span,div,a,[role="button"]')]
      .filter(visible)
      .map(el => ({
        el,
        text: compact(textOf(el)),
        rawText: textOf(el),
        box: boxOf(el),
        className: String(el.className || ''),
        tagName: String(el.tagName || ''),
        role: String(el.getAttribute?.('role') || ''),
      }))
      .filter(item => item.box && (allowContains ? item.text.includes(normalizedTarget) : item.text === normalizedTarget))
      .map(item => {
        const clickable = resolveClickableElement(item.el) || item.el
        const clickableBox = boxOf(clickable) || item.box
        const clickableClass = String(clickable.className || '')
        const clickableRole = String(clickable.getAttribute?.('role') || '')
        const clickableText = compact(textOf(clickable))
        let score = 0
        if (clickable.tagName === 'BUTTON') score += 160
        if (clickable.tagName === 'A') score += 120
        if (clickableRole === 'button') score += 140
        if (/primary/i.test(clickableClass)) score += preferPrimary ? 100 : 20
        if (/(^|\s)(btn|button|action|confirm|ok|submit|link)(\s|$)/i.test(clickableClass)) score += 60
        if (preferActionArea && clickable.closest('.rocket-modal-footer, .rocket-drawer-footer, .ant-modal-footer, .modal-footer, [class*="footer"]')) score += 60
        if (clickable.closest('.rocket-modal-body, .rocket-dialog-body, .rocket-drawer-body, [role="dialog"]')) score += 20
        if (styleOf(clickable)?.cursor === 'pointer') score += 30
        if (clickableText === normalizedTarget) score += 30
        if (clickable !== item.el) score += 10
        if (clickable.hasAttribute?.('disabled') || clickable.getAttribute?.('aria-disabled') === 'true') score -= 200
        score += Math.min(20, (clickableBox.w || 0) / 20)
        return { ...item, el: clickable, box: clickableBox, score }
      })
      .sort((left, right) => right.score - left.score || left.box.y - right.box.y || left.box.x - right.box.x)

    return candidates[0]?.el || null
  }

  function findDeepRecognitionDialog() {
    return findDialogByTextPatterns(['识别结果有异常']) ||
      findDialogByTextPatterns(['申请深度识别']) ||
      findDialogByTextPatterns(['深度识别'])
  }

  function findUploadLaterDialog() {
    return findDialogByTextPatterns(['先传图，稍后再传资质']) ||
      findDialogByTextPatterns(['稍后再传资质']) ||
      findDialogByTextPatterns(['先去上传资质'])
  }

  function findUploadLaterButton() {
    const dialog = findUploadLaterDialog()
    return findScopedButtonByText(dialog, '先传图，稍后再传资质', { preferPrimary: false, preferActionArea: true }) ||
      findScopedButtonByText(dialog, '稍后再传资质', { preferPrimary: false, preferActionArea: true, allowContains: true })
  }

  function findSaveLivePhotosDialog() {
    return findDialogByTextPatterns(['保存实拍图，暂不处理异常']) ||
      findDialogByTextPatterns(['暂不处理异常', '立即修改']) ||
      findDialogByTextPatterns(['识别结果有异常', '防止影响商品售卖'])
  }

  function findSaveLivePhotosButton() {
    const dialog = findSaveLivePhotosDialog()
    return findScopedButtonByText(dialog, '保存实拍图，暂不处理异常', { preferPrimary: false, preferActionArea: true }) ||
      findScopedButtonByText(dialog, '暂不处理异常', { preferPrimary: false, preferActionArea: true, allowContains: true })
  }

  function findDeepRecognitionButton() {
    const dialog = findDeepRecognitionDialog()
    return findScopedButtonByText(dialog, '深度识别', { preferPrimary: false, preferActionArea: true }) ||
      (dialog ? null : findVisibleButtonByText('深度识别', { preferPrimary: false, preferDrawer: false }))
  }

  function findDeepRecognitionConfirmDialog() {
    return findDialogByTextPatterns(['确定要申请深度识别吗']) ||
      findDialogByTextPatterns(['深度识别耗时较长']) ||
      findDialogByTextPatterns(['请谨慎选择'])
  }

  function findDeepRecognitionConfirmButton() {
    const dialog = findDeepRecognitionConfirmDialog()
    return findScopedButtonByText(dialog, '确定', { preferPrimary: true, preferActionArea: true })
  }

  function hasOperationTooFrequentToast() {
    return [...document.querySelectorAll('.rocket-message, .rocket-message-notice, [role="alert"]')]
      .filter(visible)
      .some(el => {
        const text = textOf(el)
        return text.includes('操作过于频繁') || text.includes('请稍后再试')
      })
  }

  function findQueryButton() {
    const normalizedTarget = compact('查询')
    const field = getGoodsStatusSelect()
    const scopes = []
    let current = field?.selector?.parentElement || field?.select?.parentElement || field?.input?.parentElement || null

    while (current && current !== document.body && scopes.length < 6) {
      scopes.push(current)
      current = current.parentElement
    }

    for (const scope of scopes) {
      const candidates = [...scope.querySelectorAll('button,span,div,a,[role="button"]')]
        .filter(visible)
        .map(el => ({
          el,
          text: compact(textOf(el)),
          box: boxOf(el),
          className: String(el.className || ''),
          tagName: String(el.tagName || ''),
          role: String(el.getAttribute?.('role') || ''),
          style: styleOf(el),
        }))
        .filter(item => item.box && item.box.w >= 40 && item.box.w <= 420 && item.box.h >= 24 && item.box.h <= 90)
        .filter(item => item.text === normalizedTarget)
        .map(item => {
          let score = 0
          if (item.tagName === 'BUTTON') score += 80
          if (/primary/i.test(item.className)) score += 80
          if (item.style?.cursor === 'pointer') score += 120
          if (normalizeColor(item.style?.borderColor).includes('64,124,255')) score += 60
          score += Math.max(0, 220 - Math.abs((item.box?.x || 0) - 1080))
          return { ...item, score }
        })
        .sort((left, right) => right.score - left.score)

      if (candidates[0]?.el) return candidates[0].el
    }

    return findVisibleButtonByText('查询', { preferPrimary: true, preferRight: true, preferDrawer: false, minY: -500 })
  }

  function getGoodsStatusSelect() {
    const input = document.querySelector('#goodsStatusList')
    const select = input?.closest('.rocket-select') || null
    const selector = select?.querySelector('.rocket-select-selector') || input || null
    return input && select && selector ? { input, select, selector } : null
  }

  function readGoodsStatusSelections() {
    const field = getGoodsStatusSelect()
    if (!field) return []
    return [...field.select.querySelectorAll('.rocket-select-selection-item-content')]
      .map(el => textOf(el))
      .filter(Boolean)
  }

  function isGoodsStatusDropdownOpen() {
    const field = getGoodsStatusSelect()
    return !!field?.select?.classList?.contains('rocket-select-open')
  }

  function findGoodsStatusOption(label) {
    return [...document.querySelectorAll('.rocket-select-dropdown .rocket-select-item-option')]
      .find(el => visible(el) && textOf(el) === String(label || '').trim()) || null
  }

  function findGoodsStatusRemove(label) {
    const field = getGoodsStatusSelect()
    if (!field) return null
    const item = [...field.select.querySelectorAll('.rocket-select-selection-item')]
      .find(el => {
        const content = textOf(el.querySelector('.rocket-select-selection-item-content'))
        return content === String(label || '').trim()
      }) || null
    return item?.querySelector('.rocket-select-selection-item-remove') || null
  }

  function goodsStatusSelectorClick() {
    const field = getGoodsStatusSelect()
    return centerClick(field?.selector, 120)
  }

  function queryButtonClick() {
    const button = findQueryButton()
    return centerClick(button, 120)
  }

  try {
    if (phase === 'main') {
      return nextPhase('ensure_target', 0, {
        scope_index: 0,
        scope_name: QUICK_FILTERS[0],
        processed_spus: {},
        processed_count: 0,
        total_rows: maxProducts(),
        current_exec_no: 0,
        current_row_no: 0,
        current_buyer_id: '',
        current_store: '',
        current_spu: '',
        current_name: '',
        current_action_text: '',
        current_status_text: '',
        current_suggestion: '',
        current_priority: false,
        product_kind: '',
        subject_before: 0,
        package_before: 0,
        subject_asset_count: 0,
        package_asset_count: 0,
        page_signature: '',
        scope_retry: 0,
        open_retry: 0,
        upload_retry: 0,
        query_retry: 0,
        field_retry: 0,
        submit_retry: 0,
        confirm_retry: 0,
        deep_request_retry: 0,
        deep_recognition_request_count: 0,
        deep_recognition_requested_at: 0,
        confirm_clicked_at: 0,
        confirm_click_count: 0,
        toast_retry: 0,
        cleanup_retry: 0,
      })
    }

    if (phase === 'ensure_target') {
      if (!location.href.startsWith(TARGET_URL)) {
        location.href = TARGET_URL
        return nextPhase('ensure_target', mode === 'new' ? 2200 : 1600, shared)
      }
      const ready = await waitForTargetReady(15000)
      if (!ready.ready) {
        const missing = []
        if (!ready.hasStatusFilter) missing.push('商品状态控件')
        if (!ready.hasQuickFilter) {
          const missingQuickFilters = (ready.quickFilterHits || [])
            .filter(item => !item.found)
            .map(item => item.label)
          missing.push(missingQuickFilters.length ? `快速筛选(${missingQuickFilters.join('/')})` : '快速筛选')
        }
        return fail(`Temu 商品实拍图列表加载超时，缺少：${missing.join('、') || '未知条件'}；请确认页面已登录且可正常打开`)
      }
      return nextPhase('apply_goods_status_filter', 100, shared)
    }

    if (phase === 'apply_goods_status_filter') {
      const desired = desiredGoodsStatuses()
      const current = readGoodsStatusSelections()

      const extra = current.find(label => !desired.includes(label))
      if (extra) {
        const remove = findGoodsStatusRemove(extra)
        const click = centerClick(remove, 100)
        if (!click) return fail(`未找到商品状态移除按钮: ${extra}`)
        return cdpClicks([click], 'apply_goods_status_filter', 280, shared)
      }

      const missing = desired.find(label => !current.includes(label))
      if (missing) {
        if (!isGoodsStatusDropdownOpen()) {
          const openClick = goodsStatusSelectorClick()
          if (!openClick) return fail('未找到商品状态筛选控件')
          return cdpClicks([openClick], 'apply_goods_status_filter', 260, shared)
        }
        const option = findGoodsStatusOption(missing)
        const click = centerClick(option, 100)
        if (!click) return fail(`未找到商品状态选项: ${missing}`)
        return cdpClicks([click], 'apply_goods_status_filter', 280, shared)
      }

      if (isGoodsStatusDropdownOpen()) {
        const closeClick = goodsStatusSelectorClick()
        if (!closeClick) return fail('未找到商品状态筛选控件关闭坐标')
        return cdpClicks([closeClick], 'submit_goods_status_filter_query', 220, shared)
      }

      return nextPhase('submit_goods_status_filter_query', 0, shared)
    }

    if (phase === 'submit_goods_status_filter_query') {
      const button = findQueryButton()
      if (!button) {
        const retry = Number(shared.query_retry || 0)
        if (retry < 12) {
          return nextPhase('submit_goods_status_filter_query', 700, {
            ...shared,
            query_retry: retry + 1,
          })
        }
        return fail('未找到商品状态筛选后的“查询”按钮')
      }
      const click = centerClick(button, 120)
      if (!click) {
        if (clickLike(button)) {
          return nextPhase('wait_goods_status_filter_query', 700, {
            ...shared,
            page_signature: pageSignature(),
            scope_index: 0,
            scope_name: QUICK_FILTERS[0],
            query_retry: 0,
          })
        }
        const retry = Number(shared.query_retry || 0)
        if (retry < 12) {
          return nextPhase('submit_goods_status_filter_query', 700, {
            ...shared,
            query_retry: retry + 1,
          })
        }
        return fail('未找到商品状态筛选后的“查询”按钮')
      }
      return cdpClicks([click], 'wait_goods_status_filter_query', 700, {
        ...shared,
        page_signature: pageSignature(),
        scope_index: 0,
        scope_name: QUICK_FILTERS[0],
        query_retry: 0,
      })
    }

    if (phase === 'wait_goods_status_filter_query') {
      const previousSignature = String(shared.page_signature || '')
      if (previousSignature) {
        await waitPageChange(previousSignature, 4500)
      }
      return nextPhase('switch_scope', 1200, {
        ...shared,
        scope_index: 0,
        scope_name: QUICK_FILTERS[0],
        page_signature: '',
        query_retry: 0,
      })
    }

    if (phase === 'switch_scope') {
      if (hasReachedLimit(Number(shared.processed_count || 0))) {
        return nextPhase('complete_run', 0, shared)
      }

      const scopeIndex = Number(shared.scope_index || 0)
      if (scopeIndex >= QUICK_FILTERS.length) {
        return nextPhase('complete_run', 0, shared)
      }

      const scopeName = QUICK_FILTERS[scopeIndex]
      const tab = findQuickFilterTab(scopeName)
      if (!tab) {
        return nextPhase('advance_scope', 0, {
          ...shared,
          scope_name: scopeName,
        })
      }

      const click = centerClick(tab, 120)
      if (!click) {
        return nextPhase('advance_scope', 0, {
          ...shared,
          scope_name: scopeName,
        })
      }

      return cdpClicks([click], 'ensure_first_page', 800, {
        ...shared,
        scope_name: scopeName,
        scope_retry: 0,
        page_signature: pageSignature(),
      })
    }

    if (phase === 'ensure_first_page') {
      const pageNo = currentPageNo()
      if (pageNo <= 1) return nextPhase('pick_row', 100, shared)

      const pageOne = findPageItem(1)
      const target = pageOne?.querySelector('a,button') || pageOne
      if (clickLike(target)) {
        return nextPhase('wait_page_reset', 600, {
          ...shared,
          page_no: pageNo,
          page_signature: pageSignature(),
        })
      }

      const click = firstPageClick()
      if (!click) return fail('未找到分页第一页按钮，无法重置到列表首页')
      return cdpClicks([click], 'wait_page_reset', 1200, {
        ...shared,
        page_no: pageNo,
        page_signature: pageSignature(),
      })
    }

    if (phase === 'wait_page_reset') {
      const baselinePageNo = Number(shared.page_no || 0)
      if (currentPageNo() <= 1) return nextPhase('pick_row', 200, shared)
      const changed = await waitPageChange(String(shared.page_signature || ''), 6000, baselinePageNo)
      if (changed) return nextPhase('pick_row', 100, shared)
      return fail('切换回第一页超时，分页状态未更新')
    }

    if (phase === 'pick_row') {
      if (hasReachedLimit(Number(shared.processed_count || 0))) {
        return nextPhase('complete_run', 0, shared)
      }

      const rows = getProductRows()
      if (!rows.length) {
        const retry = Number(shared.scope_retry || 0)
        const tableReady = await waitForTable(1200)
        if (tableReady) {
          return nextPhase('pick_row', 150, {
            ...shared,
            scope_retry: 0,
          })
        }
        if (retry < 8) {
          return nextPhase('pick_row', 700, {
            ...shared,
            scope_retry: retry + 1,
          })
        }
      }

      const candidate = chooseCandidate(rows)
      if (candidate) {
        const nextCount = Number(shared.processed_count || 0) + 1
        const kind = String(candidate.product_kind || classifyProduct(candidate.name, candidate.rowText))
        const request = getUploadRequest(kind)
        if (!request.subjectRequested && !request.packageRequested) {
          return emitRowResult(
            {
              ...candidate,
              product_kind: kind,
            },
            'skipped',
            `${productKindLabel(kind)}未提供任何标签图素材，已跳过`,
          )
        }
        return nextPhase('open_row', 100, {
          ...shared,
          current_exec_no: nextCount,
          current_row_no: nextCount,
          current_buyer_id: candidate.spu,
          current_store: shared.scope_name || '',
          current_row_text: candidate.rowText || '',
          current_spu: candidate.spu,
          current_name: candidate.name,
          current_action_text: candidate.actionText,
          current_status_text: candidate.status,
          current_suggestion: candidate.suggestion,
          current_priority: isUrgentRow(candidate),
          product_kind: kind,
          scope_retry: 0,
          open_retry: 0,
          upload_retry: 0,
          field_retry: 0,
          submit_retry: 0,
          confirm_retry: 0,
          deep_request_retry: 0,
          deep_recognition_request_count: 0,
          deep_recognition_requested_at: 0,
          confirm_clicked_at: 0,
          confirm_click_count: 0,
          toast_retry: 0,
          cleanup_retry: 0,
        })
      }

      const hasMorePages = await waitForNextPageAvailability(10000)
      if (hasMorePages) {
        const currentPageNoValue = currentPageNo()
        const nextPageItem = findPageItem(currentPageNoValue + 1)
        const target = nextPageItem?.querySelector('a,button') || nextPageItem || document.querySelector('li.rocket-pagination-next')?.querySelector('a,button') || document.querySelector('li.rocket-pagination-next')
        if (clickLike(target)) {
          return nextPhase('wait_next_page', 600, {
            ...shared,
            page_no: currentPageNoValue,
            page_signature: pageSignature(),
          })
        }

        const click = nextPageClick()
        if (!click) return fail('分页存在下一页，但未找到下一页按钮坐标')
        return cdpClicks([click], 'wait_next_page', 1200, {
          ...shared,
          page_no: currentPageNoValue,
          page_signature: pageSignature(),
        })
      }

      return nextPhase('advance_scope', 0, shared)
    }

    if (phase === 'wait_next_page') {
      const baselinePageNo = Number(shared.page_no || 0)
      if (baselinePageNo > 0 && currentPageNo() !== baselinePageNo) {
        return nextPhase('pick_row', 200, shared)
      }
      const changed = await waitPageChange(String(shared.page_signature || ''), 12000, baselinePageNo)
      if (!changed) return fail('翻到下一页超时，列表未刷新')
      return nextPhase('pick_row', 200, shared)
    }

    if (phase === 'advance_scope') {
      const nextScopeIndex = Number(shared.scope_index || 0) + 1
      if (nextScopeIndex >= QUICK_FILTERS.length) {
        return nextPhase('complete_run', 0, {
          ...shared,
          scope_index: nextScopeIndex,
        })
      }
      return nextPhase('switch_scope', 0, {
        ...shared,
        scope_index: nextScopeIndex,
        scope_name: QUICK_FILTERS[nextScopeIndex],
        page_signature: '',
        query_retry: 0,
      })
    }

    if (phase === 'open_row') {
      const row = getProductRows().find(item => item.spu === String(shared.current_spu || ''))
      if (!row) {
        const retry = Number(shared.row_retry || 0)
        if (retry < 3) {
          return nextPhase('pick_row', 300, {
            ...shared,
            row_retry: retry + 1,
            page_signature: pageSignature(),
          })
        }

        return nextPhase('pick_row', 300, {
          ...shared,
          row_retry: 0,
          page_signature: pageSignature(),
        })
      }

      const click = centerClick(row.actionButton, 120)
      if (!click) {
        return emitRowResult(row, 'failed', '未获取到上传按钮坐标')
      }

      return cdpClicks([click], 'wait_drawer', 900, shared)
    }

    if (phase === 'wait_drawer') {
      if (findUploadLaterDialog()) {
        return nextPhase('accept_upload_later_dialog', 100, shared)
      }

      const drawerState = readDrawerState(shared.current_spu)
      if (drawerState.ready) {
        return nextPhase('prepare_upload', drawerState.hasUploadSection || drawerState.hasFileInput ? 100 : 400, {
          ...shared,
          open_retry: 0,
        })
      }

      const retry = Number(shared.open_retry || 0)
      if (drawerState.hasVisibleDrawer && retry < 8) {
        return nextPhase('wait_drawer', 600, {
          ...shared,
          open_retry: retry + 1,
        })
      }

      if (retry < 2) {
        return nextPhase('wait_drawer', 600, {
          ...shared,
          open_retry: retry + 1,
        })
      }

      if (retry < 4) {
        return nextPhase('open_row', 500, {
          ...shared,
          open_retry: retry + 1,
        })
      }

      return emitRowResult(
        {
          spu: shared.current_spu,
          name: shared.current_name,
          actionText: shared.current_action_text,
          status: shared.current_status_text,
          suggestion: shared.current_suggestion,
          product_kind: shared.product_kind,
        },
        'failed',
        `未成功打开上传抽屉（${drawerStateSummary(drawerState)}）`,
      )
    }

    if (phase === 'accept_upload_later_dialog') {
      const button = findUploadLaterButton()
      if (!button) {
        const retry = Number(shared.open_retry || 0)
        if (retry < 6) {
          return nextPhase('wait_drawer', 700, {
            ...shared,
            open_retry: retry + 1,
          })
        }

        return emitRowResult(
          {
            spu: shared.current_spu,
            name: shared.current_name,
            actionText: shared.current_action_text,
            status: shared.current_status_text,
            suggestion: shared.current_suggestion,
            product_kind: shared.product_kind,
          },
          'failed',
          '未找到“先传图，稍后再传资质”按钮',
        )
      }

      const click = centerClick(button, 120)
      if (click) {
        return cdpClicks([click], 'wait_drawer', 1000, shared)
      }
      if (gentleClick(button)) {
        return nextPhase('wait_drawer', 1000, shared)
      }

      return emitRowResult(
        {
          spu: shared.current_spu,
          name: shared.current_name,
          actionText: shared.current_action_text,
          status: shared.current_status_text,
          suggestion: shared.current_suggestion,
          product_kind: shared.product_kind,
        },
        'failed',
        '点击“先传图，稍后再传资质”失败',
      )
    }

    if (phase === 'prepare_upload') {
      const kind = String(shared.product_kind || classifyProduct(shared.current_name, shared.current_row_text))
      const request = getUploadRequest(kind)

      if (!request.subjectRequested && !request.packageRequested) {
        return emitRowResult(
          {
            spu: shared.current_spu,
            name: shared.current_name,
            actionText: shared.current_action_text,
            status: shared.current_status_text,
            suggestion: shared.current_suggestion,
            product_kind: kind,
          },
          'skipped',
          `${productKindLabel(kind)}未提供任何标签图素材，已跳过`,
        )
      }

      const subjectField = request.subjectRequested ? findUploadField('商品主体实拍图', '标签图') : null
      const packageField = request.packageRequested ? findUploadField('商品外包装实拍图', '标签图') : null
      if ((request.subjectRequested && !subjectField) || (request.packageRequested && !packageField)) {
        const retry = Number(shared.field_retry || 0)
        if (retry < 5) {
          return nextPhase('prepare_upload', 500, {
            ...shared,
            field_retry: retry + 1,
          })
        }

        return emitRowResult(
          {
            spu: shared.current_spu,
            name: shared.current_name,
            actionText: shared.current_action_text,
            status: shared.current_status_text,
            suggestion: shared.current_suggestion,
            product_kind: kind,
          },
          'failed',
          request.subjectRequested && request.packageRequested
            ? '未找到主体/外包装标签图上传控件'
            : request.subjectRequested
              ? '未找到主体标签图上传控件'
              : '未找到外包装标签图上传控件',
        )
      }

      const subjectBefore = request.subjectRequested
        ? (Number(shared.subject_before || 0) || getUploadFilledCount(subjectField))
        : 0
      const packageBefore = request.packageRequested
        ? (Number(shared.package_before || 0) || getUploadFilledCount(packageField))
        : 0
      const expectedSubjectCount = request.subjectRequested ? subjectBefore + request.subjectPaths.length : subjectBefore
      const expectedPackageCount = request.packageRequested ? packageBefore + request.packagePaths.length : packageBefore
      const subjectReady = !request.subjectRequested || getUploadFilledCount(subjectField) >= expectedSubjectCount
      const packageReady = !request.packageRequested || getUploadFilledCount(packageField) >= expectedPackageCount

      if (
        request.subjectRequested &&
        !subjectReady &&
        subjectField?.max > 0 &&
        getUploadFilledCount(subjectField) + request.subjectPaths.length > subjectField.max
      ) {
        return emitRowResult(
          {
            spu: shared.current_spu,
            name: shared.current_name,
            actionText: shared.current_action_text,
            status: shared.current_status_text,
            suggestion: shared.current_suggestion,
            product_kind: kind,
          },
          'failed',
          `商品主体标签图槽位不足，当前 ${getUploadFilledCount(subjectField)}/${subjectField.max}`,
        )
      }

      if (
        request.packageRequested &&
        !packageReady &&
        packageField?.max > 0 &&
        getUploadFilledCount(packageField) + request.packagePaths.length > packageField.max
      ) {
        return emitRowResult(
          {
            spu: shared.current_spu,
            name: shared.current_name,
            actionText: shared.current_action_text,
            status: shared.current_status_text,
            suggestion: shared.current_suggestion,
            product_kind: kind,
          },
          'failed',
          `商品外包装标签图槽位不足，当前 ${getUploadFilledCount(packageField)}/${packageField.max}`,
        )
      }

      const injectItems = []
      if (request.subjectRequested && !subjectReady) {
        const subjectSelector = tagUploadField(subjectField.input, `${kind}-subject-label`)
        injectItems.push({ selector: subjectSelector, files: request.subjectPaths })
      }
      if (request.packageRequested && !packageReady) {
        const packageSelector = tagUploadField(packageField.input, `${kind}-package-label`)
        injectItems.push({ selector: packageSelector, files: request.packagePaths })
      }

      const nextShared = {
        ...shared,
        subject_before: subjectBefore,
        package_before: packageBefore,
        subject_asset_count: request.subjectPaths.length,
        package_asset_count: request.packagePaths.length,
        field_retry: 0,
      }

      if (!injectItems.length) {
        return nextPhase('submit_upload', 200, nextShared)
      }

      return injectFiles(injectItems, 'wait_upload_ready', 1800, nextShared)
    }

    if (phase === 'wait_upload_ready') {
      const kind = String(shared.product_kind || classifyProduct(shared.current_name, shared.current_row_text))
      const request = getUploadRequest(kind)
      if (!request.subjectRequested && !request.packageRequested) {
        return emitRowResult(
          {
            spu: shared.current_spu,
            name: shared.current_name,
            actionText: shared.current_action_text,
            status: shared.current_status_text,
            suggestion: shared.current_suggestion,
            product_kind: kind,
          },
          'skipped',
          `${productKindLabel(kind)}未提供任何标签图素材，已跳过`,
        )
      }

      const subjectField = request.subjectRequested ? findUploadField('商品主体实拍图', '标签图') : null
      const packageField = request.packageRequested ? findUploadField('商品外包装实拍图', '标签图') : null
      const subjectExpectedCount = Number(shared.subject_before || 0) + Number(shared.subject_asset_count || 0)
      const packageExpectedCount = Number(shared.package_before || 0) + Number(shared.package_asset_count || 0)
      const subjectReady = !request.subjectRequested || getUploadFilledCount(subjectField) >= subjectExpectedCount
      const packageReady = !request.packageRequested || getUploadFilledCount(packageField) >= packageExpectedCount

      if (subjectReady && packageReady) {
        return nextPhase('submit_upload', 200, shared)
      }

      const retry = Number(shared.upload_retry || 0)
      if (retry < 10) {
        return nextPhase('wait_upload_ready', 1200, {
          ...shared,
          upload_retry: retry + 1,
        })
      }

      const subjectState = subjectField
        ? `count=${subjectField.count}, preview=${subjectField.previewCount}, success=${subjectField.hasSuccess ? 'yes' : 'no'}`
        : 'missing'
      const packageState = packageField
        ? `count=${packageField.count}, preview=${packageField.previewCount}, success=${packageField.hasSuccess ? 'yes' : 'no'}`
        : 'missing'

      return emitRowResult(
        {
          spu: shared.current_spu,
          name: shared.current_name,
          actionText: shared.current_action_text,
          status: shared.current_status_text,
          suggestion: shared.current_suggestion,
          product_kind: shared.product_kind,
        },
        'failed',
        `上传${uploadTargetLabel(request)}标签图后仍未进入可提交状态（主体：${subjectState}；外包装：${packageState}）`,
      )
    }

    if (phase === 'submit_upload') {
      const button = findVisibleButtonByText('上传并识别', { preferPrimary: true, preferRight: true, preferDrawer: true, minY: 120 })
      const click = centerClick(button, 120)
      if (!click) {
        return emitRowResult(
          {
            spu: shared.current_spu,
            name: shared.current_name,
            actionText: shared.current_action_text,
            status: shared.current_status_text,
            suggestion: shared.current_suggestion,
            product_kind: shared.product_kind,
          },
          'failed',
          '未找到“上传并识别”按钮',
        )
      }
      return cdpClicks([click], 'wait_after_submit', 1600, {
        ...shared,
        submit_retry: 0,
        confirm_retry: 0,
        deep_request_retry: 0,
        deep_recognition_request_count: 0,
        deep_recognition_requested_at: 0,
        confirm_clicked_at: 0,
        confirm_click_count: 0,
        toast_retry: 0,
        cleanup_retry: 0,
      })
    }

    if (phase === 'wait_after_submit') {
      if (!getOpenDrawer()) {
        return emitRowResult(
          {
            spu: shared.current_spu,
            name: shared.current_name,
            actionText: shared.current_action_text,
            status: shared.current_status_text,
            suggestion: shared.current_suggestion,
            product_kind: shared.product_kind,
          },
          'submitted',
          '上传并识别已提交',
          { 深度识别结果: '未触发' },
        )
      }

      const saveLivePhotosDialog = findSaveLivePhotosDialog()
      if (saveLivePhotosDialog) {
        return nextPhase('save_live_photos_without_fix', 200, {
          ...shared,
          submit_retry: 0,
          confirm_retry: 0,
          toast_retry: 0,
        })
      }

      const confirmDialog = findDeepRecognitionConfirmDialog()
      if (confirmDialog) {
        return nextPhase('confirm_deep_recognition', 500, {
          ...shared,
          submit_retry: 0,
          toast_retry: 0,
        })
      }

      if (hasOperationTooFrequentToast()) {
        const retry = Number(shared.toast_retry || 0)
        if (retry < 8) {
          return nextPhase('wait_after_submit', 1800, {
            ...shared,
            toast_retry: retry + 1,
          })
        }

        return emitRowResult(
          {
            spu: shared.current_spu,
            name: shared.current_name,
            actionText: shared.current_action_text,
            status: shared.current_status_text,
            suggestion: shared.current_suggestion,
            product_kind: shared.product_kind,
          },
          'failed',
          '深度识别流程触发过快，页面提示请稍后再试',
        )
      }

      const deepButton = findDeepRecognitionButton()
      if (deepButton) {
        return nextPhase('request_deep_recognition', Number(shared.deep_recognition_request_count || 0) > 0 ? 600 : 100, shared)
      }

      const retry = Number(shared.submit_retry || 0)
      if (retry < 10) {
        return nextPhase('wait_after_submit', 600, {
          ...shared,
          submit_retry: retry + 1,
        })
      }

      return emitRowResult(
        {
          spu: shared.current_spu,
          name: shared.current_name,
          actionText: shared.current_action_text,
          status: shared.current_status_text,
          suggestion: shared.current_suggestion,
          product_kind: shared.product_kind,
        },
        'failed',
        '点击“上传并识别”后未进入异常/深度识别流程',
      )
    }

    if (phase === 'save_live_photos_without_fix') {
      const button = findSaveLivePhotosButton()
      if (!button) {
        const retry = Number(shared.confirm_retry || 0)
        if (retry < 8) {
          return nextPhase('save_live_photos_without_fix', 800, {
            ...shared,
            confirm_retry: retry + 1,
          })
        }

        return emitRowResult(
          {
            spu: shared.current_spu,
            name: shared.current_name,
            actionText: shared.current_action_text,
            status: shared.current_status_text,
            suggestion: shared.current_suggestion,
            product_kind: shared.product_kind,
          },
          'failed',
          '未找到“保存实拍图，暂不处理异常”按钮',
        )
      }

      const click = centerClick(button, 120)
      if (click) {
        return cdpClicks([click], 'wait_saved_live_photos', 1200, {
          ...shared,
          confirm_retry: 0,
        })
      }
      if (gentleClick(button)) {
        return nextPhase('wait_saved_live_photos', 1200, {
          ...shared,
          confirm_retry: 0,
        })
      }

      return emitRowResult(
        {
          spu: shared.current_spu,
          name: shared.current_name,
          actionText: shared.current_action_text,
          status: shared.current_status_text,
          suggestion: shared.current_suggestion,
          product_kind: shared.product_kind,
        },
        'failed',
        '点击“保存实拍图，暂不处理异常”失败',
      )
    }

    if (phase === 'wait_saved_live_photos') {
      const dialog = findSaveLivePhotosDialog()
      const drawerState = readDrawerState(shared.current_spu)
      if (!dialog && (!drawerState.hasVisibleDrawer || !drawerState.hasUploadButton)) {
        return emitRowResult(
          {
            spu: shared.current_spu,
            name: shared.current_name,
            actionText: shared.current_action_text,
            status: shared.current_status_text,
            suggestion: shared.current_suggestion,
            product_kind: shared.product_kind,
          },
          'submitted',
          '已保存实拍图，暂不处理异常',
          { 深度识别结果: '暂不处理异常' },
          1400,
        )
      }

      const retry = Number(shared.confirm_retry || 0)
      if (retry < 10) {
        return nextPhase('wait_saved_live_photos', 800, {
          ...shared,
          confirm_retry: retry + 1,
        })
      }

      return emitRowResult(
        {
          spu: shared.current_spu,
          name: shared.current_name,
          actionText: shared.current_action_text,
          status: shared.current_status_text,
          suggestion: shared.current_suggestion,
          product_kind: shared.product_kind,
        },
        'failed',
        '保存实拍图后页面未回到可继续处理状态',
      )
    }

    if (phase === 'request_deep_recognition') {
      if (findDeepRecognitionConfirmDialog()) {
        return nextPhase('confirm_deep_recognition', 400, shared)
      }

      if (hasOperationTooFrequentToast()) {
        const retry = Number(shared.toast_retry || 0)
        if (retry < 8) {
          return nextPhase('request_deep_recognition', 1800, {
            ...shared,
            toast_retry: retry + 1,
          })
        }

        return emitRowResult(
          {
            spu: shared.current_spu,
            name: shared.current_name,
            actionText: shared.current_action_text,
            status: shared.current_status_text,
            suggestion: shared.current_suggestion,
            product_kind: shared.product_kind,
          },
          'failed',
          '点击“深度识别”时页面提示操作过于频繁',
        )
      }

      const button = findDeepRecognitionButton()
      if (!button) {
        const retry = Number(shared.deep_request_retry || 0)
        if (retry < 6) {
          return nextPhase('wait_after_submit', 700, {
            ...shared,
            deep_request_retry: retry + 1,
          })
        }

        return emitRowResult(
          {
            spu: shared.current_spu,
            name: shared.current_name,
            actionText: shared.current_action_text,
            status: shared.current_status_text,
            suggestion: shared.current_suggestion,
            product_kind: shared.product_kind,
          },
          'failed',
          '未找到“深度识别”按钮',
        )
      }

      const lastRequestedAt = Number(shared.deep_recognition_requested_at || 0)
      if (lastRequestedAt && Date.now() - lastRequestedAt < 2200) {
        return nextPhase('confirm_deep_recognition', 1200, shared)
      }

      gentleClick(button)
      return nextPhase('confirm_deep_recognition', 1200, {
        ...shared,
        deep_request_retry: 0,
        deep_recognition_request_count: Number(shared.deep_recognition_request_count || 0) + 1,
        deep_recognition_requested_at: Date.now(),
        toast_retry: 0,
      })
    }

    if (phase === 'confirm_deep_recognition') {
      const dialog = findDeepRecognitionConfirmDialog()
      const button = dialog ? findDeepRecognitionConfirmButton() : null
      if (!button) {
        const retry = Number(shared.confirm_retry || 0)
        if (hasOperationTooFrequentToast() && retry < 8) {
          return nextPhase('confirm_deep_recognition', 1800, {
            ...shared,
            confirm_retry: retry + 1,
            toast_retry: Number(shared.toast_retry || 0) + 1,
          })
        }

        if (retry < 8) {
          return nextPhase('confirm_deep_recognition', 800, {
            ...shared,
            confirm_retry: retry + 1,
          })
        }

        return emitRowResult(
          {
            spu: shared.current_spu,
            name: shared.current_name,
            actionText: shared.current_action_text,
            status: shared.current_status_text,
            suggestion: shared.current_suggestion,
            product_kind: shared.product_kind,
          },
          'failed',
          '未找到深度识别确认弹窗',
        )
      }

      const lastClickedAt = Number(shared.confirm_clicked_at || 0)
      if (lastClickedAt && Date.now() - lastClickedAt < 2200) {
        return nextPhase('wait_row_complete', 1200, shared)
      }

      gentleClick(button)
      return nextPhase('wait_row_complete', 2200, {
        ...shared,
        confirm_retry: 0,
        confirm_clicked_at: Date.now(),
        confirm_click_count: Number(shared.confirm_click_count || 0) + 1,
        toast_retry: 0,
      })
    }

    if (phase === 'wait_row_complete') {
      if (!getOpenDrawer()) {
        return emitRowResult(
          {
            spu: shared.current_spu,
            name: shared.current_name,
            actionText: shared.current_action_text,
            status: shared.current_status_text,
            suggestion: shared.current_suggestion,
            product_kind: shared.product_kind,
          },
          'submitted',
          '已上传标签图并申请深度识别',
          { 深度识别结果: '已提交' },
          1400,
        )
      }

      if (hasOperationTooFrequentToast()) {
        const retry = Number(shared.toast_retry || 0)
        if (retry < 8) {
          return nextPhase('wait_row_complete', 1800, {
            ...shared,
            toast_retry: retry + 1,
          })
        }
      }

      const confirmDialog = findDeepRecognitionConfirmDialog()
      if (confirmDialog) {
        const lastClickedAt = Number(shared.confirm_clicked_at || 0)
        if (lastClickedAt) {
          if (Date.now() - lastClickedAt < 7000) {
            return nextPhase('wait_row_complete', 1400, shared)
          }
        } else {
          return nextPhase('confirm_deep_recognition', 600, shared)
        }

        const retry = Number(shared.confirm_retry || 0)
        if (retry < 6) {
          return nextPhase('wait_row_complete', 1400, {
            ...shared,
            confirm_retry: retry + 1,
          })
        }

        return emitRowResult(
          {
            spu: shared.current_spu,
            name: shared.current_name,
            actionText: shared.current_action_text,
            status: shared.current_status_text,
            suggestion: shared.current_suggestion,
            product_kind: shared.product_kind,
          },
          'failed',
          '深度识别确认弹窗重复出现，已停止重复点击',
        )
      }

      const deepButton = findDeepRecognitionButton()
      if (deepButton && !Number(shared.confirm_clicked_at || 0) && Number(shared.deep_recognition_request_count || 0) < 1) {
        return nextPhase('request_deep_recognition', 800, shared)
      }

      const retry = Number(shared.confirm_retry || 0)
      if (retry < 10) {
        return nextPhase('wait_row_complete', 500, {
          ...shared,
          confirm_retry: retry + 1,
        })
      }

      return emitRowResult(
        {
          spu: shared.current_spu,
          name: shared.current_name,
          actionText: shared.current_action_text,
          status: shared.current_status_text,
          suggestion: shared.current_suggestion,
          product_kind: shared.product_kind,
        },
        'failed',
        '深度识别确认后抽屉未关闭',
      )
    }

    if (phase === 'complete_run') {
      return complete([], false, {
        ...shared,
        current_buyer_id: '',
        current_store: '',
      })
    }

    return fail(`未知阶段: ${phase}`)
  } catch (error) {
    return { success: false, error: String(error?.message || error) }
  }
})()
