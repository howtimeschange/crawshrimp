"""Build-time resource staging; users never choose model or Python paths."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

REQUIRED = ('dino-224.onnx', 'dino-448.onnx', 'models.json', 'yx.json', 'snow-tmz4.png')


def validate(root):
    root = Path(root)
    manifest = json.loads((root / 'bundle.json').read_text(encoding='utf-8'))
    for name in REQUIRED:
        expected = manifest['files'].get(name)
        if not expected or hashlib.sha256((root / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f'Invalid bundled shoe resource: {name}')
    return manifest


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--source', required=True, help='Verified portable ONNX bundle')
    ap.add_argument('--target', default=str(Path(__file__).resolve().parents[1] / 'core/shoe_specialist/assets'))
    args = ap.parse_args()
    source, target = Path(args.source).resolve(), Path(args.target).resolve()
    validate(source)
    if source != target:
        target.mkdir(parents=True, exist_ok=True)
        for name in (*REQUIRED, 'bundle.json'):
            shutil.copy2(source / name, target / name)
    validate(target)
    print(target)


if __name__ == '__main__':
    main()
