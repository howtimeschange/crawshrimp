;(async () => {
  try {
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ')
    const href = location.href || ''
    const cookies = document.cookie || ''

    const onSellerCenter = href.startsWith('https://seller.shopee.cn/')
    const onSellerMarketing = href.startsWith('https://seller.shopee.cn/portal/marketing')
    const onDataCenter = href.startsWith('https://seller.shopee.cn/datacenter/')
    const hasLoginSignal =
      onSellerCenter &&
      (
        cookies.includes('SPC_') ||
        /营销中心|优惠券|营销活动|商业分析|当前店铺|Seller Center|Shopee卖家中心/i.test(text)
      )

    const hasLogoutSignal =
      /登录|扫码|账号/.test(text) &&
      !/营销中心|优惠券|营销活动|商业分析|当前店铺/.test(text) &&
      !onSellerMarketing &&
      !onDataCenter

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
