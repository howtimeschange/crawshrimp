"""Provider routing for image generation; persisted model keys include provider identity."""
from __future__ import annotations

import base64
import json
import re
import urllib.request
import urllib.error
import time
import threading
from typing import Any, Mapping
from uuid import uuid4

from core.one_xm_image import OneXMImageClient, OneXMImageError, RejectedOneXMImageError, _parse_json_bytes

IMAGE_MODELS = ('gpt-image-2', 'gpt-image-2.5', 'gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview')
PROVIDERS = {
    'woka': {'label': '沃卡', 'base_url': 'https://4.0.wk-best.com/v1', 'gemini_base_url': 'https://4.0.wk-best.com/v1beta'},
    'semir': {'label': '森马网关', 'base_url': 'https://ai-aigw.semir.com/overseas-image/v1', 'gemini_base_url': 'https://ai-aigw.semir.com/overseas-image-gemini/v1beta'},
}
SYNC_PROVIDER_CONCURRENCY = 3
_submission_slots: dict[str, threading.BoundedSemaphore] = {}
_submission_slots_lock = threading.Lock()


def _provider_submission_slot(provider):
    with _submission_slots_lock:
        return _submission_slots.setdefault(provider, threading.BoundedSemaphore(SYNC_PROVIDER_CONCURRENCY))


def split_model(value: Any) -> tuple[str, str]:
    value = str(value or 'gpt-image-2').strip()
    if '/' not in value:
        return '1xm', value
    provider, model = value.split('/', 1)
    if not model or (provider not in PROVIDERS and not re.fullmatch(r'custom-[a-z0-9-]+', provider)) or (provider in PROVIDERS and model not in IMAGE_MODELS):
        raise ValueError(f'不支持的生图供应商/模型：{value}')
    return provider, model


def model_key(source: Mapping[str, Any]) -> str:
    params = source.get('params') or {}
    return str(source.get('model_key') or source.get('model') or params.get('model') or params.get('model_key') or 'gpt-image-2')


def config_id(provider: str, model: str) -> str:
    if provider.startswith('custom-'):
        return f'ai.image.custom.{provider}.api_key'
    return f'ai.{provider}.' + ('api_key' if provider == 'woka' else 'gemini_api_key' if model.startswith('gemini-') else 'gpt_api_key')


def provider_settings(config: Mapping[str, Any], environ: Mapping[str, str]) -> dict:
    result = {}
    for provider, defaults in PROVIDERS.items():
        for field in ('base_url', 'gemini_base_url', 'api_key') if provider == 'woka' else ('base_url', 'gemini_base_url', 'gpt_api_key', 'gemini_api_key'):
            name = f'ai.{provider}.{field}'
            value = config.get(name)
            if value is None:
                value = (config.get('ai') or {}).get(provider, {}).get(field)
            result[name] = str(value or environ.get(f'{provider.upper()}_IMAGE_{field.upper()}') or defaults.get(field, '')).strip()
    customs = config.get('ai.image.custom_providers', (config.get('ai') or {}).get('image', {}).get('custom_providers', []))
    result['ai.image.custom_providers'] = customs if isinstance(customs, list) else []
    for custom in result['ai.image.custom_providers']:
        if isinstance(custom, dict):
            result[f"ai.image.custom.{custom.get('id')}.api_key"] = custom.get('api_key') or ''
    return result


def custom_provider(provider, settings=None):
    if settings is None:
        from core.config import load_config
        settings = provider_settings(load_config(), {})
    for item in settings.get('ai.image.custom_providers', []):
        if isinstance(item, dict) and item.get('id') == provider:
            return item
    raise ValueError(f'自定义生图供应商不存在或已删除：{provider}')


def is_gemini_model(value, settings=None):
    provider, model = split_model(value)
    if provider.startswith('custom-'):
        custom = custom_provider(provider, settings)
        return custom.get('protocol') == 'gemini' or (custom.get('protocol') == 'one_xm' and model.startswith('gemini-'))
    return model.startswith('gemini-')


def create_image_client(source, settings, api_key, *, legacy_factory=OneXMImageClient):
    provider, model = split_model(model_key(source))
    if provider == '1xm':
        from core.one_xm_image import DEFAULT_BASE_URL
        return legacy_factory(api_key, base_url=settings.get('base_url') or DEFAULT_BASE_URL)
    if provider.startswith('custom-'):
        custom = custom_provider(provider, settings)
        if model not in custom.get('models', []):
            raise ValueError(f'模型未在自定义供应商中配置：{model}')
        protocol = custom.get('protocol') or 'openai'
        base_url = str(custom.get('base_url') or '').rstrip('/')
        if not base_url.startswith(('http://', 'https://')):
            raise ValueError('自定义供应商 Base URL 无效')
        if protocol == 'one_xm':
            return legacy_factory(api_key, base_url=base_url)
        if protocol not in {'openai', 'gemini'}:
            raise ValueError(f'不支持的生图接口协议：{protocol}')
        return CompatibleImageClient(api_key, provider=provider, model=model, base_url=base_url, protocol=protocol)
    field = 'gemini_base_url'  if model.startswith('gemini-') else 'base_url'
    return CompatibleImageClient(api_key, provider=provider, model=model,
                                 base_url=settings.get(f'ai.{provider}.{field}') or PROVIDERS[provider][field])


def _image_bytes(value: str) -> tuple[str, bytes]:
    if value.startswith('data:'):
        header, data = value.split(',', 1)
        return header[5:].split(';')[0], base64.b64decode(data, validate=True)
    if value.startswith(('https://', 'http://')):
        # Reference downloads never carry provider credentials.
        with urllib.request.urlopen(value, timeout=60) as response:
            data = response.read(20 * 1024 * 1024 + 1)
            if len(data) > 20 * 1024 * 1024:
                raise ValueError('参考图超过 20MB')
            return response.headers.get_content_type(), data
    raise ValueError('参考图必须是 data URL 或 HTTP URL')


def _multipart(payload):
    boundary = 'crawshrimp-' + uuid4().hex
    chunks = []
    for field, value in payload.items():
        if field in {'image', 'mask'}:
            values = value if isinstance(value, list) else [value]
            for index, item in enumerate(values):
                mime, data = _image_bytes(item)
                extension = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'}.get(mime, 'png')
                name = 'image[]' if field == 'image' and len(values) > 1 else field
                chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{field}-{index}.{extension}"\r\nContent-Type: {mime}\r\n\r\n'.encode() + data + b'\r\n')
        else:
            chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"\r\n\r\n{value}\r\n'.encode())
    chunks.append(f'--{boundary}--\r\n'.encode())
    return b''.join(chunks), f'multipart/form-data; boundary={boundary}'


def _compatible_transport(method, url, *, headers, body, timeout):
    data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, _parse_json_bytes(response.read())
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            payload = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            payload = {'error': {'message': f'HTTP {exc.code}'}}
        return exc.code, payload


def _retryable_rejection(status, result):
    # Only retry explicit, transient rejection; never retry a lost POST response.
    if status not in {429, 503}:
        return False
    error = result.get('error') or {}
    text = json.dumps(error, ensure_ascii=False).lower()
    if any(value in text for value in ('model_not_found', 'no available channel', 'support the requested model', 'quota', 'insufficient', 'balance', 'billing')):
        return False
    return status == 429 or any(value in text for value in ('overload', 'busy', 'temporarily', 'service_unavailable', 'capacity'))


class CompatibleImageClient:
    """Synchronous OpenAI/Gemini calls normalized to the workbench task contract.

    A timed-out POST is never automatically resubmitted: these providers do not
    document durable idempotency or a task lookup API.
    """
    manages_submission_retries = True
    def __init__(self, api_key, *, provider, model, base_url, transport=None, protocol=None):
        self.api_key, self.provider, self.model = api_key, provider, model
        self.base_url = base_url.rstrip('/')
        self.transport = transport or _compatible_transport
        self.protocol = protocol or ("gemini" if model.startswith("gemini-") else "openai")

    def create_task(self, payload, *, idempotency_key='', timeout=240, request_retries=3, retry_delay_seconds=1.0, sleep_fn=time.sleep, **kwargs):
        from core.execution_checkpoint import check_execution
        check_execution()
        headers = {'Content-Type': 'application/json'}
        images = payload.get('image') or []
        if isinstance(images, str): images = [images]
        if self.protocol == 'gemini':
            if payload.get('mask'):
                raise RejectedOneXMImageError('Nano Banana 不支持独立蒙版参数，请通过提示词和参考图编辑')
            headers['x-goog-api-key'] = self.api_key
            parts = [{'text': payload.get('prompt', '')}]
            for value in images:
                mime, data = _image_bytes(value)
                parts.append({'inlineData': {'mimeType': mime, 'data': base64.b64encode(data).decode()}})
            ratio = payload.get('ratio') or payload.get('size') or '1:1'
            if not re.fullmatch(r'\d+:\d+', ratio):
                match = re.fullmatch(r'(\d+)x(\d+)', ratio)
                if match:
                    from math import gcd
                    w, h = map(int, match.groups()); d = gcd(w, h); ratio = f'{w//d}:{h//d}'
                else: ratio = '1:1'
            resolution = str(payload.get('resolution') or payload.get('quality') or '1K').upper()
            if resolution not in {'1K', '2K', '4K'}: resolution = '1K'
            body = {'contents': [{'parts': parts}], 'generationConfig': {'responseModalities': ['TEXT', 'IMAGE'], 'imageConfig': {'aspectRatio': ratio, 'imageSize': resolution}}}
            url = re.sub(r'/models/[^/]+:generateContent$', '', self.base_url) + f'/models/{self.model}:generateContent'
        else:
            headers['Authorization'] = 'Bearer ' + self.api_key
            body = {k: v for k, v in payload.items() if k in {'prompt', 'size', 'quality', 'n', 'output_format', 'image', 'mask', 'background', 'output_compression'}}
            body['model'] = self.model
            endpoint = 'edits' if images else 'generations'
            url = re.sub(r'/images/(?:generations|edits)$', '', self.base_url) + '/images/' + endpoint
            if images: body, headers['Content-Type'] = _multipart(body)
        retry_history = []
        attempts = max(1, min(3, int(request_retries or 1)))
        for attempt in range(1, attempts + 1):
            check_execution()
            with _provider_submission_slot(self.provider):
                check_execution()
                status, result = self.transport('POST', url, headers=headers, body=body, timeout=max(240, timeout))
            if not isinstance(result, dict):
                raise RejectedOneXMImageError('供应商返回了无效的 JSON 响应')
            if not _retryable_rejection(status, result) or attempt >= attempts:
                break
            delay = max(0, retry_delay_seconds) * (2 ** (attempt - 1))
            retry_history.append({'attempt': attempt, 'http_status': status, 'delay_seconds': delay})
            sleep_fn(delay)

        if not 200 <= status < 300 or result.get('error'):
            error = result.get('error') or result.get('message') or f'HTTP {status}'
            if status in {502, 504}:
                # A gateway can lose the upstream response after generation began.
                # Its HTTP response is not proof that the provider rejected work.
                raise OneXMImageError(f'网关 HTTP {status}，无法确认上游是否已受理')
            failure = RejectedOneXMImageError(str(error).replace(self.api_key, '[redacted]'))
            failure.submission_attempts = attempt
            failure.submission_retry_history = retry_history
            raise failure
        urls = []
        mime = 'image/' + str(payload.get('output_format') or 'png')
        for item in result.get('data') or []:
            if item.get('b64_json'): urls.append(f'data:{mime};base64,{item["b64_json"]}')
            elif item.get('url'): urls.append(item['url'])
        for candidate in result.get('candidates') or []:
            for part in candidate.get('content', {}).get('parts', []):
                inline = part.get('inlineData') or part.get('inline_data') or {}
                if inline.get('data'):
                    urls.append(f'data:{inline.get("mimeType") or inline.get("mime_type") or "image/png"};base64,{inline["data"]}')
        if not urls:
            raise RejectedOneXMImageError('供应商响应未包含图片：' + json.dumps({k: result.get(k) for k in ('promptFeedback', 'error', 'message') if result.get(k)}, ensure_ascii=False)[:300])
        return {'status': 'completed', 'data': [{'url': url} for url in urls], 'submission_attempts': attempt, 'submission_retry_history': retry_history}

    def get_task(self, *args, **kwargs):
        raise OneXMImageError('该供应商使用同步生图接口，没有异步任务查询接口')
