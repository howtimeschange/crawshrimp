# Temu Bill Center DOM Findings

Date: 2026-04-13
Page: `https://seller.kuajingmaihuo.com/labor/bill`
Context: live seller-center reconciliation page inspected through the current Chrome CDP session

## Page snapshot

- Page title: `对账中心`
- Main actions visible on page:
  - `查询`
  - `导出`
  - `导出历史`
- Export history is rendered in a right-side drawer

## Stable selectors

- Date input:
  - `input[data-testid="beast-core-rangePicker-htmlInput"]`
- Visible drawer:
  - `[class*="Drawer_content_"]`
  - `[class*="Drawer_outerWrapper_"]`
- Export history row:
  - `[class*="export-history_list__"]`
- Export history right action area:
  - `[class*="export-history_right__"]`
- Shop name container:
  - `[class*="account-info_mallInfo__"]`
  - `[class*="account-info_accountInfo__"]`

## React props probe

- The date range input exposes React `onChange` props with a two-item `value` array
- Export history row buttons expose ancestor React props:
  - `record`
  - `taskType`
- The record payload includes:
  - `id`
  - `createTime`
  - `searchExportTimeBegin`
  - `searchExportTimeEnd`
  - `fundDetailExport`
  - `drList`
  - `agentSellerExportParams`
  - `agentSellerExportSign`

## Download button behavior

Buttons shown in an available export row:

- `下载账务明细(卖家中心)`
- `下载财务明细(全球)`
- `下载财务明细(欧区)`
- `下载财务明细(美国)`

The row component source confirms two different download paths:

- `下载账务明细(卖家中心)`
  - current page sends `POST /api/merchant/file/export/download`
  - request body shape matches `{ id, taskType }`
  - response JSON contains `result.fileUrl`
- `下载财务明细(全球 / 欧区 / 美国)`
  - current page creates an anchor with target `_blank`
  - opened URL shape:
    - `https://agentseller*.temu.com/labor/bill-download-with-detail?params=...&sign=...`
  - loading that page inside the logged-in Chrome session triggers:
    - `POST https://agentseller*.temu.com/api/merchant/file/export/download`
  - response JSON contains `result.fileUrl`

## Region mapping

- `卖家中心`: current seller-center page direct download branch
- `全球`: `https://agentseller.temu.com/labor/bill-download-with-detail?...`
- `欧区`: `https://agentseller-eu.temu.com/labor/bill-download-with-detail?...`
- `美国`: `https://agentseller-us.temu.com/labor/bill-download-with-detail?...`

Observed transient region switch pages:

- `欧区`: `https://seller.kuajingmaihuo.com/link-agent-seller?region=2&targetUrl=...`
- `美国`: `https://seller.kuajingmaihuo.com/link-agent-seller?region=3&targetUrl=...`

Intermediate redirects that may appear while switching region:

- `https://seller.kuajingmaihuo.com/link-agent-seller?...`
- `https://agentseller-*.temu.com/main/authentication?...`
- `https://agentseller-*.temu.com/labor/bill-download-with-detail?...`

## Cross-Region Confirmation Modal

When switching to `欧区` or `美国`, a confirmation modal may block the new tab before the actual download page completes.

Visible copy from the live flow / user screenshot:

- heading includes: `即将前往 Seller Central (...)`
- checkbox text includes:
  - `您授权您的账号ID和店铺名称在卖家中心各板块共享，并已阅读并同意 隐私政策`
  - `今日不再提醒`
- confirm button: `确认授权并前往`

Stability handling added in the runtime layer:

- while waiting for click-triggered downloads, inspect transient region tabs repeatedly
- if the confirmation modal is present:
  - auto-check the privacy authorization checkbox
  - auto-check the `今日不再提醒` checkbox
  - auto-click `确认授权并前往`
- keep polling after the confirm click until the actual xlsx file lands in the system download directory

## Seller-Center Export Modal

When the user clicks `导出` on the main bill-center page, Temu may first show a seller-center modal instead of creating the export task immediately.

Stable live DOM markers:

- modal root:
  - `[data-testid="beast-core-modal"]`
- modal title / body text includes:
  - `导出`
  - `导出列表`
  - `导出列表 + 账务详情`
- radio options:
  - `label[data-testid="beast-core-radio"]`
  - checked state is exposed by `data-checked="true|false"`
- confirm button:
  - `button[data-testid="beast-core-button"]`
  - visible text: `确认`

Stable adapter handling:

- after clicking the page-level `导出` button, enter a dedicated modal-confirm phase
- if the modal appears:
  - switch radio selection to `导出列表 + 账务详情`
  - click `确认`
- if the modal does not appear within a short timeout:
  - continue directly to `导出历史`

This branch is required for ranges such as `2026-03-01 ~ 2026-03-31`, where the default radio can stay on `导出列表` and cause missing detail files later.

## Stable Runtime Strategy

Final stable behavior for this adapter:

- `卖家中心`
  - stay on the current bill-center page
  - click-capture `POST /api/merchant/file/export/download`
  - direct adapter download and rename
- `全球 / 欧区 / 美国`
  - use a temporary tab to capture the final signed `fileUrl`
  - go back to the original export-history row
  - click the real region download button on the seller-center page
  - monitor the system `~/Downloads` directory for the new xlsx
  - move the new file into the runtime artifact directory and rename it
  - auto-handle transient region confirmation / authentication tabs while waiting

## Implementation notes

- Best interaction path for the date control is React state injection first, native input fallback second
- For `全球 / 欧区 / 美国`, direct backend HTTP download of the signed `fileUrl` is not reliable enough on its own
- For `全球 / 欧区 / 美国`, direct `Page.navigate(fileUrl)` browser-session download is also less reliable than clicking the real region button from the bill-center page
- The stable design is:
  - capture the final signed `fileUrl` first, mainly to lock the expected filename / region
  - then trigger the real user-facing region button and watch `~/Downloads`
- Region download completion is slower than `全球`
  - `欧区` live success was observed around 30s
  - `美国` live success was observed around 19s
  - use a generous timeout budget (60s in the adapter)
- Before each region click, proactively close stale `link-agent-seller` / `authentication` / `bill-download-with-detail` tabs
  - otherwise later region clicks may reuse a leftover tab and make download detection flaky
- Keep seller-center modal handling and cross-region modal handling in separate layers
  - seller-center export modal belongs in the adapter phase machine
  - cross-region confirmation belongs in the runtime download-click watcher
  - this separation keeps the main page flow deterministic and avoids coupling current-page DOM with transient tab DOM
- For `欧区 / 美国`, the final browser-downloaded filename may drift from the previously captured `fileUrl` filename
  - exact-name matching is still preferred first
  - runtime should fall back to “any new `.xlsx` created after this click” before declaring failure
  - this fallback fixed a live case where `欧区` downloaded successfully into `~/Downloads` but was not moved into the runtime artifact directory because the basename changed
- For `欧区 / 美国`, `capture_url_requests` itself should not be treated as a hard prerequisite for the later click-download step
  - live probing on `2026-04-13` against the same export row observed `全球` and `欧区` capture succeed while `美国` capture returned zero matches
  - the real seller-center drawer click can still succeed even when that pre-capture misses, because the browser session can finish the cross-region auth / confirm flow during the actual click download
  - adapter behavior should therefore keep the region in the click plan and use the captured `fileUrl` only as an optimization for filename matching
