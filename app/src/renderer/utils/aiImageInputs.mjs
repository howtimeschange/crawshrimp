export const MAX_IMAGE_INPUT_BYTES = 20 * 1024 * 1024
export const MAX_IMAGE_INPUT_COUNT = 10
export const MAX_MAIN_IMAGE_COUNT = 6

export function mainPaths(state = {}) {
  return Array.isArray(state.mainImagePaths) ? [...state.mainImagePaths] : state.mainImagePath ? [state.mainImagePath] : []
}
export function assertImageFiles(files) {
  for (const file of files) {
    if (Number(file.size) > MAX_IMAGE_INPUT_BYTES) throw new Error(`${file.name || '图片'}：${(file.size / 1024 / 1024).toFixed(2)} MB，超过单张 20 MB 上限`)
  }
}
export function assertImageInputCount(main, references = []) {
  const mains = Array.isArray(main) ? main.filter(Boolean) : main ? [main] : []
  const count = mains.length + references.filter(Boolean).length
  if (count > MAX_IMAGE_INPUT_COUNT) throw new Error(`主图和参考图共 ${count} 张，最多支持 10 张，请减少后重试`)
  if (mains.length > MAX_MAIN_IMAGE_COUNT) throw new Error('主体素材最多支持 6 张，请减少后重试')
}
export function mergeImageInputs(current, target, paths) {
  const incoming = [...new Set(paths.filter(Boolean))]
  const mainImagePaths = target === 'main' ? [...new Set([...mainPaths(current), ...incoming])] : mainPaths(current)
  const referenceImagePaths = target === 'reference' ? [...new Set([...(current.referenceImagePaths || []), ...incoming])] : [...(current.referenceImagePaths || [])]
  assertImageInputCount(mainImagePaths, referenceImagePaths)
  return { mainImagePaths, mainImagePath: mainImagePaths[0] || '', referenceImagePaths }
}
export function materialKey(role, path) { return `${role}:${path}` }
export function inputAssetsForState(state = {}) {
  return [['main', mainPaths(state)], ['reference', state.referenceImagePaths || []]].flatMap(([role, paths]) => paths.map(path => {
    const meta = state.inputAssetDetails?.[materialKey(role, path)] || {}
    const fields = ['id', 'name', 'size', 'mime', 'sha256', 'source', 'imported_at']
    return { ...Object.fromEntries(fields.filter(key => meta[key] !== undefined).map(key => [key, meta[key]])), id: meta.id || materialKey(role, path), path, role }
  }))
}
export function inputStateFromParams(params = {}) {
  let assets = params.input_assets
  if (!Array.isArray(assets)) {
    const mains = Array.isArray(params.main_image_paths) ? params.main_image_paths : params.main_image_path ? [params.main_image_path] : []
    assets = [...mains.map(path => ({ path, role: 'main' })), ...(params.reference_image_paths || []).map(path => ({ path, role: 'reference' }))]
  }
  const mainImagePaths = assets.filter(a => a.role === 'main').map(a => a.path)
  return { mainImagePaths, mainImagePath: mainImagePaths[0] || '',
    referenceImagePaths: assets.filter(a => a.role === 'reference').map(a => a.path),
    inputAssetDetails: Object.fromEntries(assets.map(a => [materialKey(a.role, a.path), { ...a }])) }
}
export function serializeInputs(state) {
  return { main_image_path: mainPaths(state)[0] || '', main_image_paths: mainPaths(state),
    reference_image_paths: [...(state.referenceImagePaths || [])], input_assets: inputAssetsForState(state) }
}
export function moveInput(state, role, index, offset) {
  const paths = role === 'main' ? mainPaths(state) : [...state.referenceImagePaths]
  const target = index + offset
  if (target < 0 || target >= paths.length) return
  ;[paths[index], paths[target]] = [paths[target], paths[index]]
  if (role === 'main') Object.assign(state, { mainImagePaths: paths, mainImagePath: paths[0] || '' })
  else state.referenceImagePaths = paths
}
