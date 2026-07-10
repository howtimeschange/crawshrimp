import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createCanvasDocument,
  insertImageNode,
  selectedNodesAsReferences,
} from './aiImageCanvas.js'

test('create canvas document starts with viewport and empty nodes', () => {
  const document = createCanvasDocument({ title: '主图画布', jobUid: 'job-1' })

  assert.equal(document.version, 1)
  assert.equal(document.title, '主图画布')
  assert.equal(document.job_uid, 'job-1')
  assert.deepEqual(document.nodes, [])
  assert.deepEqual(document.viewport, { x: 0, y: 0, zoom: 1 })
})

test('insert image node appends stable positioned image node', () => {
  const first = createCanvasDocument()
  const next = insertImageNode(first, {
    path: '/tmp/out.png',
    label: '结果 1',
    source: 'result',
  })

  assert.notEqual(next, first)
  assert.equal(next.nodes.length, 1)
  assert.equal(next.nodes[0].type, 'image')
  assert.equal(next.nodes[0].path, '/tmp/out.png')
  assert.equal(next.nodes[0].label, '结果 1')
  assert.equal(next.nodes[0].source, 'result')
  assert.deepEqual(next.nodes[0].size, { width: 240, height: 240 })
})

test('selected nodes become sorted local reference paths only', () => {
  const document = {
    nodes: [
      { id: 'b', type: 'image', path: '/tmp/b.png', selected: true, role: 'reference', x: 200 },
      { id: 'a', type: 'image', path: '/tmp/a.png', selected: true, role: 'main', x: 100 },
      { id: 'c', type: 'note', path: '/tmp/c.png', selected: true, x: 0 },
      { id: 'd', type: 'image', url: 'https://example.com/d.png', selected: true, x: 50 },
      { id: 'e', type: 'image', path: '/tmp/e.png', selected: false, x: 10 },
    ],
  }

  assert.deepEqual(selectedNodesAsReferences(document), ['/tmp/a.png', '/tmp/b.png'])
})
