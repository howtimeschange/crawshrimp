;(async () => {
  try {
    const cookies = document.cookie || ''
    const href = location.href || ''
    const hostname = String(location.hostname || '')
    const pathname = String(location.pathname || '')
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ')
    const onLoginPage = href.includes('/login') || /扫码登录|账号登录|还没有店铺/.test(text)
    const onSellerLanding = href.includes('/settle/site-main')
    const hasSession = cookies.includes('temu_token') || cookies.includes('seller_token')
    const hasBackendContextCookie = /(?:^|;\s*)(mallid|mall_id|seller_id|seller_temp|temu_token|seller_token)=/i.test(cookies)
    const isAgentsellerHost = hostname === 'agentseller.temu.com' || /^agentseller-[a-z]+\.temu\.com$/i.test(hostname)
    const isKuajingmaihuoHost = hostname === 'seller.kuajingmaihuo.com'
    const isBusinessRoute = /^\/(?:main|govern|goods|labor)(?:\/|$)/.test(pathname)
    const isKuajingmaihuoBusinessRoute = isKuajingmaihuoHost && /^\/(?:main|wms|labor)(?:\/|$)/.test(pathname)
    const hasUserEl = !!document.querySelector('[class*="user-info"], [class*="seller-name"]')
    const hasSellerSignal = /商品数据|商品流量|店铺流量|活动数据|售后|商品评价|商品品质分析|资金限制|建议零售价|对账中心|保税仓|抽检结果|数据中心|Temu Seller|TEMU Agent Center|Seller Central|商家后台|商家中心|合规中心|商品实拍图|深度识别|上传并识别/i.test(text)
    const hasLivePhotosSignal = href.includes('/govern/compliant-live-photos')
    const hasBackendPageSignal = isAgentsellerHost && (
      hasSellerSignal ||
      (isBusinessRoute && hasBackendContextCookie) ||
      ((pathname === '/' || pathname === '') && /TEMU Agent Center|Seller Central|商家后台|商家中心|数据中心/i.test(text))
    )
    const hasKuajingmaihuoPageSignal = isKuajingmaihuoBusinessRoute && (
      hasSellerSignal ||
      hasBackendContextCookie ||
      /发货单|退货确认单|抽检结果明细|对账中心|卖家中心|商家中心/i.test(text)
    )
    const loggedIn = !onLoginPage && !!(hasSession || hasUserEl || hasSellerSignal || hasLivePhotosSignal || onSellerLanding || hasBackendPageSignal || hasKuajingmaihuoPageSignal)

    return {
      success: true,
      data: [{ logged_in: loggedIn, href, on_login_page: onLoginPage }],
      meta: { has_more: false, logged_in: loggedIn }
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
})()
