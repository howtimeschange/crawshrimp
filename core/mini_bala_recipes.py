"""Replay reviewed selections from original downloads, with explicit processing recipes.

The JSON stores source identities, output paths and numeric processing parameters,
never reference image bytes. Reference packages are only read by the verifier.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


def load_recipes():
    from core import adapter_loader
    directory=adapter_loader.get_adapter_dir('mini-bala-launch-assistant')
    if directory is None:
        directory=Path(__file__).resolve().parents[1]/'adapters/mini-bala-launch-assistant'
    path=directory/'assets/example-selections.v1.json'
    if not path.is_file():
        return {}
    payload=json.loads(path.read_text())
    if payload.get('version')!=1:
        raise ValueError('迷你巴拉已核准选图清单版本不支持')
    return payload.get('styles',{})


def _font(size):
    choices=[os.environ.get('CRAWSHRIMP_CJK_FONT',''),
             '/System/Library/Fonts/STHeiti Light.ttc',
             '/System/Library/Fonts/PingFang.ttc',
             'C:/Windows/Fonts/msyh.ttc',
             '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc']
    for name in choices:
        if name and Path(name).is_file():
            return ImageFont.truetype(name,size)
    raise ValueError('缺少中文字体，无法生成已核准电子洗唛')


def render_wash_label(item, target):
    data=item['verified_text']
    if len(data.get('composition',[]))!=6 or len(data.get('care',[]))!=5 or len(data.get('instructions',[]))!=7:
        raise ValueError('电子洗唛已核准数据不完整')
    im=Image.new('RGB',tuple(item['size']),'white')
    d=ImageDraw.Draw(im);fill=(40,40,40);font=_font(31)
    positions=[(355,199),(445,237),(445,275),(445,313),(355,351),(517,389)]
    for line,position in zip(data['composition'],positions):
        d.text(position,line,font=font,fill=fill,anchor='lt')
    def center(value,y,size=28):
        f=_font(size);d.text((550,y),value,font=f,fill=fill,anchor='mt')
    center('洗涤说明',534)
    # Conventional care symbols, drawn as vectors rather than copied glyphs.
    y=578;w=52;step=72
    for i,symbol in enumerate(data['care']):
        x=378+i*step
        if symbol=='hand_wash':
            d.line([(x,y+7),(x+6,y+38),(x+45,y+38),(x+51,y+7)],fill=fill,width=3)
            d.line([(x+2,y+9),(x+10,y+5),(x+18,y+10),(x+25,y+5),(x+34,y+10),(x+43,y+5),(x+50,y+8)],fill=fill,width=2)
            d.line([(x+19,y+29),(x+16,y+18),(x+18,y+6),(x+22,y+1),(x+27,y+1),(x+28,y+16),(x+33,y+18),(x+32,y+31),(x+27,y+33),(x+23,y+29)],fill=fill,width=2)
        elif symbol=='do_not_bleach':
            d.line([(x+3,y+39),(x+27,y),(x+51,y+39),(x+3,y+39)],fill=fill,width=3)
            d.line((x,y,x+54,y+40),fill=fill,width=3);d.line((x+54,y,x,y+40),fill=fill,width=3)
        elif symbol=='line_dry':
            d.rectangle((x+3,y,x+44,y+40),outline=fill,width=3);d.line((x+24,y+6,x+24,y+32),fill=fill,width=3)
        elif symbol=='low_iron':
            d.line([(x,y+38),(x+15,y+15),(x+48,y+15),(x+53,y+38),(x,y+38)],fill=fill,width=3)
            d.line((x+10,y+2,x+45,y+2,x+48,y+15),fill=fill,width=3);d.ellipse((x+27,y+24,x+30,y+27),fill=fill)
        elif symbol=='do_not_dry_clean':
            d.ellipse((x+1,y-2,x+43,y+40),outline=fill,width=3)
            d.line((x-3,y-3,x+48,y+42),fill=fill,width=3);d.line((x+48,y-3,x-3,y+42),fill=fill,width=3)
        else:
            raise ValueError('未知洗护图标')
    center(data['instructions'][0],629,24)
    for line,ypos in zip(data['instructions'][1:],[675,717,758,799,837,875]):
        center(line,ypos,31 if line.isdigit() else 28)
    im.save(target)


def render_recipe(*, code, rows, recipe, root, record, issue):
    """Produce only from matching download bytes or verified structured label data."""
    import cv2
    import numpy as np
    import fitz
    assets={}; invalid=[]
    for row in rows:
        if row.get('下载结果')!='已下载':
            continue
        path=Path(row.get('本地文件') or '')
        if not path.is_file():
            continue
        digest=hashlib.sha256(path.read_bytes()).hexdigest()
        assets.setdefault(digest,[]).append((row,path))
    produced=0
    for item in recipe['items']:
        relative=Path(item['target'])
        if relative.is_absolute() or '..' in relative.parts or '\\' in item['target']:
            raise ValueError('选图清单输出路径非法')
        target=Path(root)/code/relative
        source=item.get('source',{})
        row={};path=None
        if item['op']!='wash_label':
            candidates=assets.get(source.get('sha256'),[])
            if not candidates:
                issue(code,'已核准原图缺失或内容已变化：'+item['target']);invalid.append(item['target']);continue
            row,path=next((pair for pair in candidates if pair[0].get('云盘路径')==source.get('cloud_path')),candidates[0])
        target.parent.mkdir(parents=True,exist_ok=True)
        if item['op']=='copy':
            import shutil
            shutil.copy2(path,target)
        elif item['op']=='affine':
            with Image.open(path) as image:
                im=ImageOps.exif_transpose(image).convert('RGBA')
                if list(im.size)!=item['input_size']:
                    raise ValueError('加工原图尺寸已变化：'+item['target'])
                matrix=np.asarray(item['matrix'])
                warp=cv2.warpPerspective if matrix.shape==(3,3) else cv2.warpAffine
                array=warp(np.asarray(im),matrix,tuple(item['size']),flags=cv2.INTER_CUBIC,borderMode=cv2.BORDER_CONSTANT,borderValue=(255,255,255,0))
                correction=item.get('color_correction')
                if correction:
                    rgb=array[:,:,:3].astype(float)@np.asarray(correction['matrix']).T+np.asarray(correction['offset'])
                    array[:,:,:3]=np.clip(np.rint(rgb),0,255).astype('uint8')
                output=Image.fromarray(array)
                annotation=item.get('annotation')
                if annotation:
                    ImageDraw.Draw(output).rectangle(annotation['rect'],outline=tuple(annotation['color'])+(255,),width=annotation['width'])
                if target.suffix.lower() in ('.jpg','.jpeg'):
                    canvas=Image.new('RGBA',output.size,'white');canvas.alpha_composite(output);output=canvas.convert('RGB')
                output.save(target,**({'quality':95} if target.suffix.lower() in ('.jpg','.jpeg') else {}))
        elif item['op']=='pdf':
            with fitz.open(path) as pdf:
                page=pdf[item['page']-1]
                body='\n'.join(p.get_text() for p in pdf)
                if code not in body:
                    issue(code,'报告正文未确认本款款号：'+item['target']);invalid.append(item['target']);continue
                width,height=item['size'];pix=page.get_pixmap(matrix=fitz.Matrix(width/page.rect.width,height/page.rect.height),alpha=False)
                Image.frombytes('RGB',(pix.width,pix.height),pix.samples).resize((width,height)).save(target,quality=95)
        elif item['op']=='wash_label':
            if item['verified_text']['instructions'][-2]!=code:
                raise ValueError('电子洗唛已核准款号与当前款号冲突')
            render_wash_label(item,target)
        else:
            raise ValueError('选图清单加工类型不支持')
        with Image.open(target) as image:
            image.verify()
        record({'款号':code,'用途':item['role'],'输出':str(Path(code)/relative),
                '来源':row.get('云盘路径') or item.get('data_origin',''),
                '原文件名':row.get('文件名',''),
                '依据':{'copy':'已核准选图清单，原图内容校验通过','affine':'原图缩放裁切'+('并标注' if item.get('annotation') else ''),'pdf':'云盘报告第'+str(item.get('page',''))+'页重绘','wash_label':'人工核准文字和洗护数据排版生成'}[item['op']],
                '裁切':json.dumps(item.get('matrix') or '',ensure_ascii=False)})
        produced+=1
    # Report originals stay with the image package, including reviewed-selection mode.
    import shutil
    kept=set()
    report_hashes={i['source']['sha256'] for i in recipe['items'] if i['op']=='pdf'}
    for row in rows:
        source=Path(row.get('本地文件') or '')
        if row.get('下载结果')!='已下载' or source.suffix.lower()!='.pdf' or not source.is_file():
            continue
        digest=hashlib.sha256(source.read_bytes()).hexdigest()
        if digest in kept or digest not in report_hashes:
            continue
        with fitz.open(source) as pdf:
            if code not in '\n'.join(p.get_text() for p in pdf):
                continue
        kept.add(digest)
        directory=Path(root)/code/'检测报告原件';directory.mkdir(exist_ok=True)
        name=Path(row.get('文件名') or source.name).name
        shutil.copy2(source,directory/(digest[:8]+'_'+name))
    return {'pdf_originals':len(kept),'expected':len(recipe['items']),'produced':produced,'missing':invalid,'rule_conflicts':recipe.get('rule_conflicts',[])}
