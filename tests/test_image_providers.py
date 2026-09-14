import base64
import importlib.util
from pathlib import Path
from unittest.mock import patch

import pytest

from core import ai_image_service, data_sink, runtime_paths
from core.image_providers import CompatibleImageClient, create_image_client, provider_settings, split_model
from core.one_xm_image import OneXMImageClient, RejectedOneXMImageError, RetryableOneXMImageError, run_image_task_until_done

PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII='
DATA = 'data:image/png;base64,' + PNG

@pytest.mark.parametrize('provider', ['woka', 'semir'])
@pytest.mark.parametrize('model', ['gpt-image-2', 'gpt-image-2.5', 'gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview'])
def test_routing_isolated_keys_and_canonical_payload(provider, model):
    job = {'model_key': f'{provider}/{model}', 'prompt': 'product', 'params': {'ratio': '3:4', 'resolution': '2K', 'size': '1536x2048'}}
    field = 'api_key' if provider == 'woka' else 'gemini_api_key' if model.startswith('gemini') else 'gpt_api_key'
    expected = f'ai.{provider}.{field}'
    settings = {expected: 'provider-key', '2k': 'legacy-key'}
    assert ai_image_service.select_model_key(job, settings) == (expected, 'provider-key')
    with pytest.raises(ai_image_service.MissingModelKeyError):
        ai_image_service.select_model_key(job, {'2k': 'legacy-key'})
    client = create_image_client(job, settings, 'provider-key')
    assert client.provider == provider
    assert client.model == model
    payload = ai_image_service.build_one_xm_payload(job)
    assert payload['model'] == model
    if model.startswith('gemini'):
        assert payload['size'] == '3:4'
        assert payload['quality'] == '2K'


def test_legacy_client_and_invalid_provider():
    assert isinstance(create_image_client({'model_key': 'gpt-image-2'}, {}, 'key'), OneXMImageClient)
    with pytest.raises(ValueError): split_model('unknown/gpt-image-2')
    assert provider_settings({'ai': {'semir': {'gpt_api_key': 'local'}}}, {})['ai.semir.gpt_api_key'] == 'local'


@pytest.mark.parametrize('edit', [False, True])
def test_openai_generations_and_multipart_edit(edit):
    calls = []
    def transport(method, url, **kwargs):
        calls.append((url, kwargs))
        return 200, {'data': [{'b64_json': PNG}]}
    client = CompatibleImageClient('secret', provider='semir', model='gpt-image-2', base_url='https://gateway.test/v1/images/generations', transport=transport)
    payload = {'prompt': 'edit', 'size': '1024x1024', 'n': 1, 'output_format': 'png'}
    if edit: payload.update(image=[DATA, DATA], mask=DATA)
    result = run_image_task_until_done(client, payload, idempotency_key='test')
    url, kwargs = calls[0]
    assert url.endswith('/images/edits' if edit else '/images/generations')
    assert kwargs['headers']['Authorization'] == 'Bearer secret'
    assert kwargs['timeout'] >= 240
    if edit:
        assert b'name="image[]"' in kwargs['body']
        assert b'name="mask"' in kwargs['body']
        assert base64.b64decode(PNG) in kwargs['body']
        assert b'data:image' not in kwargs['body']
    else: assert kwargs['body']['model'] == 'gpt-image-2'
    assert result['image_urls'] == [DATA]
    assert result['poll_attempts'] == 0


def test_gemini_reference_and_resolution():
    calls = []
    def transport(method, url, **kwargs):
        calls.append((url, kwargs))
        return 200, {'candidates': [{'content': {'parts': [{'text': 'done'}, {'inline_data': {'mime_type': 'image/png', 'data': PNG}}]}}]}
    client = CompatibleImageClient('google-key', provider='woka', model='gemini-3-pro-image-preview', base_url='https://gateway.test/v1beta', transport=transport)
    result = client.create_task({'prompt': 'edit', 'image': [DATA], 'size': '3:4', 'quality': '4K'})
    url, request = calls[0]
    assert url.endswith('/models/gemini-3-pro-image-preview:generateContent')
    assert request['headers']['x-goog-api-key'] == 'google-key'
    assert 'Authorization' not in request['headers']
    assert request['body']['contents'][0]['parts'][1]['inlineData']['data'] == PNG
    assert request['body']['generationConfig']['imageConfig'] == {'aspectRatio': '3:4', 'imageSize': '4K'}
    assert result['data'] == [{'url': DATA}]


def test_post_failure_never_retried_or_falls_back():
    calls = []
    def transport(*args, **kwargs):
        calls.append(args)
        raise RetryableOneXMImageError('timeout')
    client = CompatibleImageClient('key', provider='woka', model='gpt-image-2', base_url='https://gateway.test/v1', transport=transport)
    with pytest.raises(Exception):
        client.create_task({'prompt': 'test'}, request_retries=5)
    assert len(calls) == 1


def test_no_images_is_failure():
    client = CompatibleImageClient('key', provider='woka', model='gpt-image-2', base_url='https://gateway.test/v1', transport=lambda *a, **k: (200, {'data': []}))
    with pytest.raises(RejectedOneXMImageError, match='未包含图片'): client.create_task({'prompt': 'test'})


def test_data_results_materialize_and_export(tmp_path, monkeypatch):
    monkeypatch.setenv('CRAWSHRIMP_DATA', str(tmp_path / 'data'))
    runtime_paths.reset_runtime_data_root_cache()
    job = {'job_uid': 'provider-job', 'summary': {'image_urls': [DATA]}}
    with patch.object(data_sink, 'get_ai_image_job', return_value=job), patch.object(data_sink, 'update_ai_image_job'), patch.object(data_sink, 'list_ai_image_assets', return_value=[]):
        result = ai_image_service.materialize_remote_image('provider-job', DATA)
        assert Path(result['path']).read_bytes() == base64.b64decode(PNG)
        exported = ai_image_service.copy_assets_to_directory([{'url': DATA}], tmp_path / 'export')
        assert Path(exported[0]).read_bytes() == base64.b64decode(PNG)
    runtime_paths.reset_runtime_data_root_cache()


def test_tmall_data_url_list_and_download(tmp_path):
    path = Path(__file__).parents[1] / 'adapters/tmall-ops-assistant/tools/run_tmall_ai_image_test_chain.py'
    spec = importlib.util.spec_from_file_location('provider_tmall_test', path)
    module = importlib.util.module_from_spec(spec)
    import sys
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    assert module.parse_list(DATA + '\n' + DATA) == [DATA, DATA]
    paths = module.download_generated_images({'生成图URL': DATA, '款号': 'probe'}, tmp_path)
    assert len(paths) == 1
    assert Path(paths[0]).suffix == '.png'
    assert Path(paths[0]).read_bytes() == base64.b64decode(PNG)


def test_custom_provider_configuration_and_protocol(tmp_path):
    custom = {'id': 'custom-team', 'name': 'Team', 'protocol': 'gemini', 'base_url': 'https://team.test/v1beta', 'api_key': 'team-key', 'models': ['banana-team']}
    config = {'ai': {'image': {'custom_providers': [custom]}}}
    settings = provider_settings(config, {})
    job = {'model_key': 'custom-team/banana-team', 'prompt': 'test', 'params': {'ratio': '3:4', 'resolution': '4K'}}
    key_id, key = ai_image_service.select_model_key(job, settings)
    assert key_id == 'ai.image.custom.custom-team.api_key'
    assert key == 'team-key'
    client = create_image_client(job, settings, key)
    assert client.protocol == 'gemini'
    assert client.base_url == custom['base_url']
    with patch('core.config.load_config', return_value=config):
        assert ai_image_service.build_one_xm_payload(job)['quality'] == '4K'
        from core.buyer_show_service import _resolve_buyer_show_model_params
        assert _resolve_buyer_show_model_params({'model_id': job['model_key']})['provider_family'] == 'nano-banana'
    with pytest.raises(ValueError, match='未在自定义供应商'):
        create_image_client({'model_key': 'custom-team/not-listed'}, settings, key)
    with pytest.raises(ValueError, match='不存在'):
        create_image_client(job, {}, key)


def test_custom_async_provider_uses_task_protocol():
    settings = provider_settings({'ai.image.custom_providers': [{'id': 'custom-async', 'protocol': 'one_xm', 'models': ['gpt-image-2'], 'base_url': 'https://async.test/v1', 'api_key': 'async-key'}]}, {})
    client = create_image_client({'model_key': 'custom-async/gpt-image-2'}, settings, 'async-key')
    assert isinstance(client, OneXMImageClient)
    assert client.base_url == 'https://async.test/v1'


def test_buyer_show_does_not_resubmit_unknown_sync_result():
    from core.buyer_show_service import _run_buyer_show_ai_job_with_retry
    unknown = {'ok': False, 'summary': {'error': 'timeout', 'error_code': 'UNKNOWN_SUBMIT_RESULT'}}
    with patch.object(ai_image_service, 'run_job_with_one_xm', return_value=unknown) as run:
        assert _run_buyer_show_ai_job_with_retry('job', settings={}, log=lambda *a: None, label='test') == unknown
    assert run.call_count == 1


@pytest.mark.parametrize('status,code', [(429, 'rate_limit_exceeded'), (503, 'service_unavailable')])
def test_explicit_transient_rejections_retry_with_backoff(status, code):
    calls, delays = [], []
    def transport(*args, **kwargs):
        calls.append(args)
        return (status, {'error': {'code': code}}) if len(calls) < 3 else (200, {'data': [{'b64_json': PNG}]})
    client = CompatibleImageClient('key', provider='woka', model='gpt-image-2', base_url='https://test.invalid/v1', transport=transport)
    result = client.create_task({'prompt': 'test'}, sleep_fn=delays.append)
    assert len(calls) == 3
    assert delays == [1.0, 2.0]
    assert result['submission_attempts'] == 3
    assert len(result['submission_retry_history']) == 2


@pytest.mark.parametrize('status,code', [(401, 'invalid_api_key'), (503, 'model_not_found'), (429, 'insufficient_quota')])
def test_configuration_or_balance_errors_are_not_retried(status, code):
    calls = []
    def transport(*args, **kwargs):
        calls.append(args)
        return status, {'error': {'code': code}}
    client = CompatibleImageClient('key', provider='semir', model='gpt-image-2.5', base_url='https://test.invalid/v1', transport=transport)
    with pytest.raises(RejectedOneXMImageError): client.create_task({'prompt': 'test'})
    assert len(calls) == 1


def test_transient_retry_limit_is_three():
    calls = []
    def transport(*args, **kwargs):
        calls.append(args)
        return 429, {'error': {'code': 'rate_limit_exceeded'}}
    client = CompatibleImageClient('key', provider='woka', model='gpt-image-2', base_url='https://test.invalid/v1', transport=transport)
    with pytest.raises(RejectedOneXMImageError): client.create_task({'prompt': 'test'}, request_retries=9, sleep_fn=lambda _: None)
    assert len(calls) == 3


@pytest.mark.parametrize('provider', ['woka', 'semir'])
def test_batch_retries_definite_rejection_and_records_attempt(tmp_path, provider):
    field = 'ai.woka.api_key' if provider == 'woka' else 'ai.semir.gpt_api_key'
    calls = []
    def transport(*args, **kwargs):
        calls.append(args)
        return (429, {'error': {'code': 'rate_limit_exceeded'}}) if len(calls) == 1 else (200, {'data': [{'b64_json': PNG}]})
    with patch('core.runtime_paths.data_root', return_value=tmp_path), patch('core.image_providers._compatible_transport', side_effect=transport):
        data_sink.init_db()
        job = data_sink.create_ai_image_job({'model_key': provider + '/gpt-image-2', 'params': {'size': '1024x1024'}})
        result = ai_image_service.submit_workbench_batch(job['job_uid'], [{'prompt': 'product', 'count': 1}], settings={field: 'key'})
        run = result['runs'][0]
        assert run['status'] == 'completed'
        assert run['submission_attempts'] == 2
        assert len(run['submission_retry_history']) == 1
        assert len(calls) == 2


def test_batch_network_unknown_is_persisted_and_manual_retry_blocked(tmp_path):
    with patch('core.runtime_paths.data_root', return_value=tmp_path), patch('core.image_providers._compatible_transport', side_effect=ConnectionError('connection closed')) as transport:
        data_sink.init_db()
        job = data_sink.create_ai_image_job({'model_key': 'woka/gpt-image-2', 'params': {'size': '1024x1024'}})
        result = ai_image_service.submit_workbench_batch(job['job_uid'], [{'prompt': 'product', 'count': 1}], settings={'ai.woka.api_key': 'key'})
        run = result['runs'][0]
        assert run['error_code'] == 'UNKNOWN_SUBMIT_RESULT'
        assert run['status'] == 'failed'
        with pytest.raises(ValueError, match='回执未知'):
            ai_image_service.retry_workbench_run(job['job_uid'], run['run_uid'], settings={'ai.woka.api_key': 'key'})
        assert transport.call_count == 1


def test_buyer_sync_retries_are_not_multiplied(tmp_path):
    from core.buyer_show_service import _run_buyer_show_ai_job_with_retry
    with patch('core.runtime_paths.data_root', return_value=tmp_path), patch('core.image_providers._compatible_transport', return_value=(429, {'error': {'code': 'rate_limit_exceeded'}})) as transport:
        data_sink.init_db()
        job = data_sink.create_ai_image_job({'model_key': 'semir/gpt-image-2', 'prompt': 'product', 'params': {'size': '1024x1024'}})
        result = _run_buyer_show_ai_job_with_retry(job['job_uid'], settings={'ai.semir.gpt_api_key': 'key'}, log=lambda *a: None, label='test')
        assert not result['ok']
        assert transport.call_count == 3
        assert result['summary']['submission_attempts'] == 3
        assert len(result['summary']['submission_retry_history']) == 2


def test_partial_batch_is_reported_without_losing_successes():
    summary, status = ai_image_service._rebuild_workbench_summary({}, [
        {'status': 'completed', 'requested_count': 2, 'image_urls': ['https://test/a', 'https://test/b']},
        {'status': 'failed', 'requested_count': 2, 'error_code': 'UNKNOWN_SUBMIT_RESULT'},
    ])
    assert status == 'completed'
    assert summary['partial_success'] is True
    assert (summary['completed_runs'], summary['failed_runs']) == (1, 1)
    assert (summary['requested_images'], summary['returned_images']) == (4, 2)


@pytest.mark.parametrize('status', [502, 504])
def test_gateway_failure_is_unknown_not_safe_to_resubmit(tmp_path, status):
    with patch('core.runtime_paths.data_root', return_value=tmp_path), patch('core.image_providers._compatible_transport', return_value=(status, {'error': 'upstream response lost'})) as transport:
        data_sink.init_db()
        job = data_sink.create_ai_image_job({'model_key': 'semir/gpt-image-2', 'params': {'size': '1024x1024'}})
        result = ai_image_service.submit_workbench_batch(job['job_uid'], [{'prompt': 'product', 'count': 1}], settings={'ai.semir.gpt_api_key': 'key'})
        assert result['runs'][0]['error_code'] == 'UNKNOWN_SUBMIT_RESULT'
        assert transport.call_count == 1


def test_sync_provider_concurrency_is_shared_across_clients():
    import threading
    import time
    from concurrent.futures import ThreadPoolExecutor
    active = peak = 0
    lock = threading.Lock()
    def transport(*args, **kwargs):
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        time.sleep(0.04)
        with lock:
            active -= 1
        return 200, {'data': [{'b64_json': PNG}]}
    clients = [CompatibleImageClient('key', provider='semir', model='gpt-image-2', base_url='https://test.invalid', transport=transport) for _ in range(8)]
    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(lambda client: client.create_task({'prompt': 'test'}), clients))
    assert len(results) == 8
    assert peak == 3
