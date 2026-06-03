"""ODPS/MaxCompute data sync helpers."""
from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from openpyxl import load_workbook


TASK_TABLE_MAP = {
    ("temu", "mall_flux"): "imp_ods_temu_mall_flux",
    ("tiktok-ops-assistant", "product_analytics"): "imp_ods_tiktok_product_analytics",
}

TASK_FIELD_MAP = {
    ("temu", "mall_flux"): {
        "平台名称": "platform_name",
        "店铺名称": "shop_name",
        "店铺ID": "shop_id",
        "外层站点": "outer_site",
        "统计日期范围": "stat_date_range",
        "统计粒度": "stat_grain",
        "列表页码": "page_no",
        "抓取时间": "captured_at",
        "列表行号": "row_no",
        "日期": "stat_date",
        "总数据/总浏览量": "total_views",
        "总数据/总访客数": "total_visitors",
        "总数据/总支付买家数": "total_paid_buyers",
        "总数据/总支付转化率": "total_payment_conversion_rate",
        "总数据/总支付件数": "total_paid_items",
        "商品数据/商品浏览量": "product_views",
        "商品数据/商品访客数": "product_visitors",
        "商品数据/商详支付买家数": "product_detail_paid_buyers",
        "商品数据/商详支付转化率": "product_detail_payment_conversion_rate",
        "店铺数据/店铺页浏览量": "shop_page_views",
        "店铺数据/店铺页面访客数": "shop_page_visitors",
        "店铺数据/店铺页支付买家数": "shop_page_paid_buyers",
        "店铺数据/店铺页支付转化率": "shop_page_payment_conversion_rate",
    },
    ("tiktok-ops-assistant", "product_analytics"): {
        "平台名称": "platform_name",
        "区域": "region",
        "店铺ID": "shop_id",
        "店铺名称": "shop_name",
        "统计日期范围": "stat_date_range",
        "对比日期范围": "compare_date_range",
        "抓取时间": "captured_at",
        "订单数": "orders",
        "商品曝光次数": "product_impressions",
        "商品点击量": "product_clicks",
    },
}

TASK_FIELD_TYPE_MAP = {
    ("temu", "mall_flux"): {
        "平台名称": "string",
        "店铺名称": "string",
        "店铺ID": "string",
        "外层站点": "string",
        "统计日期范围": "string",
        "统计粒度": "string",
        "列表页码": "bigint",
        "抓取时间": "datetime",
        "列表行号": "bigint",
        "日期": "string",
        "总数据/总浏览量": "bigint",
        "总数据/总访客数": "bigint",
        "总数据/总支付买家数": "bigint",
        "总数据/总支付转化率": "string",
        "总数据/总支付件数": "bigint",
        "商品数据/商品浏览量": "bigint",
        "商品数据/商品访客数": "bigint",
        "商品数据/商详支付买家数": "bigint",
        "商品数据/商详支付转化率": "string",
        "店铺数据/店铺页浏览量": "bigint",
        "店铺数据/店铺页面访客数": "bigint",
        "店铺数据/店铺页支付买家数": "bigint",
        "店铺数据/店铺页支付转化率": "string",
    },
    ("tiktok-ops-assistant", "product_analytics"): {
        "平台名称": "string",
        "区域": "string",
        "店铺ID": "string",
        "店铺名称": "string",
        "统计日期范围": "string",
        "对比日期范围": "string",
        "抓取时间": "datetime",
        "订单数": "bigint",
        "商品曝光次数": "bigint",
        "商品点击量": "bigint",
    },
}

DEFAULT_WRITE_MODE = "append"
DEFAULT_DATAWORKS_PATH = "/api/v1/dataworks/write_odps"
DEFAULT_DATAWORKS_ENDPOINT = "http://dataworksapi.semirapp.com/api/v1/dataworks/write_odps"


class OdpsSyncError(Exception):
    """Raised when a data file cannot be converted or synced."""


def get_table_name(adapter_id: str, task_id: str) -> str:
    table_name = TASK_TABLE_MAP.get((str(adapter_id or "").strip(), str(task_id or "").strip()))
    if not table_name:
        raise OdpsSyncError(f"暂不支持同步该任务：{adapter_id}/{task_id}")
    return table_name


def get_field_name(adapter_id: str, task_id: str, header: str, index: int) -> str:
    mapping = TASK_FIELD_MAP.get((str(adapter_id or "").strip(), str(task_id or "").strip()), {})
    mapped = str(mapping.get(str(header or "").strip()) or "").strip()
    if mapped:
        return mapped
    slug = re.sub(r"[^0-9A-Za-z_]+", "_", str(header or "").strip()).strip("_").lower()
    if slug:
        return slug
    return f"col_{index + 1}"


def get_field_type(adapter_id: str, task_id: str, header: str, values: list[Any]) -> str:
    mapping = TASK_FIELD_TYPE_MAP.get((str(adapter_id or "").strip(), str(task_id or "").strip()), {})
    mapped = str(mapping.get(str(header or "").strip()) or "").strip()
    if mapped:
        return mapped
    return infer_odps_type(header, values)


def normalize_endpoint(endpoint: str) -> str:
    url = str(endpoint or "").strip()
    if not url:
        return ""
    return url.rstrip("/")


def resolve_write_odps_url(endpoint: str) -> str:
    url = normalize_endpoint(endpoint)
    if not url:
        return ""
    if url.endswith("/write_odps"):
        return url
    if url.endswith("/api/v1/dataworks"):
        return f"{url}/write_odps"
    if "dataworksapi.semirapp.com" in url or "alicloudapi.com" in url:
        return f"{url}{DEFAULT_DATAWORKS_PATH}"
    return f"{url}/write_odps"


def build_request_headers(app_code: str = "") -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    code = str(app_code or "").strip()
    if code:
        headers["Authorization"] = f"APPCODE {code}"
    return headers


def _clean_header(value: Any, index: int) -> str:
    text = str(value or "").strip()
    return text or f"列{index + 1}"


def _cell_value(value: Any) -> Any:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    return str(value)


def read_excel_rows(file_path: str) -> tuple[list[str], list[dict[str, Any]]]:
    path = Path(file_path).expanduser()
    if not path.exists() or not path.is_file():
        raise OdpsSyncError(f"文件不存在：{file_path}")
    if path.suffix.lower() not in {".xlsx", ".xlsm"}:
        raise OdpsSyncError(f"暂只支持同步 xlsx/xlsm Excel 文件：{path.name}")

    wb = load_workbook(path, read_only=True, data_only=True)
    try:
        ws = wb.active
        raw_rows = list(ws.iter_rows(values_only=True))
    finally:
        wb.close()

    if not raw_rows:
        raise OdpsSyncError(f"Excel 文件为空：{path.name}")

    header_row = next((row for row in raw_rows if any(str(cell or "").strip() for cell in row)), None)
    if not header_row:
        raise OdpsSyncError(f"Excel 文件缺少表头：{path.name}")

    header_index = raw_rows.index(header_row)
    headers = [_clean_header(value, index) for index, value in enumerate(header_row)]
    rows: list[dict[str, Any]] = []
    for raw in raw_rows[header_index + 1:]:
        if all(cell is None or str(cell).strip() == "" for cell in raw):
            continue
        row = {}
        for index, header in enumerate(headers):
            row[header] = _cell_value(raw[index] if index < len(raw) else None)
        rows.append(row)

    if not rows:
        raise OdpsSyncError(f"Excel 文件没有可同步的数据行：{path.name}")
    return headers, rows


def infer_odps_type(field_name: str, values: list[Any]) -> str:
    name = str(field_name or "")
    clean_values = [str(value or "").strip() for value in values if str(value or "").strip()]
    if not clean_values:
        return "string"
    if any(token in name for token in ["日期范围", "范围"]):
        return "string"
    if "时间" in name:
        return "datetime"
    if any(token in name for token in ["转化率", "率", "占比"]):
        return "string"
    numeric_values = [value.replace(",", "") for value in clean_values]
    if all(re.fullmatch(r"-?\d+", value) for value in numeric_values):
        return "bigint"
    if all(re.fullmatch(r"-?\d+(\.\d+)?", value) for value in numeric_values):
        return "double"
    return "string"


def cast_odps_value(value: Any, field_type: str) -> Any:
    if value is None:
        return None
    text = str(value).strip()
    if text == "":
        return None
    normalized_type = str(field_type or "").strip().lower()
    if normalized_type in {"int", "integer", "bigint"}:
        numeric_text = text.replace(",", "")
        if re.fullmatch(r"-?\d+", numeric_text):
            return int(numeric_text)
        return text
    if normalized_type in {"float", "double", "decimal", "numeric"}:
        numeric_text = text.replace(",", "")
        if re.fullmatch(r"-?\d+(\.\d+)?", numeric_text):
            return float(numeric_text)
        return text
    if normalized_type in {"datetime", "date", "timestamp"}:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
            return f"{text} 00:00:00"
        return text
    return text


def normalize_partition_value(value: str) -> str:
    text = str(value or "").strip()
    match = re.search(r"\d{4}-\d{2}-\d{2}", text)
    if match:
        return match.group(0)
    return datetime.now().strftime("%Y-%m-%d")


def build_sync_payload(
    adapter_id: str,
    task_id: str,
    file_path: str,
    *,
    write_mode: str = DEFAULT_WRITE_MODE,
) -> dict[str, Any]:
    headers, rows = read_excel_rows(file_path)
    field_names = [get_field_name(adapter_id, task_id, header, index) for index, header in enumerate(headers)]
    field_types = [
        get_field_type(adapter_id, task_id, header, [row.get(header, "") for row in rows])
        for header in headers
    ]
    data_rows = [
        {
            field_names[index]: cast_odps_value(row.get(header, ""), field_types[index])
            for index, header in enumerate(headers)
        }
        for row in rows
    ]
    fields = [
        {
            "name": field_names[index],
            "type": field_types[index],
            "comment": header,
        }
        for index, header in enumerate(headers)
    ]
    date_value = rows[0].get("日期") or rows[0].get("统计日期") or rows[0].get("统计日期范围") or ""
    return {
        "table_name": get_table_name(adapter_id, task_id),
        "fields": fields,
        "data": data_rows,
        "write_mode": write_mode,
        "partition_spec": {"dt": normalize_partition_value(str(date_value))},
    }


def _post_json(
    url: str,
    payload: dict[str, Any],
    timeout: int = 30,
    headers: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(url, data=body, headers=headers or build_request_headers(), method="POST")
    try:
        with urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode("utf-8")
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise OdpsSyncError(f"接口返回 HTTP {error.code}: {detail or error.reason}") from error
    except URLError as error:
        raise OdpsSyncError(f"接口请求失败：{error.reason}") from error

    if not text:
        return {}
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as error:
        raise OdpsSyncError(f"接口返回不是合法 JSON：{text[:200]}") from error
    return parsed if isinstance(parsed, dict) else {"result": parsed}


def sync_file(
    adapter_id: str,
    task_id: str,
    file_path: str,
    *,
    endpoint: str,
    app_code: str = "",
    post_json: Optional[Callable[..., dict[str, Any]]] = None,
) -> dict[str, Any]:
    url = resolve_write_odps_url(endpoint)
    if not url:
        raise OdpsSyncError("未配置 ODPS 同步接口地址")
    if not str(app_code or "").strip():
        raise OdpsSyncError("未配置 ODPS AppCode，请在设置里填写 ODPS AppCode")

    payload = build_sync_payload(adapter_id, task_id, file_path)
    sender = post_json or _post_json
    response = sender(url, payload, 30, headers=build_request_headers(app_code))
    if response.get("success") is False:
        raise OdpsSyncError(response.get("error") or response.get("message") or "接口同步失败")
    return {
        "ok": True,
        "file": str(file_path),
        "table_name": payload["table_name"],
        "count": len(payload["data"]),
        "partition_spec": payload["partition_spec"],
        "response": response,
    }


def sync_files(
    adapter_id: str,
    task_id: str,
    file_paths: list[str],
    *,
    endpoint: str,
    app_code: str = "",
) -> dict[str, Any]:
    paths = [str(path or "").strip() for path in file_paths or [] if str(path or "").strip()]
    if not paths:
        raise OdpsSyncError("请选择需要同步的 Excel 文件")

    results = []
    failed = []
    for path in paths:
        try:
            results.append(sync_file(adapter_id, task_id, path, endpoint=endpoint, app_code=app_code))
        except Exception as error:
            failed.append({"file": path, "error": str(error)})

    return {
        "ok": not failed,
        "synced_count": len(results),
        "failed_count": len(failed),
        "results": results,
        "failed": failed,
    }
