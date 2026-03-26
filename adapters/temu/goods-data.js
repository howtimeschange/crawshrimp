/**
 * goods-data.js - Temu seller goods data scraper
 * Page: https://agentseller.temu.com/newon/goods-data
 *
 * Returns: { success, data: [{goodsName, category, spu, skc, country, payCount, trend}] }
 * Pagination: uses meta.has_more
 */
;(async () => {
  try {
    const page = window.__CRAWSHRIMP_PAGE__ || 1;

    // Wait for table to render (up to 10s)
    async function waitForRows() {
      for (let i = 0; i < 20; i++) {
        const rows = document.querySelectorAll('tbody tr.TB_tr_5-120-1');
        if (rows.length > 0) return rows;
        await new Promise(r => setTimeout(r, 500));
      }
      return document.querySelectorAll('tbody tr.TB_tr_5-120-1');
    }

    const rows = await waitForRows();
    const results = [];

    for (const row of rows) {
      const tds = row.querySelectorAll('td.TB_td_5-120-1');
      if (tds.length < 3) continue;

      const infoTd = tds[0];
      const fullText = infoTd.innerText.trim();
      const lines = fullText.split('\n').map(s => s.trim()).filter(Boolean);

      let goodsName = '', category = '', spu = '', skc = '';
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] === 'SPU:' || lines[i] === 'SPU\uff1a') { spu = lines[i + 1] || ''; }
        else if (lines[i] === 'SKC:' || lines[i] === 'SKC\uff1a') { skc = lines[i + 1] || ''; }
        else if (!goodsName && i === 0) goodsName = lines[i];
        else if (goodsName && !category && !lines[i].match(/^(SPU|SKC)/)) category = lines[i];
      }

      const country = tds[1] ? tds[1].innerText.trim() : '';
      const payText = tds[2] ? tds[2].innerText.trim() : '';
      const payLines = payText.split('\n').map(s => s.trim()).filter(Boolean);
      const payCount = payLines[0] || '';
      const trend = payLines[1] || '';

      if (goodsName || spu) {
        results.push({ goodsName, category, spu, skc, country, payCount, trend });
      }
    }

    // Pagination detection
    const nextBtn = document.querySelector('.PGT_next_5-120-1');
    const hasMore = nextBtn && !nextBtn.classList.contains('PGT_disabled_5-120-1');

    // Auto-click next page if paginating
    if (hasMore && page > 1) {
      // Page 1+ means we need to click next after scraping
      // (Page 1 is already open; crawshrimp will call again with page=2 etc.)
    }
    if (hasMore) {
      nextBtn.click();
      await new Promise(r => setTimeout(r, 1500)); // wait for page transition
    }

    return {
      success: true,
      data: results,
      meta: {
        page,
        has_more: !!hasMore,
        records_on_page: results.length
      }
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
})()
