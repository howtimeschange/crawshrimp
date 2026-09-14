const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { MAX_IMAGE_INPUT_BYTES, assertImageInputSize, importImageInput } = require('../app/src/aiImageInputFiles')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64')

test('file and clipboard import preserve bytes and persist after original is moved', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'image-input-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'shirt.png'); fs.writeFileSync(source, png)
  const options = { dataDir: root, canDecode: bytes => bytes.equals(png) }
  const file = importImageInput({ path: source }, options)
  const pasted = importImageInput({ name: 'clipboard.png', bytes: new Uint8Array(png) }, options)
  fs.unlinkSync(source)
  assert.deepEqual(fs.readFileSync(file.path), png)
  assert.deepEqual(fs.readFileSync(pasted.path), png)
  assert.equal(importImageInput({ name: 'clipboard.png', bytes: png }, options).path, pasted.path)
})

test('20 MB boundary, oversized files, bad image data and empty files are rejected before storage', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'image-input-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  assert.doesNotThrow(() => assertImageInputSize(MAX_IMAGE_INPUT_BYTES, 'exact.png'))
  assert.throws(() => assertImageInputSize(MAX_IMAGE_INPUT_BYTES + 1, 'large.png'), /large.png.*20 MB/)
  const large = path.join(root, 'large.png'); fs.writeFileSync(large, ''); fs.truncateSync(large, MAX_IMAGE_INPUT_BYTES + 1)
  let decoded = false
  const options = { dataDir: root, canDecode: () => { decoded = true; return false } }
  assert.throws(() => importImageInput({ path: large }, options), /large.png.*20 MB/)
  assert.equal(decoded, false)
  assert.throws(() => importImageInput({ bytes: Buffer.from('<svg/>') }, options), /仅支持/)
  assert.throws(() => importImageInput({ bytes: png }, options), /损坏/)
  assert.throws(() => importImageInput({ bytes: Buffer.alloc(0) }, options), /为空/)
  assert.equal(fs.existsSync(path.join(root, 'ai-image-inputs')), false)
})

test('reference count limit is atomic and includes main image; duplicates do not consume extra slots', async () => {
  const { mergeImageInputs, assertImageFiles } = await import('../app/src/renderer/utils/aiImageInputs.mjs')
  const state = { mainImagePath: 'main.png', referenceImagePaths: Array.from({ length: 8 }, (_, i) => `${i}.png`) }
  assert.equal(mergeImageInputs(state, 'reference', ['8.png', '8.png']).referenceImagePaths.length, 9)
  assert.throws(() => mergeImageInputs(state, 'reference', ['8.png', '9.png']), /共 11 张/)
  assert.equal(state.referenceImagePaths.length, 8)
  assert.equal(mergeImageInputs({ mainImagePaths: [], referenceImagePaths: [] }, 'main', ['a.png', 'b.png']).mainImagePaths.length, 2)
  assert.throws(() => assertImageFiles([{ name: 'large.png', size: MAX_IMAGE_INPUT_BYTES + 1 }], 'reference'), /large.png.*20 MB/)
})

// Exercise the actual Vue handlers with browser/Electron boundaries stubbed.
const vm = require('node:vm')
const workbench = fs.readFileSync('app/src/renderer/views/AiImageWorkbench.vue', 'utf8')
function handler(name) {
  const start = workbench.search(new RegExp(`(?:async )?function ${name}\\(`))
  assert.notEqual(start, -1)
  const tail = workbench.slice(start)
  const end = tail.indexOf('\n}\n')
  return tail.slice(0, end + 2)
}

test('Finder drop and clipboard File use atomic import and keep inputs on validation failure', async () => {
  const { mergeImageInputs, assertImageFiles, materialKey, mainPaths } = await import('../app/src/renderer/utils/aiImageInputs.mjs')
  const { inputDropCapacity, isInputSortTransfer } = await import('../app/src/renderer/utils/aiImageDrag.mjs')
  const form = { mainImagePath: 'original.png', referenceImagePaths: [] }
  const errors = []; const imports = []
  const context = vm.createContext({ form, mergeImageInputs, assertImageFiles, materialKey, mainPaths, inputDropCapacity, isInputSortTransfer, Uint8Array,
    dragOverTarget: { value: '' }, inputImportTarget: { value: '' }, announceStatus() {},
    inputImportIssues: { value: [] }, pathLabel: value => value.split('/').pop(),
    activeJobUid: { value: 'task-a' }, inputImportBusy: { value: false }, batchGenerationDialog: {},
    window: { cs: {
      getLocalImageFilePath: file => file.nativePath || '',
      importAiImageInput: async input => { imports.push(input); return { path: input.path || 'clipboard.png' } },
    } },
    inputImportError: error => errors.push(error.message), clearGenerateError() {}, async refreshImagePreview() {},
  })
  vm.runInContext(['inputMeta', 'importInputSelection', 'handleExternalImageDrop', 'handleInputPaste'].map(handler).join('\n'), context)
  await context.handleExternalImageDrop({ dataTransfer: { files: [{ name: 'Finder.png', size: 200, nativePath: '/Finder.png' }] } }, 'reference')
  assert.deepEqual(Array.from(form.referenceImagePaths), ['/Finder.png'])
  assert.equal(imports[0].path, '/Finder.png')
  await context.importInputSelection('reference', [{ name: 'pasted.png', size: 100, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.length) }])
  assert.equal(imports[1].bytes.byteLength, png.length)
  assert.deepEqual(Array.from(form.referenceImagePaths), ['/Finder.png', 'clipboard.png'])
  await context.importInputSelection('main', [{ name: 'oversize.png', size: MAX_IMAGE_INPUT_BYTES + 1 }])
  assert.equal(form.mainImagePath, 'original.png')
  assert.equal(imports.length, 2)
  assert.match(errors[0], /20 MB/)
  let prevented = false
  context.handleInputPaste({ clipboardData: { files: [] }, preventDefault: () => { prevented = true } }, 'reference')
  assert.equal(prevented, false, 'ordinary prompt text paste must remain untouched')
})

test('submission keeps current inputs and later edits while retaining inactive task inputs', () => {
  const drafts = {}; let persisted = 0
  const current = { prompt: 'edited while submitting', mainImagePath: 'main.png', referenceImagePaths: ['ref.png'] }
  const context = vm.createContext({ activeJobUid: { value: 'a' }, taskDrafts: drafts,
    formSnapshot: () => structuredClone(current), persistWorkbenchState: () => { persisted++ },
  })
  vm.runInContext(handler('saveDraftForCurrentTask') + '\n' + handler('retainSubmittedTaskInputs'), context)
  context.retainSubmittedTaskInputs({ prompt: 'old prompt', mainImagePath: 'old.png' }, 'a')
  assert.equal(drafts.a.prompt, current.prompt)
  assert.equal(drafts.a.mainImagePath, current.mainImagePath)
  assert.deepEqual(drafts.a.referenceImagePaths, ['ref.png'])
  context.retainSubmittedTaskInputs({ prompt: 'other task', mainImagePath: 'b.png' }, 'b')
  assert.equal(drafts.b.prompt, 'other task')
  assert.equal(drafts.b.submittedInputsCleared, false)
  assert.equal(drafts.a.prompt, current.prompt)
  assert.equal(persisted, 2)
})

test('legacy cleared drafts recover server inputs, while intentional empty new drafts stay empty', () => {
  const job = { job_uid: 'a', prompt: 'submitted prompt', params: { main_image_path: 'main.png', reference_image_paths: ['ref.png'] } }
  const drafts = { a: { submittedInputsCleared: true, prompt: '', mainImagePath: '', referenceImagePaths: [] } }
  const context = vm.createContext({ taskDrafts: drafts, hasGeneratedResults: () => true })
  vm.runInContext(handler('mergeJobWithDraft'), context)
  const recovered = context.mergeJobWithDraft(job, { includeGeneratedDrafts: true })
  assert.equal(recovered.prompt, 'submitted prompt')
  assert.equal(recovered.params.main_image_path, 'main.png')
  assert.deepEqual(recovered.params.reference_image_paths, ['ref.png'])
  drafts.a.submittedInputsCleared = false
  const intentionallyCleared = context.mergeJobWithDraft(job, { includeGeneratedDrafts: true })
  assert.equal(intentionallyCleared.prompt, '')
  assert.equal(intentionallyCleared.params.main_image_path, '')
  assert.deepEqual(intentionallyCleared.params.reference_image_paths, [])
})

test('ordered main/reference snapshots keep metadata, never infer product group or mode', async () => {
  const { mergeImageInputs, moveInput, serializeInputs, inputStateFromParams } = await import('../app/src/renderer/utils/aiImageInputs.mjs')
  const state = { mainImagePaths: ['a','b'], referenceImagePaths: ['c'], inputMode: 'composition', inputAssetDetails: { 'main:a': { name:'a.png', sha256:'hash-a', group:'invented', purpose:'invented' } } }
  moveInput(state, 'main', 0, 1)
  const snapshot = serializeInputs(state)
  assert.deepEqual(snapshot.input_assets.map(x => [x.path, x.role]), [['b','main'],['a','main'],['c','reference']])
  assert.equal(snapshot.input_assets[1].sha256, 'hash-a')
  assert.equal('group' in snapshot.input_assets[1], false)
  assert.equal('input_mode' in snapshot, false)
  const restored = inputStateFromParams(snapshot)
  state.mainImagePaths.reverse()
  assert.deepEqual(restored.mainImagePaths, ['b','a'])
  assert.equal(restored.mainImagePath, 'b')
  assert.throws(() => mergeImageInputs({ mainImagePaths: Array.from({length:6}, (_,i)=>String(i)) }, 'main', ['extra']), /6 张/)
})

test('main and reference directories persist independently, cancel and missing directories do not replace them', t => {
  const { imageInputDirectory, rememberImageInputDirectory } = require('../app/src/aiImageInputFiles')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'image-directory-test-'))
  t.after(() => fs.rmSync(root, {recursive:true, force:true}))
  for (const role of ['main','reference']) {
    fs.mkdirSync(path.join(root, role)); fs.writeFileSync(path.join(root,role,'a.png'),png)
    rememberImageInputDirectory(root, role, path.join(root,role,'a.png'))
  }
  rememberImageInputDirectory(root, 'main', '')
  rememberImageInputDirectory(root, 'main', '/missing/no-file.png')
  assert.equal(imageInputDirectory(root,'main'),path.join(root,'main'))
  assert.equal(imageInputDirectory(root,'reference'),path.join(root,'reference'))
  fs.rmSync(path.join(root,'main'),{recursive:true})
  assert.equal(imageInputDirectory(root,'main'),undefined)
  assert.equal(imageInputDirectory(root,'reference'),path.join(root,'reference'))
})
