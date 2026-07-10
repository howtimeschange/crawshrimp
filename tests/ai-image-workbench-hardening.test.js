const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')

const workbench = fs.readFileSync('app/src/renderer/views/AiImageWorkbench.vue', 'utf8')
const promptPicker = fs.readFileSync('app/src/renderer/components/PromptLibraryPickerModal.vue', 'utf8')

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}`)
  const end = source.indexOf(`function ${nextName}`, start + 1)
  assert.ok(start >= 0, `${name} missing`)
  assert.ok(end > start, `${nextName} missing after ${name}`)
  return source.slice(start, end)
}

test('advanced JSON validates inline and blocks single or batch submission instead of silently dropping input', () => {
  assert.match(workbench, /import \{ parseAdvancedJsonConfig \} from '\.\.\/utils\/aiImageAdvancedJson\.mjs'/)
  assert.match(workbench, /const advancedJsonError = computed/)
  assert.match(workbench, /:aria-invalid="advancedJsonError \? 'true' : 'false'"/)
  assert.match(workbench, /aria-describedby="aiw-advanced-json-error"/)
  assert.match(workbench, /id="aiw-advanced-json-error"[\s\S]*role="alert"/)
  assert.match(workbench, /watch\(advancedJsonError, \(error, previousError\) => \{[\s\S]*if \(!error && previousError && errorMessage\.value === previousError\) errorMessage\.value = ''/)
  assert.match(functionBody(workbench, 'generate', 'normalizeGenerateError'), /assertAdvancedJsonValid\(\)/)
  assert.match(functionBody(workbench, 'submitBatchGeneration', 'generate'), /assertAdvancedJsonValid\(\)/)
  assert.doesNotMatch(functionBody(workbench, 'generate', 'normalizeGenerateError'), /silentAdvanced:\s*true/)
})

test('failed queue cards expose retry context and preserve operator recovery actions', () => {
  assert.match(workbench, /retrySummaryText/)
  assert.match(workbench, /generationFailureMessage/)
  assert.match(workbench, /retryFailedRun\(item\)/)
  assert.match(workbench, /copyFailedPrompt\(item\)/)
  assert.match(workbench, /restoreFailedRunInputs\(item\)/)
  assert.match(workbench, /重试本队列/)
  assert.match(workbench, /复制 Prompt/)
  assert.match(workbench, /打开参数/)
  assert.match(functionBody(workbench, 'retryFailedRun', 'copyFailedPrompt'), /window\.cs\.retryAiImageRun\(jobUid, runUid\)/)
  assert.match(functionBody(workbench, 'retryFailedRun', 'copyFailedPrompt'), /startJobPolling\(jobUid\)/)
})

test('Prompt library converts infrastructure failures into operator-facing recovery copy', () => {
  assert.match(promptPicker, /import \{ promptLibraryFailureMessage \} from '\.\.\/utils\/aiImageOperatorMessages\.mjs'/)
  assert.match(promptPicker, /const operatorError = computed/)
  assert.match(promptPicker, /role="alert"/)
  assert.match(promptPicker, /刷新重试/)
  assert.match(promptPicker, /operatorError/)
})
