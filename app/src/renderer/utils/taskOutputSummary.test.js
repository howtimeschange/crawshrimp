import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOutputFileEntries, summarizeOutputFiles } from './taskOutputSummary.js'

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

test('buildOutputFileEntries collapses local image outputs into one folder entry', () => {
  const entries = buildOutputFileEntries([
    '/tmp/vipshop/result.xlsx',
    '/tmp/vipshop/run_77/201326108015/a.jpg',
    '/tmp/vipshop/run_77/201326108015/b.png',
    '/tmp/vipshop/run_77/200326108106/c.webp',
  ])

  assert.equal(entries.length, 2)
  assert.equal(entries[0].kind, 'table')
  assert.equal(entries[0].label, 'result.xlsx')
  assert.equal(entries[1].kind, 'image_directory')
  assert.equal(entries[1].path, '/tmp/vipshop/run_77')
  assert.equal(entries[1].label, '图片文件夹（3 张）')
  assert.equal(entries[1].actionLabel, '打开文件夹')
})

test('buildOutputFileEntries keeps remote image URLs as direct output files', () => {
  const entries = buildOutputFileEntries([
    'https://example.com/assets/a.jpg',
    '/tmp/vipshop/run_77/201326108015/a.jpg',
  ])

  assert.equal(entries.length, 2)
  assert.equal(entries[0].kind, 'image')
  assert.equal(entries[0].path, 'https://example.com/assets/a.jpg')
  assert.equal(entries[1].kind, 'image_directory')
  assert.equal(entries[1].path, '/tmp/vipshop/run_77/201326108015')
})
