;(async () => {
  try {
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ')
    const href = location.href || ''
    const cookies = document.cookie || ''

    const hasLoginSignal =
      /营销中心|优惠券|营销活动|我的店铺|卖家中心|Seller Center/i.test(text) ||
      /portal\/marketing/i.test(href) ||
      cookies.includes('SPC_') ||
      cookies.includes('csrftoken') ||
      !!document.querySelector('[class*="shop"], [class*="store"], [class*="seller"], header, aside')

    const hasLogoutSignal =
      /登录|扫码登录|账号登录|验证码登录|立即登录/i.test(text) &&
      !/营销中心|优惠券/i.test(text)

    const loggedIn = hasLoginSignal && !hasLogoutSignal

    return {
      success: true,
      data: [{ logged_in: loggedIn, href }],
      meta: { has_more: false, logged_in: loggedIn }
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
})()
