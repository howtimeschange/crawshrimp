/**
 * Backup snapshot for verified Shopee+ V2 date injection methods.
 *
 * Verified on live pages:
 * - Normal voucher usecases 1 / 3 / 4: React DatePicker onChange injection
 * - Follow-prize usecase 999: legacy Vue handler injection
 *
 * These functions are intentionally kept as a rollback reference.
 * They depend on helpers that exist in voucher-create.js:
 *   sleep, getFormItem, readDateRangeValues, sameDateTime
 */

async function setDateRangeJS(startDt, endDt) {
  const container = document.querySelector('.date-range-picker-container, .date-range-picker, .date-range-picker-container.date-picker')
  if (!container) throw new Error('未找到关注礼日期组件')

  let vueInst = container.__vue__ || container.__vueParentComponent
  if (!vueInst?.ctx?.handleStartChange) {
    const vueEl = [...document.querySelectorAll('*')].find(el => el.__vue__?.ctx?.handleStartChange)
    vueInst = vueEl?.__vue__ || vueEl?.__vueParentComponent
  }
  if (!vueInst?.ctx?.handleStartChange) throw new Error('未找到关注礼日期处理器')

  const ctx = vueInst.ctx
  const toLocalString = dt => dt ? `${dt.y}-${dt.mo}-${dt.d} ${dt.hh}:${dt.mm}:00` : null

  if (startDt) {
    ctx.handleStartChange(toLocalString(startDt))
    await sleep(250)
  }
  if (endDt) {
    ctx.handleEndChange(toLocalString(endDt))
    await sleep(250)
  }
  try { ctx.validate?.() } catch {}
  try { document.body.click() } catch {}
  await sleep(200)

  const item = getFormItem(['优惠券领取期限', 'Claim Period']) || container
  const values = readDateRangeValues(item)
  if (startDt && !sameDateTime(values.start, startDt)) {
    throw new Error(`开始日期回读失败，期望：${startDt.str}，实际：${values.start || '(空)'}`)
  }
  if (endDt && !sameDateTime(values.end, endDt)) {
    throw new Error(`结束日期回读失败，期望：${endDt.str}，实际：${values.end || '(空)'}`)
  }
  return true
}

function findDatePickerProps(root) {
  if (!root) return null
  const fiberKey = Object.keys(root).find(key => key.startsWith('__reactFiber'))
  let fiber = fiberKey ? root[fiberKey] : null
  for (let i = 0; fiber && i < 18; i += 1) {
    const props = fiber.memoizedProps || null
    if (props?.onChange && Object.prototype.hasOwnProperty.call(props, 'value')) {
      return props
    }
    fiber = fiber.return
  }
  return null
}

function dateRootForKind(item, kind) {
  return (
    item?.querySelector(kind === 'start' ? '#startDate' : '#endDate') ||
    item?.querySelector(`.picker-item.${kind}-picker .eds-react-date-picker__input`) ||
    item?.querySelector(`.picker-item.${kind}-picker .eds-date-picker`) ||
    null
  )
}

function toBrowserDate(dt) {
  if (!dt) return null
  return new Date(dt.year, dt.month - 1, dt.day, Number(dt.hh), Number(dt.mm), 0, 0)
}

async function setReactDateRange(startDt, endDt, item) {
  const applyOne = async (kind, dt) => {
    if (!dt) return
    const root = dateRootForKind(item, kind)
    if (!root) throw new Error(`未找到${kind === 'start' ? '开始' : '结束'}日期根节点`)
    const props = findDatePickerProps(root)
    if (!props?.onChange) throw new Error(`未找到${kind === 'start' ? '开始' : '结束'}日期注入处理器`)
    props.onChange(toBrowserDate(dt), dt.str)
    await sleep(300)
  }

  if (startDt) await applyOne('start', startDt)
  if (endDt) await applyOne('end', endDt)
  await sleep(200)

  const values = readDateRangeValues(item)
  if (startDt && !sameDateTime(values.start, startDt)) {
    throw new Error(`开始日期回读失败，期望：${startDt.str}，实际：${values.start || '(空)'}`)
  }
  if (endDt && !sameDateTime(values.end, endDt)) {
    throw new Error(`结束日期回读失败，期望：${endDt.str}，实际：${values.end || '(空)'}`)
  }
  return true
}
