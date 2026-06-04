;(async () => {
  try {
    const href = String(location.href || '')
    const host = String(location.hostname || '')
    const text = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim()
    const cookies = String(document.cookie || '')
    const onLoginPage = /login|passport|sso|authorize/i.test(href) || /登录|验证码|扫码|密码/.test(text)
    const hasFxgHost = /(?:^|\.)jinritemai\.com$/i.test(host)
    const hasSessionCookie = /(?:^|;\s*)(?:PHPSESSID|ecom_us_lt|COMPASS_LUOPAN_DT|s_v_web_id)=/i.test(cookies)
    const hasPageSignal = /抖店|活动广场|订单管理|商品管理|森马官方旗舰店|营销活动|电商罗盘/.test(text)
    const loggedIn = hasFxgHost && !onLoginPage && (hasSessionCookie || hasPageSignal)

    return {
      success: true,
      data: [{ logged_in: loggedIn, href, host }],
      meta: {
        has_more: false,
        logged_in: loggedIn,
        has_session_cookie: hasSessionCookie,
      },
    }
  } catch (error) {
    return { success: false, error: String(error?.message || error) }
  }
})()
