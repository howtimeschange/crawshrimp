;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const API_BASE = 'https://ai-platform-api.semir.com'

  function cleanText(value) {
    return String(value == null ? '' : value).trim()
  }

  function cleanWorksheetText(value) {
    return cleanText(value).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
  }

  function sanitizeWorksheetRow(row) {
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [
      key,
      typeof value === 'string' || value == null ? cleanWorksheetText(value) : value,
    ]))
  }

  function basename(value) {
    const text = cleanText(value).split(/[?#]/)[0].replace(/\\/g, '/')
    return text.split('/').filter(Boolean).pop() || text || ''
  }

  function splitMultiValues(value) {
    if (Array.isArray(value)) return value.map(cleanText).filter(Boolean)
    return cleanText(value).split(/\r?\n|[；;,，|]+/g).map(cleanText).filter(Boolean)
  }

  function toNumberOrNull(value) {
    const text = cleanText(value).replace(/,/g, '')
    if (!text) return null
    const matched = text.match(/-?\d+(?:\.\d+)?/)
    if (!matched) return null
    const number = Number(matched[0])
    return Number.isFinite(number) ? number : null
  }

  function parseCaseIds(value) {
    const ids = []
    for (const item of splitMultiValues(value)) {
      const queryMatch = item.match(/[?&]id=(\d{8,})\b/)
      const plainMatch = item.match(/\b\d{8,}\b/)
      const id = queryMatch?.[1] || plainMatch?.[0] || ''
      if (id && !ids.includes(id)) ids.push(id)
    }
    return ids
  }

  function extractList(raw) {
    const candidates = [
      raw,
      raw?.list,
      raw?.records,
      raw?.rows,
      raw?.items,
      raw?.data,
      raw?.data?.list,
      raw?.data?.records,
      raw?.data?.rows,
      raw?.data?.items,
    ]
    const list = candidates.find(Array.isArray)
    return Array.isArray(list) ? list : []
  }

  function extractTotal(raw) {
    const candidates = [
      raw?.total,
      raw?.totalCount,
      raw?.count,
      raw?.totalRecords,
      raw?.pagination?.total,
      raw?.page?.total,
      raw?.data?.total,
      raw?.data?.totalCount,
    ]
    const value = candidates.find(item => Number.isFinite(Number(item)))
    return value == null ? null : Number(value)
  }

  function readCaseIdFromListItem(item) {
    const candidates = [
      item?.id,
      item?.caseId,
      item?.caseInfo?.id,
      item?.caseInfo?.caseId,
      item?.digitalEmployeeCaseId,
    ]
    for (const candidate of candidates) {
      const id = parseCaseIds(candidate)[0]
      if (id) return id
    }
    return ''
  }

  function buildEditPageUrl(caseId) {
    return caseId ? `https://ai.semir.com/console/studio/showcase/create/?id=${caseId}` : ''
  }

  function getAccessToken() {
    try {
      if (typeof localStorage === 'undefined') return ''
      return JSON.parse(localStorage.getItem('authStorage') || '{}')?.state?.authData?.oauth2Token?.access_token || ''
    } catch (error) {
      return ''
    }
  }

  function buildApiUrl(path, queryParams = {}) {
    const url = `${API_BASE}${path}`
    const query = new URLSearchParams()
    Object.entries(queryParams || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
    })
    const qs = query.toString()
    return qs ? `${url}?${qs}` : url
  }

  function unwrapApiPayload(payload) {
    if (payload && typeof payload === 'object' && ('code' in payload || 'data' in payload || 'msg' in payload)) {
      if (Number(payload.code) === 200) return payload.data
      if (!('code' in payload) && 'data' in payload) return payload.data
      throw new Error(cleanText(payload.msg || payload.message || '接口返回失败'))
    }
    return payload
  }

  async function request(path, options = {}) {
    const method = String(options.method || (options.body ? 'POST' : 'GET')).toUpperCase()
    const headers = { ...(options.headers || {}) }
    const token = getAccessToken()
    if (token) headers.satoken = token
    let body
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(options.body)
    }
    const response = await fetch(buildApiUrl(path, options.params), {
      method,
      headers,
      body,
      credentials: 'include',
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 240) || response.statusText}`)
    }
    return unwrapApiPayload(await response.json())
  }

  async function fetchCaseInfo(caseId) {
    const data = await request('/portal/digital/employee/v2/case/info', {
      method: 'GET',
      params: { id: caseId },
    })
    if (!data || typeof data !== 'object') throw new Error(`案例详情为空：${caseId}`)
    return data
  }

  async function fetchListCaseIds({ pageSize = 100, keyword = '' } = {}) {
    const ids = []
    const seen = new Set()
    const safePageSize = Math.min(200, Math.max(1, Number(pageSize || 100)))
    const cleanKeyword = cleanText(keyword)

    for (let page = 1; page <= 200; page += 1) {
      const data = await request('/portal/digital/employee/v2/case/page', {
        method: 'GET',
        params: {
          currentPage: page,
          pageSize: safePageSize,
          name: cleanKeyword || undefined,
        },
      })
      const list = extractList(data)
      for (const item of list) {
        const id = readCaseIdFromListItem(item)
        if (id && !seen.has(id)) {
          seen.add(id)
          ids.push(id)
        }
      }

      const total = extractTotal(data)
      const explicitLastPage = data?.lastPage === true || data?.isLastPage === true || data?.hasNext === false || data?.hasNextPage === false
      if (explicitLastPage) break
      if (total != null && ids.length >= total) break
      if (list.length < safePageSize) break
    }

    return ids
  }

  function normalizeUploadedList(rawValue) {
    if (!rawValue) return []
    const values = Array.isArray(rawValue) ? rawValue : splitMultiValues(rawValue)
    return values
      .map(item => {
        if (typeof item === 'string') {
          const url = cleanText(item)
          return url ? { name: basename(url), url } : null
        }
        const url = cleanText(item?.url || item?.path || item?.fileUrl)
        const name = cleanText(item?.name || item?.originalName || basename(url))
        return url ? { name: name || basename(url), url } : null
      })
      .filter(Boolean)
  }

  function uploadedListToCell(rawValue) {
    return normalizeUploadedList(rawValue).map(item => item.url).filter(Boolean).join('|')
  }

  function valueTypesFromDetail(detail) {
    const values = []
    const efficiency = detail?.efficiency || {}
    const increase = detail?.increase || {}
    const cost = detail?.cost || {}
    const other = detail?.other || {}
    if (toNumberOrNull(efficiency.originalTime) > 0 || (cleanText(efficiency.currentTime) !== '' && toNumberOrNull(efficiency.currentTime) >= 0)) values.push('提效')
    if (toNumberOrNull(increase.value) > 0) values.push('增收')
    if (toNumberOrNull(cost.value) > 0) values.push('降本')
    if (cleanText(other.value)) values.push('其他')
    return values
  }

  function detailToEditableRow(detail, rowNo, caseId = '') {
    const id = cleanText(caseId || detail?.id || detail?.caseId)
    const developers = Array.isArray(detail?.developers)
      ? detail.developers.map(item => cleanText(item?.userId || item?.id || item?.name || item?.userName)).filter(Boolean)
      : splitMultiValues(detail?.developerIds || '')
    const skills = Array.isArray(detail?.skills)
      ? detail.skills.map(item => cleanText(item?.id || item?.skillId || item?.name)).filter(Boolean)
      : splitMultiValues(detail?.skillIds || '')
    const positions = Array.isArray(detail?.casePosition)
      ? detail.casePosition.map(item => cleanText(item?.name || item?.positionName || item)).filter(Boolean)
      : splitMultiValues(detail?.positionNames || '')
    const indicators = Array.isArray(detail?.indicator) ? detail.indicator : []
    const comparisons = Array.isArray(detail?.diff) ? detail.diff : []
    const row = {
      表格行号: rowNo,
      案例ID: id,
      编辑页链接: buildEditPageUrl(id),
      案例名称: cleanText(detail?.name),
      封面图路径: cleanText(detail?.icon),
      案例类型: cleanText(detail?.categoryCode || detail?.categoryName),
      使用链接: cleanText(detail?.useLink),
      下载链接: cleanText(detail?.downloadLink),
      所属AI纵队: cleanText(detail?.aiTeam),
      所属部门: cleanText(detail?.dingDeptId || detail?.departmentName || detail?.deptName),
      案例描述: cleanText(detail?.description),
      案例说明: cleanText(detail?.useDescription),
      案例开发者: developers.join('|'),
      涉及技能: skills.join('|'),
      可复用岗位: positions.join('|'),
      使用频次: detail?.frequency ?? '',
      价值分类: valueTypesFromDetail(detail).join('|'),
      原工时: detail?.efficiency?.originalTime ?? '',
      现工时: detail?.efficiency?.currentTime ?? '',
      增收金额: detail?.increase?.value ?? '',
      降低成本: detail?.cost?.value ?? '',
      其他介绍: cleanText(detail?.other?.value),
      亮点1描述: cleanText(indicators[0]?.description),
      亮点1指标: cleanText(indicators[0]?.value),
      亮点2描述: cleanText(indicators[1]?.description),
      亮点2指标: cleanText(indicators[1]?.value),
      亮点3描述: cleanText(indicators[2]?.description),
      亮点3指标: cleanText(indicators[2]?.value),
      对比1之前: cleanText(comparisons[0]?.before),
      对比1之后: cleanText(comparisons[0]?.after),
      对比2之前: cleanText(comparisons[1]?.before),
      对比2之后: cleanText(comparisons[1]?.after),
      操作文档路径: uploadedListToCell(detail?.document),
      视频路径: uploadedListToCell(detail?.video),
      钉钉联系人: cleanText(detail?.dingtalkLink),
      导出结果: '成功',
      备注: '空白单元格导回时表示保持原值；需要清空选填字段请填写 __清空__',
    }
    return sanitizeWorksheetRow(row)
  }

  function complete(data = []) {
    return {
      success: true,
      data,
      meta: {
        action: 'complete',
        has_more: false,
        total_rows: data.length,
        current_exec_no: data.length,
        current_store: '大森运营助手 · 案例编辑模板导出',
      },
    }
  }

  function fail(message) {
    return { success: false, error: String(message || '导出案例编辑模板失败') }
  }

  try {
    const scope = cleanText(params.export_scope || 'all_published') || 'all_published'
    const ids = scope === 'selected_ids'
      ? parseCaseIds(params.case_ids || '')
      : await fetchListCaseIds({
          pageSize: params.page_size || 100,
          keyword: params.keyword || '',
        })
    if (!ids.length) {
      throw new Error(scope === 'selected_ids'
        ? '请填写至少 1 个案例ID或编辑页链接'
        : '未从已发布案例列表读取到案例，请确认当前账号有案例库权限或缩小关键词后重试')
    }
    const rows = []
    for (const [index, caseId] of ids.entries()) {
      try {
        const detail = await fetchCaseInfo(caseId)
        rows.push(detailToEditableRow(detail, index + 2, caseId))
      } catch (error) {
        rows.push(sanitizeWorksheetRow({
          表格行号: index + 2,
          案例ID: caseId,
          编辑页链接: buildEditPageUrl(caseId),
          导出结果: '失败',
          备注: error?.message || String(error),
        }))
      }
    }
    return complete(rows)
  } catch (error) {
    return fail(error?.message || error)
  }
})()
