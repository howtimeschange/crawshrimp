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
