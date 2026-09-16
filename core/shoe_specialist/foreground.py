"""Lightweight foreground bounding crop: preserves orientation and shoe parts."""

import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps, ImageFilter
from core.shenhui_shoe_mask_rank import _components


def foreground_box(im):
    small = im.copy()
    small.thumbnail((256, 256))
    a = np.asarray(small.convert("RGB"))
    h, w = a.shape[:2]
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(border, axis=0)
    mask = (
        Image.fromarray(
            (np.max(abs(a.astype(float) - bg), axis=2) > 24).astype("uint8") * 255
        )
        .filter(ImageFilter.MaxFilter(3))
        .filter(ImageFilter.MinFilter(3))
    )
    groups = _components(bytearray(v > 0 for v in mask.getdata()), w, h)
    if not groups:
        return (0, 0, im.width, im.height)
    keep = [g for g in groups if len(g) >= max(12, len(groups[0]) * 0.08)]
    ids = [i for g in keep for i in g]
    xs = [i % w for i in ids]
    ys = [i // w for i in ids]
    l, t, r, b = min(xs), min(ys), max(xs) + 1, max(ys) + 1
    if (r - l) * (b - t) > w * h * 0.95:
        return (0, 0, im.width, im.height)
    px = max(3, int((r - l) * 0.08))
    py = max(3, int((b - t) * 0.08))
    return (
        int(max(0, l - px) * im.width / w),
        int(max(0, t - py) * im.height / h),
        int(min(w, r + px) * im.width / w),
        int(min(h, b + py) * im.height / h),
    )


def read_crop(path, lining=False):
    with Image.open(path) as src:
        im = ImageOps.exif_transpose(src).convert("RGB")
    box = foreground_box(im)
    if lining:
        l, t, r, b = box
        box = (l, t, r, t + int((b - t) * 0.62))
    return im.crop(box), box
