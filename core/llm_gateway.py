"""Config-backed multimodal LLM gateway for adapter post-processing."""
from __future__ import annotations

import base64
import json
import mimetypes
import re
from dataclasses import dataclass
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from core.config import load_config


OVERSEAS_OPENAI_BASE_URL = "https://ai-aigw.semir.com/overseas-openai-vip/v1"
OVERSEAS_ANTHROPIC_BASE_URL = "https://ai-aigw.semir.com/overseas-anthropic-vip"
DOMESTIC_OPENAI_BASE_URL = "https://ai-aigw.semir.com/bailian-codingplan/v1"

OVERSEAS_OPENAI_MODELS = (
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gemini-3.1-pro-preview",
    "gemini-3.5-flash",
)
OVERSEAS_ANTHROPIC_MODELS = (
    "claude-opus-4-8",
    "claude-sonnet-5",
)
DOMESTIC_OPENAI_MODELS = (
    "qwen3.8-max-preview",
    "qwen3.7-plus",
    "deepseek-v4-pro",
    "glm-5.2",
    "kimi-k2.7-code",
)
SUPPORTED_MODELS = (
    *OVERSEAS_OPENAI_MODELS,
    *OVERSEAS_ANTHROPIC_MODELS,
    *DOMESTIC_OPENAI_MODELS,
)
DEFAULT_MODEL = "gpt-5.6-terra"

VIDEO_COPY_SYSTEM_PROMPT = """你是一个电商信息流的资深运营。你要为童装或童鞋商品编写小红书卖货视频文案。
只能依据商品标题和提供的商品主图，不要虚构图片中无法确认的材质、功能、认证或使用效果。
每个方案必须遵循：开头精准框定人群；按重要程度说明主卖点和次卖点；结尾再次框选人群并促成行动。
不要写价格、折扣、优惠券、满减、赠品、包邮、秒杀等价格或促销利益点。
视频标题不超过30个汉字；视频描述适合约30秒口播，建议60到220个字符。
只返回 JSON，不要返回 Markdown。JSON 格式固定为：
{"scripts":[{"video_title":"...","video_description":"..."},{"video_title":"...","video_description":"..."},{"video_title":"...","video_description":"..."}]}"""

_PROMOTION_PATTERN = re.compile(
    r"(?:[¥￥$]\s*\d|\d+(?:\.\d+)?\s*元|价格|优惠|折扣|满减|立减|领券|券后|"
    r"到手价|包邮|赠品|买一赠一|福利价|秒杀|特价)",
    re.IGNORECASE,
)


class LlmGatewayError(RuntimeError):
    """Safe, user-displayable gateway error."""


class LlmConfigurationError(LlmGatewayError):
    """Raised when the local LLM settings are incomplete."""


class LlmResponseError(LlmGatewayError):
    """Raised when a model response cannot satisfy the output contract."""


@dataclass(frozen=True)
class LlmRoute:
    model_id: str
    protocol: str
    base_url: str
    api_key: str


def _compact(value: Any) -> str:
    return str(value or "").strip()


def _nested(source: dict, *keys: str) -> Any:
    value: Any = source
    for key in keys:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def route_for_model(model_id: str, config: dict | None = None) -> LlmRoute:
    cfg = config if isinstance(config, dict) else load_config()
    llm = _nested(cfg, "ai", "llm")
    llm = llm if isinstance(llm, dict) else {}
    selected = _compact(model_id) or _compact(llm.get("default_model")) or DEFAULT_MODEL
    if selected not in SUPPORTED_MODELS:
        raise LlmConfigurationError(f"不支持的文本模型：{selected}")

    api_key = _compact(llm.get("api_key"))
    if not api_key:
        raise LlmConfigurationError("请先在设置 → AI 能力 → 文本大模型中配置 API Key")

    if selected in OVERSEAS_ANTHROPIC_MODELS:
        return LlmRoute(
            model_id=selected,
            protocol="anthropic",
            base_url=_compact(llm.get("overseas_anthropic_base_url")) or OVERSEAS_ANTHROPIC_BASE_URL,
            api_key=api_key,
        )
    if selected in DOMESTIC_OPENAI_MODELS:
        return LlmRoute(
            model_id=selected,
            protocol="openai",
            base_url=_compact(llm.get("domestic_base_url")) or DOMESTIC_OPENAI_BASE_URL,
            api_key=api_key,
        )
    return LlmRoute(
        model_id=selected,
        protocol="openai",
        base_url=_compact(llm.get("overseas_openai_base_url")) or OVERSEAS_OPENAI_BASE_URL,
        api_key=api_key,
    )


def _endpoint(base_url: str, suffix: str) -> str:
    base = _compact(base_url).rstrip("/")
    if not base:
        raise LlmConfigurationError("文本模型 Base URL 不能为空")
    if base.endswith(suffix):
        return base
    return f"{base}/{suffix.lstrip('/')}"


def _anthropic_endpoint(base_url: str) -> str:
    base = _compact(base_url).rstrip("/")
    if base.endswith("/messages"):
        return base
    if base.endswith("/v1"):
        return f"{base}/messages"
    return f"{base}/v1/messages"


def _post_json(url: str, payload: dict, headers: dict[str, str], timeout: int = 120) -> dict:
    secret_values = [
        value
        for header_value in headers.values()
        for value in (str(header_value or ""), str(header_value or "").removeprefix("Bearer ").strip())
        if value
    ]

    def safe(value: Any) -> str:
        text = str(value or "")
        for secret in secret_values:
            text = text.replace(secret, "[REDACTED]")
        return text

    request = Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise LlmGatewayError(f"文本模型接口返回 HTTP {exc.code}：{safe(raw)[:300]}") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise LlmGatewayError(f"文本模型接口连接失败：{safe(exc)}") from exc
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise LlmGatewayError("文本模型接口未返回有效 JSON") from exc
    if not isinstance(parsed, dict):
        raise LlmGatewayError("文本模型接口返回格式异常")
    return parsed


def _normalize_image_url(value: Any) -> str:
    url = _compact(value)
    if url.startswith("//"):
        url = f"https:{url}"
    return url


def _download_image_data(url: str, timeout: int = 30, max_bytes: int = 10 * 1024 * 1024) -> tuple[str, str]:
    normalized = _normalize_image_url(url)
    if not normalized:
        raise LlmGatewayError("商品主图地址为空")
    request = Request(normalized, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urlopen(request, timeout=timeout) as response:
            content_type = _compact(response.headers.get_content_type()) or ""
            data = response.read(max_bytes + 1)
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        raise LlmGatewayError(f"读取商品主图失败：{exc}") from exc
    if len(data) > max_bytes:
        raise LlmGatewayError("商品主图超过 10MB，无法发送给文本模型")
    if not content_type.startswith("image/"):
        guessed = mimetypes.guess_type(normalized.split("?", 1)[0])[0] or "image/jpeg"
        content_type = guessed if guessed.startswith("image/") else "image/jpeg"
    return content_type, base64.b64encode(data).decode("ascii")


def _user_prompt(product_title: str, correction: str = "") -> str:
    prompt = (
        f"商品标题：{_compact(product_title)}\n"
        "请结合随消息提供的最多5张商品主图，生成3个彼此有明显角度差异的视频方案。"
    )
    if correction:
        prompt += f"\n上一次输出未通过校验，请完整重写3个方案并修正：{correction}"
    return prompt


def _openai_request(route: LlmRoute, product_title: str, image_urls: list[str], correction: str) -> dict:
    content: list[dict[str, Any]] = [{"type": "text", "text": _user_prompt(product_title, correction)}]
    content.extend({
        "type": "image_url",
        "image_url": {"url": _normalize_image_url(url), "detail": "high"},
    } for url in image_urls if _normalize_image_url(url))
    payload = {
        "model": route.model_id,
        "messages": [
            {"role": "system", "content": VIDEO_COPY_SYSTEM_PROMPT},
            {"role": "user", "content": content},
        ],
    }
    return _post_json(
        _endpoint(route.base_url, "chat/completions"),
        payload,
        {"Authorization": f"Bearer {route.api_key}"},
    )


def _anthropic_request(route: LlmRoute, product_title: str, image_urls: list[str], correction: str) -> dict:
    content: list[dict[str, Any]] = [{"type": "text", "text": _user_prompt(product_title, correction)}]
    for image_url in image_urls:
        media_type, encoded = _download_image_data(image_url)
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": encoded},
        })
    payload = {
        "model": route.model_id,
        "max_tokens": 1800,
        "system": VIDEO_COPY_SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": content}],
    }
    return _post_json(
        _anthropic_endpoint(route.base_url),
        payload,
        {"x-api-key": route.api_key, "anthropic-version": "2023-06-01"},
    )


def _response_text(payload: dict) -> str:
    choices = payload.get("choices")
    if isinstance(choices, list) and choices:
        content = _nested(choices[0] if isinstance(choices[0], dict) else {}, "message", "content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return "".join(_compact(item.get("text")) for item in content if isinstance(item, dict))
    content = payload.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(_compact(item.get("text")) for item in content if isinstance(item, dict))
    raise LlmResponseError("文本模型响应缺少可读取内容")


def _parse_json_text(value: str) -> Any:
    text = _compact(value)
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        starts = [index for index in (text.find("{"), text.find("[")) if index >= 0]
        if not starts:
            raise LlmResponseError("文本模型未返回 JSON")
        start = min(starts)
        end = max(text.rfind("}"), text.rfind("]"))
        if end <= start:
            raise LlmResponseError("文本模型返回的 JSON 不完整")
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError as exc:
            raise LlmResponseError("文本模型返回的 JSON 无法解析") from exc


def normalize_video_copies(payload: Any) -> list[dict[str, str]]:
    if isinstance(payload, dict):
        rows = payload.get("scripts")
    else:
        rows = payload
    if not isinstance(rows, list) or len(rows) != 3:
        raise LlmResponseError("必须返回且仅返回3个视频方案")

    normalized: list[dict[str, str]] = []
    errors: list[str] = []
    seen = set()
    for index, item in enumerate(rows, start=1):
        if not isinstance(item, dict):
            errors.append(f"第{index}个方案不是对象")
            continue
        title = re.sub(r"\s+", " ", _compact(item.get("video_title") or item.get("title")))
        description = re.sub(
            r"\s+",
            " ",
            _compact(item.get("video_description") or item.get("description") or item.get("copy")),
        )
        if not title:
            errors.append(f"第{index}个视频标题为空")
        elif len(title) > 30:
            errors.append(f"第{index}个视频标题超过30字")
        if not description:
            errors.append(f"第{index}个视频描述为空")
        elif not 60 <= len(description) <= 220:
            errors.append(f"第{index}个视频描述应为60到220字")
        if _PROMOTION_PATTERN.search(f"{title} {description}"):
            errors.append(f"第{index}个方案包含价格或促销利益点")
        key = (title, description)
        if key in seen:
            errors.append(f"第{index}个方案与其他方案重复")
        seen.add(key)
        normalized.append({"video_title": title, "video_description": description})
    if errors:
        raise LlmResponseError("；".join(errors))
    return normalized


def generate_video_copies(
    *,
    product_title: str,
    image_urls: list[str],
    model_id: str = "",
    config: dict | None = None,
    request_openai: Callable[[LlmRoute, str, list[str], str], dict] = _openai_request,
    request_anthropic: Callable[[LlmRoute, str, list[str], str], dict] = _anthropic_request,
) -> tuple[list[dict[str, str]], LlmRoute]:
    title = _compact(product_title)
    images = [_normalize_image_url(item) for item in image_urls if _normalize_image_url(item)][:5]
    if not title:
        raise LlmResponseError("商品标题为空，无法生成视频文案")
    if not images:
        raise LlmResponseError("未读取到商品主图，无法生成视频文案")

    route = route_for_model(model_id, config=config)
    correction = ""
    for attempt in range(2):
        response = (
            request_anthropic(route, title, images, correction)
            if route.protocol == "anthropic"
            else request_openai(route, title, images, correction)
        )
        try:
            return normalize_video_copies(_parse_json_text(_response_text(response))), route
        except LlmResponseError as exc:
            if attempt:
                raise
            correction = str(exc)
    raise LlmResponseError("文本模型输出未通过校验")
