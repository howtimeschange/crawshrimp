;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}

  const TARGET_URL = 'https://seller.kuajingmaihuo.com/labor/bill'
  const HISTORY_WAIT_LIMIT = 30

  function normalizeDateRangeParam(value) {
    if (!value || typeof value !== 'object') return {}
    const start = String(value.start || '').trim()
    const end = String(value.end || '').trim()
    if (start && !end) return { start, end: start }
    if (end && !start) return { start: end, end }
    if (!start || !end) return {}
    return { start, end }
  }

  const persistedRequestShared = {
    requestedMode: String(shared.requestedMode || params.mode || 'current').trim().toLowerCase(),
    requestedBillDateRange: normalizeDateRangeParam(shared.requestedBillDateRange || params.bill_date_range),
  }

  const mode = persistedRequestShared.requestedMode
  const billDateRange = persistedRequestShared.requestedBillDateRange

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

  function textOf(el) {
    return String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim()
  }

  function compact(value) {
    return String(value || '').replace(/\s+/g, '').trim()
  }

  function isVisible(el) {
    if (!el || typeof el.getClientRects !== 'function') return false
    return el.getClientRects().length > 0
  }

  function localNowText() {
    const date = new Date()
    const pad = value => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }

  function formatDateValue(date) {
    if (!(date instanceof Date) || Number.isNaN(date.valueOf())) return ''
    const pad = value => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  }

  function parseDateValue(dateText) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || '').trim())
    if (!match) return null
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0)
    return Number.isNaN(date.valueOf()) ? null : date
  }

  function parseDateLikeValue(value) {
    if (!value) return null
    if (value instanceof Date) {
      return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 0, 0, 0, 0)
    }
    const date = new Date(value)
    if (Number.isNaN(date.valueOf())) return null
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
  }

  function normalizeRangeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim()
  }

  function formatQueryRange(start, end) {
    if (!start || !end) return ''
    return `${start} ~ ${end}`
  }

  function rangeStartMs(startDate) {
    const date = parseDateValue(startDate)
    if (!date) return 0
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }

  function rangeEndMs(endDate) {
    const date = parseDateValue(endDate)
    if (!date) return 0
    date.setHours(23, 59, 59, 0)
    return date.getTime()
  }

  function formatDateTime(timestamp) {
    if (!timestamp && timestamp !== 0) return ''
    const date = new Date(Number(timestamp))
    if (Number.isNaN(date.valueOf())) return ''
    const pad = value => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }

  function mergeShared(newShared = shared) {
    return {
      ...persistedRequestShared,
      ...(newShared || {}),
    }
  }

  function nextPhase(name, sleepMs = 800, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: { action: 'next_phase', next_phase: name, sleep_ms: sleepMs, shared: mergeShared(newShared) },
    }
  }

  function complete(data, hasMore = false, newShared = shared) {
    return {
      success: true,
      data,
      meta: { action: 'complete', has_more: hasMore, shared: mergeShared(newShared) },
    }
  }

  function fail(message) {
    return { success: false, error: message }
  }

  function captureClickRequests(clicks, nextPhaseName, options = {}, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'capture_click_requests',
        clicks,
        matches: options.matches || [],
        timeout_ms: options.timeout_ms || 8000,
        settle_ms: options.settle_ms == null ? 800 : options.settle_ms,
        min_matches: options.min_matches || 1,
        include_response_body: options.include_response_body !== false,
        shared_key: options.shared_key || 'captureResult',
        shared_append: !!options.shared_append,
        strict: !!options.strict,
        next_phase: nextPhaseName,
        sleep_ms: options.sleep_ms || 0,
        shared: mergeShared(newShared),
      },
    }
  }

  function captureUrlRequests(url, nextPhaseName, options = {}, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'capture_url_requests',
        url,
        matches: options.matches || [],
        timeout_ms: options.timeout_ms || 12000,
        settle_ms: options.settle_ms == null ? 800 : options.settle_ms,
        min_matches: options.min_matches || 1,
        include_response_body: options.include_response_body !== false,
        shared_key: options.shared_key || 'captureResult',
        shared_append: !!options.shared_append,
        strict: !!options.strict,
        next_phase: nextPhaseName,
        sleep_ms: options.sleep_ms || 0,
        shared: mergeShared(newShared),
      },
    }
  }

  function downloadUrls(items, nextPhaseName, options = {}, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'download_urls',
        items,
        shared_key: options.shared_key || 'downloadResults',
        shared_append: !!options.shared_append,
        strict: !!options.strict,
        next_phase: nextPhaseName,
        sleep_ms: options.sleep_ms || 0,
        shared: mergeShared(newShared),
      },
    }
  }

  function downloadClicks(items, nextPhaseName, options = {}, newShared = shared) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'download_clicks',
        items,
        shared_key: options.shared_key || 'clickDownloadResults',
        shared_append: !!options.shared_append,
        strict: !!options.strict,
        next_phase: nextPhaseName,
        sleep_ms: options.sleep_ms || 0,
        shared: mergeShared(newShared),
      },
    }
  }

  function clickLike(el) {
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

  function getCenterClick(el, delayMs = 120) {
    if (!el) return null
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      delay_ms: delayMs,
    }
  }

  async function waitFor(condition, timeout = 8000, interval = 200) {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      if (condition()) return true
      await sleep(interval)
    }
    return false
  }

  function getVisibleDrawer() {
    const candidates = [
      ...document.querySelectorAll('[class*="Drawer_content_"]'),
      ...document.querySelectorAll('[class*="Drawer_outerWrapper_"]'),
    ].filter(isVisible)
    return candidates.find(node => /导出历史/.test(textOf(node))) || null
  }

  function getVisibleModalNodes() {
    return [...document.querySelectorAll('[data-testid="beast-core-modal"]')].filter(isVisible)
  }

  function getVisibleExportModal() {
    return getVisibleModalNodes().find(node => {
      const modalText = compact(textOf(node))
      return modalText.includes('导出') && modalText.includes('导出列表') && modalText.includes('账务详情')
    }) || null
  }

  function isInsideVisibleDrawer(el) {
    const drawer = getVisibleDrawer()
    return !!(drawer && el && drawer.contains(el))
  }

  function findVisibleAction(text, scope = document, { insideDrawer = null } = {}) {
    const nodes = [...scope.querySelectorAll('button, a, [role="button"]')]
      .filter(isVisible)
      .filter(node => textOf(node) === text)
    if (insideDrawer === null) return nodes[0] || null
    if (insideDrawer) return nodes.find(node => isInsideVisibleDrawer(node)) || null
    return nodes.find(node => !isInsideVisibleDrawer(node)) || null
  }

  function findMainAction(text) {
    return findVisibleAction(text, document, { insideDrawer: false })
  }

  function findDrawerAction(text) {
    const drawer = getVisibleDrawer()
    if (!drawer) return null
    return findVisibleAction(text, drawer, { insideDrawer: true })
  }

  function findPageExportHistoryAction() {
    const candidates = [...document.querySelectorAll('button, a, [role="button"]')]
      .filter(isVisible)
      .filter(node => textOf(node) === '导出历史')
      .filter(node => !isInsideVisibleDrawer(node))

    if (!candidates.length) return null

    const buttonLink = candidates.find(node => {
      return String(node.getAttribute?.('data-testid') || '').trim() === 'beast-core-button-link'
    })
    if (buttonLink) return buttonLink

    const exportButton = findMainAction('导出')
    if (!exportButton) return candidates[0] || null

    const exportRect = exportButton.getBoundingClientRect()
    const scoreOf = node => {
      const rect = node.getBoundingClientRect()
      const sameRowPenalty = Math.abs(rect.top - exportRect.top) * 10
      const horizontalPenalty = rect.left >= exportRect.left
        ? Math.abs(rect.left - exportRect.right)
        : 5000 + Math.abs(rect.left - exportRect.left)
      return sameRowPenalty + horizontalPenalty
    }

    return [...candidates].sort((a, b) => scoreOf(a) - scoreOf(b))[0] || null
  }

  function findExportOptionLabel(text, modal = getVisibleExportModal()) {
    if (!modal) return null
    const expected = compact(text)
    return [...modal.querySelectorAll('label[data-testid="beast-core-radio"]')]
      .filter(isVisible)
      .find(node => compact(textOf(node)).includes(expected)) || null
  }

  function isExportOptionChecked(optionLabel) {
    return String(optionLabel?.getAttribute?.('data-checked') || '').trim() === 'true'
  }

  function getDateInputCandidates() {
    const visibleInputs = [...document.querySelectorAll('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]')]
      .filter(isVisible)
    if (visibleInputs.length) return visibleInputs
    return [...document.querySelectorAll('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]')]
  }

  function getDateInput() {
    return getDateInputCandidates()[0] || null
  }

  function setNativeInputValue(input, value) {
    if (!input) return
    const proto = Object.getPrototypeOf(input)
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    if (descriptor?.set) descriptor.set.call(input, value)
    else input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function getRangePickerReactPropsFromInput(input) {
    const roots = [
      input,
      input?.closest('[data-testid="beast-core-rangePicker-input"]') || null,
      input?.closest('[class*="RPR_inputWrapper_"]') || null,
      input?.parentElement || null,
    ].filter(Boolean)

    for (const root of roots) {
      const fiberKey = Object.keys(root).find(key => key.startsWith('__reactFiber')) || ''
      let fiber = fiberKey ? root[fiberKey] : null
      while (fiber) {
        const props = fiber.memoizedProps || null
        if (props && typeof props.onChange === 'function' && Array.isArray(props.value) && props.value.length === 2) {
          return props
        }
        fiber = fiber.return
      }
    }
    return null
  }

  async function waitForRangePickerReactProps(timeout = 4000) {
    const deadline = Date.now() + timeout
    let fallbackInput = null
    while (Date.now() < deadline) {
      const inputs = getDateInputCandidates()
      for (const input of inputs) {
        if (!fallbackInput) fallbackInput = input
        const props = getRangePickerReactPropsFromInput(input)
        if (props) return { input, props }
      }
      await sleep(200)
    }
    return { input: fallbackInput || getDateInput(), props: null }
  }

  function readDateInputValue() {
    return String(getDateInput()?.value || '').trim()
  }

  function readRangeModelValue() {
    for (const input of getDateInputCandidates()) {
      const props = getRangePickerReactPropsFromInput(input)
      const values = Array.isArray(props?.value) ? props.value : null
      if (!values || values.length !== 2) continue
      const start = parseDateLikeValue(values[0])
      const end = parseDateLikeValue(values[1])
      if (!start || !end) continue
      return {
        start: formatDateValue(start),
        end: formatDateValue(end),
      }
    }
    return null
  }

  function hasExpectedRangeModel(startDate, endDate) {
    const model = readRangeModelValue()
    return !!(model && model.start === startDate && model.end === endDate)
  }

  async function injectDateRange(startDate, endDate) {
    const start = parseDateValue(startDate)
    const end = parseDateValue(endDate)
    if (!start || !end) return false

    const expectedRange = normalizeRangeText(formatQueryRange(startDate, endDate))
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { input, props } = await waitForRangePickerReactProps(4000)
      if (props && typeof props.onChange === 'function') {
        try {
          props.onChange([start, end])
        } catch (e) {}
      }

      let matched = await waitFor(() => {
        if (hasExpectedRangeModel(startDate, endDate)) return true
        return normalizeRangeText(readDateInputValue()) === expectedRange
      }, 4000, 200)

      if (!matched && input) {
        setNativeInputValue(input, formatQueryRange(startDate, endDate))
        matched = await waitFor(
          () => normalizeRangeText(readDateInputValue()) === expectedRange,
          2000,
          200,
        )
      }

      if (matched) {
        await sleep(600)
        if (hasExpectedRangeModel(startDate, endDate) || normalizeRangeText(readDateInputValue()) === expectedRange) {
          return true
        }
      }

      await sleep(400)
    }

    return false
  }

  function getShopName() {
    const candidates = [
      document.querySelector('[class*="account-info_mallInfo__"]'),
      document.querySelector('[class*="account-info_accountInfo__"]'),
    ].filter(Boolean)

    for (const node of candidates) {
      const text = textOf(node).replace(/\s+\d+\s*人关注.*$/, '').trim()
      if (text) return text
    }
    return 'Temu店铺'
  }

  function findRecordPropsOnNode(node) {
    if (!node) return null
    const roots = [
      node,
      node.parentElement || null,
      node.closest?.('[class*="export-history_right__"]') || null,
      node.closest?.('[class*="export-history_list__"]') || null,
    ].filter(Boolean)

    for (const root of roots) {
      const fiberKey = Object.keys(root).find(key => key.startsWith('__reactFiber')) || ''
      let fiber = fiberKey ? root[fiberKey] : null
      while (fiber) {
        const props = fiber.memoizedProps || null
        if (props && props.record) {
          return {
            record: props.record,
            taskType: props.taskType,
          }
        }
        fiber = fiber.return
      }
    }
    return null
  }

  function getHistoryEntries() {
    const drawer = getVisibleDrawer()
    if (!drawer) return []

    return [...drawer.querySelectorAll('[class*="export-history_list__"]')]
      .filter(isVisible)
      .map(row => {
        const buttons = [...row.querySelectorAll('button')]
          .filter(isVisible)
          .filter(button => /^下载/.test(textOf(button)))
          .map(button => ({
            text: textOf(button),
            enabled: !button.disabled,
            click: getCenterClick(button),
          }))
        const carrier = findRecordPropsOnNode(row.querySelector('button') || row)
        return {
          row,
          text: textOf(row),
          record: carrier?.record || null,
          taskType: carrier?.taskType,
          buttons,
        }
      })
      .filter(entry => entry.record)
  }

  function chooseTargetHistoryEntry(entries, range, exportTriggeredAt = 0) {
    const expectedStart = rangeStartMs(range.start)
    const expectedEnd = rangeEndMs(range.end)
    const matchesRange = entry => {
      const actualStart = Number(entry.record?.searchExportTimeBegin || 0)
      const actualEnd = Number(entry.record?.searchExportTimeEnd || 0)
      if (actualStart === expectedStart && actualEnd === expectedEnd) return true

      const actualStartDate = formatDateValue(new Date(actualStart))
      const actualEndDate = formatDateValue(new Date(actualEnd))
      return actualStartDate === range.start && actualEndDate === range.end
    }
    const matched = entries
      .filter(matchesRange)
      .sort((a, b) => Number(b.record?.createTime || 0) - Number(a.record?.createTime || 0))
    if (!matched.length) return null

    const findReady = list => list.find(entry => entry.buttons.some(button => button.enabled))
    const fresh = exportTriggeredAt
      ? matched.filter(entry => Number(entry.record?.createTime || 0) >= Number(exportTriggeredAt) - 120000)
      : matched

    return findReady(fresh) || findReady(matched) || fresh[0] || matched[0]
  }

  function findEntryByRecordId(recordId) {
    return getHistoryEntries().find(entry => String(entry.record?.id || '') === String(recordId || '')) || null
  }

  function buildOverseaDownloadUrl(hostname, record) {
    const paramsText = String(record?.agentSellerExportParams || '').trim()
    const sign = String(record?.agentSellerExportSign || '').trim()
    if (!paramsText || !sign) return ''
    return `https://${hostname}/labor/bill-download-with-detail?params=${encodeURIComponent(paramsText)}&sign=${encodeURIComponent(sign)}`
  }

  function buildRangeFilenameSuffix(range = billDateRange) {
    const start = String(range?.start || '').trim()
    const end = String(range?.end || '').trim()
    return start && end ? `-${start}~${end}` : ''
  }

  function buildDownloadPlans(shopName, record) {
    const rangeSuffix = buildRangeFilenameSuffix()
    return [
      {
        id: 'cn',
        label: '账务明细（卖家中心）',
        filename: `${shopName}-账务明细（卖家中心）${rangeSuffix}.xlsx`,
        strategy: 'current_click',
        downloadAction: 'direct_url',
        browserSession: true,
        buttonText: '下载账务明细(卖家中心)',
      },
      {
        id: 'global',
        label: '财务明细（全球）',
        filename: `${shopName}-财务明细（全球）${rangeSuffix}.xlsx`,
        strategy: 'capture_url',
        downloadAction: 'click_button',
        buttonText: '下载财务明细(全球)',
        captureUrl: buildOverseaDownloadUrl('agentseller.temu.com', record),
      },
      {
        id: 'eu',
        label: '财务明细（欧区）',
        filename: `${shopName}-财务明细（欧区）${rangeSuffix}.xlsx`,
        strategy: 'capture_url',
        downloadAction: 'click_button',
        buttonText: '下载财务明细(欧区)',
        captureUrl: buildOverseaDownloadUrl('agentseller-eu.temu.com', record),
      },
      {
        id: 'us',
        label: '财务明细（美国）',
        filename: `${shopName}-财务明细（美国）${rangeSuffix}.xlsx`,
        strategy: 'capture_url',
        downloadAction: 'click_button',
        buttonText: '下载财务明细(美国)',
        captureUrl: buildOverseaDownloadUrl('agentseller-us.temu.com', record),
      },
    ]
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(String(text || ''))
    } catch (e) {
      return null
    }
  }

  function extractFileUrlFromCapture(captureResult) {
    const matches = Array.isArray(captureResult?.matches) ? captureResult.matches : []
    for (const match of matches) {
      const parsed = safeJsonParse(match?.body)
      const fileUrl = String(parsed?.result?.fileUrl || '').trim()
      if (fileUrl) return fileUrl
      const responseUrl = String(match?.responseUrl || match?.url || '').trim()
      if (/\.xlsx(\?|$)/i.test(responseUrl)) return responseUrl
    }
    return ''
  }

  function explainCaptureFailure(captureResult) {
    if (!captureResult) return '未返回抓取结果'
    if (captureResult.error) return String(captureResult.error)
    const matches = Array.isArray(captureResult.matches) ? captureResult.matches : []
    if (!matches.length) return '未捕获到下载请求'
    const parsed = safeJsonParse(matches[0]?.body)
    const message = String(parsed?.errorMsg || matches[0]?.error || '').trim()
    return message || '未解析到文件下载地址'
  }

  function flattenDownloadItems(value) {
    if (!value) return []
    if (Array.isArray(value)) {
      return value.flatMap(item => (Array.isArray(item?.items) ? item.items : []))
    }
    return Array.isArray(value?.items) ? value.items : []
  }

  function buildSummaryRows(summaryShared = shared) {
    const resolvedDownloads = Array.isArray(summaryShared.resolvedDownloads) ? summaryShared.resolvedDownloads : []
    const downloadItems = [
      ...flattenDownloadItems(summaryShared.downloadResults),
      ...flattenDownloadItems(summaryShared.clickDownloadResults),
    ]
    const queryRange = summaryShared.queryDisplayRange || formatQueryRange(billDateRange.start, billDateRange.end)
    const exportTime = formatDateTime(summaryShared.targetRecord?.createTime || 0)

    return resolvedDownloads.map(item => {
      const saved = downloadItems.find(result => String(result?.label || '') === String(item?.label || '')) || null
      const status = saved
        ? (saved.success ? '已下载' : '失败')
        : (item?.status === 'ready' ? '待下载' : '失败')
      return {
        店铺名称: summaryShared.shopName || '',
        查询时间范围: queryRange,
        导出记录ID: String(summaryShared.targetRecord?.id || ''),
        导出生成时间: exportTime,
        文件标签: String(item?.label || ''),
        文件名: String(item?.filename || ''),
        状态: status,
        保存路径: saved?.success ? String(saved?.path || '') : '',
        下载地址: String(item?.fileUrl || ''),
        原因: saved?.success ? '' : String(saved?.error || item?.reason || ''),
        汇总时间: localNowText(),
      }
    })
  }

  try {
    if (!billDateRange.start || !billDateRange.end) {
      return fail('请先在 UI 中选择对账日期')
    }

    if (phase === 'main') {
      return nextPhase('ensure_target', 0)
    }

    if (phase === 'ensure_target') {
      if (!location.href.includes('/labor/bill')) {
        location.href = TARGET_URL
        return nextPhase('ensure_target', mode === 'new' ? 1800 : 1200)
      }

      const ready = await waitFor(() => {
        return !!getDateInput() && !!findMainAction('查询') && !!findMainAction('导出')
      }, 15000, 300)
      if (!ready) {
        return fail('对账中心页面未加载完成，请确认已登录并能打开页面')
      }
      return nextPhase('prepare_query', 200)
    }

    if (phase === 'prepare_query') {
      const injected = await injectDateRange(billDateRange.start, billDateRange.end)
      if (!injected) {
        return fail(`设置对账日期失败：${billDateRange.start} ~ ${billDateRange.end}`)
      }

      const queryButton = findMainAction('查询')
      if (!queryButton) return fail('未找到查询按钮')
      clickLike(queryButton)
      return nextPhase('trigger_export', 1500, {
        queryAppliedAt: Date.now(),
        queryDisplayRange: formatQueryRange(billDateRange.start, billDateRange.end),
      })
    }

    if (phase === 'trigger_export') {
      const exportButton = findMainAction('导出')
      if (!exportButton) return fail('未找到导出按钮')
      clickLike(exportButton)
      return nextPhase('confirm_export_modal', 400, {
        ...shared,
        exportTriggeredAt: Date.now(),
      })
    }

    if (phase === 'confirm_export_modal') {
      const modalAppeared = await waitFor(() => !!getVisibleExportModal(), 3000, 200)
      if (!modalAppeared) {
        return nextPhase('open_history_drawer', 1200, shared)
      }

      const optionLabel = findExportOptionLabel('导出列表 + 账务详情')
      if (!optionLabel) {
        return fail('导出弹窗中未找到“导出列表 + 账务详情”选项')
      }

      if (!isExportOptionChecked(optionLabel)) {
        clickLike(optionLabel)
        await sleep(200)
        const retriedLabel = findExportOptionLabel('导出列表 + 账务详情') || optionLabel
        if (!isExportOptionChecked(retriedLabel)) {
          clickLike(retriedLabel)
          await sleep(200)
        }
      }

      const confirmButton = findVisibleAction('确认', getVisibleExportModal())
      if (!confirmButton) {
        return fail('导出弹窗中未找到确认按钮')
      }

      clickLike(confirmButton)
      await waitFor(() => !getVisibleExportModal(), 4000, 200)
      return nextPhase('open_history_drawer', 1200, shared)
    }

    if (phase === 'open_history_drawer') {
      if (!getVisibleDrawer()) {
        const historyLink = findPageExportHistoryAction()
        if (!historyLink) return fail('未找到导出历史入口')
        clickLike(historyLink)
        return nextPhase('wait_export_record', 1000, shared)
      }
      return nextPhase('wait_export_record', 200, shared)
    }

    if (phase === 'wait_export_record') {
      const drawer = getVisibleDrawer()
      if (!drawer) return nextPhase('open_history_drawer', 800, shared)

      const attempts = Number(shared.waitRounds || 0)
      const entry = chooseTargetHistoryEntry(
        getHistoryEntries(),
        billDateRange,
        Number(shared.exportTriggeredAt || 0),
      )
      if (entry && entry.buttons.some(button => button.enabled)) {
        const shopName = shared.shopName || getShopName()
        return nextPhase('resolve_download_plan', 0, {
          ...shared,
          waitRounds: attempts,
          shopName,
          targetRecord: entry.record,
          targetRecordId: entry.record?.id || '',
          queryDisplayRange: shared.queryDisplayRange || formatQueryRange(billDateRange.start, billDateRange.end),
          downloadPlans: buildDownloadPlans(shopName, entry.record),
          planIndex: 0,
          resolvedDownloads: [],
          activePlan: null,
          captureResult: null,
        })
      }

      if (attempts >= HISTORY_WAIT_LIMIT) {
        return fail(`等待导出记录完成超时：${billDateRange.start} ~ ${billDateRange.end}`)
      }

      if (attempts > 0 && attempts % 3 === 0) {
        const refreshAction = findDrawerAction('刷新')
        if (refreshAction) clickLike(refreshAction)
      }

      return nextPhase('wait_export_record', 1500, {
        ...shared,
        waitRounds: attempts + 1,
      })
    }

    if (phase === 'resolve_download_plan') {
      const plans = Array.isArray(shared.downloadPlans) ? shared.downloadPlans : []
      const planIndex = Number(shared.planIndex || 0)
      const currentPlan = plans[planIndex]
      const resolvedDownloads = Array.isArray(shared.resolvedDownloads) ? shared.resolvedDownloads : []

      if (!currentPlan) {
        return nextPhase('download_all_files', 0, shared)
      }

      if (currentPlan.strategy === 'current_click') {
        const entry = findEntryByRecordId(shared.targetRecordId) || chooseTargetHistoryEntry(
          getHistoryEntries(),
          billDateRange,
          Number(shared.exportTriggeredAt || 0),
        )
        const button = entry?.buttons.find(item => item.text === currentPlan.buttonText && item.enabled) || null
        if (!button?.click) {
          return nextPhase('resolve_download_plan', 0, {
            ...shared,
            planIndex: planIndex + 1,
            activePlan: null,
            captureResult: null,
            resolvedDownloads: [
              ...resolvedDownloads,
              {
                ...currentPlan,
                status: 'capture_failed',
                reason: '未找到可点击的卖家中心下载按钮',
              },
            ],
          })
        }

        return captureClickRequests(
          [button.click],
          'handle_captured_plan',
          {
            matches: [{ url_contains: '/api/merchant/file/export/download', method: 'POST' }],
            shared_key: 'captureResult',
            timeout_ms: 8000,
            settle_ms: 800,
            min_matches: 1,
          },
          {
            ...shared,
            activePlan: currentPlan,
            captureResult: null,
          },
        )
      }

      const captureUrl = String(currentPlan.captureUrl || '').trim()
      if (!captureUrl) {
        return nextPhase('resolve_download_plan', 0, {
          ...shared,
          planIndex: planIndex + 1,
          activePlan: null,
          captureResult: null,
          resolvedDownloads: [
            ...resolvedDownloads,
            {
              ...currentPlan,
              status: 'capture_failed',
              reason: '导出记录缺少海外账单签名参数',
            },
          ],
        })
      }

      return captureUrlRequests(
        captureUrl,
        'handle_captured_plan',
        {
          matches: [{ url_contains: '/api/merchant/file/export/download', method: 'POST' }],
          shared_key: 'captureResult',
          timeout_ms: 15000,
          settle_ms: 1000,
          min_matches: 1,
        },
        {
          ...shared,
          activePlan: currentPlan,
          captureResult: null,
        },
      )
    }

    if (phase === 'handle_captured_plan') {
      const currentPlan = shared.activePlan || null
      const resolvedDownloads = Array.isArray(shared.resolvedDownloads) ? shared.resolvedDownloads : []
      const planIndex = Number(shared.planIndex || 0)
      if (!currentPlan) {
        return nextPhase('resolve_download_plan', 0, {
          ...shared,
          planIndex: planIndex + 1,
        })
      }

      const fileUrl = extractFileUrlFromCapture(shared.captureResult)
      const captureReason = explainCaptureFailure(shared.captureResult)
      const nextResolved = fileUrl
        ? [...resolvedDownloads, { ...currentPlan, status: 'ready', fileUrl }]
        : currentPlan.downloadAction === 'click_button'
          ? [...resolvedDownloads, {
              ...currentPlan,
              status: 'ready',
              fileUrl: '',
              reason: captureReason,
            }]
          : [...resolvedDownloads, {
              ...currentPlan,
              status: 'capture_failed',
              reason: captureReason,
            }]

      return nextPhase('resolve_download_plan', 0, {
        ...shared,
        planIndex: planIndex + 1,
        activePlan: null,
        captureResult: null,
        resolvedDownloads: nextResolved,
      })
    }

    if (phase === 'download_all_files') {
      const resolvedDownloads = Array.isArray(shared.resolvedDownloads) ? shared.resolvedDownloads : []
      const items = resolvedDownloads
        .filter(item => item.status === 'ready' && item.downloadAction === 'direct_url' && String(item.fileUrl || '').trim())
        .map(item => ({
          url: item.fileUrl,
          filename: item.filename,
          label: item.label,
          browser_session: !!item.browserSession,
        }))

      if (!items.length) {
        return nextPhase('download_click_plan', 0, {
          ...shared,
          clickDownloadIndex: 0,
        })
      }

      return downloadUrls(
        items,
        'download_click_plan',
        {
          shared_key: 'downloadResults',
        },
        {
          ...shared,
          clickDownloadIndex: 0,
        },
      )
    }

    if (phase === 'download_click_plan') {
      const resolvedDownloads = Array.isArray(shared.resolvedDownloads) ? shared.resolvedDownloads : []
      const clickPlans = resolvedDownloads
        .filter(item => item.status === 'ready' && item.downloadAction === 'click_button')
      const clickDownloadIndex = Number(shared.clickDownloadIndex || 0)
      const currentPlan = clickPlans[clickDownloadIndex]

      if (!currentPlan) {
        return complete(buildSummaryRows(shared), false, shared)
      }

      const entry = findEntryByRecordId(shared.targetRecordId) || chooseTargetHistoryEntry(
        getHistoryEntries(),
        billDateRange,
        Number(shared.exportTriggeredAt || 0),
      )
      const button = entry?.buttons.find(candidate => candidate.text === currentPlan.buttonText && candidate.enabled) || null

      return downloadClicks(
        [{
          clicks: button?.click ? [button.click] : [],
          filename: currentPlan.filename,
          label: currentPlan.label,
          expected_url: currentPlan.fileUrl,
          timeout_ms: 60000,
        }],
        'download_click_plan',
        {
          shared_key: 'clickDownloadResults',
          shared_append: true,
        },
        {
          ...shared,
          clickDownloadIndex: clickDownloadIndex + 1,
        },
      )
    }

    if (phase === 'complete_summary') {
      return complete(buildSummaryRows(shared), false, shared)
    }

    return fail(`未知阶段: ${phase}`)
  } catch (error) {
    return fail(String(error?.message || error))
  }
})()
