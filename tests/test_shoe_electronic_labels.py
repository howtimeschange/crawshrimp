from unittest.mock import Mock
from core.shoe_specialist.electronic_labels import ElectronicLabels, is_label_source, tile_facts
from core.shoe_specialist.identity import verify
from core.shoe_specialist.worker import resolve_label

STYLE='204426140134'
EAN='6914678705829'
def lines(color=None):
    result=[{'text':STYLE,'box':[.2,.8,.4,.05],'confidence':.99}]
    if color: result.append({'text':'颜色：'+color,'box':[.1,.4,.3,.04],'confidence':.99})
    return result

def provider(conflict=False):
    p=ElectronicLabels([],Mock())
    p.cache[STYLE]={'00323':{'status':'conflict' if conflict else 'verified','color_name':'灰黄色调','barcodes':[EAN]}}
    return p

def resolve(items, codes=(), p=None):
    g={'style':STYLE,'color':'00323','slots':{'wpz6':{'path':'photo.jpg'}}}
    resolve_label(g,items,lambda jobs:[{'lines':items,'barcodes':codes}],p,codes)
    return g

def test_barcode_rescues_missing_color_but_filename_or_style_alone_cannot():
    assert resolve(lines(),[EAN],provider())['label_status']=='verified'
    assert resolve(lines(),[],provider())['label_status']=='unconfirmed'
    assert resolve(lines(),[EAN])['label_status']=='unconfirmed'

def test_conflicting_identity_or_reference_never_passes():
    assert resolve(lines('浅灰20001'),[EAN],provider())['label_status']=='mismatch'
    assert resolve(lines(),[EAN],provider(True))['label_status']=='unconfirmed'

def test_no_electronic_coordinates_are_used_for_photo():
    items=[{'text':'产品名称：儿童户外鞋','box':[.1,.5,.3,.04]}]
    g=resolve(items,[EAN],provider())
    assert g['label_status']=='verified'
    assert g['label']['style_code_bbox'] is None
    assert g['label']['physical_check']['passed'] is False

def test_source_requires_owning_directory_not_filename():
    assert is_label_source(STYLE,'','wrong-name.jpg',f'/鞋品/{STYLE}-已写/wrong-name.jpg')
    assert not is_label_source(STYLE,'',STYLE+'.jpg','/鞋品/204426140036/file.jpg')
    assert not is_label_source(STYLE,'00323','鞋正面.jpg',f'/鞋品/{STYLE}/00323/鞋正面.jpg')

def test_mixed_tile_colors_cannot_supply_shared_barcodes():
    items=lines('灰黄00323')+lines('浅灰20001')+[{'text':'产品名称：儿童户外鞋','confidence':.99,'box':[.1,.5,.3,.04]}]
    assert tile_facts({'lines':items,'barcodes':[EAN]},[0,0,1,1]) is None


def test_fragment_detection_falls_back_to_whole_label_without_accepting_conflicts(tmp_path):
    from unittest.mock import patch
    from core.shoe_specialist.util import sha
    source = tmp_path / 'source.jpg'
    source.write_bytes(b'fixture')
    record = {'id': 'E1', 'style': STYLE, 'path': str(source), 'sha256': sha(source)}
    full = lines('灰黄00323') + [{'text': '产品名称：儿童户外鞋', 'confidence': .99, 'box': [.1,.5,.3,.04]}]
    def recognize(jobs):
        return [{'lines': full if job['region']==[0,0,1,1] else [], 'barcodes': []} for job in jobs]
    with patch('core.shoe_specialist.electronic_labels.label_regions', return_value=[[.4,.3,.6,.5]]):
        labels = ElectronicLabels([record], recognize)
        assert labels.references(STYLE)['00323']['status'] == 'verified'
        assert labels.evidence[0]['tiles'][-1]['region'] == [0,0,1,1]
        full.extend(lines('浅灰20001'))
        assert ElectronicLabels([record], recognize).references(STYLE) == {}

def test_label_after_many_marketing_images_is_still_checked(tmp_path):
    from unittest.mock import patch
    from core.shoe_specialist.util import sha
    sources=[]
    for i in range(34):
        path=tmp_path/f'{i}.jpg';path.write_bytes(str(i).encode())
        sources.append({'id':f'E{i}','style':STYLE,'path':str(path),'sha256':sha(path)})
    full=lines('灰黄00323')+[{'text':'产品名称：儿童户外鞋','confidence':.99,'box':[.1,.5,.3,.04]}]
    def recognize(jobs):
        return [{'lines':full if job['id']=='E33-0' else [],'barcodes':[]} for job in jobs]
    with patch('core.shoe_specialist.electronic_labels.label_regions',return_value=[[0,0,1,1]]):
        labels=ElectronicLabels(sources,recognize)
        assert labels.references(STYLE)['00323']['status']=='verified'
        assert len(labels.evidence)==34
