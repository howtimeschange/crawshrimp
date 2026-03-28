;(async () => {
  try {
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ')
    const href = location.href || ''
    const cookies = document.cookie || ''

    const onSellerMarketing = href.startsWith('https://seller.shopee.cn/portal/marketing')
    const hasLoginSignal =
      onSellerMarketing &&
      (
        cookies.includes('SPC_') ||
        /营销中心|优惠券|营销活动|Seller Center/i.test(text)
      )

    const hasLogoutSignal =
      /登录|扫码|账号/.test(text) &&
      !/营销中心|优惠券|营销活动/.test(text) &&
      !onSellerMarketing

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
