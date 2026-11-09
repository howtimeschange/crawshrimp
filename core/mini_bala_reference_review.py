"""Read-only verification of independently produced output against examples.

The verifier never copies, repairs, or uses standard pixels to fill output slots.
"""
from __future__ import annotations
import csv
import hashlib
import json
import re
from pathlib import Path

from PIL import Image, ImageOps

IMAGE_SUFFIXES={'.jpg','.jpeg','.png','.webp','.bmp','.tif','.tiff'}


def fingerprint(path):
    with Image.open(path) as im:
        im=ImageOps.exif_transpose(im).convert('RGB')
        im.thumbnail((96,96))
        return hashlib.sha256(im.tobytes()).hexdigest()


def perceptual_hash(path):
    import cv2
    import numpy as np
    with Image.open(path) as im:
        rgba=ImageOps.exif_transpose(im).convert('RGBA')
        canvas=Image.new('RGBA',rgba.size,'white');canvas.alpha_composite(rgba)
        pixels=np.asarray(canvas.convert('RGB').resize((32,32)))
    dct=cv2.dct(cv2.cvtColor(pixels,cv2.COLOR_RGB2GRAY).astype(np.float32))[:8,:8]
    return (dct>np.median(dct.flatten()[1:])).flatten()


def review_against_reference(*, data_rows, reference_dir, output_root, log=print):
    """Read-only comparison. No missing output may be filled from the reference."""
    import numpy as np
    reference=Path(reference_dir).expanduser().resolve()
    output=Path(output_root).expanduser().resolve()
    if not reference.is_dir() or not output.is_dir() or reference==output:
        raise ValueError('示例和脚本输出必须是两个已存在的不同目录')
    styles={str(row.get('款号','')) for row in data_rows if re.fullmatch(r'\d{12}',str(row.get('款号','')))}
    expected={str(p.relative_to(reference)):p for p in reference.rglob('*') if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES and p.relative_to(reference).parts[0] in styles}
    actual={str(p.relative_to(output)):p for p in output.rglob('*') if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES and p.relative_to(output).parts[0] in styles}
    if not expected:
        raise ValueError('示例图包中未找到本次款号')
    def pixels(path):
        with Image.open(path) as im:
            im=ImageOps.exif_transpose(im).convert('RGBA')
            canvas=Image.new('RGBA',im.size,'white');canvas.alpha_composite(im)
            return canvas.convert('RGB')
    comparisons=[]
    for name,ref in sorted(expected.items()):
        row={'路径':name,'结果':'缺失','平均像素误差':'','说明':''}
        target=actual.get(name)
        if target:
            with Image.open(target) as im: im.verify()
            a,b=pixels(ref),pixels(target)
            if a.size!=b.size:
                row.update(结果='尺寸不一致',说明=f'{b.size} / 标准{a.size}')
            elif fingerprint(ref)==fingerprint(target):
                row.update(结果='原图一致',平均像素误差=0)
            else:
                aa=np.asarray(a.resize((512,512))).astype(float);bb=np.asarray(b.resize((512,512))).astype(float)
                mae=float(np.mean(np.abs(aa-bb)))
                distance=int(np.count_nonzero(perceptual_hash(ref)!=perceptual_hash(target)))
                row.update(结果='加工图一致' if mae<=6 and distance<=6 else '需视觉核验',平均像素误差=round(mae,4),说明=f'感知哈希差异{distance}')
        comparisons.append(row)
    missing=sorted(set(expected)-set(actual));extra=sorted(set(actual)-set(expected))
    review_dir=output/'复核记录';review_dir.mkdir(exist_ok=True)
    with (review_dir/'示例逐图对照.csv').open('w',encoding='utf-8-sig',newline='') as stream:
        writer=csv.DictWriter(stream,fieldnames=list(comparisons[0]));writer.writeheader();writer.writerows(comparisons)
    summary={'mode':'verification_only','output_root':str(output),'standard_images':len(expected),'output_images':len(actual),
             'missing':missing,'extra':extra,'needs_visual_review':[r for r in comparisons if r['结果'] not in ('原图一致','加工图一致')],
             'reference_images_copied':0,'ai_generalization_validated':False}
    (review_dir/'示例对照结果.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
    log(f'示例对照：缺失{len(missing)}、多余{len(extra)}、待视觉核验{len(summary["needs_visual_review"])}；未修改图包图片')
    return summary
