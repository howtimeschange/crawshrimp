"""Amazon label PDF splitting helpers.

This module keeps the local PDF processing for the Amazon operations adapter
outside ``api_server.py``.  The adapter script returns source PDF references and
FNSKU mappings; this service extracts a code from each PDF page, matches the
mapping, and writes one single-page PDF per matched label.
"""

from __future__ import annotations

import logging
import re
import shutil
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

FNSKU_PATTERN = re.compile(r"\bX[0-9A-Z]{9}\b", re.IGNORECASE)


def safe_local_name(value: Any, fallback: str = "item") -> str:
    text = str(value or "").strip()
    text = re.sub(r"[\x00-\x1f]+", "", text)
    text = re.sub(r'[\\/:*?"<>|]+', "_", text)
    text = re.sub(r"\s+", " ", text).strip(" ._")
    return text or fallback


def ensure_unique_local_path(path: Path) -> Path:
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


def ensure_unique_local_dir(path: Path) -> Path:
    if not path.exists():
        return path
    index = 2
    while True:
        candidate = path.with_name(f"{path.name}_{index}")
        if not candidate.exists():
            return candidate
        index += 1


def copy_file_to_unique_target(source: Path, target: Path) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    unique_target = ensure_unique_local_path(target)
    shutil.copy2(source, unique_target)
    return unique_target


def normalize_mapping_rows(raw_rows: list | None) -> dict[str, dict[str, str]]:
    mappings: dict[str, dict[str, str]] = {}
    for row in raw_rows or []:
        if not isinstance(row, dict):
            continue
        fnsku = str(row.get("fnsku") or row.get("FNSKU") or "").strip().upper()
        label_name = str(row.get("labelName") or row.get("标签名称") or "").strip()
        sku = str(row.get("sku") or row.get("SKU") or "").strip()
        if not fnsku or not label_name:
            continue
        mappings.setdefault(fnsku, {
            "fnsku": fnsku,
            "sku": sku,
            "label_name": label_name,
        })
    return mappings


def extract_fnskus_from_text(text: str) -> list[str]:
    seen: set[str] = set()
    codes: list[str] = []
    for match in FNSKU_PATTERN.finditer(str(text or "").upper()):
        code = match.group(0).upper()
        if code in seen:
            continue
        seen.add(code)
        codes.append(code)
    return codes


def extract_page_text(page) -> str:
    try:
        return str(page.get_text("text") or "")
    except Exception:
        logger.debug("Failed to extract Amazon label page text", exc_info=True)
        return ""


def write_single_page_pdf(source_document, page_index: int, target_path: Path) -> Path:
    try:
        import fitz
    except Exception as exc:  # pragma: no cover - exercised in packaged env
        raise RuntimeError("缺少 PyMuPDF 依赖，无法拆分 PDF") from exc

    target_path.parent.mkdir(parents=True, exist_ok=True)
    output_path = ensure_unique_local_path(target_path)
    output_document = fitz.open()
    try:
        output_document.insert_pdf(source_document, from_page=page_index, to_page=page_index)
        output_document.save(str(output_path))
    finally:
        output_document.close()
    return output_path


def split_pdf_by_mapping(pdf_path: Path, mappings: dict[str, dict[str, str]], output_root: Path) -> list[dict[str, Any]]:
    try:
        import fitz
    except Exception as exc:  # pragma: no cover - exercised in packaged env
        raise RuntimeError("缺少 PyMuPDF 依赖，无法拆分 PDF") from exc

    source = Path(pdf_path).expanduser()
    if not source.is_file():
        raise FileNotFoundError(f"PDF 文件不存在：{source}")

    rows: list[dict[str, Any]] = []
    document = fitz.open(str(source))
    try:
        for page_index in range(document.page_count):
            page = document.load_page(page_index)
            page_no = page_index + 1
            text = extract_page_text(page)
            codes = extract_fnskus_from_text(text)
            matched_code = next((code for code in codes if code in mappings), "")
            first_code = matched_code or (codes[0] if codes else "")

            base_row = {
                "PDF文件": source.name,
                "页码": page_no,
                "识别FNSKU": first_code,
                "SKU": "",
                "标签名称": "",
                "匹配结果": "",
                "输出PDF": "",
                "备注": "",
                "__pdf_path": str(source),
                "__page_index": page_index,
            }

            if not codes:
                rows.append({
                    **base_row,
                    "匹配结果": "未识别",
                    "备注": "本页未识别到 FNSKU",
                })
                continue

            if not matched_code:
                rows.append({
                    **base_row,
                    "匹配结果": "未匹配",
                    "备注": f"识别到 {', '.join(codes)}，但映射表中不存在",
                })
                continue

            mapping = mappings[matched_code]
            label_name = mapping["label_name"]
            output_name = f"{safe_local_name(label_name, matched_code)}.pdf"
            output_path = write_single_page_pdf(
                document,
                page_index,
                output_root / output_name,
            )
            rows.append({
                **base_row,
                "识别FNSKU": matched_code,
                "SKU": mapping.get("sku", ""),
                "标签名称": label_name,
                "匹配结果": "已拆分",
                "输出PDF": str(output_path),
                "备注": "" if output_path.name == output_name else f"文件名重复，已输出为 {output_path.name}",
            })
    finally:
        document.close()

    return rows


def _mapping_rows_from_data(data_rows: list) -> list[dict[str, str]]:
    for row in data_rows or []:
        if isinstance(row, dict) and isinstance(row.get("__mapping_rows"), list):
            return row.get("__mapping_rows") or []
    return []


def _pdf_paths_from_data(data_rows: list) -> list[Path]:
    paths: list[Path] = []
    seen: set[str] = set()
    for row in data_rows or []:
        if not isinstance(row, dict):
            continue
        raw_path = str(row.get("__pdf_path") or "").strip()
        if not raw_path:
            continue
        key = raw_path.lower()
        if key in seen:
            continue
        seen.add(key)
        paths.append(Path(raw_path).expanduser())
    return paths


def _zip_output_root(output_root: Path, runtime_dir: Path) -> Path:
    zip_path = ensure_unique_local_path(runtime_dir / f"{output_root.name}.zip")
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file_path in sorted(output_root.rglob("*")):
            if not file_path.is_file():
                continue
            archive.write(file_path, arcname=str(file_path.relative_to(output_root.parent)))
    return zip_path


def split_amazon_label_rows(
    data_rows: list,
    run_params: dict,
    runtime_artifact_dir: str,
    log,
) -> tuple[list[dict[str, Any]], list[str]]:
    runtime_dir = Path(runtime_artifact_dir)
    runtime_dir.mkdir(parents=True, exist_ok=True)

    mappings = normalize_mapping_rows(_mapping_rows_from_data(data_rows))
    if not mappings:
        raise ValueError("未找到有效 FNSKU 映射，请检查映射表是否包含 FNSKU 和 标签名称")

    pdf_paths = _pdf_paths_from_data(data_rows)
    if not pdf_paths:
        raise ValueError("未找到待处理 PDF 文件")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    package_base = safe_local_name(
        (run_params or {}).get("package_name") or f"亚马逊标签_{timestamp}",
        f"亚马逊标签_{timestamp}",
    )
    output_root = ensure_unique_local_dir(runtime_dir / package_base)
    output_root.mkdir(parents=True, exist_ok=True)

    result_rows: list[dict[str, Any]] = []
    for pdf_path in pdf_paths:
        pdf_rows = split_pdf_by_mapping(pdf_path, mappings, output_root)
        result_rows.extend(pdf_rows)
        split_count = len([row for row in pdf_rows if row.get("匹配结果") == "已拆分"])
        log(f"Amazon label PDF processed: {pdf_path.name} ({split_count}/{len(pdf_rows)} pages split)")

    output_refs: list[str] = [str(output_root)]
    if str((run_params or {}).get("output_mode") or "folder_and_zip").strip() != "folder_only":
        zip_path = _zip_output_root(output_root, runtime_dir)
        output_refs.insert(0, str(zip_path))
        log(f"Amazon label split package created: {zip_path}")

    return result_rows, output_refs


def copy_amazon_label_outputs_to_export_folder(
    generated_refs: list[str],
    exported_files: list[str],
    run_params: dict,
    log,
) -> list[str]:
    export_folder = str((run_params or {}).get("export_folder") or "").strip()
    if not export_folder:
        return [str(path) for path in [*generated_refs, *exported_files] if str(path or "").strip()]

    target_root = Path(export_folder).expanduser()
    target_root.mkdir(parents=True, exist_ok=True)
    external_refs: list[str] = []

    for ref in generated_refs or []:
        source = Path(str(ref or "")).expanduser()
        if source.is_dir():
            target_dir = ensure_unique_local_dir(target_root / source.name)
            shutil.copytree(source, target_dir)
            external_refs.append(str(target_dir))
            log(f"Amazon label split PDFs copied to export folder: {target_dir}")
        elif source.is_file():
            copied = copy_file_to_unique_target(source, target_root / source.name)
            external_refs.append(str(copied))

    for ref in exported_files or []:
        source = Path(str(ref or "")).expanduser()
        if source.is_file():
            copied = copy_file_to_unique_target(source, target_root / source.name)
            external_refs.append(str(copied))

    return external_refs
