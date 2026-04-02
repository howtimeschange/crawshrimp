/**
 * Lazada voucher / promo batch create
 *
 * Current live scope:
 * - Regular Voucher: Entire Shop + Percentage Discount Off + Fixed time
 * - Store New Buyer Voucher: Entire Shop + Percentage Discount Off + Fixed time
 * - Store Follower Voucher: Entire Shop + Percentage Discount Off + Fixed time
 * - Flexi Combo: Money/Discount Off + Percentage Discount Off + Entire Shop
 */
;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const page = window.__CRAWSHRIMP_PAGE__ || 1
  const phase = window.__CRAWSHRIMP_PHASE__ || 'main'
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const executeMode = norm(params.execute_mode || 'plan').toLowerCase()
  const inputFile = params.input_file || {}
  const rawRows = Array.isArray(inputFile.rows) ? inputFile.rows : []
  const sheetMap = inputFile.sheets || {}

  const SITE_MAP = {
    MY: {
      code: 'MY',
      label: 'Malaysia',
      aliases: ['MY', 'Malaysia', '马来西亚', '马来'],
      domain: 'https://sellercenter.lazada.com.my',
    },
    SG: {
      code: 'SG',
      label: 'Singapore',
      aliases: ['SG', 'Singapore', '新加坡'],
      domain: 'https://sellercenter.lazada.sg',
    },
    ID: {
      code: 'ID',
      label: 'Indonesia',
      aliases: ['ID', 'Indonesia', '印尼'],
      domain: 'https://sellercenter.lazada.co.id',
    },
    PH: {
      code: 'PH',
      label: 'Philippines',
      aliases: ['PH', 'Philippines', 'Philippine', '菲律宾'],
      domain: 'https://sellercenter.lazada.com.ph',
    },
    TH: {
      code: 'TH',
      label: 'Thailand',
      aliases: ['TH', 'Thailand', '泰国'],
      domain: 'https://sellercenter.lazada.co.th',
    },
    VN: {
      code: 'VN',
      label: 'Vietnam',
      aliases: ['VN', 'Vietnam', '越南'],
      domain: 'https://sellercenter.lazada.vn',
    },
  }

  const TOOL_MAP = {
    REGULAR_VOUCHER: {
      key: 'REGULAR_VOUCHER',
      label: 'Regular Voucher',
      aliases: ['Regular Voucher', 'REGULAR_VOUCHER', '普通券', '店铺券', '商店券'],
      createPath: '/apps/voucher/create?action=create&moduleType=REGULAR_VOUCHER',
      phaseFlow: 'ensure_site_home -> resolve_existing_promotions -> open_create_page -> fill_form -> submit -> post_submit',
    },
    FLEXI_COMBO: {
      key: 'FLEXI_COMBO',
      label: 'Flexi Combo',
      aliases: ['Flexi Combo', 'FLEXI_COMBO', '阶梯优惠', '弹性组合'],
      createPath: '/apps/promotion/flexicombo/create',
      phaseFlow: 'ensure_site_home -> resolve_existing_promotions -> open_create_page -> fill_form -> submit -> post_submit',
    },
    STORE_NEW_BUYER_VOUCHER: {
      key: 'STORE_NEW_BUYER_VOUCHER',
      label: 'Store New Buyer Voucher',
      aliases: ['Store New Buyer Voucher', 'STORE_NEW_BUYER_VOUCHER', '新买家券', '新客券'],
      createPath: '/apps/voucher/create?action=create&voucherDisplayArea=STORE_NEW_BUYER_ONLY',
      phaseFlow: 'ensure_site_home -> resolve_existing_promotions -> open_create_page -> fill_form -> submit -> post_submit',
    },
    STORE_FOLLOWER_VOUCHER: {
      key: 'STORE_FOLLOWER_VOUCHER',
      label: 'Store Follower Voucher',
      aliases: ['Store Follower Voucher', 'STORE_FOLLOWER_VOUCHER', '粉丝券', '关注礼'],
      createPath: '/apps/voucher/create?action=create&moduleType=STORE_FOLLOWER_VOUCHER',
      phaseFlow: 'ensure_site_home -> resolve_existing_promotions -> open_create_page -> fill_form -> submit -> post_submit',
    },
  }

  const SHEET_ALIASES = {
    vouchers: ['Vouchers', 'Voucher', '优惠券', '主表'],
    flexiTiers: ['FlexiTiers', 'Flexi Tier', 'Flexi Combo Tiers', '阶梯', 'Flexi阶梯'],
  }

  const VERIFIED_SITES = new Set(['MY', 'SG'])
  const truthyRe = /^(1|true|yes|y|是)$/i
  const falsyRe = /^(0|false|no|n|否)$/i
  const VOUCHER_TOOL_KEYS = ['REGULAR_VOUCHER', 'STORE_NEW_BUYER_VOUCHER', 'STORE_FOLLOWER_VOUCHER']

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async function waitFor(fn, timeout = 8000, interval = 200) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      const value = await fn()
      if (value) return value
      await sleep(interval)
    }
    return null
  }

  function norm(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  }

  function textOf(el) {
    return norm(el?.innerText || el?.textContent || el?.value || '')
  }

  function uniqueStrings(values = []) {
    const seen = new Set()
    const result = []
    for (const value of values) {
      const text = norm(value)
      if (!text || seen.has(text)) continue
      seen.add(text)
      result.push(text)
    }
    return result
  }

  function toStringArray(value) {
    if (Array.isArray(value)) {
      return uniqueStrings(value.flatMap(item => toStringArray(item)))
    }
    const text = norm(value)
    return text ? [text] : []
  }

  function mergeWarnings(...groups) {
    return uniqueStrings(groups.flatMap(group => toStringArray(group)))
  }

  function normalizeHeaderKey(value) {
    return norm(value)
      .replace(/[()（）:：/_-]/g, '')
      .replace(/\s+/g, '')
      .toLowerCase()
  }

  function getRowValue(row, aliases = [], options = {}) {
    const keys = Object.keys(row || {})
    if (!keys.length) return options.defaultValue ?? ''
    const aliasList = aliases.map(normalizeHeaderKey).filter(Boolean)
    const matchedKey = keys.find(key => {
      const normalizedKey = normalizeHeaderKey(key)
      return aliasList.some(alias => options.includes ? normalizedKey.includes(alias) : normalizedKey === alias)
    })
    return matchedKey ? row[matchedKey] : (options.defaultValue ?? '')
  }

  function toBool(value, defaultValue = null) {
    const text = norm(value)
    if (!text) return defaultValue
    if (truthyRe.test(text)) return true
    if (falsyRe.test(text)) return false
    return defaultValue
  }

  function looksLikeDateTime(value) {
    const text = norm(value)
    if (!text) return false
    return /^\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?$/.test(text)
  }

  function normalizeDateTimeInput(value) {
    const text = norm(value)
    if (!text) return ''
    const match = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
    if (!match) return text
    const year = match[1]
    const month = String(match[2]).padStart(2, '0')
    const day = String(match[3]).padStart(2, '0')
    const hour = String(match[4]).padStart(2, '0')
    const minute = String(match[5]).padStart(2, '0')
    const second = String(match[6] || '00').padStart(2, '0')
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`
  }

  function normalizeDateTimeForCompare(value) {
    const text = normalizeDateTimeInput(value)
    return text ? text.slice(0, 16) : ''
  }

  function parseDateTimeValue(value) {
    const text = normalizeDateTimeInput(value)
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/)
    if (!match) return NaN
    const [, year, month, day, hour, minute, second] = match
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    ).getTime()
  }

  function rangesOverlap(leftStart, leftEnd, rightStart, rightEnd) {
    if (![leftStart, leftEnd, rightStart, rightEnd].every(Number.isFinite)) return false
    return leftStart <= rightEnd && rightStart <= leftEnd
  }

  function canonicalFromMap(raw, map, fallback = '') {
    const text = norm(raw).toLowerCase()
    if (!text) return fallback
    for (const item of Object.values(map)) {
      const aliases = (item.aliases || []).map(alias => norm(alias).toLowerCase())
      if (aliases.some(alias => alias && (text === alias || text.includes(alias)))) {
        return item.key || item.code || fallback
      }
    }
    return fallback
  }

  function canonicalSite(raw) {
    return canonicalFromMap(raw, SITE_MAP, '')
  }

  function canonicalTool(raw) {
    return canonicalFromMap(raw, TOOL_MAP, '')
  }

  function canonicalUseTimeType(raw) {
    const text = norm(raw).toLowerCase()
    if (!text) return 'FIXED_TIME'
    if (/after collection|领取后|collection/.test(text)) return 'USE_AFTER_COLLECTION'
    if (/fixed|固定|定时/.test(text)) return 'FIXED_TIME'
    return ''
  }

  function canonicalApplyScope(raw) {
    const text = norm(raw).toLowerCase()
    if (!text) return 'ENTIRE_SHOP'
    if (/specific|指定|商品/.test(text)) return 'SPECIFIC_PRODUCTS'
    if (/entire|whole|全店|整店/.test(text)) return 'ENTIRE_SHOP'
    return ''
  }

  function canonicalDiscountType(raw) {
    const text = norm(raw).toLowerCase()
    if (!text) return ''
    if (/money|fixed|金额|减/.test(text)) return 'MONEY_OFF'
    if (/percent|percentage|折扣|%/.test(text)) return 'PERCENT_OFF'
    return ''
  }

  function canonicalBudgetMode(raw) {
    const text = norm(raw).toLowerCase()
    if (!text) return ''
    if (/limited|限额|有限/.test(text)) return 'LIMITED'
    if (/unlimited|不限|无限/.test(text)) return 'UNLIMITED'
    return ''
  }

  function canonicalFlexiMainType(raw) {
    const text = norm(raw).toLowerCase()
    if (!text) return 'MONEY_DISCOUNT_OFF'
    if (/^money_discount_off$|money\/discount off|money discount|金额优惠/.test(text)) return 'MONEY_DISCOUNT_OFF'
    if (/^free_gift_sample$|free gift|gift\/sample|赠品|样品/.test(text)) return 'FREE_GIFT_SAMPLE'
    if (/^combo_buy$|combo buy|组合购/.test(text)) return 'COMBO_BUY'
    if (/^fixed_price$|fixed price|固定价/.test(text)) return 'FIXED_PRICE'
    return ''
  }

  function canonicalFlexiSubtype(raw) {
    const text = norm(raw)
    if (!text) return ''
    const lower = text.toLowerCase()
    const map = {
      MoneyValueOff: ['Money Value Off', '金额减'],
      PercentageDiscountOff: ['Percentage Discount Off', '百分比折扣'],
      FreeGiftsOnly: ['Free Gift(s) only', '仅赠品'],
      FreeSamplesOnly: ['Free Sample(s) only', '仅样品'],
      PercentOffAndFreeGift: ['Percentage Discount Off & Free Gift(s)', '折扣+赠品'],
      MoneyOffAndFreeGift: ['Money Value Off & Free Gift(s)', '金额减+赠品'],
      PercentOffAndFreeSample: ['Percentage Discount Off & Free Sample(s)', '折扣+样品'],
      MoneyOffAndFreeSample: ['Money Value Off & Free Sample(s)', '金额减+样品'],
    }
    for (const [key, aliases] of Object.entries(map)) {
      if (
        lower === key.toLowerCase() ||
        aliases.some(alias => lower === norm(alias).toLowerCase() || lower.includes(norm(alias).toLowerCase()))
      ) {
        return key
      }
    }
    return ''
  }

  function canonicalFlexiCriteria(raw) {
    const text = norm(raw).toLowerCase()
    if (!text) return 'ITEM_QUANTITY'
    if (/^order_value$|order value|订单金额|金额/.test(text)) return 'ORDER_VALUE'
    if (/^item_quantity$|item quantity|数量|件数/.test(text)) return 'ITEM_QUANTITY'
    return ''
  }

  function findSheetRows(sheetAliases) {
    const entries = Object.entries(sheetMap || {})
    const aliasSet = new Set(sheetAliases.map(alias => norm(alias).toLowerCase()))
    const match = entries.find(([name]) => aliasSet.has(norm(name).toLowerCase()))
    return match?.[1]?.rows || []
  }

  function getVoucherRows() {
    const fromWorkbook = findSheetRows(SHEET_ALIASES.vouchers)
    return fromWorkbook.length ? fromWorkbook : rawRows
  }

  function getFlexiTierRows() {
    return findSheetRows(SHEET_ALIASES.flexiTiers)
  }

  function buildTierMap(rows) {
    const out = new Map()
    rows.forEach((row, index) => {
      const key = norm(getRowValue(row, ['唯一键', 'row_key', 'promotion_key']))
      if (!key) return
      const tierNo = Number(norm(getRowValue(row, ['阶梯序号', 'tier_no', 'tier'])) || index + 1)
      const tier = {
        tier_no: Number.isFinite(tierNo) ? tierNo : index + 1,
        threshold_value: norm(getRowValue(row, ['门槛值', 'criteria_value', 'threshold_value'])),
        discount_value: norm(getRowValue(row, ['优惠值', 'discount_value'])),
        gift_quantity: norm(getRowValue(row, ['赠品数量', 'gift_quantity'])),
        buyer_choice_count: norm(getRowValue(row, ['买家可选赠品数', 'buyer_choice_count', 'buyer_choice_qty'])),
        gift_sku_list: norm(getRowValue(row, ['赠品SKU列表', 'gift_sku_list', 'gift_skus'])),
        note: norm(getRowValue(row, ['备注', 'note'])),
      }
      if (!out.has(key)) out.set(key, [])
      out.get(key).push(tier)
    })
    for (const [key, tiers] of out.entries()) {
      tiers.sort((left, right) => left.tier_no - right.tier_no)
      out.set(key, tiers)
    }
    return out
  }

  function buildCreateUrl(siteCode, toolKey) {
    const site = SITE_MAP[siteCode]
    const tool = TOOL_MAP[toolKey]
    if (!site || !tool) return ''
    return `${site.domain}${tool.createPath}`
  }

  function buildHomeUrl(siteCode) {
    const site = SITE_MAP[siteCode]
    return site ? `${site.domain}/apps/promotion/home` : ''
  }

  function buildListUrl(siteCode, toolKey) {
    const site = SITE_MAP[siteCode]
    if (!site) return ''
    if (toolKey === 'FLEXI_COMBO') return `${site.domain}/apps/promotion/flexicombo/list`
    if (toolKey === 'STORE_NEW_BUYER_VOUCHER') {
      return `${site.domain}/apps/promotion/newBuyerVoucher/list?voucherDisplayArea=STORE_NEW_BUYER_ONLY`
    }
    if (VOUCHER_TOOL_KEYS.includes(toolKey)) {
      return `${site.domain}/apps/promotion/voucher/list?moduleType=${encodeURIComponent(toolKey)}`
    }
    return ''
  }

  function liveSupportIssue(row) {
    if (row.apply_scope !== 'ENTIRE_SHOP') return '当前 live 仅支持 Entire Shop'
    if (VOUCHER_TOOL_KEYS.includes(row.tool_key)) {
      if (row.use_time_type !== 'FIXED_TIME') return '当前 live 仅支持 FIXED_TIME'
      if (row.discount_type !== 'PERCENT_OFF') return '当前 live 仅支持 Percentage Discount Off'
      return ''
    }
    if (row.tool_key === 'FLEXI_COMBO') {
      if (row.flexi_main_type !== 'MONEY_DISCOUNT_OFF') return '当前 live 仅支持 Flexi Combo 的 Money/Discount Off'
      if (row.flexi_subtype !== 'PercentageDiscountOff') return '当前 live 仅支持 Flexi Combo 的 Percentage Discount Off'
      return ''
    }
    return '未识别的 live 工具类型'
  }

  function validateNormalizedRow(item) {
    const issues = []
    const warnings = []
    const row = item.normalized

    if (!row.row_key) issues.push('缺少“唯一键”')
    if (!row.site_code) issues.push('站点无法识别')
    if (!row.tool_key) issues.push('优惠工具无法识别')
    if (!row.promotion_name) issues.push('缺少“促销名称”')
    if (row.site_code && !VERIFIED_SITES.has(row.site_code)) {
      warnings.push(`站点 ${row.site_code} 尚未在 2026-04-01 的实测名单里，目前仅验证 MY/SG`)
    }
    if (row.apply_scope === 'SPECIFIC_PRODUCTS') {
      warnings.push('Specific Products 需要提交后再选商品，本轮 live 先只接 Entire Shop')
    }

    if (VOUCHER_TOOL_KEYS.includes(row.tool_key)) {
      if (!row.use_time_type) issues.push('领取生效类型无法识别')
      if (row.use_time_type === 'FIXED_TIME') {
        if (!row.voucher_start_at || !looksLikeDateTime(row.voucher_start_at)) issues.push('固定生效场景缺少“券生效开始时间”或格式不正确')
        if (!row.voucher_end_at || !looksLikeDateTime(row.voucher_end_at)) issues.push('固定生效场景缺少“券生效结束时间”或格式不正确')
        if (row.collect_start_at && !looksLikeDateTime(row.collect_start_at)) issues.push('“最早可领取时间”格式不正确')
      }
      if (row.use_time_type === 'USE_AFTER_COLLECTION') {
        if (!row.collect_window_start_at || !looksLikeDateTime(row.collect_window_start_at)) issues.push('领取后生效场景缺少“领取开始时间”或格式不正确')
        if (!row.collect_window_end_at || !looksLikeDateTime(row.collect_window_end_at)) issues.push('领取后生效场景缺少“领取结束时间”或格式不正确')
        if (!row.valid_days_after_collection) issues.push('领取后生效场景缺少“领取后可用天数”')
        warnings.push('USE_AFTER_COLLECTION 已完成字段探查，本轮 live 先优先接 FIXED_TIME')
      }

      if (!row.discount_type) issues.push('缺少“折扣类型”')
      if (!row.min_spend_amount) issues.push('缺少“最低消费金额”')
      if (!row.discount_value) issues.push('缺少“折扣值”')
      if (!row.per_customer_limit) issues.push('缺少“每人限用次数”')

      if (row.discount_type === 'PERCENT_OFF' && !row.max_discount_amount) {
        issues.push('百分比折扣场景缺少“最高优惠金额”')
      }

      if (row.tool_key === 'REGULAR_VOUCHER') {
        if (row.discount_type === 'PERCENT_OFF') {
          if (!row.total_issued) issues.push('Regular Voucher + 百分比折扣场景缺少“总发行量”')
        } else {
          if (!row.budget_mode) issues.push('Regular Voucher 缺少“预算模式”')
          if (row.budget_mode === 'LIMITED' && !row.budget_amount) {
            issues.push('Regular Voucher 预算模式为 LIMITED 时必须填写“预算金额”')
          }
        }
      }

      if (row.tool_key === 'STORE_NEW_BUYER_VOUCHER' || row.tool_key === 'STORE_FOLLOWER_VOUCHER') {
        if (!row.total_issued) issues.push('Store New Buyer/Follower Voucher 缺少“总发行量”')
      }

      if (row.tool_key === 'STORE_FOLLOWER_VOUCHER' && row.apply_scope === 'SPECIFIC_PRODUCTS') {
        issues.push('Store Follower Voucher 页面上 Specific Products 当前为 disabled，不能直接创建')
      }
    }

    if (row.tool_key === 'FLEXI_COMBO') {
      if (!row.flexi_main_type) issues.push('Flexi Combo 缺少“Flexi主玩法”')
      if (!row.total_flexi_orders) issues.push('Flexi Combo 缺少“Flexi总单量”')
      if (!row.voucher_start_at || !looksLikeDateTime(row.voucher_start_at)) issues.push('Flexi Combo 缺少“券生效开始时间”或格式不正确')
      if (!row.voucher_end_at || !looksLikeDateTime(row.voucher_end_at)) issues.push('Flexi Combo 缺少“券生效结束时间”或格式不正确')

      if (row.flexi_main_type === 'FIXED_PRICE') {
        if (!row.flexi_fixed_item_count) issues.push('Fixed Price 缺少“Flexi固定件数”')
        if (!row.flexi_fixed_total_price) issues.push('Fixed Price 缺少“Flexi固定总价”')
        if (row.apply_scope !== 'SPECIFIC_PRODUCTS') {
          issues.push('Fixed Price 页面当前只允许 Specific Products')
        }
      } else {
        if (!row.flexi_criteria_type) issues.push('Flexi Combo 缺少“Flexi条件类型”')
        if (!item.tiers.length) issues.push('Flexi Combo 缺少 FlexiTiers sheet 阶梯数据')
      }

      if (row.flexi_main_type === 'MONEY_DISCOUNT_OFF' && !row.flexi_subtype) {
        issues.push('Money/Discount Off 缺少“Flexi子玩法”')
      }
      if (row.flexi_main_type === 'FREE_GIFT_SAMPLE' && !row.flexi_subtype) {
        issues.push('Free gift/sample 缺少“Flexi子玩法”')
      }
      if (row.flexi_main_type === 'COMBO_BUY' && !row.flexi_subtype) {
        issues.push('Combo Buy 缺少“Flexi子玩法”')
      }

      const advancedFlexi = ['FREE_GIFT_SAMPLE', 'COMBO_BUY'].includes(row.flexi_main_type)
      if (advancedFlexi) {
        warnings.push('Flexi Combo 的赠品/样品商品选择流程已完成字段探查，但 live 还没有回写商品选择弹层')
      }
      if (row.flexi_main_type === 'MONEY_DISCOUNT_OFF' && row.flexi_subtype === 'MoneyValueOff') {
        warnings.push('Money/Discount Off + Money Value Off 场景已探查，但当前 live 先优先接 Percentage Discount Off')
      }
    }

    const liveIssue = liveSupportIssue(row)
    if (liveIssue) warnings.push(`当前 live 范围提示：${liveIssue}`)

    return { issues, warnings }
  }

  function normalizeRow(row, sourceIndex, tierMap) {
    const rowKey = norm(getRowValue(row, ['唯一键', 'row_key', 'promotion_key']))
    const siteCode = canonicalSite(getRowValue(row, ['站点', 'site', 'country']))
    const toolKey = canonicalTool(getRowValue(row, ['优惠工具', '优惠券类型', 'tool', 'voucher_type']))
    const isVoucherTool = VOUCHER_TOOL_KEYS.includes(toolKey)
    const isFlexiTool = toolKey === 'FLEXI_COMBO'
    const useTimeType = isVoucherTool
      ? canonicalUseTimeType(getRowValue(row, ['领取生效类型', 'use_time_type', 'voucher_use_time_type']))
      : ''
    const applyScope = canonicalApplyScope(getRowValue(row, ['适用范围', 'apply_scope', 'voucher_apply_to', 'discount_apply_to']))
    const discountType = canonicalDiscountType(getRowValue(row, ['折扣类型', 'discount_type']))
    const budgetMode = canonicalBudgetMode(getRowValue(row, ['预算模式', 'budget_mode']))
    const flexiMainType = isFlexiTool
      ? canonicalFlexiMainType(getRowValue(row, ['Flexi主玩法', 'flexi_main_type']))
      : ''
    const flexiSubtype = isFlexiTool
      ? canonicalFlexiSubtype(getRowValue(row, ['Flexi子玩法', 'flexi_subtype']))
      : ''
    const flexiCriteriaType = isFlexiTool
      ? canonicalFlexiCriteria(getRowValue(row, ['Flexi条件类型', 'flexi_criteria_type']))
      : ''
    const tiers = tierMap.get(rowKey) || []

    const normalized = {
      enabled: true,
      row_key: rowKey,
      source_index: sourceIndex,
      site_code: siteCode,
      site_label: SITE_MAP[siteCode]?.label || norm(getRowValue(row, ['站点', 'site', 'country'])),
      tool_key: toolKey,
      tool_label: TOOL_MAP[toolKey]?.label || norm(getRowValue(row, ['优惠工具', '优惠券类型', 'tool', 'voucher_type'])),
      promotion_name: norm(getRowValue(row, ['促销名称', 'promotion_name', 'voucher_name'])),
      use_time_type: useTimeType,
      voucher_start_at: norm(getRowValue(row, ['券生效开始时间', 'voucher_start_at', 'redeem_start_at'])),
      voucher_end_at: norm(getRowValue(row, ['券生效结束时间', 'voucher_end_at', 'redeem_end_at'])),
      collect_start_at: norm(getRowValue(row, ['最早可领取时间', 'collect_start_at', 'collect_start_time'])),
      collect_window_start_at: norm(getRowValue(row, ['领取开始时间', 'collect_window_start_at', 'collect_start_window'])),
      collect_window_end_at: norm(getRowValue(row, ['领取结束时间', 'collect_window_end_at', 'collect_end_window'])),
      valid_days_after_collection: norm(getRowValue(row, ['领取后可用天数', 'valid_days_after_collection', 'use_within_days'])),
      apply_scope: applyScope,
      discount_type: discountType,
      discount_value: norm(getRowValue(row, ['折扣值', 'discount_value'])),
      min_spend_amount: norm(getRowValue(row, ['最低消费金额', 'min_spend_amount', 'min_spend'])),
      max_discount_amount: norm(getRowValue(row, ['最高优惠金额', 'max_discount_amount', 'max_discount'])),
      per_customer_limit: norm(getRowValue(row, ['每人限用次数', '每人限领次数', 'per_customer_limit'])),
      budget_mode: budgetMode,
      budget_amount: norm(getRowValue(row, ['预算金额', 'budget_amount'])),
      total_issued: norm(getRowValue(row, ['总发行量', 'total_issued', 'voucher_quantity'])),
      flexi_main_type: flexiMainType,
      flexi_subtype: flexiSubtype,
      flexi_criteria_type: flexiCriteriaType,
      flexi_stackable_discount: toBool(getRowValue(row, ['Flexi是否叠加折扣', 'flexi_stackable_discount']), false),
      total_flexi_orders: norm(getRowValue(row, ['Flexi总单量', 'total_flexi_orders', 'total_orders'])),
      flexi_free_shipping: toBool(getRowValue(row, ['Flexi赠品是否免邮', 'flexi_free_shipping']), null),
      flexi_fixed_item_count: norm(getRowValue(row, ['Flexi固定件数', 'flexi_fixed_item_count'])),
      flexi_fixed_total_price: norm(getRowValue(row, ['Flexi固定总价', 'flexi_fixed_total_price'])),
      note: norm(getRowValue(row, ['备注', 'note'])),
      create_url: buildCreateUrl(siteCode, toolKey),
      home_url: buildHomeUrl(siteCode),
      list_url: buildListUrl(siteCode, toolKey),
      tiers,
    }

    const validation = validateNormalizedRow({ normalized, tiers })
    return {
      sourceIndex,
      raw: row,
      normalized,
      tiers,
      issues: validation.issues,
      warnings: validation.warnings,
    }
  }

  function buildExecutionRows(voucherRows, flexiTierRows) {
    const tierMap = buildTierMap(flexiTierRows)
    return voucherRows.map((row, index) => normalizeRow(row, index + 1, tierMap))
  }

  function buildTierSummary(tiers) {
    return tiers
      .map(tier => {
        const bits = [`Tier ${tier.tier_no}`, `threshold=${tier.threshold_value || '-'}`]
        if (tier.discount_value) bits.push(`discount=${tier.discount_value}`)
        if (tier.gift_quantity) bits.push(`gift_qty=${tier.gift_quantity}`)
        if (tier.buyer_choice_count) bits.push(`buyer_choice=${tier.buyer_choice_count}`)
        if (tier.gift_sku_list) bits.push(`gift_skus=${tier.gift_sku_list}`)
        return bits.join(', ')
      })
      .join(' ; ')
  }

  function buildPlanRow(item) {
    const row = item.normalized
    const tool = TOOL_MAP[row.tool_key]
    const liveIssue = liveSupportIssue(row)
    const status = item.issues.length ? 'invalid' : (liveIssue ? 'ready_but_out_of_current_live_scope' : 'ready_for_live')
    return {
      状态: status,
      源行号: item.sourceIndex,
      唯一键: row.row_key,
      站点: row.site_code || row.site_label,
      优惠工具: row.tool_label,
      促销名称: row.promotion_name,
      create_url: row.create_url,
      home_url: row.home_url,
      list_url: row.list_url,
      phase_flow: tool?.phaseFlow || '',
      live_scope: 'Entire Shop + Percentage Discount Off + Fixed time；Flexi=Money/Discount Off + Percentage Discount Off',
      live_support_issue: liveIssue,
      issues: item.issues.join(' | '),
      warnings: item.warnings.join(' | '),
      use_time_type: row.use_time_type,
      apply_scope: row.apply_scope,
      discount_type: row.discount_type,
      budget_mode: row.budget_mode,
      total_issued: row.total_issued,
      flexi_main_type: row.flexi_main_type,
      flexi_subtype: row.flexi_subtype,
      flexi_criteria_type: row.flexi_criteria_type,
      flexi_tier_count: item.tiers.length,
      flexi_tier_summary: buildTierSummary(item.tiers),
      note: row.note,
    }
  }

  const voucherRows = getVoucherRows()
  const flexiTierRows = getFlexiTierRows()

  if (!voucherRows.length) {
    return {
      success: false,
      error: 'Excel 主表为空。请在 Vouchers sheet（或工作簿第一个 sheet）至少填写一行。',
    }
  }

  const executionRows = buildExecutionRows(voucherRows, flexiTierRows)

  if (executeMode !== 'live') {
    return {
      success: true,
      data: executionRows.map(buildPlanRow),
      meta: {
        has_more: false,
        mode: 'plan',
        total_rows: executionRows.length,
        enabled_rows: executionRows.length,
        verified_sites: [...VERIFIED_SITES],
        workbook_sheet_name: inputFile.sheet_name || '',
        workbook_sheet_keys: Object.keys(sheetMap || {}),
      },
    }
  }

  const liveRows = executionRows
  const execItem = liveRows[page - 1]

  function buildResultBase(item, runtimeWarnings = []) {
    const row = item?.normalized || {}
    return {
      源行号: item?.sourceIndex || '',
      唯一键: row.row_key || '',
      站点: row.site_code || '',
      优惠工具: row.tool_label || '',
      促销名称: row.promotion_name || '',
      当前URL: location.href || row.create_url || '',
      执行状态: '',
      错误原因: '',
      预检警告: (item?.warnings || []).join(' | '),
      运行警告: mergeWarnings(runtimeWarnings).join(' | '),
      备注: row.note || '',
    }
  }

  function buildShared(ctx, extras = {}) {
    const merged = { ...(ctx?.shared || {}), ...extras }
    const runtimeWarnings = mergeWarnings(ctx?.shared?.runtime_warnings, extras.runtime_warnings)
    if (runtimeWarnings.length) {
      merged.runtime_warnings = runtimeWarnings
    } else {
      delete merged.runtime_warnings
    }
    return merged
  }

  function nextPhase(nextPhaseName, sleepMs = 1200, ctx, extras = {}) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'next_phase',
        next_phase: nextPhaseName,
        sleep_ms: sleepMs,
        shared: buildShared(ctx, extras),
      },
    }
  }

  function cdpPhase(clicks, nextPhaseName, sleepMs = 500, ctx, extras = {}) {
    return {
      success: true,
      data: [],
      meta: {
        action: 'cdp_clicks',
        clicks: clicks || [],
        next_phase: nextPhaseName,
        sleep_ms: sleepMs,
        shared: buildShared(ctx, extras),
      },
    }
  }

  function finishRow(ctx, error, extras = {}) {
    const runtimeWarnings = mergeWarnings(ctx?.shared?.runtime_warnings, extras.runtime_warnings)
    const result = buildResultBase(ctx.execItem, runtimeWarnings)
    result.当前URL = location.href || result.当前URL || ''
    result.执行状态 = error ? '失败' : '成功'
    result.错误原因 = error || ''
    return {
      success: true,
      data: [result],
      meta: {
        action: 'complete',
        has_more: page < liveRows.length,
        page,
        total: liveRows.length,
        shared: {},
      },
    }
  }

  function completeNoRow() {
    return {
      success: true,
      data: [],
      meta: {
        action: 'complete',
        has_more: false,
        page,
        total: liveRows.length,
        shared: {},
      },
    }
  }

  if (!liveRows.length) {
    return {
      success: false,
      error: '没有可执行行。请在 Vouchers sheet 至少填写一行。',
    }
  }

  if (!execItem) return completeNoRow()

  const ctx = {
    execItem,
    row: execItem.normalized,
    shared,
  }

  function isVisible(el) {
    if (!el) return false
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  function nodeDepth(el) {
    let depth = 0
    let cur = el
    while (cur?.parentElement) {
      depth += 1
      cur = cur.parentElement
    }
    return depth
  }

  function textMatches(text, pattern, exact = false) {
    const actual = norm(text).toLowerCase()
    if (!actual) return false
    if (pattern instanceof RegExp) return pattern.test(actual)
    const expected = norm(pattern).toLowerCase()
    if (!expected) return false
    return exact ? actual === expected : actual.includes(expected)
  }

  function smallestTextNode(pattern, root = document, options = {}) {
    const exact = !!options.exact
    const nodes = [...root.querySelectorAll('*')].filter(el => {
      if (!isVisible(el)) return false
      if (el === document.documentElement || el === document.body) return false
      const text = textOf(el)
      if (!textMatches(text, pattern, exact)) return false
      const childHasMatch = [...el.children].some(child => isVisible(child) && textMatches(textOf(child), pattern, exact))
      return !childHasMatch
    })
    nodes.sort((left, right) => {
      const textLen = textOf(left).length - textOf(right).length
      if (textLen !== 0) return textLen
      return nodeDepth(right) - nodeDepth(left)
    })
    return nodes[0] || null
  }

  function findClickableAncestor(el, stopRoot = document.body) {
    let cur = el
    while (cur && cur !== stopRoot && cur !== document.body?.parentElement) {
      const className = String(cur.className || '')
      const tag = String(cur.tagName || '').toLowerCase()
      const role = cur.getAttribute?.('role') || ''
      if (
        tag === 'button' ||
        tag === 'a' ||
        tag === 'label' ||
        tag === 'summary' ||
        role === 'button' ||
        cur.tabIndex >= 0 ||
        /(next-btn|next-radio|next-checkbox|next-select|next-menu|next-cascader|next-dialog-btn|card|trigger|option|switch)/i.test(className)
      ) {
        return cur
      }
      cur = cur.parentElement
    }
    return el
  }

  function clickElement(el) {
    if (!el) throw new Error('未找到可点击元素')
    el.scrollIntoView({ block: 'center', inline: 'center' })
    try { el.click() } catch {}
    ;['mousedown', 'mouseup', 'click'].forEach(type => {
      try {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
      } catch {}
    })
  }

  async function clickByText(pattern, root = document, options = {}) {
    const node = smallestTextNode(pattern, root, options)
    if (!node) throw new Error(`未找到文本：${pattern}`)
    const clickable = findClickableAncestor(node, root)
    clickElement(clickable)
    await sleep(options.sleepMs == null ? 120 : options.sleepMs)
    return clickable
  }

  function visibleTextInputs(root = document) {
    return [...root.querySelectorAll('input')]
      .filter(input => isVisible(input))
      .filter(input => input.type !== 'radio' && input.type !== 'checkbox' && input.type !== 'hidden')
  }

  function nativeSetInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    if (!setter) throw new Error('浏览器不支持原生 input.value setter')
    setter.call(input, String(value))
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.dispatchEvent(new Event('blur', { bubbles: true }))
  }

  function findFieldContainer(labelPattern, root = document) {
    const labelNode = smallestTextNode(labelPattern, root)
    if (!labelNode) return null
    return (
      labelNode.closest('.next-formily-item') ||
      labelNode.closest('.next-form-item') ||
      labelNode.closest('.next-box') ||
      labelNode.parentElement
    )
  }

  function findInputInField(labelPattern, root = document) {
    const container = findFieldContainer(labelPattern, root)
    if (!container) return null
    return visibleTextInputs(container)[0] || null
  }

  function findIMaskStateNode(input) {
    const key = Object.keys(input || {}).find(item => item.startsWith('__reactInternalInstance') || item.startsWith('__reactFiber'))
    let fiber = key ? input[key] : null
    while (fiber) {
      const name = fiber.elementType?.displayName || fiber.elementType?.name || fiber.type?.displayName || fiber.type?.name || ''
      if (/IMask/.test(name) && fiber.stateNode?.maskRef) return fiber.stateNode
      fiber = fiber.return
    }
    return null
  }

  async function setTextInput(input, value, verifyText = '') {
    if (!input) throw new Error('未找到输入框')
    input.scrollIntoView({ block: 'center', inline: 'center' })
    const textValue = norm(value).replace(/,/g, '')
    const imaskNode = findIMaskStateNode(input)
    if (imaskNode?.maskRef) {
      imaskNode.maskRef.unmaskedValue = textValue
    } else {
      nativeSetInputValue(input, value)
    }
    await sleep(80)
    const actual = norm(input.value)
    const expected = norm(verifyText || textValue)
    if (expected && actual !== expected) {
      if (!(actual.includes(expected) || expected.includes(actual))) {
        throw new Error(`输入回写校验失败：expected=${expected}, actual=${actual}`)
      }
    }
  }

  async function setInputByLabel(labelPattern, value) {
    if (value == null || norm(value) === '') return
    const input = findInputInField(labelPattern)
    if (!input) throw new Error(`未找到字段输入框：${labelPattern}`)
    await setTextInput(input, value)
  }

  function findComponentProps(node, componentName) {
    const key = Object.keys(node || {}).find(item => item.startsWith('__reactInternalInstance') || item.startsWith('__reactFiber'))
    let fiber = key ? node[key] : null
    while (fiber) {
      const name = fiber.elementType?.displayName || fiber.elementType?.name || fiber.type?.displayName || fiber.type?.name || ''
      if (name === componentName) return fiber.pendingProps || fiber.memoizedProps || null
      fiber = fiber.return
    }
    return null
  }

  async function setRangePicker(startPlaceholder, startAt, endAt) {
    if (!startAt || !endAt) throw new Error('RangePicker 缺少起止时间')
    const startInput = document.querySelector(`input[placeholder="${startPlaceholder}"]`)
    if (!startInput) throw new Error(`未找到 RangePicker 输入框：${startPlaceholder}`)
    const props = findComponentProps(startInput, 'RangePicker')
    if (!props?.onChange) throw new Error(`未找到 RangePicker onChange：${startPlaceholder}`)
    const startText = normalizeDateTimeInput(startAt)
    const endText = normalizeDateTimeInput(endAt)
    const m = window.moment
    if (typeof m !== 'function') throw new Error('页面未暴露 moment，无法回写日期组件')
    props.onChange([m(startText), m(endText)], [startText, endText])
    await sleep(150)
    const actualStart = normalizeDateTimeForCompare(document.querySelector(`input[placeholder="${startPlaceholder}"]`)?.value)
    const actualEnd = normalizeDateTimeForCompare(document.querySelector('input[placeholder="End Date"]')?.value)
    if (actualStart !== normalizeDateTimeForCompare(startText)) {
      throw new Error(`开始时间回写失败：expected=${startText}, actual=${actualStart}`)
    }
    if (actualEnd !== normalizeDateTimeForCompare(endText)) {
      throw new Error(`结束时间回写失败：expected=${endText}, actual=${actualEnd}`)
    }
  }

  async function setDatePicker(placeholder, value) {
    if (!value) return
    const input = document.querySelector(`input[placeholder="${placeholder}"]`)
    if (!input) throw new Error(`未找到 DatePicker 输入框：${placeholder}`)
    const props = findComponentProps(input, 'DatePicker')
    if (!props?.onChange) throw new Error(`未找到 DatePicker onChange：${placeholder}`)
    const text = normalizeDateTimeInput(value)
    const m = window.moment
    if (typeof m !== 'function') throw new Error('页面未暴露 moment，无法回写日期组件')
    props.onChange(m(text), text)
    await sleep(150)
    const actual = normalizeDateTimeForCompare(document.querySelector(`input[placeholder="${placeholder}"]`)?.value)
    if (actual !== normalizeDateTimeForCompare(text)) {
      throw new Error(`日期回写失败：expected=${text}, actual=${actual}`)
    }
  }

  function readMessages() {
    const selector = [
      '.next-message',
      '.next-notice',
      '.next-toast-notice',
      '.next-dialog-wrapper',
      '.next-overlay-wrapper',
      '.next-formily-item-help',
      '.next-form-item-help',
      '[class*="error"]',
      '[class*="success"]',
    ].join(',')
    const seen = new Set()
    const messages = []
    for (const el of [...document.querySelectorAll(selector)]) {
      if (!isVisible(el)) continue
      const text = textOf(el)
      if (!text || text.length > 400) continue
      if (seen.has(text)) continue
      seen.add(text)
      messages.push(text)
    }
    return messages
  }

  function submitButton() {
    const button = smallestTextNode('Submit', document, { exact: true })
    const clickable = button ? findClickableAncestor(button) : null
    return clickable && isVisible(clickable) ? clickable : null
  }

  function dialogConfirmButton() {
    const dialog = [...document.querySelectorAll('.next-dialog-wrapper, [role="dialog"], .next-overlay-wrapper')]
      .find(el => isVisible(el) && /submit|confirm|ok|yes/i.test(textOf(el)))
    if (!dialog) return null
    const texts = ['Submit', 'Confirm', 'OK', 'Yes']
    for (const text of texts) {
      const node = smallestTextNode(text, dialog, { exact: true })
      if (node) return findClickableAncestor(node, dialog)
    }
    return null
  }

  function newBuyerFeaturePopup() {
    if (ctx?.row?.tool_key !== 'STORE_NEW_BUYER_VOUCHER') return null
    return [...document.querySelectorAll('.next-dialog-wrapper, [role="dialog"], .next-overlay-wrapper')]
      .find(el => isVisible(el) && /One last step to feature your Store New Buyer Voucher/i.test(textOf(el))) || null
  }

  function dismissNewBuyerFeaturePopupSoon(delayMs = 30) {
    const dialog = newBuyerFeaturePopup()
    if (!dialog) return false
    const closeBtn = [...dialog.querySelectorAll('i, span, button, a, [role="button"]')]
      .find(el => {
        if (!isVisible(el)) return false
        const aria = String(el.getAttribute?.('aria-label') || '')
        const cls = String(el.className || '')
        return /close/i.test(aria) || /next-icon-close|close/.test(cls)
      }) || null
    if (!closeBtn) return false
    clickSoon(closeBtn, delayMs)
    return true
  }

  function coordOf(el) {
    const rect = el.getBoundingClientRect()
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    }
  }

  function navigateSoon(url, delayMs = 30) {
    const target = norm(url)
    if (!target) return false
    setTimeout(() => {
      try { location.href = target } catch {}
    }, delayMs)
    return true
  }

  function clickSoon(el, delayMs = 30) {
    if (!el) return false
    setTimeout(() => {
      try { el.click() } catch {}
      try {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
      } catch {}
    }, delayMs)
    return true
  }

  function findFiberProps(node, predicate) {
    const key = Object.keys(node || {}).find(item => item.startsWith('__reactInternalInstance') || item.startsWith('__reactFiber'))
    let fiber = key ? node[key] : null
    while (fiber) {
      const name = fiber.elementType?.displayName || fiber.elementType?.name || fiber.type?.displayName || fiber.type?.name || ''
      const props = fiber.pendingProps || fiber.memoizedProps || {}
      if (predicate(name, props, fiber)) return props
      fiber = fiber.return
    }
    return null
  }

  function reactClickSoon(el, delayMs = 30) {
    if (!el) return false
    const props = findFiberProps(el, (_name, fiberProps) => typeof fiberProps.onClick === 'function')
    if (!props?.onClick) return false
    setTimeout(() => {
      try {
        props.onClick({
          preventDefault() {},
          stopPropagation() {},
          target: el,
          currentTarget: el,
          nativeEvent: { target: el },
        })
      } catch {}
    }, delayMs)
    return true
  }

  function isDisabledElement(el) {
    if (!el) return true
    if (el.disabled) return true
    if (String(el.getAttribute?.('aria-disabled') || '').toLowerCase() === 'true') return true
    return /\bdisabled\b|next-disabled|btn-disabled|inactive/.test(String(el.className || '').toLowerCase())
  }

  function promotionRows() {
    return [...document.querySelectorAll('tr, [role="row"], .next-table-row')]
      .filter(el => isVisible(el))
      .filter(el => {
        const text = textOf(el)
        return /ID:\s*\d+/i.test(text) || /\b\d{8,}\b\s+From\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/i.test(text)
      })
  }

  function parsePromotionRow(rowEl) {
    const text = textOf(rowEl)
    const idMatch = text.match(/ID:\s*(\d+)/i) || text.match(/^(.*?)\s+(\d{8,})\s+From\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/i)
    const id = idMatch?.[1] && /^\d+$/.test(idMatch[1]) ? idMatch[1] : (idMatch?.[2] || '')
    const name = norm(
      (text.match(/^(.*?)\s+ID:\s*\d+/i) || [])[1] ||
      (text.match(/^(.*?)\s+\d{8,}\s+From\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/i) || [])[1]
    )
    const range = text.match(/From\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+To\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/i)
    const status = (
      text.match(/\b(Not Started|On-going|Ongoing|Suspended|Paused|Expired|Ended|Deactivated|Cancelled|Canceled|Inactive|Stopped|Closed|Finished|Terminated|Active)\b/i) || []
    )[1] || ''
    const actions = [...rowEl.querySelectorAll('button, a, [role="button"]')]
      .filter(el => isVisible(el))
      .map(el => textOf(el))
      .filter(Boolean)
    return {
      el: rowEl,
      text,
      id,
      name,
      start_at: range?.[1] || '',
      end_at: range?.[2] || '',
      status: norm(status),
      actions,
    }
  }

  function rowMatchesTool(rowInfo, row) {
    if (!rowInfo || !row) return false
    if (row.tool_key === 'FLEXI_COMBO') return true
    if (row.tool_key === 'REGULAR_VOUCHER') return /Regular Voucher/i.test(rowInfo.text)
    if (row.tool_key === 'STORE_NEW_BUYER_VOUCHER') return /Store New Buyer Voucher|Store New Buyer/i.test(rowInfo.text)
    if (row.tool_key === 'STORE_FOLLOWER_VOUCHER') return /Store Follower Voucher/i.test(rowInfo.text)
    return false
  }

  function rowAlreadyInactive(rowInfo) {
    if (!rowInfo) return false
    const actions = rowInfo.actions || []
    if (actions.includes('Activate')) return true
    if (!preferredConflictAction(rowInfo) && /\b(View|Duplicate)\b/i.test(actions.join(' '))) return true
    return /\b(Suspended|Paused|Expired|Ended|Deactivated|Cancelled|Canceled|Inactive|Stopped|Closed|Finished|Terminated)\b/i.test(rowInfo.status || rowInfo.text)
  }

  function preferredConflictAction(rowInfo) {
    const actions = rowInfo?.actions || []
    const priorities = ['Deactivate', 'End', 'Pause', 'Suspend', 'Delete', 'Remove', 'Cancel', 'Stop']
    return priorities.find(text => actions.includes(text)) || ''
  }

  function findRowActionButton(rowEl, texts) {
    const expected = (Array.isArray(texts) ? texts : [texts]).map(item => norm(item))
    return [...rowEl.querySelectorAll('button, a, [role="button"]')]
      .find(el => isVisible(el) && expected.includes(textOf(el))) || null
  }

  function listDialogButtons(texts) {
    const expected = (Array.isArray(texts) ? texts : [texts]).map(item => norm(item))
    const dialogs = [...document.querySelectorAll('.next-dialog-wrapper, [role="dialog"], .next-overlay-wrapper')]
      .filter(el => isVisible(el))
    const hits = []
    for (const dialog of dialogs) {
      const buttons = [...dialog.querySelectorAll('button, a, [role="button"]')]
        .filter(el => isVisible(el) && expected.includes(textOf(el)))
      for (const button of buttons) {
        const rect = button.getBoundingClientRect()
        hits.push({
          el: button,
          primary: /primary|ok/i.test(String(button.className || '')),
          top: rect.top,
          left: rect.left,
        })
      }
    }
    hits.sort((left, right) => {
      if (left.primary !== right.primary) return left.primary ? -1 : 1
      if (left.top !== right.top) return right.top - left.top
      return right.left - left.left
    })
    return hits.map(item => item.el)
  }

  function listSignature() {
    return promotionRows()
      .slice(0, 3)
      .map(el => textOf(el))
      .join(' || ')
  }

  async function waitForPromotionListReady(timeout = 10000) {
    const ready = await waitFor(() => {
      const rows = promotionRows()
      if (rows.length) return true
      const hasTable = document.querySelector('tbody, .next-table-body, .next-table')
      if (hasTable) return true
      return null
    }, timeout, 200)
    return !!ready
  }

  function nextListPageButton() {
    return [...document.querySelectorAll('button, a, [role="button"]')]
      .find(el => isVisible(el) && textOf(el) === 'Next') || null
  }

  async function moveToNextListPage() {
    const nextBtn = nextListPageButton()
    if (!nextBtn || isDisabledElement(nextBtn)) return false
    const before = listSignature()
    clickElement(nextBtn)
    await waitFor(async () => {
      const after = listSignature()
      if (after && after !== before) return true
      return null
    }, 8000, 200)
    await sleep(500)
    return true
  }

  function samePromotionName(left, right) {
    return norm(left).toLowerCase() === norm(right).toLowerCase()
  }

  function rowOverlapsCurrent(rowInfo, row) {
    const leftStart = parseDateTimeValue(rowInfo.start_at)
    const leftEnd = parseDateTimeValue(rowInfo.end_at)
    const rightStart = parseDateTimeValue(row.voucher_start_at)
    const rightEnd = parseDateTimeValue(row.voucher_end_at)
    return rangesOverlap(leftStart, leftEnd, rightStart, rightEnd)
  }

  function findSameNameOverlapOnCurrentPage(row) {
    return promotionRows()
      .map(parsePromotionRow)
      .find(info => {
        if (!rowMatchesTool(info, row)) return false
        if (rowAlreadyInactive(info)) return false
        if (!samePromotionName(info.name, row.promotion_name)) return false
        return rowOverlapsCurrent(info, row)
      }) || null
  }

  function findPromotionIdOnCurrentPage(promotionId) {
    return promotionRows()
      .map(parsePromotionRow)
      .find(info => info.id === String(promotionId)) || null
  }

  function buildConflictWarning(messages = [], rowInfo, verified) {
    const rawState = norm(verified?.latest?.status || verified?.state || rowInfo?.status || '')
    const stateText = rawState === 'row_gone'
      ? '已从列表消失'
      : (rawState || 'Suspended')
    const warnings = []
    if (messages.find(message => /\[CAMPAIGN_STATUS_NOT_VERIFIED\].*actual\s*:?\s*6\b/i.test(norm(message)))) {
      warnings.push(
        `冲突活动 ${rowInfo?.id || ''} 取消时返回状态校验提示 actual:6，但列表状态已更新为 ${stateText}，本次按“已成功停用/暂停”继续执行。`
      )
    }
    if (messages.find(message => /fail to lock distributeLocker|key has already exist|distributeLocker/i.test(norm(message)))) {
      warnings.push(
        `冲突活动 ${rowInfo?.id || ''} 停用时命中 distributeLocker 锁，通常表示同一活动的状态变更请求已在后端处理中；因列表状态已更新为 ${stateText}，本次按“已成功停用/暂停”继续执行。`
      )
    }
    return warnings
  }

  async function findConflictRowAcrossPages({ row, promotionId, maxPages = 20 }) {
    let scanned = 0
    while (scanned < maxPages) {
      await waitForPromotionListReady(8000)
      const info = promotionId
        ? findPromotionIdOnCurrentPage(promotionId)
        : findSameNameOverlapOnCurrentPage(row)
      if (info) return info
      const moved = await moveToNextListPage()
      if (!moved) break
      scanned += 1
    }
    return null
  }

  async function resolvePromotionConflictRow(rowInfo) {
    if (!rowInfo?.id) throw new Error('冲突活动缺少 promotion id')
    if (rowAlreadyInactive(rowInfo)) return { ok: true, reason: 'already_inactive', rowInfo }

    const actionText = preferredConflictAction(rowInfo)
    if (!actionText) throw new Error(`未找到可处理动作：${rowInfo.id}`)
    const actionBtn = findRowActionButton(rowInfo.el, actionText)
    if (!actionBtn) throw new Error(`未找到动作按钮：${rowInfo.id} / ${actionText}`)

    clickElement(actionBtn)
    await sleep(500)

    const confirmButtons = await waitFor(() => {
      const buttons = listDialogButtons([actionText, 'OK', 'Confirm', 'Yes'])
      return buttons.length ? buttons : null
    }, 5000, 150)

    if (confirmButtons?.length) {
      const firstButton = listDialogButtons([actionText, 'OK', 'Confirm', 'Yes'])[0]
      if (firstButton) {
        clickElement(firstButton)
        await sleep(1200)
      }
    }

    let verified = await waitFor(() => {
      const latest = findPromotionIdOnCurrentPage(rowInfo.id)
      if (!latest) return { ok: true, state: 'row_gone' }
      if (rowAlreadyInactive(latest)) return { ok: true, state: latest.status || 'inactive', latest }
      return null
    }, 10000, 250)

    const messages = readMessages()
    if (!verified && messages.find(message => /fail to lock distributeLocker|key has already exist|distributeLocker/i.test(norm(message)))) {
      await sleep(1800)
      const latest = findPromotionIdOnCurrentPage(rowInfo.id)
      if (!latest) {
        verified = { ok: true, state: 'row_gone' }
      } else if (rowAlreadyInactive(latest)) {
        verified = { ok: true, state: latest.status || 'inactive', latest }
      }
    }
    if (!verified) {
      const latest = findPromotionIdOnCurrentPage(rowInfo.id)
      throw new Error(
        `处理冲突活动失败：${rowInfo.id}；动作=${actionText}；最新状态=${latest?.status || '(未知)'}；消息=${messages.join(' | ') || '无明显反馈'}`
      )
    }
    return {
      ...verified,
      warnings: buildConflictWarning(messages, rowInfo, verified),
    }
  }

  function extractConflictPromotionId(messages = []) {
    const sources = [
      messages.join(' | '),
      textOf(document.body).slice(0, 12000),
    ]
    for (const source of sources) {
      const match = String(source || '').match(/another promotion\s+(\d+)\s+ongoing during this period/i)
      if (match) return match[1]
    }
    return ''
  }

  function nextConflictRetryState(sharedState, promotionId) {
    const previousId = norm(sharedState?.conflict_retry_id)
    const previousCount = Number(sharedState?.conflict_retry_count || 0)
    const count = previousId === norm(promotionId) ? previousCount + 1 : 1
    if (count > 4) throw new Error(`重复命中同一张冲突活动：${promotionId}`)
    return {
      conflict_retry_id: norm(promotionId),
      conflict_retry_count: count,
    }
  }

  function clearConflictRetryState() {
    return {
      conflict_retry_id: '',
      conflict_retry_count: 0,
      conflict_promotion_id: '',
    }
  }

  function listPageReady(row) {
    const href = location.href || ''
    if (row.tool_key === 'FLEXI_COMBO') return /\/apps\/promotion\/flexicombo\/list/.test(href)
    if (row.tool_key === 'STORE_NEW_BUYER_VOUCHER') return /\/apps\/promotion\/newBuyerVoucher\/list/.test(href) || /\/apps\/promotion\/voucher\/list/.test(href)
    return /\/apps\/promotion\/voucher\/list/.test(href)
  }

  function pageHeaderReady(row) {
    const title = norm(document.title)
    const body = norm(document.body?.innerText || '')
    if (row.tool_key === 'REGULAR_VOUCHER') return /regular voucher/i.test(title) || /Create Regular Voucher/i.test(body)
    if (row.tool_key === 'STORE_NEW_BUYER_VOUCHER') return /new buyer/i.test(title) || /Store New Buyer Voucher/i.test(body)
    if (row.tool_key === 'STORE_FOLLOWER_VOUCHER') return /follower/i.test(title) || /Store Follower Voucher/i.test(body)
    if (row.tool_key === 'FLEXI_COMBO') return /Flexi Combo/i.test(title) || /Flexi Combo/i.test(body)
    return false
  }

  async function fillVoucherPercentOffFixed(row) {
    await setInputByLabel(/Promotion Name/i, row.promotion_name)
    await setRangePicker('Start Date', row.voucher_start_at, row.voucher_end_at)
    if (row.collect_start_at) await setDatePicker('Select Date And Time', row.collect_start_at)
    await clickByText(/Entire Shop/i, document, { sleepMs: 80 })
    await clickByText(/Percentage Discount Off/i, document, { sleepMs: 180 })
    await setInputByLabel(/If Order Min\.Spend/i, row.min_spend_amount)
    await setInputByLabel(/Discount would be/i, row.discount_value)
    await setInputByLabel(/Maximum Discount per Order/i, row.max_discount_amount)
    await setInputByLabel(/Total Voucher to be Issued/i, row.total_issued)
    await setInputByLabel(/Voucher Limit per Customer/i, row.per_customer_limit)
  }

  function currentTierCards() {
    return [...document.querySelectorAll('.tier-card-item')].filter(el => isVisible(el))
  }

  async function syncFlexiTierCount(expectedCount) {
    if (!expectedCount || expectedCount < 1) throw new Error('Flexi Combo 至少需要 1 个阶梯')
    let cards = currentTierCards()
    let safety = 0
    while (cards.length < expectedCount && safety < 8) {
      await clickByText('Add Tier', document, { exact: true, sleepMs: 180 })
      cards = currentTierCards()
      safety += 1
    }
    if (cards.length < expectedCount) {
      throw new Error(`Flexi Combo Add Tier 失败，期望 ${expectedCount} 个阶梯，实际 ${cards.length}`)
    }
    return cards
  }

  async function fillFlexiPercentOff(row, tiers) {
    await setInputByLabel(/Promotion Name/i, row.promotion_name)
    await setRangePicker('Start Date', row.voucher_start_at, row.voucher_end_at)
    await clickByText(/Money\/Discount Off/i, document, { sleepMs: 120 })
    await clickByText(/Percentage Discount Off/i, document, { sleepMs: 180 })
    const criteriaText = row.flexi_criteria_type === 'ORDER_VALUE' ? /Order Value Reaches X/i : /Item Quantity Reaches X/i
    await clickByText(criteriaText, document, { sleepMs: 180 })
    await clickByText(/Entire Shop/i, document, { sleepMs: 80 })
    await setInputByLabel(/Total number of Flexi Combo Orders/i, row.total_flexi_orders)
    const cards = await syncFlexiTierCount(tiers.length)
    for (let index = 0; index < tiers.length; index += 1) {
      const tier = tiers[index]
      const card = cards[index]
      const inputs = visibleTextInputs(card)
      if (inputs.length < 2) throw new Error(`Tier ${index + 1} 输入框不足`)
      await setTextInput(inputs[0], tier.threshold_value)
      await setTextInput(inputs[1], tier.discount_value)
      await sleep(60)
    }
  }

  function isCreatePage(row) {
    const href = location.href || ''
    if (row.tool_key === 'FLEXI_COMBO') return /\/apps\/promotion\/flexicombo\/create/.test(href)
    return /\/apps\/voucher\/create/.test(href)
  }

  function successDetected(row, messages) {
    const href = location.href || ''
    const body = norm(document.body?.innerText || '')
    const msgText = messages.join(' | ')
    if (!isCreatePage(row)) return { ok: true, reason: 'url_changed' }
    if (row.tool_key === 'STORE_NEW_BUYER_VOUCHER' && /One last step to feature your Store New Buyer Voucher/i.test(body)) {
      return { ok: true, reason: 'new_buyer_feature_popup' }
    }
    if (/successfully|created successfully|success/i.test(msgText)) return { ok: true, reason: msgText || 'success_message' }
    if (/promotion created|created successfully|submit successfully/i.test(body)) return { ok: true, reason: 'body_success' }
    return { ok: false, reason: msgText }
  }

  try {
    if (execItem.issues.length) {
      return finishRow(ctx, `配置校验失败：${execItem.issues.join(' | ')}`)
    }
    const liveIssue = liveSupportIssue(ctx.row)
    if (liveIssue) {
      return finishRow(ctx, liveIssue)
    }

    if (phase === 'main') {
      return nextPhase('ensure_site_home', 0, ctx)
    }

    if (phase === 'ensure_site_home') {
      const target = ctx.row.home_url
      if (!target) return finishRow(ctx, '缺少 home_url')
      if (location.href !== target) {
        navigateSoon(target)
        return nextPhase('resolve_existing_promotions', 2200, ctx, { last_target_url: target })
      }
      return nextPhase('resolve_existing_promotions', 600, ctx)
    }

    if (phase === 'resolve_existing_promotions') {
      const target = ctx.row.list_url
      if (!target) return nextPhase('open_create_page', 0, ctx)
      if (location.href !== target) {
        navigateSoon(target)
        return nextPhase('resolve_existing_promotions', 2600, ctx, { last_target_url: target })
      }

      const listRetry = Number(shared.list_ready_retry || 0)
      if (!listPageReady(ctx.row)) {
        if (listRetry < 8) return nextPhase('resolve_existing_promotions', 800, ctx, { list_ready_retry: listRetry + 1 })
        return finishRow(ctx, '冲突列表页加载超时')
      }

      const exactConflictId = norm(shared.conflict_promotion_id)
      const cleanupCount = Number(shared.conflict_cleanup_count || 0)
      if (cleanupCount > 12) {
        return finishRow(ctx, '冲突清理次数过多，请检查是否存在无法自动处理的活动状态')
      }

      const conflictRow = await findConflictRowAcrossPages({
        row: ctx.row,
        promotionId: exactConflictId || '',
        maxPages: exactConflictId ? 20 : 5,
      })

      if (!conflictRow) {
        if (exactConflictId) {
          return finishRow(ctx, `未在列表页定位到冲突活动：${exactConflictId}`)
        }
        return nextPhase('open_create_page', 200, ctx, {
          list_ready_retry: 0,
          conflict_cleanup_count: cleanupCount,
          ...clearConflictRetryState(),
        })
      }

      if (rowAlreadyInactive(conflictRow)) {
        if (exactConflictId) {
          return nextPhase('open_create_page', 200, ctx, {
            list_ready_retry: 0,
            conflict_cleanup_count: cleanupCount + 1,
            post_submit_retry: 0,
            dialog_confirm_clicked: 0,
            submit_clicked: 0,
            ...clearConflictRetryState(),
          })
        }
        return nextPhase('resolve_existing_promotions', 600, ctx, {
          list_ready_retry: 0,
          conflict_cleanup_count: cleanupCount + 1,
        })
      }

      const conflictResolution = await resolvePromotionConflictRow(conflictRow)

      if (exactConflictId) {
        return nextPhase('open_create_page', 1200, ctx, {
          list_ready_retry: 0,
          conflict_cleanup_count: cleanupCount + 1,
          fill_retry: 0,
          post_submit_retry: 0,
          dialog_confirm_clicked: 0,
          submit_clicked: 0,
          runtime_warnings: conflictResolution?.warnings || [],
          ...clearConflictRetryState(),
        })
      }

      return nextPhase('resolve_existing_promotions', 1200, ctx, {
        list_ready_retry: 0,
        conflict_cleanup_count: cleanupCount + 1,
        runtime_warnings: conflictResolution?.warnings || [],
      })
    }

    if (phase === 'open_create_page') {
      const target = ctx.row.create_url
      if (!target) return finishRow(ctx, '缺少 create_url')
      if (location.href !== target) {
        navigateSoon(target)
        return nextPhase('fill_form', 2600, ctx, { last_target_url: target })
      }
      return nextPhase('fill_form', 800, ctx)
    }

    if (phase === 'fill_form') {
      const fillRetry = Number(shared.fill_retry || 0)
      if (!pageHeaderReady(ctx.row)) {
        if (fillRetry < 8) return nextPhase('fill_form', 800, ctx, { fill_retry: fillRetry + 1 })
        return finishRow(ctx, '创建页加载超时，未检测到目标表单')
      }

      if (ctx.row.tool_key === 'FLEXI_COMBO') {
        await fillFlexiPercentOff(ctx.row, execItem.tiers)
      } else {
        await fillVoucherPercentOffFixed(ctx.row)
      }
      return nextPhase('submit', 400, ctx)
    }

    if (phase === 'submit') {
      const button = submitButton()
      if (!button) return finishRow(ctx, '未找到 Submit 按钮')
      if (ctx.row.tool_key === 'FLEXI_COMBO') {
        if (reactClickSoon(button)) {
          return nextPhase('post_submit', 2200, ctx, {
            submit_clicked: Number(shared.submit_clicked || 0) + 1,
            submit_mode: 'react_onclick',
          })
        }
        return cdpPhase([{ ...coordOf(button), delay_ms: 180 }], 'post_submit', 1800, ctx, {
          submit_clicked: Number(shared.submit_clicked || 0) + 1,
          submit_mode: 'cdp_click',
        })
      }
      clickSoon(button)
      return nextPhase('post_submit', 1800, ctx, {
        submit_clicked: Number(shared.submit_clicked || 0) + 1,
      })
    }

    if (phase === 'post_submit') {
      const confirmBtn = dialogConfirmButton()
      if (confirmBtn && Number(shared.dialog_confirm_clicked || 0) < 2) {
        clickSoon(confirmBtn)
        return nextPhase('post_submit', 1500, ctx, {
          dialog_confirm_clicked: Number(shared.dialog_confirm_clicked || 0) + 1,
        })
      }

      const messages = readMessages()
      const successState = successDetected(ctx.row, messages)
      if (successState.ok) {
        if (newBuyerFeaturePopup() && !Number(shared.new_buyer_popup_dismissed || 0)) {
          if (dismissNewBuyerFeaturePopupSoon()) {
            return nextPhase('post_submit', 1200, ctx, { new_buyer_popup_dismissed: 1 })
          }
        }
        return finishRow(ctx)
      }

      const conflictPromotionId = extractConflictPromotionId(messages)
      if (conflictPromotionId) {
        const retryState = nextConflictRetryState(shared, conflictPromotionId)
        return nextPhase('resolve_existing_promotions', 200, ctx, {
          conflict_promotion_id: conflictPromotionId,
          conflict_cleanup_count: Number(shared.conflict_cleanup_count || 0),
          post_submit_retry: 0,
          dialog_confirm_clicked: 0,
          ...retryState,
        })
      }

      const tries = Number(shared.post_submit_retry || 0)
      if (messages.length && /error|failed|duplicate|already exists|required|invalid|exceed|must/i.test(messages.join(' '))) {
        return finishRow(ctx, messages.join(' | '))
      }
      if (tries < 8) {
        return nextPhase('post_submit', 1000, ctx, { post_submit_retry: tries + 1 })
      }
      return finishRow(ctx, `提交后未检测到成功信号；最近消息：${messages.join(' | ') || '无明显反馈'}`)
    }

    return finishRow(ctx, `未知 phase: ${phase}`)
  } catch (error) {
    return finishRow(ctx, error?.message || String(error))
  }
})()
