---
name: debug-interactive-bug
description: Use this skill for flaky browser, UI automation, or stateful workflow bugs where clicks, menus, dialogs, overlays, pagination, retries, or submit flows behave differently on the real page than in DOM-only reasoning. Especially useful when the same old row is re-matched, dialogs stack, CDP and DOM clicks differ, or batch reruns hide the true failing interaction chain.
---

# Debug Interactive Bug

## Overview

Use this skill for interactive bugs that depend on the real page, not just the code. The goal is to prove the exact failing interaction chain on a clean page before changing production logic.

## When To Use

Use this skill when the bug involves any of these:

- Browser automation or UI scripts
- Buttons that appear but do not actually trigger the intended action
- Menus, overlays, dialogs, confirm modals, or stacked popups
- DOM clicks working in tests but failing on the real page
- CDP/native clicks behaving differently from synthetic clicks
- Pagination, tab switching, or list refresh issues
- Retry loops that keep hitting the same old row
- Batch workflows where one primitive interaction failure poisons later steps

Do not use this as a generic debugging checklist for pure backend or pure algorithm bugs.

## Workflow

### 1. Split The Problem Into Exact Interaction Chains

Write each chain as a separate path.

Examples:

- `进行中的活动 -> 更多 -> 结束 -> 弹窗结束`
- `接下来的活动 -> 删除 -> 弹窗删除`
- `提交时报重复 -> 回列表补清 -> 再创建`

Do not mix multiple chains into one bug. Fix one chain at a time.

### 2. Establish A Clean Repro Surface

Before patching anything:

- Stop any active task runs that may keep mutating the page
- Clear leftover dialogs or overlays first
- Use one known row or one known code as the repro target
- Prefer a single-row or single-case repro over rerunning the whole batch

If the page is already polluted by previous failed attempts, reset the page state before drawing conclusions.

### 3. Probe Reality Before Editing Code

Use the real page first. Do not infer from DOM structure alone.

For the target chain, capture:

- The exact row that should be acted on
- Every candidate node for the action
  Example: wrapper, dropdown item, inner button, span
- Which node actually consumes the click on the real page
- What appears after each click
  Example: menu opens, dialog opens, toast appears, nothing changes
- Whether the post-action state truly changed
  Example: dialog closed, row disappeared, page refreshed, status changed

For destructive actions, prefer an "open and cancel" probe first:

- Open the menu or dialog
- Inspect the real confirm buttons
- Close with `Cancel` or equivalent
- Only then patch the destructive path

### 4. Diagnose The Failure Class

Classify the bug before fixing it.

Common classes:

- **Find bug**: wrong row or wrong voucher type matched
- **Target bug**: found the right row but clicked the wrong node
- **Layer bug**: clicked a lower dialog or another row's visible button
- **State bug**: action succeeded but script did not detect the new state
- **Refresh bug**: action succeeded but the list stayed stale and the same row was re-matched
- **Workflow bug**: submit-time conflict requires a different cleanup path than pre-submit conflict

Do not add retries until the failure class is known.

### 5. Patch The Smallest Proven Path

Only encode behavior that was proven on the real page.

Typical order:

- Prefer the real click primitive that worked
  Example: CDP click over synthetic DOM click
- Prefer the real node that worked
  Example: wrapper over inner button
- Prefer the topmost active dialog over any earlier stacked dialog
- If a dialog is already open, resolve that dialog first before clicking more row actions

Do not generalize across unrelated chains until each chain is separately proven.

### 6. Encode State Transitions Explicitly

For multi-step flows, persist the interaction step so re-entry is deterministic.

Examples:

- `menu_opened`
- `dialog_opened`
- `confirm_pending`

On re-entry:

- If the expected dialog already exists, confirm it first
- Do not click the row action again if doing so would stack another dialog

### 7. Validate In The Right Order

Validation order:

1. Real-page single-case repro
2. Minimal automated test mirroring the proven chain
3. Narrow rerun on the affected rows only
4. Full batch only after the primitive interaction is stable

Do not use full-batch reruns to discover primitive click behavior.

## Hard Rules

- Never patch first and probe later for page-interaction bugs.
- Never treat `结束` and `删除` as the same bug unless both chains were separately verified.
- Never assume the visible text node is the click target.
- Never keep clicking row actions while a confirm dialog is already open.
- Never treat "dialog appeared" as success; verify the confirm action actually completed.
- Never treat "clicked confirm" as success; verify the dialog closed and the page state changed.
- Never debug a primitive interaction on a dirty page if you can reproduce it on a clean one.

## Deliverables

When using this skill, produce:

- The exact failing interaction chain
- The exact real-page node that must be clicked at each step
- The observed post-click state transition
- The minimum code change needed
- The single-case validation result
- Any remaining exposure that still depends on unproven real-page behavior

## Anti-Patterns

Avoid these failure modes:

- "I already know which button it is from the HTML"
- "Let's just add more retries"
- "Let's rerun the full sheet and see what happens"
- "This should work for delete because it worked for end"
- "The modal is open, so the click was correct"
- "The script is looping, so it must not have found the row"

For this class of bug, reality beats theory. Probe first, patch second.
