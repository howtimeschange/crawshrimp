'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

const { configureSingleInstance } = require('./singleInstance')

test('second desktop instance quits before registering service focus handling', () => {
  const app = new EventEmitter()
  let quits = 0
  app.requestSingleInstanceLock = () => false
  app.quit = () => { quits += 1 }

  const primary = configureSingleInstance({ app, getWindow: () => null, createWindow: () => {} })

  assert.equal(primary, false)
  assert.equal(quits, 1)
  assert.equal(app.listenerCount('second-instance'), 0)
})

test('primary setup is never registered by the secondary instance', () => {
  const secondary = new EventEmitter()
  secondary.requestSingleInstanceLock = () => false
  secondary.quit = () => {}
  let secondarySetups = 0

  configureSingleInstance({
    app: secondary,
    onPrimary: () => { secondarySetups += 1 },
  })

  const primary = new EventEmitter()
  primary.requestSingleInstanceLock = () => true
  let primarySetups = 0
  configureSingleInstance({
    app: primary,
    onPrimary: () => { primarySetups += 1 },
  })

  assert.equal(secondarySetups, 0)
  assert.equal(primarySetups, 1)
})

test('primary desktop instance restores and focuses its window on a second launch', () => {
  const app = new EventEmitter()
  app.requestSingleInstanceLock = () => true
  app.quit = () => assert.fail('primary instance must not quit')
  const events = []
  const win = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: () => events.push('restore'),
    show: () => events.push('show'),
    focus: () => events.push('focus'),
  }

  const primary = configureSingleInstance({ app, getWindow: () => win, createWindow: () => events.push('create') })
  app.emit('second-instance')

  assert.equal(primary, true)
  assert.deepEqual(events, ['restore', 'show', 'focus'])
})

test('primary desktop instance recreates a missing window on a second launch', () => {
  const app = new EventEmitter()
  app.requestSingleInstanceLock = () => true
  app.quit = () => {}
  let creates = 0

  configureSingleInstance({ app, getWindow: () => null, createWindow: () => { creates += 1 } })
  app.emit('second-instance')

  assert.equal(creates, 1)
})
