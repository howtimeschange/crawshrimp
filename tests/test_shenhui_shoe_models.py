from types import SimpleNamespace

import pytest

from core import llm_gateway as gateway
from core import shenhui_shoe_models as models


def route(model, config=None):
    return SimpleNamespace(model_id=model, base_url='https://official.test/v1' if model=='official' else 'https://semir.test/v1')


def test_fallback_order_and_actual_route_without_same_model_retry(monkeypatch):
    monkeypatch.setattr(gateway, 'route_for_model', route)
    called=[]
    def generate(**kwargs):
        model=kwargs['model_id'];called.append(model)
        assert kwargs['fallback_model_ids']==[] and kwargs['retry_same_model'] is False
        if model=='astra':raise gateway.LlmGatewayError('HTTP 503')
        return {'match':True},route(model)
    monkeypatch.setattr(gateway,'generate_multimodal_json',generate)
    result,actual=models.generate_json(models=['astra','official','terra'], sleep=lambda _: None)
    assert actual.model_id=='official'
    assert called==['astra','astra','astra','official']


def test_host_connection_failure_skips_other_models_on_same_gateway(monkeypatch):
    monkeypatch.setattr(gateway,'route_for_model',route)
    called=[]
    def generate(**kwargs):
        model=kwargs['model_id'];called.append(model)
        if model=='astra':raise gateway.LlmGatewayError('流式模型连接失败（curl退出码6）')
        return {},route(model)
    monkeypatch.setattr(gateway,'generate_multimodal_json',generate)
    models.generate_json(models=['astra','terra','official'],state=models.ShoeModelState())
    assert called==['astra','official']


def test_negative_visual_verdict_never_triggers_model_shopping(monkeypatch):
    monkeypatch.setattr(gateway,'route_for_model',route)
    called=[]
    def generate(**kwargs):
        called.append(kwargs['model_id']);return {'match':False,'reason':'wrong side'},route(kwargs['model_id'])
    monkeypatch.setattr(gateway,'generate_multimodal_json',generate)
    result,_=models.generate_json(models=['astra','official'])
    assert result['match'] is False and called==['astra']


def test_model_503_does_not_disable_other_semir_models(monkeypatch):
    monkeypatch.setattr(gateway,'route_for_model',route)
    state=models.ShoeModelState(clock=lambda:0)
    state.failed('astra',route('astra'),gateway.LlmGatewayError('HTTP 503'))
    assert state.unavailable('astra',route('astra'))
    assert not state.unavailable('terra',route('terra'))


def test_cooldown_expiry_allows_later_attempt_without_sleep():
    now=[0];state=models.ShoeModelState(clock=lambda:now[0])
    state.failed('astra',route('astra'),gateway.LlmGatewayError('HTTP 503'))
    now[0]=121
    assert not state.unavailable('astra',route('astra'))


def test_all_routes_unavailable_returns_failure(monkeypatch):
    monkeypatch.setattr(gateway,'route_for_model',route)
    state=models.ShoeModelState(clock=lambda:0)
    state.failed('astra',route('astra'),gateway.LlmGatewayError('HTTP 503'))
    with pytest.raises(gateway.LlmGatewayError,match='均不可用'):
        models.generate_json(models=['astra'],state=state)


@pytest.mark.parametrize('status', [502, 503, 504])
def test_transient_error_recovers_on_same_model_before_fallback(monkeypatch, status):
    monkeypatch.setattr(gateway, 'route_for_model', route)
    calls=[]; waits=[]; logs=[]
    def generate(**kwargs):
        calls.append(kwargs['model_id'])
        if len(calls)<3:
            raise gateway.LlmGatewayError(f'接口返回 HTTP {status}')
        return {'match':True},route(kwargs['model_id'])
    monkeypatch.setattr(gateway, 'generate_multimodal_json', generate)
    state=models.ShoeModelState()
    _, actual=models.generate_json(models=['astra','official'],state=state,log=logs.append,sleep=waits.append)
    assert actual.model_id=='astra'
    assert calls==['astra']*3 and waits==[1,3]
    assert sum(f'HTTP {status}' in line for line in logs)==2
    assert not state.unavailable('astra',route('astra'))


@pytest.mark.parametrize('error', ['HTTP 401','HTTP 402','HTTP 403','HTTP 429','连续90秒没有有效输出'])
def test_non_transient_rejections_do_not_use_503_retry_schedule(monkeypatch, error):
    monkeypatch.setattr(gateway,'route_for_model',route)
    calls=[]
    def generate(**kwargs):
        calls.append(kwargs['model_id'])
        if kwargs['model_id']=='astra':raise gateway.LlmGatewayError(error)
        return {},route('official')
    monkeypatch.setattr(gateway,'generate_multimodal_json',generate)
    models.generate_json(models=['astra','official'],sleep=lambda _:pytest.fail('unexpected retry'))
    assert calls==['astra','official']


def test_only_astra_gets_low_reasoning_effort(monkeypatch):
    observed=[]
    monkeypatch.setattr(gateway,'_generic_openai_json_request',lambda *args,**kwargs:observed.append(kwargs))
    for model in ['gpt-6-astra','deepseek-flash','gpt-5.6-terra']:
        models.stream_request(route(model),'system','prompt',[],timeout_seconds=90)
    assert [r['reasoning_effort'] for r in observed]==['low',None,None]
    assert all(r['stream'] is True for r in observed)
