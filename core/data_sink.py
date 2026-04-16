"""
Data persistence layer
- Task run state stored in SQLite
- Data records exported to Excel / JSON
- Filename templates support {date}, {datetime}, {timestamp}, {adapter_id}, {task_id}
"""
import json
import logging
import os
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, List, Mapping, Optional

from core.models import TaskRun, TaskStatus

logger = logging.getLogger(__name__)


class _SafeTemplateVars(dict):
    def __missing__(self, key):
        return ""


def _data_root() -> Path:
    base = os.environ.get("CRAWSHRIMP_DATA", str(Path.home() / ".crawshrimp"))
    p = Path(base) / "data"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _db_path() -> Path:
    base = os.environ.get("CRAWSHRIMP_DATA", str(Path.home() / ".crawshrimp"))
    p = Path(base)
    p.mkdir(parents=True, exist_ok=True)   # auto-create ~/.crawshrimp/
    return p / "crawshrimp.db"


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_db_path()))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create tables if not exists"""
    with _get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS task_runs (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                adapter_id   TEXT NOT NULL,
                task_id      TEXT NOT NULL,
                status       TEXT NOT NULL DEFAULT 'idle',
                started_at   TEXT,
                finished_at  TEXT,
                records_count INTEGER DEFAULT 0,
                error        TEXT,
                output_files TEXT DEFAULT '[]'
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_task_runs_adapter_task
            ON task_runs (adapter_id, task_id)
        """)
        conn.commit()


def begin_run(adapter_id: str, task_id: str) -> int:
    """Record a task run start, return run_id"""
    with _get_conn() as conn:
        cur = conn.execute("""
            INSERT INTO task_runs (adapter_id, task_id, status, started_at)
            VALUES (?, ?, 'running', ?)
        """, (adapter_id, task_id, datetime.now().isoformat()))
        conn.commit()
        return cur.lastrowid


def finish_run(run_id: int, records_count: int, output_files: List[str]):
    with _get_conn() as conn:
        conn.execute("""
            UPDATE task_runs
            SET status='done', finished_at=?, records_count=?, output_files=?
            WHERE id=?
        """, (datetime.now().isoformat(), records_count, json.dumps(output_files), run_id))
        conn.commit()


def fail_run(run_id: int, error: str):
    with _get_conn() as conn:
        conn.execute("""
            UPDATE task_runs
            SET status='error', finished_at=?, error=?
            WHERE id=?
        """, (datetime.now().isoformat(), error, run_id))
        conn.commit()


def stop_run(run_id: int, records_count: int, output_files: List[str], error: str = ""):
    with _get_conn() as conn:
        conn.execute("""
            UPDATE task_runs
            SET status='stopped', finished_at=?, records_count=?, output_files=?, error=?
            WHERE id=?
        """, (datetime.now().isoformat(), records_count, json.dumps(output_files), error, run_id))
        conn.commit()


def get_latest_run(adapter_id: str, task_id: str) -> Optional[dict]:
    with _get_conn() as conn:
        row = conn.execute("""
            SELECT * FROM task_runs
            WHERE adapter_id=? AND task_id=?
            ORDER BY id DESC LIMIT 1
        """, (adapter_id, task_id)).fetchone()
        return dict(row) if row else None


def list_runs(adapter_id: str, task_id: str, limit: int = 20) -> List[dict]:
    with _get_conn() as conn:
        rows = conn.execute("""
            SELECT * FROM task_runs
            WHERE adapter_id=? AND task_id=?
            ORDER BY id DESC LIMIT ?
        """, (adapter_id, task_id, limit)).fetchall()
        return [dict(r) for r in rows]


def _normalize_output_file_path(path: str) -> str:
    try:
        return str(Path(str(path)).expanduser().resolve(strict=False))
    except Exception:
        return str(path or '').strip()


def remove_output_files(paths: List[str]) -> dict:
    target_paths = {
        _normalize_output_file_path(path)
        for path in (paths or [])
        if str(path or '').strip()
    }
    target_paths.discard('')
    if not target_paths:
        return {"updated_runs": 0, "removed_refs": 0}

    updated_runs = 0
    removed_refs = 0

    with _get_conn() as conn:
        rows = conn.execute("""
            SELECT id, output_files
            FROM task_runs
            WHERE output_files IS NOT NULL AND output_files != '[]'
        """).fetchall()

        for row in rows:
            raw_files = row["output_files"]
            try:
                files = json.loads(raw_files) if isinstance(raw_files, str) else raw_files
            except Exception:
                continue
            if not isinstance(files, list):
                continue

            kept_files = []
            changed = False
            for item in files:
                file_path = str(item or '').strip()
                if not file_path:
                    changed = True
                    continue
                if _normalize_output_file_path(file_path) in target_paths:
                    removed_refs += 1
                    changed = True
                    continue
                kept_files.append(file_path)

            if changed:
                conn.execute(
                    "UPDATE task_runs SET output_files=? WHERE id=?",
                    (json.dumps(kept_files), row["id"]),
                )
                updated_runs += 1

        conn.commit()

    return {"updated_runs": updated_runs, "removed_refs": removed_refs}


# ─── Export functions ───

def _sanitize_filename(text: Any, fallback: str = "output") -> str:
    value = str(text or "").strip()
    value = re.sub(r"\s+", " ", value)
    value = re.sub(r"[\x00-\x1f]+", "", value)
    value = re.sub(r'[\\/:*?"<>|]+', "_", value)
    value = value.strip(" .")
    return value or fallback


def _render_filename(template: str, adapter_id: str, task_id: str,
                     filename_vars: Optional[Mapping[str, Any]] = None) -> str:
    now = datetime.now()
    vars_map = {
        "date": now.strftime("%Y%m%d"),
        "datetime": now.strftime("%Y%m%d_%H%M%S"),
        "timestamp": now.strftime("%Y%m%d-%H%M%S"),
        "adapter_id": adapter_id,
        "task_id": task_id,
    }
    if filename_vars:
        for key, value in filename_vars.items():
            vars_map[str(key)] = _sanitize_filename(value, "")
    return _sanitize_filename(template.format_map(_SafeTemplateVars(vars_map)))


def _ensure_unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    idx = 2
    while True:
        candidate = path.with_name(f"{stem}_{idx}{suffix}")
        if not candidate.exists():
            return candidate
        idx += 1


def _normalize_sheet_title(name: Any, fallback: str) -> str:
    value = _sanitize_filename(name, fallback).strip()
    if not value:
        value = fallback
    return value[:31] or fallback[:31] or "Sheet1"


def _clean_excel_row(row: Mapping[str, Any]) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}
    for key, value in (row or {}).items():
        key_text = str(key or "")
        if key_text.startswith("__"):
            continue
        cleaned[key_text] = value
    return cleaned


def _normalize_column_groups(column_groups: Optional[Iterable[Mapping[str, Any]]]) -> list[dict[str, Any]]:
    normalized_groups = []
    for group in column_groups or []:
        if hasattr(group, "model_dump"):
            group = group.model_dump()
        label = str((group or {}).get("label") or "").strip()
        columns = [
            str(col or "").strip()
            for col in ((group or {}).get("columns") or [])
            if str(col or "").strip()
        ]
        if not label or not columns:
            continue
        normalized_groups.append({"label": label, "columns": columns})
    return normalized_groups


def _resolve_headers(data: List[dict], column_order: Optional[List[str]] = None) -> list[str]:
    headers: list[str] = []
    seen_headers = set()
    for key in column_order or []:
        key_text = str(key or "").strip()
        if not key_text or key_text.startswith("__") or key_text in seen_headers:
            continue
        seen_headers.add(key_text)
        headers.append(key_text)
    for row in data:
        for key in row.keys():
            key_text = str(key or "").strip()
            if not key_text or key_text.startswith("__") or key_text in seen_headers:
                continue
            seen_headers.add(key_text)
            headers.append(key_text)
    return headers


def _write_excel_sheet(ws, data: List[dict], column_order: Optional[List[str]] = None,
                       column_groups: Optional[Iterable[Mapping[str, Any]]] = None) -> None:
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    headers = _resolve_headers(data, column_order)
    if not headers:
        headers = ["提示"]
        data = [{"提示": "无数据"}]

    header_fill = PatternFill(fill_type="solid", fgColor="F5F7FA")
    header_font = Font(bold=True)
    header_alignment = Alignment(horizontal="center", vertical="center")

    def _leaf_header_label(column_key: str) -> str:
        value = str(column_key or "").strip()
        if "/" in value:
            return value.split("/")[-1].strip() or value
        return value

    normalized_groups = _normalize_column_groups(column_groups)
    group_lookup = {}
    for group in normalized_groups:
        for column in group["columns"]:
            group_lookup[column] = group["label"]

    has_grouped_header = bool(normalized_groups)
    if has_grouped_header:
        top_row = []
        leaf_row = []
        for header in headers:
            group_label = group_lookup.get(header, "")
            if group_label:
                top_row.append(group_label)
                leaf_row.append(_leaf_header_label(header))
            else:
                top_row.append(_leaf_header_label(header))
                leaf_row.append("")

        ws.append(top_row)
        ws.append(leaf_row)

        col_index = 1
        while col_index <= len(headers):
            header = headers[col_index - 1]
            group_label = group_lookup.get(header, "")
            if not group_label:
                ws.merge_cells(start_row=1, start_column=col_index, end_row=2, end_column=col_index)
                col_index += 1
                continue

            end_col = col_index
            while end_col < len(headers) and group_lookup.get(headers[end_col], "") == group_label:
                end_col += 1
            if end_col > col_index:
                ws.merge_cells(start_row=1, start_column=col_index, end_row=1, end_column=end_col)
            col_index = end_col + 1

        for row_no in (1, 2):
            for cell in ws[row_no]:
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = header_alignment
        ws.freeze_panes = "A3"
    else:
        ws.append(headers)
        for cell in ws[1]:
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = header_alignment
        ws.freeze_panes = "A2"

    for row in data:
        ws.append([str(row.get(h, "")) for h in headers])

    for col_idx in range(1, ws.max_column + 1):
        letter = get_column_letter(col_idx)
        max_len = 10
        for row_idx in range(1, ws.max_row + 1):
            value = ws.cell(row=row_idx, column=col_idx).value
            max_len = max(max_len, len(str(value or "")))
        ws.column_dimensions[letter].width = min(max_len + 4, 60)


def prepare_artifact_dir(adapter_id: str, task_id: str, run_id: int, kind: str = "artifacts") -> str:
    """Create and return a per-run artifact directory."""
    safe_kind = _sanitize_filename(kind, "artifacts")
    out_dir = _data_root() / adapter_id / task_id / safe_kind / str(run_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    return str(out_dir)


def export_excel(
    data: List[dict],
    adapter_id: str,
    task_id: str,
    filename_template: str = "{task_id}_{date}.xlsx",
    filename_vars: Optional[Mapping[str, Any]] = None,
    column_order: Optional[List[str]] = None,
    column_groups: Optional[List[Mapping[str, Any]]] = None,
    sheet_key: Optional[str] = None,
    sheet_configs: Optional[List[Mapping[str, Any]]] = None,
) -> str:
    """
    Export data to Excel file.
    Returns absolute path of written file.
    """
    from openpyxl import Workbook

    if not data:
        raise ValueError("No data to export")

    filename = _render_filename(filename_template, adapter_id, task_id, filename_vars)
    out_dir = _data_root() / adapter_id / task_id
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = _ensure_unique_path(out_dir / filename)

    wb = Workbook()
    cleaned_data = [_clean_excel_row(row) for row in data]
    normalized_sheet_key = str(sheet_key or "").strip()

    if not normalized_sheet_key:
        ws = wb.active
        ws.title = _normalize_sheet_title(task_id, task_id[:31] or "Sheet1")
        _write_excel_sheet(ws, cleaned_data, column_order, column_groups)
        total_rows = len(cleaned_data)
    else:
        sheet_rows: dict[str, list[dict[str, Any]]] = {}
        sheet_order: list[str] = []
        for raw_row in data:
            sheet_name = str((raw_row or {}).get(normalized_sheet_key) or "").strip() or "Sheet1"
            if sheet_name not in sheet_rows:
                sheet_rows[sheet_name] = []
                sheet_order.append(sheet_name)
            sheet_rows[sheet_name].append(_clean_excel_row(raw_row))

        config_by_name: dict[str, Mapping[str, Any]] = {}
        ordered_names: list[str] = []
        for config in sheet_configs or []:
            if hasattr(config, "model_dump"):
                config = config.model_dump()
            name = str((config or {}).get("name") or "").strip()
            if not name:
                continue
            config_by_name[name] = config
            ordered_names.append(name)

        final_sheet_names = [name for name in ordered_names if name in sheet_rows]
        final_sheet_names.extend(name for name in sheet_order if name not in final_sheet_names)
        if not final_sheet_names:
            final_sheet_names = ["Sheet1"]
            sheet_rows["Sheet1"] = cleaned_data

        ws = wb.active
        first_name = final_sheet_names[0]
        ws.title = _normalize_sheet_title(first_name, "Sheet1")
        first_config = config_by_name.get(first_name) or {}
        _write_excel_sheet(
            ws,
            sheet_rows.get(first_name) or [],
            list((first_config or {}).get("columns") or column_order or []),
            (first_config or {}).get("column_groups") or column_groups,
        )

        for name in final_sheet_names[1:]:
            config = config_by_name.get(name) or {}
            sheet = wb.create_sheet(title=_normalize_sheet_title(name, "Sheet"))
            _write_excel_sheet(
                sheet,
                sheet_rows.get(name) or [],
                list((config or {}).get("columns") or column_order or []),
                (config or {}).get("column_groups") or column_groups,
            )

        total_rows = sum(len(rows) for rows in sheet_rows.values())

    wb.save(str(out_path))
    logger.info(f"Excel exported: {out_path} ({total_rows} rows)")
    return str(out_path)


def export_json(data: List[dict], adapter_id: str, task_id: str,
                filename_template: str = "{task_id}_{date}.json",
                filename_vars: Optional[Mapping[str, Any]] = None) -> str:
    """
    Export data to JSON file.
    Returns absolute path of written file.
    """
    filename = _render_filename(filename_template, adapter_id, task_id, filename_vars)
    out_dir = _data_root() / adapter_id / task_id
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = _ensure_unique_path(out_dir / filename)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    logger.info(f"JSON exported: {out_path} ({len(data)} records)")
    return str(out_path)


def export_desktop_excel(data: List[dict], adapter_id: str, task_id: str,
                         filename_template: str = "{task_id}_{date}.xlsx",
                         filename_vars: Optional[Mapping[str, Any]] = None) -> str:
    """Export to user Desktop (mirrors temu-assistant behavior)"""
    from openpyxl import Workbook
    desktop = Path.home() / "Desktop"
    filename = _render_filename(filename_template, adapter_id, task_id, filename_vars)
    out_path = _ensure_unique_path(desktop / filename)
    wb = Workbook()
    ws = wb.active
    ws.title = task_id[:31]
    if data:
        headers = list(data[0].keys())
        ws.append(headers)
        for row in data:
            ws.append([str(row.get(h, "")) for h in headers])
    wb.save(str(out_path))
    logger.info(f"Excel exported to Desktop: {out_path}")
    return str(out_path)
