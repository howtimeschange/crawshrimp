;(async () => {
  const href = String(location.href || '')
  const host = String(location.hostname || '')
  const bodyText = String(document.body?.innerText || '')
  const isLoginPage = /login\.(taobao|tmall)\.com/i.test(host) || /亲，请登录|扫码登录|密码登录/.test(bodyText)
  const hasSessionCookie = /(?:^|;\s*)(_m_h5_tk|cookie2|tracknick|lgc|sn)=/i.test(String(document.cookie || ''))
  const isQnPage = /(^|\.)taobao\.com$/i.test(host) && /素材中心|商品素材管理|视频生产|千牛/.test(bodyText)
  const hasMtopClient = typeof window.lib?.mtop?.request === 'function' || typeof window.mtop?.request === 'function'

  return {
    success: true,
    data: [{ logged_in: !isLoginPage && (hasSessionCookie || isQnPage || hasMtopClient), href }],
    meta: {
      has_more: false,
      logged_in: !isLoginPage && (hasSessionCookie || isQnPage || hasMtopClient),
      has_session_cookie: hasSessionCookie,
      has_mtop_client: hasMtopClient,
    },
  }
})()
