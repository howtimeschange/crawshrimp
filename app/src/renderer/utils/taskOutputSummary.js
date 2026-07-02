function cleanPath(value) {
  return String(value || '').trim()
}

function isImagePath(path) {
  return /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(cleanPath(path))
}

function isTablePath(path) {
  return /\.(xlsx|xlsm|xls|csv)$/i.test(cleanPath(path))
}

function isDirectoryLike(path) {
  const value = cleanPath(path)
  if (!value) return false
  const basename = value.split(/[\\/]/).pop() || ''
  return !/\.[^./\\]+$/.test(basename)
}

function buildLabel(summary) {
  if (!summary.total) return '暂无输出文件'
  const parts = []
  if (summary.tables) parts.push(`表格 ${summary.tables} 个`)
  if (summary.images) parts.push(`图片 ${summary.images} 张`)
  if (summary.directories) parts.push(`目录 ${summary.directories} 个`)
  if (summary.others) parts.push(`其他 ${summary.others} 个`)
  return parts.join(' / ')
}

export function summarizeOutputFiles(files = []) {
  const summary = {
    total: 0,
    tables: 0,
    images: 0,
    directories: 0,
    others: 0,
    label: '',
  }

  for (const item of files || []) {
    const path = cleanPath(item)
    if (!path) continue
    summary.total += 1
    if (isTablePath(path)) summary.tables += 1
    else if (isImagePath(path)) summary.images += 1
    else if (isDirectoryLike(path)) summary.directories += 1
    else summary.others += 1
  }

  summary.label = buildLabel(summary)
  return summary
}
