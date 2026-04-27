;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const POLL_INTERVAL_MS = 3000
  const DEEPDRAW_UPLOAD_PATH = '/authorized/merchant/product/uploadPictures'
  const DEEPDRAW_UPLOAD_URL = `https://www.deepdraw.biz${DEEPDRAW_UPLOAD_PATH}`
  const MAX_BATCH_SEARCH_CODES = 100

  function compact(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function cleanPath(value) {
    return String(value || '').trim().replace(/^['"]|['"]$/g, '')
  }

  function basename(value) {
    const normalized = cleanPath(value).replace(/\\/g, '/')
    return normalized.split('/').filter(Boolean).pop() || normalized
  }

  function stripZipExt(filename) {
    return String(filename || '').replace(/\.zip$/i, '')
  }

  function isStyleCode(value) {
    const text = compact(value)
    return /^[A-Za-z0-9][A-Za-z0-9_-]{3,}$/.test(text) && /\d/.test(text)
  }

  function normalizeZipInputs(rawValue) {
    const sourceValue = rawValue && typeof rawValue === 'object' && Array.isArray(rawValue.paths)
      ? rawValue.paths
      : rawValue
    const rawItems = Array.isArray(sourceValue)
      ? sourceValue
      : sourceValue && typeof sourceValue === 'object' && sourceValue.path
        ? [sourceValue.path]
        : String(sourceValue || '').replace(/[；;]/g, '\n').split(/\r?\n/)
    const result = []
    const seen = new Set()

    for (const rawItem of rawItems) {
      const filePath = cleanPath(rawItem)
      if (!filePath || !/\.zip$/i.test(filePath)) continue
      const filename = basename(filePath)
      const code = stripZipExt(filename)
      if (!isStyleCode(code)) continue
      const key = filePath.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      result.push({ path: filePath, filename, code })
    }

    return result
  }

  function normalizeUploadMode(value) {
    return String(value || '').trim().toLowerCase() === 'upload' ? 'upload' : 'dry_run'
  }

  function normalizePositiveInteger(value, fallback, min = 1, max = 9999) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(min, Math.min(max, Math.floor(parsed)))
  }

  function resolveUploadPlan(rawParams, zipFiles) {
    const uploadMode = normalizeUploadMode(rawParams.upload_mode)
    const realUpload = uploadMode === 'upload'
    const timeoutMinutes = normalizePositiveInteger(rawParams.upload_poll_timeout_minutes, 20, 1, 120)

    return {
      uploadMode,
      realUpload,
      timeoutMinutes,
      maxPollCount: Math.max(1, Math.ceil((timeoutMinutes * 60 * 1000) / POLL_INTERVAL_MS)),
      cleanupAfterQueue: !realUpload,
    }
  }

  function buildInitialRows(zipFiles) {
    return zipFiles.map(file => ({
      '款号': file.code,
      'ZIP文件': file.filename,
      '搜索结果': '',
      '产品ID': '',
      '期数': '',
      '处理阶段': '待搜索',
      '上传结果': '',
      '备注': '',
    }))
  }

  function getUniqueCodes(zipFiles) {
    const codes = []
    const seen = new Set()
    for (const file of Array.isArray(zipFiles) ? zipFiles : []) {
      const code = compact(file?.code)
      if (!code || seen.has(code)) continue
      seen.add(code)
      codes.push(code)
    }
    return codes
  }

  function searchPageSizeForCount(count) {
    const total = Math.max(1, Number(count || 0))
    if (total <= 20) return 20
    if (total <= 30) return 30
    if (total <= 50) return 50
    if (total <= 100) return 100
    return 200
  }

  function setNativeValue(element, value) {
    if (!element) return
    element.value = String(value || '')
    if (element.tagName === 'TEXTAREA') element.textContent = String(value || '')
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function patchRows(rows, code, patch) {
    return (Array.isArray(rows) ? rows : []).map(row => (
      String(row?.['款号'] || '') === String(code || '') ? { ...row, ...patch } : row
    ))
  }

  function nextPhase(next, sleepMs = 0, nextShared = shared) {
    return {
      success: true,
      data: [],
      meta: {
        has_more: true,
        action: 'next_phase',
        next_phase: next,
        sleep_ms: sleepMs,
        shared: nextShared,
      },
    }
  }

  function complete(rows, nextShared = shared) {
    return {
      success: true,
      data: Array.isArray(rows) ? rows : [],
      meta: {
        has_more: false,
        shared: nextShared,
      },
    }
  }

  function fail(message) {
    return { success: false, error: String(message || '深绘上传脚本执行失败') }
  }

  function cdpClicks(clicks, nextPhaseName, sleepMs = 800, nextShared = shared) {
    return {
      success: true,
      data: [],
      meta: {
        has_more: true,
        action: 'cdp_clicks',
        clicks,
        next_phase: nextPhaseName,
        sleep_ms: sleepMs,
        shared: nextShared,
      },
    }
  }

  function getDeepdrawContext() {
    const directUploadPage = String(location.href || '').includes(DEEPDRAW_UPLOAD_PATH)
    if (directUploadPage) {
      return { w: window, d: document, frameRect: { left: 0, top: 0 }, frame: null }
    }

    const frame = [...document.querySelectorAll('iframe')]
      .find(item => String(item.src || '').includes(DEEPDRAW_UPLOAD_PATH))
    if (!frame) return null

    try {
      const frameRect = frame.getBoundingClientRect()
      return {
        w: frame.contentWindow,
        d: frame.contentDocument,
        frameRect: { left: frameRect.left, top: frameRect.top },
        frame,
      }
    } catch (error) {
      return null
    }
  }

  function isDeepdrawUploadReady(ctx) {
    if (!ctx || !ctx.d) return false
    return !!(
      ctx.d.querySelector('#searchKeyword') ||
      ctx.d.querySelector('#tbodyTable') ||
      ctx.d.querySelector('#selectFilesButton')
    )
  }

  function isVisibleElement(element) {
    if (!element || typeof element.getBoundingClientRect !== 'function') return false
    const rect = element.getBoundingClientRect()
    if (!rect || rect.width <= 1 || rect.height <= 1) return false
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(element) : null
    if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0)) return false
    return true
  }

  function elementText(element) {
    return compact(element?.innerText || element?.textContent || '')
  }

  function menuCandidateScore(element, label) {
    const rect = element.getBoundingClientRect()
    const text = elementText(element)
    let score = 0
    if (text === label) score -= 80
    if (rect.left < 320) score -= 40
    if (['A', 'BUTTON', 'LI'].includes(String(element.tagName || '').toUpperCase())) score -= 15
    score += Math.max(0, rect.left)
    score += Math.max(0, text.length - label.length)
    return score
  }

  function findMenuElement(label, options = {}) {
    const selector = 'a, button, li, [role="button"], [role="menuitem"], div, span'
    const candidates = [...document.querySelectorAll(selector)]
      .filter(element => isVisibleElement(element) && elementText(element).includes(label))
      .filter(element => !options.leftSideOnly || element.getBoundingClientRect().left < 360)
      .sort((left, right) => menuCandidateScore(left, label) - menuCandidateScore(right, label))
    return candidates[0] || null
  }

  function clickForElement(element, delayMs = 120) {
    const rect = element.getBoundingClientRect()
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      delay_ms: delayMs,
    }
  }

  function findDeepdrawMenuClick(stage = '') {
    const uploadItem = findMenuElement('图片包上传', { leftSideOnly: true })
    if (uploadItem) {
      return {
        target: 'upload',
        label: '图片包上传',
        click: clickForElement(uploadItem, 160),
      }
    }

    if (stage !== 'product_clicked') {
      const productItem = findMenuElement('产品素材', { leftSideOnly: true })
      if (productItem) {
        return {
          target: 'product',
          label: '产品素材',
          click: clickForElement(productItem, 160),
        }
      }
    }

    return null
  }

  function navigateDirectlyToUploadPage(nextShared = shared) {
    setTimeout(() => {
      location.href = DEEPDRAW_UPLOAD_URL
    }, 0)
    return nextPhase('ensure_page', 2500, nextShared)
  }

  function visibleText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function readProductRows(ctx) {
    const rows = []
    for (const row of ctx.d.querySelectorAll('#tbodyTable tr')) {
      const checkbox = row.querySelector('input[type="checkbox"][name="ids"], input[type="checkbox"][data-code]')
      if (!checkbox) continue
      const code = compact(checkbox.getAttribute('data-code') || checkbox.value)
      if (!code) continue
      rows.push({
        row,
        checkbox,
        code,
        productId: compact(checkbox.getAttribute('data-id') || checkbox.id),
        day: compact(checkbox.getAttribute('data-day')),
        status: compact(checkbox.getAttribute('data-status')),
        text: visibleText(row.innerText || row.textContent),
      })
    }
    return rows
  }

  function findProductRow(ctx, code) {
    return readProductRows(ctx).find(item => item.code === String(code || '')) || null
  }

  function triggerSearch(ctx, code) {
    const input = ctx.d.querySelector('#searchKeyword')
    if (!input) throw new Error('未找到深绘搜索输入框 #searchKeyword')
    input.value = String(code || '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))

    if (typeof ctx.w.updateSearchKeyword === 'function') ctx.w.updateSearchKeyword()
    if (typeof ctx.w.search === 'function') ctx.w.search(1)
    else {
      const icon = ctx.d.querySelector('.icons-artist-sousuo')
      if (icon) icon.click()
      else throw new Error('未找到深绘搜索函数或搜索按钮')
    }
  }

  function triggerBatchSearch(ctx, codes) {
    const normalizedCodes = getUniqueCodes((codes || []).map(code => ({ code })))
    if (!normalizedCodes.length) throw new Error('没有可搜索的款号')
    const textarea = ctx.d.querySelector('#searchKeywordTextArea')
    if (!textarea) throw new Error('未找到深绘批量搜索输入框 #searchKeywordTextArea')

    setNativeValue(ctx.d.querySelector('#searchKeyword'), '')
    setNativeValue(textarea, normalizedCodes.join(','))
    setNativeValue(ctx.d.querySelector('#pageSize'), String(searchPageSizeForCount(normalizedCodes.length)))

    ctx.w.searchKeyword = ''
    ctx.w.keywordType = 'CODE'
    ctx.w.matchingMode = 'EQ'
    if (typeof ctx.w.search === 'function') ctx.w.search(1)
    else throw new Error('未找到深绘搜索函数 search')
  }

  function batchSearchResultText(ctx) {
    return String(ctx.d.querySelector('#searchKeywordTextArea')?.value || '')
  }

  function isBatchSearchResultReady(ctx, codes) {
    const rows = readProductRows(ctx)
    const expected = new Set((codes || []).map(code => String(code || '')))
    if (rows.some(row => expected.has(row.code))) return true
    const text = batchSearchResultText(ctx)
    return text.includes('输入的货号') && (codes || []).some(code => text.includes(String(code || '')))
  }

  function selectProductsForCodes(ctx, zipFiles) {
    const expected = new Map((Array.isArray(zipFiles) ? zipFiles : []).map(file => [String(file.code || ''), file]))
    const productRows = readProductRows(ctx)
    const productByCode = new Map(productRows.map(product => [product.code, product]))
    let rows = shared.rows || []
    const selectedProducts = []
    const matchedZipFiles = []
    resetBatchSelection(ctx)

    for (const file of Array.isArray(zipFiles) ? zipFiles : []) {
      const code = String(file.code || '')
      const product = productByCode.get(code)
      if (!product) {
        rows = patchRows(rows, code, {
          '搜索结果': '未找到',
          '处理阶段': '跳过',
          '上传结果': '未上传',
          '备注': '深绘未找到匹配货号',
        })
        continue
      }

      const selected = ensureBatchSelection(ctx, product)
      if (selected) {
        selectedProducts.push({
          code,
          productId: product.productId,
          day: product.day,
        })
        matchedZipFiles.push(expected.get(code) || file)
      }
      rows = patchRows(rows, code, {
        '搜索结果': selected ? '已匹配并选择' : '已匹配但选择状态未确认',
        '产品ID': product.productId,
        '期数': product.day,
        '处理阶段': selected ? '已选择' : '跳过',
        '上传结果': selected ? '' : '未上传',
        '备注': selected ? '' : '已匹配产品，但深绘批量选择器未读回该款',
      })
    }

    return { rows, selectedProducts, matchedZipFiles, productRows }
  }

  function resetBatchSelection(ctx) {
    try {
      const selector = ctx.w.batchSelector
      if (selector && typeof selector.clear === 'function') selector.clear()
      if (selector && typeof selector.initSelectedItems === 'function') selector.initSelectedItems()
    } catch (error) {}
    try {
      for (const checkbox of ctx.d.querySelectorAll('#tbodyTable input[type="checkbox"]:checked')) {
        checkbox.checked = false
      }
    } catch (error) {}
  }

  function productBatchItem(product) {
    return {
      id: product.productId || product.checkbox?.getAttribute?.('data-id') || product.checkbox?.id || '',
      code: product.code,
      day: product.day || product.checkbox?.getAttribute?.('data-day') || '',
      status: product.status || product.checkbox?.getAttribute?.('data-status') || '',
      pvrp_id: '',
    }
  }

  function ensureBatchSelection(ctx, product) {
    const checkbox = product.checkbox

    try {
      const selector = ctx.w.batchSelector
      const $ = ctx.w.jQuery || ctx.w.$
      const items = selector && typeof selector.getItems === 'function' ? selector.getItems() : []
      const exists = Array.isArray(items) && items.some(item => String(item?.code || '') === product.code)
      if (!exists && selector && typeof selector.addItem === 'function') {
        let item = null
        if (typeof selector.parseItem === 'function' && $) {
          try {
            item = selector.parseItem($(checkbox))
          } catch (error) {
            item = null
          }
        }
        selector.addItem(item && item.id ? item : productBatchItem(product))
      }
      if (typeof selector?.initSelectedItems === 'function') selector.initSelectedItems()
    } catch (error) {
      // Direct batchSelector repair is best-effort; the checkbox click below still exercises the page listener.
    }

    if (!checkbox.checked) checkbox.click()

    const items = ctx.w.batchSelector && typeof ctx.w.batchSelector.getItems === 'function'
      ? ctx.w.batchSelector.getItems()
      : []
    return Array.isArray(items) && items.some(item => String(item?.code || '') === product.code)
  }

  function openBatchModal(ctx) {
    if (typeof ctx.w.prevCheck !== 'function') throw new Error('未找到深绘批量 ZIP 上传入口 prevCheck')
    ctx.w.prevCheck()
  }

  function visibleModalMessage(ctx) {
    const message = [...ctx.d.querySelectorAll('.bootbox.modal.in, .bootbox.modal[style*="display: block"], .modal.in')]
      .map(element => visibleText(element.innerText || element.textContent))
      .find(text => text && !text.includes('图片包上传(ZIP)'))
    return message || ''
  }

  function uploadModalState(ctx) {
    const modal = ctx.d.querySelector('#uploadBatchModal')
    const button = ctx.d.querySelector('#selectFilesButton')
    const modalRect = modal && typeof modal.getBoundingClientRect === 'function' ? modal.getBoundingClientRect() : null
    const buttonRect = button && typeof button.getBoundingClientRect === 'function' ? button.getBoundingClientRect() : null
    const modalStyle = modal ? ctx.w.getComputedStyle(modal) : null
    const buttonStyle = button ? ctx.w.getComputedStyle(button) : null
    const modalVisible = !!(modal && modalStyle && modalStyle.display !== 'none' && modalRect && modalRect.width > 1 && modalRect.height > 1)
    const buttonVisible = !!(button && !button.disabled && buttonStyle && buttonStyle.display !== 'none' && buttonStyle.visibility !== 'hidden' && buttonRect && buttonRect.width > 1 && buttonRect.height > 1)
    return {
      modalVisible,
      buttonVisible,
      hasUploader: !!ctx.w.uploader,
      selectedCount: typeof ctx.w.batchSelector?.getItems === 'function' ? ctx.w.batchSelector.getItems().length : 0,
      message: visibleModalMessage(ctx),
    }
  }

  function isUploadModalReady(ctx) {
    const state = uploadModalState(ctx)
    return state.modalVisible && state.buttonVisible && state.hasUploader
  }

  function getFileChooserClick(ctx) {
    const button = ctx.d.querySelector('#selectFilesButton')
    if (!button) throw new Error('未找到选择文件按钮 #selectFilesButton')
    const rect = button.getBoundingClientRect()
    if (!rect || rect.width <= 1 || rect.height <= 1) throw new Error('深绘选择文件按钮尚未可见')
    return {
      x: ctx.frameRect.left + rect.left + rect.width / 2,
      y: ctx.frameRect.top + rect.top + rect.height / 2,
      delay_ms: 120,
    }
  }

  function readQueue(ctx) {
    const uploader = ctx.w.uploader
    const files = uploader && Array.isArray(uploader.files) ? uploader.files : []
    const plupload = ctx.w.plupload || {}
    return files.map(file => ({
      id: String(file.id || ''),
      name: String(file.name || ''),
      size: Number(file.size || 0),
      status: Number(file.status || 0),
      percent: Number(file.percent || 0),
      handleState: Number(file.handleState || 0),
      handleError: file.handleError ? String(file.handleError) : '',
      done: Number(file.status || 0) === Number(plupload.DONE || 5) ||
        Number(file.handleState || 0) === Number(plupload.FILE_HANDLE_DONE || 5),
      failed: Number(file.status || 0) === Number(plupload.FAILED || 4) || !!file.handleError,
    }))
  }

  function cleanupDryRunState(ctx, codes) {
    try {
      if (typeof ctx.w.clearFilesQueue === 'function') ctx.w.clearFilesQueue()
    } catch (error) {}
    try {
      if (ctx.w.uploader && Array.isArray(ctx.w.uploader.files) && ctx.w.uploader.files.length) {
        ctx.w.uploader.splice(0, ctx.w.uploader.files.length)
      }
    } catch (error) {}
    try {
      const selector = ctx.w.batchSelector
      if (selector && typeof selector.removeItemByCode === 'function') {
        for (const code of codes || []) selector.removeItemByCode(code)
      }
    } catch (error) {}
    try {
      for (const checkbox of ctx.d.querySelectorAll('#tbodyTable input[type="checkbox"]:checked')) checkbox.click()
    } catch (error) {}
    try {
      const $ = ctx.w.jQuery || ctx.w.$
      if ($) $('#uploadBatchModal').modal('hide')
      const modal = ctx.d.querySelector('#uploadBatchModal')
      if (modal) {
        modal.classList.remove('in')
        modal.setAttribute('aria-hidden', 'true')
        modal.style.display = 'none'
      }
      for (const backdrop of ctx.d.querySelectorAll('.modal-backdrop')) backdrop.remove()
      ctx.d.body?.classList?.remove('modal-open')
    } catch (error) {}
  }

  function startUpload(ctx) {
    const button = ctx.d.querySelector('#uploadFilesButton')
    if (!button || button.disabled) throw new Error('上传按钮不可用，文件可能未成功入队')
    if (!ctx.w.uploader || typeof ctx.w.uploader.start !== 'function') {
      throw new Error('未找到 plupload uploader.start')
    }
    ctx.w.uploader.start()
  }

  function summarizeUploadRows(rows, queueFiles) {
    let nextRows = Array.isArray(rows) ? rows : []
    for (const file of queueFiles || []) {
      const code = stripZipExt(file.name)
      if (file.failed) {
        nextRows = patchRows(nextRows, code, {
          '处理阶段': '上传失败',
          '上传结果': '失败',
          '备注': file.handleError || '深绘上传失败',
        })
      } else if (file.done) {
        nextRows = patchRows(nextRows, code, {
          '处理阶段': '上传完成',
          '上传结果': '成功',
          '备注': '',
        })
      } else {
        nextRows = patchRows(nextRows, code, {
          '处理阶段': `上传处理中 ${file.percent || 0}%`,
          '上传结果': '处理中',
          '备注': '',
        })
      }
    }
    return nextRows
  }

  if (testExports) {
    Object.assign(testExports, {
      normalizeZipInputs,
      resolveUploadPlan,
      buildInitialRows,
      getUniqueCodes,
      searchPageSizeForCount,
      isStyleCode,
      stripZipExt,
      findDeepdrawMenuClick,
      isDeepdrawUploadReady,
      isBatchSearchResultReady,
    })
    return { success: true, data: [], meta: { has_more: false } }
  }

  try {
    if (phase === 'main' || phase === 'init') {
      const zipFiles = normalizeZipInputs(params.package_zip_paths)
      if (!zipFiles.length) {
        return fail('请填写至少一个文件名为款号的 .zip 文件路径，例如 208226103201.zip')
      }
      const uploadPlan = resolveUploadPlan(params, zipFiles)
      const rows = buildInitialRows(zipFiles)
      const uniqueCodes = getUniqueCodes(zipFiles)
      if (uniqueCodes.length > MAX_BATCH_SEARCH_CODES) {
        return fail(`深绘批量上传一次最多选择 ${MAX_BATCH_SEARCH_CODES} 个款号，请拆分任务后重试`)
      }
      return nextPhase('ensure_page', 0, {
        zip_files: zipFiles,
        target_codes: uniqueCodes,
        upload_plan: uploadPlan,
        rows,
        selected_products: [],
        matched_zip_files: [],
        current_exec_no: 1,
        total_rows: zipFiles.length,
        current_buyer_id: zipFiles[0]?.code || '',
        current_store: uploadPlan.realUpload ? '深绘图片包真实上传' : '深绘图片包入队演练',
      })
    }

    if (phase === 'ensure_page') {
      const ctx = getDeepdrawContext()
      if (isDeepdrawUploadReady(ctx)) return nextPhase('batch_search', 0, {
        ...shared,
        ensure_page_attempts: 0,
      })

      const menuClick = findDeepdrawMenuClick(String(shared.menu_click_stage || ''))
      if (menuClick) {
        return cdpClicks([menuClick.click], 'ensure_page', 1800, {
          ...shared,
          menu_click_stage: menuClick.target === 'upload' ? 'upload_clicked' : 'product_clicked',
          ensure_page_attempts: 0,
          current_store: `打开深绘 ${menuClick.label}`,
        })
      }

      if (!shared.direct_upload_nav_attempted) {
        return navigateDirectlyToUploadPage({
          ...shared,
          direct_upload_nav_attempted: true,
          ensure_page_attempts: 0,
          current_store: '直达深绘图片包上传页',
        })
      }

      const attempts = Number(shared.ensure_page_attempts || 0)
      if (attempts < 10) {
        return nextPhase('ensure_page', 1000, {
          ...shared,
          ensure_page_attempts: attempts + 1,
        })
      }
      return fail('未找到深绘“图片包上传”页面，请确认已登录并可访问 产品素材 / 图片包上传')
    }

    if (phase === 'batch_search') {
      const zipFiles = Array.isArray(shared.zip_files) ? shared.zip_files : []
      const ctx = getDeepdrawContext()
      if (!isDeepdrawUploadReady(ctx)) return nextPhase('ensure_page', 1000, shared)

      const codes = Array.isArray(shared.target_codes) && shared.target_codes.length
        ? shared.target_codes
        : getUniqueCodes(zipFiles)
      triggerBatchSearch(ctx, codes)
      return nextPhase('await_batch_search', 2200, {
        ...shared,
        target_codes: codes,
        batch_search_attempts: 0,
        rows: (shared.rows || []).map(row => ({
          ...row,
          '处理阶段': '已提交批量搜索',
          '搜索结果': '查询中',
        })),
        current_exec_no: zipFiles.length || 1,
        current_buyer_id: codes[0] || '',
        current_store: `深绘批量搜索 ${codes.length} 款`,
      })
    }

    if (phase === 'await_batch_search') {
      const ctx = getDeepdrawContext()
      if (!ctx) return nextPhase('ensure_page', 1000, shared)

      const zipFiles = Array.isArray(shared.zip_files) ? shared.zip_files : []
      const codes = Array.isArray(shared.target_codes) && shared.target_codes.length
        ? shared.target_codes
        : getUniqueCodes(zipFiles)
      if (!isBatchSearchResultReady(ctx, codes)) {
        const attempts = Number(shared.batch_search_attempts || 0)
        if (attempts < 5) {
          return nextPhase('await_batch_search', 1000, {
            ...shared,
            batch_search_attempts: attempts + 1,
          })
        }
      }

      const selection = selectProductsForCodes(ctx, zipFiles)
      const expectedCodeSet = new Set(codes)
      const foundCount = selection.productRows.filter(product => expectedCodeSet.has(product.code)).length
      const selectionAttempts = Number(shared.selection_attempts || 0)
      if (foundCount > 0 && selection.matchedZipFiles.length < foundCount && selectionAttempts < 4) {
        return nextPhase('await_batch_search', 700, {
          ...shared,
          selection_attempts: selectionAttempts + 1,
          current_store: `等待深绘批量选择器 ${selectionAttempts + 1}/4`,
        })
      }
      const nextShared = {
        ...shared,
        selected_products: selection.selectedProducts,
        matched_zip_files: selection.matchedZipFiles,
        rows: selection.rows,
        selection_attempts: 0,
        current_exec_no: zipFiles.length || 1,
        current_store: `深绘批量选择 ${selection.matchedZipFiles.length}/${zipFiles.length}`,
      }

      if (!selection.matchedZipFiles.length) return complete(selection.rows, nextShared)
      return nextPhase('open_modal', 0, nextShared)
    }

    if (phase === 'open_modal') {
      const ctx = getDeepdrawContext()
      if (!ctx) return nextPhase('ensure_page', 1000, shared)
      openBatchModal(ctx)
      return nextPhase('await_modal', 500, {
        ...shared,
        modal_attempts: 0,
      })
    }

    if (phase === 'await_modal') {
      const ctx = getDeepdrawContext()
      if (!ctx) return nextPhase('ensure_page', 1000, shared)
      const state = uploadModalState(ctx)
      if (state.message) return fail(`深绘未打开批量上传弹窗：${state.message}`)
      if (isUploadModalReady(ctx)) {
        return nextPhase('prepare_file_chooser', 300, {
          ...shared,
          modal_attempts: 0,
        })
      }

      const attempts = Number(shared.modal_attempts || 0)
      if (attempts < 18) {
        if (attempts > 0 && attempts % 6 === 0 && state.selectedCount > 0) openBatchModal(ctx)
        return nextPhase('await_modal', 500, {
          ...shared,
          modal_attempts: attempts + 1,
          current_store: `等待深绘批量上传弹窗 ${attempts + 1}/18`,
        })
      }

      return fail(`深绘批量上传弹窗未就绪：已选 ${state.selectedCount} 款，弹窗${state.modalVisible ? '已显示' : '未显示'}，选择文件按钮${state.buttonVisible ? '可见' : '不可见'}，uploader${state.hasUploader ? '已初始化' : '未初始化'}`)
    }

    if (phase === 'prepare_file_chooser') {
      const ctx = getDeepdrawContext()
      if (!ctx) return nextPhase('ensure_page', 1000, shared)
      if (!isUploadModalReady(ctx)) return nextPhase('await_modal', 500, shared)
      const click = getFileChooserClick(ctx)
      const matchedFiles = Array.isArray(shared.matched_zip_files) ? shared.matched_zip_files : []
      return {
        success: true,
        data: [],
        meta: {
          has_more: true,
          action: 'file_chooser_upload',
          next_phase: 'verify_queue',
          sleep_ms: 1200,
          strict: true,
          shared_key: 'file_chooser_upload_result',
          shared: {
            ...shared,
            rows: (shared.rows || []).map(row => {
              const matched = matchedFiles.find(item => item.code === row['款号'])
              return matched ? { ...row, '处理阶段': '选择 ZIP 文件中' } : row
            }),
          },
          items: [{
            label: 'deepdraw_zip_batch',
            files: matchedFiles.map(item => item.path),
            clicks: [click],
            timeout_ms: 12000,
            settle_ms: 1000,
          }],
        },
      }
    }

    if (phase === 'verify_queue') {
      const ctx = getDeepdrawContext()
      if (!ctx) return nextPhase('ensure_page', 1000, shared)
      const queueFiles = readQueue(ctx)
      const expected = Array.isArray(shared.matched_zip_files) ? shared.matched_zip_files : []
      const queuedNames = new Set(queueFiles.map(item => item.name))
      const missing = expected.filter(item => !queuedNames.has(item.filename))
      const uploadPlan = shared.upload_plan || {}

      let rows = shared.rows || []
      for (const file of expected) {
        rows = patchRows(rows, file.code, {
          '处理阶段': queuedNames.has(file.filename) ? '已入队' : '入队失败',
          '上传结果': queuedNames.has(file.filename) ? '' : '未上传',
          '备注': queuedNames.has(file.filename) ? '' : 'ZIP 未进入深绘上传队列',
        })
      }

      if (missing.length) {
        cleanupDryRunState(ctx, expected.map(item => item.code))
        return complete(rows, {
          ...shared,
          rows,
          queue_files: queueFiles,
          queue_missing: missing,
        })
      }

      if (!uploadPlan.realUpload) {
        cleanupDryRunState(ctx, expected.map(item => item.code))
        rows = expected.reduce((acc, file) => patchRows(acc, file.code, {
          '处理阶段': '入队演练完成',
          '上传结果': '未上传',
          '备注': 'dry_run 模式：已验证可入队，已清空队列，未提交生产上传',
        }), rows)
        return complete(rows, {
          ...shared,
          rows,
          queue_files: queueFiles,
          dry_run_completed: true,
        })
      }

      return nextPhase('start_upload', 0, {
        ...shared,
        rows,
        queue_files: queueFiles,
      })
    }

    if (phase === 'start_upload') {
      const uploadPlan = shared.upload_plan || {}
      if (!uploadPlan.realUpload || normalizeUploadMode(params.upload_mode) !== 'upload') {
        return fail('真实上传保护未通过，已中止')
      }
      const ctx = getDeepdrawContext()
      if (!ctx) return nextPhase('ensure_page', 1000, shared)
      startUpload(ctx)
      const expected = Array.isArray(shared.matched_zip_files) ? shared.matched_zip_files : []
      const rows = expected.reduce((acc, file) => patchRows(acc, file.code, {
        '处理阶段': '上传中',
        '上传结果': '处理中',
        '备注': '',
      }), shared.rows || [])
      return nextPhase('wait_upload', POLL_INTERVAL_MS, {
        ...shared,
        rows,
        upload_poll_count: 0,
      })
    }

    if (phase === 'wait_upload') {
      const ctx = getDeepdrawContext()
      if (!ctx) return nextPhase('ensure_page', 1000, shared)
      const queueFiles = readQueue(ctx)
      const expected = Array.isArray(shared.matched_zip_files) ? shared.matched_zip_files : []
      const expectedNames = new Set(expected.map(item => item.filename))
      const relevant = queueFiles.filter(item => expectedNames.has(item.name))
      const rows = summarizeUploadRows(shared.rows || [], relevant)
      const pollCount = Number(shared.upload_poll_count || 0) + 1
      const maxPollCount = Number(shared.upload_plan?.maxPollCount || 400)

      if (relevant.length === expected.length && relevant.every(item => item.done || item.failed)) {
        return complete(rows, {
          ...shared,
          rows,
          queue_files: relevant,
          upload_completed: true,
        })
      }

      if (pollCount >= maxPollCount) {
        const timeoutRows = expected.reduce((acc, file) => patchRows(acc, file.code, {
          '处理阶段': '等待超时',
          '上传结果': '处理中',
          '备注': '已提交上传，但等待深绘处理结果超时，请在页面继续确认',
        }), rows)
        return complete(timeoutRows, {
          ...shared,
          rows: timeoutRows,
          queue_files: relevant,
          upload_timeout: true,
        })
      }

      return nextPhase('wait_upload', POLL_INTERVAL_MS, {
        ...shared,
        rows,
        queue_files: relevant,
        upload_poll_count: pollCount,
      })
    }

    return fail(`未知 phase: ${phase}`)
  } catch (error) {
    return fail(error?.message || error)
  }
})()
