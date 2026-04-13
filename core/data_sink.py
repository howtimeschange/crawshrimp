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
from typing import Any, List, Mapping, Optional

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


def export_excel(
    data: List[dict],
    adapter_id: str,
    task_id: str,
    filename_template: str = "{task_id}_{date}.xlsx",
    filename_vars: Optional[Mapping[str, Any]] = None,
    column_order: Optional[List[str]] = None,
    column_groups: Optional[List[Mapping[str, Any]]] = None,
) -> str:
    """
    Export data to Excel file.
    Returns absolute path of written file.
    """
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    if not data:
        raise ValueError("No data to export")

    filename = _render_filename(filename_template, adapter_id, task_id, filename_vars)
    out_dir = _data_root() / adapter_id / task_id
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = _ensure_unique_path(out_dir / filename)

    wb = Workbook()
    ws = wb.active
    ws.title = task_id[:31]  # Sheet name max 31 chars

    # Write headers from explicit order first, then append any unexpected keys
    headers = []
    seen_headers = set()
    if column_order:
        for key in column_order:
            k = str(key or "").strip()
            if not k or k in seen_headers:
                continue
            seen_headers.add(k)
            headers.append(k)
    for row in data:
        for key in row.keys():
            k = str(key)
            if k in seen_headers:
                continue
            seen_headers.add(k)
            headers.append(k)

    header_fill = PatternFill(fill_type="solid", fgColor="F5F7FA")
    header_font = Font(bold=True)
    header_alignment = Alignment(horizontal="center", vertical="center")

    def _leaf_header_label(column_key: str) -> str:
        value = str(column_key or "").strip()
        if "/" in value:
            return value.split("/")[-1].strip() or value
        return value

    normalized_groups = []
    group_lookup = {}
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
        for column in columns:
            group_lookup[column] = label

    has_grouped_header = bool(normalized_groups)
    data_start_row = 2

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
        data_start_row = 3

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

    # Write rows
    for row in data:
        ws.append([str(row.get(h, "")) for h in headers])

    # Auto column width
    for col_idx in range(1, ws.max_column + 1):
        letter = get_column_letter(col_idx)
        max_len = 10
        for row_idx in range(1, ws.max_row + 1):
            value = ws.cell(row=row_idx, column=col_idx).value
            max_len = max(max_len, len(str(value or "")))
        ws.column_dimensions[letter].width = min(max_len + 4, 60)

    wb.save(str(out_path))
    logger.info(f"Excel exported: {out_path} ({len(data)} rows)")
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
