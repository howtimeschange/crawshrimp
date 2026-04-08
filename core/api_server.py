"""
FastAPI service - complete task execution pipeline
Electron spawns this process; all GUI calls go through HTTP on localhost:18765

Bundling notes (for electron-builder / python-build-standalone):
  - All deps (fastapi, uvicorn, apscheduler, openpyxl, websockets, pyyaml) must be
    pre-installed in the bundled Python env (see app/scripts/bundle-python.sh)
  - Built-in adapters (adapters/) are shipped as extraResources alongside Python scripts
  - User-installed adapters live in ~/.crawshrimp/adapters/
"""
import asyncio
import base64
import logging
import os
import tempfile
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional
from urllib.parse import parse_qs, urlparse

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from core.config import load_config, save_config
from core import adapter_loader
from core import data_sink
from core import notifier
from core import scheduler as sched_module
from core.cdp_bridge import get_bridge, reset_bridge

logger = logging.getLogger(__name__)

# In-memory task run state for live status / logs
_run_logs: dict = {}   # job_id -> list[str]
_run_status: dict = {} # job_id -> {'status', 'run_id', 'records'}
_run_controls: dict = {}  # job_id -> {'task', 'pause_requested', 'stop_requested', 'resume_event', ...}

ACTIVE_LIVE_STATUSES = {"running", "pausing", "paused", "stopping"}


def _build_run_control() -> dict:
    resume_event = asyncio.Event()
    resume_event.set()
    return {
        "task": None,
        "pause_requested": False,
        "stop_requested": False,
        "stop_reason": "任务已停止",
        "resume_event": resume_event,
        "pause_logged": False,
        "last_progress_exec_no": 0,
        "total_rows": 0,
    }


async def _evaluate_filename_context(runner, expression: str) -> dict:
    try:
        result = await runner.evaluate(expression)
    except Exception:
        return {}
    if not result.success or not result.data or not isinstance(result.data, list):
        return {}
    row = result.data[0] or {}
    return row if isinstance(row, dict) else {}


async def _build_export_filename_context(adapter_id: str, task_id: str, run_params: dict, runner) -> dict:
    if adapter_id != 'temu':
        return {}

    backend_context_js = r"""
(() => {
  const textOf = el => (el?.textContent || '').replace(/\s+/g, ' ').trim()
  const root = document.querySelector('[class*="userInfo"], [class*="seller-name"], [class*="account-info_userInfo"]')
  const blacklist = new Set(['服务市场', '履约中心', '学习', '运营对接', '规则中心', '消息', '客服', '反馈', '99+', '首页', '数据中心', '商品数据'])
  const seen = new Set()
  const candidates = []
  const push = text => {
    const clean = String(text || '').replace(/\s+/g, ' ').trim()
    if (!clean || seen.has(clean)) return
    seen.add(clean)
    candidates.push(clean)
  }
  if (root) {
    push(textOf(root.querySelector('[class*="elli_outerWrapper"], [class*="seller-name"], [class*="shopName"], [class*="userName"]')))
    for (const el of root.querySelectorAll('*')) {
      const text = textOf(el)
      if (!text || text.length > 80) continue
      if ([...el.children].some(c => textOf(c) === text)) continue
      push(text)
    }
  }
  const shopName =
    candidates.find(text => /shop/i.test(text)) ||
    candidates.find(text => /[A-Za-z]/.test(text) && !blacklist.has(text)) ||
    candidates.find(text => !blacklist.has(text)) ||
    ''
  const timeRow = [...document.querySelectorAll('[class*="index-module__row___"]')].find(row => {
    return textOf(row.querySelector('[class*="index-module__row_label___"]')) === '时间区间'
  }) || null
  const timeScope = textOf(timeRow?.querySelector('input[data-testid="beast-core-select-htmlInput"]'))
  const dateRange = textOf(timeRow?.querySelector('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]'))
  return {
    success: true,
    data: [{ shop_name: shopName, time_scope: timeScope, date_range: dateRange }],
    meta: { has_more: false }
  }
})()
"""

    storefront_context_js = r"""
(() => {
  const textOf = el => (el?.textContent || '').replace(/\s+/g, ' ').trim()
  const h1 = textOf(document.querySelector('h1'))
  const title = String(document.title || '').replace(/\s*-\s*Great Offers.*$/i, '').trim()
  return {
    success: true,
    data: [{ shop_name: h1 || title || '' }],
    meta: { has_more: false }
  }
})()
"""

    page_ctx = {}
    if task_id in {'goods_data', 'aftersales'}:
        page_ctx = await _evaluate_filename_context(runner, backend_context_js)
    elif task_id in {'reviews', 'store_items'}:
        page_ctx = await _evaluate_filename_context(runner, storefront_context_js)

    shop_name = str(page_ctx.get('shop_name') or '').strip()
    if not shop_name and task_id in {'reviews', 'store_items'}:
        shop_url = str(run_params.get('shop_url') or '').strip()
        if shop_url:
            try:
                parsed = urlparse(shop_url)
                shop_name = parse_qs(parsed.query).get('mall_id', [''])[0].strip()
            except Exception:
                shop_name = ''

    ctx = {'shop_name': shop_name or 'Temu店铺'}

    if task_id == 'goods_data':
        def resolve_relative_range(label: str) -> str:
            today = datetime.now().date()
            if label == '昨日':
                day = today - timedelta(days=1)
                return f"{day.isoformat()}~{day.isoformat()}"
            if label == '近7日':
                start_day = today - timedelta(days=6)
                return f"{start_day.isoformat()}~{today.isoformat()}"
            if label == '近30日':
                start_day = today - timedelta(days=29)
                return f"{start_day.isoformat()}~{today.isoformat()}"
            return ''

        time_range = str(run_params.get('time_range') or '').strip()
        custom_range = run_params.get('custom_range') or {}
        start = str(custom_range.get('start') or '').strip()
        end = str(custom_range.get('end') or '').strip()
        page_time_scope = str(page_ctx.get('time_scope') or '').strip()
        page_date_range = str(page_ctx.get('date_range') or '').strip()

        if time_range == '自定义':
            ctx['time_scope'] = '自定义'
            ctx['date_range'] = f"{start}~{end}" if start and end else (page_date_range or '自定义')
        elif time_range:
            ctx['time_scope'] = time_range
            ctx['date_range'] = page_date_range if '~' in page_date_range else (resolve_relative_range(time_range) or page_date_range or time_range)
        else:
            ctx['time_scope'] = page_time_scope or '当前筛选'
            if '~' in page_date_range:
                ctx['date_range'] = page_date_range
            else:
                ctx['date_range'] = resolve_relative_range(page_time_scope) or page_date_range or page_time_scope or '当前筛选'

    if task_id == 'aftersales':
        regions = run_params.get('regions') or []
        if not isinstance(regions, list):
            regions = []
        clean_regions = [str(r).strip() for r in regions if str(r).strip()]
        ctx['region_scope'] = '+'.join(clean_regions) if clean_regions else '全部地区'

    return ctx


def _url_matches_prefix(url: str, prefix: str) -> bool:
    if not url or not prefix:
        return False
    if url.startswith(prefix):
        return True

    try:
        url_p = urlparse(url)
        prefix_p = urlparse(prefix)
    except Exception:
        return False

    url_host = (url_p.hostname or '').lower()
    prefix_host = (prefix_p.hostname or '').lower()
    url_path = url_p.path or '/'
    prefix_path = prefix_p.path or '/'

    if not url_host or not prefix_host:
        return False

    if url_host == prefix_host:
        return url_path.startswith(prefix_path)

    # Temu seller 现在会按区域切到 agentseller-us.temu.com / agentseller-xx.temu.com
    if prefix_host == 'agentseller.temu.com' and url_host.endswith('.temu.com') and url_host.startswith('agentseller'):
        normalized_prefix = prefix_path if prefix_path.endswith('/') else prefix_path + '/'
        normalized_url = url_path if url_path.endswith('/') else url_path + '/'
        return normalized_url.startswith(normalized_prefix) or normalized_prefix == '//'

    return False


def _rows_raw_to_table(rows_raw, header_row: int = 1):
    if not rows_raw:
        return {"headers": [], "rows": [], "total": 0}

    hi = header_row - 1
    if hi < 0 or hi >= len(rows_raw):
        return {"error": f"Header row index {hi} out of range", "headers": [], "rows": [], "total": 0}

    headers = [str(c) if c is not None else '' for c in rows_raw[hi]]
    rows = []
    for raw in rows_raw[hi + 1:]:
        if all(c is None or str(c).strip() == '' for c in raw):
            continue
        row = {}
        for i, h in enumerate(headers):
            v = raw[i] if i < len(raw) else None
            row[h] = str(v) if v is not None else ''
        rows.append(row)

    return {"headers": headers, "rows": rows, "total": len(rows)}


def _read_local_excel(path: str, sheet: Optional[str] = None, header_row: int = 1):
    """Internal helper to read Excel/CSV without raising HTTPExceptions"""
    p = Path(path)
    if not p.exists():
        return {"error": f"File not found: {path}", "headers": [], "rows": [], "total": 0}

    suffix = p.suffix.lower()
    try:
        if suffix in ('.xlsx', '.xls', '.xlsm'):
            import openpyxl

            wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
            try:
                if sheet:
                    ws = wb[sheet]
                    table = _rows_raw_to_table(list(ws.iter_rows(values_only=True)), header_row)
                    table["sheet_name"] = ws.title
                    table["sheets"] = {
                        ws.title: {
                            "headers": table.get("headers", []),
                            "rows": table.get("rows", []),
                            "total": table.get("total", 0),
                        }
                    }
                    return table

                workbook_tables = {}
                for ws in wb.worksheets:
                    workbook_tables[ws.title] = _rows_raw_to_table(list(ws.iter_rows(values_only=True)), header_row)

                active_name = wb.active.title if wb.active else (wb.sheetnames[0] if wb.sheetnames else "Sheet1")
                active_table = workbook_tables.get(active_name) or {"headers": [], "rows": [], "total": 0}
                return {
                    "headers": active_table.get("headers", []),
                    "rows": active_table.get("rows", []),
                    "total": active_table.get("total", 0),
                    "sheet_name": active_name,
                    "sheets": workbook_tables,
                }
            finally:
                wb.close()

        if suffix == '.csv':
            import csv

            with open(p, newline='', encoding='utf-8-sig') as f:
                rows_raw = list(csv.reader(f))
            table = _rows_raw_to_table(rows_raw, header_row)
            table["sheet_name"] = "Sheet1"
            table["sheets"] = {
                "Sheet1": {
                    "headers": table.get("headers", []),
                    "rows": table.get("rows", []),
                    "total": table.get("total", 0),
                }
            }
            return table

        return {"error": f"Unsupported format: {suffix}", "headers": [], "rows": [], "total": 0}
    except Exception as e:
        return {"error": str(e), "headers": [], "rows": [], "total": 0}


def _template_search_roots(adapter_id: str) -> List[Path]:
    roots: List[Path] = []

    adapter_dir = adapter_loader.get_adapter_dir(adapter_id)
    if adapter_dir:
        roots.append(adapter_dir.resolve())

    built_in_dir = (Path(__file__).parent.parent / "adapters" / adapter_id).resolve()
    if built_in_dir.exists():
        roots.append(built_in_dir)

    seen = set()
    deduped = []
    for root in roots:
        marker = str(root)
        if marker in seen:
            continue
        seen.add(marker)
        deduped.append(root)
    return deduped


def _resolve_template_path(adapter_id: str, template_file: Optional[str]) -> Optional[str]:
    if not template_file:
        return None

    for base_dir in _template_search_roots(adapter_id):
        try:
            candidate = (base_dir / template_file).resolve()
            candidate.relative_to(base_dir)
        except Exception:
            continue

        if candidate.exists() and candidate.is_file():
            return str(candidate)

    return None


def _serialize_task_param(adapter_id: str, param) -> dict:
    data = param.model_dump()
    templates = []
    for template in data.get("templates") or []:
        t = dict(template)
        t["path"] = _resolve_template_path(adapter_id, t.get("file"))
        templates.append(t)

    if not templates and data.get("template_file"):
        templates.append({
            "file": data.get("template_file"),
            "label": data.get("template_label"),
            "description": None,
            "version": None,
            "path": _resolve_template_path(adapter_id, data.get("template_file")),
        })

    data["templates"] = templates
    data["template_path"] = next((t.get("path") for t in templates if t.get("path")), None)
    return data


async def _execute_task(adapter_id: str, task_id: str, params: Optional[dict] = None, runtime_options: Optional[dict] = None, run_control: Optional[dict] = None):
    """
    Core task execution pipeline:
    1. Find / create matching Chrome tab via CDP
    2. Optional auth check + login wait
    3. Inject + execute JS script
    4. Persist results (Excel/JSON)
    5. Send notifications if configured
    6. Record run state in SQLite
    """
    from core.js_runner import JSRunner, RunAbortedError
    from core.models import OutputType

    jid = f"{adapter_id}::{task_id}"
    # 保留历史日志，新一轮运行用分隔线追加（不覆盖）
    from datetime import datetime as _dt
    _sep = f"─── 新运行 {_dt.now().strftime('%m-%d %H:%M:%S')} ───────────────────────"
    if jid not in _run_logs:
        _run_logs[jid] = []
    else:
        _run_logs[jid].append('')
        _run_logs[jid].append(_sep)
    _run_status[jid] = {'status': 'running', 'run_id': None, 'records': 0}

    def log(msg: str):
        logger.info(msg)
        _run_logs[jid].append(msg)

    def build_progress(payload: Optional[dict] = None) -> dict:
        shared_state = dict((payload or {}).get('shared') or {})
        total_rows = int(shared_state.get('total_rows') or run_control.get('total_rows') or 0) if run_control else int(shared_state.get('total_rows') or 0)
        current_exec_no = int(shared_state.get('current_exec_no') or 0)
        current_row_no = int(shared_state.get('current_row_no') or 0)
        batch_no = int(shared_state.get('batch_no') or 0)
        total_batches = int(shared_state.get('total_batches') or 0)
        buyer_id = str(shared_state.get('current_buyer_id') or '').strip()
        store = str(shared_state.get('current_store') or '').strip()
        phase_name = str((payload or {}).get('phase') or '').strip()
        records = int((payload or {}).get('records') or 0)

        if run_control and total_rows:
            run_control['total_rows'] = total_rows

        percent = 0.0
        if total_rows > 0 and current_exec_no > 0:
            percent = min(100.0, round((current_exec_no / total_rows) * 100, 1))

        progress_text = ""
        if current_exec_no > 0 and total_rows > 0:
          progress_text = f"{current_exec_no}/{total_rows}"

        return {
            "current": current_exec_no,
            "total": total_rows,
            "row_no": current_row_no,
            "batch_no": batch_no,
            "total_batches": total_batches,
            "buyer_id": buyer_id,
            "store": store,
            "phase": phase_name,
            "completed": records,
            "percent": percent,
            "progress_text": progress_text,
        }

    async def wait_for_control(payload: Optional[dict] = None):
        if not run_control:
            return

        records = int((payload or {}).get('records') or 0)
        progress = build_progress(payload)
        base_status = {
            'run_id': run_id,
            'records': records,
            'current': progress['current'],
            'total': progress['total'],
            'row_no': progress['row_no'],
            'batch_no': progress['batch_no'],
            'total_batches': progress['total_batches'],
            'buyer_id': progress['buyer_id'],
            'store': progress['store'],
            'phase': progress['phase'],
            'completed': progress['completed'],
            'percent': progress['percent'],
            'progress_text': progress['progress_text'],
        }

        if (
            (payload or {}).get('kind') == 'before_phase' and
            progress['current'] > 0 and
            progress['total'] > 0 and
            str((payload or {}).get('phase') or '') == 'search_buyer' and
            progress['current'] != int(run_control.get('last_progress_exec_no') or 0)
        ):
            extra_parts = []
            if progress['batch_no'] > 0 and progress['total_batches'] > 0:
                extra_parts.append(f"批次 {progress['batch_no']}/{progress['total_batches']}")
            if progress['row_no'] > 0:
                extra_parts.append(f"源表行 {progress['row_no']}")
            if progress['buyer_id']:
                extra_parts.append(f"买家 {progress['buyer_id']}")
            suffix = f" · {' · '.join(extra_parts)}" if extra_parts else ""
            log(f"[progress] 第 {progress['current']}/{progress['total']} 条 · 已完成 {records} 条{suffix}")
            run_control['last_progress_exec_no'] = progress['current']

        if run_control.get('stop_requested'):
            raise RunAbortedError(str(run_control.get('stop_reason') or '任务已停止'))

        if run_control.get('pause_requested'):
            _run_status[jid] = {'status': 'paused', **base_status}
            if not run_control.get('pause_logged'):
                log("[control] 任务已暂停，等待继续…")
                run_control['pause_logged'] = True
            while run_control.get('pause_requested'):
                if run_control.get('stop_requested'):
                    raise RunAbortedError(str(run_control.get('stop_reason') or '任务已停止'))
                try:
                    await asyncio.wait_for(run_control['resume_event'].wait(), timeout=0.5)
                except asyncio.TimeoutError:
                    continue
            if run_control.get('pause_logged'):
                log("[control] 任务已继续")
                run_control['pause_logged'] = False

        _run_status[jid] = {'status': 'running', **base_status}

    # 任务执行前重扫一次适配包，确保磁盘上的 manifest 改动立即生效
    adapter_loader.scan_all()
    m = adapter_loader.get_adapter(adapter_id)
    if not m:
        raise ValueError(f"Adapter not found: {adapter_id}")

    task = next((t for t in m.tasks if t.id == task_id), None)
    if not task:
        raise ValueError(f"Task not found: {task_id}")

    run_id = data_sink.begin_run(adapter_id, task_id)
    _run_status[jid]['run_id'] = run_id
    runner = None
    data = []
    output_files = []

    try:
        log(f"[{adapter_id}/{task_id}] Starting...")

        bridge = get_bridge()
        run_params = dict(params or {})
        runtime_options = runtime_options or {}
        task_param_ids = {p.id for p in task.params}
        for p in task.params:
            if p.id not in run_params and p.default is not None:
                run_params[p.id] = p.default

        mode = str(run_params.get('mode') or ('new' if 'mode' not in task_param_ids else 'current')).strip().lower()
        current_tab_id = str(runtime_options.get('current_tab_id') or '').strip()
        shop_url = str(run_params.get('shop_url') or '').strip()
        target_entry_url = shop_url or str(task.entry_url or m.entry_url or '').strip()
        configured_match_prefixes = list(task.tab_match_prefixes or m.tab_match_prefixes or [])
        platform_name = m.name or adapter_id

        # 自动解析 file_excel 参数：如果传了 path 但没有 rows，就在后台读出来注入
        for pk, pv in run_params.items():
            if isinstance(pv, dict) and pv.get('path') and not pv.get('rows'):
                log(f"Resolving Excel rows for param '{pk}' from path: {pv['path']}")
                resolved = _read_local_excel(pv['path'])
                if "error" in resolved:
                    log(f"[warn] Failed to resolve Excel rows: {resolved['error']}")
                else:
                    pv['rows'] = resolved['rows']
                    pv['headers'] = resolved['headers']
                    if resolved.get('sheet_name') is not None:
                        pv['sheet_name'] = resolved['sheet_name']
                    if resolved.get('sheets') is not None:
                        pv['sheets'] = resolved['sheets']
                    log(f"Successfully resolved {len(pv['rows'])} rows.")

        is_shopee_marketing_adapter = target_entry_url.startswith('https://seller.shopee.cn/portal/marketing')

        tab = None
        if mode == 'current':
            all_tabs = [t for t in bridge.get_tabs() if t.get('type') == 'page']
            preferred_prefixes = configured_match_prefixes or [
                'https://seller.shopee.cn/portal/marketing',
                'https://seller.shopee.cn/portal/marketing/vouchers/list',
                'https://seller.shopee.cn/portal/marketing/vouchers/new',
                'https://seller.shopee.cn/portal/marketing/follow-prize/new',
            ] if is_shopee_marketing_adapter else configured_match_prefixes or [target_entry_url]
            if adapter_id == 'temu' and shop_url:
                preferred_prefixes = list(dict.fromkeys([
                    *preferred_prefixes,
                    'https://www.temu.com/bgn_verification.html',
                ]))

            if current_tab_id:
                tab = next((t for t in all_tabs if str(t.get('id')) == current_tab_id), None)
                if not tab:
                    raise RuntimeError("未找到当前页面对应的 Chrome 标签页。请重新聚焦目标业务页面后重试。")
                tab_url = str(tab.get('url', ''))
                if not any(_url_matches_prefix(tab_url, prefix) for prefix in preferred_prefixes):
                    raise RuntimeError(f"当前页面不是目标业务页：{tab_url[:120]}")
            else:
                candidate_tabs = [
                    t for t in all_tabs
                    if any(_url_matches_prefix(str(t.get('url', '')), prefix) for prefix in preferred_prefixes)
                ]
                if len(candidate_tabs) == 1:
                    tab = candidate_tabs[0]
                elif len(candidate_tabs) > 1:
                    raise RuntimeError(
                        "current 模式检测到多个目标页面，无法判断当前标签页。"
                        "请关闭多余相关标签页后重试，或改用“新页面开启（重新导航）”。"
                    )
                else:
                    raise RuntimeError(f"未找到已打开的目标页面：{target_entry_url}。请选择“新页面开启（重新导航）”或先手动打开并登录。")
        else:
            log(f"mode=new，尝试新建页面：{target_entry_url}")
            try:
                tab = bridge.new_tab(target_entry_url)
            except Exception as e:
                log(f"新建 tab 失败，尝试复用现有 tab: {e}")
                tab = bridge.find_tab(target_entry_url)
            if not tab:
                raise RuntimeError(f"无法打开或找到目标页面：{target_entry_url}")

        log(f"Found tab: {tab.get('url', '')[:120]}")
        runner = JSRunner(
            bridge.get_tab_ws_url(tab),
            tab_id=str(tab.get('id') or ''),
        )

        async def export_outputs(data_rows):
            files = []
            filename_vars = await _build_export_filename_context(adapter_id, task_id, run_params, runner)
            for out in task.output:
                if out.type == OutputType.excel:
                    if not data_rows:
                        log("No data rows returned, skip Excel export")
                        continue
                    fname = out.filename or "{task_id}_{date}.xlsx"
                    path = data_sink.export_excel(
                        data_rows,
                        adapter_id,
                        task_id,
                        fname,
                        filename_vars=filename_vars,
                        column_order=getattr(out, 'columns', None),
                    )
                    files.append(path)
                    log(f"Excel exported: {path}")

                elif out.type == OutputType.json:
                    fname = out.filename or "{task_id}_{date}.json"
                    path = data_sink.export_json(data_rows, adapter_id, task_id, fname, filename_vars=filename_vars)
                    files.append(path)
                    log(f"JSON exported: {path}")

                elif out.type == OutputType.notify:
                    if notifier.should_notify(out.condition, data_rows):
                        try:
                            notifier.send(
                                channel=out.channel or 'dingtalk',
                                title=f"{m.name} - {task.name}",
                                records=len(data_rows),
                                adapter_name=m.name,
                                task_name=task.name,
                                sample_rows=data_rows[:3] if data_rows else None,
                            )
                            log(f"Notification sent via {out.channel}")
                        except Exception as e:
                            log(f"Notification failed: {e}")
                    else:
                        log(f"Notification skipped (condition not met: {out.condition})")
            return files

        # 可选登录检测：若 manifest 配置了 auth.check_script，则最多等 5 分钟
        if not task.skip_auth and m.auth and m.auth.check_script:
            adapter_dir = adapter_loader.get_adapter_dir(adapter_id)
            auth_path = adapter_dir / m.auth.check_script
            if auth_path.exists():
                await wait_for_control()
                log(f"运行登录检测：{m.auth.check_script}")
                auth_result = await runner.evaluate(auth_path.read_text(encoding='utf-8'))
                logged_in = False
                if auth_result.success:
                    if isinstance(auth_result.meta, dict):
                        logged_in = bool(auth_result.meta.get('logged_in'))
                    if not logged_in and auth_result.data and isinstance(auth_result.data, list):
                        logged_in = bool((auth_result.data[0] or {}).get('logged_in'))

                if not logged_in:
                    login_url = (m.auth.login_url or target_entry_url)
                    if mode == 'new':
                        await wait_for_control()
                        log(f"检测到未登录，跳转登录页：{login_url}")
                        await runner.evaluate(f"location.href = {login_url!r}; ({'{'} success: true, data: [], meta: {{ has_more: false }} {'}'})")
                        await asyncio.sleep(2)
                    else:
                        log(f"检测到未登录，请在当前页面完成 {platform_name} 登录…")
                    wait_seconds = 300
                    for i in range(wait_seconds):
                        await wait_for_control({"records": 0})
                        auth_result = await runner.evaluate(auth_path.read_text(encoding='utf-8'))
                        ok = False
                        if auth_result.success:
                            if isinstance(auth_result.meta, dict):
                                ok = bool(auth_result.meta.get('logged_in'))
                            if not ok and auth_result.data and isinstance(auth_result.data, list):
                                ok = bool((auth_result.data[0] or {}).get('logged_in'))
                        if ok:
                            log("用户已完成登录，继续执行任务")
                            break
                        if i in (0, 4) or (i + 1) % 15 == 0:
                            log(f"等待用户登录 {platform_name}… {i + 1}/{wait_seconds}s")
                        await asyncio.sleep(1)
                    else:
                        raise RuntimeError(f"等待登录超时（5分钟）。请完成 {platform_name} 登录后重试。")

                if mode == 'new':
                    # 登录完成后，重新导航回业务入口页
                    await wait_for_control()
                    log(f"导航回业务入口：{target_entry_url}")
                    await runner.evaluate(f"location.href = {target_entry_url!r}; ({'{'} success: true, data: [], meta: {{ has_more: false }} {'}'})")
                    await asyncio.sleep(3)

        adapter_dir = adapter_loader.get_adapter_dir(adapter_id)
        script_path = adapter_dir / task.script
        if not script_path.exists():
            raise FileNotFoundError(f"Script not found: {script_path}")

        await wait_for_control({"records": 0})
        log(f"Injecting script: {task.script}")
        data = await runner.run_script_file(script_path, params=run_params, control_hook=wait_for_control)
        log(f"Script complete. Records: {len(data)}")

        output_files = await export_outputs(data)
        data_sink.finish_run(run_id, len(data), output_files)
        _run_status[jid] = {'status': 'done', 'run_id': run_id, 'records': len(data)}
        log(f"[{adapter_id}/{task_id}] Done. {len(data)} records.")

    except RunAbortedError as e:
        err = e.reason or str(e)
        data = list(e.partial_data or data or [])
        if run_control:
            run_control['pause_requested'] = False
            run_control['stop_requested'] = False
            run_control['resume_event'].set()
            run_control['pause_logged'] = False

        try:
            output_files = await export_outputs(data) if runner else []
        except Exception as export_error:
            output_files = []
            log(f"[warn] 停止任务时导出部分结果失败: {export_error}")

        data_sink.stop_run(run_id, len(data), output_files, err)
        _run_status[jid] = {'status': 'stopped', 'run_id': run_id, 'records': len(data), 'error': err}
        log(f"[{adapter_id}/{task_id}] Stopped. {len(data)} records.")

    except asyncio.CancelledError:
        err = "任务已停止"
        if run_control:
            run_control['pause_requested'] = False
            run_control['stop_requested'] = False
            run_control['resume_event'].set()
            run_control['pause_logged'] = False
        try:
            output_files = await export_outputs(data) if runner else []
        except Exception as export_error:
            output_files = []
            log(f"[warn] 停止任务时导出部分结果失败: {export_error}")
        data_sink.stop_run(run_id, len(data), output_files, err)
        _run_status[jid] = {'status': 'stopped', 'run_id': run_id, 'records': len(data), 'error': err}
        log(f"[{adapter_id}/{task_id}] Stopped. {len(data)} records.")

    except Exception as e:
        err = str(e)
        log(f"[{adapter_id}/{task_id}] ERROR: {err}")
        data_sink.fail_run(run_id, err)
        _run_status[jid] = {'status': 'error', 'run_id': run_id, 'records': 0, 'error': err}
        raise
    finally:
        if run_control is not None:
            run_control['task'] = None
            run_control['pause_requested'] = False
            run_control['stop_requested'] = False
            run_control['resume_event'].set()
            run_control['pause_logged'] = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Init DB
    data_sink.init_db()

    # Install built-in adapters
    built_in = Path(__file__).parent.parent / "adapters"
    if built_in.exists():
        for d in built_in.iterdir():
            if d.is_dir() and (d / "manifest.yaml").exists():
                try:
                    adapter_loader.install_from_dir(str(d))
                except Exception as e:
                    logger.warning(f"Built-in adapter failed {d.name}: {e}")

    adapter_loader.scan_all()

    # Register scheduled tasks
    for item in adapter_loader.list_all():
        if item['enabled']:
            m = adapter_loader.get_adapter(item['id'])
            if m:
                sched_module.register_adapter(m, _execute_task)

    sched_module.start()
    logger.info("crawshrimp core started")
    yield
    sched_module.shutdown()


app = FastAPI(title="crawshrimp", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


# ─── Health ───

@app.get("/health")
def health():
    cfg = load_config()
    bridge = get_bridge()
    chrome_ok = bridge.is_available()
    return {
        "status": "ok",
        "chrome": chrome_ok,
        "adapters": len(adapter_loader.list_all()),
        "scheduled_jobs": len(sched_module.list_jobs()),
    }


# ─── Adapters ───

@app.get("/adapters")
def list_adapters():
    return adapter_loader.list_all()


class InstallRequest(BaseModel):
    path: Optional[str] = None
    zip_base64: Optional[str] = None


@app.post("/adapters/install")
def install_adapter(req: InstallRequest):
    try:
        if req.path:
            m = adapter_loader.install_from_dir(req.path)
        elif req.zip_base64:
            raw = base64.b64decode(req.zip_base64)
            with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as f:
                f.write(raw)
                tmp = f.name
            try:
                m = adapter_loader.install_from_zip(tmp)
            finally:
                os.unlink(tmp)
        else:
            raise HTTPException(400, "Provide 'path' or 'zip_base64'")

        # Register scheduler jobs for newly installed adapter
        sched_module.register_adapter(m, _execute_task)
        return {"ok": True, "adapter": {"id": m.id, "name": m.name, "version": m.version}}
    except Exception as e:
        raise HTTPException(400, str(e))


@app.delete("/adapters/{adapter_id}")
def uninstall_adapter(adapter_id: str):
    if not adapter_loader.get_adapter(adapter_id):
        raise HTTPException(404, f"Adapter not found: {adapter_id}")
    sched_module.unregister_adapter(adapter_id)
    adapter_loader.uninstall(adapter_id)
    return {"ok": True}


class EnableRequest(BaseModel):
    enabled: bool


@app.patch("/adapters/{adapter_id}/enable")
def enable_adapter(adapter_id: str, req: EnableRequest):
    m = adapter_loader.get_adapter(adapter_id)
    if not m:
        raise HTTPException(404, f"Adapter not found: {adapter_id}")
    adapter_loader.set_enabled(adapter_id, req.enabled)
    if req.enabled:
        sched_module.register_adapter(m, _execute_task)
    else:
        sched_module.unregister_adapter(adapter_id)
    return {"ok": True, "enabled": req.enabled}


# ─── Tasks ───

@app.get("/tasks")
def list_tasks():
    result = []
    scheduled = {j['job_id']: j for j in sched_module.list_jobs()}
    for item in adapter_loader.list_all():
        m = adapter_loader.get_adapter(item['id'])
        if not m:
            continue
        for task in m.tasks:
            jid = f"{m.id}::{task.id}"
            last_run = data_sink.get_latest_run(m.id, task.id)
            result.append({
                "adapter_id": m.id,
                "adapter_name": m.name,
                "task_id": task.id,
                "task_name": task.name,
                "description": task.description,
                "execution_ui_mode": task.execution_ui_mode,
                "validation_only_label": task.validation_only_label,
                "auto_precheck_note": task.auto_precheck_note,
                "params": [_serialize_task_param(m.id, p) for p in task.params],
                "trigger": task.trigger.model_dump(),
                "enabled": item['enabled'],
                "next_run": scheduled.get(jid, {}).get('next_run'),
                "last_run": last_run,
                "live": _run_status.get(jid),
            })
    return result


class RunTaskRequest(BaseModel):
    params: Optional[dict] = None
    current_tab_id: Optional[str] = None


async def _run_task_background(adapter_id: str, task_id: str, params: dict, runtime_options: dict, run_control: Optional[dict]):
    try:
        await _execute_task(adapter_id, task_id, params, runtime_options, run_control=run_control)
    except Exception:
        logger.debug("Background task exited with recorded failure", exc_info=True)


@app.post("/tasks/{adapter_id}/{task_id}/run")
async def run_task(adapter_id: str, task_id: str, req: RunTaskRequest = RunTaskRequest()):
    m = adapter_loader.get_adapter(adapter_id)
    if not m:
        raise HTTPException(404, f"Adapter not found: {adapter_id}")
    if not any(t.id == task_id for t in m.tasks):
        raise HTTPException(404, f"Task not found: {task_id}")

    jid = f"{adapter_id}::{task_id}"
    live = _run_status.get(jid) or {}
    existing_control = _run_controls.get(jid)
    existing_task = existing_control.get('task') if existing_control else None
    if live.get('status') in ACTIVE_LIVE_STATUSES and ((existing_task and not existing_task.done()) or not existing_control):
        raise HTTPException(409, "任务正在运行中，请先暂停/继续/停止当前任务")

    run_control = _build_run_control()
    task_handle = asyncio.create_task(
        _run_task_background(
            adapter_id,
            task_id,
            req.params or {},
            {"current_tab_id": req.current_tab_id},
            run_control,
        )
    )
    run_control['task'] = task_handle
    _run_controls[jid] = run_control
    return {"ok": True, "message": "Task started in background"}


@app.post("/tasks/{adapter_id}/{task_id}/pause")
async def pause_task(adapter_id: str, task_id: str):
    jid = f"{adapter_id}::{task_id}"
    control = _run_controls.get(jid)
    live = _run_status.get(jid) or {}
    task = control.get('task') if control else None
    if not control or not task or task.done() or live.get('status') not in ACTIVE_LIVE_STATUSES:
        raise HTTPException(409, "任务当前未在运行，无法暂停")
    if live.get('status') in {'paused', 'pausing'}:
        return {"ok": True, "status": live.get('status')}

    control['pause_requested'] = True
    control['resume_event'].clear()
    _run_status[jid] = {**live, 'status': 'pausing'}
    _run_logs.setdefault(jid, []).append('[control] 收到暂停指令')
    return {"ok": True, "status": "pausing"}


@app.post("/tasks/{adapter_id}/{task_id}/resume")
async def resume_task(adapter_id: str, task_id: str):
    jid = f"{adapter_id}::{task_id}"
    control = _run_controls.get(jid)
    live = _run_status.get(jid) or {}
    task = control.get('task') if control else None
    if not control or not task or task.done() or live.get('status') not in {'paused', 'pausing'}:
        raise HTTPException(409, "任务当前未暂停，无法继续")

    control['pause_requested'] = False
    control['resume_event'].set()
    control['pause_logged'] = False
    _run_status[jid] = {**live, 'status': 'running'}
    _run_logs.setdefault(jid, []).append('[control] 收到继续指令')
    return {"ok": True, "status": "running"}


@app.post("/tasks/{adapter_id}/{task_id}/stop")
async def stop_task(adapter_id: str, task_id: str):
    jid = f"{adapter_id}::{task_id}"
    control = _run_controls.get(jid)
    live = _run_status.get(jid) or {}
    task = control.get('task') if control else None
    if not control or not task or task.done() or live.get('status') not in ACTIVE_LIVE_STATUSES:
        raise HTTPException(409, "任务当前未在运行，无法停止")

    control['stop_requested'] = True
    control['pause_requested'] = False
    control['resume_event'].set()
    _run_status[jid] = {**live, 'status': 'stopping'}
    _run_logs.setdefault(jid, []).append('[control] 收到停止指令')
    task.cancel()
    return {"ok": True, "status": "stopping"}


@app.get("/tasks/{adapter_id}/{task_id}/status")
def task_status(adapter_id: str, task_id: str):
    jid = f"{adapter_id}::{task_id}"
    live = _run_status.get(jid)
    last = data_sink.get_latest_run(adapter_id, task_id)
    return {"live": live, "last_run": last}


@app.get("/tasks/{adapter_id}/{task_id}/logs")
def task_logs(adapter_id: str, task_id: str):
    jid = f"{adapter_id}::{task_id}"
    return {"logs": _run_logs.get(jid, [])}


@app.delete("/tasks/{adapter_id}/{task_id}/logs")
def clear_task_logs(adapter_id: str, task_id: str):
    jid = f"{adapter_id}::{task_id}"
    _run_logs[jid] = []
    return {"ok": True}


# ─── Data ───

@app.get("/data/{adapter_id}/{task_id}")
def get_data(adapter_id: str, task_id: str, limit: int = 20):
    runs = data_sink.list_runs(adapter_id, task_id, limit=limit)
    return {"runs": runs}


@app.get("/data/{adapter_id}/{task_id}/export")
def export_data(adapter_id: str, task_id: str, format: str = "excel"):
    last = data_sink.get_latest_run(adapter_id, task_id)
    if not last or not last.get('output_files'):
        raise HTTPException(404, "No exported data found. Run the task first.")
    import json as _json
    files = _json.loads(last['output_files']) if isinstance(last['output_files'], str) else last['output_files']
    for f in files:
        if format == 'excel' and f.endswith('.xlsx'):
            return FileResponse(f, filename=Path(f).name)
        if format == 'json' and f.endswith('.json'):
            return FileResponse(f, filename=Path(f).name)
    raise HTTPException(404, f"No {format} export found")



# ─── File utilities ───

class ReadExcelRequest(BaseModel):
    path: str
    sheet: Optional[str] = None   # 不传则读第一个 sheet
    header_row: int = 1           # 第几行作为表头（1-indexed）




@app.post("/files/read-excel")
def read_excel(req: ReadExcelRequest):
    """读取本地 Excel / CSV 文件，返回 headers + rows 数组，供 JS 脚本批量处理"""
    res = _read_local_excel(req.path, req.sheet, req.header_row)
    if "error" in res:
        raise HTTPException(400, res["error"])
    return res


# ─── Settings ───

@app.get("/settings")
def get_settings():
    return load_config()


@app.put("/settings")
def put_settings(cfg: dict):
    save_config(cfg)
    reset_bridge()
    return {"ok": True}


class TestNotifyRequest(BaseModel):
    channel: str  # dingtalk | feishu | webhook


@app.post("/settings/test-notify")
def test_notify(req: TestNotifyRequest):
    try:
        notifier.send(
            channel=req.channel,
            title="🦐 抓虾通知测试",
            records=0,
            adapter_name="crawshrimp",
            task_name="测试通知",
            sample_rows=[{"状态": "✅ 通知配置正常", "渠道": req.channel}],
        )
        return {"ok": True, "msg": f"{req.channel} 通知发送成功"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/settings/chrome-tabs")
def chrome_tabs():
    try:
        tabs = get_bridge().get_tabs()
        return [{'id': t.get('id'), 'url': t.get('url'), 'title': t.get('title')}
                for t in tabs if t.get('type') == 'page']
    except ConnectionError as e:
        raise HTTPException(503, str(e))


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("CRAWSHRIMP_PORT", 18765))
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    )
    uvicorn.run(app, host="127.0.0.1", port=port)
