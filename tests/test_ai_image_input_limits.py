from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from core import ai_image_service, api_server


def test_ten_inputs_keep_order_and_eleven_fail_before_reading_files():
    reader = Mock(side_effect=lambda path: 'data:' + path)
    job = {'prompt': 'test', 'params': {'main_image_path': 'main.png', 'reference_image_paths': [f'{i}.png' for i in range(9)]}}
    payload = ai_image_service.build_one_xm_payload(job, file_to_data_url_fn=reader)
    assert payload['image'] == ['data:main.png', *[f'data:{i}.png' for i in range(9)]]
    reader.reset_mock()
    job['params']['reference_image_paths'].append('10.png')
    with pytest.raises(ValueError, match='共 11 张'):
        ai_image_service.build_one_xm_payload(job, file_to_data_url_fn=reader)
    reader.assert_not_called()


def test_legacy_asset_list_cannot_silently_drop_images():
    assets = [{'kind': 'main' if i == 0 else 'reference', 'path': str(i), 'sort_order': i} for i in range(11)]
    reader = Mock()
    with pytest.raises(ValueError, match='共 11 张'):
        ai_image_service.build_one_xm_payload({'prompt': 'test'}, assets, file_to_data_url_fn=reader)
    reader.assert_not_called()


def test_preview_rejects_above_same_20mb_input_limit(tmp_path):
    image = tmp_path / 'large.png'
    with image.open('wb') as f:
        f.truncate(20 * 1024 * 1024 + 1)
    with pytest.raises(HTTPException) as error:
        api_server.read_local_image_preview(api_server.LocalImagePreviewRequest(path=str(image)))
    assert error.value.status_code == 400
    assert 'large.png' in error.value.detail
    assert '20 MB' in error.value.detail


def test_script_row_builder_keeps_ten_and_rejects_eleven(monkeypatch):
    reader = Mock(side_effect=lambda path: 'data:' + path)
    monkeypatch.setattr(api_server, 'file_to_data_url', reader)
    row = {'__1xm_reference_paths': [f'{i}.png' for i in range(10)]}
    assert api_server._prepare_one_xm_payload(row)['image'] == [f'data:{i}.png' for i in range(10)]
    reader.reset_mock()
    row['__1xm_reference_paths'].append('eleven.png')
    with pytest.raises(ValueError, match='共 11 张'):
        api_server._prepare_one_xm_payload(row)
    reader.assert_not_called()
