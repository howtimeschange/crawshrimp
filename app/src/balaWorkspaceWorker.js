'use strict'

// Directory walks, hashing and deletion must never occupy Electron's UI thread.
const { Worker, isMainThread, parentPort } = require('node:worker_threads')
const files = require('./balaWorkspaceFiles')
const operations = new Set([
  'listAuthorizedBalaWorkspaceImages', 'listAuthorizedBalaWorkspaceVideos',
  'deleteAuthorizedWorkspaceImage', 'readAuthorizedBalaWorkspaceManifest',
  'writeAuthorizedBalaWorkspaceManifest', 'deleteAuthorizedWorkspaceVideos',
])

if (!isMainThread) {
  parentPort.on('message', ({ id, operation, args }) => {
    try {
      if (!operations.has(operation)) throw new Error('不支持的工作区文件操作')
      parentPort.postMessage({ id, result: files[operation](args) })
    } catch (error) {
      parentPort.postMessage({ id, error: error.message })
    }
  })
}

function createWorkspaceFileWorker() {
  let worker = null
  let nextId = 0
  const pending = new Map()
  function fail(error, source) {
    if (source !== worker) return
    worker = null
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }
  return {
    run(operation, args) {
      if (!operations.has(operation)) return Promise.reject(new Error('不支持的工作区文件操作'))
      if (!worker) {
        const source = worker = new Worker(__filename)
        source.on('message', ({ id, result, error }) => {
          if (source !== worker) return
          const request = pending.get(id)
          if (!request) return
          pending.delete(id)
          if (error) request.reject(new Error(error))
          else request.resolve(result)
          if (!pending.size) source.unref()
        })
        source.on('error', error => fail(error, source))
        source.on('exit', () => fail(new Error('工作区文件服务已退出，请重试'), source))
      }
      const id = ++nextId
      worker.ref()
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        try { worker.postMessage({ id, operation, args }) } catch (error) {
          pending.delete(id)
          if (!pending.size) worker.unref()
          reject(error)
        }
      })
    },
    async close() {
      if (!worker) return
      const source = worker
      fail(new Error('工作区文件服务已关闭'), source)
      await source.terminate()
    },
  }
}

module.exports = { createWorkspaceFileWorker }
