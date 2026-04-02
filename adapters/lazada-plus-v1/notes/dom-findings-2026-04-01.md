# Lazada Voucher DOM Findings

Test date: 2026-04-01

Verified sites:
- MY (`https://sellercenter.lazada.com.my`)
- SG (`https://sellercenter.lazada.sg`)

Primary entry:
- `https://sellercenter.lazada.com.my/apps/promotion/home`

## Country Switching

Best path:
- Use a site-domain map plus `/{site}/apps/promotion/home`
- From that home page, enter the concrete create page for the target tool

Why:
- On promotions home, the right sidebar country links are stable and switch to each site home
- On voucher create pages, the right sidebar country links downgrade to a generic `/apps/voucher/create` URL and lose the coupon-type query
- Because of that, cross-site automation should not switch country from an already-open create form

Domain map confirmed on live page:
- MY: `https://sellercenter.lazada.com.my`
- SG: `https://sellercenter.lazada.sg`
- ID: `https://sellercenter.lazada.co.id`
- PH: `https://sellercenter.lazada.com.ph`
- TH: `https://sellercenter.lazada.co.th`
- VN: `https://sellercenter.lazada.vn`

## Create URL Map

Promotions home:
- `/{domain}/apps/promotion/home`

Regular Voucher:
- `/{domain}/apps/voucher/create?action=create&moduleType=REGULAR_VOUCHER`

Flexi Combo:
- `/{domain}/apps/promotion/flexicombo/create`

Store New Buyer Voucher:
- `/{domain}/apps/voucher/create?action=create&voucherDisplayArea=STORE_NEW_BUYER_ONLY`

Store Follower Voucher:
- `/{domain}/apps/voucher/create?action=create&moduleType=STORE_FOLLOWER_VOUCHER`

## MY / SG Parity

Observed parity:
- Home page tool layout is structurally the same in MY and SG
- The four requested tools exist in both MY and SG
- Regular Voucher create page structure matches between MY and SG
- The main visible difference is currency (`RM` vs `S$`) and smart-value defaults

Conclusion:
- Multi-site support should be implemented as `site -> domain -> path`
- Form-filling logic can be shared, with currency readback treated as display-only

## Regular Voucher

Live page title:
- `Create Regular Voucher - Lazada Seller Center`

Confirmed fields:
- `Promotion Name`
- `Voucher Use Time Type`
- `Voucher Redeem Period`
- `Collect Start Time`
- `Voucher Apply To`
- Discount card switch: `Money Value Off` / `Percentage Discount Off`
- `If Order Min.Spend`
- `Discount would be`
- `Voucher Limit per Customer`
- `Discount Budget`
- `Voucher Budget`

Confirmed options and behavior:
- `Voucher Use Time Type`
- `Fixed time`
- `Use after collection`
- `Voucher Apply To`
- `Entire Shop`
- `Specific Products (Please select products after submission)`
- `Discount Budget`
- `Limited Budget`
- `Unlimited Budget`

Single-control findings:
- Switching `Use after collection` removes `Voucher Redeem Period` and replaces it with:
- `Use Within Days after voucher collection`
- `Collect Time`
- Switching discount card from `Money Value Off` to `Percentage Discount Off` changes:
- `Discount would be` unit from currency to `% off`
- adds `Maximum Discount per Order`
- replaces budget section with `Total Voucher to be Issued`

Automation impact:
- Template must keep conditional fields for fixed-time vs after-collection
- Template must keep conditional fields for money-off vs percent-off
- `Specific Products` is not a same-form inline picker; product selection happens after submission

## Store New Buyer Voucher

Live page title:
- `Create Store New Buyer Voucher - Lazada Seller Center`

Confirmed fields:
- `Promotion Name`
- `Voucher Use Time Type`
- `Voucher Redeem Period`
- `Collect Start Time`
- `Voucher Apply To`
- `Eligible Customer`
- Discount card switch: `Money Value Off` / `Percentage Discount Off`
- `If Order Min.Spend`
- `Discount would be`
- `Total Voucher to be Issued`
- `Voucher Limit per Customer`

Special findings:
- `Eligible Customer` is fixed as `Store New Buyer`
- The page shows inline risk text when discount ratio is high
- After a successful create, Lazada may show a recommendation modal:
- Title: `One last step to feature your Store New Buyer Voucher`
- CTA: `Decorate now`
- The modal has a close icon in the top-right corner
- This modal is post-success guidance, not a required confirmation step

Automation impact:
- No need to expose `Eligible Customer` as a free-form business field
- Keep `Total Voucher to be Issued` in the master template for this tool
- Automation can treat the recommendation modal as a success signal and may close it for cleanup

## Store Follower Voucher

Live page title:
- `Create Store Follower Voucher - Lazada Seller Center`

Confirmed fields:
- `Promotion Name`
- `Voucher Use Time Type`
- `Voucher Redeem Period`
- `Collect Start Time`
- `Voucher Apply To`
- Discount card switch: `Money Value Off` / `Percentage Discount Off`
- `If Order Min.Spend`
- `Discount would be`
- `Total Voucher to be Issued`
- `Voucher Limit per Customer`

Special findings:
- `Specific Products` exists visually but is disabled on the tested page
- Tips panel explains follower-growth use case but does not change core form structure

Automation impact:
- v1 should reject `Specific Products` for Store Follower Voucher

## Flexi Combo

Live page title:
- `Flexi Combo - Lazada Seller Center`

Top-level sections:
- `Basic Promotion Setting`
- `Discount Setting`
- `Product Setting`
- `Tips`

Always-present base fields:
- `Promotion Name`
- `Effective Period`
- `Discount Apply To`
- `Total number of Flexi Combo Orders`

Main type cards discovered:
- `Money/Discount Off`
- `Free gift/sample`
- `Combo Buy`
- `Fixed Price`

### Money/Discount Off

Sub-options:
- `Money Value Off`
- `Percentage Discount Off`

Conditional controls:
- `Stackable Discount` appears in the money-value path
- `Deal Criteria`
- `Item Quantity Reaches X`
- `Order Value Reaches X`
- `Add Tier`

Tier behavior:
- Each click on `Add Tier` appends a new `Tier N` block
- Tier blocks are repeated dynamic sections
- `Item Quantity Reaches X` changes the threshold label to `If quantity value >=`
- `Order Value Reaches X` changes the threshold label to `If order value >=`

Template implication:
- Flexi Combo cannot stay in a single flat row model only
- Use a master sheet plus child tier sheet keyed by `唯一键`

### Free gift/sample

Sub-options:
- `Free Gift(s) only`
- `Free Sample(s) only`

Additional controls:
- `Free Shipping for Gift/Sample`
- `Stackable Discount`
- `Add Free Gift/Sample`
- `Let buyer choose out of free gifts`

Template implication:
- Gift/sample quantity and optional buyer-choice count belong at tier level
- Actual gift-product picker modal still needs a later live-phase probe

### Combo Buy

Sub-options:
- `Percentage Discount Off & Free Gift(s)`
- `Money Value Off & Free Gift(s)`
- `Percentage Discount Off & Free Sample(s)`
- `Money Value Off & Free Sample(s)`

Additional controls:
- `Free Shipping for Gift/Sample`
- `Stackable Discount`
- gift/sample tier block

Template implication:
- Same parent-child model as gift/sample
- Still requires later live-phase work for gift product selection

### Fixed Price

Observed structure:
- no repeated tier list
- `Number of items`
- `Total price`
- `Discount Apply To` is forced to `Specific Products`

Template implication:
- Fixed Price can stay on the master sheet
- It still cannot use the v1 entire-shop-only live path

## First-Pass Automation Scope

Good v1 candidates for live fill:
- Regular Voucher, Entire Shop
- Store New Buyer Voucher, Entire Shop
- Store Follower Voucher, Entire Shop
- Flexi Combo `Money/Discount Off` with tier rows and Entire Shop

Research-complete but live-pending:
- Any `Specific Products` path
- Flexi Combo gift/sample product picker
- Flexi Combo Combo Buy gift/sample product picker
- Flexi Combo Fixed Price product selection

## Template Decision

Workbook shape:
- `Vouchers` sheet: one row per promotion
- `FlexiTiers` sheet: one row per tier, linked by `唯一键`
- `Instructions` sheet: field explanations and allowed values

Why this shape:
- The three voucher tools fit a mostly flat row model with conditional columns
- Flexi Combo has repeated tier blocks and cannot be represented reliably in a single flat sheet

## List Page Findings

Voucher list URL:
- `/{domain}/apps/promotion/voucher/list?moduleType=REGULAR_VOUCHER`
- `/{domain}/apps/promotion/voucher/list?moduleType=STORE_NEW_BUYER_VOUCHER`
- `/{domain}/apps/promotion/voucher/list?moduleType=STORE_FOLLOWER_VOUCHER`

Flexi list URL:
- `/{domain}/apps/promotion/flexicombo/list`

Observed list behavior:
- Voucher list pages can still show mixed voucher tools even when `moduleType` is present
- Row text always contains a stable `ID: {promotion_id}` fragment
- Date range is rendered as `From YYYY-MM-DD HH:mm:ss To YYYY-MM-DD HH:mm:ss`
- Not-started rows expose inline actions such as `Edit`, `Duplicate`, `Deactivate`
- Suspended rows expose `View`, `Duplicate`, `Activate`

Search box findings:
- Voucher list search input placeholder: `Voucher Name / Promotion Id`
- Flexi list search input placeholder: `Promotion Name / Promotion Id`
- The search input is a React `Search` / auto-complete control, not a plain HTML form input
- Direct `input.value=` plus Enter does not reliably trigger filtering

## Conflict Handling Findings

Deactivate flow:
- Clicking `Deactivate` opens a confirm dialog
- Confirm dialog text: `Are you sure to deactivate this promotion`
- Confirm buttons: `Cancel`, `OK`
- On success, the row is usually not removed; status changes from `Not Started` to `Suspended`
- Action set changes from `Deactivate` to `Activate`

Important caveat:
- Lazada may still emit a noisy message like `[CAMPAIGN_STATUS_NOT_VERIFIED]... actual:6` even when the row has already switched to `Suspended`
- Lazada may also emit a lock error like `[R-10004-05-11-002] fail to lock distributeLocker ...` when the same campaign state-change request is already being processed in backend
- Because of that, automation should verify row state and action changes, not rely only on toast text
- In live MY tests, `actual:6` matched the already-suspended outcome after deactivation, so the message behaved like a stale backend validation warning instead of a true rollback
- Result export should treat this as a runtime warning instead of a hard failure when the list row has already become `Suspended` or disappeared
- To avoid self-triggered lock conflicts, the confirm dialog should be acknowledged once and then wait for row-state change instead of repeatedly clicking `OK`

## Flexi Submit Findings

MY:
- `Flexi Combo` submit can succeed through the existing live path after conflicting rows are cleaned up

SG:
- `Flexi Combo` form can remain on the create page with no visible error when the footer `Submit` button is clicked only through DOM / CDP
- The button itself is enabled and the form fields can be fully filled with no inline validation errors
- Triggering the React `onClick` handler on the `Submit` button reliably sends the request and navigates to the list page

Implementation implication:
- Flexi submit should prefer React `onClick`
- CDP click remains useful as a fallback, but should not be the primary submit path for SG
