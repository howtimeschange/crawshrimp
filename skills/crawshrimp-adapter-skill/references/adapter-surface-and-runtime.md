# Adapter Surface Map And Runtime Verification

Use this note when the question is not “how do I probe the page”, but “which crawshrimp surfaces does this change belong to, and how do I prove the runtime is using the latest code”.

## 1. Start By Mapping The Change Surface

Most crawshrimp adapter work lands in one or more of these layers:

- `adapters/<adapter_id>/manifest.yaml`
- `adapters/<adapter_id>/<task-script>.js`
- `tests/<adapter-task>.test.js`
- `core/js_runner.py`
- `core/api_server.py`
- `core/data_sink.py`
- `app/src/renderer/utils/taskProgress.js`
- `app/src/renderer/App.vue`
- `app/src/renderer/views/ScriptList.vue`
- `app/src/renderer/views/TaskRunner.vue`
- `sdk/ADAPTER_GUIDE.md`
- `DEVELOPMENT.md`

Choose the smallest correct surface:

- adapter-only bug:
  - task script
  - targeted Node regression
- adapter contract or parameter change:
  - task script
  - `manifest.yaml`
  - targeted regression
  - docs if the contract changed
- progress UX change:
  - adapter script writes stable `shared`
  - backend live mapping if needed
  - frontend whitelist and summary builders
- export/runtime artifact change:
  - adapter script
  - `core/api_server.py` or `core/data_sink.py` if sink behavior changed

Do not touch shared frontend or backend files when the bug is fully local to one adapter.

## 2. `manifest.yaml` Is Part Of The External Contract

Treat manifest edits as contract edits.

Typical responsibilities of `manifest.yaml`:

- task id and task name
- param ids, types, labels, defaults
- source-file expectations
- output schema or visible task metadata

Rules:

- keep `task_id` stable unless you truly intend a breaking change
- keep param ids stable once users or tests depend on them
- do not encode enhanced-progress mode in manifest
- do not move UI-policy decisions from desktop code into adapter-local flags

If a bugfix only changes flow stability, you often should not need a manifest edit at all.

## 3. Know What The Runtime Actually Executes

Crawshrimp does not execute the repo adapter file directly.

For adapter scripts, the runtime truth is usually:

- repo source:
  - `/absolute/path/to/repo/adapters/<adapter_id>/...`
- installed runtime copy:
  - `~/.crawshrimp/adapters/<adapter_id>/...`

If you only edit the repo file and skip install, your live test can still be running stale code.

## 4. Runtime Sync Verification Flow

After changing adapter files:

1. install the adapter copy into runtime
2. verify the installed file matches the repo source
3. only then run UI or live validation

Install:

```bash
curl -sS -x '' -X POST http://127.0.0.1:18765/adapters/install \
  -H 'Content-Type: application/json' \
  -d '{"path":"/absolute/path/to/repo/adapters/<adapter_id>"}'
```

Verify:

```bash
shasum -a 256 \
  /absolute/path/to/repo/adapters/<adapter_id>/<task-script>.js \
  ~/.crawshrimp/adapters/<adapter_id>/<task-script>.js
```

Or:

```bash
diff -qr /absolute/path/to/repo/adapters/<adapter_id> ~/.crawshrimp/adapters/<adapter_id>
```

If the hashes or diff do not match, stop. Do not trust any UI regression result yet.

## 5. Adapter Install Is Not The Same As Refreshing Every Surface

Different change surfaces need different refresh actions:

- adapter script or manifest only:
  - adapter install is usually enough
- frontend renderer files:
  - rebuild or restart the frontend runtime as needed
- backend Python files:
  - ensure the running backend process is using the updated code

Do not assume `/adapters/install` updates frontend bundles or a running Python process.

## 6. Keep Commit Boundaries Honest

Before staging:

- decide whether this is:
  - adapter-only
  - adapter + shared frontend
  - adapter + backend contract
  - adapter + docs
- stage only the files that belong to that boundary

If shared files are included, the commit message should say so.

## 7. Good Smells vs Bad Smells

Good:

- adapter bug fixed in one task script plus one targeted regression
- shared frontend touched only when enhanced progress is genuinely needed
- docs updated only when the contract changed

Bad:

- unrelated frontend progress files bundled into a pure selector fix
- manifest edited to smuggle in UI policy
- live regression run before runtime sync verification
- repo file inspected, but installed runtime copy never checked
