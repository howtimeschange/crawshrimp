import { mainPaths, MAX_MAIN_IMAGE_COUNT, MAX_IMAGE_INPUT_COUNT } from './aiImageInputs.mjs'

export const INPUT_SORT_MIME = 'application/x-crawshrimp-input-sort'
export function isInputSortTransfer(transfer) { return Array.from(transfer?.types || []).includes(INPUT_SORT_MIME) }
export function inputDropCapacity(state, role) {
  const mains = mainPaths(state).length
  const references = (state.referenceImagePaths || []).length
  const total = mains + references
  const remaining = Math.max(0, Math.min(MAX_IMAGE_INPUT_COUNT - total, role === 'main' ? MAX_MAIN_IMAGE_COUNT - mains : MAX_IMAGE_INPUT_COUNT))
  return { mains, references, total, remaining, limit: role === 'main' ? MAX_MAIN_IMAGE_COUNT : MAX_IMAGE_INPUT_COUNT,
    label: role === 'main' ? '主图' : '参考图', count: role === 'main' ? mains : references }
}
export function reorderImageInput(state, role, fromIndex, toIndex) {
  const paths = role === 'main' ? mainPaths(state) : [...(state.referenceImagePaths || [])]
  if (![fromIndex, toIndex].every(i => Number.isInteger(i) && i >= 0 && i < paths.length) || fromIndex === toIndex) return
  paths.splice(toIndex, 0, paths.splice(fromIndex, 1)[0])
  if (role === 'main') Object.assign(state, { mainImagePaths: paths, mainImagePath: paths[0] || '' })
  else state.referenceImagePaths = paths
}
export function sortDestination(fromIndex, rowIndex, after) {
  const insertion = rowIndex + (after ? 1 : 0)
  return insertion > fromIndex ? insertion - 1 : insertion
}
