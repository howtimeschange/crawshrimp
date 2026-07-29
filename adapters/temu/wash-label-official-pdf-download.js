;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const runtimePhase = window.__CRAWSHRIMP_PHASE__ || 'init'
  const phase = runtimePhase === 'main' ? 'init' : runtimePhase
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const targetStore = textOf(params.store_name || 'balabala Official Shop')
  const maxDownloads = Math.max(0, Math.min(10000, Math.floor(Number(params.max_downloads || 0))))
  const timeoutSeconds = Math.max(5, Math.min(120, Number(params.timeout_seconds || 60)))
  const pilotStyle = compact(params.pilot_style || '')
  const maxSkc = Math.max(0, Math.min(10000, Math.floor(Number(params.max_skc || 0))))
  const API_PAGE_SIZE = 200
  const API_QUERY_PAGE_SIZE = 50
  const SCAN_PAGES_PER_PHASE = 8
  const SCAN_CONCURRENCY = 4
  const REQUIRED_COLUMNS = ['款号', '颜色', '尺码', 'SKC', 'SKU编码', 'SKU货号', '洗唛成分', '产品线']
  const IDENTIFIER_COLUMNS = new Set(['款号', '尺码', 'SKC', 'SKU编码', 'SKU货号'])
  const MISSING_COMPOSITION = new Set(['', 'N/A', 'NA'])

  function compact(value) {
    return String(value || '').replace(/\s+/g, '').trim()
  }

  function textOf(value) {
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value).replace(/\s+/g, ' ').trim()
    }
    return String(value?.innerText || value?.textContent || '').replace(/\s+/g, ' ').trim()
  }

  function isMissingComposition(value) {
    return MISSING_COMPOSITION.has(textOf(value).toUpperCase())
  }

  function sourceRowsFromParam() {
    const file = params.input_file || params.wash_label_file || null
    if (!file || typeof file !== 'object') return []
    if (file.sheets && file.sheets['洗唛需求'] && Array.isArray(file.sheets['洗唛需求'].rows)) {
      return file.sheets['洗唛需求'].rows
    }
    return Array.isArray(file.rows) ? file.rows : []
  }

  function normalizeWorkbookRow(row) {
    const item = {}
    for (const key of REQUIRED_COLUMNS) {
      const value = row?.[key]
      item[key] = IDENTIFIER_COLUMNS.has(key) ? compact(value) : textOf(value)
    }
    return item
  }

  function rowExactKey(row) {
    return REQUIRED_COLUMNS.map(key => row[key] || '').join('\u001f')
  }

  function sizeSortKey(value) {
    const text = compact(value)
    const number = Number(text)
    if (Number.isFinite(number)) return String(number).padStart(8, '0')
    return text
  }

  function buildWorkbookWorkflow() {
    const sourceRows = sourceRowsFromParam().map(normalizeWorkbookRow)
      .filter(row => REQUIRED_COLUMNS.some(key => textOf(row[key])))
    if (!sourceRows.length) return null

    const missingColumns = REQUIRED_COLUMNS.filter(key => (
      !sourceRows.some(row => Object.prototype.hasOwnProperty.call(row, key))
    ))
    if (missingColumns.length) {
      return {
        error: `Excel 缺少必填字段：${missingColumns.join('、')}`,
      }
    }

    const seen = new Set()
    const rows = []
    let exactDuplicateRowsRemoved = 0
    for (const row of sourceRows) {
      const key = rowExactKey(row)
      if (seen.has(key)) {
        exactDuplicateRowsRemoved += 1
        continue
      }
      seen.add(key)
      rows.push({ ...row })
    }

    const styleValues = {}
    for (const row of rows) {
      const composition = textOf(row['洗唛成分'])
      if (isMissingComposition(composition)) continue
      const style = compact(row['款号'])
      if (!styleValues[style]) styleValues[style] = new Set()
      styleValues[style].add(composition)
    }

    const resolved = rows.map(row => {
      let composition = textOf(row['洗唛成分'])
      let compositionSource = 'current_row'
      let status = 'ready'
      let reason = ''
      if (isMissingComposition(composition)) {
        const candidates = [...(styleValues[compact(row['款号'])] || [])].sort()
        if (candidates.length === 1) {
          composition = candidates[0]
          compositionSource = 'same_style_unique'
        } else if (candidates.length === 0) {
          compositionSource = 'scm_required'
          status = 'needs_scm'
          reason = 'No nonblank composition under the same 款号'
        } else {
          compositionSource = 'conflict'
          status = 'exception'
          reason = 'Multiple compositions under the same 款号'
        }
      }
      return {
        ...row,
        洗唛成分_解析: composition,
        成分来源: compositionSource,
        状态: status,
        异常原因: reason,
        目标文件名: `${compact(row['SKU编码'])}-${compact(row['SKU货号'])}.pdf`,
      }
    })

    const byIdentifier = {}
    for (const item of resolved) {
      const key = `${compact(item['SKU编码'])}\u001f${compact(item['SKU货号'])}`
      if (!byIdentifier[key]) byIdentifier[key] = []
      byIdentifier[key].push(item)
    }
    for (const items of Object.values(byIdentifier)) {
      const variants = new Set(items.map(rowExactKey))
      if (variants.size <= 1) continue
      for (const item of items) {
        item.状态 = 'exception'
        item.异常原因 = `Non-identical rows share SKU identifiers ${compact(item['SKU编码'])}/${compact(item['SKU货号'])}`
      }
    }

    const selectedRows = resolved.filter(item => !pilotStyle || compact(item['款号']) === pilotStyle)
    const skcGroups = {}
    for (const item of selectedRows) {
      const skc = compact(item['SKC'])
      if (!skcGroups[skc]) skcGroups[skc] = []
      skcGroups[skc].push(item)
    }

    let excelTargets = Object.keys(skcGroups).sort().map(skc => {
      const items = [...skcGroups[skc]].sort((left, right) => (
        sizeSortKey(left['尺码']).localeCompare(sizeSortKey(right['尺码']))
        || compact(left['SKU货号']).localeCompare(compact(right['SKU货号']))
      ))
      const representative = items.find(item => item.状态 === 'ready') || items[0]
      return {
        style: compact(representative['款号']),
        color: textOf(representative['颜色']),
        skc,
        representativeSize: compact(representative['尺码']),
        skuCode: compact(representative['SKU编码']),
        skuNo: compact(representative['SKU货号']),
        sizeCount: items.length,
        status: representative.状态,
        reason: representative.异常原因 || '',
        outputFilename: `${compact(representative['SKU编码'])}-${compact(representative['SKU货号'])}.pdf`,
      }
    })
    if (maxSkc > 0) excelTargets = excelTargets.slice(0, maxSkc)

    return {
      summary: {
        sourceRows: sourceRows.length,
        exactDuplicateRowsRemoved,
        uniqueRows: rows.length,
        selectedRows: selectedRows.length,
        selectedSkc: Object.keys(skcGroups).length,
        readyRows: selectedRows.filter(item => item.状态 === 'ready').length,
        needsScmRows: selectedRows.filter(item => item.状态 === 'needs_scm').length,
        exceptionRows: selectedRows.filter(item => item.状态 === 'exception').length,
        pilotStyle: pilotStyle || '',
        maxSkc,
      },
      excelTargets,
    }
  }

  function safeFilename(value, fallback) {
    return String(value || '')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/^\.+|\.+$/g, '') || fallback
  }

  function visible(element) {
    if (!element || !element.getClientRects?.().length) return false
    const rect = element.getBoundingClientRect?.()
    if (!rect || !rect.width || !rect.height) return false
    const style = getComputedStyle(element)
    return style.display !== 'none' && style.visibility !== 'hidden'
  }

  function centerClick(element, delayMs = 120) {
    if (!element) return null
    try { element.scrollIntoView?.({ block: 'center', inline: 'center' }) } catch (error) {}
    const rect = element.getBoundingClientRect?.()
    if (!rect || !rect.width || !rect.height) return null
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      delay_ms: delayMs,
    }
  }

  function nextPhase(name, sleepMs = 500, nextShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: {
        action: 'next_phase',
        next_phase: name,
        sleep_ms: sleepMs,
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

  function fail(message) {
    return { success: false, error: message }
  }

  function safeApiError(error) {
    const name = textOf(error?.name || 'Error')
    const message = textOf(error?.message || error || '未知错误')
      .replace(/(anti-content|authorization|cookie|token)(?:\s*[:=]\s*)?[^\s,;]*/ig, '$1=[redacted]')
      .slice(0, 300)
    return `${name}: ${message}`
  }

  function pagePostRequest() {
    const chunks = window.chunkLoadingGlobal_temu_sca_goods
    if (!Array.isArray(chunks)) {
      throw new Error('TEMU 页面请求模块尚未加载')
    }
    let webpackRequire = null
    const chunkId = `crawshrimp-wash-label-${Date.now()}-${Math.random().toString(36).slice(2)}`
    chunks.push([[chunkId], {}, runtime => { webpackRequire = runtime }])
    if (typeof webpackRequire !== 'function') {
      throw new Error('TEMU 页面 webpack 运行时不可用')
    }
    let requestModule = null
    try {
      requestModule = webpackRequire(45689)
    } catch (error) {}
    if (typeof requestModule?.b !== 'function') {
      const candidateId = Object.keys(webpackRequire.m || {}).find(moduleId => {
        const source = String(webpackRequire.m[moduleId] || '')
        return source.length < 800
          && source.includes('.Gk)(')
          && source.includes('.Jt')
          && source.includes('.bE')
          && source.includes('{b:')
      })
      if (candidateId) {
        try {
          requestModule = webpackRequire(candidateId)
        } catch (error) {}
      }
    }
    const post = requestModule?.b
    if (typeof post !== 'function') {
      throw new Error('TEMU 页面 POST 请求封装不可用')
    }
    return post
  }

  async function pagePost(path, payload) {
    class PassthroughResponse {}
    const post = pagePostRequest()
    return await post(PassthroughResponse, path, payload, { skipCheck: true })
  }

  function responseData(response) {
    return response?.res ?? response ?? {}
  }

  function normalizeApiRecord(item) {
    const labelCodeVO = item?.labelCodeVO || {}
    const requirement = item?.labelRequirement || {}
    return {
      productId: Number(item?.productId || 0),
      productSkuId: Number(labelCodeVO.productSkuId || 0),
      productSkcId: Number(labelCodeVO.productSkcId || 0),
      labelCode: Number(labelCodeVO.labelCode || 0),
      skcExtCode: compact(labelCodeVO.skcExtCode),
      skuExtCode: compact(labelCodeVO.skuExtCode),
      productName: textOf(item?.productName),
      labelType: Number(requirement.labelType || 0),
      cosmeticLabelStatus: Number(requirement.cosmeticLabelStatus || 0),
      needCosmeticLabel: requirement.needCosmeticLabel === true,
    }
  }

  function isDownloadable(record) {
    return !!(
      record?.productId
      && record?.productSkuId
      && record?.productSkcId
      && record?.labelCode
      && record?.skcExtCode
      && record?.skuExtCode
      && record.needCosmeticLabel
      && record.labelType === 3
      && record.cosmeticLabelStatus === 2
    )
  }

  function targetKey(target) {
    return [
      Number(target?.labelCode || 0),
      Number(target?.productSkcId || 0),
      Number(target?.productSkuId || 0),
      compact(target?.skuExtCode),
    ].join('|')
  }

  function mergeTargets(existing, incoming) {
    const seen = new Set()
    const merged = []
    for (const item of [...(existing || []), ...(incoming || [])]) {
      if (!isDownloadable(item)) continue
      const key = targetKey(item)
      if (!key || seen.has(key)) continue
      seen.add(key)
      merged.push({ ...item })
    }
    return merged
  }

  function assignOutputFilenames(targets) {
    const bases = targets.map(target => (
      `${safeFilename(target.excelSkuCode || target.skcExtCode, String(target.productSkcId || 'SKU编码'))}`
      + `-${safeFilename(target.excelSkuNo || target.skuExtCode, String(target.productSkuId || 'SKU货号'))}`
    ))
    const counts = bases.reduce((result, base) => {
      result[base] = Number(result[base] || 0) + 1
      return result
    }, {})
    return targets.map((target, index) => ({
      ...target,
      outputFilename: counts[bases[index]] > 1
        ? `${bases[index]}-${safeFilename(target.labelCode, 'TEMU标签编码')}.pdf`
        : `${bases[index]}.pdf`,
    }))
  }

  function apiTargets() {
    return Array.isArray(shared.apiTargets) ? shared.apiTargets : []
  }

  function apiTarget() {
    const targets = apiTargets()
    const index = Math.max(0, Number(shared.currentTargetIndex || 0))
    const target = shared.apiTarget || targets[index] || {}
    return {
      productId: Number(target.productId || 0),
      productSkuId: Number(target.productSkuId || 0),
      productSkcId: Number(target.productSkcId || 0),
      labelCode: Number(target.labelCode || 0),
      skcExtCode: compact(target.skcExtCode),
      skuExtCode: compact(target.skuExtCode),
      productName: textOf(target.productName),
      labelType: Number(target.labelType || 0),
      cosmeticLabelStatus: Number(target.cosmeticLabelStatus || 0),
      needCosmeticLabel: target.needCosmeticLabel === true,
      outputFilename: textOf(target.outputFilename),
      excelStyle: compact(target.excelStyle || target.style),
      excelColor: textOf(target.excelColor || target.color),
      excelSkc: compact(target.excelSkc || target.skc),
      excelSkuCode: compact(target.excelSkuCode || target.skuCode),
      excelSkuNo: compact(target.excelSkuNo || target.skuNo),
      excelRepresentativeSize: compact(target.excelRepresentativeSize || target.representativeSize),
      excelSizeCount: Number(target.excelSizeCount || target.sizeCount || 0),
    }
  }

  function excelTargets() {
    return Array.isArray(shared.excelTargets) ? shared.excelTargets : []
  }

  function excelTarget() {
    const targets = excelTargets()
    const index = Math.max(0, Number(shared.currentExcelTargetIndex || 0))
    return shared.excelTarget || targets[index] || {}
  }

  function excelMode() {
    return Array.isArray(shared.excelTargets)
  }

  function advancePhaseName() {
    return excelMode() ? 'advance_excel_target' : 'advance_target'
  }

  function currentStoreName() {
    const account = [...document.querySelectorAll('[class*="account-info_accountInfo"]')]
      .find(visible)
    if (!account) return ''
    return textOf(account)
  }

  function resultRow(result, reason = '', extra = {}, explicitTarget = null) {
    const target = explicitTarget || apiTarget()
    const currentExcelTarget = excelTarget()
    const targetIndex = excelMode()
      ? Math.max(0, Number(shared.currentExcelTargetIndex || 0))
      : Math.max(0, Number(shared.currentTargetIndex || 0))
    const batchTotal = excelMode() ? excelTargets().length : apiTargets().length
    return {
      店铺: currentStoreName() || targetStore,
      批量序号: batchTotal ? targetIndex + 1 : 0,
      批量总数: batchTotal,
      接口扫描总记录: Number(shared.scanTotalRecords || 0),
      已制作洗水唛数量: Number(shared.apiMadeWashLabelCount || 0),
      款号: compact(target?.excelStyle || currentExcelTarget.style),
      SKC: compact(target?.excelSkc || currentExcelTarget.skc),
      颜色: textOf(target?.excelColor || currentExcelTarget.color),
      代表尺码: compact(target?.excelRepresentativeSize || currentExcelTarget.representativeSize),
      尺码数: Number(target?.excelSizeCount || currentExcelTarget.sizeCount || 0),
      SKU编码: compact(target?.excelSkuCode || currentExcelTarget.skuCode || target?.skcExtCode),
      SKU货号: compact(target?.excelSkuNo || currentExcelTarget.skuNo || target?.skuExtCode),
      TEMU行状态: String(extra.temuRowStatus || shared.temuRowStatus || ''),
      请求格式: 'PDF',
      下载模式: 'official_batch',
      结果: result,
      来源: result === 'official_download_received' ? 'temu_official_download' : 'official_download_failed',
      文件名: textOf(target?.outputFilename),
      文件路径: String(extra.path || ''),
      文件大小: Number(extra.bytes || 0),
      PDF签名已校验: !!extra.signatureValidated,
      页面API已校验: !!shared.apiValidated,
      TEMU产品ID: Number(target?.productId || 0),
      TEMU商品SKU_ID: Number(target?.productSkuId || 0),
      TEMU商品SKC_ID: Number(target?.productSkcId || 0),
      TEMU标签编码: Number(target?.labelCode || 0),
      洗水唛宽度mm: Number(shared.careLabel?.width || 0),
      洗水唛长度mm: Number(shared.careLabel?.len || 0),
      上下预留mm: Number(shared.careLabel?.padding || 0),
      洗水唛尺码: String(shared.careLabel?.size || ''),
      原因: String(reason || ''),
      ...extra,
    }
  }

  function resetTargetState(nextShared) {
    return {
      ...nextShared,
      careLabel: null,
      downloadResult: null,
      temuRowStatus: '已制作',
      careQueryAttempts: 0,
      careLastError: '',
      searchControlAttempts: 0,
      searchAttempts: 0,
      queriedSkuNo: '',
      matchedRowText: '',
      exportModalAttempts: 0,
      exportConfirmAttempts: 0,
      officialDownloadPath: '',
      officialDownloadReceived: false,
      officialDownloadError: '',
    }
  }

  function attachExcelTarget(record, target) {
    return {
      ...record,
      excelStyle: compact(target?.style),
      excelColor: textOf(target?.color),
      excelSkc: compact(target?.skc),
      excelSkuCode: compact(target?.skuCode),
      excelSkuNo: compact(target?.skuNo),
      excelRepresentativeSize: compact(target?.representativeSize),
      excelSizeCount: Number(target?.sizeCount || 0),
      outputFilename: textOf(target?.outputFilename)
        || `${safeFilename(target?.skuCode, String(record?.productSkcId || 'SKU编码'))}-${safeFilename(target?.skuNo || record?.skuExtCode, String(record?.productSkuId || 'SKU货号'))}.pdf`,
    }
  }

  function continueAfterFailure(reason, extra = {}, nextShared = shared) {
    return nextPhase(
      advancePhaseName(),
      100,
      { ...nextShared, temuRowStatus: String(extra.temuRowStatus || '单条失败') },
      [resultRow('official_download_failed', reason, extra)],
    )
  }

  function finalizeScan(nextShared) {
    let targets = assignOutputFilenames(nextShared.apiTargets || [])
    if (maxDownloads > 0) targets = targets.slice(0, maxDownloads)
    const scanShared = {
      ...nextShared,
      apiValidated: true,
      apiTargets: targets,
      apiMadeWashLabelCount: targets.length,
      currentTargetIndex: 0,
      apiTarget: targets[0] || null,
      scanCompleted: !nextShared.scanStoppedByLimit,
    }
    if (!targets.length) {
      return complete([
        resultRow('batch_no_downloadable', '当前店铺未找到“已制作且可导出”的洗水唛', {
          temuRowStatus: '无可下载记录',
        }, {}),
      ], scanShared)
    }
    return nextPhase('api_care_query', 150, resetTargetState(scanShared))
  }

  async function mapWithConcurrency(values, concurrency, worker) {
    const results = new Array(values.length)
    let nextIndex = 0
    async function runWorker() {
      while (nextIndex < values.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await worker(values[index], index)
      }
    }
    const count = Math.max(1, Math.min(Number(concurrency || 1), values.length || 1))
    await Promise.all(Array.from({ length: count }, () => runWorker()))
    return results
  }

  async function queryApiPage(page) {
    const response = await pagePost('/visage-agent-seller/labelcode/pageQuery', {
      page,
      pageSize: API_PAGE_SIZE,
    })
    const payload = responseData(response)
    const pageItems = Array.isArray(payload.pageItems) ? payload.pageItems : []
    return {
      page,
      total: Number(payload.total || 0),
      records: pageItems.map(normalizeApiRecord),
    }
  }

  function targetStoreSection(modal) {
    const sections = [...modal.querySelectorAll('[class*="account-info_mallSection"]')]
    return sections.find(section => {
      const name = section.querySelector('[class*="account-info_mallName"]')
      return textOf(name) === targetStore
    }) || null
  }

  function storeSwitchModal() {
    return [...document.querySelectorAll('[data-testid="beast-core-modal"]')]
      .filter(visible)
      .find(modal => textOf(modal).includes('切换店铺')) || null
  }

  function openStoreDropdown() {
    const account = [...document.querySelectorAll('[class*="account-info_accountInfo"]')]
      .find(visible)
    if (!account) return false
    account.click?.()
    return true
  }

  function findDropdownSwitchButton() {
    return [...document.querySelectorAll('[class*="account-info_operatorBtn"]')]
      .filter(visible)
      .find(element => textOf(element) === '切换' && !element.disabled) || null
  }

  function findSkuSearchInput() {
    const candidates = [...document.querySelectorAll('input[placeholder="多个查询请空格或逗号依次输入"]')]
      .filter(visible)
    const relatedToSku = candidates.find(input => {
      let parent = input.parentElement
      for (let depth = 0; parent && depth < 7; depth += 1, parent = parent.parentElement) {
        const inputs = [...parent.querySelectorAll('input')]
        if (inputs.some(candidate => compact(candidate.value) === 'SKU')) return true
      }
      return false
    })
    return relatedToSku || (candidates.length >= 2 ? candidates[1] : candidates[0]) || null
  }

  function setInputValue(input, value) {
    if (!input) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (setter) setter.call(input, value)
    else input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return input.value === value
  }

  function findQueryButton() {
    return [...document.querySelectorAll('button')]
      .filter(visible)
      .find(button => textOf(button) === '查询' && !button.disabled) || null
  }

  function matchingRows() {
    const skuNo = apiTarget().skuExtCode
    if (!skuNo) return []
    return [...document.querySelectorAll('tr')]
      .filter(row => textOf(row).includes(skuNo))
  }

  function apiIdentityRows() {
    const target = apiTarget()
    const requiredTokens = [
      target.labelCode,
      target.productSkcId,
      target.productSkuId,
      target.skuExtCode,
    ].map(value => String(value || '')).filter(Boolean)
    if (requiredTokens.length < 4) return []
    return matchingRows().filter(row => {
      const tokens = textOf(row).split(/\s+/).filter(Boolean)
      return requiredTokens.every(token => tokens.includes(token))
    })
  }

  function madeWashLabelRow() {
    const rows = apiIdentityRows().filter(row => {
      const rowText = textOf(row)
      if (!rowText.includes('已制作') || !rowText.includes('洗水唛')) return false
      return [...row.querySelectorAll('a,button,[role="button"]')]
        .some(action => textOf(action) === '导出')
    })
    return rows.length === 1 ? rows[0] : null
  }

  function exportAction(row) {
    return [...row.querySelectorAll('a,button,[role="button"]')]
      .find(action => visible(action) && textOf(action) === '导出') || null
  }

  function exportModal() {
    return [...document.querySelectorAll('[data-testid="beast-core-modal"]')]
      .filter(visible)
      .find(modal => textOf(modal).includes('确认导出吗？')) || null
  }

  function exportFormatLabel(modal, labelText) {
    return [...modal.querySelectorAll('label[data-testid="beast-core-checkbox"]')]
      .find(label => textOf(label) === labelText) || null
  }

  function isChecked(label) {
    if (!label) return false
    if (label.getAttribute?.('data-checked') === 'true') return true
    return !!label.querySelector?.('input[type="checkbox"]')?.checked
  }

  function temuPdfUrlBlobExpression() {
    return `
(async () => {
  const compact = value => String(value || '').replace(/\\s+/g, ' ').trim();
  const toBase64 = bytes => {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  };
  const modal = [...document.querySelectorAll('[data-testid="beast-core-modal"]')]
    .find(element => compact(element.innerText || element.textContent).includes('确认导出吗'));
  if (!modal) return { success: false, error: 'TEMU export modal not found' };
  const canvas = modal.querySelector('canvas');
  const fiberKey = Object.keys(modal).find(key => key.startsWith('__reactFiber'));
  let fiber = fiberKey ? modal[fiberKey] : null;
  let pdfUrl = '';
  for (let depth = 0; fiber && depth < 30; depth += 1, fiber = fiber.return) {
    if (fiber.memoizedProps && typeof fiber.memoizedProps.pdfUrl === 'string') {
      pdfUrl = fiber.memoizedProps.pdfUrl;
      break;
    }
  }
  if (!pdfUrl || !pdfUrl.startsWith('blob:')) {
    return { success: false, error: 'TEMU export modal pdfUrl not found' };
  }
  const response = await fetch(pdfUrl);
  const blob = await response.blob();
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(...bytes.slice(0, 5));
  return {
    success: true,
    data: [{
      url: pdfUrl,
      type: blob.type || '',
      bytes: bytes.length,
      magic,
      canvasWidth: Number(canvas?.width || 0),
      canvasHeight: Number(canvas?.height || 0),
      base64: toBase64(bytes),
    }],
  };
})()
`.trim()
  }

  function bestDownloadItem(downloadResult) {
    const items = Array.isArray(downloadResult?.items) ? downloadResult.items : []
    return items.find(item => item?.success && item?.signatureValidated && item?.path)
      || items.find(item => item?.success && item?.path)
      || items[0]
      || null
  }

  if (!/\/goods\/label(?:$|[?#])/.test(String(location.href || ''))) {
    return fail(`当前页面不是 TEMU 商品条码管理页：${String(location.href || '')}`)
  }

  if (phase === 'init') {
    const observedStore = currentStoreName()
    if (!observedStore) {
      const attempts = Number(shared.storeReadAttempts || 0)
      if (attempts >= 10) return fail('无法读取当前 TEMU 店铺名称')
      return nextPhase('init', 800, { ...shared, storeReadAttempts: attempts + 1 })
    }
    if (!targetStore || observedStore === targetStore) {
      return nextPhase(sourceRowsFromParam().length ? 'excel_prepare' : 'api_scan', 300, {
        ...shared,
        observedStoreBefore: observedStore,
        observedStoreAfter: observedStore,
      })
    }
    if (!openStoreDropdown()) return fail('无法打开 TEMU 店铺菜单')
    return nextPhase('open_store_switch', 300, {
      ...shared,
      observedStoreBefore: observedStore,
      storeSwitchAttempts: 0,
    })
  }

  if (phase === 'open_store_switch') {
    if (storeSwitchModal()) return nextPhase('choose_store', 0, shared)
    const switchButton = findDropdownSwitchButton()
    if (switchButton) {
      switchButton.click?.()
      return nextPhase('choose_store', 400, shared)
    }
    const attempts = Number(shared.storeSwitchAttempts || 0)
    if (attempts >= 8) return fail('店铺菜单中未找到“切换”入口')
    if (attempts > 0) openStoreDropdown()
    return nextPhase('open_store_switch', 500, {
      ...shared,
      storeSwitchAttempts: attempts + 1,
    })
  }

  if (phase === 'choose_store') {
    const modal = storeSwitchModal()
    if (!modal) {
      const attempts = Number(shared.chooseStoreAttempts || 0)
      if (attempts >= 8) return fail('未出现 TEMU 切换店铺弹窗')
      return nextPhase('choose_store', 500, {
        ...shared,
        chooseStoreAttempts: attempts + 1,
      })
    }
    const section = targetStoreSection(modal)
    if (!section) {
      const stores = [...modal.querySelectorAll('[class*="account-info_mallName"]')]
        .map(textOf)
        .filter(Boolean)
      return complete([
        resultRow('batch_store_not_found', `当前账号看不到目标店铺：${targetStore}`, {
          可用店铺: stores.join('、'),
        }, {}),
      ], { ...shared, availableStores: stores })
    }
    const button = section.querySelector('button[class*="account-info_operatorBtn"]')
    if (!button || button.disabled) {
      return nextPhase('verify_store', 300, shared)
    }
    button.click?.()
    return nextPhase('verify_store', 1200, {
      ...shared,
      storeVerifyAttempts: 0,
    })
  }

  if (phase === 'verify_store') {
    const observedStore = currentStoreName()
    if (observedStore === targetStore) {
      return nextPhase(sourceRowsFromParam().length ? 'excel_prepare' : 'api_scan', 500, {
        ...shared,
        observedStoreAfter: observedStore,
      })
    }
    const attempts = Number(shared.storeVerifyAttempts || 0)
    if (attempts >= 15) {
      return fail(`店铺切换后回读不匹配：期望 ${targetStore}，实际 ${observedStore || '未知'}`)
    }
    return nextPhase('verify_store', 800, {
      ...shared,
      storeVerifyAttempts: attempts + 1,
    })
  }

  if (phase === 'api_scan') {
    try {
      if (!Number(shared.scanTotalPages || 0)) {
        const first = await queryApiPage(1)
        const targets = mergeTargets([], first.records)
        const totalPages = Math.max(1, Math.ceil(first.total / API_PAGE_SIZE))
        const stoppedByLimit = maxDownloads > 0 && targets.length >= maxDownloads
        const nextShared = {
          ...shared,
          apiValidated: true,
          apiScanAttempts: 0,
          scanTotalRecords: first.total,
          scanTotalPages: totalPages,
          scanNextPage: 2,
          scanPagesCompleted: 1,
          scanStoppedByLimit: stoppedByLimit,
          apiTargets: stoppedByLimit ? targets.slice(0, maxDownloads) : targets,
        }
        if (stoppedByLimit || totalPages <= 1) return finalizeScan(nextShared)
        return nextPhase('api_scan', 50, nextShared)
      }

      const startPage = Math.max(2, Number(shared.scanNextPage || 2))
      const endPage = Math.min(
        Number(shared.scanTotalPages || startPage),
        startPage + SCAN_PAGES_PER_PHASE - 1,
      )
      const pages = Array.from(
        { length: Math.max(0, endPage - startPage + 1) },
        (_, index) => startPage + index,
      )
      const batches = await mapWithConcurrency(pages, SCAN_CONCURRENCY, queryApiPage)
      const discovered = batches
        .flatMap(batch => batch.records)
        .filter(isDownloadable)
      let targets = mergeTargets(shared.apiTargets || [], discovered)
      const stoppedByLimit = maxDownloads > 0 && targets.length >= maxDownloads
      if (stoppedByLimit) targets = targets.slice(0, maxDownloads)
      const nextShared = {
        ...shared,
        apiValidated: true,
        apiScanAttempts: 0,
        scanNextPage: endPage + 1,
        scanPagesCompleted: endPage,
        scanStoppedByLimit: stoppedByLimit,
        apiTargets: targets,
      }
      if (stoppedByLimit || endPage >= Number(shared.scanTotalPages || 0)) {
        return finalizeScan(nextShared)
      }
      return nextPhase('api_scan', 50, nextShared)
    } catch (error) {
      const attempts = Number(shared.apiScanAttempts || 0)
      if (attempts < 2) {
        return nextPhase('api_scan', 600, {
          ...shared,
          apiScanAttempts: attempts + 1,
          apiLastError: safeApiError(error),
        })
      }
      const failedShared = {
        ...shared,
        apiValidated: false,
        apiLastError: safeApiError(error),
        temuRowStatus: 'API批量扫描失败',
      }
      return complete([
        resultRow('batch_scan_failed', 'TEMU 页面 API 批量扫描失败，请确认登录状态和页面是否完整加载', {
          temuRowStatus: 'API批量扫描失败',
          API错误: safeApiError(error),
        }, {}),
      ], failedShared)
    }
  }

  if (phase === 'excel_prepare') {
    const workflow = buildWorkbookWorkflow()
    if (!workflow) return nextPhase('api_scan', 100, shared)
    if (workflow.error) {
      return complete([
        resultRow('excel_invalid', workflow.error, {
          temuRowStatus: 'Excel校验失败',
        }, {}),
      ], {
        ...shared,
        workbookError: workflow.error,
      })
    }
    let targets = workflow.excelTargets || []
    if (maxDownloads > 0) targets = targets.slice(0, maxDownloads)
    const nextShared = {
      ...shared,
      workflowMode: 'excel_representative_skc_download',
      workflowSummary: workflow.summary,
      excelTargets: targets,
      currentExcelTargetIndex: 0,
      excelTarget: targets[0] || null,
      apiMadeWashLabelCount: 0,
      scanTotalRecords: workflow.summary?.selectedRows || 0,
    }
    if (!targets.length) {
      return complete([
        resultRow('excel_no_targets', 'Excel 没有匹配的 SKC 目标，请检查款号筛选或表格内容', {
          temuRowStatus: 'Excel无目标',
          workflowSummary: workflow.summary,
        }, {}),
      ], nextShared)
    }
    return nextPhase('api_lookup_excel_target', 150, resetTargetState(nextShared))
  }

  if (phase === 'api_lookup_excel_target') {
    const target = excelTarget()
    if (!target || !target.skuNo) {
      return nextPhase('advance_excel_target', 100, {
        ...shared,
        temuRowStatus: 'Excel目标缺少SKU货号',
      }, [
        resultRow('excel_target_invalid', 'Excel 代表目标缺少 SKU货号', {
          temuRowStatus: 'Excel目标缺少SKU货号',
        }, target || {}),
      ])
    }
    if (target.status && target.status !== 'ready') {
      return nextPhase('advance_excel_target', 100, {
        ...shared,
        temuRowStatus: target.status === 'needs_scm' ? '待SCM补充' : 'Excel异常',
      }, [
        resultRow(target.status === 'needs_scm' ? 'needs_scm' : 'excel_exception', target.reason || 'Excel 目标未达到可制作条件', {
          temuRowStatus: target.status === 'needs_scm' ? '待SCM补充' : 'Excel异常',
        }, target),
      ])
    }
    try {
      const response = await pagePost('/visage-agent-seller/labelcode/pageQuery', {
        page: 1,
        pageSize: API_QUERY_PAGE_SIZE,
        skuExtCodes: [target.skuNo],
      })
      const payload = responseData(response)
      const records = (Array.isArray(payload.pageItems) ? payload.pageItems : [])
        .map(normalizeApiRecord)
        .filter(record => record.skuExtCode === compact(target.skuNo))
      const downloadable = records.filter(isDownloadable)
      if (downloadable.length > 1) {
        return nextPhase('advance_excel_target', 100, {
          ...shared,
          temuRowStatus: 'TEMU可导出记录不唯一',
        }, [
          resultRow('temu_downloadable_not_unique', 'TEMU 查询到多条可导出的已制作洗水唛记录，未自动选择', {
            temuRowStatus: 'TEMU可导出记录不唯一',
            TEMU匹配记录数: records.length,
            TEMU可导出记录数: downloadable.length,
          }, target),
        ])
      }
      if (downloadable.length === 1) {
        const apiRecord = attachExcelTarget(downloadable[0], target)
        return nextPhase('api_care_query', 150, resetTargetState({
          ...shared,
          apiValidated: true,
          apiTarget: apiRecord,
          apiMadeWashLabelCount: Number(shared.apiMadeWashLabelCount || 0) + 1,
          temuRowStatus: '已制作',
        }))
      }
      if (records.length) {
        const record = records[0]
        const status = record.needCosmeticLabel && record.labelType === 3 && record.cosmeticLabelStatus !== 2
          ? 'needs_temu_creation'
          : 'temu_not_downloadable'
        return nextPhase('advance_excel_target', 100, {
          ...shared,
          temuRowStatus: status === 'needs_temu_creation' ? 'TEMU待制作' : 'TEMU不可导出',
        }, [
          resultRow(status, status === 'needs_temu_creation' ? 'TEMU 已有洗水唛要求但尚未显示已制作，未自动进入制作/保存' : 'TEMU 记录当前不满足洗水唛 PDF 导出条件', {
            temuRowStatus: status === 'needs_temu_creation' ? 'TEMU待制作' : 'TEMU不可导出',
            TEMU匹配记录数: records.length,
            TEMU标签类型: record.labelType,
            TEMU洗水唛状态: record.cosmeticLabelStatus,
            TEMU需要洗水唛: record.needCosmeticLabel,
          }, target),
        ])
      }
      return nextPhase('advance_excel_target', 100, {
        ...shared,
        temuRowStatus: 'TEMU未找到SKU',
      }, [
        resultRow('temu_sku_not_found', `TEMU 未查询到 SKU货号：${target.skuNo}`, {
          temuRowStatus: 'TEMU未找到SKU',
        }, target),
      ])
    } catch (error) {
      const attempts = Number(shared.excelLookupAttempts || 0)
      if (attempts < 2) {
        return nextPhase('api_lookup_excel_target', 600, {
          ...shared,
          excelLookupAttempts: attempts + 1,
          excelLookupLastError: safeApiError(error),
        })
      }
      return nextPhase('advance_excel_target', 100, {
        ...shared,
        excelLookupAttempts: 0,
        excelLookupLastError: safeApiError(error),
        temuRowStatus: 'TEMU查询失败',
      }, [
        resultRow('temu_lookup_failed', 'TEMU 页面 API 查询 Excel 代表 SKU 失败', {
          temuRowStatus: 'TEMU查询失败',
          API错误: safeApiError(error),
        }, target),
      ])
    }
  }

  if (phase === 'api_care_query') {
    const target = apiTarget()
    if (!target.productId || !target.productSkuId || !target.labelCode) {
      return continueAfterFailure('页面 API 目标记录缺少 productId、productSkuId 或 labelCode', {
        temuRowStatus: '目标标识缺失',
      })
    }
    try {
      const response = await pagePost('/visage-agent-seller/labelcode/care/query', {
        productId: target.productId,
        productSkuId: target.productSkuId,
      })
      const care = responseData(response)
      const careLabel = {
        productId: Number(care.productId || 0),
        productSkuId: Number(care.productSkuId || 0),
        productSkcId: Number(care.productSkcId || 0),
        width: Number(care.width || 0),
        len: Number(care.len || 0),
        padding: Number(care.padding || 0),
        size: textOf(care.size),
      }
      if (
        careLabel.productId !== target.productId
        || careLabel.productSkuId !== target.productSkuId
        || !careLabel.width
        || !careLabel.len
      ) {
        return continueAfterFailure('洗水唛详情 API 回读与目标记录不一致或尺寸缺失', {
          temuRowStatus: '详情校验失败',
        }, {
          ...shared,
          apiValidated: false,
          careLabel,
        })
      }
      return nextPhase('prepare_search', 250, {
        ...shared,
        apiValidated: true,
        careLabel,
        careQueryAttempts: 0,
      })
    } catch (error) {
      const attempts = Number(shared.careQueryAttempts || 0)
      if (attempts < 2) {
        return nextPhase('api_care_query', 600, {
          ...shared,
          careQueryAttempts: attempts + 1,
          careLastError: safeApiError(error),
        })
      }
      return continueAfterFailure('洗水唛详情 API 查询失败，请确认登录状态和页面是否完整加载', {
        temuRowStatus: '详情查询失败',
        API错误: safeApiError(error),
      }, {
        ...shared,
        apiValidated: false,
        careLastError: safeApiError(error),
      })
    }
  }

  if (phase === 'prepare_search') {
    const target = apiTarget()
    const input = findSkuSearchInput()
    const queryButton = findQueryButton()
    if (!input || !queryButton) {
      const attempts = Number(shared.searchControlAttempts || 0)
      if (attempts >= 10) {
        return continueAfterFailure('未找到 SKU货号输入框或查询按钮', {
          temuRowStatus: '页面查询控件缺失',
        })
      }
      return nextPhase('prepare_search', 700, {
        ...shared,
        searchControlAttempts: attempts + 1,
      })
    }
    if (!setInputValue(input, target.skuExtCode)) {
      return continueAfterFailure('SKU货号未能写入查询输入框', {
        temuRowStatus: '页面查询输入失败',
      })
    }
    queryButton.click?.()
    return nextPhase('verify_search', 800, {
      ...shared,
      searchAttempts: 0,
      queriedSkuNo: target.skuExtCode,
    })
  }

  if (phase === 'verify_search') {
    const target = apiTarget()
    const identityRows = apiIdentityRows()
    if (identityRows.length > 1) {
      return continueAfterFailure('页面出现多条与 API 标识完全相同的记录，未执行导出', {
        temuRowStatus: '页面记录不唯一',
        页面精确匹配行数: identityRows.length,
      })
    }
    const targetRow = madeWashLabelRow()
    if (targetRow) {
      const action = exportAction(targetRow)
      if (!action) {
        return continueAfterFailure('已制作洗水唛行缺少导出按钮', {
          temuRowStatus: '导出按钮缺失',
        })
      }
      action.click?.()
      return nextPhase('prepare_export', 600, {
        ...shared,
        temuRowStatus: '已制作',
        matchedRowText: textOf(targetRow),
      })
    }

    const rows = matchingRows()
    if (rows.length) {
      const attempts = Number(shared.searchAttempts || 0)
      if (attempts < 2) {
        return nextPhase('verify_search', 500, {
          ...shared,
          searchAttempts: attempts + 1,
        })
      }
      return continueAfterFailure('页面结果与 API 目标标识不一致，未执行导出', {
        temuRowStatus: '页面/API不一致',
        匹配行数: rows.length,
        API精确匹配行数: identityRows.length,
      })
    }

    const attempts = Number(shared.searchAttempts || 0)
    const pageText = textOf(document.body)
    if (attempts >= 10 || (attempts >= 2 && pageText.includes('共有 0 条'))) {
      return continueAfterFailure(`页面未查询到 API 已枚举的 SKU货号：${target.skuExtCode}`, {
        temuRowStatus: '页面未找到',
      })
    }
    return nextPhase('verify_search', 700, {
      ...shared,
      searchAttempts: attempts + 1,
    })
  }

  if (phase === 'prepare_export') {
    const modal = exportModal()
    if (!modal) {
      const attempts = Number(shared.exportModalAttempts || 0)
      if (attempts >= 10) {
        return continueAfterFailure('点击导出后未出现“确认导出吗？”弹窗', {
          temuRowStatus: '导出弹窗缺失',
        })
      }
      return nextPhase('prepare_export', 500, {
        ...shared,
        exportModalAttempts: attempts + 1,
      })
    }
    const pdf = exportFormatLabel(modal, 'PDF')
    const png = exportFormatLabel(modal, 'PNG')
    if (!pdf || !png) return fail('导出弹窗中未找到 PDF/PNG 格式选项')
    if (!isChecked(pdf)) pdf.click?.()
    if (isChecked(png)) png.click?.()
    return nextPhase('verify_export_options', 500, {
      ...shared,
      exportConfirmAttempts: 0,
    })
  }

  if (phase === 'verify_export_options') {
    const target = apiTarget()
    const modal = exportModal()
    if (!modal) return fail('校验导出格式时弹窗已消失')
    const pdf = exportFormatLabel(modal, 'PDF')
    const png = exportFormatLabel(modal, 'PNG')
    if (!isChecked(pdf) || isChecked(png)) {
      return fail('导出格式未能稳定切换为仅 PDF')
    }
    const button = [...modal.querySelectorAll('button')]
      .find(candidate => visible(candidate) && textOf(candidate) === '确认无误，导出')
    if (button?.disabled) {
      const attempts = Number(shared.exportConfirmAttempts || 0)
      if (attempts >= 40) {
        const canvas = modal.querySelector('canvas')
        if (canvas?.width && canvas?.height) {
          return {
            success: true,
            data: [],
            meta: {
              action: 'download_clicks',
              items: [{
                label: `TEMU 官方洗水唛 PDF ${target.excelSkuCode || target.skcExtCode}-${target.excelSkuNo || target.skuExtCode}`,
                filename: target.outputFilename,
                clicks: [],
                page_blob_expression: temuPdfUrlBlobExpression(),
                expected_name_regex: '.+\\.pdf$',
                expected_magic: '%PDF-',
                min_bytes: 1024,
                timeout_ms: Math.round(timeoutSeconds * 1000),
                source: 'temu_official_download',
              }],
              strict: false,
              shared_key: 'downloadResult',
              next_phase: 'verify_download',
              sleep_ms: 200,
              shared: {
                ...shared,
                temuRowStatus: '已制作',
                exportFallback: 'pdfUrl_blob',
              },
            },
          }
        }
        return continueAfterFailure('PDF 预览未完成或最终导出按钮持续未启用，未执行导出点击', {
          temuRowStatus: '导出按钮未启用',
        })
      }
      return nextPhase('verify_export_options', 500, {
        ...shared,
        exportConfirmAttempts: attempts + 1,
      })
    }
    const click = centerClick(button)
    if (!click) return fail('未找到可点击的最终 PDF 导出按钮')
    return {
      success: true,
      data: [],
      meta: {
        action: 'download_clicks',
        items: [{
          label: `TEMU 官方洗水唛 PDF ${target.skcExtCode}-${target.skuExtCode}`,
          filename: target.outputFilename,
          clicks: [click],
          expected_name_regex: '.+\\.pdf$',
          expected_magic: '%PDF-',
          capture_blob_download: true,
          min_bytes: 1024,
          timeout_ms: Math.round(timeoutSeconds * 1000),
          source: 'temu_official_download',
        }],
        strict: false,
        shared_key: 'downloadResult',
        next_phase: 'verify_download',
        sleep_ms: 200,
        shared,
      },
    }
  }

  if (phase === 'verify_download') {
    const downloadResult = shared.downloadResult || {}
    const item = bestDownloadItem(downloadResult)
    if (item?.success && item.path) {
      return nextPhase(advancePhaseName(), 100, {
        ...shared,
        officialDownloadPath: item.path,
        officialDownloadReceived: true,
      }, [
        resultRow('official_download_received', '', {
          path: item.path,
          bytes: Number(item.bytes || 0),
          signatureValidated: item.signatureValidated !== false,
          匹配方式: String(item.matchedBy || ''),
          浏览器下载控制: String(item.browserDownloadControl?.method || ''),
        }),
      ])
    }
    return nextPhase(advancePhaseName(), 100, {
      ...shared,
      officialDownloadReceived: false,
      officialDownloadError: String(item?.error || '浏览器未返回官方 PDF 文件'),
    }, [
      resultRow('official_download_failed', String(item?.error || '浏览器未返回官方 PDF 文件'), {
        path: String(item?.path || ''),
        bytes: Number(item?.bytes || 0),
        signatureValidated: !!item?.signatureValidated,
        下载返回: JSON.stringify(downloadResult).slice(0, 1200),
      }),
    ])
  }

  if (phase === 'advance_excel_target') {
    const targets = excelTargets()
    const nextIndex = Number(shared.currentExcelTargetIndex || 0) + 1
    if (nextIndex >= targets.length) {
      return complete([], {
        ...shared,
        batchCompleted: true,
        completedTargetCount: targets.length,
      })
    }
    return nextPhase('api_lookup_excel_target', 150, resetTargetState({
      ...shared,
      currentExcelTargetIndex: nextIndex,
      excelTarget: targets[nextIndex],
      apiTarget: null,
      excelLookupAttempts: 0,
      excelLookupLastError: '',
    }))
  }

  if (phase === 'advance_target') {
    const targets = apiTargets()
    const nextIndex = Number(shared.currentTargetIndex || 0) + 1
    if (nextIndex >= targets.length) {
      return complete([], {
        ...shared,
        batchCompleted: true,
        completedTargetCount: targets.length,
      })
    }
    return nextPhase('api_care_query', 150, resetTargetState({
      ...shared,
      currentTargetIndex: nextIndex,
      apiTarget: targets[nextIndex],
    }))
  }

  return fail(`未知执行阶段：${phase}`)
})()
