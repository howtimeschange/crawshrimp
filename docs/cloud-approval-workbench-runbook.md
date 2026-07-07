# Crawshrimp Cloud Approval Workbench Runbook

This runbook covers the optional cloud approval workflow for `巴拉-AI测图全链路`. It keeps image generation local, syncs the approval batch to the Cloudflare workbench, and lets an approved task machine execute regeneration or Tmall material-test submit jobs.

## Phase 0: Local Startup

Cloud app:

```bash
cd /Users/xingyicheng/Documents/crawshrimp/cloud/approval-workbench
npm install
npm run check
npx wrangler dev
```

Desktop app:

```bash
cd /Users/xingyicheng/Documents/crawshrimp
bash dev.sh
cd app && npm run dev
```

Dry-run harness with no Cloudflare or Tmall side effects:

```bash
cd /Users/xingyicheng/Documents/crawshrimp
python scripts/cloud_approval_dry_run.py
```

The harness uses a deterministic fake HTTP transport by default. Real cloud calls are opt-in only:

```bash
python scripts/cloud_approval_dry_run.py --live-cloud-url https://YOUR_WORKER_URL
```

If a live admin route is needed, pass the current admin session cookie at the shell prompt only. Do not write cookies, Cloudflare tokens, or machine tokens into repo files.

## Seed First Admin

There is no public registration route. The implemented auth surface starts at `POST /api/auth/login`, and admin user management is under `/api/admin/users`.

For a new D1 database, create the first admin during deployment with controlled D1 SQL or an operator-only script that writes these tables from `cloud/approval-workbench/migrations/0001_init.sql`:

- `roles`
- `role_permissions`
- `users`
- `user_roles`

Use the role keys and permissions from `cloud/approval-workbench/src/worker/security/rbac.ts`. The password hash format implemented by `cloud/approval-workbench/src/worker/security/password.ts` is:

```text
sha256:<salt>:<sha256(salt:password)>
```

After the first admin can log in, create all other users through `POST /api/admin/users` or the Admin Users page.

## Create A Registration Token

From the cloud workbench Machines page, create an enrollment token with these capabilities:

```text
regenerate_ai_image,submit_tmall_material_test
```

The backing route is:

```http
POST /api/admin/machine-enrollment-tokens
```

Use `require_approval=false` only for trusted local test machines. Otherwise keep approval required, enroll the machine, then activate it with:

```http
POST /api/admin/machines/{machine_id}/approve
```

## Configure Crawshrimp Settings

In the desktop app, open Settings -> Cloud Approval and set:

- Cloud approval base URL: the deployed Worker URL, without a trailing slash.
- Registration token: the one-time token created in the cloud workbench.
- Machine name: a recognizable local workstation name.
- Task capabilities (`任务能力`): select `regenerate_ai_image` and `submit_tmall_material_test`.

Implemented desktop routes:

```http
POST /cloud-approval/config
POST /cloud-approval/enroll-machine
POST /cloud-approval/machine/start
POST /cloud-approval/machine/stop
GET /cloud-approval/status
```

After enrollment, the desktop stores the long-lived machine token locally through `core.data_sink`; the status route intentionally does not return that token.

## Run A Local AI Batch And Sync To Cloud

Run `巴拉-AI测图全链路` locally until it creates a local approval batch. Keep the local approval token from the generated approval URL.

Sync from the desktop Cloud Approval settings or IPC flow. The backing route is:

```http
POST /cloud-approval/sync-batch
```

Payload shape:

```json
{
  "batch_id": "LOCAL_BATCH_ID",
  "token": "LOCAL_APPROVAL_TOKEN"
}
```

The desktop validates the local approval token, builds the cloud payload through `core/cloud_batch_sync.py`, calls `POST /api/ai-image-batches/sync`, uploads assets through `/api/assets/presign` and `/api/assets/upload/...`, then marks the batch complete with:

```http
POST /api/ai-image-batches/{batch_uid}/sync-complete
```

## Review And Trigger Regeneration

Open the cloud approval workbench Batches page, then select the synced batch.

Review decisions use:

```http
PATCH /api/ai-image-batches/{batch_uid}/assets/{asset_uid}/decision
```

To trigger regeneration for rejected AI images:

```http
POST /api/ai-image-batches/{batch_uid}/regenerate
```

The job type is `regenerate_ai_image`, and task machines claim it through:

```http
POST /api/machines/jobs/claim
```

## Submit Through A Task Machine

Approve at least one AI image for every non-skipped style, then mark the batch ready:

```http
POST /api/ai-image-batches/{batch_uid}/mark-ready
GET /api/ai-image-batches/{batch_uid}/submit-plan
```

Choose an active machine that has `submit_tmall_material_test`, then create the submit job:

```http
POST /api/ai-image-batches/{batch_uid}/submit
```

Payload:

```json
{
  "machine_id": "TASK_MACHINE_ID"
}
```

The submit job type is `submit_tmall_material_test`. The selected desktop machine downloads the approved cloud assets, rebuilds a local submit batch, and calls the Tmall uploader in `core/cloud_job_executors.py`.

## Revoke A Task Machine

Use the Machines page or call:

```http
POST /api/admin/machines/{machine_id}/revoke
```

This sets the machine auth status to `revoked` and revokes active machine tokens. The next desktop cloud request should fail authorization, and local credentials are cleared when the desktop sees the `machine_token_revoked` signal.

## Safety Notes

- Tmall submit uses the local Chrome/Tmall login state on the selected task machine. Before starting the machine loop, verify that Chrome is logged into the correct Tmall seller account and that CDP is reachable on the expected local browser session.
- If Chrome is not logged in or CDP is unavailable, the desktop job executor reports `blocked_needs_login`; do not retry blindly until the local browser state is fixed.
- Duplicate submit prevention is cloud-side and machine-scoped: submit jobs use the idempotency key `submit_tmall_material_test:{batch_uid}:{machine_id}`. Re-clicking submit for the same batch and machine returns the existing job instead of creating another one.
- A different machine ID creates a different submit idempotency key. Only submit from a second machine after confirming the first job did not create a Tmall material-test task.
- Keep Cloudflare API tokens, admin session cookies, enrollment tokens, and machine tokens out of commits, docs, screenshots, and shell history where possible.
