;(async () => {
  const TARGET_URL = 'https://sso.geiwohuo.com/#/sbn/merchandise/details'

  const FALLBACK_NEW_GOODS_TAG_OPTIONS = [
    { value: '1', label: '新品爆款' },
    { value: '2', label: '新品畅销' },
    { value: '3', label: '潜力新品' },
    { value: '4', label: '新品' },
  ]

  const FALLBACK_LAYER_OPTIONS = [
    'QQK',
    '保证在售款',
    '加码',
    '售完下架',
    '备货款A',
    '备货款B',
    '待处理议价',
    '新款',
    '新款A',
    '新款未上架',
    '春夏款',
    '暂不下单',
    '清仓款',
    '热销断码款',
    '特殊-赠品',
    '自主下架',
    '自主停产',
    '退供款',
    '重复款',
    '问题款',
  ].map(value => ({ value, label: value }))

  const FALLBACK_QUALITY_OPTIONS = [
    'A1',
    'A2',
    'B1',
    'B2',
    'C1',
    'C2',
    'D1',
    'D2',
    '不合格-D',
    '无判断',
  ].map(value => ({ value, label: value }))

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

  function fail(message) {
    return { success: false, error: String(message || '未知错误') }
  }

  function textOf(el) {
    return String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim()
  }

  function normalizeOptionText(value) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim()
    if (!text) return ''
    if (text.includes('热销断码')) return '热销断码款'
    return text
  }

  function isVisible(el) {
    if (!el || typeof el.getClientRects !== 'function') return false
    return el.getClientRects().length > 0
  }

  async function waitFor(check, timeout = 8000, interval = 250) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (check()) return true
      await sleep(interval)
    }
    return false
  }

  function getReactFiberKey(target) {
    return Object.keys(target || {}).find(key => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) || ''
  }

  function getReactFiber(target) {
    const fiberKey = getReactFiberKey(target)
    return fiberKey ? target[fiberKey] : null
  }

  function collectReactProps(predicate) {
    const matches = []
    const seen = new Set()

    for (const node of document.querySelectorAll('body *')) {
      if (!isVisible(node)) continue
      let fiber = getReactFiber(node)
      let depth = 0
      while (fiber && depth < 24) {
        const props = fiber.memoizedProps || {}
        if (!seen.has(props) && predicate(props, node)) {
          seen.add(props)
          matches.push(props)
          break
        }
        fiber = fiber.return
        depth += 1
      }
    }

    return matches
  }

  function normalizeFlatOptions(items, valueKeys, labelKeys) {
    const result = []
    const seen = new Set()

    for (const item of Array.isArray(items) ? items : []) {
      if (!item || typeof item !== 'object') continue
      let value = ''
      let label = ''

      for (const key of valueKeys || []) {
        const candidate = normalizeOptionText(item?.[key])
        if (candidate) {
          value = candidate
          break
        }
      }

      for (const key of labelKeys || []) {
        const candidate = normalizeOptionText(item?.[key])
        if (candidate) {
          label = candidate
          break
        }
      }

      if (!value) value = normalizeOptionText(item?.value)
      if (!label) label = normalizeOptionText(item?.label ?? value)
      if (!value || !label || seen.has(value)) continue
      seen.add(value)
      result.push({ value, label })
    }

    return result
  }

  function findFieldOptions(fieldName, fallbackOptions = []) {
    const controllers = collectReactProps(props =>
      props &&
      props.name === fieldName &&
      (
        Array.isArray(props.data) ||
        Array.isArray(props.options) ||
        Array.isArray(props.source) ||
        Array.isArray(props.list)
      ),
    )
    const props = controllers[0] || {}
    const source = props.data || props.options || props.source || props.list || []
    const normalized = normalizeFlatOptions(source, ['value', 'key', 'id'], ['label', 'name', 'text'])
    return normalized.length ? normalized : fallbackOptions
  }

  function findSiteOptions() {
    const controllers = collectReactProps(props =>
      Array.isArray(props?.data) &&
      props.data.some(item => item && typeof item === 'object' && item.countrySite),
    )
    const props = controllers[0] || {}
    const normalized = normalizeFlatOptions(props.data || [], ['countrySite', 'value'], ['countrySite', 'countrySiteDesc', 'label'])
    return normalized
  }

  async function expandFilterPanelIfNeeded() {
    const expandButton = [...document.querySelectorAll('button')]
      .filter(isVisible)
      .find(button => /^展开$/i.test(textOf(button)))
    if (!expandButton) return false
    try { expandButton.click?.() } catch (error) {}
    await sleep(300)
    return true
  }

  try {
    if (!String(location.href || '').includes('#/sbn/merchandise/details')) {
      location.href = TARGET_URL
      return {
        success: true,
        data: [],
        meta: {
          needs_retry: true,
          retry_reason: 'navigating',
        },
      }
    }

    const ready = await waitFor(() =>
      /商品分析|商品明细/.test(textOf(document.body)) &&
      [...document.querySelectorAll('button')].some(button => isVisible(button) && /^(搜索|查询)$/i.test(textOf(button))),
    10000, 250)
    if (!ready) return fail('SHEIN 商品分析-商品明细页面未加载完成')

    await expandFilterPanelIfNeeded()

    const siteOptions = findSiteOptions()
    const newGoodsTagOptions = findFieldOptions('newGoodsTag', FALLBACK_NEW_GOODS_TAG_OPTIONS)
    const layerOptions = findFieldOptions('layerNm', FALLBACK_LAYER_OPTIONS)
    const qualityOptions = findFieldOptions('totalQualityLevel', FALLBACK_QUALITY_OPTIONS)

    return {
      success: true,
      data: [
        {
          id: 'country_site',
          options: [
            { value: '', label: '使用页面默认站点' },
            ...siteOptions,
          ],
        },
        {
          id: 'new_goods_tag',
          options: newGoodsTagOptions,
        },
        {
          id: 'layer_nm',
          options: layerOptions,
        },
        {
          id: 'total_quality_level',
          options: qualityOptions,
        },
      ],
      meta: {
        site_count: siteOptions.length,
        new_goods_tag_count: newGoodsTagOptions.length,
        layer_count: layerOptions.length,
        quality_count: qualityOptions.length,
      },
    }
  } catch (error) {
    return fail(error?.message || error)
  }
})()
