'use strict'

function configureSingleInstance({ app, getWindow, createWindow }) {
  if (!app || typeof app.requestSingleInstanceLock !== 'function') {
    throw new TypeError('Electron app with requestSingleInstanceLock is required')
  }
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return false
  }

  app.on('second-instance', () => {
    const win = typeof getWindow === 'function' ? getWindow() : null
    if (!win || win.isDestroyed?.()) {
      createWindow?.()
      return
    }
    if (win.isMinimized?.()) win.restore?.()
    win.show?.()
    win.focus?.()
  })
  return true
}

module.exports = { configureSingleInstance }
