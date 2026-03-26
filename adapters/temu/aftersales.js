/**
 * aftersales.js - Temu seller after-sales scraper
 * Page: https://agentseller.temu.com (after-sales management)
 *
 * Returns: { success, data: [{...table row as object}] }
 */
;(async () => {
  try {
    // Close any popup modals first
    const popupSelectors = [
      '[class*="modal"] button[class*="close"]',
      '.ant-modal-close',
      '[aria-label="Close"]',
      '[aria-label="close"]'
    ];
    for (const sel of popupSelectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) {
        btn.click();
        await new Promise(r => setTimeout(r, 600));
        break;
      }
    }

    // Wait for table rows
    for (let i = 0; i < 30; i++) {
      if (document.querySelectorAll('table tbody tr').length > 0) break;
      await new Promise(r => setTimeout(r, 500));
    }
    await new Promise(r => setTimeout(r, 800));

    // Find the largest table
    const tables = document.querySelectorAll('table');
    let table = null, maxRows = 0;
    tables.forEach(t => {
      const rc = t.querySelectorAll('tbody tr').length;
      if (rc > maxRows) { maxRows = rc; table = t; }
    });

    const data = [];
    if (table) {
      const headers = Array.from(table.querySelectorAll('thead th, thead td')).map(th => th.innerText.trim());
      table.querySelectorAll('tbody tr').forEach(tr => {
        const cells = Array.from(tr.querySelectorAll('td')).map(c => c.innerText.trim());
        if (cells.some(c => c !== '')) {
          const row = {};
          headers.forEach((h, i) => { row[h || `col${i}`] = cells[i] || ''; });
          data.push(row);
        }
      });
    }

    const nextBtn = document.querySelector(
      '.ant-pagination-next:not(.ant-pagination-disabled)'
    );
    const has_more = nextBtn
      ? !(nextBtn.classList.contains('ant-pagination-disabled') || nextBtn.querySelector('button[disabled]'))
      : false;

    return {
      success: true,
      data,
      meta: { has_more, records_on_page: data.length }
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
})()
