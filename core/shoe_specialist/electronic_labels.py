"""Lazy, source-scoped electronic label facts; never pose candidates."""

import re
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

from .identity import color_fields
from .util import sha


def ean13(text):
    digits = re.sub(r'''[\s"'‘’“”″′]''', '', text)
    if not re.fullmatch(r'\d{13}', digits):
        return None
    check = (10 - sum(int(n) * (1 if i % 2 == 0 else 3)
                      for i, n in enumerate(digits[:12])) % 10) % 10
    return digits if check == int(digits[-1]) else None


def is_label_source(style, color, filename, cloud_path):
    """Directory ownership is mandatory; filenames are candidate hints only."""
    if not re.fullmatch(r'\d{12}', style):
        return False
    parts = cloud_path.replace('\\', '/').split('/')
    if not any(re.match(re.escape(style) + r'(?:$|[\s_-])', p) for p in parts[:-1]):
        return False
    if not color:
        return True
    return bool(re.search(r'^(?:\d{3}-[A-Z]{2}\d{2}-)|页面|PB\d|SO\d|电子|盒标', filename, re.I))


def label_regions(path):
    """Find printed label borders, including dashed red production borders."""
    import cv2

    with Image.open(path) as source:
        im = ImageOps.exif_transpose(source).convert('RGB')
        im.thumbnail((2000, 2000))
        rgb = np.asarray(im)
    h, w = rgb.shape[:2]
    dark = (cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY) < 120).astype('uint8') * 255
    horizontal = cv2.morphologyEx(dark, cv2.MORPH_OPEN, np.ones((1, max(12, w//60)), 'uint8'))
    vertical = cv2.morphologyEx(dark, cv2.MORPH_OPEN, np.ones((max(12, h//60), 1), 'uint8'))
    grid = cv2.morphologyEx(horizontal | vertical, cv2.MORPH_CLOSE, np.ones((5, 5), 'uint8'))
    red = ((rgb[:, :, 0] > 150) & (rgb[:, :, 1] < 150) & (rgb[:, :, 2] < 150)).astype('uint8') * 255
    red = cv2.morphologyEx(red, cv2.MORPH_CLOSE, np.ones((max(5, h//100), max(5, w//100)), 'uint8'))
    boxes = []
    for mask in (grid, red):
        found = []
        for contour in cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]:
            x, y, bw, bh = cv2.boundingRect(contour)
            if bw >= w*.08 and bh >= h*.08 and bw*bh >= w*h*.012 and .15 < bw/bh < 4:
                found.append([max(0, (x-3)/w), max(0, (y-3)/h), min(1, (x+bw+3)/w), min(1, (y+bh+3)/h)])
        # Complete black box-label borders are preferable to red print notes.
        if len(found) >= 2:
            boxes = found
            break
        if found and not boxes:
            boxes = found
    if not boxes:
        return [[0, 0, 1, 1]]
    return sorted(boxes, key=lambda b: (round(b[1], 2), b[0]))[:24]


def tile_facts(record, region):
    """Extract identity from explicit title/color fields or a hangtag SKU row."""
    lines = record['lines']
    texts = [line['text'] for line in lines]
    barcodes = {code for line in lines if (code := ean13(line['text']))}
    barcodes.update(code for text in record.get('barcodes', []) if (code := ean13(text)))
    headers = [line for line in lines
               if re.fullmatch(r'\d{12}', line['text'].strip())
               and not ean13(line['text'])
               and 1-line['box'][1]-line['box'][3] < region[1] + (region[3]-region[1])*.35
               and line.get('confidence', 0) >= .9]
    fields = color_fields(texts, [line['box'] for line in lines])
    fields = [field for field in fields if lines[field['line']].get('confidence', 0) >= .85]
    styles = {line['text'].strip() for line in headers}
    colors = {field['code'] for field in fields}
    names = {field['name'] for field in fields if field['name']}
    products = [re.sub(r'^产品名称[:：\s]*', '', t) for t in texts if t.startswith('产品名称')]
    materials = [re.sub(r'^帮面材料[:：\s]*', '', t) for t in texts if t.startswith('帮面材料')]
    kind = 'box_label'
    if not (len(styles) == len(colors) == 1 and products):
        joined = ' '.join(texts).upper()
        sku_rows = []
        for line in lines:
            match = re.fullmatch(r'\s*(\d{12})[\s-]*(\d{5})(?:\s+\d{2}\s*[-~～]\s*\d{2})?\s*', line['text'])
            if match and line.get('confidence', 0) >= .9:
                sku_rows.append(match.groups())
        if len(set(sku_rows)) != 1 or not all(t in joined for t in ('EUR', 'CHN', 'RMB')) or not barcodes:
            return None
        style, color = sku_rows[0]
        styles, colors, names, products, materials = {style}, {color}, set(), [], []
        kind = 'hangtag'
    if len(names) > 1:
        return None
    return {'style': next(iter(styles)), 'color': next(iter(colors)),
            'color_name': next(iter(names), ''), 'product_names': products,
            'upper_materials': materials, 'barcodes': sorted(barcodes),
            'kind': kind, 'region': region}


class ElectronicLabels:
    def __init__(self, sources, recognize):
        self.sources = sources
        self.recognize = recognize
        self.cache = {}
        self.evidence = []

    def references(self, style):
        if style in self.cache:
            return self.cache[style]
        collected = defaultdict(list)
        seen = set()
        # Cloud order often lists dozens of marketing images before the
        # production-label sheets. A positional cap silently loses labels.
        for source in [s for s in self.sources if s['style'] == style]:
            if source['sha256'] in seen:
                continue
            seen.add(source['sha256'])
            evidence = {'source': source, 'tiles': []}
            self.evidence.append(evidence)
            try:
                if sha(source['path']) != source['sha256']:
                    raise ValueError('电子标签源文件发生变化')
                regions = label_regions(source['path'])
                records = self.recognize([{'id': f"{source['id']}-{i}", 'path': source['path'], 'region': region}
                                          for i, region in enumerate(regions)])
                # Grid detection can find shoe decoration/barcode fragments
                # instead of the outer border. Retry the complete source only
                # when none of those crops yields an independently bound label.
                # Full-page identity checks still reject mixed style/color pages.
                if regions != [[0, 0, 1, 1]] and not any(
                        tile_facts(record, region) for region, record in zip(regions, records)):
                    regions = regions + [[0, 0, 1, 1]]
                    records = records + self.recognize([
                        {'id': f"{source['id']}-full", 'path': source['path'], 'region': [0, 0, 1, 1]}])
                for region, record in zip(regions, records):
                    fact = tile_facts(record, region)
                    evidence['tiles'].append({'region': region, 'fact': fact, 'lines': record['lines']})
                    if fact and fact['style'] == style:
                        collected[fact['color']].append({**fact, 'source': source, 'lines': record['lines']})
            except (OSError, ValueError, RuntimeError) as error:
                evidence['error'] = str(error)
        refs = {}
        for color, tiles in collected.items():
            names = {tile['color_name'] for tile in tiles if tile['color_name']}
            products = {name for tile in tiles for name in tile['product_names']}
            materials = {name for tile in tiles for name in tile['upper_materials']}
            conflict = any(len(values) > 1 for values in (names, products, materials))
            refs[color] = {'style': style, 'color': color,
                           'status': 'conflict' if conflict else 'verified',
                           'color_name': next(iter(names), '') if len(names) <= 1 else '',
                           'product_names': sorted(products), 'upper_materials': sorted(materials),
                           'barcodes': sorted({code for tile in tiles for code in tile['barcodes']}),
                           'tiles': tiles}
        self.cache[style] = refs
        return refs

    def match(self, style, color, check, barcodes=()):
        if check.get("status") == "mismatch":
            return None
        reference = self.references(style).get(color)
        if not reference:
            return None
        if reference['status'] != 'verified':
            return {'status': 'conflict', 'reference': reference}
        observed = set(check['ignored_valid_ean13']) | {c for t in barcodes if (c := ean13(t))}
        common = sorted(observed & set(reference['barcodes']))
        if not common and not check['passed']:
            return None
        return {'status': 'verified', 'binding': 'shared_ean13' if common else 'readable_style_and_color',
                'matching_barcodes': common, 'reference': reference}
