;(async () => {
  try {
    const href = String(location.href || '')
    const host = String(location.hostname || '')
    const path = String(location.pathname || '')
    const text = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim()
    const cookies = String(document.cookie || '')
    const hasFxgHost = /(?:^|\.)jinritemai\.com$/i.test(host)
    const hasBackendPath = /^\/ffa(?:\/|$)/i.test(path)
    const hasExplicitLoginUrl = /login|passport|sso|authorize/i.test(href)
    const hasLandingLoginSignal = !hasBackendPath && /登录抖店|立即0元开店|入驻抖店|入驻抖音|618大促/.test(text)
    const hasChallengeSignal = !hasBackendPath && /登录/.test(text) && /验证码|扫码|密码/.test(text)
    const onLoginPage = hasExplicitLoginUrl || hasLandingLoginSignal || hasChallengeSignal
    const hasSessionCookie = /(?:^|;\s*)(?:PHPSESSID|ecom_us_lt|COMPASS_LUOPAN_DT|s_v_web_id)=/i.test(cookies)
    const hasPageSignal = hasBackendPath || /抖店|活动广场|订单管理|商品管理|森马官方旗舰店|营销活动|电商罗盘|子活动详情/.test(text)
    const loggedIn = hasFxgHost && !onLoginPage && (hasSessionCookie || hasPageSignal)

    return {
      success: true,
      data: [{ logged_in: loggedIn, href, host }],
      meta: {
        has_more: false,
        logged_in: loggedIn,
        has_backend_path: hasBackendPath,
        has_session_cookie: hasSessionCookie,
      },
    }
  } catch (error) {
    return { success: false, error: String(error?.message || error) }
  }
})()
