export function gridWindow({ count, width, minWidth = 180, rowHeight = 250, gap = 12, scrollTop = 0, height = 560, overscan = 2, singleColumn = false }) {
  const columns = singleColumn ? 1 : Math.max(1, Math.floor((width + gap) / (minWidth + gap)))
  const rows = Math.ceil(count / columns)
  const stride = rowHeight + gap
  const firstRow = Math.max(0, Math.min(Math.max(0, rows - 1), Math.floor(scrollTop / stride) - overscan))
  const lastRow = Math.min(rows, Math.ceil((scrollTop + height) / stride) + overscan)
  return { columns, start: firstRow * columns, end: Math.min(count, lastRow * columns), top: firstRow * stride, total: Math.max(0, rows * stride - gap) }
}
