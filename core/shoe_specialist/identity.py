"""Strict style/color extraction from local OCR without model confirmation."""

import re


def color_fields(texts, boxes=None):
    """Read color evidence independently of the requested SKU.

    Damaged headers require a color word and nearby product-name label context.
    Bare five-digit numbers are accepted only after an intact color header.
    """
    fields = []
    anchors = [i for i, t in enumerate(texts) if "产品名称" in t]
    for i, text in enumerate(texts):
        compact = re.sub(r"\s", "", text)
        intact = re.match(r"^(?:颜色|色号)[:：]?(.*)$", compact)
        damaged = re.fullmatch(r"(?:额色|色)[:：]([\u4e00-\u9fff/／、]{1,20})(\d{5})", compact)
        if damaged and not intact:
            name, code = damaged.groups()
            if not re.search(r"[黑白灰红橙黄绿青蓝紫粉棕褐咖银金米卡杏驼彩]", name):
                continue
            nearby = bool(anchors)
            if boxes is not None:
                x, y, w, h = boxes[i]
                nearby = any(
                    max(x, boxes[a][0]) < min(x+w, boxes[a][0]+boxes[a][2])
                    and 0 <= boxes[a][1] - y <= max(h, boxes[a][3]) * 4
                    for a in anchors
                )
            if nearby:
                fields.append({"code": code, "name": name, "line": i, "source": "damaged_header"})
        elif intact:
            values = [(i, intact.group(1))]
            if not intact.group(1):
                values += [(j, re.sub(r"\s", "", texts[j])) for j in range(i+1, min(i+3, len(texts)))]
            for j, value in values:
                if boxes is not None and j != i:
                    hx, hy, hw, hh = boxes[i]
                    vx, vy, vw, vh = boxes[j]
                    if not (max(hx, vx) < min(hx+hw, vx+vw)
                            and 0 <= hy-vy <= max(hh, vh)*5):
                        continue
                match = re.fullmatch(r"([\u4e00-\u9fff/／、]{0,20})(\d{5})", value)
                if match:
                    fields.append({"code": match[2], "name": match[1], "line": j, "source": "color_header"})
    return fields


def verify(texts, style, color, boxes=None):
    styles = set()
    ignored_ean = []
    for text in texts:
        compact = re.sub(r"\s", "", text)
        if re.fullmatch(r"\d{13}", compact):
            check = (10 - sum(int(n) * (1 if i % 2 == 0 else 3)
                              for i, n in enumerate(compact[:12])) % 10) % 10
            if check == int(compact[-1]):
                ignored_ean.append(compact)
                continue
        styles.update(re.findall(r"(?<!\d)\d{12}(?!\d)", text))
    fields = color_fields(texts, boxes)
    colors = {f["code"] for f in fields}
    passed = styles == {style} and colors == {color}
    mismatch = bool(styles - {style} or colors - {color})
    return {
        "passed": passed,
        "status": "verified" if passed else "mismatch" if mismatch else "unconfirmed",
        "style_tokens": sorted(styles),
        "color_tokens": sorted(colors),
        "color_fields": fields,
        "ignored_valid_ean13": ignored_ean,
        "expected_style": style,
        "expected_color": color,
    }


def packaging_bbox(box):
    """Convert Vision top-left unit coordinates to the exporter's 0..1000 contract."""
    if len(box) != 4 or not all(0 <= v <= 1 for v in box):
        raise ValueError("OCR box must use unit coordinates")
    if box[0] >= box[2] or box[1] >= box[3]:
        raise ValueError("Invalid OCR rectangle")
    return [v * 1000 for v in box]
