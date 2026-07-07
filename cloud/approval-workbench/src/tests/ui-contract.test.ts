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
    for (const label of ['账号', '任务机', 'Prompt', '审批批次', '数据看板']) {
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
})
