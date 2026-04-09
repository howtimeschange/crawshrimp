;(async () => {
  try {
    const cookies = document.cookie || ''
    const href = location.href || ''
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ')
    const hasSession = cookies.includes('temu_token') || cookies.includes('seller_token')
    const hasUserEl = !!document.querySelector('[class*="user-info"], [class*="seller-name"]')
    const hasSellerSignal = /商品数据|售后|Temu Seller|卖家中心|商家后台|合规中心|商品实拍图|深度识别|上传并识别/i.test(text)
    const hasLivePhotosSignal = href.includes('/govern/compliant-live-photos')
    const loggedIn = !!(hasSession || hasUserEl || hasSellerSignal || hasLivePhotosSignal)

    return {
      success: true,
      data: [{ logged_in: loggedIn, href }],
      meta: { has_more: false, logged_in: loggedIn }
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
})()
