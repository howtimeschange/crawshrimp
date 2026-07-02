;(async () => {
  const href = String(location.href || '')
  const host = String(location.hostname || '')
  const bodyText = String(document.body?.innerText || '')
  const isVipHost = /(^|\.)vip\.com$/i.test(host)
  const isLoginLike = /登录|扫码登录|账号登录|password|captcha/i.test(bodyText) && !/注销|您好|魔方罗盘|供应商管理平台/.test(bodyText)
  const hasAuthedSurface = /注销|您好|魔方罗盘|供应商管理平台|商品明细|商品列表/.test(bodyText)
  const loggedIn = isVipHost && !isLoginLike && hasAuthedSurface

  return {
    success: true,
    data: [{ logged_in: loggedIn, href }],
    meta: {
      has_more: false,
      logged_in: loggedIn,
    },
  }
})()
