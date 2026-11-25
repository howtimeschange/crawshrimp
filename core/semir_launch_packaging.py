"""Lossless, local-only Semir source packages; no guessed channel naming rules."""
import ctypes
import hashlib
import json
import os
import re
import shutil
import sys
import unicodedata
import zipfile
from copy import copy
from datetime import datetime
from pathlib import Path, PurePosixPath
from openpyxl import Workbook, load_workbook
from openpyxl.utils.cell import get_column_letter, range_boundaries


STILL_REPORT_HEADERS = ('缺吊牌', '缺洗唛', '款号是否一致', '备注')
STILL_REPORT_MISSING_RED = 'FFFF0000'


def still_ocr_host_hardware():
    """Read the local desktop's logical processors and physical memory."""
    memory = 0
    try:
        if sys.platform == 'win32':
            class MemoryStatus(ctypes.Structure):
                _fields_ = [
                    ('length', ctypes.c_uint32), ('load', ctypes.c_uint32),
                    ('total_physical', ctypes.c_uint64), ('available_physical', ctypes.c_uint64),
                    ('total_page_file', ctypes.c_uint64), ('available_page_file', ctypes.c_uint64),
                    ('total_virtual', ctypes.c_uint64), ('available_virtual', ctypes.c_uint64),
                    ('available_extended_virtual', ctypes.c_uint64),
                ]

            status = MemoryStatus(length=ctypes.sizeof(MemoryStatus))
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                memory = status.total_physical
        else:
            memory = os.sysconf('SC_PHYS_PAGES') * os.sysconf('SC_PAGE_SIZE')
    except (AttributeError, OSError, ValueError):
        pass
    return {'threads': os.cpu_count() or 0, 'memory_gb': max(0, memory) / 2**30}


def _still_key(batch, style, skc, color, date):
    def normalize(value):
        return unicodedata.normalize('NFKC', str(value if value is not None else '')).strip().upper()

    style = normalize(style)
    batch = normalize(batch)
    batch_parts = re.fullmatch(r'([0-9]{2}Q[1-4])\s*(?:第\s*([0-9]{1,2})\s*批|([0-9]{1,2})\s*P)', batch)
    if batch_parts and (number := int(batch_parts[2] or batch_parts[3])) > 0:
        batch = f'{batch_parts[1]}第{number}批'
    skc = normalize(skc).replace('-', '')
    color = normalize(color) or skc[-5:]
    date = normalize(date)
    parts = re.match(r'^(\d{4})[-/年]?(\d{1,2})[-/月]?(\d{1,2})(?=$|[日T\s])', date)
    if parts:
        date = f'{parts[1]}-{int(parts[2]):02d}-{int(parts[3]):02d}'
    return batch, style, skc, color.zfill(5), date


def _still_report_values(row):
    package_state = row.get('整理结果') or ''
    raw_notes = (row.get('备注') or '').split('；')
    notes = []
    if any(note.startswith('款色与款号拼色号不一致') for note in raw_notes):
        notes.append('表格款色与款号冲突，按款号和色号核验')

    kinds = ('吊牌', '洗唛')
    statuses = [row.get(kind + '结果') for kind in kinds]
    missing = [status in ('无图片', '未检出，待复核') for status in statuses]
    mismatch = '识别到不一致款号，待复核'
    if mismatch in statuses:
        consistency = '不一致'
    elif statuses == ['一致', '一致']:
        consistency = '一致'
    else:
        consistency = '未核验'

    login_expired = any('登录超时' in value or '等待森马云盘登录' in value for value in (package_state, *raw_notes))
    if login_expired:
        notes.append('云盘登录超时')
    elif package_state and package_state not in ('已复制并核验', '已核验已有图包', '预览'):
        notes.append({
            '缺图包': '未找到图包',
            '缺款色图包': '未找到款色图包',
            '缺款色文件夹': '未找到款色文件夹',
            '来源待选择': '有多个来源，请确认图包',
            '整款待复核': '同款表格数据有冲突',
        }.get(package_state, package_state))
    if package_state in ('表格字段异常', '表格字段冲突'):
        notes.extend(note for note in raw_notes if note in (
            '请核对款号、色号、色名和性别', '色名末尾编码与色号不一致', '同款分类或同款色命名冲突',
        ))

    if statuses == ['无图片', '无图片']:
        notes.append('图包无可用图片')
    elif missing[0] and '仅有手写样卡' in raw_notes:
        notes.append('仅有手写样卡')
    elif missing[0] and any(note.startswith('供应商样品卡或表单不计作吊牌：') or note == '仅有供应商样卡' for note in raw_notes):
        notes.append('仅有供应商样卡')
    elif any(missing):
        notes.append('需补拍' + '和'.join(kind for kind, absent in zip(kinds, missing) if absent))

    issues = {
        '已识别类型，款号未读出': '款号读不清',
        '款号后缀未读出，待复核': '款号后缀读不清',
        '款号识别结果冲突，待复核': '款号识别有冲突',
        '有候选图片，类型待复核': '图片类型待确认',
        '候选图片未检出，待复核': '图片类型待确认',
    }
    for kind, status in zip(kinds, statuses):
        if status == mismatch:
            codes = row.get(kind + '识别款号')
            notes.append(f'{kind}款号不符（识别为 {codes}）' if codes else f'{kind}款号不符')
        elif status in issues:
            notes.append(kind + issues[status])
    partial_failure = '部分图片识别失败，待复核' in statuses
    if not login_expired and consistency != '一致':
        if partial_failure:
            notes.append('部分图片识别失败')
        elif any(note.startswith('OCR失败：') for note in raw_notes):
            notes.append('图片识别失败')
    if not notes and consistency == '未核验':
        notes.append('核验未完成')
    hangtag, wash = ('缺' if absent else None for absent in missing)
    return hangtag, wash, consistency, '；'.join(notes) or None


def write_still_package_report(*, data_rows, source, output):
    """Append the four audit fields to a copy of the supplied listing workbook."""
    source, output = Path(source).expanduser(), Path(output)
    if source.suffix.lower() != '.xlsx' or source.resolve() == output.resolve():
        raise ValueError('需要原始 .xlsx 上架表，并另存核验结果')
    index = {}
    for row in data_rows:
        key = _still_key(*(row.get(col) for col in ('批次', '款号', '款色', '色号', '上市日期')))
        values = _still_report_values(row)
        if key in index and values != index[key]:
            values = (None, None, '未核验', '同一款色的核验结果冲突')
        index[key] = values

    workbook = load_workbook(source)
    matched = set()
    try:
        for sheet in workbook.worksheets:
            headers = {str(cell.value or '').strip(): cell.column for cell in sheet[1]}
            season = next((col for name, col in headers.items() if name.startswith('Q季') or name in ('季度', '上新季', '上市季')), None)
            launch = headers.get('电商上市日期') or headers.get('上市日期')
            if not season or not launch or not all(key in headers for key in ('款号', '款色', '批次')):
                continue
            receipts = []
            for row_number in range(2, sheet.max_row + 1):
                def value(col):
                    return sheet.cell(row_number, col).value if col else None

                batch = str(value(season) or '').strip() + str(value(headers['批次']) or '').strip()
                date = value(launch) or value(headers.get('上市日期'))
                key = _still_key(batch, value(headers['款号']), value(headers['款色']), value(headers.get('色号')), date)
                if key in index:
                    receipts.append((row_number, index[key]))
                    matched.add(key)
            if not receipts:
                continue

            last = sheet.max_column
            existing = tuple(sheet.cell(1, col).value for col in range(last - 3, last + 1)) == STILL_REPORT_HEADERS
            start = last - 3 if existing else last + 1
            body_style_col = headers['批次']
            for index_col, (header, width) in enumerate(zip(STILL_REPORT_HEADERS, (12, 12, 18, 54)), start):
                cell = sheet.cell(1, index_col, header)
                if not existing:
                    cell._style = copy(sheet.cell(1, body_style_col)._style)
                    sheet.column_dimensions[get_column_letter(index_col)].width = width
            for row_number, values in receipts:
                for col, value in enumerate(values, start):
                    cell = sheet.cell(row_number, col)
                    cell.value = value
                    if value is not None:
                        cell.data_type = 's'
                    if not existing:
                        cell._style = copy(sheet.cell(row_number, body_style_col)._style)
                        if col == start + 3:
                            alignment = copy(cell.alignment)
                            alignment.wrap_text = True
                            cell.alignment = alignment
                    if col < start + 2:
                        font = copy(cell.font)
                        if value == '缺':
                            font.color = STILL_REPORT_MISSING_RED
                            cell.font = font
                        elif font.color and font.color.type == 'rgb' and font.color.rgb[-6:] == 'FF0000':
                            font.color = copy(sheet.cell(row_number, body_style_col).font.color)
                            cell.font = font
            if not existing and sheet.auto_filter.ref:
                first_col, first_row, final_col, final_row = range_boundaries(sheet.auto_filter.ref)
                if first_row == 1 and final_col == last:
                    sheet.auto_filter.ref = f'{get_column_letter(first_col)}1:{get_column_letter(start + 3)}{final_row}'

        if not matched or matched != set(index):
            raise ValueError(f'有 {len(set(index) - matched)} 条核验结果无法准确回填原始上架表')
        output.parent.mkdir(parents=True, exist_ok=True)
        workbook.save(output)
    finally:
        workbook.close()
    return str(output)


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
