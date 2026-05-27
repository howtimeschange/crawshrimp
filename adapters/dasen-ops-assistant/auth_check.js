;(async () => {
  try {
    const href = String(location.href || '')
    const host = String(location.hostname || '')
    const bodyText = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim()
    let authData = null
    try {
      authData = JSON.parse(localStorage.getItem('authStorage') || '{}')?.state?.authData || null
    } catch (error) {
      authData = null
    }

    const token = authData?.oauth2Token?.access_token || ''
    const onLoginPage = /\/console\/login|\/login|sso|passport/i.test(href) || (!token && /登录|扫码|验证码/.test(bodyText))
    const hasConsoleSignal = /森马AI工作台|案例库|创作|数字员工|应用市场/.test(bodyText) || host === 'ai.semir.com'
    const loggedIn = !!token && !onLoginPage && hasConsoleSignal

    return {
      success: true,
      data: [{ logged_in: loggedIn, href, host }],
      meta: {
        has_more: false,
        logged_in: loggedIn,
        has_token: !!token,
      },
    }
  } catch (error) {
    return { success: false, error: String(error?.message || error) }
  }
})()
