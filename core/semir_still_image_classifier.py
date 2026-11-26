"""CPU thumbnail classifier for the Semir still-image adapter."""

import hashlib
import json
import threading
from pathlib import Path

THUMBNAIL_SIZE = 224
RGB_BYTES = THUMBNAIL_SIZE * THUMBNAIL_SIZE * 3
MAX_BATCH = 8
CLASSES = ("hangtag", "washlabel", "other", "supplier")
ASSETS = Path(__file__).with_name("semir_still_image_assets")
_session = None
_session_lock = threading.Lock()
_inference_slots = threading.BoundedSemaphore(2)


def _get_session():
    global _session
    with _session_lock:
        if _session is None:
            import onnxruntime

            model = ASSETS / "pp-lcnetv2-int8.onnx"
            manifest = json.loads((ASSETS / "model.json").read_text(encoding="utf-8"))
            if tuple(manifest.get("classes", ())) != CLASSES:
                raise RuntimeError("静物图分类模型类别不匹配")
            with model.open("rb") as binary:
                if hashlib.file_digest(binary, "sha256").hexdigest() != manifest["sha256"]:
                    raise RuntimeError("静物图分类模型校验失败")
            options = onnxruntime.SessionOptions()
            options.intra_op_num_threads = 1
            options.inter_op_num_threads = 1
            _session = onnxruntime.InferenceSession(
                str(model), sess_options=options, providers=["CPUExecutionProvider"],
            )
        return _session


def classify_rgb_batch(data: bytes) -> list[list[float]]:
    import numpy as np

    if not data or len(data) > RGB_BYTES * MAX_BATCH or len(data) % RGB_BYTES:
        raise ValueError("无效的静物图缩略图批次")
    batch = len(data) // RGB_BYTES
    rgb = np.frombuffer(data, dtype=np.uint8).reshape(batch, THUMBNAIL_SIZE, THUMBNAIL_SIZE, 3)
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    deviation = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    pixels = np.ascontiguousarray(((rgb.astype(np.float32) / 255 - mean) / deviation).transpose(0, 3, 1, 2))

    with _inference_slots:
        scores, = _get_session().run(["scores"], {"image": pixels})
    if (scores.shape != (batch, len(CLASSES)) or not np.isfinite(scores).all() or
            np.any(scores < 0) or np.any(scores > 1) or not np.allclose(scores.sum(axis=1), 1, atol=1e-3)):
        raise RuntimeError("静物图分类模型返回无效分数")
    return scores.tolist()
