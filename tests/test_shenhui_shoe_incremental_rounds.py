import threading
from pathlib import Path

from PIL import Image
from core import shenhui_shoe_packaging as shoe
from core import shenhui_shoe_sequential as sequence
from core import shenhui_shoe_final_review as final
from core import shenhui_shoe_template_match as direct




def test_same_style_colors_repair_and_review_concurrently_without_unchanged_reexport(tmp_path, monkeypatch):
    style = '123456789012'
    colors = ('10001', '10002')
    initial_calls = []
    def initial(**kwargs):
        initial_calls.append(kwargs.get('_reuse_prepared', False))
        assert not kwargs.get('_reuse_prepared'), 'Unchanged sources must not trigger full style export'
        target = tmp_path / style
        target.mkdir()
        report = []
        for color in colors:
            image = target / (color + '-tmz4.jpg')
            Image.new('RGB', (20, 20), 'white').save(image)
            report.append({'输入款号': style, '颜色': color, '规则槽位': 'tmz4',
                           '本地文件': str(image), '原文件名': 'same.jpg'})
            kwargs['_prepared_colors'][(style, color)] = {'slots': {
                'tmz4': 'same.jpg', '_sequential_context': {'style': style, 'color': color},
                '_sequential_result': {'selected': {'tmz4': 'same.jpg'}}}}
        return report, {style: target}
    monkeypatch.setattr(shoe, '_prepare_shoe_packages_initial', initial)
    review_barrier = threading.Barrier(2)
    repair_barrier = threading.Barrier(2)
    reviewed, repaired = [], []
    def review(slots, rows):
        reviewed.append(slots['_sequential_context']['color'])
        review_barrier.wait(timeout=3)
        return {'tmz4': 'still wrong'}, [{'semantic': 'tmz4', 'status': 'source_invalid',
            'accepted': False, 'path': rows[0]['本地文件'], 'reason': 'still wrong'}]
    def repair(slots, **kwargs):
        repaired.append(slots['_sequential_context']['color'])
        repair_barrier.wait(timeout=3)
        return slots
    monkeypatch.setattr(final, 'review_exports', review)
    monkeypatch.setattr(sequence, 'verify_packaged_selection', repair)
    shoe.prepare_shoe_packages_skip_failed_styles(
        data_rows=[{'输入款号': style, '颜色': color} for color in colors],
        output_root=tmp_path, pose_strategy='sequential_templates', style_workers=8, request_workers=8)
    assert sorted(repaired) == list(colors)
    assert len(reviewed) == 4
    assert initial_calls == [False]


def test_unchanged_unknown_gets_one_retry_then_new_evidence_reopens_review(tmp_path, monkeypatch):
    from tests.test_shenhui_shoe_final_review import fixture
    selection, rows, template = fixture(tmp_path)
    monkeypatch.setattr(direct, 'reference', lambda *args: str(template))
    calls = []
    def audit(*args):
        calls.append(1)
        return {'approved': [], 'rejected': {'tmz4': 'unclear'}, 'outcomes': {'tmz4': 'review_unknown'}}
    monkeypatch.setattr(direct, 'audit', audit)
    for _ in range(4):
        _, records = final.review_exports(selection, rows)
        assert records[0]['status'] == 'review_unknown' and not records[0]['accepted']
    assert len(calls) == 2 and selection['tmz4'] == 'source.jpg'
    Image.new('RGB', (100, 100), 'gray').save(tmp_path / 'source.jpg')
    final.review_exports(selection, rows)
    assert len(calls) == 3
