from core import shenhui_shoe_models as models, shenhui_shoe_fast as fast
from pathlib import Path
from types import SimpleNamespace
import pytest




def test_transport_metadata_retains_business_reason_across_fallback_and_retry(monkeypatch):
    route = SimpleNamespace(model_id='backup', base_url='https://test.example')
    monkeypatch.setattr(models.gateway, 'route_for_model', lambda *args: route)
    snapshots = []
    def generate(**kwargs):
        snapshots.append(dict(models.REQUEST_METADATA.get()))
        if len(snapshots) == 1:
            raise models.gateway.LlmGatewayError('inactivity timeout')
        if len(snapshots) == 2:
            raise models.gateway.LlmGatewayError('HTTP 503')
        return {'ok': True}, route
    monkeypatch.setattr(models.gateway, 'generate_multimodal_json', generate)
    models.generate_json(models=['official', 'backup'], state=models.ShoeModelState(),
        retry_delays=(0,), sleep=lambda _: None,
        request_metadata={'style': 'S', 'color': 'C', 'request_purpose': 'observation_fact_dispute'})
    assert [row['transport_reason'] for row in snapshots] == ['configured_primary', 'transport_fallback', 'http_retry']
    assert [row['transport_attempt'] for row in snapshots] == [1, 1, 2]
    assert all(row['request_purpose'] == 'observation_fact_dispute' and row['style'] == 'S' for row in snapshots)
    assert all(row['transport_primary_model'] == 'official' for row in snapshots)
    assert models.REQUEST_METADATA.get() == {}


def test_fast_request_preserves_review_purpose(monkeypatch):
    captured = []
    def generate(**kwargs):
        captured.append(kwargs['request_metadata'])
        return {}, SimpleNamespace(model_id='backup')
    monkeypatch.setattr(fast.shoe_models, 'generate_json', generate)
    fast._request({'style': 'S', 'color': 'C', 'log': lambda _: None,
        'pipeline_stage': 'export_review', 'request_purpose': 'review_output_invalid'},
        'backup', 'look at the image', [], 'direct review tmz2')
    assert captured == [{'style': 'S', 'color': 'C', 'stage': 'export_review',
        'operation': 'direct review tmz2', 'request_purpose': 'review_output_invalid'}]


def test_one_bad_json_does_not_redirect_next_style(monkeypatch):
    route = lambda model: SimpleNamespace(model_id=model, base_url='https://' + model + '.test')
    monkeypatch.setattr(models.gateway, 'route_for_model', lambda model, config=None: route(model))
    calls = []
    def generate(**kwargs):
        model = kwargs['model_id']
        calls.append(model)
        if len(calls) == 1:
            raise models.gateway.LlmResponseError('文本模型返回的 JSON 无法解析')
        return {}, route(model)
    monkeypatch.setattr(models.gateway, 'generate_multimodal_json', generate)
    state = models.ShoeModelState()
    models.generate_json(models=['official', 'backup'], state=state)
    models.generate_json(models=['official', 'backup'], state=state)
    assert calls == ['official', 'backup', 'official']
    assert not state.unavailable('official', route('official'))


def test_default_chain_stops_after_astra_failure(monkeypatch):
    calls = []
    monkeypatch.setattr(models.gateway, 'route_for_model', lambda model, config=None:
        SimpleNamespace(model_id=model, base_url='https://' + model + '.test'))
    def request(**kwargs):
        calls.append(kwargs['model_id'])
        raise models.gateway.LlmGatewayError('连续90秒没有有效思考或答案片段')
    monkeypatch.setattr(models.gateway, 'generate_multimodal_json', request)
    with pytest.raises(models.gateway.LlmGatewayError):
        models.generate_json(models=models.execution_models())
    assert calls == ['deepseek-official-flash', 'gpt-6-astra']
    assert models.execution_models(['gpt-5.6-terra']) == ['gpt-5.6-terra']
