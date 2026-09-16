"""Template-guided DINO collar localization + geometry-controlled original crop.
No pixel synthesis, rotation, mirroring, stretching, or style-specific boxes.
Uses the existing frozen backbone for dense correspondence, no new SAM model.
"""

import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps, ImageDraw
from .util import sha
from .foreground import read_crop

POLYGON = [
    (0.09, 0.61),
    (0.17, 0.75),
    (0.34, 0.80),
    (0.57, 0.65),
    (0.79, 0.36),
    (0.78, 0.25),
    (0.64, 0.20),
    (0.43, 0.28),
    (0.25, 0.46),
]


class MouthCropper:
    def __init__(self, bundle):
        from .inference import Backbone
        self.model = Backbone(bundle, 448)
        self.template = Path(bundle) / "snow-tmz4.png"
        with Image.open(self.template) as im:
            self.reference = self.encode(im.convert("RGB"))
        mask = Image.new("L", (448, 448))
        ImageDraw.Draw(mask).polygon(
            [(int(x * 448), int(y * 448)) for x, y in POLYGON], fill=255
        )
        self.labels = (
            np.asarray(mask.resize((32, 32), Image.Resampling.NEAREST)).ravel() > 0
        )

    def encode(self, im):
        from .inference import normalize
        return normalize(self.model.encode(im)[1:])

    def crop(self, source, target):
        im, fgbox = read_crop(source)
        z = self.encode(im)
        sim = z @ self.reference.T
        pos = np.sort(sim[:, self.labels], axis=1)[:, -3:].mean(1)
        neg = np.sort(sim[:, ~self.labels], axis=1)[:, -3:].mean(1)
        yy, xx = np.mgrid[:32, :32]
        valid = (yy < 22) & (yy > 1) & (xx > 3) & (xx < 29)
        front = z @ self.reference[int(0.70 * 32) * 32 + int(0.22 * 32)]
        front[~valid.ravel()] = -10
        front_idx = int(front.argmax())
        front_y = front_idx // 32
        # Rim-front anchor prevents laces/strap responses below the opening from
        # enlarging the crop down the boot. Keep two patches for the full front rim.
        keep = (pos - neg > 0).reshape(32, 32) & valid & (yy <= front_y + 2)
        from core.shenhui_shoe_mask_rank import _components

        comps = _components(bytearray(keep.ravel()), 32, 32)
        if not comps or len(comps[0]) < 12:
            raise ValueError(
                "No stable collar localization; review source instead of fixed crop"
            )
        ids = comps[0]
        xs = np.array([i % 32 for i in ids])
        ys = np.array([i // 32 for i in ids])
        l, t, r, b = (
            float(xs.min() * 14),
            float(ys.min() * 14),
            float((xs.max() + 1) * 14),
            float((ys.max() + 1) * 14),
        )
        # Remove thin top protrusions (heel pull-tabs) from the fitting rectangle,
        # while retaining the complete localized rim inside the final crop.
        raw_top = t
        row_widths = [sum(1 for k in ids if k // 32 == y) for y in range(32)]
        broad_rows = [
            y for y, v in enumerate(row_widths) if v >= max(row_widths) * 0.55
        ]
        if broad_rows:
            t = max(t, min(broad_rows) * 14)
        # Geometric target: collar fitting region occupies 90% width / 78% height; center
        # at (48%,49%). Square output with upper shaft retained and lower boot cut.
        side = max((r - l) / 0.90, (b - t) / 0.78)
        cx = (l + r) / 2
        cy = (t + b) / 2
        bx = cx - side * 0.48
        by = min(cy - side * 0.49, raw_top - side * 0.08)
        scale = min(448 / im.width, 448 / im.height)
        padx = (448 - im.width * scale) / 2
        pady = (448 - im.height * scale) / 2
        box = (
            round(fgbox[0] + (bx - padx) / scale),
            round(fgbox[1] + (by - pady) / scale),
            round(fgbox[0] + (bx + side - padx) / scale),
            round(fgbox[1] + (by + side - pady) / scale),
        )
        with Image.open(source) as src:
            src = ImageOps.exif_transpose(src).convert("RGB")
            assert (
                0 <= box[0] < box[2] <= src.width and 0 <= box[1] < box[3] <= src.height
            ), "crop exceeds actual image; no synthetic padding allowed"
            result = src.crop(box)
            result.save(target, quality=95)
        return {
            "source": str(source),
            "source_sha256": sha(source),
            "crop": str(target),
            "crop_sha256": sha(target),
            "crop_box": box,
            "mouth_box_in_448": (l, t, r, b),
            "crop_box_in_448": (bx, by, bx + side, by + side),
            "estimated_mouth_width_fraction": (r - l) / side,
            "estimated_mouth_height_fraction": (b - t) / side,
            "estimated_mouth_center": [(cx - bx) / side, (cy - by) / side],
            "front_similarity": float(front[front_idx]),
            "template_sha256": sha(self.template),
            "geometry": "original pixels, square crop; no rotate/warp/paint",
            "quality_status": "estimated geometry, requires visual review; not segmentation gold",
        }
