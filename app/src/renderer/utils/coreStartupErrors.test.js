import test from 'node:test'
import assert from 'node:assert/strict'

import {
  formatScriptListLoadError,
  isCoreStartupConnectionError,
} from './coreStartupErrors.js'

test('detects transient core startup connection failures', () => {
  assert.equal(isCoreStartupConnectionError(new Error('核心服务未能连接：connect ECONNREFUSED 127.0.0.1:18765')), true)
  assert.equal(isCoreStartupConnectionError(new Error('Error invoking remote method: connect ECONNRESET 127.0.0.1:18765')), true)
  assert.equal(isCoreStartupConnectionError(new Error('adapter manifest invalid')), false)
})

test('script list startup failures use short auto-refresh copy', () => {
  const error = new Error('核心服务未能连接：connect ECONNREFUSED 127.0.0.1:18765\nPython: /tmp/python')

  assert.equal(formatScriptListLoadError(error), '核心服务正在启动，稍后会自动刷新。')
  assert.equal(formatScriptListLoadError(new Error('adapter manifest invalid')), 'adapter manifest invalid')
})
