;(async () => {
  try {
    const href = String(location.href || '')
    const host = String(location.hostname || '')
    const text = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim()
    const cookies = String(document.cookie || '')

    const onLoginPage = /login|passport|signin|authorize/i.test(href) || /登录|验证码|扫码/.test(text)
    const hasCspHost = /(^|\.)aliexpress\.com$/i.test(host)
    const hasSessionCookie = /(?:^|;\s*)(?:_m_h5_tk|xman_us_f|intl_locale|aep_usuc_f|ali_apache_id)=/i.test(cookies)
    const hasPageSignal = /跨境卖家中心|Cross-border Seller Center|商品管理|商品发布|Semir Official Store|AliExpress/i.test(text)
    const loggedIn = !onLoginPage && (hasSessionCookie || (hasCspHost && hasPageSignal))

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
