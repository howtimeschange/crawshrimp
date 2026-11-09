import csv
from pathlib import Path
from PIL import Image
from core.mini_bala_packaging import read_copy, named_roles, extract_color, size_variant, valid_bbox, package_images

CODE='230426107212'

def test_copy_dedup_and_zero_padded_color_and_no_placeholder_growth():
    rows=[{'款号':CODE,'款色号':CODE+'-00313','颜色':'白黄色调','详情页\n面料标题1':'外层','详情页\n面料描述1':'柔软','详情页\n面料标题2':'内层','详情页\n成长研究所标题1':'/'},
          {'款号':CODE,'款色号':CODE+'-00313','颜色':'白黄色调'},
          {'款号':CODE+'9','款色号':CODE+'9-00313'}]
    result=read_copy({'rows':rows})
    assert list(result)==[CODE]
    assert result[CODE]['colors']=={'00313':'白黄色调'}
    assert result[CODE]['fabric_count']==2
    assert result[CODE]['growth']=={}

def test_conflicting_copy_is_not_silent():
    data=read_copy([{'款号':CODE,'详情页面料标题1':'A'},{'款号':CODE,'详情页面料标题1':'B'}])
    assert data[CODE]['conflicts']

def test_operators_multi_role_and_size():
    assert named_roles('(小)海报1 天猫1 SKC深蓝.jpg')==[('b',1),('o',1),('ys',1)]
    assert named_roles('(大)天猫4-2 搭配2.jpg')==[('yc',2),('yt',2)]
    assert named_roles('天猫3.jpg')==[]
    assert named_roles('天猫4.jpg')==[('yc',1)]
    assert named_roles('天猫5.jpg')==[('yg',1)]
    assert size_variant('/236426133202-00377小/610.JPG')=='小码'
    assert extract_color('/'+CODE+'-00313/IMG.jpg',CODE)=='00313'
    assert not valid_bbox([0,0,2,1])
    assert not valid_bbox([.9,.9,.1,.1])

def test_packager_preserves_sources_and_handles_missing_growth(tmp_path):
    src=tmp_path/'src.jpg';Image.new('RGB',(800,800),'white').save(src)
    rows=[{'款号':CODE,'下载结果':'已下载','本地文件':str(src),'文件名':'海报1 天猫1.jpg','素材类型':'model','云盘路径':f'目录/{CODE}-00313/海报1 天猫1.jpg'}]
    copies=[{'款号':CODE,'款色号':CODE+'-00313','颜色':'白黄','详情页成长研究所标题1':'舒展玩动'}]
    def analyze(entries,*args):return {entries[0]['id']:{'role':'model','confidence':.95,'growth_match':'不存在的文案'}}
    refs=package_images(data_rows=rows,run_params={'copy_file':copies},runtime_artifact_dir=str(tmp_path/'run'),analyzer=analyze,log=lambda _:None)
    root=Path(refs[0]);assert src.exists();assert (root/CODE/'b (1).jpg').exists();assert (root/CODE/'o (1).jpg').exists()
    assert not list(root.rglob('yh*'))
    assert '未找到匹配模特' in (root/'待复核.csv').read_text('utf-8-sig')

def test_multicolor_needs_explicit_primary_and_label_mismatch_rejected(tmp_path):
    src=tmp_path/'src.jpg';Image.new('RGB',(800,800),'white').save(src)
    rows=[{'款号':CODE,'下载结果':'已下载','本地文件':str(src),'文件名':'label.jpg','素材类型':'still','云盘路径':f'目录/{CODE}-00313/label.jpg'}]
    copies=[{'款号':CODE,'款色号':CODE+'-00313'},{'款号':CODE,'款色号':CODE+'-00321'}]
    def analyze(entries,*args):return {entries[0]['id']:{'role':'hang_tag','confidence':.99,'label_style_code':'999999999999'}}
    refs=package_images(data_rows=rows,run_params={'copy_file':copies},runtime_artifact_dir=str(tmp_path/'run'),analyzer=analyze,log=lambda _:None)
    root=Path(refs[0]);assert not list(root.rglob('q.jpg'))
    assert '标签款号冲突' in (root/'待复核.csv').read_text('utf-8-sig')

def test_pdf_cover_and_first_result_page_follow_human_standard():
    from core.mini_bala_packaging import select_report_pages
    assert select_report_pages(['委托 样品 W26045933','检测结果 单项判定','标准值 实测值 检测结果','实测值 绒子含量 蓬松度 充绒量'],'高标绒')==[0,1]
    assert select_report_pages(['样品 TTTS-WT26110527','检测项目 单项判定','标准值 实测值'])==[0,1]
    assert select_report_pages(['','',''])==[None,None]

def test_all_colors_have_label_subfolder_without_assumed_primary(tmp_path):
    src=tmp_path/'src.jpg';Image.new('RGB',(800,800),'white').save(src)
    colors=['00313','00321','00331']
    rows=[{'款号':CODE,'下载结果':'已下载','本地文件':str(src),'文件名':c+'.jpg','素材类型':'still','云盘路径':f'目录/{CODE}-{c}/label.jpg'} for c in colors]
    copies=[{'款号':CODE,'款色号':CODE+'-'+c} for c in colors]
    def analyze(entries,*args):return {e['id']:{'role':'hang_tag','confidence':.99,'label_style_code':CODE} for e in entries}
    refs=package_images(data_rows=rows,run_params={'copy_file':copies},runtime_artifact_dir=str(tmp_path/'run'),analyzer=analyze,log=lambda _:None)
    root=Path(refs[0])
    assert all((root/CODE/c/'1.1'/'q.jpg').exists() for c in colors)
    assert '待确认：多色款主色' in (root/'待复核.csv').read_text('utf-8-sig')

def test_internal_component_is_not_published_growth_copy():
    data=read_copy([{'款号':CODE,'mini成长研究所':'柔软内腰贴','详情页成长研究所标题1':'/','橱窗5成长研究所标题1':'/'}])
    assert data[CODE]['growth']=={}

def test_targeted_fabric_review_rejects_unknown_ids_and_invalid_crops(tmp_path,monkeypatch):
    from core.mini_bala_packaging import recover_fabric
    from core import llm_gateway
    src=tmp_path/'a.jpg';Image.new('RGB',(800,800),'blue').save(src)
    entry={'id':'a','name':'camera.jpg','path':str(src)}
    calls=[]
    def answer(**kwargs):
        calls.append(kwargs)
        return {'items':[{'id':'unknown','bbox':[0,0,1,1],'confidence':1}, {'id':'a','bbox':[0,0,2,1],'confidence':1}, {'id':'a','bbox':[.2,.2,.8,.8],'confidence':.98}]},None
    monkeypatch.setattr(llm_gateway,'generate_multimodal_json',answer)
    result=recover_fabric([entry],CODE,{'copy':{}},tmp_path,1,lambda _:None)
    assert len(result)==1 and result[0][1]['fabric_bbox']==[.2,.2,.8,.8]
    recover_fabric([entry],CODE,{'copy':{}},tmp_path,1,lambda _:None)
    assert len(calls)==1

def test_report_processing_checks_style_deduplicates_and_separates_multiple(tmp_path):
    import fitz
    from core.mini_bala_packaging import process_reports
    entries=[]
    for i,code in enumerate([CODE,CODE,'999999999999']):
        p=tmp_path/f'{i}.pdf'
        with fitz.open() as doc:
            page=doc.new_page();page.insert_text((50,50),f'Test Report W2604593{i} Sample {code}')
            page=doc.new_page();page.insert_text((50,50),'Test Result Measured 99')
            doc.save(p)
        entries.append({'id':str(i),'path':str(p),'name':f'{i}.pdf'})
    emitted=[];issues=[]
    process_reports(entries+[entries[0]],CODE,{'copy':{}},tmp_path/'cache',lambda e,p,role,why:emitted.append((p,role)),lambda c,r:issues.append(r))
    assert sum(role=='报告' for _,role in emitted)==2
    assert sum(role=='待核验PDF' for _,role in emitted)==1
    yi=[p for p,role in emitted if role=='yi']
    assert len(yi)==4 and len({p.parent for p in yi})==2
    assert all('检测报告' in p.parts for p in yi)
    assert any('多份' in i for i in issues)

def test_reference_review_keeps_downloaded_report_originals_in_final_package(tmp_path):
    import fitz
    pdf=tmp_path/'report.pdf'
    with fitz.open() as doc:
        p=doc.new_page();p.insert_text((50,50),f'Test Report W26045933 Sample {CODE}')
        p=doc.new_page();p.insert_text((50,50),'Test Result 99')
        doc.save(pdf)
    image=tmp_path/'image.jpg';Image.new('RGB',(300,300),'blue').save(image)
    reference=tmp_path/'reference'/CODE;reference.mkdir(parents=True)
    (reference/'b.jpg').write_bytes(image.read_bytes())
    rows=[{'款号':CODE,'下载结果':'已下载','本地文件':str(pdf),'文件名':'report.pdf','素材类型':'report','云盘路径':f'{CODE}/report.pdf','云盘挂载点':'质量部'},
          {'款号':CODE,'下载结果':'已下载','本地文件':str(image),'文件名':'image.jpg','素材类型':'model','云盘路径':f'{CODE}/image.jpg'}]
    refs=package_images(data_rows=rows,run_params={'reference_dir':str(reference.parent)},runtime_artifact_dir=str(tmp_path/'run'),analyzer=lambda *args:{},log=lambda _:None)
    final=Path(refs[0]);assert len(list((final/CODE/'检测报告原件').glob('*.pdf')))==1
    assert (final/'检测报告探查.json').is_file()
