"""Lossless, local-only Semir source packages; no guessed channel naming rules."""
import hashlib
import json
import re
import shutil
import zipfile
from datetime import datetime
from pathlib import Path, PurePosixPath
from openpyxl import Workbook


def safe_name(value):
    return re.sub(r'[\\/:*?"<>|\x00-\x1f]', '_', str(value or '')).strip(' .') or '未标注'


def package_materials(*, data_rows, run_params, runtime_artifact_dir, log):
    base = Path(run_params.get('export_folder') or runtime_artifact_dir).expanduser()
    base.mkdir(parents=True, exist_ok=True)
    name = safe_name(run_params.get('package_name') or '森马上新资料')
    stem = f'{name}_{datetime.now():%Y%m%d_%H%M%S}'
    root = base / stem
    index = 1
    while root.exists():
        root = base / f'{stem}_{index}'
        index += 1
    root.mkdir()
    originals = root / '原件'
    used = set()
    for row in data_rows:
        if row.get('下载结果') != '已下载':
            continue
        source = Path(row.get('本地文件') or '')
        rel = PurePosixPath(str(row.get('包内路径') or ''))
        if not rel.parts or rel.is_absolute() or any(x in ('.', '..') or '\\' in x for x in rel.parts):
            row.update(下载结果='整理失败', 备注='包内路径无效')
            continue
        if not source.is_file() or source.stat().st_size == 0:
            row.update(下载结果='整理失败', 备注='原下载文件缺失或为空')
            continue
        try:
            if source.suffix.lower() == '.pdf':
                with source.open('rb') as handle:
                    if not handle.read(1024).lstrip().startswith(b'%PDF-'):
                        raise ValueError('下载内容不是 PDF，可能为登录或错误页面')
            elif source.suffix.lower() in {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff'}:
                from PIL import Image
                with Image.open(source) as image:
                    image.verify()
        except Exception:
            row.update(下载结果='文件校验失败', 备注='文件格式无效或损坏，未加入资料包')
            continue
        relative = Path(*[safe_name(x) for x in rel.parts])
        target = originals / relative
        key = str(relative).casefold()
        if key in used:
            row.update(下载结果='整理失败', 备注='目标路径冲突，未覆盖原文件')
            continue
        used.add(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        row.update(本地文件=str(target), 包内路径=relative.as_posix(), SHA256=digest, 文件大小=target.stat().st_size)
    refs = [str(root)]
    if run_params.get('auto_zip', True) and originals.exists():
        for style_dir in sorted(originals.iterdir()):
            if not style_dir.is_dir():
                continue
            target = root / f'{style_dir.name}.zip'
            with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as z:
                for file in sorted(style_dir.rglob('*')):
                    if file.is_file():
                        z.write(file, file.relative_to(originals).as_posix())
            refs.append(str(target))
    public_rows = [{k: v for k, v in r.items() if not k.startswith('__')} for r in data_rows]
    manifest = {'schema_version': 1, 'created_at': datetime.now().astimezone().isoformat(),
                'status': 'complete' if public_rows and all(r.get('下载结果') == '已下载' for r in public_rows) else 'partial',
                'rows': public_rows}
    (root / '资料清单.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    wb = Workbook()
    ws = wb.active
    ws.title = '资料明细'
    columns = list(dict.fromkeys(k for r in public_rows for k in r)) or ['下载结果']
    ws.append(columns)
    for row in public_rows:
        for idx, key in enumerate(columns, 1):
            value = row.get(key, '')
            cell = ws.cell(ws.max_row + 1, idx) if idx == 1 else ws.cell(ws.max_row, idx)
            cell.value = value
            if isinstance(value, str):
                cell.data_type = 's'  # source names/text must not become spreadsheet formulas
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = ws.dimensions
    path = root / '资料明细.xlsx'
    wb.save(path)
    wb.close()
    refs.extend([str(path), str(root / '资料清单.json')])
    log(f'森马上新资料已整理：{len(public_rows)} 条，状态 {manifest["status"]}')
    return refs
