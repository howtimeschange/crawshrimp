"""
JS 注入执行器
特性：超时控制 / 错误捕获 / 分页支持 / 结果类型校验
"""
import asyncio
import json
import logging
from pathlib import Path
from typing import List

import websockets

from core.models import JSResult

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 60
MAX_TIMEOUT = 120
MAX_PAGES = 100


class JSRunner:
    def __init__(self, ws_url: str, timeout: int = DEFAULT_TIMEOUT):
        self.ws_url = ws_url
        self.timeout = min(timeout, MAX_TIMEOUT)
        self._msg_id = 0

    def _next_id(self) -> int:
        self._msg_id += 1
        return self._msg_id

    async def _evaluate_raw(self, expression: str) -> dict:
        msg_id = self._next_id()
        payload = json.dumps({
            "id": msg_id,
            "method": "Runtime.evaluate",
            "params": {
                "expression": expression,
                "awaitPromise": True,
                "returnByValue": True,
                "timeout": self.timeout * 1000,
            }
        })
        async with websockets.connect(self.ws_url, max_size=50 * 1024 * 1024) as ws:
            await ws.send(payload)
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=self.timeout + 5)
                msg = json.loads(raw)
                if msg.get("id") == msg_id:
                    return msg

    async def evaluate(self, expression: str) -> JSResult:
        try:
            msg = await self._evaluate_raw(expression)
        except asyncio.TimeoutError:
            return JSResult(success=False, error="timeout")
        except Exception as e:
            return JSResult(success=False, error=str(e))

        if "error" in msg:
            return JSResult(success=False, error=str(msg["error"]))

        result = msg.get("result", {}).get("result", {})
        if result.get("type") == "undefined":
            return JSResult(success=False, error="脚本未返回值（忘记 return？）")

        val = result.get("value")
        if not isinstance(val, dict):
            return JSResult(success=False, error=f"返回值类型错误: {type(val)}")

        return JSResult(
            success=val.get("success", False),
            data=val.get("data"),
            meta=val.get("meta"),
            error=val.get("error"),
        )

    async def run_script_file(self, script_path: Path) -> List[dict]:
        """执行脚本文件，支持自动分页，返回合并后的所有 data 记录"""
        script = script_path.read_text(encoding="utf-8")
        all_data: List[dict] = []

        for page in range(1, MAX_PAGES + 1):
            paged = f"window.__CRAWSHRIMP_PAGE__ = {page};\n" + script
            result = await self.evaluate(paged)

            if not result.success:
                logger.error(f"脚本执行失败 (page={page}): {result.error}")
                raise RuntimeError(result.error)

            if result.data:
                all_data.extend(result.data)

            if not (result.meta or {}).get("has_more", False):
                break

            logger.info(f"分页: 已获取 {len(all_data)} 条，继续第 {page+1} 页...")

        return all_data
