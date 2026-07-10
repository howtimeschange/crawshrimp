# AI Image Batch Per-Prompt Count Design

## Goal

Extend the AI image workbench batch-generation dialog so the dialog owns the model settings for the current batch and each Prompt can request its own image count.

The feature must preserve the existing asynchronous workflow: the frontend submits the whole batch once, the backend concurrently creates the corresponding 1XM tasks, persists each `task_id` / `poll_url` / `poll_after`, returns without waiting for image completion, and the frontend polls only the local backend.

## Product Rules

- The batch dialog has an independent model-settings snapshot.
- Opening the dialog copies the current outside settings as initial values.
- Editing batch settings does not change the outside “下次生成参数” form.
- A batch may contain at most 20 Prompt cards in the frontend.
- Every Prompt card has its own image-count field with a default of 1.
- GPT-Image-2 Prompt counts accept integers from 1 through 8.
- Nano Banana Prompt counts are fixed at 1 and cannot be edited, matching the existing single-generation behavior.
- One Prompt remains one workbench generation record.
- One GPT Prompt remains one 1XM asynchronous task; its requested count is sent as `n`.
- One Nano Banana Prompt remains one 1XM asynchronous task and one requested image.
- The AI 测图 implementation and `core.one_xm_image.run_image_task_until_done()` remain unchanged.

## Batch Dialog UX

### Independent model settings

Add a “本次批量生成参数” section in the batch dialog's left column below the main-image and reference-image controls. It mirrors the outside settings:

- Model
- Ratio
- Size for GPT or resolution for Nano Banana
- Quality for GPT
- Output format for GPT
- Key status

The controls use the existing model utilities and option lists so model, ratio, size, quality, format, and key availability behave consistently with the outside form. Switching model or ratio recalculates compatible defaults inside the batch snapshot only.

There is no batch-wide count control in the left column because image count belongs to each Prompt card.

### Per-Prompt count

Each Prompt card adds a compact “生成张数” numeric input near its action/status row:

- Default: 1
- GPT: enabled, minimum 1, maximum 8
- Nano Banana: value forced to 1, disabled, with a short explanation that each task generates one image

Creating a new card starts with count 1. Selecting a Prompt-library item changes only the card title and Prompt text; it does not reset the card count.

### Batch summaries

The dialog shows both:

- Number of valid Prompt cards
- Estimated total image count, calculated by summing normalized counts for valid Prompt cards

Copy that currently says every Prompt is fixed to one image is replaced with dynamic text such as “3 条 Prompt，预计生成 7 张图”. Empty Prompt cards do not contribute to either count.

## Frontend State and Submission

The batch-dialog state gains independent fields equivalent to the outside form:

```text
modelId
ratio
size
quality
format
model key metadata derived from modelId
```

Each Prompt card gains:

```json
{
  "id": "batch-prompt-...",
  "title": "Prompt 1",
  "prompt": "...",
  "count": 1
}
```

When the dialog opens, model settings are copied from `formSnapshot()`. Subsequent batch-setting changes stay in `batchGenerationDialog` and do not write back to `form`.

Submission updates the current job with the batch snapshot's shared model parameters, then makes one call to the existing batch endpoint. Each valid Prompt is sent as:

```json
{
  "title": "Prompt 1",
  "prompt": "...",
  "count": 4
}
```

The frontend still returns to the workbench immediately after the backend accepts the batch and starts polling the local job once per second while active runs exist.

## Backend API and Validation

`AiImageBatchPromptRequest` gains `count: int = 1`.

The service normalizes every submitted count to an integer from 1 through 8. Missing, zero, or negative values become 1; values above 8 become 8. The typed API rejects non-integer payloads. If the selected job model is Nano Banana, the normalized count is always 1.

The backend continues to enforce 1–100 Prompt items at its API boundary. This is a provider-submission safety limit and remains separate from the frontend's 20-card UX limit.

## Provider Task Creation

`submit_workbench_batch()` continues to create exactly one run and one provider task for each valid Prompt.

Each run persists `requested_count` alongside its existing batch metadata:

```json
{
  "run_uid": "...",
  "batch_uid": "...",
  "batch_index": 0,
  "title": "Prompt 1",
  "prompt": "...",
  "requested_count": 4,
  "status": "queued",
  "task_id": "...",
  "poll_url": "...",
  "poll_after": 5
}
```

For GPT-Image-2, the per-run provider payload contains `n: requested_count`. For Nano Banana, the provider payload contains no `n`, and `requested_count` is 1.

All provider-task creation requests are submitted concurrently as they are today. The backend does not implement a local five-task scheduler; 1XM owns its processing queue. A create failure affects only its corresponding run and does not block sibling runs.

## Queue and Result Rendering

One Prompt stays one queue/generation record even when it requests multiple images.

While a run is queued or running, the UI renders `requested_count` loading cards inside that run so the user can see how many images are expected. The cards reuse the contextual main/reference/text loading artwork and rotating Crawshrimp copy.

When provider results arrive, the run's actual result cards replace its loading cards. Result URLs are capped to the run's requested count before being persisted and rendered, preventing unexpected provider over-return from adding extra images.

If the run fails, the UI shows one failed run card with the error instead of duplicating the same error for every requested image.

## Idempotency and Compatibility

- Existing batch request idempotency remains based on `request_uid`.
- Repeating the same `request_uid` returns the already-created runs, including their persisted `requested_count`.
- Older runs without `requested_count` are treated as requesting 1 image.
- Existing completed runs and task history require no migration.
- The batch endpoint and Electron/dev bridges keep the same route and method names; only the Prompt item payload is extended.

## Error Handling

- A missing model key blocks submission and directs the user to settings, matching single generation.
- A batch with no valid Prompt text is rejected before submission.
- Counts are normalized at both the frontend display/submission boundary and the backend trust boundary; malformed non-integer API values are rejected.
- A provider create failure is persisted on the affected run while siblings continue.
- Polling honors provider `poll_after` and does not introduce faster 1XM polling.

## Testing

Frontend contract tests cover:

- Independent batch model-setting fields and model-specific visibility
- Dialog initialization from the outside form without two-way coupling
- Per-card count defaults and GPT 1–8 constraints
- Nano Banana count fixed at 1
- Valid Prompt count and estimated image total
- Submission of `{ title, prompt, count }` in one batch API call
- Multiple loading cards for a multi-image run

Backend tests cover:

- GPT Prompt counts produce one provider task per Prompt with the correct `n`
- `requested_count` is persisted on each run
- Different Prompt cards can request different counts
- Nano Banana forces count 1 and omits `n`
- Missing and non-positive counts fall back to 1; values above 8 are capped and malformed API values are rejected
- Idempotent replay preserves counts
- Provider over-return is capped to `requested_count`
- Existing concurrent submission, partial failure, and `poll_after` behavior remains intact

Regression validation includes the AI image workbench frontend tests, Vite build, AI image service/batch tests, 1XM client tests, and AI 测图 chain tests.

## Non-Goals

- No per-Prompt model, ratio, size, quality, or format; those remain shared for the batch.
- No batch-wide image-count override.
- No expansion of one Prompt into multiple Nano Banana tasks.
- No change to 1XM's queue, concurrency, or polling contract.
- No change to AI 测图 execution methods.
