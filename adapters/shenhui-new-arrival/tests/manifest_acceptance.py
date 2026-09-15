"""Package-level acceptance entry for the Shenhui Adapter manifest contract."""

import json
from pathlib import Path

import yaml


ADAPTER_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ADAPTER_ROOT / "manifest.yaml"
V2_SURFACES = {
    "compatibility",
    "permissions",
    "capabilities",
    "backend_handlers",
    "contracts",
    "checkpoints",
    "external_systems",
    "sensitive_config",
    "acceptance",
}


def main() -> None:
    manifest = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))
    assert manifest.get("manifest_version") == 2
    assert not (V2_SURFACES - set(manifest))

    for task in manifest.get("tasks") or []:
        script = ADAPTER_ROOT / str(task.get("script") or "")
        assert script.is_file(), f"missing task script: {script}"

    acceptance = manifest["acceptance"]
    assert (ADAPTER_ROOT / acceptance["entrypoint"]).is_file()

    for declaration in manifest.get("sensitive_config") or []:
        assert "value" not in declaration, f"inline secret is forbidden: {declaration.get('id')}"

    print(json.dumps({"ok": True, "checks": {"manifest_v2_contract": True, "declared_entrypoints_exist": True, "sensitive_config_has_no_inline_value": True}}))


if __name__ == "__main__":
    main()
