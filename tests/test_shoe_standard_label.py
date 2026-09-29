from unittest.mock import Mock
from core.shoe_specialist.worker import ensure_standard_label, is_standard_box_label

STYLE='208127140008'
def lines(standard=False,color='00416'):
    texts=[STYLE,'颜色：白红色调'+color]
    if standard:texts+=['产品名称：儿童运动鞋','帮面材料：织物','合格证']
    return [{'text':t,'box':[.1,.7-i*.08,.4,.04],'confidence':.99} for i,t in enumerate(texts)]
def group():
    return {'style':STYLE,'color':'00416','label_status':'verified','label':{'lines':lines()},
            'slots':{'wpz6':{'path':'simple.jpg'}},'label_candidates':[]}
def provider(kind='box_label',color='00416'):
    return Mock(references=Mock(return_value={'00416':{'status':'verified','tiles':[
        {'kind':kind,'lines':lines(True,color),'source':{'path':'electronic.png'},'region':[0,0,1,1]}]}}))
def test_simple_and_sewn_labels_are_not_standard():
    assert not is_standard_box_label(lines())
    assert not is_standard_box_label([{'text':t} for t in ['EUR','CHN','RMB',STYLE+' 00416 21-30']])
    assert is_standard_box_label(lines(True))
def test_nonstandard_output_uses_independently_verified_electronic_box():
    g=group();ensure_standard_label(g,Mock(),provider())
    assert g['label_status']=='verified'
    assert g['label']['output_source']['path']=='electronic.png'
    assert g['label']['output_kind']=='electronic_box_label'
def test_missing_wrong_color_and_hangtag_cannot_supply_output():
    for p in [None,provider(color='01210'),provider(kind='hangtag')]:
        g=group();ensure_standard_label(g,Mock(),p)
        assert g['label_status']=='unconfirmed'
def test_standard_physical_candidate_precedes_electronic():
    g=group();g['label_candidates']=[{'path':'standard.jpg'}]
    p=provider();ensure_standard_label(g,Mock(return_value=[{'lines':lines(True)}]),p)
    assert g['slots']['wpz6']['path']=='standard.jpg'
    p.references.assert_not_called()

def test_small_certificate_field_retries_crop_without_weakening_identity():
    for color, passed in [('00416', True), ('01210', False)]:
        g=group()
        g['label']={'lines':lines(True), 'label_bbox':[.1,.2,.7,.8]}
        g['label']['lines'][3]['text']='帮萄材料：织物'
        recognize=Mock(return_value=[{'lines':lines(True,color)}])
        ensure_standard_label(g,recognize,None)
        assert (g['label_status']=='verified') == passed
        assert recognize.call_args.args[0][0]['region']==[.1,.2,.7,.8]
        if passed: assert g['label']['output_kind']=='standard_box_photo'

def test_explicit_color_name_preserves_printed_letter_suffix():
    from core.shoe_specialist.identity import color_fields
    assert color_fields(['颜色：梦幻粉A61519'])[0]['name'] == '梦幻粉A'
    assert color_fields(['颜色：梦幻粉A61519'])[0]['code'] == '61519'
    assert not color_fields(['颜色：梦幻粉161519'])

def test_electronic_box_can_verify_without_readable_physical_label():
    g=group();g['label_status']='unconfirmed';g.pop('label')
    ensure_standard_label(g,Mock(),provider())
    assert g['label']['output_kind']=='electronic_box_label'

def test_landscape_electronic_label_preserves_both_edges(tmp_path):
    from PIL import Image, ImageDraw
    from core.shenhui_shoe_packaging import _create_tmq_asset
    im=Image.new('RGB',(1200,400),'white');d=ImageDraw.Draw(im)
    d.rectangle((0,0,35,399),fill='blue');d.rectangle((1164,0,1199,399),fill='green')
    source=tmp_path/'sheet.png';im.save(source)
    target=_create_tmq_asset(source=source,target=tmp_path/'tmq.jpg',label_bbox=[0,0,1000,1000],
        style_code_bbox=[300,20,600,100],style_code_bbox_verified=True,preserve_full_label=True)
    with Image.open(target) as result:
        assert result.size==(800,800)
        assert result.getpixel((10,400))[2]>200
        assert result.getpixel((790,400))[1]>90


def test_quoted_checksum_valid_ean_does_not_become_conflicting_style():
    from core.shoe_specialist.identity import verify
    from core.shoe_specialist.worker import label_data
    texts = ['208127146205', '颜色：白花色调00410', '6″914678500516']
    result = verify(texts, '208127146205', '00410')
    assert result['passed']
    assert result['ignored_valid_ean13'] == ['6914678500516']
    lines = [{'text': text, 'box': [.1, .8-i*.1, .5, .05]} for i,text in enumerate(texts)]
    assert label_data(lines, '208127146205', '00410')['check']['passed']
    assert not verify(texts + ['208127146206'], '208127146205', '00410')['passed']
    assert not verify(texts[:-1] + ['6″914678500517'], '208127146205', '00410')['passed']
