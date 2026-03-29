# SPEC.md

> See full spec in [SPEC.md](../SPEC.md)

## Summary

Adapters are self-contained folders, and can also be distributed as `.zip` packages:

```
my-adapter/
  manifest.yaml    <- required, follows manifest.schema.json
  *.js             <- task scripts
  icon.png         <- optional

my-adapter-v1.0.0.zip
  └─ my-adapter/   <- recommended release layout
```

See [ADAPTER_GUIDE.md](ADAPTER_GUIDE.md) for full docs, including packaging and release guidance.
