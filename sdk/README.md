# Crawshrimp Adapter SDK

This folder contains the files an adapter author or AI agent usually needs first.

## Files

- [ADAPTER_GUIDE.md](ADAPTER_GUIDE.md) - full adapter development guide, including manifest fields, JS runtime actions, parameter types, packaging, dev harness, and HTTP APIs.
- [manifest.schema.json](manifest.schema.json) - JSON Schema for `manifest.yaml`; useful for editor validation and AI-generated manifests.
- [template/manifest.yaml](template/manifest.yaml) - starter manifest using current tab matching, common params, and Excel output.
- [template/example-task.js](template/example-task.js) - starter async IIFE task script.

## Package Shape

Adapters are self-contained folders and can also be distributed as `.zip` packages:

```
my-adapter/
  manifest.yaml    <- required, follows manifest.schema.json
  *.js             <- task scripts
  icon.png         <- optional
  *.xlsx/.csv/.pdf/.docx <- optional template files for download

my-adapter-v1.0.0.zip
  └─ my-adapter/   <- recommended release layout
```

For upload tasks, bundle one or more template files inside the adapter package and declare them in `params[].templates`; the desktop app will show template download cards automatically, including optional description and version metadata.

The runtime contract is defined by `core/models.py` and `core/adapter_loader.py`. Some adapters include Manifest v2 permission/capability declarations, but the current loader ignores those extended fields: they do not automatically enforce approval or access restrictions. Schema validation is an authoring aid, not a runtime permission check.

During local development, prefer installing a directory with `install_mode=link` so the runtime uses the same files you are editing:

Read the API token first using the [authentication setup](ADAPTER_GUIDE.md#本地-api-鉴权). Use the same data directory and token configuration as the running service.

```bash
curl -H "X-Crawshrimp-Token: $CRAWSHRIMP_API_TOKEN" -X POST http://127.0.0.1:18765/adapters/install \
  -H 'Content-Type: application/json' \
  -d '{"path": "/absolute/path/to/my-adapter", "install_mode": "link"}'
```

See [ADAPTER_GUIDE.md](ADAPTER_GUIDE.md) for the complete contract.
