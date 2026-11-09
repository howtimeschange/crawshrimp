import hashlib
from pathlib import Path
from PIL import Image
import pytest
from core.mini_bala_recipes import render_recipe

CODE='230426107212'

def test_reviewed_recipe_uses_originals_and_rejects_changed_bytes(tmp_path):
    source=tmp_path/'source.png';Image.new('RGBA',(100,100),(0,0,255,255)).save(source)
    digest=hashlib.sha256(source.read_bytes()).hexdigest()
    recipe={'items':[{'target':'颜色/ya.png','role':'ya','op':'copy','source':{'sha256':digest,'cloud_path':'cloud/original.png'}}]}
    rows=[{'本地文件':str(source),'云盘路径':'cloud/original.png','文件名':'original.png','下载结果':'已下载'}]
    records=[];issues=[]
    root=tmp_path/'first';root.mkdir()
    result=render_recipe(code=CODE,rows=rows,recipe=recipe,root=root,record=records.append,issue=lambda c,r:issues.append(r))
    assert result['produced']==1 and not issues
    assert (root/CODE/'颜色/ya.png').read_bytes()==source.read_bytes()
    Image.new('RGBA',(100,100),(255,0,0,255)).save(source)
    second=tmp_path/'second';second.mkdir()
    result=render_recipe(code=CODE,rows=rows,recipe=recipe,root=second,record=records.append,issue=lambda c,r:issues.append(r))
    assert result['produced']==0 and result['missing']==['颜色/ya.png']
    assert not (second/CODE/'颜色/ya.png').exists()


def test_recipe_applies_processing_and_annotation_without_reference(tmp_path):
    source=tmp_path/'source.png';Image.new('RGBA',(100,100),(0,0,255,255)).save(source)
    digest=hashlib.sha256(source.read_bytes()).hexdigest()
    recipe={'items':[{'target':'tmq.jpg','role':'tmq','op':'affine','source':{'sha256':digest},'input_size':[100,100],'size':[50,50],'matrix':[[.5,0,0],[0,.5,0]],'annotation':{'rect':[5,5,40,40],'color':[255,0,0],'width':3}}]}
    rows=[{'本地文件':str(source),'云盘路径':'cloud.png','下载结果':'已下载'}]
    root=tmp_path/'out';root.mkdir()
    result=render_recipe(code=CODE,rows=rows,recipe=recipe,root=root,record=lambda _:None,issue=lambda *args:None)
    assert result['produced']==1
    with Image.open(root/CODE/'tmq.jpg') as im:
        assert im.size==(50,50)
        assert im.getpixel((20,20))[2]>200
        assert im.getpixel((6,20))[0]>150


def test_recipe_does_not_allow_path_traversal(tmp_path):
    with pytest.raises(ValueError,match='路径非法'):
        render_recipe(code=CODE,rows=[],recipe={'items':[{'target':'../outside.png','op':'copy'}]},root=tmp_path,record=lambda _:None,issue=lambda *args:None)


def test_label_data_cannot_be_applied_to_a_different_style(tmp_path):
    with pytest.raises(ValueError,match='款号冲突'):
        render_recipe(code=CODE,rows=[],recipe={'items':[{'target':'x.png','role':'x','op':'wash_label','verified_text':{'instructions':['999999999999','0581']}}]},root=tmp_path,record=lambda _:None,issue=lambda *args:None)
