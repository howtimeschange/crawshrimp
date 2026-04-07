# Temu Store Items DOM Findings

Date: 2026-04-07
Page: `https://www.temu.com/mall.html?mall_id=634418212707202`
Context: live store page inspected through crawshrimp CDP flow

## Key boundary

- Store item cards use `div._6q6qVUF5._1UrrHYym`
- Recommended items from other shops live under a `div.js-goods-list` section whose heading is `Explore Temu's picks`
- That section must be excluded from scraping
- Current live DOM had `534` store cards after excluding the picks section

## Stable card structure

Observed direct children on multiple cards:

1. image container: `div.goods-image-container-external`
2. title block: `div._2gAD5fPC`
3. current price block: `div._3tAUu0RX`
4. reference price block: `div._2Rn65ox1`
5. rating block: `div._2aMrMQeS`
6. brand / store badge block: `div._3UD214NZ`

## Fields that are extractable but were previously missing or incomplete

- `商品角标`
  - Examples: `Quick look`, `Top pick`, `Selection`, `Cotton`, `Lyocell`
  - Often appears in the image container or as a prefix before the title
- `价格备注`
  - Examples: `RRP`, `Lowest recent price`
  - Comes from the reference-price block text
- `评分`
  - Example text: `4.9 out of five stars`
  - Parse the numeric score from the rating block
- `评价数`
  - Example text: `95 reviews`, `2.402 reviews`
  - Parse the review count from the rating block
- `品牌/店铺标签`
  - Examples: `Brand Official Store: BALABALA`, `Brand: ASK JUNIOR`
  - Comes from the brand badge block

## Extraction notes

- `商品名称` can continue using `data-tooltip-title` or the title anchor text
- `商品图片` is safest when read from the card image element, with background-image fallback
- `goods_id` still comes from `data-tooltip="goodContainer-..."` or the product link
