# Cloud Approval Embedded AI Test Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the cloud approval workbench log in reliably inside Crawshrimp, visually merge it with the Crawshrimp shell, and extend it into two MVP AI-test loops: source-asset/generation/review/submit and material-test data crawl/dashboard.

**Architecture:** Keep `https://approval.crawshrimp.com` as the independent multi-user cloud web app, but add an embedded mode for Crawshrimp that removes the cloud sidebar and uses top tabs plus Crawshrimp visual tokens. Keep local-only dependencies local: Semir cloud-drive lookup, 1XM image generation, Tmall upload, and Tmall data export run on authorized task machines; the cloud owns shared state, Prompt templates, review decisions, dispatch jobs, assets, and dashboards.

**Tech Stack:** Electron 29, Vue 3, Vite, Python FastAPI, Cloudflare Workers, D1, R2, TypeScript, Vitest, Python unittest, existing Crawshrimp task-machine job queue.

## Global Constraints

- Work only in branch/worktree `codex/cloud-approval-workbench` at `/Users/xingyicheng/Documents/crawshrimp/.worktrees/cloud-approval-workbench`.
- Do not commit `.crawshrimp-runtime/`, tokens, cookies, generated SQL with passwords, Cloudflare API tokens, machine tokens, or admin session cookies.
- Preserve the independent cloud URL while making the embedded surface feel native inside Crawshrimp.
- Accounts are administrator-created only; no public registration.
- Task machines must use registration token plus machine token; user session and machine token stay separate.
- Cloud dispatch must use job state machine, lease renewal, cancellation, idempotency, and audit logs.
- First MVP must be tested with `/Users/xingyicheng/Downloads/AI测图任务导入模板.xlsx`.
- Prompt library import defaults must be based on `/Users/xingyicheng/Downloads/AI 测图提示词库.xlsx`.
- Data dashboard schema must be based on `/Users/xingyicheng/Downloads/天猫测图数据抓取导出_20260701-183953.xlsx`.

---

## File Map

### Embedded Auth And Shell

- Modify `cloud/approval-workbench/src/worker/auth-routes.ts`: make session Cookie embeddable or environment-aware.
- Modify `cloud/approval-workbench/src/tests/auth-routes.test.ts`: cover `SameSite=None; Secure` embedded session Cookie behavior.
- Modify `cloud/approval-workbench/src/app/App.vue`: top-tab app shell, `embed=1` mode, no sidebar.
- Modify `cloud/approval-workbench/src/app/views/LoginView.vue`: Crawshrimp-aligned login UI and visible error/success states.
- Modify `cloud/approval-workbench/src/tests/ui-contract.test.ts`: lock embedded shell copy/classes/query behavior.
- Modify `app/src/renderer/views/CloudApprovalFrame.vue`: remove framed toolbar, pass `embed=1`, use full-height right workspace, show compact machine status only when needed.
- Modify `app/src/renderer/App.vue`: keep only Crawshrimp's left menu as the sidebar.

### Prompt Library

- Modify `cloud/approval-workbench/package.json`: add browser-side XLSX dependency if chosen for import/export.
- Modify `cloud/approval-workbench/migrations/0002_prompt_excel_fields.sql`: add Excel-source fields to prompt templates.
- Modify `cloud/approval-workbench/src/worker/prompt-routes.ts`: add bulk upsert/export JSON endpoints and metadata fields.
- Modify `cloud/approval-workbench/src/app/views/PromptLibraryView.vue`: online table editor, import, export, batch save, publish.
- Add `cloud/approval-workbench/src/app/promptExcel.ts`: parse/export workbook rows in the browser.
- Modify `cloud/approval-workbench/src/tests/prompts.test.ts`: cover Excel-shaped bulk import, update, resolve, publish.
- Add `cloud/approval-workbench/src/tests/prompt-excel.test.ts`: cover header-row detection and field mapping.

### Cloud Asset Library And Online Generation

- Modify `cloud/approval-workbench/migrations/0003_generation_and_resources.sql`: image resources, generation jobs, scheduled crawl tables.
- Modify `cloud/approval-workbench/src/worker/asset-routes.ts`: expose batch resource listing and manual source/reference uploads.
- Modify `cloud/approval-workbench/src/worker/batch-routes.ts`: create `generate_ai_image` jobs and append generated assets.
- Modify `cloud/approval-workbench/src/worker/machine-routes.ts`: support `generate_ai_image`, `crawl_tmall_material_test_data`, cancellation, and job filtering by capability.
- Modify `core/cloud_job_executors.py`: add `execute_generate_ai_image` and `execute_crawl_tmall_material_test_data`.
- Modify `core/cloud_machine_agent.py`: honor cancel requests at safe checkpoints.
- Modify `app/src/renderer/views/SettingsPage.vue`: add new machine capability checkboxes.
- Add `cloud/approval-workbench/src/app/views/OnlineGenerationView.vue`: cloud-side AI generation UI.
- Modify `cloud/approval-workbench/src/app/views/BatchReviewView.vue`: prompt switch, batch rerun, append new generated image.

### Material-Test Data Dashboard

- Modify `cloud/approval-workbench/migrations/0004_material_test_data.sql`: task overview, material detail fact table, crawl jobs.
- Add `cloud/approval-workbench/src/worker/material-data-routes.ts`: import parsed rows, list dashboard metrics, create crawl job, schedule crawl.
- Modify `cloud/approval-workbench/src/worker/index.ts`: register material data routes.
- Add `cloud/approval-workbench/src/app/views/MaterialDataDashboardView.vue`: task board, metrics, image-level table, crawl controls.
- Add `cloud/approval-workbench/src/app/materialDataImport.ts`: parse the exported workbook schema in browser for manual import tests.
- Modify `cloud/approval-workbench/src/app/App.vue`: add top tab `测图数据`.
- Modify `core/cloud_job_executors.py`: upload workbook artifact and parsed summary/detail rows after local data export.
- Modify `adapters/tmall-ops-assistant/manifest.yaml`: ensure task-machine capability names include data crawl.

### End-To-End And Deployment

- Modify `scripts/cloud_approval_dry_run.py`: cover embedded login smoke, generation job, submit job, and material data import.
- Add or modify `tests/test_cloud_job_executors.py`: generation/data-crawl executor tests.
- Add or modify `tests/test_cloud_machine_agent.py`: cancellation, capabilities, claim behavior.
- Add `docs/cloud-approval-workbench-runbook.md` sections: embedded mode, Prompt import/export, data crawl.
- Use `cloud/approval-workbench` scripts: `npm run typecheck`, `npm run test`, `npm run build`.
- Use root tests: targeted Python unit tests and `git diff --check`.
- Deploy Worker only after local checks pass.

## Task 1: Reproduce And Fix Embedded Login

**Files:**
- Modify: `cloud/approval-workbench/src/worker/auth-routes.ts`
- Modify: `cloud/approval-workbench/src/tests/auth-routes.test.ts`
- Modify: `app/src/renderer/views/CloudApprovalFrame.vue`

**Interfaces:**
- Produces: session Cookie usable in embedded iframe mode.
- Produces: `CloudApprovalFrame` loads `${baseUrl}/?embed=1` without visual chrome.

- [ ] **Step 1: Add a failing auth Cookie test**

In `cloud/approval-workbench/src/tests/auth-routes.test.ts`, add a test that calls `POST /api/auth/login` and asserts the `set-cookie` header contains:

```ts
expect(cookie).toContain('HttpOnly')
expect(cookie).toContain('Secure')
expect(cookie).toContain('SameSite=None')
```

Run:

```bash
cd /Users/xingyicheng/Documents/crawshrimp/.worktrees/cloud-approval-workbench/cloud/approval-workbench
npm run test -- src/tests/auth-routes.test.ts
```

Expected: fail because the cookie currently contains `SameSite=Lax`.

- [ ] **Step 2: Update session Cookie generation**

Change `sessionCookie()` and `expiredSessionCookie()` in `auth-routes.ts` to use an embeddable policy:

```ts
function cookieAttributes(ttlSeconds: number): string {
  return `Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${ttlSeconds}`
}
```

Use the same `SameSite=None` path for logout expiration.

- [ ] **Step 3: Run auth tests**

Run:

```bash
npm run test -- src/tests/auth-routes.test.ts
```

Expected: pass.

- [ ] **Step 4: Make Crawshrimp load embedded mode**

In `app/src/renderer/views/CloudApprovalFrame.vue`, compute an embedded URL:

```js
const embeddedUrl = computed(() => {
  const raw = cloudUrl.value
  if (!raw) return ''
  const url = new URL(raw)
  url.searchParams.set('embed', '1')
  return url.toString()
})
```

Use `embeddedUrl` for iframe `src`. Remove the toolbar and iframe border from the default layout; keep only a compact error/empty state when cloud URL is missing.

- [ ] **Step 5: Add renderer smoke coverage**

Extend an existing renderer utility/UI contract test or add a small test that verifies the URL builder appends `embed=1` while preserving `batch_uid`.

- [ ] **Step 6: Verify locally**

Run:

```bash
cd /Users/xingyicheng/Documents/crawshrimp/.worktrees/cloud-approval-workbench/cloud/approval-workbench
npm run test
npm run build
cd /Users/xingyicheng/Documents/crawshrimp/.worktrees/cloud-approval-workbench/app
npm test
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit**

```bash
git add cloud/approval-workbench/src/worker/auth-routes.ts cloud/approval-workbench/src/tests/auth-routes.test.ts app/src/renderer/views/CloudApprovalFrame.vue app/src/renderer/**/*.test.*
git commit -m "fix(cloud): support embedded approval login"
```

## Task 2: Redesign Cloud App Shell For Embedded And Standalone Use

**Files:**
- Modify: `cloud/approval-workbench/src/app/App.vue`
- Modify: `cloud/approval-workbench/src/app/views/LoginView.vue`
- Modify: `cloud/approval-workbench/src/tests/ui-contract.test.ts`

**Interfaces:**
- Consumes: `embed=1` query from Task 1.
- Produces: top-tab navigation with no internal sidebar.

- [ ] **Step 1: Add UI contract tests**

Add tests that read `src/app/App.vue` and assert:

```ts
expect(source).toContain('URLSearchParams')
expect(source).toContain('embed')
expect(source).toContain('top-tabs')
expect(source).not.toContain('side-nav')
```

Run:

```bash
npm run test -- src/tests/ui-contract.test.ts
```

Expected: fail while the sidebar shell remains.

- [ ] **Step 2: Replace sidebar with top tabs**

In `App.vue`, compute `isEmbedded` from `window.location.search`. Render:

- standalone: compact top header with account/logout and top tabs.
- embedded: no brand sidebar, no tall page chrome, content fills available height.

Use tab labels:

```ts
const navItems = [
  { key: 'dashboard', label: '总览', permission: 'dashboard:read' },
  { key: 'batches', label: '审批批次', permission: 'batches:read' },
  { key: 'review', label: '批次审图', permission: 'batches:read' },
  { key: 'generate', label: 'AI 生图', permission: 'jobs:regenerate' },
  { key: 'prompts', label: 'Prompt 库', permission: 'prompts:read' },
  { key: 'materialData', label: '测图数据', permission: 'dashboard:read' },
  { key: 'machines', label: '任务机', permission: 'machines:read' },
  { key: 'users', label: '账号', permission: 'users:write' },
]
```

- [ ] **Step 3: Align visual tokens to Crawshrimp**

Replace cloud blue/nav-heavy palette with Crawshrimp-compatible tokens:

```css
:root {
  color-scheme: dark;
  --orange: #ff6b2b;
  --orange-bg: rgba(255, 107, 43, 0.12);
  --bg: #141418;
  --bg2: #1c1c22;
  --bg3: #242430;
  --border: #2e2e3a;
  --text: #e2e0f0;
  --text2: #8b8aa0;
  --text3: #555468;
  --green: #4ade80;
  --red: #f87171;
}
```

Keep product UI compact: 8px radius, no nested cards, no display hero copy.

- [ ] **Step 4: Update login page**

Make `LoginView.vue` use the same compact workbench style, show errors visibly, and keep labels Chinese:

- `邮箱`
- `密码`
- `登录`
- `登录中...`

- [ ] **Step 5: Verify contrast and responsive behavior**

Run the cloud app locally and inspect:

```bash
npm run dev
```

Manually verify both:

- `http://127.0.0.1:<wrangler-port>/`
- `http://127.0.0.1:<wrangler-port>/?embed=1`

- [ ] **Step 6: Run checks and commit**

```bash
npm run typecheck
npm run test
npm run build
git add cloud/approval-workbench/src/app/App.vue cloud/approval-workbench/src/app/views/LoginView.vue cloud/approval-workbench/src/tests/ui-contract.test.ts
git commit -m "feat(cloud): add Crawshrimp embedded workbench shell"
```

## Task 3: Prompt Library Excel Import, Export, And Online Table Editing

**Files:**
- Modify: `cloud/approval-workbench/package.json`
- Add: `cloud/approval-workbench/migrations/0002_prompt_excel_fields.sql`
- Modify: `cloud/approval-workbench/src/worker/prompt-routes.ts`
- Modify: `cloud/approval-workbench/src/app/views/PromptLibraryView.vue`
- Add: `cloud/approval-workbench/src/app/promptExcel.ts`
- Add: `cloud/approval-workbench/src/tests/prompt-excel.test.ts`
- Modify: `cloud/approval-workbench/src/tests/prompts.test.ts`

**Interfaces:**
- Consumes: Excel fields from `/Users/xingyicheng/Downloads/AI 测图提示词库.xlsx`.
- Produces: `PromptTemplateExcelRow` with fields `group_name`, `field_name`, `source_field_id`, `field_order`, `visible`, `size_label`, `output_format`, `reference_fields`, `prompt_text`, `word_count`, `field_type`, `female_priority`, `male_neutral_priority`, `enabled`.

- [ ] **Step 1: Add failing parser tests**

Create `prompt-excel.test.ts` with sample rows matching the real workbook:

```ts
import { describe, expect, it } from 'vitest'
import { rowsToPromptTemplates } from '../app/promptExcel'

describe('prompt Excel mapping', () => {
  it('maps the row-4 header format from the AI prompt workbook', () => {
    const rows = [
      ['上装 字段描述'],
      ['Sheet ID：hERWDMS ｜ 记录数：233 ｜ AI 描述字段数：13'],
      [],
      ['字段名', '字段 ID', '字段顺序', '在当前视图', '尺寸', '格式', '引用字段', '描述内容', '字数', '字段类型', '女性优先度', '男性/中性优先度'],
      ['正面标准站姿', 'rX2NWyE', '4', '是', '2K', 'jpeg', '图片 (ghzXVED)', '引用图片，8K 超清', '159', 'file', '1', '2'],
    ]
    const templates = rowsToPromptTemplates('上装', rows)
    expect(templates[0]).toMatchObject({
      group_name: '上装',
      field_name: '正面标准站姿',
      source_field_id: 'rX2NWyE',
      prompt_text: '引用图片，8K 超清',
      size_label: '2K',
      output_format: 'jpeg',
      female_priority: 1,
      male_neutral_priority: 2,
    })
  })
})
```

Run:

```bash
npm run test -- src/tests/prompt-excel.test.ts
```

Expected: fail because `promptExcel.ts` does not exist.

- [ ] **Step 2: Add browser workbook parsing/export utility**

Add a small browser-side XLSX dependency or keep import JSON-only if bundle size blocks deployment. Preferred MVP: add `xlsx` to cloud app dependencies and implement:

```ts
export interface PromptTemplateExcelRow {
  group_name: string
  field_name: string
  source_field_id: string
  field_order: number | null
  visible: boolean
  size_label: string
  output_format: string
  reference_fields: string
  prompt_text: string
  word_count: number | null
  field_type: string
  female_priority: number | null
  male_neutral_priority: number | null
  enabled: boolean
}
```

Functions:

- `rowsToPromptTemplates(sheetName: string, rows: unknown[][]): PromptTemplateExcelRow[]`
- `parsePromptWorkbook(file: File): Promise<PromptTemplateExcelRow[]>`
- `exportPromptWorkbook(libraryName: string, rows: PromptTemplateExcelRow[]): void`

- [ ] **Step 3: Add migration fields**

Create `0002_prompt_excel_fields.sql`:

```sql
ALTER TABLE prompt_templates ADD COLUMN source_field_id TEXT NOT NULL DEFAULT '';
ALTER TABLE prompt_templates ADD COLUMN field_order INTEGER;
ALTER TABLE prompt_templates ADD COLUMN visible INTEGER NOT NULL DEFAULT 1;
ALTER TABLE prompt_templates ADD COLUMN reference_fields_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE prompt_templates ADD COLUMN word_count INTEGER;
ALTER TABLE prompt_templates ADD COLUMN field_type TEXT NOT NULL DEFAULT '';
ALTER TABLE prompt_templates ADD COLUMN excel_meta_json TEXT NOT NULL DEFAULT '{}';
```

- [ ] **Step 4: Add bulk upsert endpoint**

In `prompt-routes.ts`, add:

```http
POST /api/prompt-libraries/import
POST /api/prompt-libraries/{id}/templates/bulk
GET  /api/prompt-libraries/{id}/export
```

The import payload is JSON from the browser parser, not raw XLSX bytes.

- [ ] **Step 5: Redesign PromptLibraryView**

Replace the side editor with a spreadsheet-like table:

- import button
- export button
- library selector
- scenario selector
- inline cells for field name, group, size, format, prompt, priorities, enabled
- batch save
- publish version

Avoid modals for normal editing. Use a drawer or expanded row only for long Prompt text.

- [ ] **Step 6: Seed default Prompt library**

Add a script or test helper that imports `/Users/xingyicheng/Downloads/AI 测图提示词库.xlsx` in local development and creates a published default library named `AI 测图提示词库 默认版`.

- [ ] **Step 7: Verify and commit**

```bash
npm run typecheck
npm run test -- src/tests/prompts.test.ts src/tests/prompt-excel.test.ts
npm run build
git add cloud/approval-workbench/package.json cloud/approval-workbench/package-lock.json cloud/approval-workbench/migrations/0002_prompt_excel_fields.sql cloud/approval-workbench/src/worker/prompt-routes.ts cloud/approval-workbench/src/app/views/PromptLibraryView.vue cloud/approval-workbench/src/app/promptExcel.ts cloud/approval-workbench/src/tests/prompts.test.ts cloud/approval-workbench/src/tests/prompt-excel.test.ts
git commit -m "feat(cloud): add prompt library Excel workflow"
```

## Task 4: Cloud Online AI Generation And Batch Rerun

**Files:**
- Add: `cloud/approval-workbench/migrations/0003_generation_jobs.sql`
- Modify: `cloud/approval-workbench/src/worker/batch-routes.ts`
- Modify: `cloud/approval-workbench/src/worker/machine-routes.ts`
- Modify: `cloud/approval-workbench/src/worker/security/rbac.ts`
- Modify: `core/cloud_job_executors.py`
- Modify: `core/cloud_machine_agent.py`
- Add: `cloud/approval-workbench/src/app/views/OnlineGenerationView.vue`
- Modify: `cloud/approval-workbench/src/app/views/BatchReviewView.vue`
- Modify: `cloud/approval-workbench/src/tests/review.test.ts`
- Modify: `tests/test_cloud_job_executors.py`

**Interfaces:**
- Produces job type: `generate_ai_image`.
- Consumes capabilities: `generate_ai_image`, `regenerate_ai_image`.
- Appends new `ai_image_assets` rows to an existing batch/style.

- [ ] **Step 1: Add failing worker tests**

In `review.test.ts`, cover:

- rejected asset batch rerun creates one job per rejected AI asset.
- online generation from a style creates a `generate_ai_image` job.
- prompt override is persisted in job payload.
- non-authorized role cannot create jobs.

Run expected failing test:

```bash
npm run test -- src/tests/review.test.ts
```

- [ ] **Step 2: Add generation job schema**

Migration fields:

```sql
CREATE TABLE IF NOT EXISTS ai_generation_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_uid TEXT NOT NULL UNIQUE,
  batch_uid TEXT NOT NULL,
  style_id INTEGER NOT NULL,
  source_asset_uid TEXT NOT NULL DEFAULT '',
  reference_asset_uids_json TEXT NOT NULL DEFAULT '[]',
  prompt_template_version_id INTEGER,
  prompt_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  dispatch_job_uid TEXT NOT NULL DEFAULT '',
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- [ ] **Step 3: Implement cloud job creation**

Add endpoints:

```http
POST /api/ai-image-batches/{batch_uid}/generate
POST /api/ai-image-batches/{batch_uid}/regenerate
POST /api/ai-image-batches/{batch_uid}/regenerate-rejected
```

`regenerate-rejected` finds all `kind='ai' AND status='rejected'` assets, creates jobs with idempotency keys:

```text
regenerate_ai_image:{batch_uid}:{asset_uid}:{prompt_hash}
```

- [ ] **Step 4: Add local executor**

In `core/cloud_job_executors.py`, add:

```python
if job_type == "generate_ai_image":
    return self.execute_generate_ai_image(job)
```

`execute_generate_ai_image` downloads source/reference assets, builds the local batch payload, calls `generate_approval_asset_for_item`, uploads result through `/api/assets/presign`, and returns the new `asset_uid`, filename, and generation metadata.

- [ ] **Step 5: Add UI**

`OnlineGenerationView.vue` supports:

- select batch/style
- select source image and reference images
- select Prompt template from published library
- edit prompt before submit
- select target machine or leave unassigned for any capable machine
- show background job status

`BatchReviewView.vue` adds:

- one-click rerun rejected
- row action `换 Prompt 重跑`
- pending/running/succeeded/failed job pills per image

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck
npm run test -- src/tests/review.test.ts src/tests/machines.test.ts
npm run build
cd /Users/xingyicheng/Documents/crawshrimp/.worktrees/cloud-approval-workbench
python -m unittest tests.test_cloud_job_executors tests.test_cloud_machine_agent
git add cloud/approval-workbench core tests app
git commit -m "feat(cloud): add online AI generation jobs"
```

## Task 5: Cloud Image Resource Library And Local Semir Upload Sync

**Files:**
- Add: `cloud/approval-workbench/migrations/0004_image_resources.sql`
- Modify: `cloud/approval-workbench/src/worker/asset-routes.ts`
- Modify: `core/cloud_batch_sync.py`
- Modify: `adapters/tmall-ops-assistant/tools/run_tmall_ai_image_test_chain.py`
- Modify: `cloud/approval-workbench/src/tests/assets.test.ts`
- Modify: `tests/test_cloud_batch_sync.py`

**Interfaces:**
- Produces resource types: `source`, `reference`, `ai`, `result`.
- Links every resource to `batch_uid`, `style_code`, `item_id`, `asset_uid`, object key, source label, and content hash.

- [ ] **Step 1: Add tests that local sync uploads source/reference resources**

Extend `tests/test_cloud_batch_sync.py` to assert `iter_local_asset_files()` includes source and reference image assets, not only AI output.

- [ ] **Step 2: Add image resource table**

Create:

```sql
CREATE TABLE IF NOT EXISTS image_resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_uid TEXT NOT NULL UNIQUE,
  batch_uid TEXT NOT NULL DEFAULT '',
  style_code TEXT NOT NULL DEFAULT '',
  item_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  object_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_hash TEXT NOT NULL DEFAULT '',
  source_label TEXT NOT NULL DEFAULT '',
  created_by_machine_id TEXT,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- [ ] **Step 3: Upsert resources when assets upload**

In `asset-routes.ts`, whenever an asset upload completes, upsert `image_resources` using the asset metadata.

- [ ] **Step 4: Surface source library in UI**

In review/generation views, show a compact resource picker scoped to the current batch/style. The first version does not need global cross-batch search.

- [ ] **Step 5: Verify and commit**

```bash
npm run test -- src/tests/assets.test.ts
python -m unittest tests.test_cloud_batch_sync
git add cloud/approval-workbench core adapters/tmall-ops-assistant/tools/run_tmall_ai_image_test_chain.py tests
git commit -m "feat(cloud): track image resources for AI test batches"
```

## Task 6: Material-Test Data Import, Dashboard, And Crawl Job

**Files:**
- Add: `cloud/approval-workbench/migrations/0005_material_test_data.sql`
- Add: `cloud/approval-workbench/src/worker/material-data-routes.ts`
- Modify: `cloud/approval-workbench/src/worker/index.ts`
- Add: `cloud/approval-workbench/src/app/materialDataImport.ts`
- Add: `cloud/approval-workbench/src/app/views/MaterialDataDashboardView.vue`
- Modify: `cloud/approval-workbench/src/app/App.vue`
- Modify: `core/cloud_job_executors.py`
- Add: `cloud/approval-workbench/src/tests/material-data.test.ts`
- Add: `tests/test_cloud_material_data_export.py`

**Interfaces:**
- Produces job type: `crawl_tmall_material_test_data`.
- Produces dashboard endpoints:
  - `GET /api/material-test/summary`
  - `GET /api/material-test/images`
  - `POST /api/material-test/import`
  - `POST /api/material-test/crawl-jobs`
  - `POST /api/material-test/schedules`

- [ ] **Step 1: Add parser tests from real workbook shape**

In `materialDataImport.ts`, support workbook rows shaped like:

```ts
export interface MaterialTestDetailRow {
  style_code: string
  item_id: string
  task_id: string
  statistic_type: string
  statistic_date: string
  image_type: string
  material_id: string
  material_ratio: string
  material_url: string
  search_impressions: number
  search_clicks: number
  search_ctr: number
  detail_impressions: number
  detail_clicks: number
  detail_ctr: number
  detail_add_to_cart: number
  detail_pay_conversion: number
  detail_pay_conversion_rate: number
}
```

Add tests that convert `7.79%` to `0.0779`.

- [ ] **Step 2: Add data schema**

Create overview/detail/crawl schedule tables:

```sql
CREATE TABLE IF NOT EXISTS material_test_task_overviews (...);
CREATE TABLE IF NOT EXISTS material_test_image_metrics (...);
CREATE TABLE IF NOT EXISTS material_test_crawl_schedules (...);
```

Use unique keys:

- overview: `(item_id, task_id, statistic_type)`
- detail: `(item_id, task_id, statistic_type, statistic_date, material_id, material_url)`

- [ ] **Step 3: Add import and summary routes**

`POST /api/material-test/import` accepts parsed JSON rows and source workbook metadata. It upserts rows and returns counts:

```json
{ "overview_rows": 194, "detail_rows": 33328, "inserted_or_updated": 33522 }
```

- [ ] **Step 4: Add cloud dashboard UI**

`MaterialDataDashboardView.vue` must show:

- KPI row: total items, total materials, total search exposure, weighted search CTR, best image count.
- table: style, item, image type, material URL thumbnail, exposure, clicks, CTR, detail clicks, add-to-cart, pay conversion rate.
- filters: statistic type, date, image type, style/item search.
- actions: manual import workbook, trigger immediate crawl, create schedule.

- [ ] **Step 5: Add task-machine crawl executor**

Add `execute_crawl_tmall_material_test_data()` in `core/cloud_job_executors.py`:

1. Build local run params for existing `tmall_material_test_data_export`.
2. Execute through existing task runner helper or a narrow reusable extraction helper.
3. Upload the output workbook as a `result` asset.
4. Parse `概览/明细` rows locally and `POST /api/material-test/import`.
5. Return row counts and workbook object key.

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck
npm run test -- src/tests/material-data.test.ts
npm run build
python -m unittest tests.test_cloud_material_data_export tests.test_cloud_job_executors
git add cloud/approval-workbench core tests
git commit -m "feat(cloud): add material test data dashboard"
```

## Task 7: End-To-End MVP Test With User Workbooks

**Files:**
- Modify: `scripts/cloud_approval_dry_run.py`
- Modify: `docs/cloud-approval-workbench-runbook.md`
- Add: `docs/cloud-approval-workbench-mvp-test-log.md`

**Interfaces:**
- Consumes:
  - `/Users/xingyicheng/Downloads/AI测图任务导入模板.xlsx`
  - `/Users/xingyicheng/Downloads/AI 测图提示词库.xlsx`
  - `/Users/xingyicheng/Downloads/天猫测图数据抓取导出_20260701-183953.xlsx`

- [ ] **Step 1: Extend dry run**

Add dry-run modes:

```bash
python scripts/cloud_approval_dry_run.py --scenario embedded-login
python scripts/cloud_approval_dry_run.py --scenario prompt-import --prompt-file "/Users/xingyicheng/Downloads/AI 测图提示词库.xlsx"
python scripts/cloud_approval_dry_run.py --scenario material-data-import --data-file "/Users/xingyicheng/Downloads/天猫测图数据抓取导出_20260701-183953.xlsx"
python scripts/cloud_approval_dry_run.py --scenario mvp-ai-test --workflow-file "/Users/xingyicheng/Downloads/AI测图任务导入模板.xlsx"
```

- [ ] **Step 2: Run local cloud checks**

```bash
cd /Users/xingyicheng/Documents/crawshrimp/.worktrees/cloud-approval-workbench/cloud/approval-workbench
npm run typecheck
npm run test
npm run build
```

- [ ] **Step 3: Run desktop checks**

```bash
cd /Users/xingyicheng/Documents/crawshrimp/.worktrees/cloud-approval-workbench
python -m unittest \
  tests.test_cloud_approval_client \
  tests.test_cloud_batch_sync \
  tests.test_cloud_machine_agent \
  tests.test_cloud_job_executors \
  tests.test_tmall_ai_image_chain_script
cd app && npm test
```

- [ ] **Step 4: Run actual local app smoke**

Start the branch client:

```bash
cd /Users/xingyicheng/Documents/crawshrimp/.worktrees/cloud-approval-workbench/app
CRAWSHRIMP_DATA=/Users/xingyicheng/Documents/crawshrimp/.worktrees/cloud-approval-workbench/.crawshrimp-runtime CRAWSHRIMP_PORT=18765 npm run dev
```

Verify:

- Settings shows cloud URL and task machine online.
- Cloud Approval opens inside Crawshrimp.
- Admin login succeeds.
- The page has top tabs, no cloud sidebar, no visible frame border.
- Prompt import works with the provided workbook.
- Material data manual import works with the provided export workbook.

- [ ] **Step 5: Deploy and verify**

After local checks pass, deploy the cloud Worker using the existing Cloudflare credentials from the local environment only. Do not write credentials into files.

Verify:

```bash
curl -I "https://approval.crawshrimp.com/?embed=1"
curl -I "https://approval.crawshrimp.com/?batch_uid=batch-cloud&embed=1"
```

- [ ] **Step 6: Record test log and commit**

Write `docs/cloud-approval-workbench-mvp-test-log.md` with:

- commit hash
- deployed Worker version
- test account used, without password
- local app URL
- exact workbooks used
- pass/fail table for both MVP loops

Commit:

```bash
git add scripts/cloud_approval_dry_run.py docs/cloud-approval-workbench-runbook.md docs/cloud-approval-workbench-mvp-test-log.md
git commit -m "test(cloud): document AI test MVP verification"
```

## Self-Review Checklist

- [ ] Embedded login is covered by an auth Cookie test and a real Crawshrimp smoke test.
- [ ] Cloud app has no independent sidebar in embedded mode.
- [ ] Prompt import/export maps every field from the user workbook, including sheet group and gender priority columns.
- [ ] Online generation and rerun use task-machine jobs, not cloud-side direct 1XM calls.
- [ ] Submit-to-Tmall job remains idempotent and requires an active selected task machine.
- [ ] Material data dashboard uses the real `概览/明细` export schema.
- [ ] Data crawl runs through task machine because Tmall login/CDP is local.
- [ ] All new machine capabilities are registration-token-scoped and RBAC-gated.
- [ ] No token, password, session cookie, or generated SQL is committed.
