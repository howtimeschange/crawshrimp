#!/usr/bin/env python3
"""Run the Semir cloud -> 1XM image -> Tmall material-test chain.

The script keeps live Tmall mutations behind explicit flags. It reads 1XM keys
from Crawshrimp settings or environment variables, never from CLI args.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping


REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from core import data_sink  # noqa: E402
from core.cdp_bridge import CDPBridge  # noqa: E402
from core.js_runner import JSRunner  # noqa: E402
from core.one_xm_image import file_to_data_url  # noqa: E402


ADAPTER_ID = "tmall-ops-assistant"
TASK_ID = "tmall_ai_image_test_chain"
SEMIR_URL = "https://fmp.semirapp.com/web/index#/home/file"
TMALL_URL = "https://myseller.taobao.com/home.htm/material-center/material-test/common_test?testStatus=1&testChannel=common_search"
DEFAULT_WORKFLOW_FILE = "/Users/xingyicheng/Downloads/测图工作流导入模板表.xlsx"
DEFAULT_PROMPT_FILE = "/Users/xingyicheng/Downloads/AI 测图提示词库.xlsx"
DEFAULT_CLOUD_PATH = "巴拉营运BU-商品//巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉秋/"
PROMPT_SHEETS = {"上装", "连衣裙", "下装", "短裙", "鞋品", "竞品模版"}
IMAGE_EXT_RE = re.compile(r"\.(jpe?g|png|webp|bmp|gif|tiff?)($|\?)", re.IGNORECASE)
REFERENCE_IMAGE_MAX_BYTES = 19 * 1024 * 1024


def compact(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_key(value: object) -> str:
    return re.sub(r"[\s_./\\\-：:（）()]+", "", compact(value).lower())


def row_value(row: Mapping[str, Any], aliases: Iterable[str]) -> str:
    wanted = {normalize_key(alias) for alias in aliases}
    for key, value in (row or {}).items():
        if normalize_key(key) in wanted and compact(value):
            return compact(value)
    return ""


def parse_list(value: object) -> list[str]:
    if isinstance(value, list):
        return [compact(item) for item in value if compact(item)]
    return [item.strip() for item in re.split(r"[\n\r,，、；;]+", str(value or "")) if item.strip()]


def safe_token(value: object, fallback: str = "item") -> str:
    text = compact(value)
    token = re.sub(r"[^A-Za-z0-9._~-]+", "_", text).strip("_")
    return token or fallback


def stable_hash(value: object) -> str:
    text = str(value or "")
    h = 2166136261
    for char in text:
        h ^= ord(char)
        h = (h * 16777619) & 0xFFFFFFFF
    return f"{h:08x}"


def normalize_quality(value: object) -> str:
    text = compact(value).lower()
    return text if text in {"auto", "low", "medium", "high"} else "auto"


def read_workbook_table(path: str, sheet: str | None = None, header_row: int = 1) -> dict[str, Any]:
    from core.api_server import _read_local_excel

    result = _read_local_excel(str(Path(path).expanduser()), sheet=sheet, header_row=header_row)
    if result.get("error"):
        raise RuntimeError(str(result["error"]))
    return result


def resolve_one_xm_settings() -> dict:
    from core.api_server import _resolve_one_xm_settings

    return _resolve_one_xm_settings()


def run_one_xm_generation_row(row: dict, run_params: dict, one_xm_settings: dict) -> dict:
    from core.api_server import _run_one_xm_generation_row

    return _run_one_xm_generation_row(row, run_params, one_xm_settings)


@dataclass
class WorkflowItem:
    row_no: int
    style_code: str
    item_id: str
    category: str
    gender: str
    prompt_name: str = ""
    skc_code: str = ""


@dataclass
class PromptItem:
    sheet_name: str
    field_name: str
    field_order: int
    size_label: str
    output_format: str
    prompt: str
    female_priority: int
    neutral_priority: int


def normalize_workflow_rows(table: Mapping[str, Any], limit: int = 5) -> tuple[list[WorkflowItem], list[dict[str, Any]]]:
    rows: list[WorkflowItem] = []
    invalid: list[dict[str, Any]] = []
    for index, row in enumerate(table.get("rows") or [], start=2):
        style_code = row_value(row, ["款号", "编码", "货号", "款号/编码", "styleCode", "spu"])
        item_id = row_value(row, ["ID（用于测图的ID）", "测图ID", "天猫商品ID", "商品ID", "宝贝ID", "itemId", "item_id"])
        if not style_code:
            invalid.append({"表格行号": index, "执行结果": "跳过", "备注": "缺少款号"})
            continue
        rows.append(WorkflowItem(
            row_no=index,
            style_code=style_code,
            item_id=item_id,
            category=row_value(row, ["品类（后期匹配）", "品类", "类目", "提示词分组", "promptSheet"]),
            gender=row_value(row, ["模特性别", "性别", "男女", "gender"]) or "中性",
            prompt_name=row_value(row, ["提示词字段名", "提示词名称", "字段名", "promptName"]),
            skc_code=row_value(row, ["SKC编码", "SKC", "款色编码", "款色号", "最优销售色号", "销售色号", "色号"]),
        ))
        if len(rows) >= limit:
            break
    return rows, invalid


def table_to_raw_rows(table: Mapping[str, Any]) -> list[list[str]]:
    headers = [compact(header) for header in table.get("headers") or []]
    raw_rows = [headers]
    for row in table.get("rows") or []:
        raw_rows.append([compact((row or {}).get(header)) for header in headers])
    return raw_rows


def normalize_header_row(raw_rows: list[list[str]]) -> tuple[list[str], list[dict[str, str]]]:
    header_index = -1
    for index, row in enumerate(raw_rows):
        keys = [normalize_key(value) for value in row]
        if normalize_key("字段名") in keys and normalize_key("描述内容") in keys:
            header_index = index
            break
    if header_index < 0:
        return [], []
    headers = [compact(value) or f"列{index + 1}" for index, value in enumerate(raw_rows[header_index])]
    rows: list[dict[str, str]] = []
    for raw in raw_rows[header_index + 1:]:
        if not any(compact(value) for value in raw):
            continue
        rows.append({header: compact(raw[index] if index < len(raw) else "") for index, header in enumerate(headers)})
    return headers, rows


def is_truthy(value: object) -> bool:
    return compact(value).lower() in {"1", "true", "yes", "y", "是", "启用", "生成"}


def to_int(value: object, fallback: int = 0) -> int:
    try:
        return int(float(compact(value)))
    except Exception:
        return fallback


def normalize_output_format(value: object, fallback: str = "jpeg") -> str:
    text = compact(value).lower()
    if text in {"jpg", "jpeg"}:
        return "jpeg"
    if text in {"png", "webp"}:
        return text
    return fallback


def read_prompt_library(path: str) -> list[PromptItem]:
    import openpyxl

    workbook_path = Path(path).expanduser()
    if not workbook_path.is_file():
        raise RuntimeError(f"File not found: {workbook_path}")
    wb = openpyxl.load_workbook(workbook_path, read_only=False, data_only=True)
    prompts: list[PromptItem] = []
    try:
        for ws in wb.worksheets:
            raw_rows = [
                [compact(value) for value in row]
                for row in ws.iter_rows(values_only=True)
            ]
            _, parsed_rows = normalize_header_row(raw_rows)

            for index, row in enumerate(parsed_rows, start=1):
                field_name = row_value(row, ["字段名"])
                prompt = row_value(row, ["描述内容", "提示词", "prompt"])
                if not field_name or not prompt:
                    continue
                in_view = row_value(row, ["在当前视图"])
                if in_view and not is_truthy(in_view):
                    continue
                prompts.append(PromptItem(
                    sheet_name=compact(ws.title),
                    field_name=field_name,
                    field_order=to_int(row_value(row, ["字段顺序"]), index),
                    size_label=row_value(row, ["尺寸"]),
                    output_format=normalize_output_format(row_value(row, ["格式"]), "jpeg"),
                    prompt=prompt,
                    female_priority=to_int(row_value(row, ["女性优先度"]), 0),
                    neutral_priority=to_int(row_value(row, ["男性/中性优先度", "男性优先度", "中性优先度"]), 0),
                ))
    finally:
        wb.close()
    return prompts


def category_to_prompt_sheet(category: str) -> str:
    text = compact(category)
    if text in PROMPT_SHEETS:
        return text
    if re.search(r"裤|短裤|长裤|打底裤|牛仔裤", text):
        return "下装"
    if re.search(r"裙", text):
        return "短裙"
    if re.search(r"鞋|靴", text):
        return "鞋品"
    if re.search(r"连衣", text):
        return "连衣裙"
    return "上装"


def prompt_priority(prompt: PromptItem, workflow: WorkflowItem) -> tuple[int, int, str]:
    gender = workflow.gender.lower()
    priority = prompt.female_priority if re.search(r"女|female|girl", gender) else prompt.neutral_priority
    normalized = priority if priority > 0 else 9999
    return normalized, prompt.field_order or 9999, prompt.field_name


def select_prompts(workflow: WorkflowItem, prompts: list[PromptItem], limit: int = 1) -> list[PromptItem]:
    prompt_names = set(parse_list(workflow.prompt_name))
    group = category_to_prompt_sheet(workflow.category)
    matched = [
        prompt
        for prompt in prompts
        if prompt.sheet_name == group and (not prompt_names or prompt.field_name in prompt_names)
    ]
    if not matched and prompt_names:
        matched = [prompt for prompt in prompts if prompt.field_name in prompt_names]
    if not matched:
        return []
    return sorted(matched, key=lambda item: prompt_priority(item, workflow))[:max(1, limit)]


def select_prompt(workflow: WorkflowItem, prompts: list[PromptItem]) -> PromptItem | None:
    selected = select_prompts(workflow, prompts, 1)
    return selected[0] if selected else None


def build_prompt_text(prompt: PromptItem, workflow: WorkflowItem) -> str:
    metadata = [
        f"款号={workflow.style_code}",
        f"天猫商品ID={workflow.item_id}" if workflow.item_id else "",
        f"品类={workflow.category}" if workflow.category else "",
        f"性别={workflow.gender}" if workflow.gender else "",
    ]
    suffix = "；".join(item for item in metadata if item)
    text = prompt.prompt
    for key, value in {
        "{{款号}}": workflow.style_code,
        "{{商品ID}}": workflow.item_id,
        "{{品类}}": workflow.category,
        "{{性别}}": workflow.gender,
    }.items():
        text = text.replace(key, value)
    return f"{text}\n\n商品属性：{suffix}" if suffix else text


def make_generation_row(
    workflow: WorkflowItem,
    prompt: PromptItem,
    reference_paths: list[str] | tuple[str, ...] | str,
    *,
    image_size: str,
    quality: str,
    output_format: str,
    key_tier: str,
    prompt_index: int = 1,
) -> dict[str, Any]:
    final_prompt = build_prompt_text(prompt, workflow)
    normalized_quality = normalize_quality(quality)
    references = [compact(item) for item in (reference_paths if isinstance(reference_paths, (list, tuple)) else [reference_paths]) if compact(item)]
    idempotency_key = "_".join([
        "tmall_ai_chain",
        safe_token(workflow.style_code),
        safe_token(prompt.sheet_name),
        safe_token(prompt.field_name),
        safe_token(prompt_index),
        safe_token(image_size),
        stable_hash(final_prompt),
    ])[:180]
    return {
        "表格行号": workflow.row_no,
        "款号": workflow.style_code,
        "SKC编码": workflow.skc_code,
        "商品ID": workflow.item_id,
        "品类": workflow.category,
        "性别": workflow.gender,
        "提示词分组": prompt.sheet_name,
        "提示词字段名": prompt.field_name,
        "提示词序号": prompt_index,
        "尺寸": image_size,
        "格式": output_format,
        "质量": normalized_quality,
        "参考图文件": "\n".join(references),
        "主参考图文件": references[0] if references else "",
        "细节参考图文件": "\n".join(references[1:]),
        "最终提示词": final_prompt,
        "完整Prompt": final_prompt,
        "1XM任务ID": "",
        "1XM轮询URL": "",
        "生成图URL": "",
        "生成图数量": "",
        "执行结果": "待生成",
        "备注": "",
        "__1xm_generate": True,
        "__1xm_key_tier": key_tier,
        "__1xm_idempotency_key": idempotency_key,
        "__1xm_reference_paths": references,
        "__1xm_payload": {
            "model": "gpt-image-2",
            "prompt": final_prompt,
            "size": image_size,
            "quality": normalized_quality,
            "output_format": output_format,
            "n": 1,
        },
    }


async def get_runner(bridge: CDPBridge, prefix: str, entry_url: str, artifact_dir: Path, timeout: int = 120) -> JSRunner:
    tab = bridge.find_tab(prefix)
    if not tab:
        tab = bridge.new_tab(entry_url)
        await asyncio.sleep(3)
    ws_url = bridge.get_tab_ws_url(tab)
    if not ws_url:
        raise RuntimeError(f"Chrome tab 缺少 WebSocket URL: {prefix}")
    runner = JSRunner(
        ws_url,
        timeout=timeout,
        tab_id=str(tab.get("id") or ""),
        tab_url=str(tab.get("url") or entry_url),
        artifact_dir=str(artifact_dir),
    )
    url = str(tab.get("url") or "")
    if not url.startswith(prefix):
        nav = await runner.navigate(entry_url, wait_seconds=4)
        if not nav.success:
            raise RuntimeError(nav.error or f"无法打开页面: {entry_url}")
    return runner


def js_call(body: str, payload: Mapping[str, Any]) -> str:
    return f"""
(async () => {{
  const __payload = {json.dumps(payload, ensure_ascii=False)};
{body}
}})()
"""


SEMIR_FIND_JS = r"""
  const SEARCH_SCOPE = '["filename", "tag"]';
  const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff']);
  const BLOCKED_EXTS = new Set(['psd', 'pdf', 'ai', 'cdr', 'zip', 'rar', '7z']);
  const compact = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const normalizeUrl = (value) => {
    const url = compact(value);
    if (!url) return '';
    return url.startsWith('//') ? `https:${url}` : url;
  };
  const extOf = (item) => {
    const explicit = compact(item?.ext).toLowerCase().replace(/^\./, '');
    if (explicit) return explicit;
    const name = compact(item?.filename || item?.name || item?.fullpath || '');
    const index = name.lastIndexOf('.');
    return index >= 0 ? name.slice(index + 1).toLowerCase() : '';
  };
  const isDir = (item) => item?.dir === 1 || item?.dir === '1' || item?.dir === true || item?.type === 'folder';
  const isImage = (item) => !isDir(item) && IMAGE_EXTS.has(extOf(item)) && !BLOCKED_EXTS.has(extOf(item));
  const naturalCompare = (a, b) => String(a || '').localeCompare(String(b || ''), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  async function fetchJson(url, init = {}) {
    const response = await fetch(url, { credentials: 'include', ...init });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : {}; } catch (error) { payload = null; }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 240)}`);
    if (!payload) throw new Error(`接口未返回 JSON：${url}`);
    return payload;
  }
  function parseCloudPath(raw) {
    const value = compact(raw);
    if (!value) return null;
    const divider = value.indexOf('//');
    if (divider < 0) throw new Error('云盘路径格式需要“挂载点//目录/子目录”');
    return {
      mountName: compact(value.slice(0, divider)),
      relativePath: value.slice(divider + 2).replace(/\\/g, '/').split('/').map(compact).filter(Boolean).join('/'),
    };
  }
  async function fetchMounts() {
    const payload = await fetchJson('/fengcloud/1/account/mount');
    return Array.isArray(payload) ? payload : (payload.list || payload?.data?.list || []);
  }
  async function searchFiles(mountId, keyword) {
    const all = [];
    let start = 0;
    while (true) {
      const body = new URLSearchParams({
        size: '100',
        start: String(start),
        keyword: String(keyword || ''),
        mount_id: String(mountId || ''),
        scope: SEARCH_SCOPE,
      });
      const payload = await fetchJson('/fengcloud/2/file/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const items = Array.isArray(payload?.list) ? payload.list : (payload?.data?.list || []);
      const total = Number(payload?.total || payload?.data?.total || items.length || 0);
      all.push(...items);
      start += items.length;
      if (!items.length || start >= total) break;
    }
    return all;
  }
  function extractFolderItems(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.list)) return payload.list;
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.files)) return payload.files;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.data?.list)) return payload.data.list;
    if (Array.isArray(payload?.data?.items)) return payload.data.items;
    return null;
  }
  function extractFolderTotal(payload, fallbackCount) {
    const candidates = [payload?.total, payload?.count, payload?.data?.total, payload?.data?.count];
    const total = candidates.map(Number).find((value) => Number.isFinite(value) && value >= 0);
    return total == null ? fallbackCount : total;
  }
  function normalizeListedItem(item, parentFullpath) {
    if (!item || typeof item !== 'object') return item;
    const filename = compact(item.filename || item.name || '');
    const fullpath = compact(item.fullpath || item.path || '');
    if (fullpath || !filename || !parentFullpath) return item;
    return { ...item, filename, fullpath: `${String(parentFullpath || '').replace(/\/+$/, '')}/${filename}` };
  }
  async function fetchFolderPage(mountId, fullpath, start, method, endpoint) {
    const query = new URLSearchParams({
      order: 'filename asc',
      size: '100',
      start: String(start),
      mount_id: String(mountId || ''),
      fullpath: String(fullpath || ''),
      path: String(fullpath || ''),
      current: '1',
    });
    if (method === 'GET') return fetchJson(`${endpoint}?${query.toString()}`);
    return fetchJson(endpoint, {
      method,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: query.toString(),
    });
  }
  async function listFolderItems(mountId, fullpath) {
    const attempts = [
      { method: 'GET', endpoint: '/fengcloud/1/file/ls' },
      { method: 'GET', endpoint: '/fengcloud/2/file/list' },
      { method: 'POST', endpoint: '/fengcloud/2/file/list' },
      { method: 'GET', endpoint: '/fengcloud/1/file/list' },
      { method: 'POST', endpoint: '/fengcloud/1/file/list' },
    ];
    const errors = [];
    for (const attempt of attempts) {
      try {
        const all = [];
        let start = 0;
        let total = null;
        while (true) {
          const payload = await fetchFolderPage(mountId, fullpath, start, attempt.method, attempt.endpoint);
          const itemsRaw = extractFolderItems(payload);
          if (!Array.isArray(itemsRaw)) throw new Error(`${attempt.method} ${attempt.endpoint} 未返回列表字段`);
          const items = itemsRaw.map((item) => normalizeListedItem(item, fullpath));
          all.push(...items);
          const pageTotal = extractFolderTotal(payload, start + items.length);
          if (total == null) total = pageTotal;
          if (!items.length) break;
          start += items.length;
          if (start >= pageTotal) break;
        }
        return { ok: true, items: all };
      } catch (error) {
        errors.push(String(error?.message || error));
      }
    }
    return { ok: false, items: [], error: errors[0] || '列目录失败' };
  }
  async function collectDescendantImages(mountId, folderPath, maxDepth, remainingBudget = { value: 600 }) {
    if (!folderPath || maxDepth < 0 || remainingBudget.value <= 0) return { assets: [], errors: [] };
    const listed = await listFolderItems(mountId, folderPath);
    if (!listed.ok) return { assets: [], errors: [`${folderPath}: ${listed.error}`] };
    const assets = [];
    const errors = [];
    for (const item of listed.items) {
      if (remainingBudget.value <= 0) break;
      if (isDir(item)) {
        if (maxDepth <= 0) continue;
        const child = await collectDescendantImages(mountId, item?.fullpath || item?.filename || '', maxDepth - 1, remainingBudget);
        assets.push(...child.assets);
        errors.push(...child.errors);
        continue;
      }
      if (!isImage(item)) continue;
      assets.push(item);
      remainingBudget.value -= 1;
    }
    return { assets, errors };
  }
  function pathSegments(fullpath) {
    return String(fullpath || '').replace(/\\/g, '/').split('/').map(compact).filter(Boolean);
  }
  function parentFullpath(fullpath) {
    const segments = pathSegments(fullpath);
    segments.pop();
    return segments.join('/');
  }
  function folderPathsFromSearchItem(item, styleCode) {
    const style = compact(styleCode);
    if (!style) return [];
    const fullpath = String(item?.fullpath || item?.filename || '').replace(/\\/g, '/');
    const segments = pathSegments(fullpath);
    const paths = [];
    const addPath = (value) => {
      const path = compact(value);
      if (path && !paths.includes(path)) paths.push(path);
    };
    if (isDir(item) && fullpath.includes(style)) {
      addPath(fullpath);
    } else if (isImage(item) && parentFullpath(fullpath).includes(style)) {
      addPath(parentFullpath(fullpath));
    }
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      if (!segments[index].includes(style)) continue;
      if (isImage(item) && index === segments.length - 1) {
        const parent = parentFullpath(fullpath);
        if (parent.includes(style)) addPath(parent);
      } else {
        addPath(segments.slice(0, index + 1).join('/'));
      }
    }
    return paths;
  }
  async function fileInfo(mountId, fullpath) {
    const query = new URLSearchParams({ mount_id: String(mountId || ''), fullpath: String(fullpath || '') });
    return fetchJson(`/fengcloud/2/file/info?${query.toString()}`);
  }
  function findFirstRemoteUrl(value, seen = new Set()) {
    if (!value) return '';
    if (typeof value === 'string') {
      const direct = normalizeUrl(value);
      return /^https?:\/\//i.test(direct) || /^\/\//.test(value) ? direct : '';
    }
    if (typeof value !== 'object' || seen.has(value)) return '';
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findFirstRemoteUrl(item, seen);
        if (found) return found;
      }
      return '';
    }
    for (const key of ['url', 'picUrl', 'imageUrl', 'materialUrl', 'downloadUrl', 'fileUrl', 'src']) {
      const found = findFirstRemoteUrl(value[key], seen);
      if (found) return found;
    }
    for (const item of Object.values(value)) {
      const found = findFirstRemoteUrl(item, seen);
      if (found) return found;
    }
    return '';
  }
  function basenameOf(value) {
    return compact(value).replace(/\\/g, '/').split('/').filter(Boolean).pop() || compact(value);
  }
  function startsWithCodeToken(value, code) {
    const text = compact(value).toLowerCase();
    const target = compact(code).toLowerCase();
    if (!text || !target) return false;
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped}(?:$|[^0-9a-z])`, 'i').test(text);
  }
  function isShowcaseOneName(filename) {
    return /橱窗\s*0?1(?!\d)/i.test(compact(filename));
  }
  function isYzOneName(filename) {
    const name = compact(filename);
    return /(^|[^0-9a-z])yz\s*[\(（]\s*0?1\s*[\)）]/i.test(name);
  }
  function isMainReferenceCandidate(filename) {
    const name = basenameOf(filename);
    return isShowcaseOneName(name) || isYzOneName(name);
  }
  function skcCodeFromStyleName(filename, styleCode) {
    const style = compact(styleCode);
    if (!style) return '';
    const escaped = style.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = basenameOf(filename).match(new RegExp(`^(${escaped}[-_][0-9]{5})(?=$|[^0-9])`, 'i'));
    return match ? match[1] : '';
  }
  function isSkcFlatCandidate(filename, skcCode, styleCode) {
    const skc = compact(skcCode);
    if (skc && startsWithCodeToken(basenameOf(filename), skc)) return true;
    return Boolean(skcCodeFromStyleName(filename, styleCode));
  }
  function referenceCandidate(item, styleCode, skcCode) {
    const filename = compact(item?.filename || item?.name);
    const fullpath = compact(item?.fullpath || item?.path);
    const full = `${fullpath}/${filename}`.replace(/\\/g, '/');
    if (!isImage({ ...item, filename })) return null;
    if (/尺码表|尺寸表|规格表|吊牌|制单|pdf|psd|源文件|视觉推荐|视频|模特卡/i.test(full)) return null;
    const baseName = basenameOf(filename || fullpath);
    const stylePathOk = !compact(styleCode) || full.includes(compact(styleCode));
    const flags = {
      showcase1: isShowcaseOneName(baseName),
      yz1: isYzOneName(baseName),
      flat: isSkcFlatCandidate(baseName, skcCode, styleCode),
      flatPath: /平拍|平铺|白底|静物|正面|front/i.test(full),
      selectedPath: /已选/.test(full),
      modelPath: /模拍|已选/.test(full),
      front: /正面|前面|front/i.test(baseName),
      back: /背面|后面|back/i.test(baseName),
    };
    const isMain = (flags.showcase1 || flags.yz1) && stylePathOk;
    const isDetail = flags.flat;
    if (!isMain && !isDetail) return null;
    const mainRank = (flags.showcase1 ? 20 : flags.yz1 ? 10 : 0) + (flags.selectedPath ? 2 : 0) + (flags.modelPath ? 1 : 0);
    const detailRank = (flags.flatPath ? 6 : 0) + (flags.front ? 2 : flags.back ? 0 : 1) - (flags.modelPath ? 2 : 0);
    const role = flags.showcase1 ? 'origin_showcase1'
      : flags.yz1 ? 'origin_yz1'
      : 'detail_skc_flat';
    const score = isMain ? 300 + mainRank * 20 : 200 + detailRank * 10;
    const resolvedSkcCode = flags.flat ? (compact(skcCode) || skcCodeFromStyleName(baseName, styleCode)) : '';
    return { ...item, filename, fullpath, ext: extOf({ ...item, filename }), score, mainRank, detailRank, role, flags, skcCode: resolvedSkcCode };
  }
  try {
    const styleCode = compact(__payload.style_code);
    const configured = parseCloudPath(__payload.cloud_path || '');
    const mounts = await fetchMounts();
    const mountPlans = [];
    if (configured) {
      const mount = mounts.find((item) => compact(item.org_name || item.name) === configured.mountName);
      if (!mount) throw new Error(`未找到挂载点：${configured.mountName}`);
      mountPlans.push({
        mountId: String(mount.mount_id || mount.id || ''),
        mountName: compact(mount.org_name || mount.name),
        relativePath: configured.relativePath,
        source: 'configured',
      });
    } else {
      for (const mount of mounts) {
        mountPlans.push({
          mountId: String(mount.mount_id || mount.id || ''),
          mountName: compact(mount.org_name || mount.name),
          relativePath: '',
          source: 'mounted-global',
        });
      }
    }
    const searches = [];
    const allItems = [];
    const skcCode = compact(__payload.skc_code || '');
    const keywords = [...new Set([styleCode, skcCode].map(compact).filter(Boolean))];
    const scanErrors = [];
    for (const mount of mountPlans.filter((item) => item.mountId)) {
      for (const keyword of keywords) {
        const found = await searchFiles(mount.mountId, keyword);
        const scoped = mount.relativePath ? found.filter((item) => String(item.fullpath || '').replace(/\\/g, '/').startsWith(mount.relativePath)) : found;
        searches.push({ mountId: mount.mountId, mountName: mount.mountName, source: mount.source, keyword, found: found.length, scoped: scoped.length, relativePath: mount.relativePath });
        allItems.push(...scoped.map((item) => ({ ...item, mountId: mount.mountId, mountName: mount.mountName })));
        const folderPaths = [];
        for (const item of scoped) {
          for (const folderPath of folderPathsFromSearchItem(item, styleCode)) {
            if (folderPath && !folderPaths.includes(folderPath)) folderPaths.push(folderPath);
          }
        }
        for (const folderPath of folderPaths.slice(0, 8)) {
          const descendants = await collectDescendantImages(mount.mountId, folderPath, Number(__payload.folder_scan_depth || 3));
          scanErrors.push(...descendants.errors);
          allItems.push(...descendants.assets.map((item) => ({ ...item, mountId: mount.mountId, mountName: mount.mountName })));
        }
      }
    }
    const seen = new Set();
    const ranked = [];
    for (const item of allItems) {
      const candidate = referenceCandidate(item, styleCode, skcCode);
      const key = compact(candidate?.fullpath || candidate?.filename);
      if (!candidate || !key || seen.has(key)) continue;
      seen.add(key);
      ranked.push(candidate);
    }
    ranked.sort((a, b) => b.score === a.score ? naturalCompare(a.fullpath || a.filename, b.fullpath || b.filename) : b.score - a.score);
    const mainRanked = ranked
      .filter((item) => item.flags.showcase1 || item.flags.yz1)
      .sort((a, b) => b.mainRank === a.mainRank ? naturalCompare(a.fullpath || a.filename, b.fullpath || b.filename) : b.mainRank - a.mainRank);
    const chosenMain = mainRanked[0] || null;
    const detailRanked = ranked
      .filter((item) => item.flags.flat)
      .filter((item) => !chosenMain || compact(item.fullpath || item.filename) !== compact(chosenMain.fullpath || chosenMain.filename))
      .sort((a, b) => b.detailRank === a.detailRank ? naturalCompare(a.fullpath || a.filename, b.fullpath || b.filename) : b.detailRank - a.detailRank);
    const chosenDetail = detailRanked[0] || null;
    const candidates = ranked.slice(0, Number(__payload.limit || 8));
    const infoTargets = [];
    for (const candidate of [chosenMain, chosenDetail, ...candidates.slice(0, 4)]) {
      if (!candidate) continue;
      const key = compact(candidate.fullpath || candidate.filename);
      if (!key || infoTargets.some((item) => compact(item.fullpath || item.filename) === key)) continue;
      infoTargets.push(candidate);
    }
    for (const candidate of infoTargets) {
      try {
        candidate.materialUrl = findFirstRemoteUrl(await fileInfo(candidate.mountId, candidate.fullpath));
      } catch (error) {
        candidate.materialUrl = '';
        candidate.infoError = String(error?.message || error);
      }
    }
    return { success: true, data: [{ styleCode, skcCode, searches, scanErrors: scanErrors.slice(0, 10), candidates, mainCandidates: mainRanked.slice(0, 5), detailCandidates: detailRanked.slice(0, 5), chosen: chosenMain, chosenMain, chosenDetail }], meta: { has_more: false } };
  } catch (error) {
    return { success: false, error: String(error?.message || error) };
  }
"""


TMALL_UPLOAD_CREATE_JS = r"""
  const compact = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  function describeError(error) {
    if (!error) return '未知错误';
    if (typeof error === 'string') return error;
    if (error.message) return String(error.message);
    if (Array.isArray(error.ret)) return error.ret.join('；');
    try { return JSON.stringify(error).slice(0, 1000); } catch (jsonError) {}
    return String(error);
  }
  const normalizeUrl = (value) => {
    const url = compact(value);
    if (!url) return '';
    return url.startsWith('//') ? `https:${url}` : url;
  };
  function getCookieValue(name) {
    const key = `${String(name || '')}=`;
    for (const raw of String(document?.cookie || '').split(';')) {
      const item = raw.trim();
      if (item.startsWith(key)) return decodeURIComponent(item.slice(key.length));
    }
    return '';
  }
  async function dataUrlToBlob(dataUrl) {
    if (typeof fetch !== 'function') throw new Error('当前页面不支持 data URL 转 Blob');
    return (await fetch(String(dataUrl || ''))).blob();
  }
  function findFirstRemoteUrl(value, seen = new Set()) {
    if (!value) return '';
    if (typeof value === 'string') {
      const direct = normalizeUrl(value);
      return /^https?:\/\//i.test(direct) || /^\/\//.test(value) ? direct : '';
    }
    if (typeof value !== 'object' || seen.has(value)) return '';
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findFirstRemoteUrl(item, seen);
        if (found) return found;
      }
      return '';
    }
    for (const key of ['url', 'picUrl', 'imageUrl', 'materialUrl', 'downloadUrl', 'fileUrl', 'src']) {
      const found = findFirstRemoteUrl(value[key], seen);
      if (found) return found;
    }
    for (const item of Object.values(value)) {
      const found = findFirstRemoteUrl(item, seen);
      if (found) return found;
    }
    return '';
  }
  async function uploadDataUrl(dataUrl, name) {
    const query = new URLSearchParams({
      appkey: 'tu',
      folderId: String(__payload.folder_id || '0'),
      watermark: 'false',
      picCompress: 'true',
      _input_charset: 'utf-8',
    });
    const form = new FormData();
    form.append('water', 'false');
    form.append('name', name);
    form.append('_tb_token_', getCookieValue('_tb_token_'));
    form.append('file', await dataUrlToBlob(dataUrl), name);
    const response = await fetch(`https://stream-upload.taobao.com/api/upload.api?${query.toString()}`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : {}; } catch (error) { payload = null; }
    if (!response.ok) throw new Error(`图片上传 HTTP ${response.status}: ${text.slice(0, 240)}`);
    if (!payload || payload.success === false) throw new Error(payload?.message || payload?.msg || `图片上传失败：${name}`);
    const url = normalizeUrl(payload?.object?.url || findFirstRemoteUrl(payload));
    if (!url) throw new Error(`图片上传未返回 URL：${name}`);
    return {
      name,
      url,
      fileId: compact(payload?.object?.fileId),
      folderId: compact(payload?.object?.folderId),
      pixel: compact(payload?.object?.pix),
      raw: payload,
    };
  }
  async function callMtop(api, data, options = {}) {
    const client = window.lib?.mtop || window.mtop;
    if (!client || typeof client.request !== 'function') {
      throw new Error('未找到千牛 MTop 客户端，请确认当前 tab 是天猫素材测试页');
    }
    const payload = await client.request({
      api,
      v: options.v || '1.0',
      type: options.type || 'POST',
      dataType: 'json',
      H5Request: true,
      preventFallback: true,
      data,
    });
    if (Array.isArray(payload?.ret)) {
      const failed = payload.ret.find((item) => !/^SUCCESS/i.test(String(item || '')));
      if (failed) throw new Error(`${api} 返回失败：${payload.ret.join('；')}`);
    }
    return payload?.data !== undefined ? payload.data : payload;
  }
  function extractTaskStatusList(value, targetSource = 'common_search') {
    const result = [];
    const seen = new Set();
    const visit = (node) => {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      const taskId = compact(node.experimentTaskId || node.taskId || node.id);
      if (taskId) {
        const source = compact(node.source || node.imageTestSource || node.testChannel || targetSource).toLowerCase();
        if (!source || source === targetSource || source === 'common_search' || source === 'commonsearch') {
          result.push({ experimentTaskId: taskId, source: targetSource });
        }
      }
      Object.values(node).forEach(visit);
    };
    visit(value);
    const unique = [];
    const uniqueIds = new Set();
    for (const item of result) {
      if (uniqueIds.has(item.experimentTaskId)) continue;
      uniqueIds.add(item.experimentTaskId);
      unique.push(item);
    }
    return unique;
  }
  async function searchTasks(itemId) {
    const payload = await callMtop('mtop.taobao.qn.copilot.framework.listmodel.data.search', {
      modelCode: 'image_test_mgr',
      params: JSON.stringify({ tabCode: 'all', testChannel: 'common_search', itemIdOrName: String(itemId || '') }),
      currentPage: 1,
      pageSize: 10,
    });
    return payload;
  }
  try {
    const uploaded = [];
    for (const file of (__payload.files || [])) {
      if (!__payload.live_upload) {
        uploaded.push({ name: file.name, role: file.role, localPath: file.localPath, url: '', skipped: true });
        continue;
      }
      const item = await uploadDataUrl(file.dataUrl, file.name);
      uploaded.push({ ...item, role: file.role, localPath: file.localPath, skipped: false });
    }
    const materials = uploaded
      .filter((item) => item.url)
      .map((item) => ({ sourceType: 4, picUrl: item.url, size: '3:4' }));
    const result = {
      uploaded,
      materials,
      createPayload: {
        source: 'qn',
        itemId: String(__payload.item_id || ''),
        imageTestSources: JSON.stringify(['COMMON_SEARCH']),
      },
      batchPayload: null,
      batchPayloads: [],
      onlinePayload: null,
      createResult: null,
      batchAddResult: null,
      batchAddResults: [],
      onlineResult: null,
      readback: null,
    };
    if (!__payload.live_create) {
      result.batchPayload = {
        experimentTaskId: '<experimentTaskId>',
        itemId: String(__payload.item_id || ''),
        source: 'common_search',
        materials: JSON.stringify(materials),
      };
      return { success: true, data: [result], meta: { has_more: false } };
    }
    if (!materials.length) throw new Error('没有可添加的天猫素材 URL，请先启用并完成 live_upload');
    result.createResult = await callMtop('mtop.taobao.qn.copilot.test.image.task.create', result.createPayload);
    const taskStatusList = extractTaskStatusList(result.createResult, 'common_search');
    if (!taskStatusList.length) throw new Error('创建测图任务后未解析到 COMMON_SEARCH 任务 ID');
    const task = taskStatusList[0];
    for (const material of materials) {
      const batchPayload = {
        experimentTaskId: task.experimentTaskId,
        itemId: String(__payload.item_id || ''),
        source: 'common_search',
        materials: JSON.stringify([material]),
      };
      if (!result.batchPayload) result.batchPayload = batchPayload;
      result.batchPayloads.push(batchPayload);
      const batchResult = await callMtop('mtop.taobao.qn.copilot.test.image.batch.add', batchPayload);
      result.batchAddResults.push(batchResult);
    }
    result.batchAddResult = result.batchAddResults[0] || null;
    if (__payload.live_online) {
      result.onlinePayload = {
        source: 'qn',
        itemId: String(__payload.item_id || ''),
        taskStatusList: JSON.stringify(taskStatusList),
      };
      result.onlineResult = await callMtop('mtop.taobao.qn.copilot.test.image.task.online', result.onlinePayload);
    }
    result.readback = await searchTasks(__payload.item_id);
    return { success: true, data: [result], meta: { has_more: false } };
  } catch (error) {
    return { success: false, error: describeError(error) };
  }
"""


SEMIR_FETCH_FILE_JS = r"""
  const compact = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const url = compact(__payload.url);
  if (!url) return { success: false, error: '缺少下载 URL' };
  try {
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 240) || response.statusText}`);
    }
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
    }
    return {
      success: true,
      data: [{
        url,
        bytes: bytes.length,
        mime: blob.type || '',
        base64: btoa(binary),
      }],
      meta: { has_more: false },
    };
  } catch (error) {
    return { success: false, error: String(error?.message || error) };
  }
"""


async def download_semir_candidate(
    runner: JSRunner,
    workflow: WorkflowItem,
    candidate: Mapping[str, Any],
    artifact_dir: Path,
    *,
    role: str,
) -> str:
    material_url = compact((candidate or {}).get("materialUrl"))
    if not material_url:
        return ""
    suffix = ".jpg"
    match = IMAGE_EXT_RE.search(material_url) or IMAGE_EXT_RE.search(compact((candidate or {}).get("filename")))
    if match:
        suffix = f".{match.group(1).lower().replace('jpeg', 'jpg')}"
    filename = f"{workflow.style_code}-{role}{suffix}"
    fallback = artifact_dir / filename
    page_result = await runner.evaluate_with_reconnect(js_call(SEMIR_FETCH_FILE_JS, {"url": material_url}), allow_navigation_retry=True)
    if page_result.success and isinstance(page_result.data, list) and page_result.data:
        payload = page_result.data[0] or {}
        encoded = compact(payload.get("base64"))
        if encoded:
            fallback.parent.mkdir(parents=True, exist_ok=True)
            fallback.write_bytes(base64.b64decode(encoded))
            return optimize_reference_image(str(fallback))
    fallback_result = download_url_to_file(material_url, fallback, timeout=45)
    if fallback_result.get("success"):
        return optimize_reference_image(str(fallback_result["path"]))
    return ""


async def find_semir_references(
    runner: JSRunner,
    workflow: WorkflowItem,
    cloud_path: str,
    artifact_dir: Path,
    *,
    allow_global_fallback: bool = True,
    download_files: bool = True,
    download_detail: bool = True,
) -> tuple[dict[str, Any], str, str]:
    payload = {
        "style_code": workflow.style_code,
        "skc_code": workflow.skc_code,
        "cloud_path": cloud_path,
        "limit": 8,
    }
    result = await runner.evaluate_with_reconnect(js_call(SEMIR_FIND_JS, payload), allow_navigation_retry=True)
    if not result.success:
        raise RuntimeError(result.error or "森马云盘找图失败")
    data = (result.data[0] if isinstance(result.data, list) and result.data else {}) if result.data is not None else {}
    if allow_global_fallback and cloud_path and (
        not (data.get("chosenMain") or data.get("chosen")) or not data.get("chosenDetail")
    ):
        fallback_data, _fallback_main_path, _fallback_detail_path = await find_semir_references(
            runner,
            workflow,
            "",
            artifact_dir,
            allow_global_fallback=False,
            download_files=False,
        )
        if not (data.get("chosenMain") or data.get("chosen")) and (fallback_data.get("chosenMain") or fallback_data.get("chosen")):
            data["chosenMain"] = fallback_data.get("chosenMain") or fallback_data.get("chosen")
            data["chosen"] = data["chosenMain"]
        if not data.get("chosenDetail") and fallback_data.get("chosenDetail"):
            data["chosenDetail"] = fallback_data.get("chosenDetail")
        data["fallbackFromCloudPath"] = cloud_path
        data["fallbackSearches"] = fallback_data.get("searches") or []
    if not download_files:
        return data, "", ""
    main = data.get("chosenMain") or data.get("chosen") or {}
    detail = data.get("chosenDetail") or {}
    main_path = await download_semir_candidate(runner, workflow, main, artifact_dir, role="main-origin") if main else ""
    detail_path = await download_semir_candidate(runner, workflow, detail, artifact_dir, role="detail-flat") if detail and download_detail else ""
    if not main_path:
        data["downloadError"] = "未下载到橱窗1/yz(1)主图原图"
    if download_detail and not detail_path:
        data["detailDownloadError"] = "未下载到 SKC 编码平铺参考图"
    return data, main_path, detail_path


async def find_semir_origin(
    runner: JSRunner,
    workflow: WorkflowItem,
    cloud_path: str,
    artifact_dir: Path,
    *,
    allow_global_fallback: bool = True,
) -> tuple[dict[str, Any], str]:
    data, main_path, _detail_path = await find_semir_references(
        runner,
        workflow,
        cloud_path,
        artifact_dir,
        allow_global_fallback=allow_global_fallback,
    )
    return data, main_path


def download_url_to_file(url: str, target: Path, timeout: int = 60) -> dict[str, Any]:
    target.parent.mkdir(parents=True, exist_ok=True)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    partial = target.with_name(f"{target.name}.part")
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with opener.open(request, timeout=timeout) as response:
            with partial.open("wb") as handle:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    handle.write(chunk)
        partial.replace(target)
        return {"success": True, "path": str(target), "bytes": target.stat().st_size}
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        try:
            partial.unlink(missing_ok=True)
        except Exception:
            pass
        return {"success": False, "path": str(target), "error": str(exc)}


def optimize_reference_image(path: str, *, max_bytes: int = REFERENCE_IMAGE_MAX_BYTES) -> str:
    source = Path(path)
    if not source.is_file() or source.stat().st_size <= max_bytes:
        return str(source)
    try:
        from PIL import Image
    except Exception:
        return str(source)

    target = source.with_name(f"{source.stem}-optimized.jpg")
    try:
        with Image.open(source) as image:
            image = image.convert("RGB")
            width, height = image.size
            quality = 92
            scale = 1.0
            while True:
                candidate = image
                if scale < 0.999:
                    candidate = image.resize(
                        (max(1, int(width * scale)), max(1, int(height * scale))),
                        Image.Resampling.LANCZOS,
                    )
                candidate.save(target, format="JPEG", quality=quality, optimize=True)
                if target.stat().st_size <= max_bytes:
                    return str(target)
                if quality > 72:
                    quality -= 8
                    continue
                if scale > 0.55:
                    scale *= 0.88
                    quality = 88
                    continue
                return str(target)
    except Exception:
        try:
            target.unlink(missing_ok=True)
        except Exception:
            pass
        return str(source)


def guess_image_suffix(url: str, fallback: str = ".jpg") -> str:
    match = IMAGE_EXT_RE.search(url)
    if not match:
        return fallback
    ext = match.group(1).lower()
    return f".{'jpg' if ext == 'jpeg' else ext}"


def download_generated_images(row: Mapping[str, Any], artifact_dir: Path) -> list[str]:
    urls = parse_list(row.get("生成图URL"))
    paths: list[str] = []
    prompt_index = int(row.get("提示词序号") or 1)
    for index, url in enumerate(urls, start=1):
        suffix = guess_image_suffix(url, ".jpg")
        image_index = prompt_index if len(urls) == 1 else f"{prompt_index}-{index}"
        target = artifact_dir / f"{compact(row.get('款号'))}-ai-{image_index}{suffix}"
        result = download_url_to_file(url, target, timeout=90)
        if result.get("success"):
            paths.append(str(result["path"]))
    return paths


def image_file_payload(path: str, *, role: str, name: str) -> dict[str, str]:
    data_url = file_to_data_url(path)
    return {
        "name": name,
        "role": role,
        "localPath": str(path),
        "dataUrl": data_url,
    }


async def upload_and_create_tmall_task(
    runner: JSRunner,
    workflow: WorkflowItem,
    origin_path: str,
    generated_paths: list[str],
    *,
    live_upload: bool,
    live_create: bool,
    live_online: bool,
) -> dict[str, Any]:
    files = []
    if origin_path:
        files.append(image_file_payload(origin_path, role="origin", name=f"{workflow.style_code}-origin.jpg"))
    for index, path in enumerate(generated_paths, start=1):
        files.append(image_file_payload(path, role="ai", name=f"{workflow.style_code}-ai-{index}.jpg"))
    payload = {
        "style_code": workflow.style_code,
        "item_id": workflow.item_id,
        "files": files,
        "live_upload": live_upload,
        "live_create": live_create,
        "live_online": live_online,
        "folder_id": "0",
    }
    result = await runner.evaluate_with_reconnect(js_call(TMALL_UPLOAD_CREATE_JS, payload), allow_navigation_retry=True)
    if not result.success:
        raise RuntimeError(result.error or "天猫上传/创建测图任务失败")
    return (result.data[0] if isinstance(result.data, list) and result.data else {}) if result.data is not None else {}


def result_rows_for_workflow(
    workflow: WorkflowItem,
    semir_data: Mapping[str, Any],
    main_origin_path: str,
    detail_reference_path: str,
    generation_rows: list[Mapping[str, Any]],
    generated_paths: list[str],
    tmall_result: Mapping[str, Any] | None,
    error: str = "",
    reference_mode: str = "main_only",
) -> list[dict[str, Any]]:
    chosen = (semir_data or {}).get("chosenMain") or (semir_data or {}).get("chosen") or {}
    detail = (semir_data or {}).get("chosenDetail") or {}
    resolved_skc_code = workflow.skc_code or compact(detail.get("skcCode"))
    requires_detail = compact(reference_mode) == "main_and_detail"
    reference_ok = bool(main_origin_path and (detail_reference_path or not requires_detail))
    if reference_ok and detail_reference_path:
        reference_result = "已下载双参考图"
    elif reference_ok:
        reference_result = "已下载主图参考图"
    else:
        reference_result = "参考图不完整"
    rows = [{
        "表格行号": workflow.row_no,
        "款号": workflow.style_code,
        "商品ID": workflow.item_id,
        "阶段": "森马云盘找图",
        "参考图模式": reference_mode,
        "品类": workflow.category,
        "性别": workflow.gender,
        "SKC编码": resolved_skc_code,
        "云盘路径": compact(chosen.get("fullpath")),
        "文件名": compact(chosen.get("filename")),
        "素材URL": compact(chosen.get("materialUrl")),
        "主图原图文件": main_origin_path,
        "平铺参考图路径": compact(detail.get("fullpath")),
        "平铺参考图文件名": compact(detail.get("filename")),
        "平铺参考图URL": compact(detail.get("materialUrl")),
        "细节参考图文件": detail_reference_path,
        "本地文件": "\n".join(item for item in [main_origin_path, detail_reference_path] if item),
        "执行结果": reference_result,
        "备注": error or "；".join(item for item in [
            compact((semir_data or {}).get("downloadError")),
            compact((semir_data or {}).get("detailDownloadError")),
        ] if item),
    }]
    for index, generation_row in enumerate(generation_rows or [], start=1):
        row_paths = parse_list(generation_row.get("本地生成图文件"))
        rows.append({
            "表格行号": workflow.row_no,
            "款号": workflow.style_code,
            "SKC编码": resolved_skc_code,
            "商品ID": workflow.item_id,
            "阶段": "1XM生图",
            "参考图模式": reference_mode,
            "提示词分组": generation_row.get("提示词分组", ""),
            "提示词字段名": generation_row.get("提示词字段名", ""),
            "提示词序号": generation_row.get("提示词序号", index),
            "尺寸": generation_row.get("尺寸", ""),
            "格式": generation_row.get("格式", ""),
            "质量": generation_row.get("质量", ""),
            "参考图文件": generation_row.get("参考图文件", ""),
            "主参考图文件": generation_row.get("主参考图文件", ""),
            "细节参考图文件": generation_row.get("细节参考图文件", ""),
            "最终提示词": generation_row.get("最终提示词", ""),
            "完整Prompt": generation_row.get("完整Prompt") or generation_row.get("最终提示词", ""),
            "1XM任务ID": generation_row.get("1XM任务ID", ""),
            "1XM轮询URL": generation_row.get("1XM轮询URL", ""),
            "生成图URL": generation_row.get("生成图URL", ""),
            "生成图数量": generation_row.get("生成图数量", ""),
            "本地文件": "\n".join(row_paths),
            "执行结果": generation_row.get("执行结果", ""),
            "备注": generation_row.get("备注", ""),
        })
    if tmall_result is not None:
        uploaded = tmall_result.get("uploaded") or []
        materials = tmall_result.get("materials") or []
        readback = tmall_result.get("readback") if isinstance(tmall_result.get("readback"), dict) else {}
        readback_total = readback.get("total") or readback.get("count") or ""
        task_id = ""
        if isinstance(tmall_result.get("batchPayload"), dict):
            task_id = compact(tmall_result["batchPayload"].get("experimentTaskId"))
        online_ok = bool(tmall_result.get("onlineResult"))
        tmall_error = compact(tmall_result.get("error") or tmall_result.get("uploadError") or tmall_result.get("备注"))
        first_generation = generation_rows[0] if generation_rows else {}
        rows.append({
            "表格行号": workflow.row_no,
            "款号": workflow.style_code,
            "SKC编码": resolved_skc_code,
            "商品ID": workflow.item_id,
            "阶段": "天猫上传/创建测图任务",
            "参考图模式": reference_mode,
            "提示词分组": first_generation.get("提示词分组", ""),
            "提示词字段名": "\n".join(compact(row.get("提示词字段名")) for row in generation_rows if compact(row.get("提示词字段名"))),
            "完整Prompt": "\n\n---\n\n".join(compact(row.get("完整Prompt") or row.get("最终提示词")) for row in generation_rows if compact(row.get("完整Prompt") or row.get("最终提示词"))),
            "任务ID": task_id,
            "上传图数量": len([item for item in uploaded if item.get("url")]),
            "上线结果": "已上线" if online_ok else "未上线",
            "页面回读": f"total={readback_total}" if readback_total != "" else "",
            "素材URL": "\n".join(item.get("picUrl", "") for item in materials),
            "执行结果": (
                "天猫上传/创建失败" if tmall_error else
                "已创建/加素材/已上线"
                if task_id and task_id != "<experimentTaskId>" and online_ok
                else "已创建/加素材" if task_id and task_id != "<experimentTaskId>"
                else "已生成计划"
            ),
            "备注": tmall_error or f"uploaded={len(uploaded)} materials={len(materials)} online={online_ok}",
        })
    return rows


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run Tmall AI image-test chain through CDP page APIs.")
    parser.add_argument("--workflow-file", default=DEFAULT_WORKFLOW_FILE)
    parser.add_argument("--prompt-file", default=DEFAULT_PROMPT_FILE)
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--cloud-path", default=DEFAULT_CLOUD_PATH)
    parser.add_argument("--cdp-url", default="http://127.0.0.1:9222")
    parser.add_argument("--generate", action="store_true", help="Call 1XM for real image generation.")
    parser.add_argument("--live-upload", action="store_true", help="Upload files to Tmall picture center.")
    parser.add_argument("--live-create", action="store_true", help="Create material-test task and batch add images.")
    parser.add_argument("--live-online", action="store_true", help="Call Tmall online API after batch add.")
    parser.add_argument("--image-size", default="960x1280")
    parser.add_argument("--ai-image-count", type=int, default=4)
    parser.add_argument("--generation-concurrency", type=int, default=100)
    parser.add_argument("--reference-mode", default="main_only", choices=["main_only", "main_and_detail"])
    parser.add_argument("--quality", default="auto", choices=["auto", "low", "medium", "high"])
    parser.add_argument("--output-format", default="jpeg")
    parser.add_argument("--one-xm-key-tier", default="auto", choices=["2k", "4k", "auto"])
    parser.add_argument("--retry-attempts", type=int, default=3)
    parser.add_argument("--compensate-attempts", type=int, default=2)
    parser.add_argument("--poll-timeout-minutes", type=float, default=12)
    return parser


async def run_chain_rows(args: argparse.Namespace, artifact_dir: Path, log=None, wait_for_control=None) -> list[dict[str, Any]]:
    all_rows: list[dict[str, Any]] = []
    log = log or print

    workflow_table = read_workbook_table(args.workflow_file)
    workflow_rows, invalid_rows = normalize_workflow_rows(workflow_table, max(1, args.limit))
    prompts = read_prompt_library(args.prompt_file)
    if not workflow_rows:
        raise RuntimeError("工作流表未解析到款号")
    if not prompts:
        raise RuntimeError("提示词库未解析到可用提示词")

    bridge = CDPBridge(args.cdp_url)
    if not bridge.is_available(timeout=5):
        raise RuntimeError(f"无法连接 Chrome CDP：{args.cdp_url}")
    semir_runner = await get_runner(bridge, "https://fmp.semirapp.com/", SEMIR_URL, artifact_dir)
    tmall_runner: JSRunner | None = None

    settings = resolve_one_xm_settings()
    if args.generate and not (settings.get("2k") or settings.get("4k")):
        raise RuntimeError("未配置 1XM Key。请在抓虾设置菜单填写，或设置 ONE_XM_GPT_IMAGE_2K_KEY/ONE_XM_GPT_IMAGE_4K_KEY 环境变量")

    total = len(workflow_rows)
    for completed, workflow in enumerate(workflow_rows, start=1):
        if wait_for_control:
            await wait_for_control({
                "records": len(all_rows),
                "shared": {
                    "total_rows": total,
                    "current_exec_no": completed,
                    "current_row_no": workflow.row_no,
                    "current_buyer_id": workflow.style_code,
                    "current_store": "森马云盘找图",
                },
                "phase": "tmall_ai_chain_semir",
            })
        log(f"[chain] {workflow.style_code} 森马云盘找图")
        selected_prompts = select_prompts(workflow, prompts, max(1, int(args.ai_image_count or 4)))
        if not selected_prompts:
            all_rows.append({
                "表格行号": workflow.row_no,
                "款号": workflow.style_code,
                "商品ID": workflow.item_id,
                "阶段": "提示词匹配",
                "品类": workflow.category,
                "SKC编码": workflow.skc_code,
                "执行结果": "未匹配到提示词",
                "备注": f"映射分组={category_to_prompt_sheet(workflow.category)}",
            })
            continue

        reference_mode = compact(getattr(args, "reference_mode", "main_only")) or "main_only"
        requires_detail_reference = reference_mode == "main_and_detail"
        semir_data, main_origin_path, detail_reference_path = await find_semir_references(
            semir_runner,
            workflow,
            args.cloud_path,
            artifact_dir,
            download_detail=requires_detail_reference,
        )
        detail_candidate = semir_data.get("chosenDetail") if isinstance(semir_data, dict) else {}
        if not workflow.skc_code and isinstance(detail_candidate, Mapping) and compact(detail_candidate.get("skcCode")):
            workflow.skc_code = compact(detail_candidate.get("skcCode"))
        if not main_origin_path or (requires_detail_reference and not detail_reference_path):
            missing_parts = []
            if not main_origin_path:
                missing_parts.append("橱窗1/yz(1)主图原图")
            if requires_detail_reference and not detail_reference_path:
                missing_parts.append("SKC编码平铺参考图")
            all_rows.extend(result_rows_for_workflow(
                workflow,
                semir_data,
                main_origin_path,
                detail_reference_path,
                [],
                [],
                None,
                error=f"缺少{'、'.join(missing_parts)}，已跳过 1XM 生图和天猫上传",
                reference_mode=reference_mode,
            ))
            continue
        reference_paths = [main_origin_path]
        if requires_detail_reference and detail_reference_path:
            reference_paths.append(detail_reference_path)
        generation_rows: list[dict[str, Any]] = [
            make_generation_row(
                workflow,
                prompt,
                reference_paths,
                image_size=args.image_size,
                quality=args.quality,
                output_format=args.output_format,
                key_tier=args.one_xm_key_tier,
                prompt_index=prompt_index,
            )
            for prompt_index, prompt in enumerate(selected_prompts, start=1)
        ]
        generated_paths_by_index: list[list[str]] = [[] for _ in generation_rows]
        if args.generate:
            concurrency = max(1, min(100, int(getattr(args, "generation_concurrency", 100) or 100)))
            semaphore = asyncio.Semaphore(concurrency)

            async def generate_one(row_index: int, generation_row: dict[str, Any]) -> tuple[int, dict[str, Any], list[str]]:
                async with semaphore:
                    prompt_no = int(generation_row.get("提示词序号") or row_index + 1)
                    log(f"[chain] {workflow.style_code} 1XM 生图提交 {prompt_no}/{len(generation_rows)}")
                    try:
                        patched = await asyncio.to_thread(run_one_xm_generation_row, generation_row, {
                            "one_xm_key_tier": args.one_xm_key_tier,
                            "retry_attempts": args.retry_attempts,
                            "compensate_attempts": args.compensate_attempts,
                            "poll_timeout_minutes": args.poll_timeout_minutes,
                        }, settings)
                        row_generated_paths = download_generated_images(patched, artifact_dir)
                        patched["本地生成图文件"] = "\n".join(row_generated_paths)
                        return row_index, patched, row_generated_paths
                    except Exception as exc:
                        failed = dict(generation_row)
                        failed["执行结果"] = "生图失败"
                        failed["备注"] = str(exc)
                        return row_index, failed, []

            tasks = [asyncio.create_task(generate_one(index, row)) for index, row in enumerate(generation_rows)]
            for done_count, task in enumerate(asyncio.as_completed(tasks), start=1):
                row_index, patched_row, row_paths = await task
                generation_rows[row_index] = patched_row
                generated_paths_by_index[row_index] = row_paths
                if wait_for_control:
                    await wait_for_control({
                        "records": len(all_rows),
                        "shared": {
                            "total_rows": total,
                            "current_exec_no": completed,
                            "current_row_no": workflow.row_no,
                            "current_buyer_id": workflow.style_code,
                            "current_store": f"1XM 生图完成 {done_count}/{len(generation_rows)}",
                        },
                        "phase": "tmall_ai_chain_generate",
                    })
        else:
            for generation_row in generation_rows:
                generation_row["执行结果"] = "已生成计划"
                generation_row["备注"] = "未传 --generate，未调用 1XM"
        generated_paths = [path for row_paths in generated_paths_by_index for path in row_paths]

        expected_ai_count = len(selected_prompts)
        if args.live_create and len(generated_paths) < expected_ai_count:
            all_rows.extend(result_rows_for_workflow(
                workflow,
                semir_data,
                main_origin_path,
                detail_reference_path,
                generation_rows,
                generated_paths,
                {"error": f"{workflow.style_code} 仅生成 {len(generated_paths)}/{expected_ai_count} 张 AI 图，未创建天猫测图任务"},
                reference_mode=reference_mode,
            ))
            continue

        tmall_result = None
        if args.live_upload or args.live_create:
            if not workflow.item_id:
                raise RuntimeError(f"{workflow.style_code} 缺少商品 ID，无法创建天猫测图任务")
            if not tmall_runner:
                tmall_runner = await get_runner(
                    bridge,
                    "https://myseller.taobao.com/home.htm/material-center/material-test",
                    TMALL_URL,
                    artifact_dir,
                )
            if wait_for_control:
                await wait_for_control({
                    "records": len(all_rows),
                    "shared": {
                        "total_rows": total,
                        "current_exec_no": completed,
                        "current_row_no": workflow.row_no,
                        "current_buyer_id": workflow.style_code,
                        "current_store": "天猫上传/创建/上线",
                    },
                    "phase": "tmall_ai_chain_tmall",
                })
            log(f"[chain] {workflow.style_code} 天猫上传/创建测图任务")
            try:
                tmall_result = await upload_and_create_tmall_task(
                    tmall_runner,
                    workflow,
                    main_origin_path,
                    generated_paths[:expected_ai_count],
                    live_upload=args.live_upload,
                    live_create=args.live_create,
                    live_online=args.live_online,
                )
            except Exception as exc:
                tmall_result = {
                    "uploaded": [],
                    "materials": [],
                    "batchPayload": {},
                    "onlineResult": None,
                    "error": str(exc),
                }
        elif generated_paths or main_origin_path:
            tmall_result = {
                "uploaded": [],
                "materials": [],
                "batchPayload": {"experimentTaskId": "<experimentTaskId>"},
            }

        all_rows.extend(result_rows_for_workflow(
            workflow,
            semir_data,
            main_origin_path,
            detail_reference_path,
            generation_rows,
            generated_paths[:expected_ai_count],
            tmall_result,
            reference_mode=reference_mode,
        ))

    if invalid_rows:
        all_rows.extend(invalid_rows)

    return all_rows


async def run_chain(args: argparse.Namespace) -> dict[str, Any]:
    data_sink.init_db()
    run_id = data_sink.begin_run(ADAPTER_ID, TASK_ID)
    artifact_dir = Path(data_sink.prepare_artifact_dir(ADAPTER_ID, TASK_ID, run_id, "artifacts"))
    output_files: list[str] = []
    all_rows: list[dict[str, Any]] = []

    try:
        all_rows = await run_chain_rows(args, artifact_dir)

        json_path = data_sink.export_json(
            all_rows,
            ADAPTER_ID,
            TASK_ID,
            "天猫AI测图全链路执行证据_{timestamp}.json",
        )
        excel_path = data_sink.export_excel(
            all_rows,
            ADAPTER_ID,
            TASK_ID,
            "天猫AI测图全链路执行证据_{timestamp}.xlsx",
            column_order=[
                "表格行号",
                "款号",
                "商品ID",
                "阶段",
                "参考图模式",
                "品类",
                "性别",
                "SKC编码",
                "云盘路径",
                "文件名",
                "主图原图文件",
                "平铺参考图路径",
                "平铺参考图文件名",
                "平铺参考图URL",
                "主参考图文件",
                "细节参考图文件",
                "提示词分组",
                "提示词字段名",
                "提示词序号",
                "尺寸",
                "格式",
                "质量",
                "参考图文件",
                "完整Prompt",
                "最终提示词",
                "1XM任务ID",
                "1XM轮询URL",
                "生成图URL",
                "生成图数量",
                "任务ID",
                "上传图数量",
                "上线结果",
                "页面回读",
                "素材URL",
                "本地文件",
                "执行结果",
                "备注",
            ],
        )
        output_files.extend([excel_path, json_path])
        data_sink.finish_run(run_id, len(all_rows), output_files)
        return {
            "run_id": run_id,
            "artifact_dir": str(artifact_dir),
            "rows": len(all_rows),
            "output_files": output_files,
        }
    except Exception as exc:
        if all_rows:
            try:
                output_files.append(data_sink.export_json(
                    all_rows,
                    ADAPTER_ID,
                    TASK_ID,
                    "天猫AI测图全链路执行证据_失败_{timestamp}.json",
                ))
            except Exception:
                pass
        data_sink.fail_run(run_id, str(exc))
        raise


def main() -> None:
    args = build_parser().parse_args()
    started = time.monotonic()
    result = asyncio.run(run_chain(args))
    elapsed = time.monotonic() - started
    print(json.dumps({**result, "elapsed_seconds": round(elapsed, 2)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
