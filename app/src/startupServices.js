'use strict'

function messageFromError(error) {
  return error?.message || String(error)
}

async function startDesktopServices({ startBackend, startChrome, log = () => {} }) {
  if (typeof startBackend !== 'function') throw new TypeError('startBackend is required')
  if (typeof startChrome !== 'function') throw new TypeError('startChrome is required')

  const apiPromise = Promise.resolve()
    .then(() => startBackend())
    .then(() => ({ ok: true }))
    .catch((error) => {
      log(`[warn] API backend failed to start: ${messageFromError(error)}`)
      return { ok: false, error }
    })

  const chromePromise = Promise.resolve()
    .then(() => startChrome())
    .then((result) => ({ ok: Boolean(result?.ok), ...(result || {}) }))
    .catch((error) => {
      log(`[warn] Chrome startup failed: ${messageFromError(error)}`)
      return { ok: false, error }
    })

  const [api, chrome] = await Promise.all([apiPromise, chromePromise])
  return { api, chrome }
}

module.exports = { startDesktopServices }

