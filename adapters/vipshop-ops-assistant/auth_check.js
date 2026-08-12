;(async () => {
  const href = String(location.href || '')
  const host = String(location.hostname || '')
  const bodyText = String(document.body?.innerText || '')
  const isVipHost = /(^|\.)vip\.com$/i.test(host)
  const authedSurfacePattern = /注销|您好|魔方罗盘|供应商管理平台|运营专场管理后台|商品明细|商品列表|策略效果|用户运营赋能/
  const isLoginLike = /登录|扫码登录|账号登录|password|captcha/i.test(bodyText) && !authedSurfacePattern.test(bodyText)
  const hasAuthedSurface = authedSurfacePattern.test(bodyText)
  const isKnownBackendShell = /^https:\/\/nov-admin\.vip\.com\/admin\/index\.html/i.test(href)
  const loggedIn = isVipHost && !isLoginLike && (hasAuthedSurface || isKnownBackendShell)

  return {
    success: true,
    data: [{ logged_in: loggedIn, href }],
    meta: {
      has_more: false,
      logged_in: loggedIn,
    },
  }
})()
