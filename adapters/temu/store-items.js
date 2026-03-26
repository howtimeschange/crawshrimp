/**
 * store-items.js - Temu store product listing scraper
 * Page: https://www.temu.com/store/... (Items tab)
 *
 * Returns: { success, data: [{name, price, originalPrice, rating, reviewCount, href, imgSrc}] }
 */
;(async () => {
  try {
    const itemSelectors = [
      '[class*="goods-item"]',
      '[class*="GoodsItem"]',
      '[class*="product-item"]',
      '[class*="ProductItem"]',
      '[class*="item-card"]',
      '[data-type="goods"]'
    ];

    // Wait for items to render
    let itemEls = [];
    for (let i = 0; i < 30; i++) {
      for (const sel of itemSelectors) {
        itemEls = document.querySelectorAll(sel);
        if (itemEls.length > 0) break;
      }
      if (itemEls.length > 0) break;
      await new Promise(r => setTimeout(r, 500));
    }

    // Click "See More" if present
    const seeMoreBtns = Array.from(document.querySelectorAll('button, [role="button"], a'))
      .filter(el => /see more/i.test(el.innerText) && el.offsetParent !== null);
    for (const btn of seeMoreBtns) {
      btn.click();
      await new Promise(r => setTimeout(r, 1500));
    }

    // Scroll to trigger lazy load
    const totalH = document.body.scrollHeight;
    for (let s = 1; s <= 8; s++) {
      window.scrollTo(0, (totalH / 8) * s);
      await new Promise(r => setTimeout(r, 300));
    }
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 500));

    // Re-collect
    for (const sel of itemSelectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > itemEls.length) itemEls = els;
    }

    // Exclude "Explore Temu's picks" section
    function isInExploreSection(el) {
      let node = el;
      while (node && node !== document.body) {
        const text = (node.getAttribute('class') || '') + ' ' + (node.innerText || '').slice(0, 100);
        if (/explore temu.{0,5}picks/i.test(text)) return true;
        const prev = node.previousElementSibling;
        if (prev && /explore temu.{0,5}picks/i.test(prev.innerText || '')) return true;
        node = node.parentElement;
      }
      return false;
    }

    const data = [];
    itemEls.forEach(el => {
      if (isInExploreSection(el)) return;

      const nameEl = el.querySelector('[class*="title"], [class*="name"], [class*="goods-name"]');
      const name = nameEl ? nameEl.innerText.trim() : '';

      const priceEl = el.querySelector('[class*="price"] [class*="value"], [class*="sale-price"]');
      const price = priceEl ? priceEl.innerText.trim().replace(/[^\d.,]/g, '') : '';

      const origEl = el.querySelector('[class*="original-price"], [class*="origin-price"], del, s');
      const originalPrice = origEl ? origEl.innerText.trim().replace(/[^\d.,]/g, '') : '';

      const ratingEl = el.querySelector('[class*="rating"], [aria-label*="star"], [class*="score"]');
      const rating = ratingEl ? (ratingEl.getAttribute('aria-label') || ratingEl.innerText.trim()) : '';

      const reviewCountEl = el.querySelector('[class*="review-count"], [class*="sold"], [class*="comment-count"]');
      const reviewCount = reviewCountEl ? reviewCountEl.innerText.trim() : '';

      const linkEl = el.querySelector('a[href*="/goods.html"], a[href*="goods_id"], a');
      const href = linkEl ? linkEl.href : '';

      const imgEl = el.querySelector('img');
      const imgSrc = imgEl ? imgEl.src : '';

      if (name || price) {
        data.push({ name, price, originalPrice, rating, reviewCount, href, imgSrc });
      }
    });

    const nextBtn = document.querySelector(
      '.ant-pagination-next:not(.ant-pagination-disabled), ' +
      '[class*="pagination"] [aria-label="Next"]:not([disabled])'
    );
    const has_more = !!nextBtn;

    return {
      success: true,
      data,
      meta: { has_more, records_on_page: data.length }
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
})()
