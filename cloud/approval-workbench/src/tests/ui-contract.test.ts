import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

function read(path: string): string {
  return fs.readFileSync(path, 'utf8')
}

describe('cloud approval UI contract', () => {
  it('does not expose public registration copy', () => {
    const login = read('src/app/views/LoginView.vue')
    expect(login).not.toMatch(/注册|sign up|create account/i)
    expect(login).toMatch(/登录/)
  })

  it('has pages for machines prompts batches dashboard and admin users', () => {
    const app = read('src/app/App.vue')
    for (const label of ['账号', '任务机', 'Prompt 库', '审批批次', '总览']) {
      expect(app).toContain(label)
    }
    expect(app).not.toContain("label: '批次审图'")
  })

  it('machine page includes one-time token warning', () => {
    const machines = read('src/app/views/MachinesView.vue')
    expect(machines).toContain('只展示一次')
    expect(machines).toContain('注册 token')
  })

  it('batch review has approve reject regenerate and submit actions', () => {
    const review = read('src/app/views/BatchReviewView.vue')
    for (const text of ['确认通过', '标记舍弃', '批量重跑舍弃图', '提交创建测图任务']) {
      expect(review).toContain(text)
    }
    for (const vagueText of ['所选重生图', '一键重生图', '换 Prompt 重跑']) {
      expect(review).not.toContain(vagueText)
    }
  })

  it('batch review is an image-review workbench instead of another batch list table', () => {
    const review = read('src/app/views/BatchReviewView.vue')
    for (const marker of ['review-workbench', 'review-batch-summary', 'style-nav-panel', 'review-gallery', 'review-inspector']) {
      expect(review).toContain(marker)
    }
    expect(review).not.toContain('class="data-table"')
    expect(review).not.toContain('review-loadbar')
    expect(review).not.toContain('批次 UID')
    expect(review).not.toContain('加载批次')
  })

  it('batch list exposes Beijing time and image previews before entering review', () => {
    const list = read('src/app/views/BatchListView.vue')
    expect(list).toContain('formatBeijingTime')
    expect(list).toContain('batch-preview-strip')
    expect(list).toContain('assetDownloadUrl')
    expect(list).not.toContain('{{ batch.created_at }}')
    expect(list).not.toContain('{{ batch.updated_at }}')
  })

  it('batch review keeps task-machine submit at batch level with per-style validation copy', () => {
    const review = read('src/app/views/BatchReviewView.vue')
    expect(review).toContain('batch-submit-panel')
    expect(review).toContain('submitValidationMessage')
    expect(review).toContain('每个款式至少确认 1 张 AI 图后才能提交')
    expect(review).not.toContain('class="submit-panel"')
  })

  it('batch submit does not require the reviewer-only mark-ready endpoint first', () => {
    const review = read('src/app/views/BatchReviewView.vue')
    const submitJobBody = review.match(/async function submitJob\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(submitJobBody).toContain('/submit')
    expect(submitJobBody).not.toContain('/mark-ready')
    expect(review).toContain('async function markReady()')
  })

  it('batch review supports prompt-library selection for rerun and style-level generation', () => {
    const review = read('src/app/views/BatchReviewView.vue')
    for (const marker of ['promptLibraries', 'promptTemplates', 'selectedPromptTemplateKey', 'applySelectedPromptTemplate']) {
      expect(review).toContain(marker)
    }
    expect(review).toContain('给当前款式新增 AI 图')
    expect(review).toContain('从 Prompt 库选择')
    expect(review).toContain('批量重跑选中图')
  })

  it('batch review reloads resolved prompt templates when the selected style changes', () => {
    const review = read('src/app/views/BatchReviewView.vue')
    const styleWatcher = review.match(/watch\(selectedStyleId,[\s\S]*?\n\}\)/)?.[0] ?? ''
    expect(styleWatcher).toContain('loadPromptTemplates')
    expect(review).toContain("params.set('style_code'")
    expect(review).toContain("params.set('item_id'")
  })

  it('opens batch review from batch_uid query links', () => {
    const app = read('src/app/App.vue')
    expect(app).toContain('new URLSearchParams(window.location.search)')
    expect(app).toContain("'batch_uid'")
    expect(app).toContain("activePage.value = 'review'")
    expect(app).toContain('selectedBatchUid.value = directBatchUid')
  })

  it('uses embed-aware top tabs instead of an internal sidebar', () => {
    const app = read('src/app/App.vue')
    expect(app).toContain('URLSearchParams')
    expect(app).toContain('embed')
    expect(app).toContain('top-tabs')
    expect(app).not.toContain('side-nav')
  })

  it('online generation uses the option-3 workbench shell instead of a batch-list side form', () => {
    const generate = read('src/app/views/OnlineGenerationView.vue')
    for (const marker of [
      'cloud-aiw-param-ribbon',
      'cloud-aiw-prompt-panel',
      'cloud-aiw-results-grid',
      'cloud-aiw-history-drawer',
      'cloud-aiw-generate-footer',
    ]) {
      expect(generate).toContain(marker)
    }
    expect(generate).toContain('支持主图、参考图、Prompt、自定义尺寸和多模型生成')
    expect(generate).not.toContain('split-grid')
    expect(generate).not.toContain('class="data-table"')
    expect(generate).not.toContain('form-panel')
  })

  it('online generation submits the extended cloud generation contract', () => {
    const generate = read('src/app/views/OnlineGenerationView.vue')
    const submitGenerationBody = generate.match(/async function submitGeneration\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
    for (const field of [
      'style_id',
      'source_asset_uid',
      'reference_asset_uids',
      'prompt_template_version_id',
      'prompt_text',
      'machine_id',
      'model',
      'size',
      'quality',
      'output_format',
      'count',
    ]) {
      expect(submitGenerationBody).toContain(field)
    }
    for (const option of [
      'gpt-image-2',
      'gemini-3.1-flash-image-preview',
      'gemini-3-pro-image-preview',
      '4096x4096',
      '4K',
      'webp',
    ]) {
      expect(generate).toContain(option)
    }
  })

  it('online generation clears stale prompt text when no resolved template is available', () => {
    const generate = read('src/app/views/OnlineGenerationView.vue')
    expect(generate).toContain("promptText.value = data.templates[0]?.prompt_text ?? ''")
    expect(generate).toContain("promptText.value = template?.prompt_text ?? ''")

    const clearCount = generate.match(/promptText\.value = ''/g)?.length ?? 0
    expect(clearCount).toBeGreaterThanOrEqual(2)
  })

  it('online generation discards stale resolved prompt responses before mutating prompt state', () => {
    const generate = read('src/app/views/OnlineGenerationView.vue')
    const loadResolvedPromptsBody = generate.match(/async function loadResolvedPrompts\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''

    expect(generate).toContain('let promptLoadSequence = 0')
    expect(loadResolvedPromptsBody).toContain('const requestSequence = ++promptLoadSequence')
    expect(loadResolvedPromptsBody).toContain('const requestSignature = currentPromptRequestSignature()')
    expect(loadResolvedPromptsBody).toContain('isCurrentPromptRequest(requestSequence, requestSignature)')

    const staleGuardIndex = loadResolvedPromptsBody.indexOf('isCurrentPromptRequest(requestSequence, requestSignature)')
    const templateMutationIndex = loadResolvedPromptsBody.indexOf('promptTemplates.value = data.templates')
    expect(staleGuardIndex).toBeGreaterThanOrEqual(0)
    expect(templateMutationIndex).toBeGreaterThan(staleGuardIndex)
  })

  it('admin user role saves require loaded role data instead of defaulting existing users to viewer', () => {
    const adminUsers = read('src/app/views/AdminUsersView.vue')
    expect(adminUsers).toContain('function loadedRoleKey')
    expect(adminUsers).toContain(':disabled="!canAssignRole(user)"')
    expect(adminUsers).toContain('角色未加载，禁止覆盖保存')
    expect(adminUsers).not.toMatch(/users\.value\.map\(\(user\) => \[user\.id, 'viewer'\]\)/)
  })
})
