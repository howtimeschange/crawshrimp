import test from 'node:test'
import assert from 'node:assert/strict'

import { summarizePrecheckRows } from './precheckSummary.js'

test('summarizePrecheckRows accepts dasen plan rows with execution result text', () => {
  const result = summarizePrecheckRows([
    { 表格行号: 2, 执行结果: '预检通过', 备注: '预检通过，无需上传本地文件' },
    { 表格行号: 3, 执行结果: '预检通过', 备注: '预检通过，live 模式将上传 2 个本地文件' },
  ])

  assert.deepEqual(result, {
    pass: true,
    summary: '2 行可直接执行',
  })
})

test('summarizePrecheckRows blocks invalid execution result rows', () => {
  const result = summarizePrecheckRows([
    { 表格行号: 2, 执行结果: '预检通过' },
    { 表格行号: 3, 执行结果: '预检失败', 备注: '案例名称必填' },
  ])

  assert.deepEqual(result, {
    pass: false,
    summary: '1 行可直接执行，1 行配置有误',
  })
})

test('summarizePrecheckRows blocks unrecognized precheck files', () => {
  const result = summarizePrecheckRows([
    { 表格行号: 2, 执行结果: '已完成' },
  ])

  assert.deepEqual(result, {
    pass: false,
    summary: '1 行未识别预检状态',
  })
})
