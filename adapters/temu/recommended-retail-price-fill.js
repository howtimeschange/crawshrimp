;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'

  const TARGET_URL = 'https://agentseller.temu.com/goods/recommended-retail-price'
  const TEMPLATE_COLUMNS = ['ID类型', 'ID值', '站点', '建议零售价最小值', '建议零售价最大值', '备注']

  function textOf(el) {
    return String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim()
  }

  function isVisible(el) {
    if (!el || typeof el.getClientRects !== 'function') return false
    return el.getClientRects().length > 0
  }

  function parseExcelRows(paramId) {
    const value = params[paramId]
    const raw = Array.isArray(value)
      ? value
      : (value && Array.isArray(value.rows) ? value.rows : [])
    return raw.filter(item => item && typeof item === 'object')
  }

  function normalizeIdType(value) {
    const text = String(value || '').trim().toUpperCase()
    if (text === 'GOODS ID' || text === 'GOODS_ID' || text === 'GOODSID') return 'Goods ID'
    if (text === 'SKC ID' || text === 'SKC_ID' || text === 'SKCID') return 'SKC ID'
    if (text === 'SKU ID' || text === 'SKU_ID' || text === 'SKUID' || text === 'SKU') return 'SKU ID'
    return text
  }

  function fail(message) {
    return { success: false, error: message }
  }

  function complete(data) {
    return {
      success: true,
      data,
      meta: {
        action: 'complete',
        has_more: false,
      },
    }
  }

  function collectPageCapabilities() {
    const tabLabels = [...document.querySelectorAll('[class*="TAB_tabItem_"], [class*="TAB_line_"], div')]
      .filter(isVisible)
      .map(node => textOf(node))
      .filter(text => /^(待填写|待修改|待确认|已提交)/.test(text))
    const actionLabels = [...document.querySelectorAll('a, button, span, div')]
      .filter(isVisible)
      .map(node => textOf(node))
      .filter(text => text && text.length <= 24)
      .filter(text => /^(明细|修改|导入|批量导入|下载模板|提交)/.test(text))
    return {
      页面标题: document.title || '',
      当前地址: location.href || '',
      状态Tab: [...new Set(tabLabels)].join(' | '),
      行级操作: [...new Set(actionLabels)].join(' | '),
      是否发现批量导入按钮: actionLabels.some(text => /导入/.test(text)) ? '是' : '否',
      是否发现行级修改按钮: actionLabels.includes('修改') ? '是' : '否',
      预研结论: actionLabels.some(text => /导入/.test(text))
        ? '页面存在导入相关按钮，可继续针对导入链路做真实交互预研；本任务当前不会执行提交。'
        : '当前 live 页面未发现稳定的批量导入入口，仅发现行级“修改/明细”操作；建议先以模板校验 + 行级改价链路预研为主。',
    }
  }

  try {
    if (phase !== 'main') return fail(`未知执行阶段：${phase}`)
    if (!location.href.includes('/goods/recommended-retail-price')) {
      location.href = TARGET_URL
      return complete([])
    }

    const rows = parseExcelRows('import_file')
    if (!rows.length) {
      return fail(`导入模板为空。请按模板列填写：${TEMPLATE_COLUMNS.join('、')}`)
    }

    const capability = collectPageCapabilities()
    const results = [{
      记录类型: '页面能力',
      ...capability,
    }]

    rows.forEach((row, index) => {
      const idType = normalizeIdType(row.ID类型 || row.id_type || row['ID Type'] || '')
      const idValue = String(row.ID值 || row.id_value || row['ID Value'] || '').trim()
      const site = String(row.站点 || row.site || '').trim()
      const minPrice = String(row['建议零售价最小值'] || row.min_price || '').trim()
      const maxPrice = String(row['建议零售价最大值'] || row.max_price || '').trim()
      const errors = []
      if (!idType) errors.push('缺少 ID类型')
      if (!idValue) errors.push('缺少 ID值')
      if (!minPrice && !maxPrice) errors.push('建议零售价最小值/最大值至少填写一项')
      results.push({
        记录类型: '模板校验',
        行号: index + 1,
        ID类型: idType,
        ID值: idValue,
        站点: site,
        建议零售价最小值: minPrice,
        建议零售价最大值: maxPrice,
        备注: String(row.备注 || row.note || '').trim(),
        页面标题: capability.页面标题,
        当前地址: capability.当前地址,
        校验结果: errors.length ? '失败' : '通过',
        校验信息: errors.join('；') || '模板结构通过；当前脚本仅输出预研计划，不实际提交价格。',
        下一步建议: capability['是否发现批量导入按钮'] === '是'
          ? '下一轮可在当前页面继续验证导入按钮、模板上传、预提交校验链路。'
          : '下一轮建议先验证首行“修改”入口，再决定是否需要自建批量调度层。',
      })
    })

    return complete(results)
  } catch (error) {
    return fail(error?.message || String(error))
  }
})()
