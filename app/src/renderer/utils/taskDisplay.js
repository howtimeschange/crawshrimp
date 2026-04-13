const TEMU_TASK_NAME_MAP = Object.freeze({
  reviews: '商城-店铺评价',
  store_items: '商城-站点商品',
  goods_data: '后台-商品数据',
  aftersales: '后台-售后数据',
  compliant_live_photos_label: '后台-洗唛图批量上传',
})

const TEMU_TASK_ORDER = Object.freeze([
  'reviews',
  'store_items',
  'goods_data',
  'aftersales',
  'goods_traffic_list',
  'goods_traffic_detail',
  'bill_center',
  'activity_data',
  'mall_flux',
  'compliant_live_photos_label',
])

const TEMU_TASK_ORDER_INDEX = new Map(TEMU_TASK_ORDER.map((taskId, index) => [taskId, index]))

export function formatTaskForDisplay(task) {
  if (!task || task.adapter_id !== 'temu') return task
  const taskName = TEMU_TASK_NAME_MAP[task.task_id] || task.task_name
  return taskName === task.task_name ? task : { ...task, task_name: taskName }
}

export function formatTasksForDisplay(adapterId, tasks = []) {
  const normalized = tasks.map(task => formatTaskForDisplay({ ...task, adapter_id: task.adapter_id || adapterId }))
  if (adapterId !== 'temu') return normalized

  return normalized
    .map((task, index) => ({ task, index }))
    .sort((a, b) => {
      const aOrder = TEMU_TASK_ORDER_INDEX.get(a.task.task_id)
      const bOrder = TEMU_TASK_ORDER_INDEX.get(b.task.task_id)
      if (aOrder != null && bOrder != null) return aOrder - bOrder
      if (aOrder != null) return -1
      if (bOrder != null) return 1
      return a.index - b.index
    })
    .map(item => item.task)
}
