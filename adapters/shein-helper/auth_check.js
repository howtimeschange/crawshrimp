;(async () => {
  try {
    const href = location.href || ''
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ')
    const cookies = document.cookie || ''

    const onLoginPage =
      /login|signin|passport|authorize/i.test(href) ||
      /登录|扫码登录|账号登录|验证码|请先登录/i.test(text)

    const hasAppSignal =
      /SHEIN全球商家中心|SHEIN Global Merchant Center|商品评价|商品反馈|商品分析|商品明细/i.test(text) ||
      href.startsWith('https://sso.geiwohuo.com/#/')

    const hasSessionSignal =
      /token|session|sid|merchant/i.test(cookies) ||
      !!document.querySelector('[class*="user"], [class*="avatar"], [class*="account"]')

    const loggedIn = !onLoginPage && !!(hasAppSignal || hasSessionSignal)

    return {
      success: true,
      data: [{ logged_in: loggedIn, href, on_login_page: onLoginPage }],
      meta: { has_more: false, logged_in: loggedIn },
    }
  } catch (error) {
    return { success: false, error: String(error?.message || error) }
  }
})()
