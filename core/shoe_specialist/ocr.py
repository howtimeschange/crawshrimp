"""Bundled offline Chinese OCR, identical engine on Windows and macOS.

Output boxes preserve the existing bottom-left xywh OCR contract.
"""
import numpy as np
import re
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
        # Keep independently decoded full-image barcodes for crop retries too.
        barcodes = [r.text for r in zxingcpp.read_barcodes(im) if r.format == zxingcpp.BarcodeFormat.EAN13]
        view_barcodes = barcodes
        offset_x = offset_y = 0
        if job.get('region'):
            x0, y0, x1, y1 = job['region']
            offset_x, offset_y = int(x0 * width), int(y0 * height)
            im = im.crop((offset_x, offset_y, int(x1 * width), int(y1 * height)))
            view_barcodes = list({
                r.text for r in zxingcpp.read_barcodes(im) if r.format == zxingcpp.BarcodeFormat.EAN13
            })
            barcodes = list(set(barcodes) | set(view_barcodes))
        result, _ = engine(np.asarray(im)[:, :, ::-1])
        lines = []
        for points, text, confidence in result or []:
            points = np.asarray(points)
            left, top = points.min(axis=0)
            right, bottom = points.max(axis=0)
            left, right = left + offset_x, right + offset_x
            top, bottom = top + offset_y, bottom + offset_y
            lines.append({'text': text, 'confidence': float(confidence),
                          'box': [float(left/width), float(1-bottom/height),
                                  float((right-left)/width), float((bottom-top)/height)]})
        # OCR can drop the separate leading EAN digit. Only normalize against
        # a barcode independently decoded from pixels; never against expected style.
        for line in lines:
            # Barcode bars can be read as l/I or punctuation. Normalize only
            # against an EAN independently decoded from these same pixels.
            compact = re.sub(r'[^0-9]', '', line['text']) if re.fullmatch(r'[0-9\s\"\'‘’“”\[\]|lI]+', line['text']) else line['text']
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
                if re.search(r'(?<!\d)\d{5}(?!\d)', value['text']):
                    value['raw_text'] = value.get('raw_text', value['text'])
                    if not re.match(r'^(?:颜色|色号)[:：]', value['text']):
                        value['text'] = '颜色：' + value['text']
        output.append({'id': job['id'], 'lines': lines, 'barcodes': view_barcodes})
    return output
