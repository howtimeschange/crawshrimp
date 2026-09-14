"""Non-secret connection identity for generation provenance."""
import hashlib
import json
from urllib.parse import urlsplit
from core.one_xm_image import DEFAULT_BASE_URL
from core.image_providers import split_model, custom_provider, PROVIDERS


def connection_info(model, settings, key='', tier=''):
    provider, canonical = split_model(model)
    custom = custom_provider(provider, settings) if provider.startswith('custom-') else None
    gemini = canonical.startswith('gemini-')
    if custom:
        endpoint = custom.get('base_url', '')
        protocol = custom.get('protocol', 'openai')
        name = custom.get('name') or provider
    elif provider == '1xm':
        endpoint = settings.get('base_url') or DEFAULT_BASE_URL
        protocol, name = 'one_xm', '1XM'
    else:
        field = 'gemini_base_url' if gemini else 'base_url'
        endpoint = settings.get(f'ai.{provider}.{field}') or PROVIDERS[provider][field]
        protocol, name = ('gemini' if gemini else 'openai'), {'woka':'沃卡','semir':'森马网关'}.get(provider, provider)
    parsed = urlsplit(endpoint)
    if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('接口地址应为有效 HTTP(S) 地址，不包含账号、密钥、查询参数或片段')
    public = dict(id=provider, name=name, model=canonical, protocol=protocol, endpoint=f'{parsed.scheme}://{parsed.netloc}{parsed.path}', key_tier=tier)
    public['version'] = hashlib.sha256(json.dumps([public, key], sort_keys=True).encode()).hexdigest()[:20]
    return public
