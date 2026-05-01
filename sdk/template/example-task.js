;(async () => {
  try {
    const params = window.__CRAWSHRIMP_PARAMS__ || {}
    const page = window.__CRAWSHRIMP_PAGE__ || 1
    const shared = window.__CRAWSHRIMP_SHARED__ || {}
    const data = []

    // Your scraping logic here.
    // Full access to: document, window, fetch, XHR, etc.
    // Page is already loaded, user is already logged in.
    const keyword = String(params.keyword || '').trim().toLowerCase()

    // Example: scrape a table
    document.querySelectorAll('table tbody tr, table tr').forEach(row => {
      const cells = [...row.querySelectorAll('td')].map(td => td.textContent.trim())
      if (!cells.length) return
      const text = cells.join(' ')
      if (keyword && !text.toLowerCase().includes(keyword)) return
      data.push({
        Title: cells[0] || text,
        URL: location.href,
        Page: page,
      })
    })

    return {
      success: true,
      data,
      meta: {
        has_more: false, // set to true to trigger auto-pagination
        shared: {
          ...shared,
          total_rows: data.length,
        },
      }
    }
  } catch (e) {
    return { success: false, error: e?.message || String(e) }
  }
})()
