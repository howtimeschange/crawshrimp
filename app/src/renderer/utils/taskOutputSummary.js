function cleanPath(value) {
  return String(value || '').trim()
}

function isImagePath(path) {
  return /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(cleanPath(path))
}

function isHttpUrl(path) {
  return /^https?:\/\//i.test(cleanPath(path))
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

function fileName(path) {
  return String(path || '').split('/').pop().split('\\').pop() || '输出文件'
}

function parentDirectory(path) {
  const value = cleanPath(path).replace(/[\\/]+$/g, '')
  const index = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
  return index > 0 ? value.slice(0, index) : ''
}

function isDirectoryBoundary(prefix, directory) {
  return directory === prefix || directory.startsWith(`${prefix}/`) || directory.startsWith(`${prefix}\\`)
}

function commonParentDirectory(paths = []) {
  const directories = paths
    .map(parentDirectory)
    .filter(Boolean)
  if (!directories.length) return ''
  let common = directories[0]
  for (const directory of directories.slice(1)) {
    while (common && !isDirectoryBoundary(common, directory)) {
      const index = Math.max(common.lastIndexOf('/'), common.lastIndexOf('\\'))
      if (index <= 0) {
        common = ''
        break
      }
      common = common.slice(0, index)
    }
  }
  return common || directories[0] || ''
}

function buildOutputFileEntry(path) {
  const clean = cleanPath(path)
  const directory = isDirectoryLike(clean)
  return {
    kind: directory ? 'directory' : isTablePath(clean) ? 'table' : isImagePath(clean) ? 'image' : 'other',
    path: clean,
    label: directory ? clean : fileName(clean),
    detail: '',
    actionLabel: directory ? '打开文件夹' : '打开',
    count: 1,
  }
}

export function buildOutputFileEntries(files = []) {
  const displayEntries = []
  const imagePaths = []
  let imagePlaceholderAdded = false

  for (const item of files || []) {
    const path = cleanPath(item)
    if (!path) continue
    if (isImagePath(path) && !isHttpUrl(path)) {
      imagePaths.push(path)
      if (!imagePlaceholderAdded) {
        displayEntries.push({ kind: '__image_folder_placeholder__' })
        imagePlaceholderAdded = true
      }
      continue
    }
    displayEntries.push(buildOutputFileEntry(path))
  }

  const imageDirectory = commonParentDirectory(imagePaths)
  if (!imagePaths.length || !imageDirectory) {
    return displayEntries
      .filter(entry => entry.kind !== '__image_folder_placeholder__')
      .concat(imagePaths.map(buildOutputFileEntry))
  }

  const imageFolderEntry = {
    kind: 'image_directory',
    path: imageDirectory,
    label: `图片文件夹（${imagePaths.length} 张）`,
    detail: imageDirectory,
    actionLabel: '打开文件夹',
    count: imagePaths.length,
  }

  return displayEntries.map(entry =>
    entry.kind === '__image_folder_placeholder__' ? imageFolderEntry : entry
  )
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
