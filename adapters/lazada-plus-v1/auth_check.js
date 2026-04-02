;(async () => {
  try {
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim()
    const href = location.href || ''
    const cookies = document.cookie || ''

    const onSellerCenter = href.startsWith('https://sellercenter.lazada')
    const hasSellerSignal =
      onSellerCenter &&
      (
        /Lazada Seller Center|Promotions|Regular Voucher|Flexi Combo|Store New Buyer Voucher|Store Follower Voucher/i.test(text) ||
        cookies.includes('SC_') ||
        cookies.includes('lzd_sid')
      )

    const hasLogoutSignal =
      /sign in|login|log in|账号登录|扫码登录/i.test(text) &&
      !/Promotions|Voucher|Flexi Combo|Seller Center/i.test(text)

    const loggedIn = !!(hasSellerSignal && !hasLogoutSignal)

    return {
      success: true,
      data: [{ logged_in: loggedIn, href }],
      meta: { has_more: false, logged_in: loggedIn }
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
})()
