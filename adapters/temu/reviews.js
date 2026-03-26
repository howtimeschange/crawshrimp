/**
 * reviews.js - Temu store reviews scraper
 * Page: https://www.temu.com/store/...  (reviews tab)
 *
 * Returns: { success, data: [{rating, text, time, username, goodsName, images}] }
 */
;(async () => {
  try {
    const reviewSelectors = [
      '[class*="review-item"]',
      '[class*="ReviewItem"]',
      '[class*="review_item"]',
      '[data-type="review"]',
      '[class*="comment-item"]',
      '[class*="feedback-item"]'
    ];

    // Wait for reviews to load (up to 15s)
    let reviewEls = [];
    for (let i = 0; i < 30; i++) {
      for (const sel of reviewSelectors) {
        reviewEls = document.querySelectorAll(sel);
        if (reviewEls.length > 0) break;
      }
      if (reviewEls.length > 0) break;
      await new Promise(r => setTimeout(r, 500));
    }

    // Scroll to trigger lazy load
    const scrollStep = Math.floor(window.innerHeight * 0.8);
    for (let s = 0; s < 5; s++) {
      window.scrollBy(0, scrollStep);
      await new Promise(r => setTimeout(r, 400));
    }
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 500));

    // Re-collect after scroll
    for (const sel of reviewSelectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > reviewEls.length) reviewEls = els;
    }

    const data = [];
    reviewEls.forEach(el => {
      const ratingEl = el.querySelector('[class*="star"][class*="filled"], [class*="rating"], [aria-label*="star"]');
      let rating = '';
      if (ratingEl) {
        const filled = el.querySelectorAll('[class*="star"][class*="filled"], [class*="star-on"]');
        rating = filled.length > 0 ? filled.length.toString() : ratingEl.innerText.trim();
      }

      const textEl = el.querySelector('[class*="review-text"], [class*="comment-text"], [class*="content"], p');
      const text = textEl ? textEl.innerText.trim() : '';

      const timeEl = el.querySelector('[class*="time"], [class*="date"], time');
      const time = timeEl ? (timeEl.getAttribute('datetime') || timeEl.innerText.trim()) : '';

      const userEl = el.querySelector('[class*="username"], [class*="user-name"], [class*="nickname"]');
      const username = userEl ? userEl.innerText.trim() : '';

      const goodsEl = el.querySelector('[class*="goods-name"], [class*="product-name"], [class*="item-name"]');
      const goodsName = goodsEl ? goodsEl.innerText.trim() : '';

      const imgs = Array.from(el.querySelectorAll('img[src*="temu"], img[class*="review"]'))
        .map(img => img.src)
        .filter(src => src && !src.includes('avatar') && !src.includes('icon'));

      data.push({ rating, text, time, username, goodsName, images: imgs.join(',') });
    });

    // Pagination
    const nextBtn = document.querySelector(
      '[class*="pagination"] [aria-label="Next"]:not([disabled]), ' +
      '.ant-pagination-next:not(.ant-pagination-disabled)'
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
