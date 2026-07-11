'use strict'

function requestJsonEndpoint({ http, port, path, timeoutMs }) {
  return new Promise(resolve => {
    let settled = false
    const finish = result => {
      if (settled) return
      settled = true
      resolve({ path, ...result })
    }
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'GET',
      timeout: timeoutMs,
    }, res => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        const statusCode = Number(res.statusCode || 0)
        if (statusCode !== 200) {
          finish({ ok: false, statusCode, error: `HTTP ${statusCode || 'error'}` })
          return
        }
        try {
          finish({ ok: true, statusCode, data: JSON.parse(body || '{}') })
        } catch (error) {
          finish({ ok: false, statusCode, error: error.message, invalidJson: true })
        }
      })
    })
    req.on('error', error => finish({
      ok: false,
      statusCode: 0,
      error: error.message,
      errorCode: error.code || '',
    }))
    req.on('timeout', () => {
      finish({ ok: false, statusCode: 0, error: 'timeout', errorCode: 'ETIMEDOUT' })
      req.destroy()
    })
    req.end()
  })
}

function endpointIsValidVersion(endpoint) {
  return endpoint.ok && endpoint.data && typeof endpoint.data === 'object' &&
    Boolean(String(endpoint.data.Browser || '').trim())
}

function endpointIsValidTabs(endpoint) {
  return endpoint.ok && Array.isArray(endpoint.data)
}

function classifyProbe(version, tabs) {
  const versionValid = endpointIsValidVersion(version)
  const tabsValid = endpointIsValidTabs(tabs)
  const details = { version, tabs }

  if (versionValid && tabsValid) {
    return {
      ok: true,
      kind: 'ready',
      message: 'Chrome CDP 已就绪',
      browser: String(version.data.Browser || ''),
      protocolVersion: String(version.data['Protocol-Version'] || ''),
      webSocketDebuggerUrl: String(version.data.webSocketDebuggerUrl || ''),
      ...details,
    }
  }
  if (versionValid || tabsValid) {
    return { ok: false, kind: 'partial-cdp', message: 'Chrome CDP 接口不完整，请重启专用 Chrome', ...details }
  }

  const endpoints = [version, tabs]
  if (endpoints.some(item => item.errorCode === 'ETIMEDOUT')) {
    return { ok: false, kind: 'timeout', message: 'Chrome CDP 连接超时', ...details }
  }
  if (endpoints.every(item => item.errorCode === 'ECONNREFUSED')) {
    return { ok: false, kind: 'connection-refused', message: 'Chrome CDP 端口未启动', ...details }
  }
  if (endpoints.some(item => item.statusCode > 0 && item.statusCode !== 200)) {
    return { ok: false, kind: 'occupied-non-cdp', message: '9222 端口被其他服务占用，未检测到 Chrome CDP', ...details }
  }
  return { ok: false, kind: 'invalid-cdp', message: '9222 返回了无效的 Chrome CDP 数据', ...details }
}

async function probeChromeCdp({ http, port = 9222, timeoutMs = 800 }) {
  if (!http || typeof http.request !== 'function') throw new TypeError('http.request is required')
  const [version, tabs] = await Promise.all([
    requestJsonEndpoint({ http, port, path: '/json/version', timeoutMs }),
    requestJsonEndpoint({ http, port, path: '/json', timeoutMs }),
  ])
  return classifyProbe(version, tabs)
}

async function prepareChromeRecovery({ diagnostic, stopManagedChrome, probeCdp }) {
  if (!diagnostic || typeof diagnostic !== 'object') throw new TypeError('diagnostic is required')
  if (typeof stopManagedChrome !== 'function') throw new TypeError('stopManagedChrome is required')
  if (typeof probeCdp !== 'function') throw new TypeError('probeCdp is required')

  if (diagnostic.ok) return { action: 'ready', diagnostic }
  if (diagnostic.kind === 'occupied-non-cdp') {
    return {
      action: 'blocked',
      code: 'CDP_PORT_OCCUPIED',
      message: diagnostic.message,
      diagnostic,
    }
  }

  const stopResult = await stopManagedChrome()
  if (stopResult?.reason === 'kill-failed' || stopResult?.reason === 'exit-timeout') {
    return {
      action: 'blocked',
      code: 'MANAGED_CHROME_STOP_FAILED',
      message: '专用 Chrome 无法安全关闭，请退出抓虾后重试。',
      diagnostic,
      stopResult,
    }
  }

  let current = diagnostic
  if (stopResult?.stopped) current = await probeCdp()
  if (current.ok) return { action: 'ready', diagnostic: current, stopResult }
  if (current.kind === 'connection-refused') {
    return { action: 'launch', diagnostic: current, stopResult }
  }
  return {
    action: 'blocked',
    code: 'CDP_PORT_OCCUPIED',
    message: current.message || '9222 端口未能安全释放，未启动新的 Chrome。',
    diagnostic: current,
    stopResult,
  }
}

module.exports = { probeChromeCdp, classifyProbe, prepareChromeRecovery }
