;(async () => {
  // auth_check.js - detect if user is logged in to Temu seller
  try {
    const cookies = document.cookie;
    const hasSession = cookies.includes('temu_token') || cookies.includes('seller_token');
    const hasUserEl = !!document.querySelector('[class*="user-info"], [class*="seller-name"]');
    return { success: true, data: [], meta: { logged_in: hasSession || hasUserEl } };
  } catch (e) {
    return { success: false, error: e.message };
  }
})()
