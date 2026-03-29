# SPEC.md

> See full spec in [SPEC.md](../SPEC.md)

## Summary

Adapters are self-contained folders, and can also be distributed as `.zip` packages:

```
my-adapter/
  manifest.yaml    <- required, follows manifest.schema.json
  *.js             <- task scripts
  icon.png         <- optional
  *.xlsx/.csv/.pdf/.docx <- optional template files for download

my-adapter-v1.0.0.zip
  └─ my-adapter/   <- recommended release layout
```

For upload tasks, you can bundle one or more template files inside the adapter package and declare them in `params[].templates`; the desktop app will show template download cards automatically, including optional description and version metadata.

See [ADAPTER_GUIDE.md](ADAPTER_GUIDE.md) for full docs, including packaging, release guidance, and template-download support.
