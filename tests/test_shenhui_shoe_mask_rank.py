from PIL import Image, ImageDraw, ImageOps
from core import shenhui_shoe_mask_rank as masks


def test_mask_is_scale_and_background_invariant_but_preserves_pose_axis(tmp_path):
    first = Image.new('RGB', (200, 200), 'white')
    ImageDraw.Draw(first).polygon([(40, 35), (95, 30), (105, 155), (70, 175), (35, 120)], fill='black')
    first.save(tmp_path/'first.png')
    second = ImageOps.mirror(first)
    pixels = [(242, 242, 242) if p == (255, 255, 255) else p for p in second.getdata()]
    second.putdata(pixels)
    second.resize((400, 400)).save(tmp_path/'second.png')
    first.rotate(90).save(tmp_path/'horizontal.png')
    a, b, c = [masks.describe(tmp_path/(name+'.png')) for name in ('first','second','horizontal')]
    assert masks.similarity(a, b)['score'] > .90
    assert masks.similarity(a, c)['score'] < masks.similarity(a, b)['score'] - .15


def test_changed_image_invalidates_cached_mask(tmp_path):
    path = tmp_path/'source.png'
    image = Image.new('RGB', (160, 160), 'white')
    ImageDraw.Draw(image).rectangle((20, 60, 140, 100), fill='black')
    image.save(path)
    index = masks.MaskIndex()
    first = index.get(path)
    assert index.get(path) is first
    image.rotate(90).save(path)
    assert index.get(path) is not first


def test_ocr_text_box_is_removed_without_erasing_product(tmp_path):
    image = Image.new('RGB', (160, 160), 'white')
    draw = ImageDraw.Draw(image)
    draw.rectangle((20, 10, 100, 30), fill='black')
    draw.ellipse((40, 60, 120, 140), fill='black')
    path = tmp_path/'template.png'
    image.save(path)
    before = masks.describe(path)
    after = masks.describe(path, text_boxes=[(20, 10, 100, 30)])
    assert before.components == 2 and after.components == 1
    assert after.valid


def test_invalid_template_keeps_full_candidate_pool_and_shared_ocr_cache(tmp_path,monkeypatch):
    from core import shenhui_shoe_models as models,ocr_service
    from core import shenhui_shoe_template_match as direct
    calls=[]
    monkeypatch.setattr(ocr_service,'recognize_image_with_tesseract_js',lambda *a,**kw:(calls.append(1) or {'words':[]}))
    template=tmp_path/'blank.jpg';Image.new('RGB',(100,100),'white').save(template)
    state=models.ShoeModelState()
    for number in range(2):
        root=tmp_path/str(number);root.mkdir()
        ctx={'root':str(root),'style':'123456789012','color':'00001','ids':{str(i):str(i) for i in range(5)},
             'previews':{str(i):str(template) for i in range(5)},'main_refs':[str(template)]*5,
             'yq_refs':{'yq2':str(template),'yq3':str(template)},'yx_ref':str(template),'model_state':state}
        plan=masks.prepare_shortlists(ctx)
        assert set(plan['initial_ids'])==set(ctx['ids'])
        assert all(r['fallback_full_pool'] for r in plan['by_slot'].values())
    # Main/functional templates and the half-height detail example each have
    # one content hash, reused across slots and colors.
    assert len(calls)==len(state.mask_ocr_cache)==2
