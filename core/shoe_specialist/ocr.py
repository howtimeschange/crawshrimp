"""Bundled offline Chinese OCR, identical engine on Windows and macOS.

Output boxes preserve the existing bottom-left xywh OCR contract.
"""
import numpy as np
from PIL import Image, ImageOps


def recognize(jobs):
    import zxingcpp
    from rapidocr_onnxruntime import RapidOCR
    engine = RapidOCR(intra_op_num_threads=4, inter_op_num_threads=1)
    output = []
    for job in jobs:
        with Image.open(job['path']) as source:
            im = ImageOps.exif_transpose(source).convert('RGB')
        width, height = im.size
        barcodes = [r.text for r in zxingcpp.read_barcodes(im) if r.format == zxingcpp.BarcodeFormat.EAN13]
        result, _ = engine(np.asarray(im)[:, :, ::-1])
        lines = []
        for points, text, confidence in result or []:
            points = np.asarray(points)
            left, top = points.min(axis=0)
            right, bottom = points.max(axis=0)
            lines.append({'text': text, 'confidence': float(confidence),
                          'box': [float(left/width), float(1-bottom/height),
                                  float((right-left)/width), float((bottom-top)/height)]})
        # OCR can drop the separate leading EAN digit. Only normalize against
        # a barcode independently decoded from pixels; never against expected style.
        for line in lines:
            compact = ''.join(line['text'].split())
            matched = [b for b in barcodes if compact.isdigit() and len(compact) >= 12 and compact in b]
            if len(matched) == 1:
                line['raw_text'] = line['text']
                line['text'] = matched[0]
                line['barcode_verified'] = True
        # Table labels have all column headers before their values in reading
        # order. Attach only the nearest overlapping value below a color header.
        for header in list(lines):
            if header['text'].strip(' ：:') not in {'颜色', '色号'}:
                continue
            hx, hy, hw, hh = header['box']
            candidates = []
            for value in lines:
                vx, vy, vw, vh = value['box']
                if vy + vh <= hy + hh/2 and max(hx, vx) < min(hx+hw, vx+vw):
                    if hy - vy < max(hh, vh) * 5:
                        candidates.append((hy-vy, value))
            if candidates:
                value = min(candidates, key=lambda item: item[0])[1]
                import re
                if re.search(r'(?<!\d)\d{5}(?!\d)', value['text']):
                    value['raw_text'] = value.get('raw_text', value['text'])
                    value['text'] = '颜色：' + value['text']
        output.append({'id': job['id'], 'lines': lines})
    return output
