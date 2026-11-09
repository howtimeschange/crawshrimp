;(async () => {
  const href = String(location.href || '')
  const bodyText = String(document.body?.innerText || '')
  if (/fmp\.semirapp\.com/.test(location.hostname)) {
    try {
      const response = await fetch('/fengcloud/1/account/mount', {credentials:'include', signal:AbortSignal.timeout(10000)})
      const payload = response.ok ? await response.json() : {}
      const logged = Array.isArray(payload.list) && payload.list.length > 0
      return {success:true,data:[{logged_in:logged,href}],meta:{has_more:false,logged_in:logged}}
    } catch (_) { return {success:true,data:[{logged_in:false,href}],meta:{has_more:false,logged_in:false}} }
  }
  const loggedIn = /plm\.balabala\.com\/WebAccess/i.test(href) &&
    !/login|登录|用户名|密码/i.test(bodyText.slice(0, 2000)) &&
    !!document.querySelector('#headerSearchText, .csiLogoText, .csi-header-search-form')

  return {
    success: true,
    data: [{ logged_in: loggedIn, href }],
    meta: { has_more: false, logged_in: loggedIn },
  }
})()
