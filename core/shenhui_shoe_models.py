"""Ordered transport fallback shared by the calls in one shoe batch.

A valid negative visual verdict is returned unchanged. This layer never asks
another model to overrule an image-quality rejection.
"""
from __future__ import annotations

import threading
import time
import re
from contextvars import ContextVar
from urllib.parse import urlsplit

from core import llm_gateway as gateway

DEFAULT_EXECUTION_MODELS = (
    'deepseek-official-flash', 'gpt-6-astra',
)
DEFAULT_BOARD_REVIEW_MODEL = 'gpt-6-astra'
REQUEST_METADATA = ContextVar('shoe_request_metadata', default={})


def execution_models(value=None):
    if value is None:
        return list(DEFAULT_EXECUTION_MODELS)
    values = value.split(',') if isinstance(value, str) else list(value)
    result = list(dict.fromkeys(str(v).strip() for v in values if str(v).strip()))
    if not result or any(v not in gateway.SUPPORTED_MODELS for v in result):
        raise gateway.LlmConfigurationError('鞋品执行模型顺序为空或含不支持的模型')
    return result


def reasoning_effort_for(model, metadata=None):
    if model == 'gpt-6-astra':
        return 'low'
    if model in gateway.DEEPSEEK_OFFICIAL_MODELS and (metadata or {}).get('stage') == 'export_review':
        if (metadata or {}).get('request_purpose') == 'source_fact_guard':
            return 'high'
        return 'low'
    return None


def stream_request(route, system_prompt, user_prompt, image_references, *, timeout_seconds=None, progress=None):
    report_progress = (lambda state: progress({**state, 'model_id':route.model_id})) if progress else None
    return gateway._generic_openai_json_request(
        route, system_prompt, user_prompt, image_references,
        timeout_seconds=timeout_seconds, stream=True, progress=report_progress,
        reasoning_effort=REQUEST_METADATA.get().get('requested_reasoning_effort') or (
            'low' if route.model_id == 'gpt-6-astra' else None),
    )


class ShoeModelState:
    def __init__(self, clock=time.monotonic, cooldown_seconds=120, request_workers=8, board_review_model_id=None):
        self.board_review_model_id = (DEFAULT_BOARD_REVIEW_MODEL if board_review_model_id is None
                                      else str(board_review_model_id).strip())
        if self.board_review_model_id and self.board_review_model_id not in gateway.SUPPORTED_MODELS:
            raise gateway.LlmConfigurationError('不支持的姿势看板审核模型')
        self.clock = clock
        self.cooldown_seconds = cooldown_seconds
        self.lock = threading.Lock()
        self.models = {}
        self.hosts = {}
        self.inactivity_failures = {}
        self.recoverable_models = set()
        self.request_workers = min(32, max(1, int(request_workers)))
        self.requests = threading.BoundedSemaphore(self.request_workers)
        self.image_work = threading.BoundedSemaphore(2)
        self.mask_ocr_lock = threading.Lock()
        self.mask_ocr_cache = {}
        self.source_review_cache = {}

    def unavailable(self, model, route):
        with self.lock:
            now = self.clock()
            host = urlsplit(route.base_url).netloc
            return self.models.get(model, 0) > now or self.hosts.get(host, 0) > now

    def failed(self, model, route, error):
        # A malformed answer is local to this request. The provider returned a
        # response, so it must not redirect unrelated styles for 120 seconds.
        if isinstance(error, gateway.LlmResponseError):
            return
        # A model-specific 503 does not prove every Semir model is down.
        # DNS/TLS/connect failures do indicate a shared gateway connection fault.
        message = str(error).lower()
        host_failure = any(f'curl退出码{code}' in message for code in (5, 6, 7, 35, 60))
        with self.lock:
            now = self.clock()
            inactivity = ('连续' in message and '没有有效' in message) or 'inactivity timeout' in message
            if inactivity:
                count, previous = self.inactivity_failures.get(model, (0, now))
                count = count + 1 if now - previous < self.cooldown_seconds else 1
                self.inactivity_failures[model] = (count, now)
                # One slow stream is not evidence that all other styles must
                # abandon a provider which is still answering their requests.
                if count < 2:
                    return
            until = now + self.cooldown_seconds
            self.models[model] = until
            if not re.search(r'\bhttp\s*(?:401|402|403|429)\b', message):
                self.recoverable_models.add(model)
            else:
                self.recoverable_models.discard(model)
            if host_failure:
                self.hosts[urlsplit(route.base_url).netloc] = until

    def succeeded(self, model, route):
        with self.lock:
            self.inactivity_failures.pop(model, None)
            if model in self.recoverable_models:
                self.models.pop(model, None)
                self.recoverable_models.discard(model)
            # A live response proves that the connection is usable again.
            # Model-specific authentication/rate-limit cooldowns stay intact.
            self.hosts.pop(urlsplit(getattr(route, 'base_url', '')).netloc, None)


def generate_json(*, models, state=None, log=None, retry_delays=(1, 3), sleep=time.sleep, request_metadata=None, **kwargs):
    """Try the configured order once; report the route that really succeeded."""
    ordered = list(dict.fromkeys(model for model in models if model))
    direct_single = state is None and len(ordered) == 1
    state = state or ShoeModelState()
    def invoke(model):
        for attempt in range(len(retry_delays) + 1):
            try:
                with state.requests:
                    token = REQUEST_METADATA.set({**(request_metadata or {}),
                        'requested_reasoning_effort': reasoning_effort_for(model, request_metadata),
                        'transport_reason': 'http_retry' if attempt else (
                            'transport_fallback' if model != ordered[0] else 'configured_primary'),
                        'transport_primary_model': ordered[0], 'transport_attempt': attempt + 1})
                    try:
                        response = gateway.generate_multimodal_json(
                            **kwargs, model_id=model, fallback_model_ids=[], retry_same_model=False,
                        )
                        state.succeeded(model, response[1])
                        return response
                    finally:
                        REQUEST_METADATA.reset(token)
            except gateway.LlmGatewayError as error:
                if not re.search(r'\bHTTP\s*(?:502|503|504)\b', str(error), re.IGNORECASE) or attempt >= len(retry_delays):
                    raise
                delay = retry_delays[attempt]
                if log:
                    log(f'模型临时错误：{model} · {error}；{delay:g}秒后自动重试 {attempt + 1}/{len(retry_delays)}')
                sleep(delay)
    if direct_single:
        return invoke(ordered[0])
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
