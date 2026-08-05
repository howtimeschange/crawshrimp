;(async () => {
  const href = String(location.href || '')
  const host = String(location.hostname || '')
  const bodyText = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim()
  const onScmHost = /(^|\.)scm\.semir\.com$/i.test(host)
  const loginLike = /登录|扫码登录|账号登录|验证码|password|captcha/i.test(bodyText.slice(0, 2000))
  const hasScmSurface = /SUPPLY FORCE|洗唛批复判定|质量协同|成品大货协同|工作台/.test(bodyText)
  const loggedIn = onScmHost && !loginLike && hasScmSurface

  return {
    success: true,
    data: [{ logged_in: loggedIn, href }],
    meta: {
      has_more: false,
      logged_in: loggedIn,
    },
  }
})()
