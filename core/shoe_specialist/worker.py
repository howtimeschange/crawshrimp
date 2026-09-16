"""Isolated, offline DINO inference worker; no training labels or network fallback."""

import argparse, json, re, subprocess, time
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps
from .foreground import read_crop
from .identity import verify
from .util import sha


def encode(rows, bundle):
    from .inference import Backbone, normalize
    model = Backbone(bundle, 224)
    xs = []
    for row in rows:
        im, _ = read_crop(row["path"])
        z = model.encode(im)
        p = z[1:].reshape(16, 16, -1)
        blocks = np.stack([z[0]] + [p[y:y+8, x:x+8].mean((0, 1))
                                         for y in (0, 8) for x in (0, 8)])
        xs.append(normalize(blocks).flatten() / np.sqrt(5))
    return np.asarray(xs)


def score(x, h):
    return 1 / (
        1 + np.exp(-np.clip(x @ np.asarray(h["coef"]) + h["intercept"], -50, 50))
    )


def label_data(lines, style, color):
    check = verify([l["text"] for l in lines], style, color)
    if not check["passed"]:
        raise ValueError(f"{style}/{color} 鞋盒OCR款色不匹配: {check}")
    exact = [l for l in lines if l["text"].strip() == style]
    if len(exact) != 1:
        raise ValueError(f"{style}/{color} 未得到唯一完整款号文字框")

    def box(l):
        x, y, w, h = l["box"]
        return [x, 1 - y - h, x + w, 1 - y]

    sb = box(exact[0])
    bs = [box(l) for l in lines]
    pad = 0.01
    lb = [
        max(0, min(b[0] for b in bs) - pad),
        max(0, min(b[1] for b in bs) - pad),
        min(1, max(b[2] for b in bs) + pad),
        min(1, max(b[3] for b in bs) + pad),
    ]
    names = []
    for line in lines:
        if color in line["text"]:
            value = (
                re.sub(r"[\d\s:：]+", "", line["text"])
                .replace("颜色", "")
                .replace("色号", "")
            )
            if value and len(value) <= 10:
                names.append(value)
    return {
        "check": check,
        "style_code_bbox": sb,
        "label_bbox": lb,
        "color_name": (names[0] if names else "") + color,
        "lines": lines,
    }


def run(inp, bundle, out):
    start = time.perf_counter()
    rows = inp["candidates"]
    allowed = {
        "id",
        "style",
        "color",
        "category",
        "path",
        "sha256",
        "filename",
        "cloud_path",
    }
    for r in rows:
        if set(r) - allowed:
            raise ValueError("Inference input contains supervision or unknown fields")
        if sha(r["path"]) != r["sha256"]:
            raise ValueError("Source hash changed")
        if not re.fullmatch(r"\d{12}", r["style"]) or not re.fullmatch(
            r"\d{5}", r["color"]
        ):
            raise ValueError("Invalid source identity")
    metadata = json.loads((bundle / "bundle.json").read_text())
    for name, digest in metadata["files"].items():
        if sha(bundle / name) != digest:
            raise ValueError(f"Model resource integrity failure: {name}")
    x = encode(rows, bundle)
    models = json.loads((bundle / "models.json").read_text())["models"]
    yx = json.loads((bundle / "yx.json").read_text())
    results = []
    mouth = None
    for style, color in dict.fromkeys((r["style"], r["color"]) for r in rows):
        ids = [
            i for i, r in enumerate(rows) if (r["style"], r["color"]) == (style, color)
        ]
        cats = {rows[i]["category"] for i in ids}
        if len(cats) != 1:
            raise ValueError("Conflicting business category")
        cat = cats.pop()
        slots = {}
        scores = {}
        for slot in [
            "tmz1",
            "tmz2",
            "tmz3",
            "tmz4",
            "tmz5",
            "yq2",
            "yq3",
            "yx",
            "wpz6",
        ]:
            pool = ids
            if slot == "tmz5":
                pool = [
                    i
                    for i in ids
                    if re.fullmatch(
                        re.escape(style) + r"\s*[-－–—]\s*" + color,
                        Path(rows[i]["filename"]).stem,
                    )
                ]
            if not pool:
                raise ValueError(f"{style}/{color} missing standard source for {slot}")
            h = yx if slot == "yx" else models["spatial-" + cat + "-" + slot]
            prob = score(x[pool], h)
            best = pool[int(prob.argmax())]
            scores[slot] = float(prob.max())
            slots[slot] = (
                None if slot == "yx" and prob.max() < 0.5 else dict(rows[best])
            )
        # Same-color gray counterpart ranked against the chosen standard-source embedding.
        anchor = next(i for i in ids if rows[i]["id"] == slots["tmz5"]["id"])
        gray = []
        for i in ids:
            with Image.open(rows[i]["path"]) as im:
                im = ImageOps.exif_transpose(im).convert("RGB")
                im.thumbnail((64, 64))
                a = np.asarray(im)
                edge = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
                bg = np.median(edge, axis=0)
            if 235 <= float(bg.mean()) < 253 and float(bg.max() - bg.min()) < 8:
                gray.append(i)
        if not gray:
            raise ValueError(f"{style}/{color} 未发现WPZ15灰底候选，拒绝填充占位图")
        sims = x[gray] @ x[anchor]
        best = gray[int(sims.argmax())]
        slots["wpz5"] = dict(rows[best])
        scores["wpz5_pair_similarity"] = float(sims.max())
        if sims.max() < 0.80:
            raise ValueError(f"{style}/{color} WPZ15同姿势配对不确定")
        if cat == "雪地":
            if mouth is None:
                from .mouth_crop import MouthCropper

                mouth = MouthCropper(bundle)
            target = out / f"{style}-{color}-snow-tmz4.jpg"
            slots["tmz4"]["crop"] = mouth.crop(slots["tmz4"]["path"], target)
            slots["tmz4"]["generated"] = str(target)
        results.append(
            {
                "style": style,
                "color": color,
                "category": cat,
                "slots": slots,
                "scores_uncalibrated": scores,
            }
        )
    jobs = [
        {"id": f"{g['style']}-{g['color']}", "path": g["slots"]["wpz6"]["path"]}
        for g in results
    ]
    jobs_path = out / "ocr-input.json"
    jobs_path.write_text(json.dumps(jobs))
    from .ocr import recognize
    recognized = recognize(jobs)
    (out / "ocr-results.jsonl").write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in recognized), encoding="utf-8")
    ocr = {r["id"]: r for r in recognized}
    for g in results:
        g["label"] = label_data(
            ocr[f"{g['style']}-{g['color']}"]["lines"], g["style"], g["color"]
        )
    (out / "selection.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2)
    )
    (out / "runtime.json").write_text(
        json.dumps(
            {
                "seconds": time.perf_counter() - start,
                "groups": len(results),
                "images": len(rows),
                "paid_model_calls": 0,
                "bundle_version": metadata["version"],
                "input_sha256": sha(out / "input.json"),
                "worker_sha256": sha(__file__),
            },
            indent=2,
        )
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--bundle", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    run(json.loads(Path(a.input).read_text()), Path(a.bundle), Path(a.out))


if __name__ == "__main__":
    main()
