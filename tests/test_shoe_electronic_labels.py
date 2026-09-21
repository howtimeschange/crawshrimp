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
