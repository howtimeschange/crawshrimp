"""Config-backed multimodal LLM gateway for adapter post-processing."""
from __future__ import annotations

import base64
import inspect
import json
import mimetypes
import os
import re
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from core.config import load_config


OVERSEAS_OPENAI_BASE_URL = "https://ai-aigw.semir.com/overseas-openai-vip/v1"
OVERSEAS_ANTHROPIC_BASE_URL = "https://ai-aigw.semir.com/overseas-anthropic-vip"
DOMESTIC_OPENAI_BASE_URL = "https://ai-aigw.semir.com/bailian-codingplan/v1"
DEEPSEEK_OFFICIAL_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_OFFICIAL_MODELS = (
    "deepseek-official-v4-flash",
    "deepseek-official-v4-pro",
    "deepseek-official-v4-flash-vision-exp",
)
_DEEPSEEK_OFFICIAL_REAL_MODELS = {
    "deepseek-official-v4-flash": "deepseek-v4-flash",
    "deepseek-official-v4-pro": "deepseek-v4-pro",
    "deepseek-official-v4-flash-vision-exp": "deepseek-v4-flash-vision-exp",
}


def deepseek_official_real_model(model_id: str) -> str:
    return _DEEPSEEK_OFFICIAL_REAL_MODELS.get(model_id, model_id)

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
    "deepseek-v4-flash",
    "deepseek-v4-pro",
    "glm-5.2",
    "kimi-k2.7-code",
)
SUPPORTED_MODELS = (
    *OVERSEAS_OPENAI_MODELS,
    *OVERSEAS_ANTHROPIC_MODELS,
    *DOMESTIC_OPENAI_MODELS,
    *DEEPSEEK_OFFICIAL_MODELS,
)
DEFAULT_MODEL = "gemini-3.5-flash"
GATEWAY_FALLBACK_MODEL = "gpt-5.6-terra"
GUANG_TITLE_MIN_CHARS = 24
GUANG_TITLE_MAX_CHARS = 30
RECOMMEND_TITLE_MIN_CHARS = 16
RECOMMEND_TITLE_MAX_CHARS = 20
BALA_VIDEO_PROMPT_DEFAULT_MODEL = "gemini-3.5-flash"
BALA_VIDEO_PROMPT_DEEPSEEK_VISION_MODELS = (
    "deepseek-official-v4-flash-vision-exp",
)
BALA_VIDEO_PROMPT_GATEWAY_VISION_MODELS = (
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "claude-sonnet-5",
    "gemini-3.1-pro-preview",
    "gemini-3.5-flash",
    "qwen3.8-max-preview",
    "qwen3.7-plus",
    "glm-5.2",
)
BALA_VIDEO_PROMPT_MODELS = (
    *BALA_VIDEO_PROMPT_DEEPSEEK_VISION_MODELS,
    *BALA_VIDEO_PROMPT_GATEWAY_VISION_MODELS,
)

VIDEO_COPY_SYSTEM_PROMPT = """你是一个小红书童装穿搭账号的资深短视频运营。你要为童装或童鞋商品编写像真实妈妈/店主分享的种草视频标题和文案。
只能依据商品标题和提供的商品主图，不要虚构图片中无法确认的材质、功能、认证或使用效果。
整体风格参考：听我一句、谁懂啊、女儿/儿子的初秋穿搭、OOTD、秋天的氛围感、可爱/韩系/复古/运动风、入秋必备。表达要更口语、更短视频、更像小红书笔记，不要硬广腔。
每个方案必须遵循：标题先给情绪钩子或场景钩子；口播开头精准框定人群；按重要程度说明图片能看出的主卖点和次卖点；结尾再次框选人群并促成行动。
不要写价格、折扣、优惠券、满减、赠品、包邮、秒杀等价格或促销利益点。
每个方案要生成两个标题：逛逛标题必须24到30个字符，优先接近30字；搜推标题必须16到20个字符，优先接近20字。
标题可以自然使用0到2个emoji，例如🍂🎀📣✨，但不要堆砌；标题不要使用空格，不要为了凑字加入图片和商品标题无法支撑的材质、功能或效果。
视频描述适合约30秒口播，建议60到220个字符。
只返回 JSON，不要返回 Markdown。JSON 格式固定为：
{"scripts":[{"guang_title":"...","recommend_title":"...","video_description":"..."},{"guang_title":"...","recommend_title":"...","video_description":"..."},{"guang_title":"...","recommend_title":"...","video_description":"..."}]}"""

BALA_VIDEO_PROMPT_TEMPLATE = (
    "帮我根据图 1-5 的模拍图写一个外景的视频生成提示词，要抖音和小红书爆款种草视频 20 秒左右，"
    "严格按照图片 1-5 模特和穿搭的衣服颜色生成，要换 5 个场景，还需要近距离展示衣服下摆设计和面料，"
    "人物可以稍微活泼一点，但是不要畸变"
)

BALA_VIDEO_PROMPT_SYSTEM_PROMPT = """你是童装短视频生成 Prompt 专家。请根据用户提供的模拍图，为图生视频模型写一条可直接粘贴使用的中文视频生成提示词。
必须只依据图片中能确认的模特形象、穿搭、服装颜色、图案、配饰和面料特征，不要编造图片看不出的卖点。
输出要适合抖音和小红书爆款种草视频，竖屏 9:16，约 20 秒，高清写实，外景自然光。
按实际提供的图片数量编排分镜；每张图至少对应一个外景场景，最多使用图 1-5。若不足 5 张图，也要保持场景之间有明显变化。
每个场景都要包含人物动作、镜头运动，并安排下摆设计和面料肌理近距离特写。
要明确约束全程不畸变、不手脚扭曲、不五官崩坏、不衣服颜色改变、不条纹/印花错乱、不水印、不文字。
只返回最终 Prompt 文本，不要返回 Markdown、解释、标题或 JSON。"""

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


def _llm_settings(config: dict | None = None) -> dict:
    cfg = config if isinstance(config, dict) else load_config()
    llm = _nested(cfg, "ai", "llm")
    return llm if isinstance(llm, dict) else {}


def gateway_api_key_configured(config: dict | None = None) -> bool:
    llm = _llm_settings(config)
    return bool(_compact(os.environ.get("CRAWSHRIMP_LLM_API_KEY")) or _compact(llm.get("api_key")))


def deepseek_api_key_configured(config: dict | None = None) -> bool:
    llm = _llm_settings(config)
    return bool(
        _compact(os.environ.get("CRAWSHRIMP_DEEPSEEK_API_KEY"))
        or _compact(llm.get("deepseek_api_key"))
    )


def model_has_configured_key(model_id: str, config: dict | None = None) -> bool:
    selected = _compact(model_id)
    if selected in DEEPSEEK_OFFICIAL_MODELS:
        return deepseek_api_key_configured(config)
    if (
        selected in OVERSEAS_OPENAI_MODELS
        or selected in OVERSEAS_ANTHROPIC_MODELS
        or selected in DOMESTIC_OPENAI_MODELS
    ):
        return gateway_api_key_configured(config)
    return False


def select_default_model(config: dict | None = None) -> str:
    cfg = config if isinstance(config, dict) else load_config()
    llm = _llm_settings(cfg)
    configured = _compact(llm.get("default_model")) or DEFAULT_MODEL
    if configured not in SUPPORTED_MODELS:
        configured = DEFAULT_MODEL
    if model_has_configured_key(configured, cfg):
        return configured
    for candidate in (DEFAULT_MODEL, GATEWAY_FALLBACK_MODEL):
        if candidate != configured and model_has_configured_key(candidate, cfg):
            return candidate
    return configured


def route_for_model(model_id: str, config: dict | None = None) -> LlmRoute:
    cfg = config if isinstance(config, dict) else load_config()
    llm = _llm_settings(cfg)
    selected = _compact(model_id) or select_default_model(cfg)
    if selected not in SUPPORTED_MODELS:
        raise LlmConfigurationError(f"不支持的文本模型：{selected}")

    if selected in DEEPSEEK_OFFICIAL_MODELS:
        api_key = (
            _compact(os.environ.get("CRAWSHRIMP_DEEPSEEK_API_KEY"))
            or _compact(llm.get("deepseek_api_key"))
        )
        if not api_key:
            raise LlmConfigurationError("DeepSeek 官方模型需要独立 API Key，请先在设置 → AI 能力 → 文本大模型中配置")
        return LlmRoute(
            model_id=deepseek_official_real_model(selected),
            protocol="openai",
            base_url=(
                _compact(os.environ.get("CRAWSHRIMP_DEEPSEEK_BASE_URL"))
                or _compact(llm.get("deepseek_base_url"))
                or DEEPSEEK_OFFICIAL_BASE_URL
            ),
            api_key=api_key,
        )

    api_key = _compact(os.environ.get("CRAWSHRIMP_LLM_API_KEY")) or _compact(llm.get("api_key"))
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


def _post_json(
    url: str,
    payload: dict,
    headers: dict[str, str],
    timeout: float = 120,
    total_timeout: float | None = None,
) -> dict:
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

    if total_timeout is None:
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
    else:
        curl = shutil.which("curl")
        if not curl:
            raise LlmGatewayError("文本模型接口连接失败：未找到 curl，无法执行总时长限制")
        payload_path = ""
        header_path = ""
        response_path = ""
        try:
            with tempfile.NamedTemporaryFile(prefix="crawshrimp-llm-payload-", suffix=".json", delete=False) as handle:
                payload_path = handle.name
                handle.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
            with tempfile.NamedTemporaryFile(
                prefix="crawshrimp-llm-headers-",
                suffix=".txt",
                mode="w",
                encoding="utf-8",
                delete=False,
            ) as handle:
                header_path = handle.name
                for key, value in {"Content-Type": "application/json", **headers}.items():
                    handle.write(f"{key}: {value}\n")
            with tempfile.NamedTemporaryFile(prefix="crawshrimp-llm-response-", suffix=".json", delete=False) as handle:
                response_path = handle.name
            for path in (payload_path, header_path, response_path):
                os.chmod(path, 0o600)

            try:
                completed = subprocess.run(
                    [
                        curl,
                        "--silent",
                        "--show-error",
                        "--request",
                        "POST",
                        "--connect-timeout",
                        str(max(float(timeout), 0.001)),
                        "--max-time",
                        str(max(float(total_timeout), 0.001)),
                        "--header",
                        f"@{header_path}",
                        "--data-binary",
                        f"@{payload_path}",
                        "--output",
                        response_path,
                        "--write-out",
                        "%{http_code}",
                        url,
                    ],
                    capture_output=True,
                    text=True,
                    timeout=max(float(total_timeout), 0.001) + 5,
                    check=False,
                )
            except subprocess.TimeoutExpired as exc:
                raise LlmGatewayError(
                    f"文本模型接口连接失败：请求超过总时长 {float(total_timeout):g} 秒"
                ) from exc
            raw = Path(response_path).read_text(encoding="utf-8", errors="replace")
            if completed.returncode != 0:
                detail = safe(completed.stderr).strip()
                if completed.returncode == 28:
                    detail = f"请求超过总时长 {float(total_timeout):g} 秒"
                raise LlmGatewayError(f"文本模型接口连接失败：{detail or 'curl 请求失败'}")
            try:
                status_code = int(completed.stdout.strip() or "0")
            except ValueError:
                status_code = 0
            if status_code >= 400:
                raise LlmGatewayError(f"文本模型接口返回 HTTP {status_code}：{safe(raw)[:300]}")
        finally:
            for path in (payload_path, header_path, response_path):
                if path:
                    try:
                        os.unlink(path)
                    except OSError:
                        pass
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


def _multimodal_image_reference(value: Any, max_bytes: int = 10 * 1024 * 1024) -> str:
    reference = _normalize_image_url(value)
    if reference.startswith(("https://", "http://", "data:image/")):
        return reference
    path = Path(reference).expanduser()
    if not path.is_file():
        raise LlmGatewayError(f"本地图片不存在：{path}")
    size = path.stat().st_size
    if size > max_bytes:
        raise LlmGatewayError(f"本地图片超过 10MB：{path.name}")
    media_type = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    if not media_type.startswith("image/"):
        media_type = "image/jpeg"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{media_type};base64,{encoded}"


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


def _is_gemini_model(model_id: Any) -> bool:
    return _compact(model_id).lower().startswith("gemini-")


def _image_reference_for_openai_model(route: LlmRoute, value: Any) -> str:
    reference = _normalize_image_url(value)
    if not reference:
        return ""
    if not _is_gemini_model(route.model_id):
        return reference
    if reference.startswith("data:image/"):
        return reference
    if reference.startswith(("https://", "http://")):
        media_type, encoded = _download_image_data(reference)
        return f"data:{media_type};base64,{encoded}"
    return _multimodal_image_reference(reference)


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
        "image_url": {"url": reference, "detail": "high"},
    } for url in image_urls if (reference := _image_reference_for_openai_model(route, url)))
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


def _generic_openai_json_request(
    route: LlmRoute,
    system_prompt: str,
    user_prompt: str,
    image_references: list[str],
    *,
    timeout_seconds: float | None = None,
) -> dict:
    content: list[dict[str, Any]] = [{"type": "text", "text": _compact(user_prompt)}]
    content.extend({
        "type": "image_url",
        "image_url": {"url": model_reference, "detail": "high"},
    } for reference in image_references if (model_reference := _image_reference_for_openai_model(route, reference)))
    request_timeout = max(float(timeout_seconds or 240), 0.001)
    return _post_json(
        _endpoint(route.base_url, "chat/completions"),
        {
            "model": route.model_id,
            "messages": [
                {"role": "system", "content": _compact(system_prompt)},
                {"role": "user", "content": content},
            ],
        },
        {"Authorization": f"Bearer {route.api_key}"},
        timeout=min(request_timeout, 30),
        total_timeout=request_timeout,
    )


def _data_url_image(value: str) -> tuple[str, str] | None:
    match = re.match(r"^data:([^;,]+);base64,(.+)$", _compact(value), flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return None
    return match.group(1), re.sub(r"\s+", "", match.group(2))


def _anthropic_image_content(reference: str) -> dict[str, Any]:
    data_url = _data_url_image(reference)
    if data_url:
        media_type, encoded = data_url
    else:
        media_type, encoded = _download_image_data(reference)
    return {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": media_type if media_type.startswith("image/") else "image/jpeg",
            "data": encoded,
        },
    }


def _generic_anthropic_json_request(
    route: LlmRoute,
    system_prompt: str,
    user_prompt: str,
    image_references: list[str],
    *,
    timeout_seconds: float | None = None,
) -> dict:
    content: list[dict[str, Any]] = [{"type": "text", "text": _compact(user_prompt)}]
    content.extend(_anthropic_image_content(reference) for reference in image_references)
    request_timeout = max(float(timeout_seconds or 240), 0.001)
    return _post_json(
        _anthropic_endpoint(route.base_url),
        {
            "model": route.model_id,
            "max_tokens": 2000,
            "system": _compact(system_prompt),
            "messages": [{"role": "user", "content": content}],
        },
        {
            "x-api-key": route.api_key,
            "Authorization": f"Bearer {route.api_key}",
            "anthropic-version": "2023-06-01",
        },
        timeout=min(request_timeout, 30),
        total_timeout=request_timeout,
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
        {
            "x-api-key": route.api_key,
            "Authorization": f"Bearer {route.api_key}",
            "anthropic-version": "2023-06-01",
        },
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


def _is_retryable_llm_error(exc: LlmGatewayError) -> bool:
    if isinstance(exc, LlmConfigurationError):
        return False
    text = str(exc or "").lower()
    return (
        "连接失败" in text
        or "remote end closed" in text
        or "timed out" in text
        or "timeout" in text
        or "请求超过" in text
        or "http 429" in text
        or re.search(r"http 5\d\d", text, flags=re.IGNORECASE) is not None
    )


def _request_accepts_timeout_seconds(requester: Callable[..., dict]) -> bool:
    try:
        signature = inspect.signature(requester)
    except (TypeError, ValueError):
        return False
    for parameter in signature.parameters.values():
        if parameter.kind == inspect.Parameter.VAR_KEYWORD:
            return True
        if parameter.name == "timeout_seconds":
            return True
    return False


def _call_multimodal_request(
    requester: Callable[..., dict],
    route: LlmRoute,
    system_prompt: str,
    user_prompt: str,
    image_references: list[str],
    *,
    timeout_seconds: float | None = None,
) -> dict:
    if timeout_seconds is not None and _request_accepts_timeout_seconds(requester):
        return requester(
            route,
            system_prompt,
            user_prompt,
            image_references,
            timeout_seconds=timeout_seconds,
        )
    return requester(route, system_prompt, user_prompt, image_references)


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
        legacy_title = _compact(item.get("video_title") or item.get("title"))
        guang_title = re.sub(
            r"\s+",
            " ",
            _compact(item.get("guang_title") or item.get("guangguang_title") or item.get("逛逛标题") or legacy_title),
        )
        recommend_title = re.sub(
            r"\s+",
            " ",
            _compact(
                item.get("recommend_title")
                or item.get("search_recommend_title")
                or item.get("soutui_title")
                or item.get("搜推标题")
                or legacy_title
            ),
        )
        description = re.sub(
            r"\s+",
            " ",
            _compact(item.get("video_description") or item.get("description") or item.get("copy")),
        )
        if not guang_title:
            errors.append(f"第{index}个逛逛标题为空")
        elif len(guang_title) < GUANG_TITLE_MIN_CHARS:
            errors.append(f"第{index}个逛逛标题少于{GUANG_TITLE_MIN_CHARS}字符，没有接近30字符")
        elif len(guang_title) > GUANG_TITLE_MAX_CHARS:
            errors.append(f"第{index}个逛逛标题超过{GUANG_TITLE_MAX_CHARS}字符")
        if not recommend_title:
            errors.append(f"第{index}个搜推标题为空")
        elif len(recommend_title) < RECOMMEND_TITLE_MIN_CHARS:
            errors.append(f"第{index}个搜推标题少于{RECOMMEND_TITLE_MIN_CHARS}字符，没有接近20字符")
        elif len(recommend_title) > RECOMMEND_TITLE_MAX_CHARS:
            errors.append(f"第{index}个搜推标题超过{RECOMMEND_TITLE_MAX_CHARS}字符")
        if not description:
            errors.append(f"第{index}个视频描述为空")
        elif not 60 <= len(description) <= 220:
            errors.append(f"第{index}个视频描述应为60到220字")
        if _PROMOTION_PATTERN.search(f"{guang_title} {recommend_title} {description}"):
            errors.append(f"第{index}个方案包含价格或促销利益点")
        key = (guang_title, recommend_title, description)
        if key in seen:
            errors.append(f"第{index}个方案与其他方案重复")
        seen.add(key)
        normalized.append({
            "guang_title": guang_title,
            "recommend_title": recommend_title,
            "video_description": description,
        })
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
    retry_sleep: Callable[[float], None] = time.sleep,
) -> tuple[list[dict[str, str]], LlmRoute]:
    title = _compact(product_title)
    images = [_normalize_image_url(item) for item in image_urls if _normalize_image_url(item)][:5]
    if not title:
        raise LlmResponseError("商品标题为空，无法生成视频文案")
    if not images:
        raise LlmResponseError("未读取到商品主图，无法生成视频文案")

    route = route_for_model(model_id, config=config)
    correction = ""
    validation_attempt = 0
    max_validation_attempts = 2
    transport_attempt = 0
    max_transport_attempts = 3
    while validation_attempt < max_validation_attempts and transport_attempt < max_transport_attempts:
        try:
            response = (
                request_anthropic(route, title, images, correction)
                if route.protocol == "anthropic"
                else request_openai(route, title, images, correction)
            )
            transport_attempt = 0
        except LlmGatewayError as exc:
            transport_attempt += 1
            if transport_attempt >= max_transport_attempts or not _is_retryable_llm_error(exc):
                raise
            retry_sleep(min(2.0, float(transport_attempt)))
            continue
        try:
            return normalize_video_copies(_parse_json_text(_response_text(response))), route
        except LlmResponseError as exc:
            validation_attempt += 1
            if validation_attempt >= max_validation_attempts:
                raise
            correction = str(exc)
    raise LlmResponseError("文本模型输出未通过校验")


def generate_multimodal_json(
    *,
    system_prompt: str,
    user_prompt: str,
    image_inputs: list[str],
    model_id: str = "",
    fallback_model_ids: list[str] | None = None,
    config: dict | None = None,
    request_openai: Callable[[LlmRoute, str, str, list[str]], dict] = _generic_openai_json_request,
    request_anthropic: Callable[[LlmRoute, str, str, list[str]], dict] = _generic_anthropic_json_request,
    timeout_seconds: float | None = None,
    retry_same_model: bool = True,
) -> tuple[Any, LlmRoute]:
    """Call a multimodal route and parse its JSON response."""

    system = _compact(system_prompt)
    prompt = _compact(user_prompt)
    if not system:
        raise LlmResponseError("多模态识别系统提示词为空")
    if not prompt:
        raise LlmResponseError("多模态识别任务提示词为空")
    references = [
        _multimodal_image_reference(value)
        for value in image_inputs
        if _compact(value)
    ][:10]
    if not references:
        raise LlmResponseError("未提供可识别的图片")

    model_ids = [model_id, *(fallback_model_ids or [])]
    model_ids = list(dict.fromkeys(_compact(value) for value in model_ids if _compact(value)))
    if not model_ids:
        model_ids = [""]

    # A configured fallback replaces the same-model retry. Callers that manage
    # their own retry ladder can disable this implicit retry.
    attempts = (
        model_ids
        if len(model_ids) > 1 or not retry_same_model
        else [model_ids[0], model_ids[0]]
    )
    last_error: LlmGatewayError | None = None
    for attempt_index, current_model_id in enumerate(attempts):
        route = route_for_model(current_model_id, config=config)
        try:
            response = (
                _call_multimodal_request(
                    request_anthropic,
                    route,
                    system,
                    prompt,
                    references,
                    timeout_seconds=timeout_seconds,
                )
                if route.protocol == "anthropic"
                else _call_multimodal_request(
                    request_openai,
                    route,
                    system,
                    prompt,
                    references,
                    timeout_seconds=timeout_seconds,
                )
            )
            return _parse_json_text(_response_text(response)), route
        except LlmGatewayError as exc:
            last_error = exc
            retryable = _is_retryable_llm_error(exc)
            if attempt_index == len(attempts) - 1 or not retryable:
                raise
    raise last_error or LlmGatewayError("文本模型接口调用失败")


def generate_multimodal_text(
    *,
    system_prompt: str,
    user_prompt: str,
    image_inputs: list[str],
    model_id: str = "",
    fallback_model_ids: list[str] | None = None,
    config: dict | None = None,
    request_openai: Callable[[LlmRoute, str, str, list[str]], dict] = _generic_openai_json_request,
    request_anthropic: Callable[[LlmRoute, str, str, list[str]], dict] = _generic_anthropic_json_request,
    timeout_seconds: float | None = None,
    retry_same_model: bool = True,
) -> tuple[str, LlmRoute]:
    """Call a multimodal route and return plain model text."""

    system = _compact(system_prompt)
    prompt = _compact(user_prompt)
    if not system:
        raise LlmResponseError("多模态文本生成系统提示词为空")
    if not prompt:
        raise LlmResponseError("多模态文本生成任务提示词为空")
    references = [
        _multimodal_image_reference(value)
        for value in image_inputs
        if _compact(value)
    ][:10]
    if not references:
        raise LlmResponseError("未提供可识别的图片")

    model_ids = [model_id, *(fallback_model_ids or [])]
    model_ids = list(dict.fromkeys(_compact(value) for value in model_ids if _compact(value)))
    if not model_ids:
        model_ids = [""]

    attempts = (
        model_ids
        if len(model_ids) > 1 or not retry_same_model
        else [model_ids[0], model_ids[0]]
    )
    last_error: LlmGatewayError | None = None
    for attempt_index, current_model_id in enumerate(attempts):
        route = route_for_model(current_model_id, config=config)
        try:
            response = (
                _call_multimodal_request(
                    request_anthropic,
                    route,
                    system,
                    prompt,
                    references,
                    timeout_seconds=timeout_seconds,
                )
                if route.protocol == "anthropic"
                else _call_multimodal_request(
                    request_openai,
                    route,
                    system,
                    prompt,
                    references,
                    timeout_seconds=timeout_seconds,
                )
            )
            return _response_text(response), route
        except LlmGatewayError as exc:
            last_error = exc
            retryable = _is_retryable_llm_error(exc)
            if attempt_index == len(attempts) - 1 or not retryable:
                raise
    raise last_error or LlmGatewayError("文本模型接口调用失败")


def _strip_markdown_fence(value: str) -> str:
    text = _compact(value)
    if text.startswith("```"):
        text = re.sub(r"^```(?:[a-z0-9_-]+)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _bala_video_prompt_user_prompt(image_count: int, template_prompt: str = "") -> str:
    count = max(1, min(5, int(image_count or 1)))
    template = _compact(template_prompt) or BALA_VIDEO_PROMPT_TEMPLATE
    image_lines = "\n".join(f"图 {index}：已随消息提供" for index in range(1, count + 1))
    return (
        f"{template}\n\n"
        f"当前实际提供了 {count} 张图片，请只按图 1-{count} 编排，不要引用未提供的图片。\n"
        f"{image_lines}\n\n"
        "参考格式：先写整体视频风格与总约束；再写“精准分镜时序”，每个场景标明时间、外景地点、对应图片、人物动作、镜头运动、下摆/面料特写；"
        "最后写“负面提示词”。不要逐字照搬示例，要根据图片内容具体描述。"
    )


def normalize_bala_video_prompt(value: str) -> str:
    prompt = re.sub(r"\n{3,}", "\n\n", _strip_markdown_fence(value))
    prompt = prompt.strip()
    if not prompt:
        raise LlmResponseError("文本模型未返回视频 Prompt")
    if len(prompt) < 40:
        raise LlmResponseError("文本模型返回的视频 Prompt 过短")
    return prompt


def generate_bala_video_prompt(
    *,
    image_inputs: list[str],
    model_id: str = "",
    template_prompt: str = "",
    config: dict | None = None,
    request_openai: Callable[[LlmRoute, str, str, list[str]], dict] = _generic_openai_json_request,
    request_anthropic: Callable[[LlmRoute, str, str, list[str]], dict] = _generic_anthropic_json_request,
    timeout_seconds: float | None = 120,
) -> tuple[str, LlmRoute]:
    """Generate a short-video prompt from selected Bala model images."""

    selected_model_id = _compact(model_id) or BALA_VIDEO_PROMPT_DEFAULT_MODEL
    if selected_model_id not in BALA_VIDEO_PROMPT_MODELS:
        raise LlmConfigurationError(f"不支持的视频 Prompt 视觉模型：{selected_model_id}")
    images = [_compact(item) for item in image_inputs if _compact(item)][:5]
    if not images:
        raise LlmResponseError("请选择至少 1 张图片后再生成视频 Prompt")

    text, route = generate_multimodal_text(
        system_prompt=BALA_VIDEO_PROMPT_SYSTEM_PROMPT,
        user_prompt=_bala_video_prompt_user_prompt(len(images), template_prompt),
        image_inputs=images,
        model_id=selected_model_id,
        config=config,
        request_openai=request_openai,
        request_anthropic=request_anthropic,
        timeout_seconds=timeout_seconds,
        retry_same_model=False,
    )
    return normalize_bala_video_prompt(text), route
