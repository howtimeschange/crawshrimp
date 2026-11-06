;(async () => {
  const href = String(location.href || '')
  const text = String(document.body?.innerText || '').slice(0, 2000)
  if (location.hostname === 'scm.semir.com' || location.hostname === 'fmp.semirapp.com') {
    const loggedIn = !/登录|验证码|密码/.test(text) && (location.hostname === 'scm.semir.com' ? !!document.querySelector('.q-table__container') : !!document.querySelector('#app'))
    return { success: true, data: [{ logged_in: loggedIn }], meta: { has_more: false, logged_in: loggedIn } }
  }
  const loggedIn = location.hostname === 'smplm.semirapp.com' &&
    location.pathname.startsWith('/WebAccess/') &&
    !/login|登录|用户名|密码/i.test(text) &&
    !!document.querySelector('#headerSearchText, .csiLogoText, .csi-header-search-form') &&
    !!window.localStorage?.getItem('CSRFToken')
  return { success: true, data: [{ logged_in: loggedIn }], meta: { has_more: false, logged_in: loggedIn } }
})()
