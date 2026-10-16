"""Shared naming and audit manifest for downloaded and locally repackaged assets."""
import csv
import json
from collections import Counter
from pathlib import Path

FIELDS = ('输入款号', '输入编码', '原文件名', '文件名', '输出文件名', '本地文件',
          '云盘路径', '素材类型', '分类依据', '云盘目录归属', '标签货号核验', '下载结果', '备注')
NAMES = {'款色图': '平铺图', '鞋盒标签图/电子吊牌图': '吊牌'}


def enrich_row(row):
    source = str(row.get('云盘路径') or '').replace('\\', '/')
    row.setdefault('原文件名', source.rsplit('/', 1)[-1] or row.get('文件名') or '')
    evidence = '；'.join(str(row.get(k) or '') for k in ('匹配策略', '备注')).strip('；')
    row['分类依据'] = row.get('分类依据') or evidence
    style = str(row.get('输入款号') or '')
    row['云盘目录归属'] = ('完整款号目录匹配' if style and style in source.split('/')[:-1]
                           else '参见云盘路径及匹配策略')
    row['标签货号核验'] = row.get('标签货号核验') or (
        '未核验；目录归属不等于标签货号映射已核验'
        if row.get('素材类型') in ('吊牌', '鞋盒标签图/电子吊牌图') else '不适用')
    if row.get('下载结果') != '已下载':
        row['输出文件名'] = ''


def assign_output_names(rows):
    """Call only after candidate verification. Sequence is file order, never color."""
    counts = Counter()
    for row in rows:
        enrich_row(row)
        if row.get('下载结果') != '已下载':
            continue
        kind = NAMES.get(row.get('素材类型'))
        if kind:
            if not row['分类依据']:
                raise ValueError('已下载素材缺少分类依据')
            style = str(row.get('输入款号') or '')
            if not style or style in ('.', '..') or any(c in style for c in '/\\\x00'):
                raise ValueError('缺少合法款号或款号包含路径分隔符')
            ext = Path(str(row.get('本地文件') or row.get('原文件名'))).suffix.lower()
            counts[(style, kind)] += 1
            name = f'{style}_{kind}_{counts[(style, kind)]:02d}{ext}'
        else:
            name = str(row.get('__package_filename') or row.get('文件名') or '')
        row['文件名'] = row['输出文件名'] = row['__package_filename'] = name


def write_manifest(root, rows):
    root = Path(root)
    public = [{k: v for k, v in row.items() if not k.startswith('__')} for row in rows]
    successful = [r for r in rows if r.get('下载结果') == '已下载']
    summary = {'实际款数': len({r['输入款号'] for r in successful}), '实际文件数': len(successful),
               '未匹配款号': list(dict.fromkeys(r['输入款号'] for r in rows if r.get('下载结果') == '未匹配到素材'))}
    path = root / '素材清单.json'
    path.write_text(json.dumps({'汇总': summary, '素材': public}, ensure_ascii=False, indent=2))
    csv_path = root / '素材清单.csv'
    with csv_path.open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(public)
    return [str(path), str(csv_path)]
