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
import json
import logging
import os
import re
import shutil
import tempfile
import zipfile
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
from core.browser_session import open_browser_session
from core.dev_harness import run_harness_capture, run_harness_eval, run_harness_snapshot
from core.dev_harness_models import DevHarnessCaptureRequest, DevHarnessEvalRequest, DevHarnessSnapshotRequest
from core.knowledge_service import ensure_knowledge_index, rebuild_knowledge_index, search_knowledge
from core.probe_models import ProbeRequest
from core.probe_service import read_probe_bundle, read_probe_bundle_full, run_probe_request
from core.shenhui_pdf_screenshot import finalize_pdf_batch_screenshot_outputs

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
    def normalize_range_text(value: str) -> str:
        return str(value or '').strip().replace(' ~ ', '~')

    if adapter_id == 'shein-helper':
        shein_context_js = r"""
(() => {
  const textOf = el => (el?.textContent || '').replace(/\s+/g, ' ').trim()
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim()
  const normalizeHyphenDate = value => {
    const match = clean(value).match(/\d{4}[-/]\d{2}[-/]\d{2}/)
    return match ? match[0].replace(/\//g, '-') : ''
  }
  const normalizeCompactDate = value => {
    const digits = clean(value).replace(/[^\d]/g, '')
    return digits.length >= 8
      ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
      : ''
  }
  const formatRange = (start, end) => {
    if (start && end) return `${start}~${end}`
    return start || end || ''
  }
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const feedbackTemplate = shared.api_template && typeof shared.api_template === 'object'
    ? shared.api_template
    : {}
  const feedbackFilter = feedbackTemplate.filter_payload && typeof feedbackTemplate.filter_payload === 'object'
    ? feedbackTemplate.filter_payload
    : (feedbackTemplate.payload && typeof feedbackTemplate.payload === 'object' ? feedbackTemplate.payload : {})
  const feedbackStart = normalizeHyphenDate(feedbackFilter.startCommentTime || feedbackFilter.commentStartTime || '')
  const feedbackEnd = normalizeHyphenDate(feedbackFilter.commentEndTime || feedbackFilter.endCommentTime || '')

  const templateQueue = Array.isArray(shared.api_templates)
    ? shared.api_templates.filter(item => item && typeof item === 'object')
    : []
  const merchandiseTemplate = templateQueue[0]
    || (shared.api_template && typeof shared.api_template === 'object' ? shared.api_template : {})
  const merchandiseFilter = merchandiseTemplate.filter_payload && typeof merchandiseTemplate.filter_payload === 'object'
    ? merchandiseTemplate.filter_payload
    : (merchandiseTemplate.payload && typeof merchandiseTemplate.payload === 'object' ? merchandiseTemplate.payload : {})
  const merchandiseStart = normalizeCompactDate(merchandiseFilter.startDate || merchandiseFilter.dt || '')
  const merchandiseEnd = normalizeCompactDate(merchandiseFilter.endDate || merchandiseFilter.dt || merchandiseFilter.startDate || '')

  const isCheckedButton = button => {
    if (!button) return false
    const className = String(button.className || '')
    if (/checked|Checked|active|Active/.test(className)) return true
    const ariaPressed = String(button.getAttribute?.('aria-pressed') || '').toLowerCase()
    if (ariaPressed === 'true') return true
    const radio = button.querySelector?.('input[type="radio"], input')
    return !!radio?.checked
  }
  const merchTimeScope = [...document.querySelectorAll('button')]
    .map(button => ({ button, label: clean(textOf(button)) }))
    .find(item => ['昨天', '近7天', '近30天', '自定义'].includes(item.label) && isCheckedButton(item.button))
    ?.label || ''

  return {
    success: true,
    data: [{
      review_date_range: formatRange(feedbackStart, feedbackEnd),
      merch_time_scope: merchTimeScope,
      merch_date_range: formatRange(merchandiseStart, merchandiseEnd),
    }],
    meta: { has_more: false }
  }
})()
"""

        page_ctx = await _evaluate_filename_context(runner, shein_context_js)
        ctx = {'shop_name': 'Shein'}

        if task_id == 'product_feedback':
            custom_range = run_params.get('review_date_range') or {}
            start = str(custom_range.get('start') or '').strip()
            end = str(custom_range.get('end') or '').strip()
            if start and end:
                ctx.update({
                    'time_scope': '自定义',
                    'date_range': f"{start}~{end}",
                })
            else:
                ctx.update({
                    'time_scope': '当前筛选',
                    'date_range': normalize_range_text(page_ctx.get('review_date_range') or '') or '当前筛选',
                })
            return ctx

        if task_id == 'merchandise_details':
            time_mode = str(run_params.get('time_mode') or '').strip().lower()
            scope_map = {
                'yesterday': '昨天',
                'last7': '近7天',
                'last30': '近30天',
                'custom': '自定义',
            }
            custom_range = run_params.get('custom_date_range') or {}
            start = str(custom_range.get('start') or '').strip()
            end = str(custom_range.get('end') or '').strip()
            if time_mode == 'custom' and start and end:
                ctx.update({
                    'time_scope': '自定义',
                    'date_range': f"{start}~{end}",
                })
            else:
                ctx.update({
                    'time_scope': scope_map.get(time_mode) or str(page_ctx.get('merch_time_scope') or '').strip() or '当前筛选',
                    'date_range': normalize_range_text(page_ctx.get('merch_date_range') or '') or '当前筛选',
                })
            return ctx

        ctx.setdefault('time_scope', '当前筛选')
        ctx.setdefault('date_range', '当前筛选')
        return ctx

    if adapter_id != 'temu':
        return {}

    backend_context_js = r"""
(() => {
  const textOf = el => (el?.textContent || '').replace(/\s+/g, ' ').trim()
  const normalizeShopName = value => String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+\d+\s*人关注.*$/, '')
    .trim()
  const shared = window.__CRAWSHRIMP_SHARED__ || {}
  const root = document.querySelector('[class*="userInfo"], [class*="seller-name"], [class*="account-info_userInfo"]')
  const blacklist = new Set(['服务市场', '履约中心', '学习', '运营对接', '规则中心', '消息', '客服', '反馈', '99+', '首页', '数据中心', '商品数据', 'TEMU Agent Center', 'Beta', 'Seller Central'])
  const seen = new Set()
  const candidates = []
  const push = text => {
    const clean = normalizeShopName(text)
    if (!clean || seen.has(clean)) return
    seen.add(clean)
    candidates.push(clean)
  }
  const sharedShopName = normalizeShopName(shared.shopName || shared.shop_name || '')
  const strictShopName = [...document.querySelectorAll('[class*="account-info_mallInfo__"], [class*="account-info_accountInfo__"]')]
    .map(el => normalizeShopName(textOf(el)))
    .find(text => text && text.length <= 80 && !blacklist.has(text)) || ''
  if (root) {
    push(textOf(root.querySelector('[class*="elli_outerWrapper"], [class*="seller-name"], [class*="shopName"], [class*="userName"]')))
    for (const el of root.querySelectorAll('*')) {
      const text = textOf(el)
      if (!text || text.length > 80) continue
      if ([...el.children].some(c => textOf(c) === text)) continue
      push(text)
    }
  }
  for (const el of document.querySelectorAll(
    '[class*="elli_outerWrapper"], [class*="mallInfo"], [class*="accountInfo"], [class*="account-info_mallInfo"], [class*="account-info_accountInfo"]'
  )) {
    const text = textOf(el)
    if (!text || text.length > 80) continue
    push(text)
  }
  const shopName =
    sharedShopName ||
    strictShopName ||
    candidates.find(text => /shop/i.test(text)) ||
    candidates.find(text => /[A-Za-z]/.test(text) && !blacklist.has(text)) ||
    candidates.find(text => !blacklist.has(text)) ||
    ''
  const rowContainsLabel = (row, label) => {
    if (!row || !label) return false
    if (textOf(row).includes(label)) return true
    return [...row.querySelectorAll('div, label, span, td, th, button, a')]
      .some(node => textOf(node).includes(label))
  }
  const timeRow = [...document.querySelectorAll('[class*="index-module__row___"]')].find(row => {
    const label = textOf(row.querySelector('[class*="index-module__row_label___"]'))
    if (label === '时间区间') return true
    if (label === '时间' && row.querySelector('input[data-testid="beast-core-rangePicker-htmlInput"]')) return true
    return false
  }) || null
  const reviewTimeRow = [...document.querySelectorAll('[class*="flat-field_item__"]')]
    .find(row => rowContainsLabel(row, '评价时间')) || null
  const timeScope = textOf(timeRow?.querySelector('input[data-testid="beast-core-select-htmlInput"]'))
  const dateRange = textOf(timeRow?.querySelector('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]'))
  const reviewActive = [...(reviewTimeRow?.querySelectorAll('[class*="flat-field_capsule__"]') || [])]
    .find(el => String(el.className || '').includes('flat-field_active__')) || null
  const reviewTimeScope = textOf(reviewActive)
  const reviewInput = reviewTimeRow?.querySelector('input[data-testid="beast-core-rangePicker-htmlInput"], input[class*="RPR_input_"]') || null
  const reviewDateRange = String(reviewInput?.value || '').trim() || (/^\d{4}-\d{2}-\d{2}\s*~\s*\d{4}-\d{2}-\d{2}$/.test(reviewTimeScope) ? reviewTimeScope : '')
  const activeOuterSite = textOf(
    [...document.querySelectorAll('a[class*="index-module__drItem___"]')]
      .find(el => String(el.className || '').includes('index-module__active___')) || null
  )
  return {
    success: true,
    data: [{
      shared_shop_name: sharedShopName,
      strict_shop_name: strictShopName,
      shop_name: shopName,
      time_scope: timeScope,
      date_range: dateRange,
      review_time_scope: reviewTimeScope,
      review_date_range: reviewDateRange,
      active_outer_site: activeOuterSite,
    }],
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
    if task_id not in {'reviews', 'store_items'}:
        page_ctx = await _evaluate_filename_context(runner, backend_context_js)
    elif task_id in {'reviews', 'store_items'}:
        page_ctx = await _evaluate_filename_context(runner, storefront_context_js)

    shared_shop_name = str(page_ctx.get('shared_shop_name') or '').strip()
    strict_shop_name = str(page_ctx.get('strict_shop_name') or '').strip()
    shop_name = shared_shop_name or strict_shop_name or str(page_ctx.get('shop_name') or '').strip()
    if not shop_name and task_id in {'reviews', 'store_items'}:
        shop_url = str(run_params.get('shop_url') or '').strip()
        if shop_url:
            try:
                parsed = urlparse(shop_url)
                shop_name = parse_qs(parsed.query).get('mall_id', [''])[0].strip()
            except Exception:
                shop_name = ''

    ctx = {'shop_name': shop_name or 'Temu店铺'}

    def normalize_temporal_value(value) -> str:
        if isinstance(value, str):
            return str(value or '').strip()
        if not value or not isinstance(value, dict):
            return ''
        direct = str(value.get('value') or '').strip()
        start = str(value.get('start') or '').strip()
        end = str(value.get('end') or '').strip()
        if direct:
            return direct
        if start and end:
            return f"{start}~{end}"
        return start or end

    def resolve_relative_range(label: str, mapping: dict[str, int]) -> str:
        label = str(label or '').strip()
        if not label:
            return ''
        today = datetime.now().date()
        if label == '今日':
            return f"{today.isoformat()}~{today.isoformat()}"
        if label == '昨日':
            day = today - timedelta(days=1)
            return f"{day.isoformat()}~{day.isoformat()}"
        if label == '本周':
            start_day = today - timedelta(days=today.weekday())
            return f"{start_day.isoformat()}~{today.isoformat()}"
        if label == '本月':
            start_day = today.replace(day=1)
            return f"{start_day.isoformat()}~{today.isoformat()}"
        days = mapping.get(label)
        if not days:
            return ''
        start_day = today - timedelta(days=days - 1)
        return f"{start_day.isoformat()}~{today.isoformat()}"

    def resolve_time_filename_context() -> dict:
        candidates = [
            {
                'time_param': 'review_time_range',
                'custom_param': 'custom_review_time_range',
                'page_scope_key': 'review_time_scope',
                'page_range_key': 'review_date_range',
                'relative_map': {'近30天': 30, '近60天': 60, '近90天': 90},
                'custom_scope_key': '',
                'custom_scope_label': '自定义',
            },
            {
                'time_param': 'time_range',
                'custom_param': 'custom_range',
                'page_scope_key': 'time_scope',
                'page_range_key': 'date_range',
                'relative_map': {'昨日': 1, '近7日': 7, '近30日': 30},
                'custom_scope_key': '',
                'custom_scope_label': '自定义',
            },
            {
                'time_param': 'return_time_range',
                'custom_param': 'custom_return_time_range',
                'page_scope_key': 'time_scope',
                'page_range_key': 'date_range',
                'relative_map': {'今日': 0, '昨日': 1, '近7日': 7, '近30日': 30},
                'custom_scope_key': 'return_time_field',
                'custom_scope_label': '自定义',
            },
            {
                'time_param': 'qc_time_range',
                'custom_param': 'custom_qc_time_range',
                'page_scope_key': 'time_scope',
                'page_range_key': 'date_range',
                'relative_map': {'今日': 0, '昨日': 1, '近7日': 7, '近30日': 30},
                'custom_scope_key': '',
                'custom_scope_label': '最新抽检时间',
            },
            {
                'time_param': '',
                'custom_param': 'custom_qc_time_range',
                'page_scope_key': '',
                'page_range_key': '',
                'relative_map': {},
                'custom_scope_key': '',
                'custom_scope_label': '最新抽检时间',
            },
            {
                'time_param': '',
                'custom_param': 'custom_return_time_range',
                'page_scope_key': '',
                'page_range_key': '',
                'relative_map': {},
                'custom_scope_key': 'return_time_field',
                'custom_scope_label': '自定义',
            },
            {
                'time_param': 'list_time_range',
                'custom_param': None,
                'page_scope_key': '',
                'page_range_key': '',
                'relative_map': {'近7日': 7, '近30日': 30},
                'custom_scope_key': '',
                'custom_scope_label': '自定义',
            },
            {
                'time_param': 'detail_time_range',
                'custom_param': None,
                'page_scope_key': '',
                'page_range_key': '',
                'relative_map': {'近7日': 7, '近30日': 30},
                'custom_scope_key': '',
                'custom_scope_label': '自定义',
            },
        ]

        for spec in candidates:
            time_param = spec['time_param']
            custom_param = spec['custom_param']
            if time_param not in run_params and custom_param not in run_params:
                continue

            time_range = str(run_params.get(time_param) or '').strip() if time_param else ''
            custom_range = run_params.get(custom_param) or {}
            start = str(custom_range.get('start') or '').strip()
            end = str(custom_range.get('end') or '').strip()
            page_time_scope = str(page_ctx.get(spec['page_scope_key']) or '').strip()
            page_date_range = normalize_range_text(page_ctx.get(spec['page_range_key']) or '')
            custom_scope = str(run_params.get(spec.get('custom_scope_key') or '') or '').strip()

            if start and end:
                return {
                    'time_scope': custom_scope or page_time_scope or spec.get('custom_scope_label') or '自定义',
                    'date_range': f"{start}~{end}",
                }

            if time_range == '自定义':
                return {
                    'time_scope': custom_scope or page_time_scope or spec.get('custom_scope_label') or '自定义',
                    'date_range': f"{start}~{end}" if start and end else (page_date_range or '自定义'),
                }
            if time_range:
                return {
                    'time_scope': time_range,
                    'date_range': page_date_range or resolve_relative_range(time_range, spec['relative_map']) or time_range,
                }
            return {
                'time_scope': page_time_scope or '当前筛选',
                'date_range': page_date_range or resolve_relative_range(page_time_scope, spec['relative_map']) or page_time_scope or '当前筛选',
            }

        date_range_specs = [
            ('stat_date_range', '统计日期'),
            ('stat_week', '按周'),
            ('stat_month', '按月'),
            ('bill_date_range', '对账日期'),
        ]
        for param_key, scope_label in date_range_specs:
            if param_key not in run_params:
                continue
            value = normalize_temporal_value(run_params.get(param_key))
            if not value:
                continue
            return {'time_scope': scope_label, 'date_range': normalize_range_text(value)}

        return {}

    ctx.update(resolve_time_filename_context())
    ctx.setdefault('time_scope', '当前筛选')
    ctx.setdefault('date_range', '当前筛选')

    def normalize_list_scope(value, empty_label: str) -> str:
        if not isinstance(value, list):
            return empty_label
        clean_values = [str(item).strip() for item in value if str(item).strip()]
        return '+'.join(clean_values) if clean_values else empty_label

    regions = run_params.get('regions') or []
    ctx['region_scope'] = normalize_list_scope(regions, '全部地区')
    ctx['site_scope'] = normalize_list_scope(run_params.get('outer_sites') or [], '全部站点')
    ctx['detail_site_scope'] = normalize_list_scope(run_params.get('detail_sites') or [], '全部详情站点')
    ctx['detail_grain_scope'] = normalize_list_scope(run_params.get('detail_grains') or [], '全部粒度')

    stat_grain = str(run_params.get('stat_grain') or '').strip()
    if stat_grain:
        ctx['grain_scope'] = stat_grain
    elif 'stat_grain' in run_params:
        ctx['grain_scope'] = '当前粒度'
    else:
        ctx['grain_scope'] = '当前粒度'

    goods_statuses = run_params.get('goods_statuses') or []
    ctx['goods_status_scope'] = normalize_list_scope(goods_statuses, '全部状态')
    qc_statuses = run_params.get('qc_statuses') or []
    ctx['qc_status_scope'] = normalize_list_scope(qc_statuses, '全部结果')
    if task_id == 'recommended_retail_price':
        ctx['status_scope'] = '全部状态'
    if task_id == 'quality_dashboard':
        ctx['quality_tab_scope'] = '品质分析+品质优化'

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


def _normalize_export_guard_value(value) -> str:
    return str(value or '').strip()


def _dedupe_temu_goods_traffic_detail_rows(data_rows):
    if not isinstance(data_rows, list):
        return data_rows

    deduped = []
    seen = set()

    for row in data_rows:
        if not isinstance(row, dict):
            deduped.append(row)
            continue

        if _normalize_export_guard_value(row.get('记录类型')) != '明细':
            deduped.append(row)
            continue

        outer_site = _normalize_export_guard_value(row.get('外层站点'))
        spu = _normalize_export_guard_value(row.get('SPU'))
        detail_site = _normalize_export_guard_value(row.get('详情站点筛选'))
        detail_grain = _normalize_export_guard_value(row.get('详情时间粒度'))
        date = _normalize_export_guard_value(row.get('日期'))
        site = _normalize_export_guard_value(row.get('站点'))

        # 仅对明细行做最终去重保险，避免误伤异常行或上下文不完整的记录。
        if not all([spu, detail_site, detail_grain, date, site]):
            deduped.append(row)
            continue

        key = (outer_site, spu, detail_site, detail_grain, date, site)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)

    return deduped


def _apply_final_export_guards(adapter_id: str, task_id: str, data_rows):
    guarded = data_rows if isinstance(data_rows, list) else list(data_rows or [])
    if adapter_id == 'temu' and task_id == 'goods_traffic_detail':
        guarded = _dedupe_temu_goods_traffic_detail_rows(guarded)
    return guarded


def _safe_local_name(value: str, fallback: str = "item") -> str:
    text = str(value or "").strip()
    text = re.sub(r'[\x00-\x1f]+', '', text)
    text = re.sub(r'[\\/:*?"<>|]+', '_', text)
    text = re.sub(r'\s+', ' ', text).strip(' ._')
    return text or fallback


def _ensure_unique_local_path(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    index = 2
    while True:
        candidate = path.with_name(f"{stem}_{index}{suffix}")
        if not candidate.exists():
            return candidate
        index += 1


def _ensure_unique_local_dir(path: Path) -> Path:
    if not path.exists():
        return path
    index = 2
    while True:
        candidate = path.with_name(f"{path.name}_{index}")
        if not candidate.exists():
            return candidate
        index += 1


def _parse_semir_cloud_path(raw_value: str) -> dict:
    raw = str(raw_value or "").strip()
    divider = raw.find("//")
    if divider < 0:
      return {"mount_name": "", "relative_path": "", "relative_prefix": ""}
    mount_name = str(raw[:divider]).strip()
    relative_path = "/".join(
        part.strip()
        for part in raw[divider + 2:].replace("\\", "/").split("/")
        if str(part or "").strip()
    )
    return {
        "mount_name": mount_name,
        "relative_path": relative_path,
        "relative_prefix": f"{relative_path}/" if relative_path else "",
    }


def _normalize_semir_package_layout(raw_value: str) -> str:
    return "flat" if str(raw_value or "").strip().lower() == "flat" else "by_code"


def _semir_output_folder_and_filename(
    fullpath: str,
    relative_path: str,
    fallback_name: str,
    preferred_filename: str = "",
) -> tuple[str, str]:
    normalized_fullpath = str(fullpath or "").replace("\\", "/").strip("/")
    normalized_base = str(relative_path or "").replace("\\", "/").strip("/")
    preferred_clean_name = (
        _safe_local_name(preferred_filename, "")
        if str(preferred_filename or "").strip()
        else ""
    )

    if normalized_fullpath:
        tail = normalized_fullpath
    elif normalized_base:
        tail = f"{normalized_base}/{fallback_name}"
    else:
        tail = fallback_name

    safe_parts = [_safe_local_name(part, "item") for part in tail.split("/") if str(part or "").strip()]
    if not safe_parts:
        clean_name = preferred_clean_name or _safe_local_name(fallback_name, "file")
        return ("未分类路径", clean_name)

    if len(safe_parts) == 1:
        clean_name = preferred_clean_name or _safe_local_name(safe_parts[0], _safe_local_name(fallback_name, "file"))
        return ("未分类路径", clean_name)

    clean_name = preferred_clean_name or _safe_local_name(safe_parts[-1], _safe_local_name(fallback_name, "file"))
    folder_name = "__".join(part for part in safe_parts[:-1] if str(part or "").strip()) or "未分类路径"
    return (_safe_local_name(folder_name, "未分类路径"), clean_name)


def _build_semir_package_target(
    package_root: Path,
    input_code: str,
    folder_name: str,
    clean_filename: str,
    *,
    package_layout: str,
    preserve_path: bool,
) -> Path:
    if _normalize_semir_package_layout(package_layout) == "flat":
        return package_root / clean_filename
    if preserve_path:
        return package_root / input_code / folder_name / clean_filename
    return package_root / input_code / clean_filename


def _copy_file_to_unique_target(source: Path, target: Path) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    unique_target = _ensure_unique_local_path(target)
    shutil.copy2(source, unique_target)
    return unique_target


def _cleanup_semir_runtime_artifacts(runtime_files: list, package_root: Optional[Path]) -> None:
    for file_path in runtime_files or []:
        source = Path(str(file_path or "")).expanduser()
        try:
            if source.exists() and source.is_file():
                source.unlink()
        except Exception:
            logger.debug("Failed to clean semir runtime file %s", source, exc_info=True)

    try:
        if package_root and package_root.exists() and package_root.is_dir():
            shutil.rmtree(package_root)
    except Exception:
        logger.debug("Failed to clean semir package root %s", package_root, exc_info=True)


def _cleanup_shenhui_runtime_artifacts(runtime_files: list, package_root: Optional[Path], work_dir: Optional[Path]) -> None:
    _cleanup_semir_runtime_artifacts(runtime_files, package_root)
    try:
        if work_dir and work_dir.exists() and work_dir.is_dir():
            shutil.rmtree(work_dir)
    except Exception:
        logger.debug("Failed to clean shenhui work dir %s", work_dir, exc_info=True)


def _finalize_shenhui_new_arrival_outputs(
    task_id: str,
    data_rows: list,
    runtime_files: list,
    exported_files: list,
    run_params: dict,
    runtime_artifact_dir: str,
    log,
) -> list[str]:
    if task_id == "pdf_batch_screenshot":
        return finalize_pdf_batch_screenshot_outputs(
            data_rows=data_rows,
            exported_files=exported_files,
            run_params=run_params,
            runtime_artifact_dir=runtime_artifact_dir,
            log=log,
        )

    if task_id != "prepare_upload_package":
        return [str(path) for path in (runtime_files or []) + (exported_files or []) if str(path or "").strip()]

    runtime_dir = Path(runtime_artifact_dir)
    runtime_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    package_base = _safe_local_name(
        run_params.get("package_name") or f"深绘上新图包_{timestamp}",
        f"深绘上新图包_{timestamp}",
    )
    package_root = _ensure_unique_local_dir(runtime_dir / package_base)
    pdf_work_dir = _ensure_unique_local_dir(runtime_dir / f"{package_root.name}_pdf_work")

    successful_rows = []
    for row in data_rows or []:
        if not isinstance(row, dict):
            continue
        local_path = Path(str(row.get("本地文件") or "")).expanduser()
        if str(row.get("下载结果") or "").strip() != "已下载" or not local_path.is_file():
            continue
        successful_rows.append((row, local_path))

    style_zip_paths = []
    zip_path = None
    if successful_rows:
        for row, local_path in successful_rows:
            group_code = _safe_local_name(
                row.get("__shenhui_group_code") or row.get("输入款号") or row.get("输入编码") or "未分类",
                "未分类",
            )
            role = str(row.get("__shenhui_asset_role") or "").strip().lower()

            if role == "pdf_yq" or local_path.suffix.lower() == ".pdf":
                target = package_root / group_code / "_PDF待裁图" / _safe_local_name(local_path.name, "label.pdf")
                _copy_file_to_unique_target(local_path, target)
                continue

            clean_filename = _safe_local_name(
                row.get("__package_filename") or row.get("文件名") or local_path.name,
                local_path.name,
            )
            target = package_root / group_code / clean_filename
            _copy_file_to_unique_target(local_path, target)

        style_zip_dir = _ensure_unique_local_dir(runtime_dir / f"{package_root.name}_deepdraw_zips")
        style_zip_dir.mkdir(parents=True, exist_ok=True)
        for style_dir in sorted(path for path in package_root.iterdir() if path.is_dir()):
            if style_dir.name.startswith("_"):
                continue
            style_zip_path = _ensure_unique_local_path(style_zip_dir / f"{style_dir.name}.zip")
            with zipfile.ZipFile(style_zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for file_path in sorted(style_dir.rglob("*")):
                    if not file_path.is_file():
                        continue
                    archive.write(file_path, arcname=str(file_path.relative_to(style_dir)))
            style_zip_paths.append(style_zip_path)
        if style_zip_paths:
            log(f"Shenhui DeepDraw style ZIPs created: {len(style_zip_paths)}")

        zip_path = _ensure_unique_local_path(runtime_dir / f"{package_root.name}.zip")
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for file_path in package_root.rglob("*"):
                if not file_path.is_file():
                    continue
                archive.write(file_path, arcname=str(file_path.relative_to(package_root.parent)))
        log(f"Shenhui package created: {zip_path}")

    export_folder = str(run_params.get("export_folder") or "").strip()
    runtime_refs = [str(path) for path in style_zip_paths if str(path or "").strip()]
    if zip_path:
        runtime_refs.append(str(zip_path))
    runtime_refs.extend(str(path) for path in exported_files or [] if str(path or "").strip())
    final_refs = runtime_refs

    if export_folder:
        target_root = Path(export_folder).expanduser()
        target_root.mkdir(parents=True, exist_ok=True)
        external_refs = []

        if successful_rows and package_root.exists():
            external_dir = _ensure_unique_local_dir(target_root / package_root.name)
            shutil.copytree(package_root, external_dir)
            for style_zip_path in style_zip_paths:
                if style_zip_path.exists():
                    copied_style_zip = _copy_file_to_unique_target(style_zip_path, target_root / style_zip_path.name)
                    external_refs.append(str(copied_style_zip))
            if zip_path and zip_path.exists():
                copied_zip = _copy_file_to_unique_target(zip_path, target_root / zip_path.name)
                external_refs.append(str(copied_zip))
            log(f"Shenhui package copied to export folder: {external_dir}")

        for file_path in exported_files or []:
            source = Path(str(file_path or "")).expanduser()
            if not source.is_file():
                continue
            copied = _copy_file_to_unique_target(source, target_root / source.name)
            external_refs.append(str(copied))

        if external_refs:
            final_refs = external_refs

    if zip_path and zip_path.exists():
        _cleanup_shenhui_runtime_artifacts(runtime_files, package_root, pdf_work_dir)
    elif pdf_work_dir.exists():
        shutil.rmtree(pdf_work_dir, ignore_errors=True)

    return final_refs


def _build_semir_ai_material_entries(data_rows: list) -> list[dict]:
    entries = []
    for row in data_rows or []:
        if not isinstance(row, dict):
            continue
        input_code = _safe_local_name(str(row.get("输入编码") or "").strip(), "未分类")
        materials = row.get("__素材明细") or []
        if not isinstance(materials, list):
            continue
        for material in materials:
            if not isinstance(material, dict):
                continue
            local_path = Path(str(material.get("local_path") or "")).expanduser()
            if not local_path.is_file():
                continue
            entries.append({
                "input_code": input_code,
                "filename": str(material.get("filename") or local_path.name).strip() or local_path.name,
                "cloud_path": str(material.get("cloud_path") or "").strip(),
                "local_path": local_path,
                "preserve_path": True,
            })
    return entries


def _build_semir_ai_generated_entries(data_rows: list) -> list[dict]:
    entries = []
    for row in data_rows or []:
        if not isinstance(row, dict):
            continue
        input_code = _safe_local_name(str(row.get("输入编码") or "").strip(), "未分类")
        generated = row.get("__生成图明细") or []
        if not isinstance(generated, list):
            continue
        for item in generated:
            if not isinstance(item, dict):
                continue
            local_path = Path(str(item.get("local_path") or "")).expanduser()
            if not local_path.is_file():
                continue
            entries.append({
                "input_code": input_code,
                "filename": str(item.get("filename") or local_path.name).strip() or local_path.name,
                "cloud_path": "",
                "local_path": local_path,
                "preserve_path": False,
            })
    return entries


def _create_semir_ai_zip(
    entries: list[dict],
    *,
    runtime_dir: Path,
    output_root: Path,
    package_base: str,
    relative_path: str,
    flatten_code_folder: bool,
    log,
) -> Optional[str]:
    if not entries:
        return None

    package_root = _ensure_unique_local_dir(runtime_dir / package_base)
    for entry in entries:
        folder_name, clean_filename = _semir_output_folder_and_filename(
            entry.get("cloud_path") or "",
            relative_path,
            entry.get("filename") or entry["local_path"].name,
        )
        target = _build_semir_package_target(
            package_root,
            entry["input_code"],
            folder_name,
            clean_filename,
            package_layout="by_code",
            preserve_path=bool(entry.get("preserve_path")) and not flatten_code_folder,
        )
        _copy_file_to_unique_target(entry["local_path"], target)

    output_root.mkdir(parents=True, exist_ok=True)
    zip_path = _ensure_unique_local_path(output_root / f"{package_root.name}.zip")
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file_path in package_root.rglob("*"):
            if not file_path.is_file():
                continue
            archive.write(file_path, arcname=str(file_path.relative_to(package_root.parent)))
    shutil.rmtree(package_root, ignore_errors=True)
    log(f"Semir AI package created: {zip_path}")
    return str(zip_path)


def _finalize_semir_cloud_drive_outputs(
    task_id: str,
    data_rows: list,
    runtime_files: list,
    exported_files: list,
    run_params: dict,
    runtime_artifact_dir: str,
    log,
) -> list[str]:
    if task_id != "batch_image_download":
        if task_id == "batch_ai_generate":
            runtime_dir = Path(runtime_artifact_dir)
            runtime_dir.mkdir(parents=True, exist_ok=True)
            exported_refs = [str(path) for path in exported_files or [] if str(path or "").strip()]
            output_root = Path(str(exported_refs[0])).expanduser().parent if exported_refs else runtime_dir
            cloud = _parse_semir_cloud_path(run_params.get("cloud_path"))
            relative_path = cloud.get("relative_path") or ""
            duplicate_mode = str(run_params.get("duplicate_mode") or "first_per_stem").strip().lower()
            flatten_code_folder = duplicate_mode != "all"
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            final_refs: list[str] = []

            generated_zip = _create_semir_ai_zip(
                _build_semir_ai_generated_entries(data_rows),
                runtime_dir=runtime_dir,
                output_root=output_root,
                package_base=_safe_local_name(
                    run_params.get("generated_package_name") or f"森马云盘AI生成图包_{timestamp}",
                    f"森马云盘AI生成图包_{timestamp}",
                ),
                relative_path="",
                flatten_code_folder=True,
                log=log,
            )
            if generated_zip:
                final_refs.append(generated_zip)

            package_mode = str(run_params.get("material_package_mode") or "discard").strip().lower()
            if package_mode == "zip":
                material_zip = _create_semir_ai_zip(
                    _build_semir_ai_material_entries(data_rows),
                    runtime_dir=runtime_dir,
                    output_root=output_root,
                    package_base=_safe_local_name(
                        run_params.get("material_package_name") or f"森马云盘AI素材包_{timestamp}",
                        f"森马云盘AI素材包_{timestamp}",
                    ),
                    relative_path=relative_path,
                    flatten_code_folder=flatten_code_folder,
                    log=log,
                )
                if material_zip:
                    final_refs.append(material_zip)

            _cleanup_semir_runtime_artifacts(runtime_files, None)
            return [*final_refs, *exported_refs]

        return [str(path) for path in (runtime_files or []) + (exported_files or []) if str(path or "").strip()]

    runtime_dir = Path(runtime_artifact_dir)
    runtime_dir.mkdir(parents=True, exist_ok=True)

    cloud = _parse_semir_cloud_path(run_params.get("cloud_path"))
    relative_path = cloud.get("relative_path") or ""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    package_base = _safe_local_name(
        run_params.get("package_name") or f"森马云盘图片包_{timestamp}",
        f"森马云盘图片包_{timestamp}",
    )
    package_root = _ensure_unique_local_dir(runtime_dir / package_base)
    duplicate_mode = str(run_params.get("duplicate_mode") or "first_per_stem").strip().lower()
    package_layout = _normalize_semir_package_layout(run_params.get("package_layout"))
    preserve_path = duplicate_mode == "all"

    successful_rows = []
    for row in data_rows or []:
        if not isinstance(row, dict):
            continue
        local_path = Path(str(row.get("本地文件") or "")).expanduser()
        if str(row.get("下载结果") or "").strip() != "已下载" or not local_path.is_file():
            continue
        successful_rows.append((row, local_path))

    zip_path = None
    if successful_rows:
        for row, local_path in successful_rows:
            input_code = _safe_local_name(row.get("输入编码") or "未分类", "未分类")
            folder_name, clean_filename = _semir_output_folder_and_filename(
                row.get("云盘路径") or "",
                relative_path,
                row.get("文件名") or local_path.name,
                row.get("__package_filename") or "",
            )
            target = _build_semir_package_target(
                package_root,
                input_code,
                folder_name,
                clean_filename,
                package_layout=package_layout,
                preserve_path=preserve_path,
            )
            _copy_file_to_unique_target(local_path, target)

        zip_path = _ensure_unique_local_path(runtime_dir / f"{package_root.name}.zip")
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for file_path in package_root.rglob("*"):
                if not file_path.is_file():
                    continue
                archive.write(file_path, arcname=str(file_path.relative_to(package_root.parent)))
        log(f"Semir package created: {zip_path}")

    export_folder = str(run_params.get("export_folder") or "").strip()
    runtime_refs = [str(path) for path in exported_files or [] if str(path or "").strip()]
    if zip_path:
        runtime_refs.insert(0, str(zip_path))
    final_refs = runtime_refs

    if export_folder:
        target_root = Path(export_folder).expanduser()
        target_root.mkdir(parents=True, exist_ok=True)
        external_refs = []

        if successful_rows and package_root.exists():
            external_dir = _ensure_unique_local_dir(target_root / package_root.name)
            shutil.copytree(package_root, external_dir)
            if zip_path and zip_path.exists():
                copied_zip = _copy_file_to_unique_target(zip_path, target_root / zip_path.name)
                external_refs.append(str(copied_zip))
            log(f"Semir package copied to export folder: {external_dir}")

        for file_path in exported_files or []:
            source = Path(str(file_path or "")).expanduser()
            if not source.is_file():
                continue
            copied = _copy_file_to_unique_target(source, target_root / source.name)
            external_refs.append(str(copied))

        if external_refs:
            final_refs = external_refs

    if zip_path and zip_path.exists():
        _cleanup_semir_runtime_artifacts(runtime_files, package_root)

    return final_refs


def _rows_raw_to_table(rows_raw, header_row: int = 1):
    if not rows_raw:
        return {"headers": [], "rows": [], "total": 0}

    hi = header_row - 1
    if hi < 0 or hi >= len(rows_raw):
        return {"error": f"Header row index {hi} out of range", "headers": [], "rows": [], "total": 0}

    def _stringify_row(raw_row):
        return [str(c) if c is not None else '' for c in raw_row]

    def _dedupe_headers(raw_headers):
        used = {}
        headers = []
        for index, raw_header in enumerate(raw_headers):
            header = str(raw_header or '').strip() or f"列{index + 1}"
            if header not in used:
                used[header] = 1
                headers.append(header)
                continue
            used[header] += 1
            headers.append(f"{header}_{used[header]}")
        return headers

    def _build_headers():
        primary = _stringify_row(rows_raw[hi])
        if hi + 1 >= len(rows_raw):
            return _dedupe_headers(primary), hi + 1

        secondary = _stringify_row(rows_raw[hi + 1])
        width = max(len(primary), len(secondary))
        # Only collapse when row 2 is clearly filling blanks from row 1.
        # Trailing blank header cells in wide templates should not treat row 2 as another header row.
        has_grouped_children = any(
            not str(primary[index] if index < len(primary) else '').strip()
            and str(secondary[index] if index < len(secondary) else '').strip()
            for index in range(width)
        )
        if not has_grouped_children:
            return _dedupe_headers(primary), hi + 1

        merged_headers = []
        last_parent = ''
        for index in range(width):
            parent = str(primary[index] if index < len(primary) else '').strip()
            child = str(secondary[index] if index < len(secondary) else '').strip()
            if parent:
                last_parent = parent
            effective_parent = parent or (last_parent if child else '')
            if child and effective_parent and child != effective_parent:
                merged_headers.append(f"{effective_parent}/{child}")
            else:
                merged_headers.append(effective_parent or child or f"列{index + 1}")

        return _dedupe_headers(merged_headers), hi + 2

    headers, data_start_index = _build_headers()
    rows = []
    for raw in rows_raw[data_start_index:]:
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
        search_total_codes = int(shared_state.get('search_total_codes') or 0)
        search_completed_codes = int(shared_state.get('search_completed_codes') or 0)
        generation_total_jobs = int(shared_state.get('generation_total_jobs') or 0)
        generation_completed_jobs = int(shared_state.get('generation_completed_jobs') or 0)
        buyer_id = str(shared_state.get('current_buyer_id') or '').strip()
        store = str(shared_state.get('current_store') or '').strip()
        current_source_filename = str(shared_state.get('current_source_filename') or '').strip()
        phase_name = str((payload or {}).get('phase') or '').strip()
        records = int((payload or {}).get('records') or 0)
        download_total = int(run_control.get('download_total') or 0) if run_control else int((payload or {}).get('download_total') or (payload or {}).get('download_item_total') or 0)
        download_completed = int(run_control.get('download_completed') or 0) if run_control else int((payload or {}).get('download_completed') or 0)
        download_success = int(run_control.get('download_success') or 0) if run_control else int((payload or {}).get('download_success') or 0)
        download_failed = int(run_control.get('download_failed') or 0) if run_control else int((payload or {}).get('download_failed') or 0)
        download_concurrency = int(run_control.get('download_concurrency') or 0) if run_control else int((payload or {}).get('download_concurrency') or 0)
        download_retry_attempts = int(run_control.get('download_retry_attempts') or 0) if run_control else int((payload or {}).get('download_retry_attempts') or 0)
        download_started = bool(run_control.get('download_started')) if run_control else bool(download_total > 0)
        download_active = bool(run_control.get('download_active')) if run_control else bool((payload or {}).get('download_active'))
        download_last_label = str((run_control.get('download_last_label') if run_control else (payload or {}).get('download_last_label')) or '').strip()

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
            "search_total_codes": search_total_codes,
            "search_completed_codes": search_completed_codes,
            "generation_total_jobs": generation_total_jobs,
            "generation_completed_jobs": generation_completed_jobs,
            "buyer_id": buyer_id,
            "store": store,
            "current_source_filename": current_source_filename,
            "phase": phase_name,
            "completed": records,
            "percent": percent,
            "progress_text": progress_text,
            "download_total": download_total,
            "download_completed": download_completed,
            "download_success": download_success,
            "download_failed": download_failed,
            "download_concurrency": download_concurrency,
            "download_retry_attempts": download_retry_attempts,
            "download_started": download_started,
            "download_active": download_active,
            "download_last_label": download_last_label,
        }

    async def wait_for_control(payload: Optional[dict] = None):
        if not run_control:
            return

        payload = dict(payload or {})
        kind = str(payload.get('kind') or '').strip()

        if kind == 'before_download_urls':
            download_total = int(payload.get('download_item_total') or 0)
            run_control['download_total'] = download_total
            run_control['download_completed'] = 0
            run_control['download_success'] = 0
            run_control['download_failed'] = 0
            run_control['download_concurrency'] = int(payload.get('download_concurrency') or 0)
            run_control['download_retry_attempts'] = int(payload.get('download_retry_attempts') or 0)
            run_control['download_started'] = download_total > 0
            run_control['download_active'] = download_total > 0
            run_control['download_last_label'] = ''
        elif kind == 'download_urls_progress':
            if 'download_total' in payload:
                run_control['download_total'] = int(payload.get('download_total') or 0)
            if 'download_completed' in payload:
                run_control['download_completed'] = int(payload.get('download_completed') or 0)
            if 'download_success' in payload:
                run_control['download_success'] = int(payload.get('download_success') or 0)
            if 'download_failed' in payload:
                run_control['download_failed'] = int(payload.get('download_failed') or 0)
            if 'download_active' in payload:
                run_control['download_active'] = bool(payload.get('download_active'))
            if 'download_last_label' in payload:
                run_control['download_last_label'] = str(payload.get('download_last_label') or '').strip()
            run_control['download_started'] = bool(run_control.get('download_total') or run_control.get('download_completed'))
        elif kind == 'before_phase' and str(payload.get('phase') or '').strip() == 'finalize_all':
            run_control['download_active'] = False

        records = int(payload.get('records') or 0)
        progress = build_progress(payload)
        base_status = {
            'run_id': run_id,
            'records': records,
            'current': progress['current'],
            'total': progress['total'],
            'row_no': progress['row_no'],
            'batch_no': progress['batch_no'],
            'total_batches': progress['total_batches'],
            'search_total_codes': progress['search_total_codes'],
            'search_completed_codes': progress['search_completed_codes'],
            'generation_total_jobs': progress['generation_total_jobs'],
            'generation_completed_jobs': progress['generation_completed_jobs'],
            'buyer_id': progress['buyer_id'],
            'store': progress['store'],
            'current_source_filename': progress['current_source_filename'],
            'phase': progress['phase'],
            'completed': progress['completed'],
            'percent': progress['percent'],
            'progress_text': progress['progress_text'],
            'download_total': progress['download_total'],
            'download_completed': progress['download_completed'],
            'download_success': progress['download_success'],
            'download_failed': progress['download_failed'],
            'download_concurrency': progress['download_concurrency'],
            'download_retry_attempts': progress['download_retry_attempts'],
            'download_started': progress['download_started'],
            'download_active': progress['download_active'],
            'download_last_label': progress['download_last_label'],
        }

        # 通用批处理进度：只要行号前进，就打印一次，不绑定具体 adapter / phase。
        if (
            payload.get('kind') == 'before_phase' and
            progress['current'] > 0 and
            progress['total'] > 0 and
            progress['current'] != int(run_control.get('last_progress_exec_no') or 0)
        ):
            extra_parts = []
            if progress['batch_no'] > 0 and progress['total_batches'] > 0:
                extra_parts.append(f"批次 {progress['batch_no']}/{progress['total_batches']}")
            if progress['row_no'] > 0:
                extra_parts.append(f"源表行 {progress['row_no']}")
            if progress['buyer_id']:
                extra_parts.append(f"目标 {progress['buyer_id']}")
            suffix = f" · {' · '.join(extra_parts)}" if extra_parts else ""
            log(f"[progress] 第 {progress['current']}/{progress['total']} 条 · 已完成 {records} 条{suffix}")
            run_control['last_progress_exec_no'] = progress['current']

        if (
            payload.get('kind') == 'before_download_urls' and
            progress['current'] > 0 and
            progress['total'] > 0
        ):
            download_total = int(payload.get('download_item_total') or 0)
            concurrency = int(payload.get('download_concurrency') or 0)
            retry_attempts = int(payload.get('download_retry_attempts') or 0)
            marker = f"{progress['current']}::{download_total}::{concurrency}::{retry_attempts}"
            if marker != str(run_control.get('last_download_marker') or ''):
                target_text = f" · 目标 {progress['buyer_id']}" if progress['buyer_id'] else ""
                count_text = f" · {download_total} 个文件" if download_total > 0 else ""
                concurrency_text = f" · 并发 {concurrency}" if concurrency > 0 else ""
                retry_text = f" · 重试 {retry_attempts} 次" if retry_attempts > 1 else ""
                log(f"[download] 第 {progress['current']}/{progress['total']} 条{target_text}{count_text}{concurrency_text}{retry_text}，开始下载")
                run_control['last_download_marker'] = marker

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
    runtime_artifact_dir = data_sink.prepare_artifact_dir(adapter_id, task_id, run_id, "runtime")

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
            tab_url=str(tab.get('url') or ''),
            artifact_dir=runtime_artifact_dir,
        )

        def merge_output_file_refs(*groups):
            merged = []
            seen = set()
            for group in groups:
                for item in group or []:
                    path = str(item or '').strip()
                    if not path or path in seen:
                        continue
                    seen.add(path)
                    merged.append(path)
            return merged

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
                        column_groups=getattr(out, 'column_groups', None),
                        sheet_key=getattr(out, 'sheet_key', None),
                        sheet_configs=getattr(out, 'sheets', None),
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

        def finalize_output_files(data_rows, runtime_files, exported_files):
            if adapter_id == 'semir-cloud-drive':
                try:
                    packaged_refs = _finalize_semir_cloud_drive_outputs(
                        task_id=task_id,
                        data_rows=data_rows,
                        runtime_files=runtime_files,
                        exported_files=exported_files,
                        run_params=run_params,
                        runtime_artifact_dir=runtime_artifact_dir,
                        log=log,
                    )
                    return merge_output_file_refs(packaged_refs)
                except Exception as package_error:
                    log(f"[warn] semir 后处理失败，回退到原始输出: {package_error}")
                    return merge_output_file_refs(runtime_files, exported_files)

            if adapter_id == 'shenhui-new-arrival':
                try:
                    packaged_refs = _finalize_shenhui_new_arrival_outputs(
                        task_id=task_id,
                        data_rows=data_rows,
                        runtime_files=runtime_files,
                        exported_files=exported_files,
                        run_params=run_params,
                        runtime_artifact_dir=runtime_artifact_dir,
                        log=log,
                    )
                    return merge_output_file_refs(packaged_refs)
                except Exception as package_error:
                    log(f"[warn] 深绘图包后处理失败，回退到原始输出: {package_error}")
                    return merge_output_file_refs(runtime_files, exported_files)

            return merge_output_file_refs(runtime_files, exported_files)

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
        raw_count = len(data)
        data = _apply_final_export_guards(adapter_id, task_id, data)
        deduped_count = len(data)
        log(f"Script complete. Records: {raw_count}")
        if deduped_count != raw_count:
            log(f"Final export guard removed {raw_count - deduped_count} duplicate rows before export")

        runtime_files = list(getattr(runner, 'runtime_output_files', []) or [])
        exported_files = await export_outputs(data)
        output_files = finalize_output_files(data, runtime_files, exported_files)
        data_sink.finish_run(run_id, len(data), output_files)
        _run_status[jid] = {'status': 'done', 'run_id': run_id, 'records': len(data)}
        log(f"[{adapter_id}/{task_id}] Done. {len(data)} records.")

    except RunAbortedError as e:
        err = e.reason or str(e)
        data = list(e.partial_data or data or [])
        raw_count = len(data)
        data = _apply_final_export_guards(adapter_id, task_id, data)
        deduped_count = len(data)
        if deduped_count != raw_count:
            log(f"Final export guard removed {raw_count - deduped_count} duplicate rows before partial export")
        if run_control:
            run_control['pause_requested'] = False
            run_control['stop_requested'] = False
            run_control['resume_event'].set()
            run_control['pause_logged'] = False

        try:
            runtime_files = list(getattr(runner, 'runtime_output_files', []) or []) if runner else []
            exported = await export_outputs(data) if runner else []
            output_files = finalize_output_files(data, runtime_files, exported) if runner else []
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
        raw_count = len(data)
        data = _apply_final_export_guards(adapter_id, task_id, data)
        deduped_count = len(data)
        if deduped_count != raw_count:
            log(f"Final export guard removed {raw_count - deduped_count} duplicate rows before partial export")
        try:
            runtime_files = list(getattr(runner, 'runtime_output_files', []) or []) if runner else []
            exported = await export_outputs(data) if runner else []
            output_files = finalize_output_files(data, runtime_files, exported) if runner else []
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
    orphaned_runs = data_sink.stop_orphaned_active_runs()
    if orphaned_runs:
        logger.warning("Marked %s orphaned active task run(s) as stopped after backend startup", orphaned_runs)

    # Install built-in adapters
    built_in = Path(__file__).parent.parent / "adapters"
    if built_in.exists():
        for d in built_in.iterdir():
            if d.is_dir() and (d / "manifest.yaml").exists():
                try:
                    adapter_loader.install_from_dir(str(d), install_mode="copy", preserve_existing_link=True)
                except Exception as e:
                    logger.warning(f"Built-in adapter failed {d.name}: {e}")

    adapter_loader.scan_all()
    try:
        ensure_knowledge_index()
    except Exception:
        logger.exception("knowledge index initialization failed; continuing without prebuilt index")

    # Register scheduled tasks
    try:
        for item in adapter_loader.list_all():
            if item['enabled']:
                m = adapter_loader.get_adapter(item['id'])
                if m:
                    sched_module.register_adapter(m, _execute_task)

        sched_module.start()
    except Exception:
        logger.exception("scheduler startup failed; continuing without scheduled jobs")
    logger.info("crawshrimp core started")
    yield
    try:
        sched_module.shutdown()
    except Exception:
        logger.exception("scheduler shutdown failed")


app = FastAPI(title="crawshrimp", version="1.4.3", lifespan=lifespan)
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
    install_mode: Optional[str] = None


@app.post("/adapters/install")
def install_adapter(req: InstallRequest):
    try:
        if req.path:
            m = adapter_loader.install_from_dir(req.path, install_mode=str(req.install_mode or "copy"))
        elif req.zip_base64:
            raw = base64.b64decode(req.zip_base64)
            with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as f:
                f.write(raw)
                tmp = f.name
            try:
                m = adapter_loader.install_from_zip(tmp, install_mode=str(req.install_mode or "copy"))
            finally:
                os.unlink(tmp)
        else:
            raise HTTPException(400, "Provide 'path' or 'zip_base64'")

        # Register scheduler jobs for newly installed adapter
        sched_module.register_adapter(m, _execute_task)
        adapter_meta = adapter_loader.get_install_metadata(m.id)
        return {
            "ok": True,
            "adapter": {
                "id": m.id,
                "name": m.name,
                "version": m.version,
                "install_mode": adapter_meta.get("install_mode", "copy"),
                "source_path": adapter_meta.get("source_path", ""),
                "runtime_path": adapter_meta.get("runtime_path", ""),
            }
        }
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
                "param_probe_script": task.param_probe_script,
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


class ProbeTaskParamsRequest(BaseModel):
    params: Optional[dict] = None
    current_tab_id: Optional[str] = None


@app.post("/probe/run")
async def run_probe(req: ProbeRequest):
    try:
        result = await run_probe_request(req)
        try:
            rebuild_knowledge_index()
        except Exception as knowledge_error:
            logger.warning("probe 完成后重建知识索引失败: %s", knowledge_error)
        return result.model_dump()
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))


@app.get("/probe/{probe_id}")
def get_probe(probe_id: str):
    try:
        result = read_probe_bundle(probe_id)
        return result.model_dump()
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))


@app.get("/probe/{probe_id}/bundle")
def get_probe_bundle(probe_id: str):
    try:
        result = read_probe_bundle_full(probe_id)
        return result.model_dump()
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))


@app.post("/knowledge/rebuild")
def rebuild_knowledge():
    try:
        return rebuild_knowledge_index()
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))


@app.get("/knowledge/search")
def get_knowledge(
    q: str = "",
    adapter_id: str = "",
    task_id: str = "",
    url: str = "",
    limit: int = 8,
):
    try:
        return search_knowledge(q, adapter_id=adapter_id, task_id=task_id, url=url, limit=limit)
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))


@app.post("/dev-harness/snapshot")
async def dev_harness_snapshot(req: DevHarnessSnapshotRequest):
    try:
        return await run_harness_snapshot(req)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))


@app.post("/dev-harness/eval")
async def dev_harness_eval(req: DevHarnessEvalRequest):
    try:
        return await run_harness_eval(req)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))


@app.post("/dev-harness/capture")
async def dev_harness_capture(req: DevHarnessCaptureRequest):
    try:
        return await run_harness_capture(req)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))


@app.post("/tasks/{adapter_id}/{task_id}/params/probe")
async def probe_task_params(adapter_id: str, task_id: str, req: ProbeTaskParamsRequest):
    adapter_loader.scan_all()
    adapter = adapter_loader.get_adapter(adapter_id)
    if not adapter:
        raise HTTPException(404, f"Adapter not found: {adapter_id}")

    task = next((item for item in adapter.tasks if item.id == task_id), None)
    if not task:
        raise HTTPException(404, f"Task not found: {task_id}")

    probe_script = str(task.param_probe_script or "").strip()
    if not probe_script:
        raise HTTPException(404, f"Task does not declare param_probe_script: {adapter_id}/{task_id}")

    adapter_dir = adapter_loader.get_adapter_dir(adapter_id)
    if not adapter_dir:
        raise HTTPException(404, f"Adapter directory not found: {adapter_id}")

    script_path = Path(adapter_dir) / probe_script
    if not script_path.exists() or not script_path.is_file():
        raise HTTPException(404, f"Param probe script not found: {probe_script}")

    run_params = dict(req.params or {})
    current_tab_id = str(req.current_tab_id or "").strip()

    try:
        session = await open_browser_session(
            adapter_id,
            task_id,
            mode=str(run_params.get("mode") or "current").strip().lower() or "current",
            current_tab_id=current_tab_id,
        )
        prelude = (
            f"window.__CRAWSHRIMP_PARAMS__ = {json.dumps(run_params, ensure_ascii=False)};\n"
            f"window.__CRAWSHRIMP_PARAM_PROBE__ = true;\n"
        )
        result = await session.runner.evaluate_with_reconnect(
            prelude + script_path.read_text(encoding="utf-8"),
            allow_navigation_retry=True,
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(500, str(exc))

    if not result.success:
        raise HTTPException(400, result.error or "task param probe failed")

    return {
        "ok": True,
        "patches": result.data if isinstance(result.data, list) else [],
        "meta": result.meta or {},
    }


async def _run_task_background(adapter_id: str, task_id: str, params: dict, runtime_options: dict, run_control: Optional[dict]):
    jid = f"{adapter_id}::{task_id}"
    try:
        await _execute_task(adapter_id, task_id, params, runtime_options, run_control=run_control)
    except Exception as exc:
        live = dict(_run_status.get(jid) or {})
        if live.get('status') in ACTIVE_LIVE_STATUSES or not live:
            _run_status[jid] = {
                'status': 'error',
                'run_id': live.get('run_id'),
                'records': int(live.get('records') or 0),
                'error': str(exc),
            }
        _run_logs.setdefault(jid, []).append(f"[{adapter_id}/{task_id}] FATAL: {exc}")
        logger.exception("Background task crashed before cleanup: %s", jid)
    finally:
        _run_controls.pop(jid, None)


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


class DeleteFilesRequest(BaseModel):
    paths: List[str]




@app.post("/files/read-excel")
def read_excel(req: ReadExcelRequest):
    """读取本地 Excel / CSV 文件，返回 headers + rows 数组，供 JS 脚本批量处理"""
    res = _read_local_excel(req.path, req.sheet, req.header_row)
    if "error" in res:
        raise HTTPException(400, res["error"])
    return res


@app.post("/files/delete")
def delete_files(req: DeleteFilesRequest):
    raw_paths = [str(path).strip() for path in (req.paths or []) if str(path).strip()]
    if not raw_paths:
        return {"ok": False, "error": "No file paths provided"}

    seen = set()
    normalized_paths = []
    for raw in raw_paths:
        try:
            normalized = str(Path(raw).expanduser().resolve(strict=False))
        except Exception:
            normalized = raw
        if normalized in seen:
            continue
        seen.add(normalized)
        normalized_paths.append(normalized)

    deleted_paths = []
    missing_paths = []
    failed_paths = []

    for item in normalized_paths:
        path = Path(item)
        try:
            if not path.exists():
                missing_paths.append(item)
                continue
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()
            deleted_paths.append(item)
        except Exception as e:
            failed_paths.append({"path": item, "error": str(e)})

    prune_targets = deleted_paths + missing_paths
    prune_result = data_sink.remove_output_files(prune_targets) if prune_targets else {"updated_runs": 0, "removed_refs": 0}

    return {
        "ok": bool(deleted_paths or missing_paths),
        "deleted_count": len(deleted_paths),
        "missing_count": len(missing_paths),
        "failed_count": len(failed_paths),
        "deleted_paths": deleted_paths,
        "missing_paths": missing_paths,
        "failed": failed_paths,
        "updated_runs": prune_result.get("updated_runs", 0),
        "removed_refs": prune_result.get("removed_refs", 0),
    }


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
