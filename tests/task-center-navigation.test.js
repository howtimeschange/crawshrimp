import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('App navigation replaces market with task center', () => {
  const app = fs.readFileSync('app/src/renderer/App.vue', 'utf8')
  assert.match(app, /label: '任务中心'/)
  assert.match(app, /id: 'task_center'/)
  assert.doesNotMatch(app, /label: '抓虾市场'/)
})

test('TaskCenter exposes AI image task creation copy', () => {
  const view = fs.readFileSync('app/src/renderer/views/TaskCenter.vue', 'utf8')
  assert.match(view, /新增 AI 测图任务/)
  assert.match(view, /新增数据抓取定时任务/)
  assert.match(view, /定时任务/)
  assert.match(view, /每天/)
  assert.match(view, /每周/)
  assert.match(view, /钉钉消息模板/)
  assert.match(view, /runTaskScheduleNow/)
  assert.match(view, /当前任务/)
  assert.match(view, /待处理/)
  assert.match(view, /历史任务/)
})

test('Electron and dev bridge expose task schedule APIs', () => {
  const preload = fs.readFileSync('app/src/preload.js', 'utf8')
  const devBridge = fs.readFileSync('app/src/renderer/utils/devCsBridge.js', 'utf8')

  for (const source of [preload, devBridge]) {
    assert.match(source, /listTaskSchedules/)
    assert.match(source, /createTaskSchedule/)
    assert.match(source, /updateTaskSchedule/)
    assert.match(source, /deleteTaskSchedule/)
    assert.match(source, /runTaskScheduleNow/)
  }
})

test('TaskRunner reads output files from task instance artifacts in instance mode', () => {
  const view = fs.readFileSync('app/src/renderer/views/TaskRunner.vue', 'utf8')
  assert.match(view, /const isInstanceMode = computed/)
  assert.match(view, /window\.cs\.getTaskInstance\(props\.instanceUid\)/)
  assert.match(view, /detail\?\.artifacts/)
  assert.match(view, /detail\?\.summary\?\.approval_board_url/)
})
