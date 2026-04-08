;(async () => {
  try {
    const href = location.href || ''
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ')
    const onWebchat = href.startsWith('https://seller.shopee.cn/webchat/conversations')

    const hasSearchInput = [...document.querySelectorAll('input')]
      .some(el => /搜寻|搜索/.test(String(el.getAttribute('placeholder') || '')))

    const hasChatShell =
      /聊聊|卖家聊天室|服务模式|所有区域|搜寻|搜索/.test(text) ||
      hasSearchInput

    const hasLogoutSignal =
      /登录|扫码|账号/.test(text) &&
      !/聊聊|卖家聊天室|服务模式/.test(text)

    const loggedIn = onWebchat && hasChatShell && !hasLogoutSignal

    return {
      success: true,
      data: [{ logged_in: loggedIn, href }],
      meta: { has_more: false, logged_in: loggedIn },
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
})()
