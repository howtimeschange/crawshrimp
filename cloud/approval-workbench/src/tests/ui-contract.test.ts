import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

function read(path: string): string {
  return fs.readFileSync(path, 'utf8')
}

describe('cloud approval UI contract', () => {
  it('does not expose public registration copy', () => {
    const login = read('src/app/views/LoginView.vue')
    expect(login).toContain('不开放自助注册')
    expect(login).not.toMatch(/sign up|create account|立即注册|免费注册/i)
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

  it('machine page hides AI generation capability labels from the cloud approval UI', () => {
    const machines = read('src/app/views/MachinesView.vue')
    expect(machines).toContain('visibleCapabilities')
    expect(machines).not.toContain('AI 生图')
  })

  it('batch review has approve reject regenerate and submit actions', () => {
    const review = read('src/app/views/BatchReviewView.vue')
    for (const text of ['确认通过', '标记舍弃', '重跑本批全部舍弃图', '提交创建测图任务']) {
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

  it('batch review supports prompt-library selection for rerun without exposing style-level generation', () => {
    const review = read('src/app/views/BatchReviewView.vue')
    for (const marker of ['promptLibraries', 'promptTemplates', 'selectedPromptTemplateKey', 'applySelectedPromptTemplate']) {
      expect(review).toContain(marker)
    }
    expect(review).toContain('Prompt 重跑')
    expect(review).toContain('重跑已选舍弃图')
    expect(review).not.toContain('给当前款式新增 AI 图')
    expect(review).not.toContain('style-generation-panel')
    expect(review).not.toContain('createStyleGenerationJobs')
    expect(review).not.toContain("applySelectedPromptTemplate('generate')")
  })

  it('batch review reloads resolved prompt templates when the selected style changes', () => {
    const review = read('src/app/views/BatchReviewView.vue')
    const styleWatcher = review.match(/watch\(selectedStyleId,[\s\S]*?\n\}\)/)?.[0] ?? ''
    expect(styleWatcher).toContain('loadPromptTemplates')
    expect(review).toContain("params.set('style_code'")
    expect(review).toContain("params.set('item_id'")
  })

  it('prompt library defaults to display mode and gates editing by prompts write permission', () => {
    const prompts = read('src/app/views/PromptLibraryView.vue')
    expect(prompts).toContain('canEditPrompts')
    expect(prompts).toContain('prompts:write')
    expect(prompts).toContain('Prompt 明细')
    expect(prompts).toContain('编辑 Prompt')
    expect(prompts).toContain('只读权限')
    for (const hiddenHeader of ['<th>字段 ID</th>', '<th>顺序</th>', '<th>视图</th>', '<th>尺寸</th>', '<th>格式</th>', '<th>引用字段</th>', '<th>字数</th>', '<th>类型</th>']) {
      expect(prompts).not.toContain(hiddenHeader)
    }
  })

  it('prompt library separates library management from prompt row editing', () => {
    const prompts = read('src/app/views/PromptLibraryView.vue')
    for (const marker of [
      '库管理',
      'Prompt 明细',
      'libraryDraft',
      'creatingLibrary',
      'saveLibraryMeta',
      '保存库信息',
      '发布新版本',
    ]) {
      expect(prompts).toContain(marker)
    }
    expect(prompts).toContain("apiPatch(`/api/prompt-libraries/${selectedLibrary.value.id}`")
    expect(prompts).toContain('编辑 Prompt')
    expect(prompts).not.toContain('编辑 Prompt 库')
  })

  it('prompt library inserts newly-added prompts at the top of the visible list', () => {
    const prompts = read('src/app/views/PromptLibraryView.vue')
    const addRowBody = prompts.match(/function addRow\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(addRowBody).toContain('templates.unshift')
    expect(addRowBody).toContain("groupFilter.value !== 'all'")
    expect(addRowBody).not.toContain('templates.push')
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

  it('cloud approval frontend hides the immature AI generation page and entry points', () => {
    const app = read('src/app/App.vue')
    expect(app).not.toContain("label: 'AI 生图'")
    expect(app).not.toContain("key: 'generate'")
    expect(app).not.toContain('OnlineGenerationView')
    expect(app).not.toContain("activePage === 'generate'")
  })

  it('material data dashboard explains cumulative snapshots and exposes an integrated report view', () => {
    const materialData = read('src/app/views/MaterialDataDashboardView.vue')
    for (const text of ['最新累计快照', '已合并重复/跨日期快照', '统计日期', '按款式汇总', '素材表现明细']) {
      expect(materialData).toContain(text)
    }
    expect(materialData).toContain('styleReports')
    expect(materialData).toContain('formatStatisticDate')
    expect(materialData).toContain('summary?.latest_statistic_date')
    expect(materialData).not.toContain('<th>款号</th>\\n            <th>商品ID</th>')
  })

  it('admin user role saves require loaded role data instead of defaulting existing users to viewer', () => {
    const adminUsers = read('src/app/views/AdminUsersView.vue')
    expect(adminUsers).toContain('function loadedRoleKey')
    expect(adminUsers).toContain(':disabled="!canAssignRole(user)"')
    expect(adminUsers).toContain('角色未加载，禁止覆盖保存')
    expect(adminUsers).not.toMatch(/users\.value\.map\(\(user\) => \[user\.id, 'viewer'\]\)/)
  })
})
