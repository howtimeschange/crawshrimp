const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync('app/src/renderer/views/AiImageWorkbench.vue', 'utf8')
function handler(name) {
  const tail = source.slice(source.search(new RegExp(`(?:async )?function ${name}\\(`)))
  return tail.slice(0, tail.indexOf('\n}\n') + 2)
}

test('drag relocation preserves other image order, roles, metadata and serialized numbering', async () => {
  const { reorderImageInput, sortDestination } = await import('../app/src/renderer/utils/aiImageDrag.mjs')
  const { serializeInputs } = await import('../app/src/renderer/utils/aiImageInputs.mjs')
  const metadata = { 'main:a': { name: 'original.jpg', sha256: 'hash' } }
  const state = { mainImagePaths: ['a', 'b', 'c', 'd'], referenceImagePaths: ['r1', 'r2'], inputAssetDetails: metadata }
  reorderImageInput(state, 'main', 0, sortDestination(0, 3, true))
  assert.deepEqual(state.mainImagePaths, ['b', 'c', 'd', 'a'])
  assert.equal(state.mainImagePath, 'b')
  reorderImageInput(state, 'main', 3, sortDestination(3, 0, false))
  reorderImageInput(state, 'reference', 1, 0)
  const payload = serializeInputs(state)
  assert.deepEqual(payload.input_assets.map(a => [a.path, a.role]), [['a','main'], ['b','main'], ['c','main'], ['d','main'], ['r2','reference'], ['r1','reference']])
  assert.equal(payload.input_assets[0].name, 'original.jpg')
  assert.equal(state.inputAssetDetails, metadata)
  reorderImageInput(state, 'main', -1, 0)
  assert.deepEqual(state.mainImagePaths, ['a','b','c','d'])
})

test('drop feedback respects main limit and shared total capacity', async () => {
  const { inputDropCapacity } = await import('../app/src/renderer/utils/aiImageDrag.mjs')
  const state = { mainImagePaths: ['a','b','c','d'], referenceImagePaths: ['r1'] }
  assert.equal(inputDropCapacity(state, 'main').remaining, 2)
  assert.equal(inputDropCapacity(state, 'reference').remaining, 5)
  state.referenceImagePaths = Array(6).fill('r')
  assert.equal(inputDropCapacity(state, 'main').remaining, 0)
  assert.equal(inputDropCapacity(state, 'reference').remaining, 0)
})

test('sort drags never import, Files show upload feedback, child leave keeps highlight', async () => {
  const { INPUT_SORT_MIME, inputDropCapacity, isInputSortTransfer } = await import('../app/src/renderer/utils/aiImageDrag.mjs')
  const imports = []
  const context = vm.createContext({ inputDropCapacity, isInputSortTransfer,
    dragOverTarget: { value: '' }, draggingResultKey: { value: '' }, inputImportBusy: { value: false },
    form: { mainImagePaths: ['a'], referenceImagePaths: [] }, batchGenerationDialog: {},
    importInputSelection: (...args) => imports.push(args),
  })
  vm.runInContext(['handleResultDragOver','clearDragOver','handleExternalImageDrop'].map(handler).join('\n'), context)
  const child = {}
  const zone = { dataset: { inputRole: 'main' }, contains: value => value === child }
  const event = { currentTarget: zone, dataTransfer: { types: ['Files'], files: [{ name: 'shirt.png' }] } }
  context.handleResultDragOver(event)
  assert.equal(context.dragOverTarget.value, 'main')
  assert.equal(event.dataTransfer.dropEffect, 'copy')
  context.clearDragOver({ currentTarget: zone, relatedTarget: child }, 'main')
  assert.equal(context.dragOverTarget.value, 'main')
  await context.handleExternalImageDrop(event, 'main')
  assert.equal(imports.length, 1)
  assert.equal(context.dragOverTarget.value, '')
  event.dataTransfer.types = [INPUT_SORT_MIME, 'Files']
  context.handleResultDragOver(event)
  assert.equal(event.dataTransfer.dropEffect, 'none')
  await context.handleExternalImageDrop(event, 'main')
  assert.equal(imports.length, 1)
  event.dataTransfer.types = ['text/plain']
  context.handleResultDragOver(event)
  assert.equal(context.dragOverTarget.value, '')
})

test('material row handlers place images at insertion boundary and reject other lists or malformed payloads', async () => {
  const drag = await import('../app/src/renderer/utils/aiImageDrag.mjs')
  const component = fs.readFileSync('app/src/renderer/components/AiImageMaterialList.vue', 'utf8')
  const logic = component.slice(component.indexOf('function clearSort()'), component.indexOf('watch(() => props.disabled'))
  const emitted = []
  const context = vm.createContext({ ...drag, listId: 'list-a',
    draggingPath: { value: '' }, targetPath: { value: '' }, insertAfter: { value: false },
    props: { items: [{ path: 'a' }, { path: 'b' }, { path: 'c' }], disabled: false },
    emit: (...args) => emitted.push(args),
  })
  vm.runInContext(logic, context)
  const data = new Map()
  const transfer = { types: [drag.INPUT_SORT_MIME], setData: (k,v) => data.set(k,v), getData: k => data.get(k) }
  const event = { dataTransfer: transfer, target: {}, clientX: 90,
    currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 100 }) }, preventDefault() {}, stopPropagation() {} }
  context.startSort(event, { path: 'a' })
  context.hoverSort(event, { path: 'c' })
  assert.equal(context.insertAfter.value, true)
  assert.equal(transfer.dropEffect, 'move')
  context.finishSort(event, { path: 'c' }, 2)
  assert.deepEqual(emitted, [['reorder', 0, 2]])
  assert.equal(context.draggingPath.value, '')
  data.set(drag.INPUT_SORT_MIME, JSON.stringify({ listId: 'other-list', path: 'a' }))
  context.finishSort(event, { path: 'c' }, 2)
  data.set(drag.INPUT_SORT_MIME, 'malformed')
  assert.doesNotThrow(() => context.finishSort(event, { path: 'c' }, 2))
  assert.equal(emitted.length, 1)
})
