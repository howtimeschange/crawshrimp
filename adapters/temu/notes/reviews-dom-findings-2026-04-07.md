# Temu Reviews DOM Findings

Date: 2026-04-07
Page: `https://www.temu.com/mall.html?mall_id=634418212707202`
Context: store page already on `Reviews` tab, live DOM inspected through crawshrimp CDP flow

## Page snapshot

- Review card root: `div._9WTBQrvq`
- Navigation tabs: `h2._2kIA1PhC`
- Current page had 10 visible review cards

## Direct child structure inside a review card

Observed order on multiple cards:

1. reviewer meta block: `div._3OHJMKy5`
2. stars block: `div._21WXPU_9`
3. purchase spec block: `div._2Y-spytg`
4. fit block: `div._35Cqvk-G`
5. optional image carousel: `div.splide...`
6. translated / displayed review body: `div.N4fQ1-w3`
7. original review block when translation exists: `div.tbAzrtq-`
8. actions block: `div._3q6neL4p`
9. product link block: `a._2Tl9qLr1._1ugo4xKR`

Useful leaf nodes seen in the live page:

- review body leaf: `div._2EO0yd2j`
- product title leaf: `div.EioQFaxY`
- review image URLs: `rewimg-*.kwcdn.com`

## Root cause of the extractor bug

Old logic scanned all leaf text nodes in the whole card and chose the longest one as `reviewText`.
That allowed the bottom product title inside the product link block to beat the real review text on some cards.

## Stable extraction rule

- Read review body from the last eligible non-anchor direct child block
- Read `Overall fit` from `div._35Cqvk-G` or text prefixed with `Overall fit:`
- Read review images only from the direct-child carousel block and only keep `rewimg` URLs
- Exclude:
  - reviewer meta block
  - purchase / fit lines
  - share / helpful / report actions
  - `Review before translation:` block
  - bottom product link anchor
- Read original text only from the direct child block prefixed with `Review before translation:`
