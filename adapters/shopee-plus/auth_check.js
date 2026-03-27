;(async () => {
  try {
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ')
    const href = location.href || ''
    const cookies = document.cookie || ''

    // 已登录信号：营销中心域名 + SPC_ cookie（Shopee 登录 cookie）
    const hasLoginSignal =
      /seller\.shopee\.cn/.test(href) &&
      (
        cookies.includes('SPC_') ||
        /营销中心|优惠券|营销活动|Seller Center/i.test(text)
      )

    // 未登录信号：明确出现登录相关的文案，且不在营销中心内
    const hasLogoutSignal =
      /^(?=.*?(登录|扫码|账号))(?!.*?(营销|优惠券)).*$/.test(text) &&
      !/seller\.shopee\.cn/.test(href)

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
