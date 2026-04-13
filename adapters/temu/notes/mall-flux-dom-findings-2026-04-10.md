# Temu Mall Flux DOM Findings

Date: 2026-04-10
Page: `https://agentseller.temu.com/main/mall-flux-analysis-full`
Context: live seller shop traffic page inspected through the current Chrome CDP session

## Status

- 2026-04-13: `mall_flux` has been regression tested successfully in live runs
- Verified dimensions: `按日 / 按周 / 按月`
- Verified regions: `全球 / 美国 / 欧区`
- Verified outputs: page selection, exported Excel date range, and grain label match the requested values
- The temporary debug task `mall_flux_probe` was removed after the live verification loop was completed

## Page snapshot

- Page title: `店铺流量`
- Region tabs are visible above the report: `全球 / 美国 / 欧区`
- `商家中心` is present but disabled
- The page shows a date range input and daily/weekly/monthly capsules

## Stable selectors

- Region tab nodes: `a[class*="index-module__drItem___"]`
- Date range input: `input[data-testid="beast-core-rangePicker-htmlInput"]`
- Date range root: `div[data-testid="beast-core-rangePicker-input"]`
- Grain capsules: `div[class*="TAB_capsule_"]`
- Active grain capsule: `div[class*="TAB_capsule_"][class*="TAB_active_"]`

## Table structure

The page renders a header table plus a data table.

Header columns observed:

1. `日期`
2. `总数据/总浏览量`
3. `总数据/总访客数`
4. `总数据/总支付买家数`
5. `总数据/总支付转化率`
6. `总数据/总支付件数`
7. `商品数据/商品浏览量`
8. `商品数据/商品访客数`
9. `商品数据/商详支付买家数`
10. `商品数据/商详支付转化率`
11. `店铺数据/店铺页浏览量`
12. `店铺数据/店铺页面访客数`
13. `店铺数据/店铺页支付买家数`
14. `店铺数据/店铺页支付转化率`

The live tab showed 6 rows for the current date range.

## Pagination

- Pager root uses the shared Temu pager classes:
  - `li[class*="PGT_prev_"]`
  - `li[class*="PGT_next_"]`
  - `li[class*="PGT_pagerItemActive_"]`
- Total count text was visible as `共有 6 条`

## Interaction notes

- There is no visible `查询` button on this page
- The date range input exposes React props with `onChange`
- The page follows the same outer-site switch pattern as other Temu backend pages
- The daily/weekly/monthly toggle is implemented as Temu `TAB_capsule_` nodes
- The week picker and month picker are single-value controls, not range pickers
- The most stable interaction path for week/month is to locate the higher-level React picker props and call `onChange(Date)` through injection
