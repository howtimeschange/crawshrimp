"""
Notification push
Supports: DingTalk webhook / Feishu webhook / custom webhook

DingTalk and Feishu both support rich Markdown-style messages.
Webhook sends raw JSON POST.
"""
import json
import logging
from typing import List, Optional
from urllib.request import urlopen, Request
from urllib.error import URLError

from core.config import get as cfg_get

logger = logging.getLogger(__name__)


class NotifyError(Exception):
    pass


def send(channel: str, title: str, records: int,
         adapter_name: str = "", task_name: str = "",
         sample_rows: Optional[List[dict]] = None,
         error: Optional[str] = None):
    """
    Dispatch notification to configured channel.
    channel: 'dingtalk' | 'feishu' | 'webhook'
    """
    if channel == "dingtalk":
        _send_dingtalk(title, records, adapter_name, task_name, sample_rows, error)
    elif channel == "feishu":
        _send_feishu(title, records, adapter_name, task_name, sample_rows, error)
    elif channel == "webhook":
        _send_webhook(title, records, adapter_name, task_name, sample_rows, error)
    else:
        logger.warning(f"Unknown notification channel: {channel}")


def _post_json(url: str, payload: dict):
    if not url:
        raise NotifyError("Webhook URL not configured")
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
            return result
    except URLError as e:
        raise NotifyError(f"HTTP request failed: {e}")


def _build_text(title: str, records: int, adapter_name: str,
                task_name: str, sample_rows: Optional[List[dict]],
                error: Optional[str]) -> str:
    lines = [f"**{title}**"]
    if adapter_name:
        lines.append(f"Platform: {adapter_name}")
    if task_name:
        lines.append(f"Task: {task_name}")
    if error:
        lines.append(f"ERROR: {error}")
    else:
        lines.append(f"Records: {records}")
        if sample_rows:
            lines.append("--- Sample ---")
            for row in sample_rows[:3]:
                lines.append("  " + "  |  ".join(f"{k}: {v}" for k, v in list(row.items())[:4]))
    return "\n".join(lines)


def _send_dingtalk(title: str, records: int, adapter_name: str,
                   task_name: str, sample_rows: Optional[List[dict]], error: Optional[str]):
    url = cfg_get("notify.dingtalk_webhook", "")
    text = _build_text(title, records, adapter_name, task_name, sample_rows, error)
    payload = {
        "msgtype": "markdown",
        "markdown": {
            "title": title,
            "text": text,
        }
    }
    result = _post_json(url, payload)
    if result.get("errcode") != 0:
        raise NotifyError(f"DingTalk error: {result}")
    logger.info(f"DingTalk notification sent: {title}")


def _send_feishu(title: str, records: int, adapter_name: str,
                 task_name: str, sample_rows: Optional[List[dict]], error: Optional[str]):
    url = cfg_get("notify.feishu_webhook", "")
    text = _build_text(title, records, adapter_name, task_name, sample_rows, error)
    payload = {
        "msg_type": "text",
        "content": {"text": text}
    }
    result = _post_json(url, payload)
    if result.get("code") not in (0, None):
        raise NotifyError(f"Feishu error: {result}")
    logger.info(f"Feishu notification sent: {title}")


def _send_webhook(title: str, records: int, adapter_name: str,
                  task_name: str, sample_rows: Optional[List[dict]], error: Optional[str]):
    url = cfg_get("notify.custom_webhook", "")
    payload = {
        "title": title,
        "adapter": adapter_name,
        "task": task_name,
        "records": records,
        "error": error,
        "sample": (sample_rows or [])[:5],
    }
    _post_json(url, payload)
    logger.info(f"Webhook notification sent: {title}")


def should_notify(condition: Optional[str], data: list) -> bool:
    """
    Evaluate an output condition expression.
    condition is a JS-style string like 'data.length > 0'
    We evaluate it as Python with data substituted.
    """
    if not condition:
        return True
    try:
        # Simple safe eval: replace JS idioms with Python equivalents
        expr = condition.replace("data.length", "len(data)").replace("&&", "and").replace("||", "or")
        return bool(eval(expr, {"data": data, "len": len}, {}))
    except Exception as e:
        logger.warning(f"Condition eval failed '{condition}': {e}, defaulting to True")
        return True
