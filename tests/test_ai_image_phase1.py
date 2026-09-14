import json
from unittest.mock import Mock
import pytest
from core import ai_image_service as service, data_sink, runtime_paths
from core.image_inputs import normalize_inputs, compile_input_prompt
from core.image_diagnostics import check_connection, call_history


@pytest.fixture
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(runtime_paths, 'data_root', lambda: tmp_path)
    data_sink.init_db()
    return tmp_path


def test_order_roles_and_limits_without_assumed_business_semantics():
    inputs = [{'path':'ref.png','role':'reference','purpose':'姿势'},
              {'path':'back.png','role':'main','group':'款 A','purpose':'背面'},
              {'path':'front.png','role':'main','group':'款 A','purpose':'正面'}]
    params = {'input_assets': inputs, 'input_mode':'multi-angle'}
    normalized = normalize_inputs(params)
    assert [x['path'] for x in normalized] == ['back.png','front.png','ref.png']
    prompt = compile_input_prompt('原始提示词', params, normalized)
    assert '图 1：主图。' in prompt
    assert '图 3：参考图。' in prompt
    assert '商品' not in prompt and '角度' not in prompt and '用途' not in prompt
    assert inputs[0]['path'] == 'ref.png'
    with pytest.raises(ValueError, match='6 张'):
        normalize_inputs({'main_image_paths':[str(i) for i in range(7)]})
    with pytest.raises(ValueError, match='共 11 张'):
        normalize_inputs({'main_image_paths':['m'],'reference_image_paths':[str(i) for i in range(10)]})
    assert normalize_inputs({'input_assets':[]}, [{'kind':'main','path':'stale'}]) == []


def test_full_snapshot_is_submission_data_not_later_draft_and_history_is_redacted(isolated, monkeypatch):
    settings = {'base_url':'https://example.com/v1','2k':'super-secret-phase1','4k':''}
    first = {'prompt':'first','model_key':'gpt-image-2','output_dir':'/tmp/output-a','params':{
        'size':'1024x1024','ratio':'1:1','quality':'low','response_format':'webp','n':2,'background':'transparent',
        'input_assets':[{'path':'a.png','role':'main','group':'商品 A','purpose':'正面','api_key':'must-not-persist'}],
        'input_mode':'composition','webhook_secret':'must-not-persist'}}
    job = data_sink.create_ai_image_job(first)
    def runner(client,payload,**kwargs):
        assert payload['image'] == ['data:a.png']
        assert payload['prompt'].startswith('first\n\n')
        data_sink.update_ai_image_job(job['job_uid'],{'prompt':'second','params':{'size':'2048x2048','quality':'high'}})
        return {'ok':True,'image_urls':['https://example.com/a.png','https://example.com/b.png']}
    result = service.run_job_with_one_xm(job['job_uid'], settings=settings, input_snapshot=first, runner=runner,file_to_data_url_fn=lambda path:'data:'+path)
    assert result['ok']
    read = data_sink.get_ai_image_job(job['job_uid'])
    snapshot = read['summary']['runs'][0]['generation_snapshot']
    assert read['prompt']=='second'
    assert snapshot['prompt']=='first' and snapshot['params']['quality']=='low' and snapshot['params']['n']==2
    assert snapshot['params']['input_assets'][0]['role']=='main'
    assert 'group' not in snapshot['params']['input_assets'][0]
    assert 'input_mode' not in snapshot['params']
    assert snapshot['output_dir']=='/tmp/output-a'
    serialized=json.dumps(read['summary'])
    assert 'super-secret-phase1' not in serialized and 'must-not-persist' not in serialized
    assert 'webhook_secret' not in snapshot['params']
    row=call_history()['items'][0]
    assert row['config_version']==snapshot['connection']['version'] and row['status']=='completed'
    assert 'prompt' not in row and 'api_key' not in json.dumps(row)
    changed={**first,'params':{**first['params'],'expected_connection_version':snapshot['connection']['version']}}
    blocked=Mock()
    with pytest.raises(ValueError,match='连接配置已变化'):
        service.run_job_with_one_xm(job['job_uid'],settings={**settings,'2k':'changed'},input_snapshot=changed,runner=blocked)
    blocked.assert_not_called()


def test_configuration_check_is_local_and_model_specific(monkeypatch):
    transport=Mock(side_effect=AssertionError('configuration check must not generate'))
    monkeypatch.setattr('core.one_xm_image._default_transport',transport)
    result=check_connection('gpt-image-2','2k',{'base_url':'https://example.com/v1','2k':'secret'})
    assert result['ok'] and result['network_verified'] is False
    assert 'secret' not in json.dumps(result)
    with pytest.raises(ValueError,match='未开通'):
        check_connection('woka/gpt-image-2.5',settings={'ai.woka.api_key':'secret'})
    with pytest.raises(ValueError):
        check_connection('gpt-image-2','2k',{'base_url':'https://example.com/v1?key=secret','2k':'secret'})
    transport.assert_not_called()
