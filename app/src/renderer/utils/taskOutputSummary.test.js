import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeOutputFiles } from './taskOutputSummary.js'

test('summarizeOutputFiles groups tables images directories and other files', () => {
  const summary = summarizeOutputFiles([
    '/tmp/result.xlsx',
    '/tmp/source/a.jpg',
    '/tmp/generated/b.png',
    '/tmp/export-folder',
    '/tmp/readme.txt',
  ])

  assert.equal(summary.total, 5)
  assert.equal(summary.tables, 1)
  assert.equal(summary.images, 2)
  assert.equal(summary.directories, 1)
  assert.equal(summary.others, 1)
  assert.equal(summary.label, '表格 1 个 / 图片 2 张 / 目录 1 个 / 其他 1 个')
})

test('summarizeOutputFiles returns empty label for no output files', () => {
  const summary = summarizeOutputFiles([])

  assert.equal(summary.total, 0)
  assert.equal(summary.label, '暂无输出文件')
})
