;(async () => {
  const href = String(location.href || '')
  const bodyText = String(document.body?.innerText || '')
  const loggedIn = /plm\.balabala\.com\/WebAccess/i.test(href) &&
    !/login|登录|用户名|密码/i.test(bodyText.slice(0, 2000)) &&
    !!document.querySelector('#headerSearchText, .csiLogoText, .csi-header-search-form')

  return {
    success: true,
    data: [{ logged_in: loggedIn, href }],
    meta: { has_more: false, logged_in: loggedIn },
  }
})()
