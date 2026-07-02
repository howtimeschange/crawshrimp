;(async () => {
  const href = String(location.href || '')
  const host = String(location.hostname || '')
  const bodyText = String(document.body?.innerText || document.body?.textContent || '')
  const isWeimob = /(^|\.)weimob\.com$/i.test(host)
  const isMdm = /(^|\.)semirapp\.com$/i.test(host)
  const looksLoggedOut = /登录|扫码登录|账号登录|Login|Sign in/i.test(bodyText) && !/商品列表|编辑商品|商品查询|MDM主数据管理平台/.test(bodyText)
  const hasWeimobRuntime = !!(window.wm && typeof window.wm.getCurrentWOSCoreInfoSync === 'function')
  const hasMdmToken = (() => {
    try {
      const raw = localStorage.getItem('__vuex__local') || '{}'
      return !!JSON.parse(raw)?.authModule?.token
    } catch (error) {
      return false
    }
  })()
  const loggedIn = (isWeimob && hasWeimobRuntime && !looksLoggedOut) || (isMdm && hasMdmToken && !looksLoggedOut)

  return {
    success: true,
    data: [{ logged_in: loggedIn, href }],
    meta: {
      has_more: false,
      logged_in: loggedIn,
      host,
      surface: isWeimob ? 'weimob' : (isMdm ? 'mdm' : 'unknown'),
    },
  }
})()
