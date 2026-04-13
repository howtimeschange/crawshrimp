# Phase / Shared / Live Contract

Use this note when modifying crawshrimp adapter execution flow.

## 1. Design phases around business steps

Good phase boundaries:

- `ensure_target`
- `prepare_query`
- `collect_page`
- `open_detail`
- `collect_detail_combo`
- `advance_cursor`

Bad phase boundaries:

- `click_input`
- `open_dropdown`
- `choose_one_option`
- `sleep_again`

If a phase name describes a tiny UI gesture instead of a business step, it is probably too small.

## 2. `meta.shared` is the source of truth

Every phase transition should return the latest business context in `meta.shared`.

Typical `shared` fields:

- `targetOuterSites`
- `targetOuterSite`
- `currentOuterSite`
- `timeDimension`
- `timeDimensionLabel`
- `currentPageNo`
- `totalPages`
- `current_exec_no`
- `current_row_no`
- `current_buyer_id`
- `current_store`
- `batch_no`
- `total_batches`

Rule:

- If the next phase still needs it, write it into `shared`.
- If a retry or reload should resume the same context, preserve it in `shared`.

## 3. Live progress is derived, not hand-authored

In crawshrimp, frontend live progress is derived from `shared` plus the current accumulated `data.length`.

Prefer these standard fields:

| `shared` field | Meaning |
|---|---|
| `total_rows` | Total logical rows in this run |
| `current_exec_no` | Current logical row number, 1-based |
| `current_row_no` | Source spreadsheet row number |
| `current_buyer_id` | Current target identifier such as buyer ID or SPU |
| `current_store` | Current store, site, scope, or other user-facing context |
| `batch_no` | Current sub-progress index within the current item |
| `total_batches` | Total sub-progress count within the current item |

Rules:

- Increment `current_exec_no` only when advancing to the next logical row or target.
- Use `batch_no / total_batches` for second-level progress inside the current row.
- Do not fake `total_rows` for unknown-total tasks.
- Do not hand-build `percent` or `progress_text`; let the backend derive them.

## 4. Recommended helper shape

```js
function nextPhase(name, sleepMs = 800, newShared = shared, data = []) {
  return {
    success: true,
    data,
    meta: {
      action: 'next_phase',
      next_phase: name,
      sleep_ms: sleepMs,
      shared: newShared,
    },
  }
}
```

For click-driven transitions:

```js
function cdpClicks(clicks, nextPhaseName, sleepMs = 300, newShared = shared, data = []) {
  return {
    success: true,
    data,
    meta: {
      action: 'cdp_clicks',
      clicks,
      next_phase: nextPhaseName,
      sleep_ms: sleepMs,
      shared: newShared,
    },
  }
}
```

For row completion:

```js
function complete(data = [], newShared = shared) {
  return {
    success: true,
    data,
    meta: {
      action: 'complete',
      has_more: false,
      shared: newShared,
    },
  }
}
```

Keep helper behavior consistent:

- transitions should always carry `shared`
- helpers should encode the protocol shape once
- phases should talk in business steps, not raw action objects everywhere

For row-based tasks:

```js
return nextPhase('prepare_row', 0, {
  ...shared,
  total_rows: rows.length,
  current_exec_no: rowIndex + 1,
  current_row_no: Number(row?.row_no || rowIndex + 1),
  current_buyer_id: row?.buyer_id || row?.spu || '',
  current_store: row?.store || row?.outerSite || '',
})
```

For second-level detail progress:

```js
return nextPhase('collect_detail_combo', 600, {
  ...shared,
  batch_no: comboIndex + 1,
  total_batches: totalCombos,
  current_store: [shared.currentOuterSite || '', combo.site || '', combo.grain || '']
    .filter(Boolean)
    .join(' / '),
})
```

## 5. Shared merge and naming discipline

When updating `shared`:

- start from `...shared` unless you are intentionally resetting a field
- preserve stable user choices and current business identity through retries
- clear one-shot recovery flags only after the recovery branch is consumed

For unknown-total tasks:

- do not fabricate `total_rows`
- keep emitting stable `current_buyer_id`, `current_store`, `batch_no`, and `total_batches` when they exist
- let backend `live.records` represent forward motion if total percent is not bounded

Useful naming habit:

- use `current*` for current business identity
- use `target*` for requested scope or destination
- use `recover*` or `pending*` for one-shot recovery context
- use `retry*` only for counters or retry buckets

## 6. Common mistakes

- Letting DOM state become the only source of truth after a site switch.
- Increasing `current_exec_no` during retries of the same row.
- Replacing `shared` with a partial object and accidentally dropping user selections.
- Using `batch_no` to represent total rows.
- Making phases depend on stale DOM references after re-render.
