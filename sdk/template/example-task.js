;(async () => {
  try {
    const data = []

    // Your scraping logic here.
    // Full access to: document, window, fetch, XHR, etc.
    // Page is already loaded, user is already logged in.

    // Example: scrape a table
    document.querySelectorAll('table tr').forEach(row => {
      const cells = [...row.querySelectorAll('td')].map(td => td.textContent.trim())
      if (cells.length > 0) data.push({ row: cells })
    })

    return {
      success: true,
      data,
      meta: {
        total: data.length,
        has_more: false  // set to true to trigger auto-pagination
      }
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
})()
