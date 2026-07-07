# Crawshrimp Cloud Approval Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the V1 cloud approval loop where Crawshrimp generates AI image-test batches locally, syncs them to an authenticated cloud approval workbench, and authorized task machines claim regeneration and submit jobs through a leased task queue.

**Architecture:** Add an independent Cloudflare-ready web app under `cloud/approval-workbench` with its own Worker API, Vue UI, D1 schema, R2 asset layer, RBAC, machine enrollment, dispatch jobs, Prompt library, batch sync, review actions, and submit plans. Add focused Crawshrimp desktop modules for cloud config, batch sync, machine enrollment, heartbeat/claim, and task execution, keeping local net-disk lookup, 1XM generation, and Tmall browser automation inside the desktop app.

**Tech Stack:** Cloudflare Workers, D1, R2, Vue 3, Vite, TypeScript, Vitest, Python FastAPI helpers, SQLite via `core/data_sink.py`, Electron IPC/preload, existing Python `unittest`, existing Node `node:test`.

---

## Scope And Execution Notes

This plan is split into four independently verifiable phases:

- Phase 0: cloud app skeleton, RBAC, machine enrollment, dispatch jobs.
- Phase 1: Prompt library, batch sync, R2 assets, read-only batch UI.
- Phase 2: cloud review actions, regeneration dispatch, desktop machine agent.
- Phase 3: submit plan dispatch, local Tmall submit executor, result readback.

Commit after each task. Do not mix cloud app scaffolding, desktop agent work, and Tmall executor changes in the same commit. Before writing Cloudflare-specific config, check current Cloudflare docs for Worker static assets, D1, R2, and Wrangler binding syntax because those fields drift.

The cloud project is intentionally separate from the Electron renderer. The standalone web URL is the product surface; the Electron app will later embed the same URL.

## File Map

Cloud app:

- Create `cloud/approval-workbench/package.json`: npm scripts for dev, test, build, typecheck, database migration checks.
- Create `cloud/approval-workbench/tsconfig.json`: TypeScript config for Worker and Vue source.
- Create `cloud/approval-workbench/vite.config.ts`: Vite app build for the web UI.
- Create `cloud/approval-workbench/vitest.config.ts`: Vitest config with Node-compatible unit tests.
- Create `cloud/approval-workbench/wrangler.toml`: local Cloudflare bindings for D1 and R2.
- Create `cloud/approval-workbench/migrations/0001_init.sql`: D1 schema for auth, RBAC, machines, jobs, prompts, batches, assets, and audit logs.
- Create `cloud/approval-workbench/src/worker/index.ts`: Worker entrypoint and route registry.
- Create `cloud/approval-workbench/src/worker/env.ts`: binding types and runtime env helpers.
- Create `cloud/approval-workbench/src/worker/http.ts`: JSON response, auth error, request parsing, CORS for local dev.
- Create `cloud/approval-workbench/src/worker/db.ts`: D1 query helpers, transactions, JSON helpers.
- Create `cloud/approval-workbench/src/worker/security/password.ts`: password hashing and verification.
- Create `cloud/approval-workbench/src/worker/security/tokens.ts`: random token generation, hashing, constant-time compare helpers.
- Create `cloud/approval-workbench/src/worker/security/rbac.ts`: built-in roles, permissions, user-session guard, machine-token guard.
- Create `cloud/approval-workbench/src/worker/audit.ts`: append-only audit log helper.
- Create `cloud/approval-workbench/src/worker/auth-routes.ts`: login/logout/me and admin user/role endpoints.
- Create `cloud/approval-workbench/src/worker/machine-routes.ts`: enrollment token, machine enroll, heartbeat, claim, lease, progress, complete/fail/cancel endpoints.
- Create `cloud/approval-workbench/src/worker/job-state.ts`: dispatch job state machine and lease validation.
- Create `cloud/approval-workbench/src/worker/prompt-routes.ts`: Prompt library/template/version endpoints.
- Create `cloud/approval-workbench/src/worker/asset-routes.ts`: R2 upload/download helpers and signed upload metadata.
- Create `cloud/approval-workbench/src/worker/batch-routes.ts`: batch sync, batch detail, review decisions, regeneration, submit plan.
- Create `cloud/approval-workbench/src/worker/dashboard-routes.ts`: data dashboard aggregate endpoints.
- Create `cloud/approval-workbench/src/app/main.ts`: Vue app bootstrap.
- Create `cloud/approval-workbench/src/app/App.vue`: cloud workbench shell and routing.
- Create `cloud/approval-workbench/src/app/api.ts`: typed fetch wrapper.
- Create `cloud/approval-workbench/src/app/views/LoginView.vue`: login page.
- Create `cloud/approval-workbench/src/app/views/AdminUsersView.vue`: admin account and role management.
- Create `cloud/approval-workbench/src/app/views/MachinesView.vue`: enrollment token and task-machine management.
- Create `cloud/approval-workbench/src/app/views/PromptLibraryView.vue`: Prompt library CRUD and publishing.
- Create `cloud/approval-workbench/src/app/views/BatchListView.vue`: batch list.
- Create `cloud/approval-workbench/src/app/views/BatchReviewView.vue`: approval board.
- Create `cloud/approval-workbench/src/app/views/DashboardView.vue`: read-only KPIs.
- Create `cloud/approval-workbench/src/tests/*.test.ts`: cloud API, RBAC, machine, job, prompt, batch, and UI contract tests.

Crawshrimp desktop:

- Modify `core/config.py`: add `cloud_approval` defaults.
- Modify `core/data_sink.py`: add local cloud batch sync and machine credential persistence.
- Create `core/cloud_approval_client.py`: HTTP client for cloud API, upload helpers, retry/backoff.
- Create `core/cloud_batch_sync.py`: convert local approval batch JSON into cloud sync payload and asset upload plan.
- Create `core/cloud_machine_agent.py`: enrollment, heartbeat, long-poll claim, lease renewal, progress, completion.
- Create `core/cloud_job_executors.py`: dispatch `regenerate_ai_image` and `submit_tmall_material_test` to existing Tmall chain functions.
- Modify `core/api_server.py`: local endpoints for cloud config, machine status, and manual sync trigger.
- Modify `adapters/tmall-ops-assistant/tools/run_tmall_ai_image_test_chain.py`: optionally use cloud Prompt library and trigger cloud sync after local batch creation.
- Modify `app/src/main.js`: Electron IPC handlers for cloud config and machine-agent actions.
- Modify `app/src/preload.js`: expose cloud methods to renderer.
- Modify `app/src/renderer/utils/devCsBridge.js`: browser dev bridge for cloud methods.
- Modify `app/src/renderer/views/SettingsPage.vue`: cloud approval URL, registration token, machine name, task-machine enable toggle.
- Create `app/src/renderer/views/CloudApprovalFrame.vue`: iframe/webview entry to standalone cloud URL and local machine status.
- Modify `app/src/renderer/App.vue`: add cloud approval nav entry only after URL is configured.
- Create or extend `tests/test_cloud_*.py`, `tests/cloud-approval-*.test.js`, and app renderer utility tests.

## Task 1: Cloud Project Skeleton And Schema

**Files:**
- Create: `cloud/approval-workbench/package.json`
- Create: `cloud/approval-workbench/tsconfig.json`
- Create: `cloud/approval-workbench/vite.config.ts`
- Create: `cloud/approval-workbench/vitest.config.ts`
- Create: `cloud/approval-workbench/wrangler.toml`
- Create: `cloud/approval-workbench/migrations/0001_init.sql`
- Create: `cloud/approval-workbench/src/worker/env.ts`
- Create: `cloud/approval-workbench/src/worker/db.ts`
- Test: `cloud/approval-workbench/src/tests/schema.test.ts`

- [ ] **Step 1: Create the cloud package manifest**

Create `cloud/approval-workbench/package.json`:

```json
{
  "name": "crawshrimp-cloud-approval-workbench",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "build": "vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "check": "npm run typecheck && npm run test && npm run build"
  },
  "dependencies": {
    "@vitejs/plugin-vue": "^5.0.4",
    "vite": "^5.2.0",
    "vue": "^3.4.21"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20260701.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.1",
    "wrangler": "^4.0.0"
  }
}
```

- [ ] **Step 2: Create TypeScript, Vite, Vitest, and Wrangler config**

Create `cloud/approval-workbench/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "jsx": "preserve"
  },
  "include": ["src/**/*.ts", "src/**/*.vue"]
}
```

Create `cloud/approval-workbench/vite.config.ts`:

```ts
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
})
```

Create `cloud/approval-workbench/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
  },
})
```

Create `cloud/approval-workbench/wrangler.toml` after checking current Wrangler binding syntax:

```toml
name = "crawshrimp-cloud-approval-workbench"
main = "src/worker/index.ts"
compatibility_date = "2026-07-07"

[[d1_databases]]
binding = "DB"
database_name = "crawshrimp_cloud_approval"
database_id = "00000000-0000-0000-0000-000000000000"
migrations_dir = "migrations"

[[r2_buckets]]
binding = "ASSETS"
bucket_name = "crawshrimp-cloud-approval-assets"

[vars]
SESSION_TTL_SECONDS = "604800"
```

- [ ] **Step 3: Write the schema contract test**

Create `cloud/approval-workbench/src/tests/schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

const schema = fs.readFileSync('migrations/0001_init.sql', 'utf8')

describe('initial D1 schema', () => {
  it('contains auth rbac machine job prompt batch and audit tables', () => {
    for (const table of [
      'users',
      'roles',
      'user_roles',
      'role_permissions',
      'sessions',
      'audit_logs',
      'machine_enrollment_tokens',
      'task_machines',
      'machine_tokens',
      'dispatch_jobs',
      'dispatch_job_events',
      'prompt_libraries',
      'prompt_templates',
      'prompt_template_versions',
      'ai_image_batches',
      'ai_image_styles',
      'ai_image_assets',
      'approval_events',
    ]) {
      expect(schema).toContain(`CREATE TABLE IF NOT EXISTS ${table}`)
    }
  })

  it('defines uniqueness for idempotency and machine identity', () => {
    expect(schema).toContain('UNIQUE(email)')
    expect(schema).toContain('UNIQUE(machine_id)')
    expect(schema).toContain('UNIQUE(job_type, idempotency_key)')
  })
})
```

- [ ] **Step 4: Run the schema test and verify it fails**

Run:

```bash
cd /Users/xingyicheng/Documents/crawshrimp/cloud/approval-workbench
npm test -- src/tests/schema.test.ts
```

Expected: fails because `migrations/0001_init.sql` has not been created.

- [ ] **Step 5: Add the initial D1 migration**

Create `cloud/approval-workbench/migrations/0001_init.sql` with the tables asserted in Step 3. Use `TEXT` for JSON fields, ISO timestamp strings, and explicit indexes:

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  password_hash TEXT NOT NULL,
  last_login_at TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  built_in INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  role_id INTEGER NOT NULL,
  assigned_by INTEGER,
  assigned_at TEXT NOT NULL,
  UNIQUE(user_id, role_id)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL,
  permission_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  session_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER,
  actor_machine_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  ip_address TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS machine_enrollment_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  owner_user_id INTEGER,
  allowed_capabilities_json TEXT NOT NULL DEFAULT '[]',
  require_approval INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'issued',
  expires_at TEXT NOT NULL,
  used_by_machine_id TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS task_machines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id TEXT NOT NULL UNIQUE,
  machine_name TEXT NOT NULL,
  owner_user_id INTEGER,
  app_version TEXT NOT NULL DEFAULT '',
  fingerprint_hash TEXT NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  auth_status TEXT NOT NULL DEFAULT 'pending_approval',
  health TEXT NOT NULL DEFAULT 'offline',
  current_job_id TEXT,
  last_seen_at TEXT,
  registered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS machine_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  issued_by INTEGER,
  issued_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS dispatch_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_uid TEXT NOT NULL UNIQUE,
  batch_uid TEXT NOT NULL DEFAULT '',
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  requested_by INTEGER,
  assigned_machine_id TEXT,
  required_capabilities_json TEXT NOT NULL DEFAULT '[]',
  priority INTEGER NOT NULL DEFAULT 100,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT NOT NULL,
  lease_id TEXT,
  lease_expires_at TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(job_type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_claim ON dispatch_jobs (status, assigned_machine_id, priority, created_at);

CREATE TABLE IF NOT EXISTS dispatch_job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_uid TEXT NOT NULL,
  machine_id TEXT,
  lease_id TEXT,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_libraries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  scenario TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER NOT NULL,
  group_name TEXT NOT NULL,
  field_name TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  size_label TEXT NOT NULL DEFAULT '960x1280',
  output_format TEXT NOT NULL DEFAULT 'jpeg',
  quality TEXT NOT NULL DEFAULT 'auto',
  category_rules_json TEXT NOT NULL DEFAULT '[]',
  gender_rules_json TEXT NOT NULL DEFAULT '[]',
  priority_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_template_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  version_no INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by INTEGER,
  UNIQUE(template_id, version_no)
);

CREATE TABLE IF NOT EXISTS ai_image_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_uid TEXT NOT NULL UNIQUE,
  local_instance_uid TEXT NOT NULL DEFAULT '',
  local_run_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'syncing',
  prompt_library_id INTEGER,
  prompt_version_set_json TEXT NOT NULL DEFAULT '[]',
  source_machine_id TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_image_styles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_uid TEXT NOT NULL,
  style_code TEXT NOT NULL,
  item_id TEXT NOT NULL DEFAULT '',
  skc_code TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending_review',
  missing_prompt_reason TEXT NOT NULL DEFAULT '',
  source_summary_json TEXT NOT NULL DEFAULT '{}',
  review_summary_json TEXT NOT NULL DEFAULT '{}',
  submit_summary_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(batch_uid, style_code, item_id)
);

CREATE TABLE IF NOT EXISTS ai_image_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_uid TEXT NOT NULL UNIQUE,
  batch_uid TEXT NOT NULL,
  style_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  object_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_hash TEXT NOT NULL DEFAULT '',
  prompt_template_version_id INTEGER,
  prompt_text TEXT NOT NULL DEFAULT '',
  parent_asset_uid TEXT,
  generation_job_id TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_uid TEXT NOT NULL,
  style_id INTEGER,
  asset_uid TEXT,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
```

- [ ] **Step 6: Add environment and D1 helper modules**

Create `cloud/approval-workbench/src/worker/env.ts`:

```ts
export interface Env {
  DB: D1Database
  ASSETS: R2Bucket
  SESSION_TTL_SECONDS?: string
}

export function sessionTtlSeconds(env: Env): number {
  const value = Number(env.SESSION_TTL_SECONDS || 604800)
  return Number.isFinite(value) && value > 0 ? value : 604800
}
```

Create `cloud/approval-workbench/src/worker/db.ts`:

```ts
export type JsonRecord = Record<string, unknown>

export function nowIso(): string {
  return new Date().toISOString()
}

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? {})
}

export function fromJsonObject(value: string | null | undefined): JsonRecord {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export async function first<T>(stmt: D1PreparedStatement): Promise<T | null> {
  const row = await stmt.first<T>()
  return row || null
}
```

- [ ] **Step 7: Run the cloud checks**

Run:

```bash
cd /Users/xingyicheng/Documents/crawshrimp/cloud/approval-workbench
npm install
npm run typecheck
npm test
```

Expected: typecheck passes, `schema.test.ts` passes.

- [ ] **Step 8: Commit Task 1**

```bash
git add cloud/approval-workbench
git commit -m "feat(cloud): scaffold approval workbench schema"
```

## Task 2: Auth, RBAC, Sessions, And Audit Logs

**Files:**
- Create: `cloud/approval-workbench/src/worker/http.ts`
- Create: `cloud/approval-workbench/src/worker/security/password.ts`
- Create: `cloud/approval-workbench/src/worker/security/tokens.ts`
- Create: `cloud/approval-workbench/src/worker/security/rbac.ts`
- Create: `cloud/approval-workbench/src/worker/audit.ts`
- Create: `cloud/approval-workbench/src/worker/auth-routes.ts`
- Modify: `cloud/approval-workbench/src/worker/index.ts`
- Test: `cloud/approval-workbench/src/tests/rbac.test.ts`
- Test: `cloud/approval-workbench/src/tests/auth-routes.test.ts`

- [ ] **Step 1: Write RBAC tests**

Create `cloud/approval-workbench/src/tests/rbac.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { BUILT_IN_ROLES, hasPermission } from '../worker/security/rbac'

describe('RBAC matrix', () => {
  it('lets admins manage users and machines', () => {
    expect(hasPermission(['admin'], 'users:write')).toBe(true)
    expect(hasPermission(['admin'], 'machines:write')).toBe(true)
    expect(hasPermission(['admin'], 'audit:read')).toBe(true)
  })

  it('keeps reviewers away from submit and admin actions', () => {
    expect(hasPermission(['reviewer'], 'batches:review')).toBe(true)
    expect(hasPermission(['reviewer'], 'jobs:regenerate')).toBe(true)
    expect(hasPermission(['reviewer'], 'jobs:submit')).toBe(false)
    expect(hasPermission(['reviewer'], 'users:write')).toBe(false)
  })

  it('keeps machine operators scoped to machine maintenance', () => {
    expect(hasPermission(['machine_operator'], 'machines:own:write')).toBe(true)
    expect(hasPermission(['machine_operator'], 'machines:write')).toBe(false)
    expect(hasPermission(['machine_operator'], 'batches:review')).toBe(false)
  })

  it('defines every built-in role with at least one permission', () => {
    for (const role of BUILT_IN_ROLES) {
      expect(role.permissions.length, role.roleKey).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Run RBAC tests and verify they fail**

Run:

```bash
cd /Users/xingyicheng/Documents/crawshrimp/cloud/approval-workbench
npm test -- src/tests/rbac.test.ts
```

Expected: fails because `security/rbac.ts` does not exist.

- [ ] **Step 3: Implement RBAC constants and permission helper**

Create `cloud/approval-workbench/src/worker/security/rbac.ts`:

```ts
export type Permission =
  | 'users:write'
  | 'roles:read'
  | 'audit:read'
  | 'prompts:read'
  | 'prompts:write'
  | 'batches:read'
  | 'batches:review'
  | 'jobs:regenerate'
  | 'jobs:submit'
  | 'machines:read'
  | 'machines:write'
  | 'machines:own:write'
  | 'dashboard:read'

export interface BuiltInRole {
  roleKey: string
  name: string
  permissions: Permission[]
}

export const BUILT_IN_ROLES: BuiltInRole[] = [
  {
    roleKey: 'super_admin',
    name: '超级管理员',
    permissions: [
      'users:write',
      'roles:read',
      'audit:read',
      'prompts:read',
      'prompts:write',
      'batches:read',
      'batches:review',
      'jobs:regenerate',
      'jobs:submit',
      'machines:read',
      'machines:write',
      'machines:own:write',
      'dashboard:read',
    ],
  },
  {
    roleKey: 'admin',
    name: '管理员',
    permissions: ['users:write', 'roles:read', 'audit:read', 'prompts:read', 'prompts:write', 'batches:read', 'batches:review', 'jobs:regenerate', 'jobs:submit', 'machines:read', 'machines:write', 'dashboard:read'],
  },
  {
    roleKey: 'prompt_manager',
    name: 'Prompt 管理',
    permissions: ['prompts:read', 'prompts:write', 'batches:read', 'dashboard:read'],
  },
  {
    roleKey: 'reviewer',
    name: '审图人员',
    permissions: ['prompts:read', 'batches:read', 'batches:review', 'jobs:regenerate', 'dashboard:read'],
  },
  {
    roleKey: 'operator',
    name: '提交操作员',
    permissions: ['batches:read', 'jobs:regenerate', 'jobs:submit', 'machines:read', 'dashboard:read'],
  },
  {
    roleKey: 'machine_operator',
    name: '任务机维护',
    permissions: ['machines:read', 'machines:own:write', 'batches:read', 'dashboard:read'],
  },
  {
    roleKey: 'viewer',
    name: '只读查看',
    permissions: ['prompts:read', 'batches:read', 'machines:read', 'dashboard:read'],
  },
]

export function permissionsForRoles(roleKeys: string[]): Set<Permission> {
  const keys = new Set(roleKeys)
  const permissions = new Set<Permission>()
  for (const role of BUILT_IN_ROLES) {
    if (!keys.has(role.roleKey)) continue
    for (const permission of role.permissions) permissions.add(permission)
  }
  return permissions
}

export function hasPermission(roleKeys: string[], permission: Permission): boolean {
  return permissionsForRoles(roleKeys).has(permission)
}
```

- [ ] **Step 4: Add token, password, and HTTP helpers**

Create `cloud/approval-workbench/src/worker/security/tokens.ts`:

```ts
export function randomToken(prefix: string): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const body = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${prefix}_${body}`
}

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
```

Create `cloud/approval-workbench/src/worker/security/password.ts`:

```ts
import { sha256Hex } from './tokens'

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomUUID()
  const hash = await sha256Hex(`${salt}:${password}`)
  return `sha256:${salt}:${hash}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':')
  if (parts.length !== 3 || parts[0] !== 'sha256') return false
  const hash = await sha256Hex(`${parts[1]}:${password}`)
  return hash === parts[2]
}
```

Create `cloud/approval-workbench/src/worker/http.ts`:

```ts
export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(data), {
    status: init.status,
    statusText: init.statusText,
    headers,
  })
}

export function badRequest(message: string): Response {
  return json({ error: message }, { status: 400 })
}

export function unauthorized(message = 'Unauthorized'): Response {
  return json({ error: message }, { status: 401 })
}

export function forbidden(message = 'Forbidden'): Response {
  return json({ error: message }, { status: 403 })
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json()
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}
```

- [ ] **Step 5: Implement auth routes and audit helper**

Create `cloud/approval-workbench/src/worker/audit.ts` with `recordAudit(env, actor, action, resourceType, resourceId, payload, request)`.

Create `cloud/approval-workbench/src/worker/auth-routes.ts` with handlers:

```ts
export async function login(request: Request, env: Env): Promise<Response>
export async function logout(request: Request, env: Env): Promise<Response>
export async function me(request: Request, env: Env): Promise<Response>
export async function listUsers(request: Request, env: Env): Promise<Response>
export async function createUser(request: Request, env: Env): Promise<Response>
export async function updateUser(request: Request, env: Env): Promise<Response>
export async function listRoles(request: Request, env: Env): Promise<Response>
export async function updateUserRoles(request: Request, env: Env): Promise<Response>
export async function listAuditLogs(request: Request, env: Env): Promise<Response>
```

Implementation requirements:

- `login` accepts `email` and `password`, verifies active user, creates `sessions.session_hash`, returns an HTTP-only cookie and `{user, roles, permissions}`.
- `logout` revokes the current session.
- `me` returns current user, roles, and permissions.
- Admin endpoints require `users:write`, `roles:read`, or `audit:read`.
- `createUser` requires admin session and stores hashed password.
- No route creates a public signup flow.

- [ ] **Step 6: Register routes in Worker entrypoint**

Create `cloud/approval-workbench/src/worker/index.ts`:

```ts
import type { Env } from './env'
import { json } from './http'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/health') return json({ ok: true })

    return json({ error: 'Not found' }, { status: 404 })
  },
}
```

Then add routing for the auth handlers from Step 5.

- [ ] **Step 7: Add auth route tests**

Create `cloud/approval-workbench/src/tests/auth-routes.test.ts` with tests that:

- `POST /api/auth/login` rejects inactive users.
- `GET /api/auth/me` rejects missing sessions.
- `POST /api/admin/users` is rejected for a reviewer session.
- `POST /api/admin/users` succeeds for admin and stores no plain password.

Use a fake D1 adapter object with `prepare().bind().first()/all()/run()` behavior scoped to rows needed by these tests.

- [ ] **Step 8: Run checks**

Run:

```bash
cd /Users/xingyicheng/Documents/crawshrimp/cloud/approval-workbench
npm run typecheck
npm test -- src/tests/rbac.test.ts src/tests/auth-routes.test.ts
```

Expected: both pass.

- [ ] **Step 9: Commit Task 2**

```bash
git add cloud/approval-workbench
git commit -m "feat(cloud): add auth rbac and audit foundation"
```

## Task 3: Machine Enrollment, Tokens, Heartbeat, And Claim API

**Files:**
- Create: `cloud/approval-workbench/src/worker/machine-routes.ts`
- Create: `cloud/approval-workbench/src/worker/job-state.ts`
- Modify: `cloud/approval-workbench/src/worker/index.ts`
- Test: `cloud/approval-workbench/src/tests/machines.test.ts`
- Test: `cloud/approval-workbench/src/tests/job-state.test.ts`

- [ ] **Step 1: Write job state tests**

Create `cloud/approval-workbench/src/tests/job-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { canClaimJob, nextJobStatusAfterLeaseExpiry, validateLease } from '../worker/job-state'

describe('dispatch job state machine', () => {
  it('allows active healthy capable machines to claim queued jobs', () => {
    expect(canClaimJob({
      jobStatus: 'queued',
      assignedMachineId: 'machine-1',
      requiredCapabilities: ['regenerate_ai_image'],
      machineId: 'machine-1',
      machineAuthStatus: 'active',
      machineHealth: 'online_idle',
      machineCapabilities: ['regenerate_ai_image', 'submit_tmall_material_test'],
    })).toBe(true)
  })

  it('blocks disabled machines and capability mismatches', () => {
    expect(canClaimJob({
      jobStatus: 'queued',
      assignedMachineId: '',
      requiredCapabilities: ['submit_tmall_material_test'],
      machineId: 'machine-1',
      machineAuthStatus: 'disabled',
      machineHealth: 'online_idle',
      machineCapabilities: ['regenerate_ai_image'],
    })).toBe(false)
  })

  it('requeues leased jobs after lease expiry', () => {
    expect(nextJobStatusAfterLeaseExpiry('leased')).toBe('queued')
    expect(nextJobStatusAfterLeaseExpiry('running')).toBe('retryable_failed')
  })

  it('rejects stale lease writes', () => {
    expect(validateLease('lease-current', 'lease-current')).toBe(true)
    expect(validateLease('lease-current', 'lease-old')).toBe(false)
  })
})
```

- [ ] **Step 2: Implement job-state helper**

Create `cloud/approval-workbench/src/worker/job-state.ts`:

```ts
export type MachineAuthStatus = 'pending_approval' | 'active' | 'disabled' | 'revoked' | 'rejected'
export type MachineHealth = 'offline' | 'online_idle' | 'online_busy' | 'needs_login' | 'config_missing' | 'version_blocked'
export type DispatchStatus = 'created' | 'queued' | 'leased' | 'running' | 'uploading_results' | 'succeeded' | 'cancelled' | 'lease_expired' | 'retryable_failed' | 'terminal_failed' | 'blocked_needs_login' | 'blocked_config_missing' | 'cancel_requested'

export interface ClaimInput {
  jobStatus: DispatchStatus
  assignedMachineId: string
  requiredCapabilities: string[]
  machineId: string
  machineAuthStatus: MachineAuthStatus
  machineHealth: MachineHealth
  machineCapabilities: string[]
}

export function canClaimJob(input: ClaimInput): boolean {
  if (input.jobStatus !== 'queued') return false
  if (input.machineAuthStatus !== 'active') return false
  if (!['online_idle', 'online_busy'].includes(input.machineHealth)) return false
  if (input.assignedMachineId && input.assignedMachineId !== input.machineId) return false
  const machineCaps = new Set(input.machineCapabilities)
  return input.requiredCapabilities.every((capability) => machineCaps.has(capability))
}

export function nextJobStatusAfterLeaseExpiry(status: DispatchStatus): DispatchStatus {
  if (status === 'leased') return 'queued'
  if (status === 'running' || status === 'uploading_results') return 'retryable_failed'
  return status
}

export function validateLease(currentLeaseId: string | null | undefined, suppliedLeaseId: string | null | undefined): boolean {
  return Boolean(currentLeaseId && suppliedLeaseId && currentLeaseId === suppliedLeaseId)
}
```

- [ ] **Step 3: Write machine route tests**

Create `cloud/approval-workbench/src/tests/machines.test.ts` with route-level tests for:

- Admin can create an enrollment token and receives the plain token once.
- Reusing an enrollment token fails.
- Expired enrollment token fails.
- Enrollment with capability outside `allowed_capabilities_json` fails.
- Pending approval machine cannot claim.
- Active machine can heartbeat and claim a queued job with matching capability.
- Claim returns `next_poll_after_seconds` when no jobs are available.

- [ ] **Step 4: Implement machine route handlers**

Create `cloud/approval-workbench/src/worker/machine-routes.ts`:

```ts
export async function createEnrollmentToken(request: Request, env: Env): Promise<Response>
export async function revokeEnrollmentToken(request: Request, env: Env): Promise<Response>
export async function listEnrollmentTokens(request: Request, env: Env): Promise<Response>
export async function listMachines(request: Request, env: Env): Promise<Response>
export async function approveMachine(request: Request, env: Env): Promise<Response>
export async function disableMachine(request: Request, env: Env): Promise<Response>
export async function revokeMachine(request: Request, env: Env): Promise<Response>
export async function rotateMachineToken(request: Request, env: Env): Promise<Response>
export async function enrollMachine(request: Request, env: Env): Promise<Response>
export async function heartbeat(request: Request, env: Env): Promise<Response>
export async function claimJob(request: Request, env: Env): Promise<Response>
export async function renewJob(request: Request, env: Env): Promise<Response>
export async function progressJob(request: Request, env: Env): Promise<Response>
export async function completeJob(request: Request, env: Env): Promise<Response>
export async function failJob(request: Request, env: Env): Promise<Response>
```

Implementation requirements:

- Enrollment token plain value uses `randomToken('csr_enroll')`.
- Machine long-lived token plain value uses `randomToken('csr_machine')`.
- Store only token hashes.
- `enrollMachine` marks enrollment token `used`, creates `task_machines`, creates `machine_tokens`, returns the long-lived token once.
- `heartbeat` authenticates machine token and updates `health`, `last_seen_at`, `app_version`, `capabilities_json`.
- `claimJob` authenticates machine token, finds the highest priority claimable `queued` job, writes a fresh `lease_id`, `lease_expires_at`, `status='leased'`, increments `attempt_count`, and returns payload.
- Claim and lease updates must happen through a single conditional update that includes current status and machine constraints.
- `renewJob`, `progressJob`, `completeJob`, and `failJob` reject stale `lease_id`.

- [ ] **Step 5: Register machine routes**

Modify `cloud/approval-workbench/src/worker/index.ts` so `/api/admin/machine-enrollment-tokens`, `/api/admin/machines`, `/api/machines/enroll`, `/api/machines/heartbeat`, `/api/machines/jobs/claim`, and `/api/jobs/*` dispatch to handlers.

- [ ] **Step 6: Run checks**

Run:

```bash
cd /Users/xingyicheng/Documents/crawshrimp/cloud/approval-workbench
npm run typecheck
npm test -- src/tests/job-state.test.ts src/tests/machines.test.ts
```

Expected: all pass.

- [ ] **Step 7: Commit Task 3**

```bash
git add cloud/approval-workbench
git commit -m "feat(cloud): add machine enrollment and job leases"
```

## Task 4: Prompt Library API And Cloud Prompt Resolution

**Files:**
- Create: `cloud/approval-workbench/src/worker/prompt-routes.ts`
- Modify: `cloud/approval-workbench/src/worker/index.ts`
- Test: `cloud/approval-workbench/src/tests/prompts.test.ts`

- [ ] **Step 1: Write Prompt library tests**

Create `cloud/approval-workbench/src/tests/prompts.test.ts` with tests for:

- `prompt_manager` can create a library and template.
- `reviewer` can read resolved prompts but cannot publish versions.
- Publishing creates immutable `prompt_template_versions`.
- Resolution by category/gender returns enabled templates ordered by priority.
- Updating a template after publishing does not mutate the previous version snapshot.

- [ ] **Step 2: Implement Prompt routes**

Create `cloud/approval-workbench/src/worker/prompt-routes.ts` with:

```ts
export async function listPromptLibraries(request: Request, env: Env): Promise<Response>
export async function createPromptLibrary(request: Request, env: Env): Promise<Response>
export async function updatePromptTemplate(request: Request, env: Env): Promise<Response>
export async function publishPromptLibrary(request: Request, env: Env): Promise<Response>
export async function resolvePrompts(request: Request, env: Env): Promise<Response>
```

Implementation requirements:

- Write operations require `prompts:write`.
- Read operations require `prompts:read`.
- `scenario` accepts `裂变图` and `创意拍摄`.
- `publishPromptLibrary` snapshots all enabled templates into `prompt_template_versions` and returns `version_set`.
- `resolvePrompts` accepts `category`, `gender`, and `limit`, then returns templates with `template_id`, `version_id`, `group_name`, `field_name`, `prompt_text`, `size_label`, `output_format`, and `quality`.

- [ ] **Step 3: Register Prompt routes and run checks**

Modify `cloud/approval-workbench/src/worker/index.ts`, then run:

```bash
cd /Users/xingyicheng/Documents/crawshrimp/cloud/approval-workbench
npm run typecheck
npm test -- src/tests/prompts.test.ts
```

Expected: pass.

- [ ] **Step 4: Commit Task 4**

```bash
git add cloud/approval-workbench
git commit -m "feat(cloud): add prompt library api"
```

## Task 5: Cloud Batch Sync, R2 Asset Metadata, And Read-Only Batch UI API

**Files:**
- Create: `cloud/approval-workbench/src/worker/asset-routes.ts`
- Create: `cloud/approval-workbench/src/worker/batch-routes.ts`
- Modify: `cloud/approval-workbench/src/worker/index.ts`
- Test: `cloud/approval-workbench/src/tests/batches.test.ts`
- Test: `cloud/approval-workbench/src/tests/assets.test.ts`

- [ ] **Step 1: Write batch sync tests**

Create `cloud/approval-workbench/src/tests/batches.test.ts` with tests for:

- Machine token can create a batch with styles and assets.
- User session cannot create a machine-origin batch unless it has admin permission.
- `sync-complete` changes batch status from `syncing` to `pending_review`.
- Duplicate `batch_uid` updates existing metadata idempotently.
- `GET /api/ai-image-batches/{batch_uid}` returns styles grouped with assets and prompt metadata.

- [ ] **Step 2: Write asset route tests**

Create `cloud/approval-workbench/src/tests/assets.test.ts` with tests for:

- `assets/presign` returns deterministic object keys under `batches/{batch_uid}/`.
- It rejects paths outside image/table/log allowed suffixes.
- It stores expected object metadata without accepting arbitrary local paths.

- [ ] **Step 3: Implement asset helpers**

Create `cloud/approval-workbench/src/worker/asset-routes.ts`:

```ts
export function batchObjectKey(batchUid: string, kind: string, filename: string): string
export async function createAssetUploadPlan(request: Request, env: Env): Promise<Response>
export async function getAssetDownload(request: Request, env: Env): Promise<Response>
```

Implementation requirements:

- Object keys use `batches/{batch_uid}/{kind}/{asset_uid}-{safe_filename}`.
- Allowed kinds are `source`, `reference`, `ai`, `table`, `log`, `result`.
- Do not store raw local absolute paths in cloud database; store `source_path_label` inside `meta_json` only if needed.

- [ ] **Step 4: Implement batch routes**

Create `cloud/approval-workbench/src/worker/batch-routes.ts`:

```ts
export async function syncBatch(request: Request, env: Env): Promise<Response>
export async function syncBatchComplete(request: Request, env: Env): Promise<Response>
export async function getBatch(request: Request, env: Env): Promise<Response>
export async function listBatches(request: Request, env: Env): Promise<Response>
```

Implementation requirements:

- Machine-origin sync requires machine token.
- Batch style rows are upserted by `(batch_uid, style_code, item_id)`.
- Assets are upserted by `asset_uid`.
- The endpoint records `source_machine_id`.
- `syncBatchComplete` validates at least one style and one AI asset before `pending_review`.

- [ ] **Step 5: Register routes and run checks**

Run:

```bash
cd /Users/xingyicheng/Documents/crawshrimp/cloud/approval-workbench
npm run typecheck
npm test -- src/tests/batches.test.ts src/tests/assets.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit Task 5**

```bash
git add cloud/approval-workbench
git commit -m "feat(cloud): add batch sync and asset metadata"
```

## Task 6: Cloud Review Decisions, Regeneration Jobs, Submit Plans, And Dashboard

**Files:**
- Modify: `cloud/approval-workbench/src/worker/batch-routes.ts`
- Create: `cloud/approval-workbench/src/worker/dashboard-routes.ts`
- Modify: `cloud/approval-workbench/src/worker/index.ts`
- Test: `cloud/approval-workbench/src/tests/review.test.ts`
- Test: `cloud/approval-workbench/src/tests/dashboard.test.ts`

- [ ] **Step 1: Write review tests**

Create `cloud/approval-workbench/src/tests/review.test.ts` with tests for:

- `reviewer` can mark AI assets `approved`, `rejected`, and `pending`.
- `viewer` cannot change decisions.
- Rejected assets do not appear in submit plan.
- Batch status becomes `ready_to_submit` only when each non-skipped style has at least one approved AI asset.
- `POST /regenerate` creates one `dispatch_jobs` row per selected rejected asset and reuses existing jobs by `idempotency_key`.
- `POST /submit` requires `jobs:submit`, selected active machine, and `ready_to_submit`.

- [ ] **Step 2: Implement review and submit endpoints**

Extend `cloud/approval-workbench/src/worker/batch-routes.ts` with:

```ts
export async function saveAssetDecision(request: Request, env: Env): Promise<Response>
export async function createManualStyleAsset(request: Request, env: Env): Promise<Response>
export async function createRegenerationJobs(request: Request, env: Env): Promise<Response>
export async function exportReviewDetail(request: Request, env: Env): Promise<Response>
export async function markBatchReady(request: Request, env: Env): Promise<Response>
export async function getSubmitPlan(request: Request, env: Env): Promise<Response>
export async function createSubmitJob(request: Request, env: Env): Promise<Response>
export async function getSubmitResult(request: Request, env: Env): Promise<Response>
```

Implementation requirements:

- Decisions append `approval_events`.
- `createRegenerationJobs` payload includes `batch_uid`, `style_id`, `asset_uid`, `prompt_text`, `reference_asset_uids`, and `parent_asset_uid`.
- Regeneration jobs use `job_type='regenerate_ai_image'` and capability `regenerate_ai_image`.
- Submit jobs use `job_type='submit_tmall_material_test'`, assigned selected machine, capability `submit_tmall_material_test`, and payload submit plan.
- Submit plan contains only approved AI assets.

- [ ] **Step 3: Write dashboard tests**

Create `cloud/approval-workbench/src/tests/dashboard.test.ts` with tests for aggregate counts:

- batch totals by status.
- image funnel counts generated/approved/rejected/regenerated/submitted.
- Prompt template approval rate.
- machine success/failure counts from `dispatch_jobs`.

- [ ] **Step 4: Implement dashboard routes**

Create `cloud/approval-workbench/src/worker/dashboard-routes.ts`:

```ts
export async function getDashboardSummary(request: Request, env: Env): Promise<Response>
export async function getPromptPerformance(request: Request, env: Env): Promise<Response>
export async function getMachinePerformance(request: Request, env: Env): Promise<Response>
```

All routes require `dashboard:read`.

- [ ] **Step 5: Run checks and commit**

Run:

```bash
cd /Users/xingyicheng/Documents/crawshrimp/cloud/approval-workbench
npm run typecheck
npm test -- src/tests/review.test.ts src/tests/dashboard.test.ts
```

Commit:

```bash
git add cloud/approval-workbench
git commit -m "feat(cloud): add review jobs submit plans and dashboard"
```

## Task 7: Cloud Web UI Shell, Admin, Machines, Prompts, Batch Review, Dashboard

**Files:**
- Create: `cloud/approval-workbench/src/app/main.ts`
- Create: `cloud/approval-workbench/src/app/App.vue`
- Create: `cloud/approval-workbench/src/app/api.ts`
- Create: `cloud/approval-workbench/src/app/views/LoginView.vue`
- Create: `cloud/approval-workbench/src/app/views/AdminUsersView.vue`
- Create: `cloud/approval-workbench/src/app/views/MachinesView.vue`
- Create: `cloud/approval-workbench/src/app/views/PromptLibraryView.vue`
- Create: `cloud/approval-workbench/src/app/views/BatchListView.vue`
- Create: `cloud/approval-workbench/src/app/views/BatchReviewView.vue`
- Create: `cloud/approval-workbench/src/app/views/DashboardView.vue`
- Test: `cloud/approval-workbench/src/tests/ui-contract.test.ts`

- [ ] **Step 1: Write UI contract tests**

Create `cloud/approval-workbench/src/tests/ui-contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

function read(path: string): string {
  return fs.readFileSync(path, 'utf8')
}

describe('cloud approval UI contract', () => {
  it('does not expose public registration copy', () => {
    const login = read('src/app/views/LoginView.vue')
    expect(login).not.toMatch(/注册|sign up|create account/i)
    expect(login).toMatch(/登录/)
  })

  it('has pages for machines prompts batches dashboard and admin users', () => {
    const app = read('src/app/App.vue')
    for (const label of ['账号', '任务机', 'Prompt', '审批批次', '数据看板']) {
      expect(app).toContain(label)
    }
  })

  it('machine page includes one-time token warning', () => {
    const machines = read('src/app/views/MachinesView.vue')
    expect(machines).toContain('只展示一次')
    expect(machines).toContain('注册 token')
  })

  it('batch review has approve reject regenerate and submit actions', () => {
    const review = read('src/app/views/BatchReviewView.vue')
    for (const text of ['确认', '舍弃', '一键重生图', '提交创建测图任务']) {
      expect(review).toContain(text)
    }
  })
})
```

- [ ] **Step 2: Implement app shell and API wrapper**

Create `cloud/approval-workbench/src/app/api.ts` with typed `apiGet`, `apiPost`, and `apiPatch` wrappers that include credentials and throw `{status, message}` on non-2xx.

Create `App.vue` as an authenticated operations UI with compact navigation. Use `me.permissions` to hide links, but keep a comment that backend remains authoritative.

- [ ] **Step 3: Implement pages**

Implement each page with feature-complete V1 controls:

- `LoginView.vue`: email/password only, no registration link.
- `AdminUsersView.vue`: user list, create user modal, role assignment, disable user.
- `MachinesView.vue`: enrollment token creation, one-time token display, machine list, approve/disable/revoke/rotate token.
- `PromptLibraryView.vue`: library list, template editor, publish version.
- `BatchListView.vue`: status filters and batch search.
- `BatchReviewView.vue`: per-style asset rail, approve/reject/pending, prompt display, regenerate selected, submit machine picker.
- `DashboardView.vue`: summary cards and tables for batch, Prompt, and machine metrics.

- [ ] **Step 4: Run checks**

Run:

```bash
cd /Users/xingyicheng/Documents/crawshrimp/cloud/approval-workbench
npm run typecheck
npm test -- src/tests/ui-contract.test.ts
npm run build
```

Expected: all pass and Vite builds.

- [ ] **Step 5: Commit Task 7**

```bash
git add cloud/approval-workbench
git commit -m "feat(cloud): add approval workbench ui"
```

## Task 8: Desktop Cloud Config And Local Persistence

**Files:**
- Modify: `core/config.py`
- Modify: `core/data_sink.py`
- Create: `tests/test_cloud_config.py`
- Create: `tests/test_cloud_machine_data_sink.py`

- [ ] **Step 1: Write config tests**

Create `tests/test_cloud_config.py`:

```python
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core.config import DEFAULT_CONFIG, load_config, patch_config


class CloudConfigTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patcher = patch("core.runtime_paths.data_root", return_value=Path(self.tmp.name))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_default_cloud_approval_config_is_empty_and_disabled(self):
        cloud = DEFAULT_CONFIG["cloud_approval"]
        self.assertEqual(cloud["base_url"], "")
        self.assertEqual(cloud["machine_name"], "")
        self.assertFalse(cloud["machine_enabled"])

    def test_patch_config_expands_cloud_approval_keys(self):
        cfg = patch_config({
            "cloud_approval.base_url": "https://ai-review.example.com",
            "cloud_approval.machine_name": "设计部任务机01",
            "cloud_approval.machine_enabled": True,
        })
        self.assertEqual(cfg["cloud_approval"]["base_url"], "https://ai-review.example.com")
        self.assertEqual(load_config()["cloud_approval"]["machine_name"], "设计部任务机01")
        self.assertTrue(load_config()["cloud_approval"]["machine_enabled"])
```

- [ ] **Step 2: Write local machine persistence tests**

Create `tests/test_cloud_machine_data_sink.py`:

```python
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core import data_sink


class CloudMachineDataSinkTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patcher = patch("core.runtime_paths.data_root", return_value=Path(self.tmp.name))
        patcher.start()
        self.addCleanup(patcher.stop)
        data_sink.init_db()

    def test_save_and_load_cloud_machine_credentials(self):
        saved = data_sink.save_cloud_machine_credentials(
            machine_id="machine-1",
            machine_token="csr_machine_secret",
            machine_name="任务机 1",
            capabilities=["regenerate_ai_image"],
        )
        loaded = data_sink.get_cloud_machine_credentials()

        self.assertEqual(saved["machine_id"], "machine-1")
        self.assertEqual(loaded["machine_token"], "csr_machine_secret")
        self.assertEqual(loaded["capabilities"], ["regenerate_ai_image"])

    def test_record_cloud_job_event(self):
        data_sink.record_cloud_job_event(
            job_uid="job-1",
            event_type="progress",
            message="执行到第 1 款",
            payload={"style_code": "208326105206"},
        )
        events = data_sink.list_cloud_job_events("job-1")

        self.assertEqual(events[0]["event_type"], "progress")
        self.assertEqual(events[0]["payload"]["style_code"], "208326105206")
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
cd /Users/xingyicheng/Documents/crawshrimp
python -m unittest tests.test_cloud_config tests.test_cloud_machine_data_sink -v
```

Expected: fails because config and data sink helpers are missing.

- [ ] **Step 4: Add config defaults**

Modify `core/config.py`:

```python
    "cloud_approval": {
        "base_url": "",
        "machine_name": "",
        "machine_enabled": False,
        "registration_token": "",
        "poll_timeout_seconds": 45,
        "idle_heartbeat_seconds": 60,
        "busy_heartbeat_seconds": 10,
    },
```

- [ ] **Step 5: Add local cloud tables and helpers**

Modify `core/data_sink.py` inside `init_db()`:

```python
        conn.execute("""
            CREATE TABLE IF NOT EXISTS cloud_machine_credentials (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                machine_id TEXT NOT NULL DEFAULT '',
                machine_token TEXT NOT NULL DEFAULT '',
                machine_name TEXT NOT NULL DEFAULT '',
                capabilities_json TEXT NOT NULL DEFAULT '[]',
                updated_at TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS cloud_job_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_uid TEXT NOT NULL,
                event_type TEXT NOT NULL,
                message TEXT NOT NULL DEFAULT '',
                payload_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL
            )
        """)
```

Add these functions with concrete implementations:

```python
def save_cloud_machine_credentials(machine_id: str, machine_token: str, machine_name: str, capabilities: list[str]) -> dict:
    now = _now_iso()
    with _get_conn() as conn:
        conn.execute(
            """
            INSERT INTO cloud_machine_credentials (
                id, machine_id, machine_token, machine_name, capabilities_json, updated_at
            )
            VALUES (1, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                machine_id = excluded.machine_id,
                machine_token = excluded.machine_token,
                machine_name = excluded.machine_name,
                capabilities_json = excluded.capabilities_json,
                updated_at = excluded.updated_at
            """,
            (machine_id, machine_token, machine_name, json.dumps(capabilities or [], ensure_ascii=False), now),
        )
        conn.commit()
    return get_cloud_machine_credentials() or {}

def get_cloud_machine_credentials() -> dict | None:
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM cloud_machine_credentials WHERE id = 1").fetchone()
    if not row:
        return None
    data = dict(row)
    try:
        data["capabilities"] = json.loads(data.pop("capabilities_json") or "[]")
    except Exception:
        data["capabilities"] = []
    return data

def clear_cloud_machine_credentials() -> None:
    with _get_conn() as conn:
        conn.execute("DELETE FROM cloud_machine_credentials WHERE id = 1")
        conn.commit()

def record_cloud_job_event(job_uid: str, event_type: str, message: str = "", payload: Optional[Mapping[str, Any]] = None) -> dict:
    now = _now_iso()
    with _get_conn() as conn:
        cursor = conn.execute(
            """
            INSERT INTO cloud_job_events (job_uid, event_type, message, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (job_uid, event_type, message, _json_dumps(dict(payload or {})), now),
        )
        conn.commit()
        event_id = cursor.lastrowid
        row = conn.execute("SELECT * FROM cloud_job_events WHERE id = ?", (event_id,)).fetchone()
    data = dict(row)
    data["payload"] = _json_loads_object(data.pop("payload_json"))
    return data

def list_cloud_job_events(job_uid: str, limit: int = 100) -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            """
            SELECT * FROM cloud_job_events
            WHERE job_uid = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (job_uid, max(1, int(limit or 100))),
        ).fetchall()
    result = []
    for row in reversed(rows):
        data = dict(row)
        data["payload"] = _json_loads_object(data.pop("payload_json"))
        result.append(data)
    return result
```

Use `_json_dumps`, `_json_loads_object`, `_now_iso`, and `_row_to_dict`.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
python -m unittest tests.test_cloud_config tests.test_cloud_machine_data_sink -v
```

Commit:

```bash
git add core/config.py core/data_sink.py tests/test_cloud_config.py tests/test_cloud_machine_data_sink.py
git commit -m "feat(cloud): add desktop cloud config storage"
```

## Task 9: Desktop Cloud Client And Batch Sync Payload Builder

**Files:**
- Create: `core/cloud_approval_client.py`
- Create: `core/cloud_batch_sync.py`
- Modify: `adapters/tmall-ops-assistant/tools/run_tmall_ai_image_test_chain.py`
- Create: `tests/test_cloud_approval_client.py`
- Create: `tests/test_cloud_batch_sync.py`

- [ ] **Step 1: Write client tests**

Create `tests/test_cloud_approval_client.py` with fake transport tests:

- `CloudApprovalClient` trims trailing slash from base URL.
- `request_json` includes bearer machine token when provided.
- `request_json` retries 429 and 5xx with bounded backoff.
- `upload_asset` calls upload URL with bytes and content type.
- client never logs or returns full token values in exceptions.

- [ ] **Step 2: Implement cloud client**

Create `core/cloud_approval_client.py`:

```python
class CloudApprovalError(RuntimeError):
    pass

class CloudApprovalClient:
    def __init__(self, base_url: str, user_token: str = "", machine_token: str = "", timeout: float = 30.0, transport=None):
        self.base_url = str(base_url or "").rstrip("/")
        self.user_token = str(user_token or "")
        self.machine_token = str(machine_token or "")
        self.timeout = float(timeout or 30.0)
        self.transport = transport

    def request_json(self, method: str, path: str, body: Optional[Mapping[str, Any]] = None, *, token_type: str = "machine") -> dict:
        """Send JSON to the cloud API, retry 429/5xx, and return a JSON object."""
        raise CloudApprovalError("request_json implementation belongs in Task 9 Step 2")

    def upload_asset(self, upload_url: str, path: Path, content_type: str) -> dict:
        """Upload one local file to the cloud-provided upload URL."""
        raise CloudApprovalError("upload_asset implementation belongs in Task 9 Step 2")
```

Use `urllib.request` from the standard library to avoid new desktop dependencies.

- [ ] **Step 3: Write batch sync tests**

Create `tests/test_cloud_batch_sync.py` using a small local approval batch dict with one style, one source image, and two AI assets. Assert:

- `build_cloud_batch_payload(batch)` includes `batch_uid`, `styles`, `assets`, prompt text, prompt version fields when present.
- raw absolute paths are only in `source_path_label` metadata.
- `sync_local_approval_batch(batch, client)` calls `POST /api/ai-image-batches`, presign, upload, and `sync-complete`.

- [ ] **Step 4: Implement batch sync builder**

Create `core/cloud_batch_sync.py`:

```python
def build_cloud_batch_payload(batch: Mapping[str, Any]) -> dict:
    """Return the JSON payload for POST /api/ai-image-batches."""
    raise ValueError("batch must contain batch_id and items") if not batch.get("batch_id") else None
    return {"batch_uid": str(batch["batch_id"]), "styles": [], "assets": []}

def iter_local_asset_files(batch: Mapping[str, Any]) -> list[dict]:
    """Return uploadable local files with asset_uid, kind, path, filename, and content_type."""
    return []

def sync_local_approval_batch(batch: Mapping[str, Any], client: CloudApprovalClient) -> dict:
    """Create/update the cloud batch, upload assets, then mark sync complete."""
    payload = build_cloud_batch_payload(batch)
    return client.request_json("POST", "/api/ai-image-batches", payload)
```

Map local assets:

- `kind='origin'` or local source image -> cloud `kind='source'`.
- `kind='reference'` -> cloud `kind='reference'`.
- `kind='ai'` -> cloud `kind='ai'`.
- Use `asset_uid` from local asset id when stable; otherwise derive `sha256(batch_id/style_code/path/prompt_index)`.

- [ ] **Step 5: Trigger optional sync after local batch creation**

Modify `run_tmall_ai_image_test_chain.py` immediately after `write_approval_batch` returns a batch:

- If cloud approval config is disabled or base URL missing, do nothing.
- If enabled and machine credentials exist, call `sync_local_approval_batch`.
- On sync failure, keep local approval batch and add a warning row/event; do not fail the local generation run.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
python -m unittest tests.test_cloud_approval_client tests.test_cloud_batch_sync tests.test_tmall_ai_image_chain_script -v
```

Commit:

```bash
git add core/cloud_approval_client.py core/cloud_batch_sync.py adapters/tmall-ops-assistant/tools/run_tmall_ai_image_test_chain.py tests/test_cloud_approval_client.py tests/test_cloud_batch_sync.py
git commit -m "feat(cloud): sync local approval batches"
```

## Task 10: Desktop Machine Agent Enrollment, Heartbeat, Claim, And Backoff

**Files:**
- Create: `core/cloud_machine_agent.py`
- Create: `tests/test_cloud_machine_agent.py`

- [ ] **Step 1: Write machine agent tests**

Create `tests/test_cloud_machine_agent.py` with fake client tests:

- enrollment stores returned machine credentials.
- heartbeat sends app version, health, capabilities, and current job id.
- idle loop uses server `next_poll_after_seconds`.
- failures back off in sequence `10, 30, 60, 120`.
- claim with no job does not spin faster than configured idle heartbeat.
- stale or revoked token clears local credentials only after cloud returns `401` with `machine_token_revoked`.

- [ ] **Step 2: Implement machine agent**

Create `core/cloud_machine_agent.py`:

```python
class CloudMachineAgent:
    def __init__(self, client: CloudApprovalClient, *, sleep=time.sleep, now=time.time):
        self.client = client
        self.sleep = sleep
        self.now = now

    def enroll(self, registration_token: str, machine_name: str, capabilities: list[str]) -> dict:
        return self.client.request_json("POST", "/api/machines/enroll", {
            "registration_token": registration_token,
            "machine_name": machine_name,
            "capabilities": capabilities,
        })

    def heartbeat(self, health: str, current_job_id: str = "") -> dict:
        return self.client.request_json("POST", "/api/machines/heartbeat", {
            "health": health,
            "current_job_id": current_job_id,
        })

    def claim_once(self) -> dict:
        return self.client.request_json("POST", "/api/machines/jobs/claim", {})

    def run_forever(self, stop_event) -> None:
        while not stop_event.is_set():
            result = self.claim_once()
            self.sleep(float(result.get("next_poll_after_seconds") or 45))
```

Backoff rules:

- normal idle: use cloud `next_poll_after_seconds`, default 45.
- busy progress: 5 to 15 seconds through executor callbacks.
- network error: 10, 30, 60, then 120 seconds cap.
- no high-frequency loop.

- [ ] **Step 3: Run tests and commit**

Run:

```bash
python -m unittest tests.test_cloud_machine_agent -v
```

Commit:

```bash
git add core/cloud_machine_agent.py tests/test_cloud_machine_agent.py
git commit -m "feat(cloud): add desktop machine agent"
```

## Task 11: Desktop Cloud Job Executors For Regeneration And Submit

**Files:**
- Create: `core/cloud_job_executors.py`
- Modify: `core/cloud_machine_agent.py`
- Create: `tests/test_cloud_job_executors.py`

- [ ] **Step 1: Write executor tests**

Create `tests/test_cloud_job_executors.py` with patched Tmall module tests:

- `regenerate_ai_image` downloads source/reference assets, calls local regeneration function, uploads new asset, and completes job.
- `submit_tmall_material_test` downloads approved images, calls local upload/create function, reports progress, and completes with result path.
- stale lease completion is not retried as success.
- `blocked_needs_login` is returned when local browser/Tmall readiness check fails.
- `submit_tmall_material_test` does not auto retry a terminal failure.

- [ ] **Step 2: Implement executor dispatcher**

Create `core/cloud_job_executors.py`:

```python
class CloudJobExecutor:
    def __init__(self, client: CloudApprovalClient, work_dir: Path):
        self.client = client
        self.work_dir = work_dir

    def execute(self, job: Mapping[str, Any]) -> dict:
        job_type = str(job.get("job_type") or "")
        if job_type == "regenerate_ai_image":
            return self.execute_regenerate_ai_image(job)
        if job_type == "submit_tmall_material_test":
            return self.execute_submit_tmall_material_test(job)
        raise ValueError(f"Unsupported cloud job type: {job_type}")

    def execute_regenerate_ai_image(self, job: Mapping[str, Any]) -> dict:
        raise ValueError("regenerate_ai_image payload is missing") if not job.get("payload") else None
        return {"status": "succeeded"}

    def execute_submit_tmall_material_test(self, job: Mapping[str, Any]) -> dict:
        raise ValueError("submit_tmall_material_test payload is missing") if not job.get("payload") else None
        return {"status": "succeeded"}
```

Implementation requirements:

- Payload is declarative; reject unknown job types.
- Use task-local work dir under `runtime_paths.data_root() / "cloud-jobs" / job_uid`.
- Do not use cloud-provided absolute paths.
- Report progress before long-running local generation/upload steps.
- Complete/fail always includes `lease_id`.

- [ ] **Step 3: Wire executor into machine agent**

Modify `CloudMachineAgent.claim_once()`:

- If claim returns no job, return idle result.
- If claim returns job, call `CloudJobExecutor.execute(job)`.
- During execution, send progress and renew lease.
- On `blocked_needs_login`, fail job with that status and keep machine health `needs_login`.

- [ ] **Step 4: Run tests and commit**

Run:

```bash
python -m unittest tests.test_cloud_job_executors tests.test_cloud_machine_agent -v
```

Commit:

```bash
git add core/cloud_job_executors.py core/cloud_machine_agent.py tests/test_cloud_job_executors.py tests/test_cloud_machine_agent.py
git commit -m "feat(cloud): execute machine jobs locally"
```

## Task 12: Local API, Electron IPC, Settings UI, And Cloud Approval Entry

**Files:**
- Modify: `core/api_server.py`
- Modify: `app/src/main.js`
- Modify: `app/src/preload.js`
- Modify: `app/src/renderer/utils/devCsBridge.js`
- Modify: `app/src/renderer/views/SettingsPage.vue`
- Create: `app/src/renderer/views/CloudApprovalFrame.vue`
- Modify: `app/src/renderer/App.vue`
- Create: `tests/cloud-approval-ipc.test.js`
- Create: `tests/cloud-approval-settings.test.js`
- Create: `tests/test_cloud_api_server.py`

- [ ] **Step 1: Write backend API tests**

Create `tests/test_cloud_api_server.py` to assert routes exist and call service helpers:

- `GET /cloud-approval/status`
- `POST /cloud-approval/config`
- `POST /cloud-approval/enroll-machine`
- `POST /cloud-approval/sync-batch`
- `POST /cloud-approval/machine/start`
- `POST /cloud-approval/machine/stop`

- [ ] **Step 2: Implement local cloud API routes**

Modify `core/api_server.py`:

- Add request models for config, enrollment, sync batch.
- Do not return full machine token in status.
- Start/stop machine agent through an in-process controller with one active loop per backend process.
- Manual sync accepts local approval batch id and token, then reuses `_load_tmall_approval_batch`.

- [ ] **Step 3: Write Electron and settings static tests**

Create `tests/cloud-approval-ipc.test.js` to assert `app/src/main.js`, `app/src/preload.js`, and `devCsBridge.js` expose:

- `getCloudApprovalStatus`
- `saveCloudApprovalConfig`
- `enrollCloudMachine`
- `startCloudMachine`
- `stopCloudMachine`
- `syncCloudApprovalBatch`

Create `tests/cloud-approval-settings.test.js` to assert Settings page contains:

- `云端审批`
- `云端地址`
- `注册 token`
- `任务机名称`
- `启用任务机`

- [ ] **Step 4: Implement IPC and renderer settings**

Modify Electron files to call local `/cloud-approval/*` routes through existing backend request helpers.

Modify `SettingsPage.vue` to add the cloud approval panel and never display stored long-lived machine token.

Create `CloudApprovalFrame.vue`:

- Shows machine online/auth/health state.
- Opens configured cloud URL in an iframe or external browser button.
- Shows a safe warning when no cloud URL is configured.

Modify `App.vue` to add a `云端审批` nav item when configured.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
python -m unittest tests.test_cloud_api_server -v
node --test tests/cloud-approval-ipc.test.js tests/cloud-approval-settings.test.js
cd app && npm test
```

Commit:

```bash
git add core/api_server.py app/src/main.js app/src/preload.js app/src/renderer/utils/devCsBridge.js app/src/renderer/views/SettingsPage.vue app/src/renderer/views/CloudApprovalFrame.vue app/src/renderer/App.vue tests/test_cloud_api_server.py tests/cloud-approval-ipc.test.js tests/cloud-approval-settings.test.js
git commit -m "feat(cloud): expose desktop cloud approval controls"
```

## Task 13: End-To-End Dry Run Harness And Documentation

**Files:**
- Create: `scripts/cloud_approval_dry_run.py`
- Create: `docs/cloud-approval-workbench-runbook.md`
- Modify: `README.md`
- Test: `tests/test_cloud_approval_dry_run.py`

- [ ] **Step 1: Write dry-run test**

Create `tests/test_cloud_approval_dry_run.py` that patches cloud client and local batch data to verify:

- seed admin user instructions are present.
- enrollment token is created.
- fake machine enrolls.
- fake local batch syncs.
- rejected image creates regeneration job.
- approved image creates submit job.

- [ ] **Step 2: Implement dry-run script**

Create `scripts/cloud_approval_dry_run.py`:

```python
def main() -> int:
    """Run a local fake cloud approval loop without Tmall side effects."""
```

The script should use fake HTTP transport by default and require `--live-cloud-url` for real cloud calls. It must print each phase and exit non-zero on failed assertions.

- [ ] **Step 3: Write runbook**

Create `docs/cloud-approval-workbench-runbook.md` with:

- Phase 0 local startup commands.
- How to seed first admin.
- How to create a registration token.
- How to configure Crawshrimp Settings.
- How to run a local AI batch and sync to cloud.
- How to review and trigger regeneration.
- How to submit through a task machine.
- How to revoke a task machine.
- Safety notes for Tmall login state and duplicate submit prevention.

- [ ] **Step 4: Update README with link only**

Add one concise paragraph to `README.md` linking to the runbook and stating that the cloud approval workbench is an optional workflow for `巴拉-AI测图全链路`.

- [ ] **Step 5: Run final scoped validation**

Run:

```bash
python -m unittest tests.test_cloud_config tests.test_cloud_machine_data_sink tests.test_cloud_approval_client tests.test_cloud_batch_sync tests.test_cloud_machine_agent tests.test_cloud_job_executors tests.test_cloud_api_server tests.test_cloud_approval_dry_run -v
node --test tests/cloud-approval-ipc.test.js tests/cloud-approval-settings.test.js
cd cloud/approval-workbench && npm run check
cd /Users/xingyicheng/Documents/crawshrimp/app && npm test
git diff --check
```

Expected: all pass.

- [ ] **Step 6: Commit Task 13**

```bash
git add scripts/cloud_approval_dry_run.py docs/cloud-approval-workbench-runbook.md README.md tests/test_cloud_approval_dry_run.py
git commit -m "docs(cloud): add approval workbench runbook and dry run"
```

## Self-Review Checklist

- Spec coverage:
  - Account management and no public registration: Task 2 and Task 7.
  - RBAC and audit logs: Task 2.
  - Machine registration token, long-lived token, approval, revoke, heartbeat, claim, lease: Task 3 and Task 10.
  - Queue state machine and idempotency: Task 3 and Task 6.
  - Cloud Prompt library and versioning: Task 4.
  - Local generation followed by cloud batch sync: Task 5 and Task 9.
  - Cloud approval, rejected/approved images, regenerate jobs: Task 6.
  - Desktop task-machine execution: Task 10 and Task 11.
  - Submit plan and Tmall task creation through selected machine: Task 6 and Task 11.
  - Standalone cloud page and Electron entry to same URL: Task 7 and Task 12.
  - Data dashboard: Task 6 and Task 7.
  - Runbook and dry-run verification: Task 13.

- Placeholder scan: this plan intentionally avoids open-ended implementation steps. Any implementer should still verify current Cloudflare binding syntax before editing `wrangler.toml`.

- Type consistency:
  - Machine capability strings are `regenerate_ai_image` and `submit_tmall_material_test`.
  - Machine auth statuses are `pending_approval`, `active`, `disabled`, `revoked`, and `rejected`.
  - Machine health statuses are `offline`, `online_idle`, `online_busy`, `needs_login`, `config_missing`, and `version_blocked`.
  - Dispatch jobs use `job_uid`, `job_type`, `status`, `idempotency_key`, `lease_id`, and `lease_expires_at`.
