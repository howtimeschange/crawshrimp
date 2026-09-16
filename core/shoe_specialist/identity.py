"""Strict style/color extraction from local OCR without model confirmation."""

import re


def verify(texts, style, color):
    styles = set()
    colors = set()
    ignored_ean = []
    for text in texts:
        compact = re.sub(r"\s", "", text)
        if re.fullmatch(r"\d{13}", compact):
            check = (
                10
                - sum(
                    int(n) * (1 if i % 2 == 0 else 3)
                    for i, n in enumerate(compact[:12])
                )
                % 10
            ) % 10
            if check == int(compact[-1]):
                ignored_ean.append(compact)
                continue
        styles.update(re.findall(r"(?<!\d)\d{12}(?!\d)", text))
    for i, text in enumerate(texts):
        if "颜色" in text or "色号" in text:
            for t in texts[i : i + 3]:
                colors.update(re.findall(r"(?<!\d)\d{5}(?!\d)", t))
    return {
        "passed": styles == {style} and color in colors,
        "style_tokens": sorted(styles),
        "color_tokens": sorted(colors),
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
