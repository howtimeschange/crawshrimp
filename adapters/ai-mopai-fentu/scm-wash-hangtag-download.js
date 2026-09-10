;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const runtimePhase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const phase = runtimePhase === 'main' ? 'init' : runtimePhase
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const testExports = window.__CRAWSHRIMP_EXPORTS__ || null

  const SCM_ENTRY_URL = 'https://scm.semir.com/scm-quality-mgm/index/scm-qc-wash-appr-index'
  const QUERY_DELAY_MS = 800
  const EMPTY_SETTLE_MS = 2500
  const MAX_READ_ATTEMPTS = 24
  const DOWNLOAD_RETRY_ATTEMPTS = 3
  const DOWNLOAD_RETRY_DELAY_MS = 1000
  const LOGIN_WAIT_MS = 10 * 60 * 1000

  function compact(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim()
  }

  function compactCode(value) {
    let text = compact(value)
      .replace(/^款号[:：]?/i, '')
      .replace(/^style(?:\s*code)?[:：]?/i, '')
      .trim()
    if (/^\d+\.0+$/.test(text)) text = text.replace(/\.0+$/, '')
    return text
  }

  function normalizeStyleCodes(rawValue) {
    const text = String(rawValue || '').replace(/[，、；;, \t]+/g, '\n')
    const seen = new Set()
    const result = []
    for (const line of text.split(/\r?\n/)) {
      const cleaned = compact(line)
      if (!cleaned) continue
      const matches = cleaned.match(/[A-Za-z0-9][A-Za-z0-9_-]{5,}(?:\.0+)?/g) || [cleaned]
      for (const match of matches) {
        const code = compactCode(match)
        if (!code || seen.has(code)) continue
        seen.add(code)
        result.push(code)
      }
    }
    return result
  }

  function textOf(value) {
    if (typeof value === 'string' || typeof value === 'number') return compact(value)
    return compact(value?.innerText || value?.textContent || '')
  }

  function visible(element) {
    if (!element || !element.getClientRects?.().length) return false
    const rect = element.getBoundingClientRect?.()
    if (!rect || !rect.width || !rect.height) return false
    const style = getComputedStyle(element)
    return style.display !== 'none' && style.visibility !== 'hidden'
  }

  function isScmLoggedIn() {
    const href = String(location.href || '')
    const text = compact(document.body?.innerText || '')
    const onLoginPage = /\/login(?:[/?#]|$)|passport|auth/i.test(href)
      || /统一认证中心|请输入用户名|请输入密码|手机验证码/.test(text.slice(0, 2500))
    const hasScmSurface = /SUPPLY FORCE|洗唛批复判定|成品大货协同|质量协同|供应链控制塔|工作台/.test(text)
      || !!document.querySelector('#q-app, .q-layout, .q-table__container')
    return !onLoginPage && hasScmSurface
  }

  function setInputValue(input, value) {
    if (!input) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (setter) setter.call(input, value)
    else input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return compact(input.value) === compact(value)
  }

  function findStyleInput() {
    const fields = [...document.querySelectorAll('label.q-field, .q-field')]
      .filter(visible)
      .filter(field => /^款号(?:\s|$)/.test(textOf(field)))
    for (const field of fields) {
      const input = field.querySelector('input.q-field__native, input:not([type="checkbox"])')
      if (input && input.type !== 'checkbox') return input
    }
    return [...document.querySelectorAll('input')]
      .filter(input => input.type !== 'checkbox' && visible(input))
      .find(input => {
        let node = input.parentElement
        for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
          if (/^款号(?:\s|$)/.test(textOf(node))) return true
        }
        return false
      }) || null
  }

  function findSearchButton() {
    return [...document.querySelectorAll('button')]
      .filter(visible)
      .find(button => /搜索/.test(textOf(button)) && !button.disabled) || null
  }

  function clickPoint(element) {
    const rect = element?.getBoundingClientRect?.()
    if (!rect || !rect.width || !rect.height) return null
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    }
  }

  function qtableVm() {
    const candidates = [...document.querySelectorAll('.q-table__container')]
      .map(element => element.__vue__)
      .filter(vm => vm && Array.isArray(vm.$props?.data) && Array.isArray(vm.$props?.columns))
    return candidates.find(vm => {
      const labels = (vm.$props.columns || []).map(column => compact(column?.label || column?.name)).join(' ')
      return labels.includes('款号') && labels.includes('洗唛文件') && labels.includes('吊牌文件')
    }) || candidates[0] || null
  }

  function normalizeScmRecord(row, styleCode) {
    return {
      styleCode: compactCode(row?.P_MAT_CODE || styleCode),
      skc: compact(row?.SKC_CODE || row?.SKC_ID),
      colorCode: compact(row?.F1),
      colorName: compact(row?.F1_DISPLAY),
      washUrl: compact(row?.SKC_FILE_URL1),
      hangtagUrl: compact(row?.SKC_FILE_URL2),
    }
  }

  function tableRead(styleCode) {
    const vm = qtableVm()
    if (!vm) {
      return { loading: false, stale: true, rows: [], rowsNumber: 0, reason: '未找到 SCM 洗唛批复判定表格组件' }
    }
    const data = Array.isArray(vm.$props?.data) ? vm.$props.data : []
    const rowsNumber = Number(vm.$props?.pagination?.rowsNumber || data.length || 0)
    const loading = !!vm.$props?.loading
    const wanted = compactCode(styleCode)
    const rows = data
      .filter(row => compactCode(row?.P_MAT_CODE) === wanted || compact(row?.SKC_CODE).startsWith(wanted))
      .map(row => normalizeScmRecord(row, wanted))
    const hasOtherStyle = data.some(row => {
      const code = compactCode(row?.P_MAT_CODE)
      return code && code !== wanted
    })
    const stale = loading || (rows.length === 0 && rowsNumber > 0 && hasOtherStyle)
    return {
      loading,
      stale,
      rows,
      rowsNumber,
      reason: stale ? '表格仍在刷新或仍显示上一款号' : '',
    }
  }

  function safeCode(value) {
    return compactCode(value).replace(/[\\/:*?"<>|]+/g, '_') || '未知款号'
  }

  function encodeUrlForDownload(rawUrl) {
    const value = compact(rawUrl)
    if (!value) return ''
    try {
      const parsed = new URL(value, location.href)
      parsed.pathname = parsed.pathname
        .split('/')
        .map(part => {
          if (!part) return part
          try { return encodeURIComponent(decodeURIComponent(part)) } catch (error) { return encodeURIComponent(part) }
        })
        .join('/')
      return parsed.toString()
    } catch (error) {
      return value.replace(/[^\x00-\x7F]/g, char => encodeURIComponent(char))
    }
  }

  function sourceUrlState(rawUrl, kind) {
    const value = compact(rawUrl)
    if (!value) return { state: 'missing', url: '', extension: '', reason: '无对应文件' }
    try {
      const parsed = new URL(value, location.href)
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('不是 HTTP(S) 链接')
      const pathname = parsed.pathname.toLowerCase()
      const extensionOk = /\.(?:jpe?g|png|pdf)$/.test(pathname)
      if (!extensionOk) throw new Error('链接不是 JPG/JPEG/PNG/PDF 文件')
      return {
        state: 'ready',
        url: encodeUrlForDownload(parsed.toString()),
        extension: /\.pdf$/.test(pathname) ? 'pdf' : (/\.png$/.test(pathname) ? 'png' : 'jpg'),
        reason: '',
      }
    } catch (error) {
      return { state: 'invalid', url: '', extension: '', reason: compact(error?.message || error || '文件链接无效') }
    }
  }

  function recordHasUsableFile(record) {
    if (!record) return false
    return sourceUrlState(record.washUrl, 'wash').state === 'ready'
      || sourceUrlState(record.hangtagUrl, 'hangtag').state === 'ready'
  }

  function selectFirstFileGroup(records) {
    const list = Array.isArray(records) ? records : []
    return list.find(recordHasUsableFile) || list[0] || null
  }

  function buildFilePlan(styleCode, record, options = {}) {
    const code = safeCode(styleCode)
    const readError = compact(options.readError)
    const missingRecord = !record
    const washSource = readError
      ? { state: 'read_error', url: '', reason: readError }
      : sourceUrlState(record?.washUrl, 'wash')
    const hangtagSource = readError
      ? { state: 'read_error', url: '', reason: readError }
      : sourceUrlState(record?.hangtagUrl, 'hangtag')
    const files = {
      wash: {
        kind: 'wash',
        label: '洗唛',
        filename: `${code} 洗唛.${washSource.extension || 'jpg'}`,
        targetDir: compact(params.wash_output_dir || shared.wash_output_dir),
        ...washSource,
      },
      hangtag: {
        kind: 'hangtag',
        label: '电子吊牌',
        filename: `${code} 电子吊牌.${hangtagSource.extension || 'pdf'}`,
        targetDir: compact(params.hangtag_output_dir || shared.hangtag_output_dir),
        ...hangtagSource,
      },
    }
    const items = []
    const itemKinds = []
    for (const file of [files.wash, files.hangtag]) {
      if (file.state !== 'ready') continue
      const isPdf = file.extension === 'pdf'
      items.push({
        url: file.url,
        filename: file.filename,
        label: `${styleCode} / ${file.label}`,
        target_dir: file.targetDir,
        headers: { Referer: SCM_ENTRY_URL },
        min_bytes: 100,
        ...(isPdf ? { expected_magic: '%PDF-', validate_signature: true } : {}),
        retry_attempts: DOWNLOAD_RETRY_ATTEMPTS,
        retry_delay_ms: DOWNLOAD_RETRY_DELAY_MS,
        timeout_seconds: 120,
      })
      itemKinds.push(file.kind)
    }
    return {
      styleCode: compactCode(styleCode),
      selectedRecord: record ? {
        skc: record.skc,
        colorCode: record.colorCode,
        colorName: record.colorName,
      } : null,
      missingRecord,
      readError,
      files,
      items,
      itemKinds,
    }
  }

  function finalizeFile(file, kind, plan, downloadResult) {
    if (file.state === 'missing') {
      return { status: '无对应文件', filename: '', path: '', remark: `${file.label}：无对应文件` }
    }
    if (file.state === 'invalid') {
      return { status: '下载失败', filename: '', path: '', remark: `${file.label}：下载失败（${file.reason}）` }
    }
    if (file.state === 'read_error') {
      return { status: '下载失败', filename: '', path: '', remark: `${file.label}：下载失败（页面读取失败：${file.reason}）` }
    }
    const position = (plan.itemKinds || []).indexOf(kind)
    const result = Array.isArray(downloadResult?.items) && position >= 0 ? (downloadResult.items[position] || {}) : {}
    if (result.success) {
      return {
        status: '下载成功',
        filename: compact(result.filename || file.filename),
        path: compact(result.path),
        remark: '',
      }
    }
    return {
      status: '下载失败',
      filename: file.filename,
      path: '',
      remark: `${file.label}：下载失败（${compact(result.error || '下载未返回成功结果')}）`,
    }
  }

  function finalizeResultRow(plan, downloadResult) {
    const wash = finalizeFile(plan.files.wash, 'wash', plan, downloadResult)
    const hangtag = finalizeFile(plan.files.hangtag, 'hangtag', plan, downloadResult)
    const record = plan.selectedRecord || {}
    let remarks = [wash.remark, hangtag.remark].filter(Boolean)
    if (plan.missingRecord && !plan.readError) {
      remarks = ['未找到款号记录，洗唛和电子吊牌均无对应文件']
    }
    return {
      款号: plan.styleCode,
      采用记录: compact(record.skc || [record.colorCode, record.colorName].filter(Boolean).join(' ')),
      洗唛状态: wash.status,
      洗唛文件名: wash.filename,
      洗唛保存路径: wash.path,
      电子吊牌状态: hangtag.status,
      电子吊牌文件名: hangtag.filename,
      电子吊牌保存路径: hangtag.path,
      备注: remarks.join('；'),
      处理时间: new Date().toLocaleString('zh-CN', { hour12: false }),
    }
  }

  function buildRunShared(styleCodes, overrides = {}) {
    return {
      target_style_codes: styleCodes,
      wash_output_dir: compact(overrides.wash_output_dir ?? shared.wash_output_dir ?? params.wash_output_dir),
      hangtag_output_dir: compact(overrides.hangtag_output_dir ?? shared.hangtag_output_dir ?? params.hangtag_output_dir),
      current_index: Number(overrides.current_index ?? shared.current_index ?? 0),
      total_rows: styleCodes.length,
      current_exec_no: Number(overrides.current_exec_no ?? shared.current_exec_no ?? 1),
      current_row_no: Number(overrides.current_row_no ?? shared.current_row_no ?? 1),
      current_buyer_id: String(overrides.current_buyer_id ?? shared.current_buyer_id ?? styleCodes[0] ?? ''),
      current_store: 'SCM 洗唛批复判定',
      completed_count: Number(overrides.completed_count ?? shared.completed_count ?? 0),
      success_count: Number(overrides.success_count ?? shared.success_count ?? 0),
      failed_count: Number(overrides.failed_count ?? shared.failed_count ?? 0),
      ...overrides,
    }
  }

  function nextPhase(name, sleepMs = 0, nextShared = shared, data = []) {
    return {
      success: true,
      data,
      meta: { action: 'next_phase', next_phase: name, sleep_ms: sleepMs, shared: nextShared },
    }
  }

  function cdpClick(point, name, sleepMs, nextShared = shared) {
    return {
      success: true,
      data: [],
      meta: { action: 'cdp_clicks', clicks: [point], next_phase: name, sleep_ms: sleepMs, shared: nextShared },
    }
  }

  function downloadUrls(plan, nextShared) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'download_urls',
        items: plan.items,
        shared_key: 'current_download_result',
        strict: false,
        concurrency: 2,
        retry_attempts: DOWNLOAD_RETRY_ATTEMPTS,
        retry_delay_ms: DOWNLOAD_RETRY_DELAY_MS,
        recovery_retry_attempts: 1,
        recovery_retry_delay_ms: 1500,
        recovery_concurrency: 1,
        timeout_seconds: 120,
        next_phase: 'finish_current',
        sleep_ms: 0,
        shared: nextShared,
      },
    }
  }

  function complete(data = [], nextShared = shared) {
    return {
      success: true,
      data,
      meta: { action: 'complete', has_more: false, shared: nextShared },
    }
  }

  function fail(message) {
    return { success: false, error: compact(message || 'SCM 洗唛电子吊牌下载失败') }
  }

  function exposeHelpers() {
    if (!testExports || typeof testExports !== 'object') return
    Object.assign(testExports, {
      normalizeStyleCodes,
      normalizeScmRecord,
      sourceUrlState,
      recordHasUsableFile,
      selectFirstFileGroup,
      buildFilePlan,
      finalizeResultRow,
      tableRead,
      buildRunShared,
      isScmLoggedIn,
    })
  }

  exposeHelpers()
  if (phase === '__exports__') return complete([], shared)

  try {
    if (!/(^|\.)scm\.semir\.com$/i.test(location.hostname || '')) {
      return fail(`当前页面不是 SCM 后台：${String(location.href || '')}`)
    }

    if (phase === 'init') {
      const styleCodes = normalizeStyleCodes(params.style_codes)
      if (!styleCodes.length) throw new Error('请至少输入一个款号')
      if (!compact(params.wash_output_dir)) throw new Error('请选择洗唛保存文件夹')
      if (!compact(params.hangtag_output_dir)) throw new Error('请选择电子吊牌保存文件夹')
      const nextShared = buildRunShared(styleCodes, {
        current_index: 0,
        current_exec_no: 1,
        current_row_no: 1,
        current_buyer_id: styleCodes[0],
        wash_output_dir: compact(params.wash_output_dir),
        hangtag_output_dir: compact(params.hangtag_output_dir),
        login_deadline: Date.now() + LOGIN_WAIT_MS,
      })
      return nextPhase(isScmLoggedIn() ? 'ensure_page' : 'wait_login', isScmLoggedIn() ? 0 : 1000, nextShared)
    }

    if (phase === 'wait_login') {
      const styleCodes = normalizeStyleCodes(shared.target_style_codes || params.style_codes)
      if (isScmLoggedIn()) return nextPhase('ensure_page', 0, buildRunShared(styleCodes, shared))
      if (Date.now() >= Number(shared.login_deadline || 0)) {
        return fail('等待 SCM 登录超时，请在抓虾专用浏览器完成登录后重新运行')
      }
      return nextPhase('wait_login', 1000, buildRunShared(styleCodes, shared))
    }

    if (phase === 'ensure_page') {
      const styleCodes = normalizeStyleCodes(shared.target_style_codes || params.style_codes)
      if (!isScmLoggedIn()) return nextPhase('wait_login', 1000, buildRunShared(styleCodes, shared))
      if (!/\/scm-quality-mgm\/index\/scm-qc-wash-appr-index/i.test(location.pathname || '')) {
        location.assign(SCM_ENTRY_URL)
        return nextPhase('search_style', 1500, buildRunShared(styleCodes, shared))
      }
      return nextPhase('search_style', 0, buildRunShared(styleCodes, shared))
    }

    if (phase === 'search_style') {
      const styleCodes = normalizeStyleCodes(shared.target_style_codes || params.style_codes)
      if (!isScmLoggedIn()) return nextPhase('wait_login', 1000, buildRunShared(styleCodes, shared))
      const index = Number(shared.current_index || 0)
      if (index >= styleCodes.length) return complete([], buildRunShared(styleCodes, { ...shared, current_buyer_id: '' }))
      const styleCode = styleCodes[index]
      const input = findStyleInput()
      if (!input) throw new Error('未找到 SCM 页面上的“款号”筛选框')
      if (!setInputValue(input, styleCode)) throw new Error(`款号输入失败：${styleCode}`)
      const button = findSearchButton()
      if (!button) throw new Error('未找到 SCM 页面上的“搜索”按钮')
      const point = clickPoint(button)
      if (!point) throw new Error('无法定位 SCM 页面上的“搜索”按钮')
      const nextShared = buildRunShared(styleCodes, {
        ...shared,
        current_style_code: styleCode,
        current_exec_no: index + 1,
        current_row_no: index + 1,
        current_buyer_id: styleCode,
        search_started_at: Date.now(),
        read_attempts: 0,
        current_plan: null,
        current_download_result: null,
      })
      return cdpClick(point, 'read_style', QUERY_DELAY_MS, nextShared)
    }

    if (phase === 'read_style') {
      const styleCodes = normalizeStyleCodes(shared.target_style_codes || params.style_codes)
      const index = Number(shared.current_index || 0)
      const styleCode = compactCode(shared.current_style_code || styleCodes[index])
      const read = tableRead(styleCode)
      const attempts = Number(shared.read_attempts || 0)
      const elapsed = Date.now() - Number(shared.search_started_at || Date.now())
      const waitingForEmptyResult = !read.stale && !read.rows.length && elapsed < EMPTY_SETTLE_MS
      if ((read.stale || waitingForEmptyResult) && attempts < MAX_READ_ATTEMPTS) {
        return nextPhase('read_style', 500, buildRunShared(styleCodes, {
          ...shared,
          read_attempts: attempts + 1,
          last_read_reason: read.reason || (waitingForEmptyResult ? '等待空结果稳定' : ''),
        }))
      }

      const readError = read.stale ? (read.reason || 'SCM 表格读取超时') : ''
      const record = readError ? null : selectFirstFileGroup(read.rows)
      const plan = buildFilePlan(styleCode, record, { readError })
      const nextShared = buildRunShared(styleCodes, {
        ...shared,
        current_plan: plan,
        read_attempts: attempts,
      })
      if (!plan.items.length) return nextPhase('finish_current', 0, nextShared)
      return downloadUrls(plan, nextShared)
    }

    if (phase === 'finish_current') {
      const styleCodes = normalizeStyleCodes(shared.target_style_codes || params.style_codes)
      const index = Number(shared.current_index || 0)
      const plan = shared.current_plan || buildFilePlan(shared.current_style_code || styleCodes[index], null)
      const row = finalizeResultRow(plan, shared.current_download_result)
      const nextIndex = index + 1
      const done = nextIndex >= styleCodes.length
      const allSuccess = row.洗唛状态 === '下载成功' && row.电子吊牌状态 === '下载成功'
      const nextShared = buildRunShared(styleCodes, {
        ...shared,
        current_index: nextIndex,
        completed_count: nextIndex,
        success_count: Number(shared.success_count || 0) + (allSuccess ? 1 : 0),
        failed_count: Number(shared.failed_count || 0) + (allSuccess ? 0 : 1),
        current_exec_no: done ? styleCodes.length : nextIndex + 1,
        current_row_no: done ? styleCodes.length : nextIndex + 1,
        current_buyer_id: done ? '' : styleCodes[nextIndex],
        last_style_code: plan.styleCode,
        last_result: allSuccess ? '下载成功' : '部分或全部未下载',
        current_plan: null,
        current_download_result: null,
      })
      if (done) return complete([row], nextShared)
      return nextPhase('search_style', 0, nextShared, [row])
    }

    return fail(`未知 phase: ${phase}`)
  } catch (error) {
    return fail(error?.message || error)
  }
})()
