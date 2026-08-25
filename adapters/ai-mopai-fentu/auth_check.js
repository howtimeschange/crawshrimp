;(async () => {
  try {
    const href = location.href || ''
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ')
    const cookies = document.cookie || ''

    if (/plm\.balabala\.com\/WebAccess/i.test(href)) {
      const hasPlmHeader = !!document.querySelector('#headerSearchText, .csiLogoText, .csi-header-search-form')
      const onPlmLoginPage = /登录|用户名|密码|login/i.test(text.slice(0, 2000))
      const loggedIn = !onPlmLoginPage && hasPlmHeader
      return {
        success: true,
        data: [{ logged_in: loggedIn, href, service: 'plm' }],
        meta: { has_more: false, logged_in: loggedIn },
      }
    }

    const onLoginPage = /login|signin|passport|auth/i.test(href) || /登录|扫码登录|账号登录|验证码|请先登录/.test(text)
    const hasCloudSignal = /森马|semir|云盘|文件|上传|新建|搜索文件/.test(text) || href.includes('fmp.semirapp.com/web/index')
    const hasSessionSignal = /token|session|sid|jwt/i.test(cookies) || !!document.querySelector('[class*="avatar"], [class*="user"], [class*="header"]')
    const loggedIn = !onLoginPage && !!(hasCloudSignal || hasSessionSignal)
    return {
      success: true,
      data: [{ logged_in: loggedIn, href, on_login_page: onLoginPage }],
      meta: { has_more: false, logged_in: loggedIn },
    }
  } catch (error) {
    return { success: false, error: String(error?.message || error) }
  }
})()
