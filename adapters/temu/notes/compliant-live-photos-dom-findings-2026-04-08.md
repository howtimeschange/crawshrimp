# Temu Compliant Live Photos DOM Findings

Date: 2026-04-08
Page: `https://agentseller.temu.com/govern/compliant-live-photos`
Context: live seller compliance page inspected through crawshrimp CDP flow

## Page structure

- Left nav entry: `商品实拍图`
- Quick filter tabs visible near the top:
  - `待传图`
  - `图中标签有异常`
  - `仓库实收商品不合规`
- The clickable tab node is not the widest wrapper `rocket-col`; the inner clickable `div` has `cursor: pointer`
- Active quick filter can be detected by blue border color:
  - `border-color: rgb(64, 124, 255)`
- The main product row is the `tr` that contains a visible action button with text `上传` or `修改`
- Detail rows under the same product do not have action buttons and should be ignored for row-level automation

## Priority rule

- The highest-priority rows are those whose `售卖影响及建议` cell contains:
  - `请立即处理异常，确保实物标签符合适用法律法规，避免影响商品发货入库`
- A looser fallback text match `避免影响商品发货入库` also worked during live probing

## Pagination

- Active page item:
  - `li.rocket-pagination-item-active`
- Page 1 item:
  - `li.rocket-pagination-item-1`
- Next page item:
  - `li.rocket-pagination-next`
- Disabled state is reflected by class text containing:
  - `rocket-pagination-disabled`

## Drawer and upload fields

- Open drawer wrapper:
  - `.rocket-drawer-content-wrapper`
- Two upload sections exist in the drawer:
  - `商品主体实拍图`
  - `商品外包装实拍图`
- Hidden upload inputs are regular `input[type=file]` nodes
- Input order in the live DOM was:
  - `0-3`: 主体 `正视图 / 侧视图 / 标签图 / 其他`
  - `4-7`: 外包装 `正视图 / 侧视图 / 标签图 / 其他`
- The target upload slot is `标签图` in both sections
- Slot count text is rendered in ancestor text like:
  - `标签图 (0/20)`
  - `标签图 (4/12)`

## Submit flow

1. Click row action button `上传` or `修改`
2. Upload files to:
   - `商品主体实拍图 > 标签图`
   - `商品外包装实拍图 > 标签图`
3. Click `上传并识别`
4. Exception modal appears with warning text about recognition issues
5. Click `深度识别`
6. Confirm with `确定`
7. Drawer closes and the row status changes to `深度识别中`

## Important technical note

- CDP `DOM.setFileInputFiles` returned success but did not update the Temu upload component on this page
- A working approach was:
  - read the local image bytes
  - inject `File` objects into the page
  - assign them through `DataTransfer`
  - dispatch `input` and `change`
- That approach successfully updated the visible upload counts and completed a live end-to-end submission

## Verified minimal closure

- Tested product SPU: `7161488019`
- Uploaded label images into both target slots
- Submitted `上传并识别`
- Continued through `深度识别` and confirmation
- Final observed row status: `深度识别中`
