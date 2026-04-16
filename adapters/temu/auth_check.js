;(async () => {
  try {
    const cookies = document.cookie || ''
    const href = location.href || ''
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ')
    const onLoginPage = href.includes('/login') || /扫码登录|账号登录|还没有店铺/.test(text)
    const onSellerLanding = href.includes('/settle/site-main')
    const hasSession = cookies.includes('temu_token') || cookies.includes('seller_token')
    const hasUserEl = !!document.querySelector('[class*="user-info"], [class*="seller-name"]')
    const hasSellerSignal = /商品数据|售后|Temu Seller|商家后台|合规中心|商品实拍图|深度识别|上传并识别/i.test(text)
    const hasLivePhotosSignal = href.includes('/govern/compliant-live-photos')
    const loggedIn = !onLoginPage && !!(hasSession || hasUserEl || hasSellerSignal || hasLivePhotosSignal || onSellerLanding)

    return {
      success: true,
      data: [{ logged_in: loggedIn, href, on_login_page: onLoginPage }],
      meta: { has_more: false, logged_in: loggedIn }
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
})()
