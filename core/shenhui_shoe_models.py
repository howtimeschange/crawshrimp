"""Ordered transport fallback shared by the calls in one shoe batch.

A valid negative visual verdict is returned unchanged. This layer never asks
another model to overrule an image-quality rejection.
"""
from __future__ import annotations

import threading
import time
import re
from urllib.parse import urlsplit

from core import llm_gateway as gateway

DEFAULT_EXECUTION_MODELS = (
    'gpt-6-astra', 'deepseek-official-flash', 'gpt-5.6-terra', 'deepseek-v4.1-flash',
)


def execution_models(value=None):
    if value is None:
        return list(DEFAULT_EXECUTION_MODELS)
    values = value.split(',') if isinstance(value, str) else list(value)
    result = list(dict.fromkeys(str(v).strip() for v in values if str(v).strip()))
    if not result or any(v not in gateway.SUPPORTED_MODELS for v in result):
        raise gateway.LlmConfigurationError('鞋品执行模型顺序为空或含不支持的模型')
    return result


def stream_request(route, system_prompt, user_prompt, image_references, *, timeout_seconds=None, progress=None):
    return gateway._generic_openai_json_request(
        route, system_prompt, user_prompt, image_references,
        timeout_seconds=timeout_seconds, stream=True, progress=progress,
        reasoning_effort='low' if route.model_id == 'gpt-6-astra' else None,
    )


class ShoeModelState:
    def __init__(self, clock=time.monotonic, cooldown_seconds=120):
        self.clock = clock
        self.cooldown_seconds = cooldown_seconds
        self.lock = threading.Lock()
        self.models = {}
        self.hosts = {}

    def unavailable(self, model, route):
        with self.lock:
            now = self.clock()
            host = urlsplit(route.base_url).netloc
            return self.models.get(model, 0) > now or self.hosts.get(host, 0) > now

    def failed(self, model, route, error):
        # A model-specific 503 does not prove every Semir model is down.
        # DNS/TLS/connect failures do indicate a shared gateway connection fault.
        message = str(error).lower()
        host_failure = any(f'curl退出码{code}' in message for code in (5, 6, 7, 35, 60))
        with self.lock:
            until = self.clock() + self.cooldown_seconds
            self.models[model] = until
            if host_failure:
                self.hosts[urlsplit(route.base_url).netloc] = until


def generate_json(*, models, state=None, log=None, retry_delays=(1, 3), sleep=time.sleep, **kwargs):
    """Try the configured order once; report the route that really succeeded."""
    ordered = list(dict.fromkeys(model for model in models if model))
    def invoke(model):
        for attempt in range(len(retry_delays) + 1):
            try:
                return gateway.generate_multimodal_json(
                    **kwargs, model_id=model, fallback_model_ids=[], retry_same_model=False,
                )
            except gateway.LlmGatewayError as error:
                if not re.search(r'\bHTTP\s*(?:502|503|504)\b', str(error), re.IGNORECASE) or attempt >= len(retry_delays):
                    raise
                delay = retry_delays[attempt]
                if log:
                    log(f'模型临时错误：{model} · {error}；{delay:g}秒后自动重试 {attempt + 1}/{len(retry_delays)}')
                sleep(delay)
    if state is None and len(ordered) == 1:
        return invoke(ordered[0])
    state = state or ShoeModelState()
    failures = []
    for model in ordered:
        try:
            route = gateway.route_for_model(model, kwargs.get('config'))
        except gateway.LlmConfigurationError:
            failures.append(f'{model} 未配置')
            if log:
                log(f'模型路径跳过：{model} 未配置')
            continue
        if state.unavailable(model, route):
            failures.append(f'{model} 故障冷却中')
            if log:
                log(f'模型路径跳过：{model} 故障冷却中')
            continue
        if log:
            log(f'模型执行路径：{model}')
        try:
            return invoke(model)
        except gateway.LlmGatewayError as error:
            state.failed(model, route, error)
            failures.append(f'{model}: {error}')
            if log:
                log(f'模型请求失败，按配置顺序切换：{model} · {error}')
    raise gateway.LlmGatewayError('本次模型路径均不可用：'+'；'.join(failures))
