from pathlib import Path
from unittest.mock import patch

from core.api_server import _shenhui_light_supply_label_candidate_result, _filter_shenhui_shoe_label_ocr_candidates


def row():
    return {'输入款号': '2084261412A7', '__shenhui_asset_role': 'shoe_label',
            '__shoe_label_candidate_kind': 'light_supply_ocr',
            '下载结果': '已下载', '本地文件': '/tmp/label.png',
            '云盘路径': '冬/轻供/鞋品/幸福玛丽/2084261412A7/daf0269c-5d45-414f-aba3-f2f31bfa6dd3.png'}


def test_supplier_certificate_accepts_folder_attribution_without_internal_code():
    text = '合格证产品名称儿童家居鞋产品货号BaHF-1775执行标准QB/T4552-2020帮面材质织物产地浙江省6941896915181'
    with patch('core.api_server._shenhui_shoe_label_ocr_text', return_value=(text, 80, text)):
        result = _shenhui_light_supply_label_candidate_result(row(), Path('/tmp/label.png'), None)
    assert result['accepted']
    assert '未校验供应商货号' in result['note']


def test_product_photo_or_weak_ocr_is_not_a_label():
    for text, confidence in [('balabala儿童鞋新品', 90), ('合格证执行标准QB/T4552-2020织物产地浙江6941896915181', 15)]:
        with patch('core.api_server._shenhui_shoe_label_ocr_text', return_value=(text, confidence, text)):
            assert not _shenhui_light_supply_label_candidate_result(row(), Path('/tmp/label.png'), None)['accepted']


def test_wrong_style_or_nested_folder_does_not_reach_ocr():
    r = row()
    r['云盘路径'] = r['云盘路径'].replace('/2084261412A7/', '/2084261412A9/')
    with patch('core.api_server._shenhui_shoe_label_ocr_text') as ocr:
        assert not _shenhui_light_supply_label_candidate_result(r, Path('/tmp/label.png'), None)['accepted']
        ocr.assert_not_called()


def test_filter_preserves_multiple_unmapped_labels_and_marks_rejected_rows():
    rows = [(row(), Path('/tmp/a.png')), (row(), Path('/tmp/b.png')), (row(), Path('/tmp/c.png'))]
    with patch('core.api_server._shenhui_light_supply_label_candidate_result', side_effect=[
        {'accepted': True, 'note': 'ok'}, {'accepted': True, 'note': 'ok'}, {'accepted': False, 'note': 'not label'}]):
        kept = _filter_shenhui_shoe_label_ocr_candidates(rows, None)
    assert len(kept) == 2
    assert rows[2][0]['下载结果'] == '已跳过'
    assert rows[2][0]['本地文件'] == ''


def box_row():
    r = row()
    r.update(输入款号='2081271412V2', 云盘路径='冬/轻供/鞋品/幻视/2081271412V2-已选/5S7A3390.JPG',
             __shoe_label_candidate_kind='light_supply_box_ocr')
    return r


def test_small_box_requires_full_alphanumeric_style_and_structure_not_visual_size():
    from core.api_server import _shenhui_light_supply_box_candidate_result
    text = 'balaOne2081271412V2合格证执行标准QB/T4331-2021帮面材质织物产地浙江'
    with patch('core.api_server._shenhui_shoe_label_ocr_text', return_value=(text, 64, text)), \
         patch('core.api_server._shenhui_shoe_label_visual_metrics') as visual:
        result = _shenhui_light_supply_box_candidate_result(box_row(), Path('/tmp/a.jpg'), None)
        assert result['accepted']
        visual.assert_not_called()
    for bad in ['2081271412V3', '2081271412V20', '12081271412V2']:
        wrong = text.replace('2081271412V2', bad)
        with patch('core.api_server._shenhui_shoe_label_ocr_text', return_value=(wrong, 80, wrong)), \
             patch('core.api_server._shenhui_shoe_label_crop_ocr_text', return_value=(wrong, 80, wrong)):
            assert not _shenhui_light_supply_box_candidate_result(box_row(), Path('/tmp/a.jpg'), None)['accepted']


def test_box_crop_recovery_and_multiple_labels_are_preserved_with_verified_evidence():
    text = '2081271412V2合格证执行标准QB/T4331-2021帮面材质织物产地浙江'
    rows = [(box_row(), Path('/tmp/a.jpg')), (box_row(), Path('/tmp/b.jpg'))]
    with patch('core.api_server._shenhui_shoe_label_ocr_text', return_value=('', 0, '')), \
         patch('core.api_server._shenhui_shoe_label_crop_ocr_text', return_value=(text, 70, text)):
        kept = _filter_shenhui_shoe_label_ocr_candidates(rows, None)
        assert len(kept) == 2
        assert all('已核验完整款号' in r['标签货号核验'] for r, _ in kept)


def test_box_wrong_path_and_ordinary_photo_rejected():
    from core.api_server import _shenhui_light_supply_box_candidate_result
    for path in ['冬/轻供/鞋品/2081271412V20-已选/5S7A3390.JPG',
                 '冬/轻供/鞋品/2081271412V2-已选/详情图/5S7A3390.JPG',
                 '冬/轻供/鞋品/2081271412V2-已选/1.jpg']:
        r = box_row(); r['云盘路径'] = path
        with patch('core.api_server._shenhui_shoe_label_ocr_text') as ocr:
            assert not _shenhui_light_supply_box_candidate_result(r, Path('/tmp/a.jpg'), None)['accepted']
            ocr.assert_not_called()
    with patch('core.api_server._shenhui_shoe_label_ocr_text', return_value=('新品童鞋', 90, '新品童鞋')), \
         patch('core.api_server._shenhui_shoe_label_crop_ocr_text', return_value=('新品童鞋', 90, '新品童鞋')):
        assert not _shenhui_light_supply_box_candidate_result(box_row(), Path('/tmp/a.jpg'), None)['accepted']


def test_uuid_certificate_accepts_status_folder_without_claiming_style_verification():
    r = row(); r['云盘路径'] = r['云盘路径'].replace('/2084261412A7/', '/2084261412A7-已选/')
    text = '合格证产品货号BaHF-1775执行标准QB/T4552-2020帮面材质织物产地浙江'
    with patch('core.api_server._shenhui_shoe_label_ocr_text', return_value=(text, 80, text)):
        assert _shenhui_light_supply_label_candidate_result(r, Path('/tmp/a.png'), None)['accepted']


def test_box_style_at_end_of_ocr_line_is_not_lost_by_normalization():
    from core.api_server import _shenhui_light_supply_box_candidate_result
    raw = 'balaOne 2081271412V2\nn 合格证执行标准QB/T4331-2021帮面材质织物产地浙江'
    normalized = raw.replace(' ', '').replace('\n', '')
    with patch('core.api_server._shenhui_shoe_label_ocr_text', return_value=(raw, 55, normalized)):
        assert _shenhui_light_supply_box_candidate_result(box_row(), Path('/tmp/a.jpg'), None)['accepted']
