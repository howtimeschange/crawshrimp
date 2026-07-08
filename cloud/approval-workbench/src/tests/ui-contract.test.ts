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
  })

  it('machine page includes one-time token warning', () => {
    const machines = read('src/app/views/MachinesView.vue')
    expect(machines).toContain('只展示一次')
    expect(machines).toContain('注册 token')
  })

  it('batch review has approve reject regenerate and submit actions', () => {
    const review = read('src/app/views/BatchReviewView.vue')
    for (const text of ['确认', '舍弃', '一键重生图', '提交创建测图任务']) {
      expect(review).toContain(text)
    }
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

  it('admin user role saves require loaded role data instead of defaulting existing users to viewer', () => {
    const adminUsers = read('src/app/views/AdminUsersView.vue')
    expect(adminUsers).toContain('function loadedRoleKey')
    expect(adminUsers).toContain(':disabled="!canAssignRole(user)"')
    expect(adminUsers).toContain('角色未加载，禁止覆盖保存')
    expect(adminUsers).not.toMatch(/users\.value\.map\(\(user\) => \[user\.id, 'viewer'\]\)/)
  })
})
