;(async () => {
  const href = location.href || ''
  const isLoggedIn =
    document.querySelector('.nickname') !== null ||
    document.querySelector('#ttbar-login .link-login') === null ||
    document.cookie.includes('pin=')
  return {
    success: true,
    data: [{ logged_in: isLoggedIn, href }],
    meta: { has_more: false, logged_in: isLoggedIn }
  }
})()
