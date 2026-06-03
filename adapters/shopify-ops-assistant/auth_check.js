;(async () => {
  try {
    const href = String(location.href || '')
    const host = String(location.hostname || '')
    const text = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim()
    const onLoginPage = /login|signin|authenticate|account/i.test(href) && /登录|log in|sign in|password|验证码/i.test(text)
    const loggedIn = host === 'admin.shopify.com' && !onLoginPage && /Shopify|主页|订单|产品|分析|报告|在线商店/i.test(text)
    return {
      success: true,
      data: [{ logged_in: loggedIn, href, host }],
      meta: { has_more: false, logged_in: loggedIn },
    }
  } catch (error) {
    return { success: false, error: String(error?.message || error) }
  }
})()
