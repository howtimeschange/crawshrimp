"""Saved connection checks and whitelisted generation history; never returns credentials."""
from core import data_sink
from core.image_providers import split_model, create_image_client
from core.image_connection_info import connection_info


def error_category(message='', code=''):
    value = str(message).lower()
    if code == 'UNKNOWN_SUBMIT_RESULT': return 'receipt_unknown', '提交回执未知，请先核实供应商记录'
    if any(x in value for x in ('401','403','unauthorized','authentication','api key','未配置')): return 'authentication', '密钥未配置、无效或没有访问权限'
    if any(x in value for x in ('model','模型','404','not found')): return 'model', '模型未开通、已移除或接口路径不匹配'
    if any(x in value for x in ('429','quota','余额','rate limit')): return 'quota', '额度不足或请求频率受限'
    if any(x in value for x in ('timeout','connect','network','ssl','dns','连接','超时')): return 'network', '网络连接失败或请求超时'
    if any(x in value for x in ('协议','json','格式','地址')): return 'protocol', '接口地址、协议或响应格式不正确'
    if any(x in value for x in ('图片','素材','文件','20mb','10 张','6 张')): return 'input', '输入素材不符合要求，请检查大小、数量及文件是否存在'
    return 'provider', '供应商未返回成功结果，请检查当前模型和配置'


def check_connection(model_key, key_tier='', settings=None):
    from core import ai_image_service
    if settings is None:
        from core.api_server import _resolve_one_xm_settings
        settings = _resolve_one_xm_settings()
    provider, model = split_model(model_key)
    if not provider.startswith('custom-') and model not in {'gpt-image-2','gemini-3.1-flash-image-preview','gemini-3-pro-image-preview'}:
        raise ValueError('模型未开通或不在可选列表中')
    source = {'model_key': model_key, 'params': {'model_key_tier': key_tier}}
    tier, key = ai_image_service.select_model_key(source, settings)
    info = connection_info(model_key, settings, key, tier)
    create_image_client(source, settings, key)  # Validate protocol/model registration, no paid request.
    return {'ok': True, 'connection': info, 'network_verified': False,
            'message': '已读取当前连接配置。实际可用性以 AI 生图结果为准。'}


def call_history(provider=''):
    rows = []
    for job in data_sink.list_ai_image_jobs():
        if (job.get('params') or {}).get('surface') == 'image-provider-test': continue
        for run in (job.get('summary') or {}).get('runs') or []:
            model = str(run.get('model_key') or job.get('model_key') or '')
            try: pid, canonical = split_model(model)
            except ValueError: continue
            if provider and pid != provider: continue
            connection = run.get('connection') or {}
            category, error = error_category(run.get('error'),run.get('error_code')) if run.get('error') else ('','')
            rows.append({'job_uid':job['job_uid'],'run_uid':run.get('run_uid'),'time':run.get('created_at'),
                         'provider':pid,'model':canonical,'model_key':model,'key_tier':run.get('model_key_tier'),
                         'config_name':connection.get('name') or {'1xm':'1XM','woka':'沃卡','semir':'森马网关'}.get(pid,pid),
                         'config_version':connection.get('version') or '', 'status':run.get('status'),
                         'elapsed_seconds':run.get('elapsed_seconds'),'attempts':run.get('submission_attempts',0),
                         'retry_count':max(0,int(run.get('submission_attempts') or 1)-1)+int(run.get('retry_count') or 0)+int(run.get('manual_retry_count') or 0),
                         'category':category,'error':error})
    rows.sort(key=lambda row:str(row.get('time') or ''),reverse=True)
    return {'items':rows[:100], 'recent': next((row for row in rows if row['status']=='completed'),None)}
