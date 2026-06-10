;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}

  function cleanText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim()
  }

  function nowText() {
    try {
      return new Date().toLocaleString('zh-CN', { hour12: false })
    } catch (error) {
      return new Date().toISOString()
    }
  }

  function safeParseJson(value, fallback) {
    if (Array.isArray(value) || (value && typeof value === 'object')) return value
    try {
      return JSON.parse(String(value || ''))
    } catch (error) {
      return fallback
    }
  }

  function unwrapMtopPayload(payload, api) {
    if (!payload || typeof payload !== 'object') return payload
    if (payload.ret && Array.isArray(payload.ret)) {
      const failed = payload.ret.find(item => !/^SUCCESS/i.test(String(item || '')))
      if (failed) throw new Error(`${api} 返回失败：${payload.ret.join('；')}`)
    }
    if (payload.data !== undefined) return payload.data
    return payload
  }

  async function callMtop(api, data = {}) {
    const client = window.lib?.mtop || window.mtop
    if (!client || typeof client.request !== 'function') {
      throw new Error('未找到千牛页面 MTop 客户端，请确认当前 tab 是素材中心视频生产页')
    }
    const payload = await client.request({
      api,
      v: '1.0',
      type: 'POST',
      dataType: 'json',
      H5Request: true,
      preventFallback: true,
      data,
    })
    return unwrapMtopPayload(payload, api)
  }

  async function fetchSellerCategory() {
    try {
      const data = await callMtop('mtop.taobao.qn.copilot.node.aigc.seller.category.get', {})
      return data?.result || data || {}
    } catch (error) {
      return {}
    }
  }

  async function fetchTemplates(category) {
    const data = await callMtop('mtop.taobao.qn.copilot.video.template.list', { mainCategory: category })
    const result = data?.result || data
    if (Array.isArray(result)) return result
    if (Array.isArray(result?.templates)) return result.templates
    if (Array.isArray(result?.list)) return result.list
    return []
  }

  function categoryLabel(raw) {
    const data = safeParseJson(raw, {})
    if (!data || typeof data !== 'object' || Array.isArray(data)) return cleanText(raw)
    const labels = []
    for (const key of ['tagCategory', 'bizCategory', 'storeCategory']) {
      const node = data[key] || {}
      const name = cleanText(node.name)
      const children = Array.isArray(node.children) ? node.children : []
      const childNames = children.map(item => cleanText(item?.name)).filter(Boolean)
      if (name) labels.push(name)
      if (childNames.length) labels.push(childNames.slice(0, 3).join('/'))
    }
    return labels.join(' | ')
  }

  function slotSummary(inputImages) {
    const slots = safeParseJson(inputImages, [])
    if (!Array.isArray(slots)) return { requiredCount: 0, optionalCount: 0, slotText: '', exampleText: '' }
    const required = []
    const optional = []
    const examples = []
    slots.forEach((slot, index) => {
      if (!slot || typeof slot !== 'object') return
      const code = cleanText(slot.code ?? slot.slotCode ?? index)
      const name = cleanText(slot.slotName || slot.name)
      const desc = cleanText(slot.description)
      const text = `${code}:${name || '未命名槽位'}${desc ? `(${desc})` : ''}`
      const isRequired = slot.require !== false && slot.required !== false
      if (isRequired) required.push(text)
      else optional.push(text)
      const imageUrl = cleanText(slot.imageUrl)
      if (imageUrl) examples.push(`${code}:${imageUrl}`)
    })
    return {
      requiredCount: required.length,
      optionalCount: optional.length,
      slotText: [...required, ...optional].join('\n'),
      exampleText: examples.join('\n'),
    }
  }

  function buildRow(template, index, category, fetchedAt) {
    const slots = slotSummary(template.inputImages)
    return {
      序号: index + 1,
      主类目: category,
      模板ID: cleanText(template.templateId),
      模板名称: cleanText(template.name),
      模板类型: cleanText(template.type),
      比例: cleanText(template.ratio),
      时长秒: template.duration || '',
      必填槽位数: slots.requiredCount,
      选填槽位数: slots.optionalCount,
      槽位说明: slots.slotText,
      分类: categoryLabel(template.category),
      描述: cleanText(template.description),
      封面URL: cleanText(template.coverUrl),
      视频预览URL: cleanText(template.videoUrl),
      示例槽位图URL: slots.exampleText,
      provider: cleanText(template.provider),
      模板JSON: JSON.stringify(template),
      抓取时间: fetchedAt,
      执行结果: '成功',
      备注: '',
    }
  }

  try {
    const sellerCategory = await fetchSellerCategory()
    const category = cleanText(params.main_category) || cleanText(sellerCategory.mainCateName) || '女装/女士精品'
    const templates = await fetchTemplates(category)
    const fetchedAt = nowText()
    const rows = templates.map((template, index) => buildRow(template, index, category, fetchedAt))
    if (!rows.length) {
      return {
        success: true,
        data: [{
          序号: '',
          主类目: category,
          执行结果: '失败',
          备注: '未读取到模板，请确认当前页面已登录且主类目正确',
          抓取时间: fetchedAt,
        }],
        meta: { has_more: false, template_count: 0, main_category: category },
      }
    }
    return {
      success: true,
      data: rows,
      meta: {
        has_more: false,
        template_count: rows.length,
        main_category: category,
        seller_category: sellerCategory,
      },
    }
  } catch (error) {
    return { success: false, error: String(error?.message || error) }
  }
})()
