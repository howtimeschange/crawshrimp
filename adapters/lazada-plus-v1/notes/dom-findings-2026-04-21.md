# Lazada Voucher DOM Findings

Test date: 2026-04-21

Scope:
- Re-probe the actual create flow for `ID / MY / PH / SG / TH / VN`
- Cover four tools:
- `Regular Voucher`
- `Store New Buyer Voucher`
- `Store Follower Voucher`
- `Flexi Combo`
- For voucher pages, verify the real field set after selecting:
- `Entire Shop`
- `Percentage Discount Off`

## Summary

Verified live create-flow sites:
- `MY`
- `PH`
- `SG`
- `TH`
- `VN`

Blocked site in current account:
- `ID`

Main conclusion:
- `MY / PH / SG / TH / VN` can all enter the real create flow.
- After switching to `Entire Shop + Percentage Discount Off`, the voucher pages converge to the same effective field model:
- `Min Spend`
- `Discount`
- `Maximum Discount per Order`
- `Total Voucher to be Issued`
- `Voucher Limit per Customer`
- `VN` was not a missing-field problem on the page itself; the issue was automation stability:
- wrong click target on the discount card
- brittle field lookup on the VN page
- stale create-page reuse across rows
- `ID` is currently not a field-compatibility problem. The platform redirects all tested promotion URLs to `account_health`.

## Entry Results

### MY / PH / SG / TH / VN

Confirmed reachable:
- `apps/promotion/home`
- `apps/promotion/voucher/list?...`
- `apps/voucher/create?...`
- `apps/promotion/flexicombo/create`

Observed titles:
- `Create Regular Voucher - Lazada Seller Center`
- `Create Store New Buyer Voucher - Lazada Seller Center`
- `Create Store Follower Voucher - Lazada Seller Center`
- `Flexi Combo - Lazada Seller Center`

### ID

All tested URLs were redirected to:
- `https://sellercenter.lazada.co.id/apps/seller/account_health`

This includes:
- promotion home
- voucher list
- voucher create
- flexi list
- flexi create

Observed page title:
- `Kesehatan Akun - Lazada Seller Center`

Operational conclusion:
- Current account cannot reach the Lazada promotion workflow on `ID`.
- Adapter should stop early with a clear live-scope warning instead of retrying forever.

## Voucher Page Convergence

Test method:
- Open the real create page
- Click `Entire Shop`
- Click `Percentage Discount Off`
- Read the post-switch field set

Observed convergence on:
- `MY`
- `PH`
- `SG`
- `TH`
- `VN`

Post-switch effective field set:
- `Promotion Name`
- `Voucher Redeem Period`
- `Collect Start Time`
- `Entire Shop`
- `Percentage Discount Off`
- `If Order Min.Spend` or local equivalent
- `Discount would be` or local equivalent
- `Maximum Discount per Order`
- `Total Voucher to be Issued`
- `Voucher Limit per Customer`

Important note:
- Some sites show `Voucher Budget` or `Discount Budget` in the initial default state.
- That is not the effective field set after switching into the tested target flow.
- The live adapter path should therefore key off the post-switch form, not the untouched default card state.

## VN Findings

Page title:
- `Create Regular Voucher - Lazada Seller Center`

Root cause of the earlier failure:
- The page really does expose the target input fields.
- The automation was unstable for three reasons:
- it could click the label leaf instead of the actual radio/card container
- it relied on brittle label-container lookup on VN
- it could reuse a dirty create page from the previous row

Fixes applied:
- click the real radio/card container instead of the text leaf
- add VN-specific section-based input lookup for the percentage-discount block
- relax numeric write-back verification for formatted values like `500000` vs `500,000`
- force a create-page refresh before continuing later rows

Validation result:
- VN two-row live replay succeeded

## Flexi Combo Findings

Reachable and consistent on:
- `MY`
- `PH`
- `SG`
- `TH`
- `VN`

Observed stable elements:
- title `Flexi Combo - Lazada Seller Center`
- `Promotion Name`
- `Effective Period`
- `Money/Discount Off`
- `Percentage Discount Off`
- `Entire Shop`
- `Add Tier`
- `Total number of Flexi Combo Orders`
- placeholders such as `Quantity Value, eg. 3` and `Discount value, eg. 5`

## Compatibility Matrix

`Regular Voucher`
- `MY / PH / SG / TH / VN`: reachable and flow-probed
- `ID`: blocked by account-health redirect

`Store New Buyer Voucher`
- `MY / PH / SG / TH / VN`: reachable and flow-probed
- `ID`: blocked by account-health redirect

`Store Follower Voucher`
- `MY / PH / SG / TH / VN`: reachable and flow-probed
- `ID`: blocked by account-health redirect

`Flexi Combo`
- `MY / PH / SG / TH / VN`: reachable and flow-probed
- `ID`: blocked by account-health redirect

## Runtime Implication

Adapter policy after this round:
- keep `MY / PH / SG / TH / VN` in verified live scope
- explicitly fail fast for `ID` with an account-health redirect explanation
- treat `VN` as a supported live site
