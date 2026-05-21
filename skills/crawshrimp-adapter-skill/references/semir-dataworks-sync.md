# Semir DataWorks Sync

Use this reference when a crawshrimp task needs to sync exported data to the Semir big-data team's unified ODPS/DataWorks gateway.

## Contract

Unified endpoint:

```text
POST http://dataworksapi.semirapp.com/api/v1/dataworks/write_odps
Content-Type: application/json
Authorization: APPCODE <AppCode>
```

Do not call this endpoint from adapter JavaScript. Crawshrimp adapters should export stable Excel files; the backend sync sink converts those files into the DataWorks payload.

Payload shape:

```json
{
  "table_name": "imp_ods_temu_mall_flux",
  "fields": [
    {"name": "platform_name", "type": "string", "comment": "平台名称"}
  ],
  "data": [
    {"platform_name": "Temu"}
  ],
  "write_mode": "append",
  "partition_spec": {"dt": "2026-05-18"}
}
```

## Code Touchpoints

Backend sync lives in `core/odps_sync.py`.

For each syncable task, maintain:

- `TASK_TABLE_MAP`: `(adapter_id, task_id)` to target ODPS table name.
- `TASK_FIELD_MAP`: exported Chinese Excel header to ODPS-safe field name.
- `TASK_FIELD_TYPE_MAP`: exported Chinese Excel header to ODPS field type.

HTTP route:

- `POST /data-sync/odps`
- request fields: `adapter_id`, `task_id`, `paths`, optional `endpoint`, optional `app_code`

Frontend entry points may call `window.cs.syncOdpsFiles(...)`; do not duplicate DataWorks request logic in Vue/Electron.
The Semir gateway URL is the backend default. Product UI should ask normal users only for `ODPS AppCode`; endpoint override is reserved for development or smoke tests.

## Credential Rules

Never hardcode real AppCode or AppSecret in SDK docs, adapters, tests, or committed config.

Credential and endpoint resolution should use this priority:

1. Request body `endpoint` / `app_code`
2. Settings `odps.app_code`
3. Env vars `CRAWSHRIMP_ODPS_ENDPOINT` / `CRAWSHRIMP_ODPS_APP_CODE`
4. Built-in default endpoint `http://dataworksapi.semirapp.com/api/v1/dataworks/write_odps`

For internal testing, settings or environment variables are acceptable. For distributed desktop builds, prefer a server-side relay so the AppCode stays on the server and can be rotated, audited, and rate-limited.

Logs and user-facing errors must not print AppCode or AppSecret.

## Verification

Minimum local checks:

```bash
./venv/bin/python -m unittest tests.test_odps_sync -v
./venv/bin/python -m py_compile core/odps_sync.py core/api_server.py
npm --prefix app run vite:build
```

Real sync smoke test:

```bash
curl -sS -x '' -X POST http://127.0.0.1:18765/data-sync/odps \
  -H 'Content-Type: application/json' \
  -d '{
    "adapter_id": "temu",
    "task_id": "mall_flux",
    "paths": ["/absolute/path/to/export.xlsx"],
    "endpoint": "http://dataworksapi.semirapp.com/api/v1/dataworks/write_odps",
    "app_code": "<AppCode>"
  }'
```

Success signal:

- top-level `ok: true`
- `failed_count: 0`
- DataWorks response contains `success: true`
- response message resembles `append 成功`
- response `count` equals exported row count

If the endpoint returns HTTP errors, first check URL normalization, AppCode header, payload JSON validity, and partition `dt`.
