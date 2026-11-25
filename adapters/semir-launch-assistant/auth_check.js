;(async () => {
  if (location.hostname === 'fmp.semirapp.com') {
    let loggedIn = false
    try {
      const response = await fetch('/fengcloud/1/account/mount', {
        credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(5000),
      })
      if (response.ok) loggedIn = Array.isArray((await response.json()).list)
    } catch {}
    return { success: true, data: [{ logged_in: loggedIn }], meta: { has_more: false, logged_in: loggedIn } }
  }
  const text = String(document.body?.innerText || '').slice(0, 2000)
  if (location.hostname === 'scm.semir.com') {
    const loggedIn = !/登录|验证码|密码/.test(text) && !!document.querySelector('.q-table__container')
    return { success: true, data: [{ logged_in: loggedIn }], meta: { has_more: false, logged_in: loggedIn } }
  }
  const loggedIn = location.hostname === 'smplm.semirapp.com' &&
    location.pathname.startsWith('/WebAccess/') &&
    !/login|登录|用户名|密码/i.test(text) &&
    !!document.querySelector('#headerSearchText, .csiLogoText, .csi-header-search-form') &&
    !!window.localStorage?.getItem('CSRFToken')
  return { success: true, data: [{ logged_in: loggedIn }], meta: { has_more: false, logged_in: loggedIn } }
})()
