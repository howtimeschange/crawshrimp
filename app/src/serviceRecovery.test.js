'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { createSingleFlightRecovery, isOwnedBackendRuntime, classifyBackendHealth } = require('./serviceRecovery')

test('single-flight recovery shares one run across concurrent callers', async () => {
  let runs = 0
  let release
  const gate = new Promise(resolve => { release = resolve })
  const recover = createSingleFlightRecovery(async () => {
    runs += 1
    await gate
    return { ok: true, runs }
  })

  const first = recover()
  const second = recover()

  assert.equal(first, second)
  assert.equal(runs, 0)
  release()
  assert.deepEqual(await first, { ok: true, runs: 1 })
  assert.equal(runs, 1)
})

test('single-flight recovery allows a fresh run after rejection', async () => {
  let runs = 0
  const recover = createSingleFlightRecovery(async () => {
    runs += 1
    if (runs === 1) throw new Error('first failed')
    return { ok: true }
  })

  await assert.rejects(recover(), /first failed/)
  assert.deepEqual(await recover(), { ok: true })
  assert.equal(runs, 2)
})

test('owned backend identity permits adopting its Python-selected fallback data directory', () => {
  const owned = isOwnedBackendRuntime({
    backend_instance_id: 'instance-1',
    owns_backend_instance: true,
    scripts_dir: 'C:\\Program Files\\crawshrimp\\resources\\python-scripts',
    data_dir: 'C:\\Users\\demo\\AppData\\Local\\crawshrimp',
  }, {
    instanceId: 'instance-1',
    scriptsDir: 'C:\\Program Files\\crawshrimp\\resources\\python-scripts',
    samePath: (left, right) => left.toLowerCase() === right.toLowerCase(),
  })

  assert.equal(owned, true)
})

test('foreign backend identity can never be adopted', () => {
  const samePath = () => true
  assert.equal(isOwnedBackendRuntime({
    backend_instance_id: 'foreign',
    owns_backend_instance: true,
    scripts_dir: 'scripts',
  }, { instanceId: 'ours', scriptsDir: 'scripts', samePath }), false)
  assert.equal(isOwnedBackendRuntime({
    backend_instance_id: 'ours',
    owns_backend_instance: false,
    scripts_dir: 'scripts',
  }, { instanceId: 'ours', scriptsDir: 'scripts', samePath }), false)
})

test('backend health is ready only when the reachable runtime is compatible', () => {
  const ownedRuntime = { backend_instance_id: 'ours' }
  const foreignRuntime = { backend_instance_id: 'foreign' }
  const isCompatible = runtime => runtime === ownedRuntime

  assert.deepEqual(classifyBackendHealth({ ok: false }, isCompatible), {
    reachable: false,
    compatible: false,
  })
  assert.deepEqual(classifyBackendHealth({ ok: true, data: { runtime: foreignRuntime } }, isCompatible), {
    reachable: true,
    compatible: false,
  })
  assert.deepEqual(classifyBackendHealth({ ok: true, data: { runtime: ownedRuntime } }, isCompatible), {
    reachable: true,
    compatible: true,
  })
})
