"""CPU ONNX inference shared by macOS and Windows; bundled weights only."""
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps


class Backbone:
    def __init__(self, bundle, size):
        import onnxruntime as ort
        options = ort.SessionOptions()
        options.intra_op_num_threads = 4
        options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(
            str(Path(bundle) / f'dino-{size}.onnx'), options,
            providers=['CPUExecutionProvider'],
        )
        self.size = size

    def encode(self, im):
        im = ImageOps.pad(im.convert('RGB'), (self.size, self.size),
                          method=Image.Resampling.BICUBIC, color='white')
        x = np.asarray(im, dtype=np.float32).transpose(2, 0, 1) / np.float32(255)
        x = (x - np.array([.485, .456, .406], dtype=np.float32)[:, None, None]) / np.array([.229, .224, .225], dtype=np.float32)[:, None, None]
        return self.session.run(None, {'pixel_values': x[None]})[0][0]


def normalize(x):
    return x / np.maximum(np.linalg.norm(x, axis=-1, keepdims=True), 1e-12)
