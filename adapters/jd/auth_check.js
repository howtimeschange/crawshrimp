;(async () => {
  // 检查 JD 登录状态
  const isLoggedIn = document.querySelector('.nickname') !== null
    || document.querySelector('#ttbar-login .link-login') === null
    || document.cookie.includes('pin=')
  return { success: true, data: [{ logged_in: isLoggedIn }], meta: { has_more: false } }
})()
