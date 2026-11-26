"""Read printed text and barcode-relative SKU lines from in-memory Semir crops."""

import re
import threading
from io import BytesIO

MAX_IMAGE_BYTES = 4 * 1024 * 1024
MAX_IMAGE_EDGE = 3200
PRINTED_SKC = re.compile(r"10[A-Z0-9]\d{9}[A-Z]?-[A-Z0-9]{5}")
_ocr_lock = threading.Lock()
_engine = None


def _read_lines(image, single_line=False):
    import numpy as np
    from rapidocr_onnxruntime import RapidOCR

    global _engine
    with _ocr_lock:
        if _engine is None:
            _engine = RapidOCR(intra_op_num_threads=2, inter_op_num_threads=1)
        rows, _ = _engine(np.asarray(image)[:, :, ::-1], use_det=not single_line, use_cls=False)
    return [text for text, confidence in (row[-2:] for row in rows or []) if confidence >= 0.82]


def _printed_sku_lines(image):
    import zxingcpp
    from PIL import ImageOps

    width, height = image.size
    lower = (int(width * .39), int(height * .65), int(width * .65), int(height * .91))
    located = False
    for view, offset in ((image, (0, 0)), (image.crop(lower), lower[:2])):
        if min(view.size) < 4:
            continue
        for barcode in zxingcpp.read_barcodes(view, formats=zxingcpp.BarcodeFormat.EAN13):
            if not barcode.valid:
                continue
            corners = barcode.position
            span = corners.top_right.x - corners.top_left.x
            barcode_height = max(corners.bottom_left.y - corners.top_left.y, corners.bottom_right.y - corners.top_right.y)
            if span < 40 or barcode_height < span * .05:
                continue
            located = True
            x = offset[0] + min(corners.top_left.x, corners.bottom_left.x)
            y = offset[1] + min(corners.top_left.y, corners.top_right.y)
            left, right = max(0, int(x - span * .14)), min(width, int(x + span * 1.20))
            for above, below in ((.23, .007), (.30, .085), (.35, .035), (.155, .008)):
                top, bottom = max(0, int(y - span * above)), min(height, int(y - span * below))
                if right <= left or bottom <= top:
                    continue
                strip = ImageOps.autocontrast(image.crop((left, top, right, bottom)).convert("L"))
                strip = ImageOps.expand(strip, 12, "white").convert("RGB")
                for line in _read_lines(strip, single_line=True):
                    candidate = re.sub(r"\s+", "", line.upper()).replace("–", "-").replace("—", "-")
                    if PRINTED_SKC.fullmatch(candidate):
                        return {"barcodeLocated": True, "text": candidate}
    return {"barcodeLocated": located, "text": ""}


def read_semir_label_crop(data, mode):
    from PIL import Image

    try:
        with Image.open(BytesIO(data), formats=["JPEG"]) as source:
            if max(source.size) > MAX_IMAGE_EDGE or min(source.size) < 4:
                raise ValueError("静物图识别裁图尺寸不符")
            image = source.convert("RGB")
    except (OSError, Image.DecompressionBombError) as error:
        raise ValueError("静物图识别裁图无效") from error
    if mode == "barcode":
        return _printed_sku_lines(image)
    return {"text": "\n".join(_read_lines(image))}
