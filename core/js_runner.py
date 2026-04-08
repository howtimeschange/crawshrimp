"""
JS 注入执行器
特性：超时控制 / 错误捕获 / 分页支持 / 多阶段重入支持
"""
import asyncio
import json
import logging
import secrets
import time
from pathlib import Path
from typing import List, Optional

import websockets

from core.models import JSResult

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 60
MAX_TIMEOUT = 120
MAX_PAGES = 100
MAX_PHASES = 9999
NAVIGATION_ERROR_MARKERS = (
    "Inspected target navigated or closed",
    "Cannot find context with specified id",
    "Promise was collected",
    "Execution context was destroyed",
)


class RunAbortedError(RuntimeError):
    def __init__(self, reason: str = "任务已停止", partial_data: Optional[List[dict]] = None):
        super().__init__(reason)
        self.reason = reason
        self.partial_data = list(partial_data or [])


class JSRunner:
    def __init__(self, ws_url: str, timeout: int = DEFAULT_TIMEOUT, tab_id: Optional[str] = None):
        self.ws_url = ws_url
        self.timeout = min(timeout, MAX_TIMEOUT)
        self.tab_id = tab_id
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
        async with websockets.connect(self.ws_url, max_size=50 * 1024 * 1024, proxy=None) as ws:
            await ws.send(payload)
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=self.timeout + 5)
                msg = json.loads(raw)
                if msg.get("id") == msg_id:
                    return msg

    async def _cdp_send(self, method: str, params: dict) -> dict:
        """直接通过 CDP WebSocket 发送任意命令（非 Runtime.evaluate）"""
        msg_id = self._next_id()
        payload = json.dumps({"id": msg_id, "method": method, "params": params})
        async with websockets.connect(self.ws_url, max_size=50 * 1024 * 1024, proxy=None) as ws:
            await ws.send(payload)
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=10)
                msg = json.loads(raw)
                if msg.get("id") == msg_id:
                    return msg

    async def cdp_mouse_click(self, x: float, y: float, delay_ms: int = 50) -> None:
        """用 CDP Input.dispatchMouseEvent 在真实坐标上执行鼠标点击。
        这能触发 React 合成事件，而 JS dispatchEvent 无法做到。
        """
        for evt_type in ("mouseMoved", "mousePressed", "mouseReleased"):
            params: dict = {"type": evt_type, "x": x, "y": y, "modifiers": 0}
            if evt_type == "mouseMoved":
                params.update({"button": "none", "clickCount": 0})
            elif evt_type == "mousePressed":
                params.update({"button": "left", "clickCount": 1, "buttons": 1})
            else:
                params.update({"button": "left", "clickCount": 1, "buttons": 0})
            await self._cdp_send("Input.dispatchMouseEvent", params)
        await asyncio.sleep(delay_ms / 1000.0)

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

    async def _refresh_ws_url(self) -> None:
        if not self.tab_id:
            return
        from core.cdp_bridge import get_bridge
        tab = get_bridge().get_tab(self.tab_id)
        if not tab:
            raise RuntimeError(f"导航后找不到原标签页: {self.tab_id}")
        ws_url = tab.get("webSocketDebuggerUrl", "")
        if not ws_url:
            raise RuntimeError(f"标签页缺少 webSocketDebuggerUrl: {self.tab_id}")
        self.ws_url = ws_url

    def _is_navigation_error(self, error: str) -> bool:
        return any(marker in (error or "") for marker in NAVIGATION_ERROR_MARKERS)

    def _params_storage_key(self, run_token: str) -> str:
        return f"__CRAWSHRIMP_PARAMS__:{run_token}"

    async def _persist_run_params(self, run_token: str, params_json: str) -> None:
        storage_key = self._params_storage_key(run_token)
        expression = (
            "(() => {\n"
            "  try {\n"
            f"    const storageKey = {json.dumps(storage_key, ensure_ascii=False)};\n"
            f"    const payload = {json.dumps(params_json, ensure_ascii=False)};\n"
            "    try {\n"
            "      window.sessionStorage.setItem(storageKey, payload);\n"
            "    } catch (storageError) {\n"
            "      window.name = storageKey + '\\n' + payload;\n"
            "    }\n"
            "    window.__CRAWSHRIMP_PARAMS__ = JSON.parse(payload);\n"
            "    return { success: true, data: [], meta: { has_more: false } };\n"
            "  } catch (error) {\n"
            "    return { success: false, error: String(error?.message || error) };\n"
            "  }\n"
            "})()\n"
        )
        result = await self.evaluate_with_reconnect(expression)
        if not result.success:
            raise RuntimeError(result.error or "failed to persist run params")

    def _build_phase_preamble(self, page: int, phase: str, run_token: str, shared: dict) -> str:
        storage_key = json.dumps(self._params_storage_key(run_token), ensure_ascii=False)
        return (
            f"window.__CRAWSHRIMP_PAGE__ = {page};\n"
            f"window.__CRAWSHRIMP_PHASE__ = {json.dumps(phase, ensure_ascii=False)};\n"
            f"window.__CRAWSHRIMP_RUN_TOKEN__ = {json.dumps(run_token, ensure_ascii=False)};\n"
            f"window.__CRAWSHRIMP_SHARED__ = {json.dumps(shared, ensure_ascii=False)};\n"
            "try {\n"
            "  if (!window.__CRAWSHRIMP_PARAMS__) {\n"
            f"    const storageKey = {storage_key};\n"
            "    let raw = null;\n"
            "    try { raw = window.sessionStorage.getItem(storageKey); } catch (e) {}\n"
            "    if (!raw && typeof window.name === 'string' && window.name.startsWith(storageKey + '\\n')) {\n"
            "      raw = window.name.slice(storageKey.length + 1);\n"
            "    }\n"
            "    if (raw) window.__CRAWSHRIMP_PARAMS__ = JSON.parse(raw);\n"
            "  }\n"
            "} catch (e) {}\n"
        )

    async def _clear_run_params(self, run_token: str) -> None:
        storage_key = json.dumps(self._params_storage_key(run_token), ensure_ascii=False)
        expression = (
            "(() => {\n"
            "  try {\n"
            f"    const storageKey = {storage_key};\n"
            "    try { window.sessionStorage.removeItem(storageKey); } catch (e) {}\n"
            "    if (typeof window.name === 'string' && window.name.startsWith(storageKey + '\\n')) {\n"
            "      window.name = '';\n"
            "    }\n"
            "  } catch (e) {}\n"
            "  return { success: true, data: [], meta: { has_more: false } };\n"
            "})()\n"
        )
        try:
            await self.evaluate_with_reconnect(expression)
        except Exception:
            logger.debug("Failed to clear persisted run params", exc_info=True)

    async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False) -> JSResult:
        result = await self.evaluate(expression)
        if not allow_navigation_retry:
            return result

        retry = 0
        while not result.success and self._is_navigation_error(result.error or "") and retry < 4:
            retry += 1
            delay = min(0.8 * retry + 0.4, 3.0)
            logger.info(f"导航/重载中，等待 {delay:.1f}s 后重试 (attempt {retry}/4)")
            await asyncio.sleep(delay)
            try:
                await self._refresh_ws_url()
            except Exception as e:
                logger.info(f"刷新标签页连接失败，继续等待: {e}")
                continue
            result = await self.evaluate(expression)
        return result

    async def run_script_file(self, script_path: Path, params: dict = None, control_hook=None) -> List[dict]:
        """执行脚本文件，支持自动分页 + 多阶段重入，返回合并后的所有 data 记录
        params: 用户填写的参数，注入为 window.__CRAWSHRIMP_PARAMS__
        """
        script = script_path.read_text(encoding="utf-8")
        all_data: List[dict] = []
        params_json = json.dumps(params or {}, ensure_ascii=False)
        run_token = f"{int(time.time() * 1000)}-{secrets.token_hex(4)}"

        await self._persist_run_params(run_token, params_json)

        async def cooperate(kind: str, page: int, phase: str, shared: Optional[dict] = None, extra: Optional[dict] = None) -> None:
            if control_hook is None:
                return
            payload = {
                "kind": kind,
                "page": page,
                "phase": phase,
                "shared": shared or {},
                "records": len(all_data),
            }
            if extra:
                payload.update(extra)
            await control_hook(payload)

        try:
            try:
                for page in range(1, MAX_PAGES + 1):
                    phase = "main"
                    shared = {}

                    for phase_index in range(1, MAX_PHASES + 1):
                        await cooperate("before_phase", page, phase, shared)
                        preamble = self._build_phase_preamble(page, phase, run_token, shared)
                        payload = preamble + script
                        result = await self.evaluate_with_reconnect(payload, allow_navigation_retry=(phase != "main"))

                        if not result.success:
                            logger.error(f"脚本执行失败 (page={page}, phase={phase}): {result.error}")
                            raise RuntimeError(result.error)

                        meta = result.meta or {}
                        action = meta.get("action") or "complete"
                        shared = meta.get("shared") or shared

                        if result.data:
                            all_data.extend(result.data)

                        if action == "cdp_clicks":
                            # JS 脚本请求用 CDP 真实鼠标点击一组坐标，然后继续当前 phase
                            # meta.clicks = [{x, y, delay_ms?}, ...]
                            # meta.next_phase (可选) = 点完后切换到哪个 phase
                            clicks = meta.get("clicks") or []
                            for idx, c in enumerate(clicks):
                                await cooperate("before_click", page, phase, shared, {
                                    "click_index": idx,
                                    "click_total": len(clicks),
                                })
                                await self.cdp_mouse_click(float(c["x"]), float(c["y"]), int(c.get("delay_ms", 80)))
                            post_sleep = float(meta.get("sleep_ms", 300)) / 1000.0
                            await cooperate("before_sleep", page, phase, shared, {"sleep_ms": int(post_sleep * 1000)})
                            await asyncio.sleep(post_sleep)
                            next_phase = meta.get("next_phase") or phase
                            logger.info(f"cdp_clicks: page={page} phase={phase} 点击 {len(clicks)} 个坐标 -> {next_phase}")
                            phase = str(next_phase)
                            await self._refresh_ws_url()
                            continue

                        if action == "next_phase":
                            next_phase = meta.get("next_phase")
                            if not next_phase:
                                raise RuntimeError(f"脚本返回 next_phase 但缺少 next_phase 值 (page={page}, phase={phase})")
                            if next_phase == "wait_verification" and phase == "wait_verification":
                                rounds = int((shared or {}).get("captcha_wait_rounds") or 0)
                                if rounds <= 1 or rounds % 3 == 0:
                                    reason = (shared or {}).get("captcha_reason") or "captcha"
                                    logger.info(f"等待用户验证码验证中: page={page} rounds={rounds} reason={reason}")
                            else:
                                logger.info(f"阶段切换: page={page} {phase} -> {next_phase}")
                            phase = str(next_phase)
                            sleep_ms = float(meta.get("sleep_ms", 1200))
                            await cooperate("before_sleep", page, phase, shared, {"sleep_ms": int(sleep_ms)})
                            await asyncio.sleep(sleep_ms / 1000.0)
                            await self._refresh_ws_url()
                            continue

                        if action == "complete":
                            if not meta.get("has_more", False):
                                return all_data
                            logger.info(f"分页: 已获取 {len(all_data)} 条，继续第 {page + 1} 页...")
                            break

                        raise RuntimeError(f"未知脚本阶段动作: {action}")
                    else:
                        raise RuntimeError(f"脚本阶段执行超过上限 ({MAX_PHASES})，page={page}")

                return all_data
            except RunAbortedError as e:
                if not e.partial_data:
                    e.partial_data = list(all_data)
                raise
            except asyncio.CancelledError:
                raise RunAbortedError("任务已停止", partial_data=list(all_data))
        finally:
            await self._clear_run_params(run_token)
