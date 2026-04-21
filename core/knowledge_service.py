"""Materialize adapter notes and probe bundles into searchable knowledge cards."""
from __future__ import annotations

import hashlib
import json
import os
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from core import adapter_loader


SECTION_PATTERN = re.compile(r"^(#{2,3})\s+(.*)$")
DATE_SUFFIX_PATTERN = re.compile(r"-20\d{2}(?:-\d{2}){2}$")
URL_PATTERN = re.compile(r"https?://[^\s`)>]+")
NON_WORD_PATTERN = re.compile(r"[^a-z0-9\u4e00-\u9fff]+")


def _data_root() -> Path:
    base = os.environ.get("CRAWSHRIMP_DATA", str(Path.home() / ".crawshrimp"))
    root = Path(base) / "knowledge"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _cards_path() -> Path:
    return _data_root() / "cards.json"


def _meta_path() -> Path:
    return _data_root() / "index.json"


def _skills_root() -> Path:
    root = _data_root() / "skills"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _normalize_slug(value: str) -> str:
    cleaned = NON_WORD_PATTERN.sub("-", str(value or "").strip().lower())
    return cleaned.strip("-")


def _normalize_query_tokens(value: str) -> list[str]:
    return [token for token in NON_WORD_PATTERN.split(str(value or "").lower()) if token]


def _task_candidates(adapter_id: str) -> list[tuple[str, str]]:
    adapter = adapter_loader.get_adapter(adapter_id)
    if not adapter:
        return []
    candidates: list[tuple[str, str]] = []
    for task in adapter.tasks:
        candidates.append((_normalize_slug(task.id), task.id))
        candidates.append((_normalize_slug(Path(task.script).stem), task.id))
    seen: set[tuple[str, str]] = set()
    unique: list[tuple[str, str]] = []
    for item in candidates:
        if item in seen:
            continue
        seen.add(item)
        unique.append(item)
    return unique


def _infer_task_id_from_note(adapter_id: str, note_path: Path) -> str:
    slug = _normalize_slug(note_path.stem)
    slug = slug.replace("-dom-findings", "").replace("-findings", "").replace("-probe", "")
    slug = DATE_SUFFIX_PATTERN.sub("", slug)
    best_task = ""
    best_score = 0
    for candidate_slug, task_id in _task_candidates(adapter_id):
        if not candidate_slug:
            continue
        score = 0
        if slug == candidate_slug:
            score = 100
        elif slug.startswith(candidate_slug):
            score = 80 + len(candidate_slug)
        elif candidate_slug in slug:
            score = 40 + len(candidate_slug)
        elif slug in candidate_slug:
            score = 20 + len(slug)
        if score > best_score:
            best_score = score
            best_task = task_id
    return best_task


def _extract_urls(text: str) -> list[str]:
    urls = [match.group(0).rstrip(".,)") for match in URL_PATTERN.finditer(str(text or ""))]
    deduped: list[str] = []
    for url in urls:
        if url not in deduped:
            deduped.append(url)
    return deduped[:8]


def _coerce_lines(raw: str) -> list[str]:
    lines: list[str] = []
    for line in str(raw or "").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        stripped = re.sub(r"^\s*[-*]\s*", "", stripped)
        lines.append(stripped)
    return lines


def _split_markdown_sections(raw: str) -> tuple[str, list[tuple[str, str]]]:
    title = ""
    sections: list[tuple[str, str]] = []
    current_heading = "Overview"
    current_lines: list[str] = []

    for line in str(raw or "").splitlines():
        stripped = line.rstrip()
        if not stripped.strip():
            if current_lines and current_lines[-1] != "":
                current_lines.append("")
            continue
        if stripped.startswith("# ") and not title:
            title = stripped[2:].strip()
            continue
        match = SECTION_PATTERN.match(stripped.strip())
        if match:
            body = "\n".join(current_lines).strip()
            if body:
                sections.append((current_heading, body))
            current_heading = match.group(2).strip()
            current_lines = []
            continue
        current_lines.append(stripped)

    body = "\n".join(current_lines).strip()
    if body:
        sections.append((current_heading, body))
    return title or "Knowledge Note", sections


def _infer_kind(heading: str, content: str, source_type: str) -> str:
    label = f"{heading}\n{content}".lower()
    if source_type == "probe":
        if "runtime_action" in label or "capture_" in label:
            return "runtime-action"
        if "phase" in label:
            return "phase-hint"
        if "endpoint" in label or "api" in label:
            return "endpoint"
        if "page strategy" in label or "auth strategy" in label:
            return "strategy"
        return "probe-summary"
    if "selector" in label:
        return "selector"
    if "endpoint" in label or "api" in label or "request" in label:
        return "endpoint"
    if "trap" in label or "坑" in label or "误判" in label:
        return "trap"
    if "wait" in label or "加载" in label:
        return "wait"
    if "phase" in label:
        return "phase-hint"
    if "table" in label or "drawer" in label or "modal" in label or "结构" in label:
        return "page-shape"
    return "note"


def _card_id(source_key: str, title: str, kind: str, adapter_id: str, task_id: str) -> str:
    digest = hashlib.sha1(f"{source_key}|{title}|{kind}|{adapter_id}|{task_id}".encode("utf-8")).hexdigest()
    return digest[:16]


def _safe_timestamp(path: Path) -> str:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()
    except Exception:
        return datetime.now(timezone.utc).isoformat()


def _build_note_cards(adapter_id: str, note_path: Path) -> list[dict[str, Any]]:
    raw = note_path.read_text(encoding="utf-8")
    title, sections = _split_markdown_sections(raw)
    task_id = _infer_task_id_from_note(adapter_id, note_path)
    cards: list[dict[str, Any]] = []
    for heading, body in sections:
        lines = _coerce_lines(body)
        if not lines:
            continue
        content = "\n".join(lines)
        card_title = title if heading == "Overview" else f"{title} / {heading}"
        kind = _infer_kind(heading, content, "note")
        source_key = f"note:{note_path}"
        cards.append({
            "id": _card_id(source_key, card_title, kind, adapter_id, task_id),
            "adapter_id": adapter_id,
            "task_id": task_id,
            "title": card_title,
            "kind": kind,
            "content": content,
            "url_patterns": _extract_urls(f"{heading}\n{content}"),
            "source_type": "note",
            "source_path": str(note_path),
            "source_key": source_key,
            "updated_at": _safe_timestamp(note_path),
        })
    return cards


def _endpoint_cards(bundle_dir: Path, manifest: dict[str, Any], endpoints: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    adapter_id = str(manifest.get("adapter_id") or "")
    task_id = str(manifest.get("task_id") or "")
    probe_id = str(manifest.get("probe_id") or bundle_dir.name)
    for index, endpoint in enumerate(endpoints[:12], start=1):
        pattern = str(endpoint.get("pattern") or endpoint.get("url") or "").strip()
        if not pattern:
            continue
        lines = [
            f"Method: {endpoint.get('method') or 'GET'}",
            f"Pattern: {pattern}",
        ]
        if endpoint.get("item_path"):
            lines.append(f"Item Path: {endpoint['item_path']}")
        if endpoint.get("runtime_action") and endpoint.get("runtime_action") != "none":
            lines.append(f"Runtime Action: {endpoint['runtime_action']}")
        if endpoint.get("auth_indicators"):
            lines.append(f"Auth: {', '.join(endpoint['auth_indicators'])}")
        if endpoint.get("sample_fields"):
            lines.append(f"Fields: {', '.join(endpoint['sample_fields'][:12])}")
        title = f"Probe {probe_id} / Endpoint {index}"
        source_key = f"probe:{probe_id}:endpoint:{index}"
        cards.append({
            "id": _card_id(source_key, title, "endpoint", adapter_id, task_id),
            "adapter_id": adapter_id,
            "task_id": task_id,
            "title": title,
            "kind": "endpoint",
            "content": "\n".join(lines),
            "url_patterns": [pattern],
            "source_type": "probe",
            "source_path": str(bundle_dir / "endpoints.json"),
            "source_key": source_key,
            "updated_at": _safe_timestamp(bundle_dir / "endpoints.json"),
        })
    return cards


def _build_probe_cards(bundle_dir: Path) -> list[dict[str, Any]]:
    manifest_path = bundle_dir / "manifest.json"
    strategy_path = bundle_dir / "strategy.json"
    recommendations_path = bundle_dir / "recommendations.json"
    endpoints_path = bundle_dir / "endpoints.json"
    if not manifest_path.exists():
        return []

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    strategy = json.loads(strategy_path.read_text(encoding="utf-8")) if strategy_path.exists() else {}
    recommendations = json.loads(recommendations_path.read_text(encoding="utf-8")) if recommendations_path.exists() else {}
    endpoints = json.loads(endpoints_path.read_text(encoding="utf-8")) if endpoints_path.exists() else []
    adapter_id = str(manifest.get("adapter_id") or "")
    task_id = str(manifest.get("task_id") or "")
    probe_id = str(manifest.get("probe_id") or bundle_dir.name)

    summary_lines = [
        f"Goal: {manifest.get('goal') or '(none)'}",
        f"Target URL: {manifest.get('target_url') or ''}",
        f"Final URL: {manifest.get('final_url') or ''}",
        f"Page Strategy: {strategy.get('page_strategy') or ''}",
        f"Auth Strategy: {strategy.get('auth_strategy') or ''}",
    ]
    phase_candidates = recommendations.get("phase_candidates") or []
    runtime_actions = recommendations.get("runtime_actions") or []
    if phase_candidates:
        summary_lines.append(f"Phase Candidates: {', '.join(phase_candidates)}")
    if runtime_actions:
        summary_lines.append(f"Runtime Actions: {', '.join(runtime_actions)}")

    summary_card = {
        "id": _card_id(f"probe:{probe_id}:summary", f"Probe {probe_id}", "probe-summary", adapter_id, task_id),
        "adapter_id": adapter_id,
        "task_id": task_id,
        "title": f"Probe {probe_id}",
        "kind": "probe-summary",
        "content": "\n".join(summary_lines),
        "url_patterns": [value for value in [manifest.get("target_url"), manifest.get("final_url")] if value],
        "source_type": "probe",
        "source_path": str(bundle_dir / "report.md"),
        "source_key": f"probe:{probe_id}:summary",
        "updated_at": _safe_timestamp(manifest_path),
    }
    return [summary_card, *_endpoint_cards(bundle_dir, manifest, endpoints)]


def _iter_installed_adapter_dirs() -> list[tuple[str, Path]]:
    if not adapter_loader.list_all():
        adapter_loader.scan_all()
    results: list[tuple[str, Path]] = []
    for item in adapter_loader.list_all():
        adapter_dir = adapter_loader.get_adapter_dir(item["id"])
        if adapter_dir:
            results.append((item["id"], adapter_dir))
    return results


def _iter_probe_bundle_dirs() -> list[Path]:
    base = os.environ.get("CRAWSHRIMP_DATA", str(Path.home() / ".crawshrimp"))
    root = Path(base) / "probes"
    if not root.exists():
        return []
    return sorted(path.parent for path in root.glob("**/manifest.json"))


def _source_fingerprint() -> str:
    sources: list[tuple[str, int, int]] = []
    for _, adapter_dir in _iter_installed_adapter_dirs():
        notes_dir = adapter_dir / "notes"
        if not notes_dir.exists():
            continue
        for note_path in sorted(notes_dir.glob("*.md")):
            stat = note_path.stat()
            sources.append((str(note_path), stat.st_mtime_ns, stat.st_size))
    for bundle_dir in _iter_probe_bundle_dirs():
        for name in ("manifest.json", "strategy.json", "recommendations.json", "endpoints.json", "report.md"):
            path = bundle_dir / name
            if not path.exists():
                continue
            stat = path.stat()
            sources.append((str(path), stat.st_mtime_ns, stat.st_size))
    digest = hashlib.sha1(json.dumps(sorted(sources), ensure_ascii=False).encode("utf-8")).hexdigest()
    return digest


def _load_cards() -> list[dict[str, Any]]:
    path = _cards_path()
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload if isinstance(payload, list) else []


def _write_skill_docs(cards: list[dict[str, Any]]) -> dict[tuple[str, str], str]:
    skills_root = _skills_root()
    if skills_root.exists():
        for path in sorted(skills_root.glob("**/*"), reverse=True):
            if path.is_file():
                path.unlink()
            elif path.is_dir():
                try:
                    path.rmdir()
                except OSError:
                    pass
    skills_root.mkdir(parents=True, exist_ok=True)

    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    path_map: dict[tuple[str, str], str] = {}
    for card in cards:
        grouped[(card["adapter_id"], card.get("task_id") or "_general")].append(card)

    for (adapter_id, task_id), entries in grouped.items():
        adapter_dir = skills_root / adapter_id
        adapter_dir.mkdir(parents=True, exist_ok=True)
        skill_path = adapter_dir / f"{task_id}.md"
        path_map[(adapter_id, task_id)] = str(skill_path)
        lines = [
            f"# {adapter_id} / {task_id}",
            "",
            "> Generated from adapter notes and probe bundles. Rebuild via `/knowledge/rebuild` or after probe runs.",
            "",
        ]
        by_kind: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for entry in entries:
            by_kind[entry["kind"]].append(entry)
        for kind in sorted(by_kind):
            lines.append(f"## {kind}")
            lines.append("")
            for entry in by_kind[kind]:
                lines.append(f"### {entry['title']}")
                lines.append("")
                lines.append(entry["content"])
                lines.append("")
                lines.append(f"Source: `{entry['source_path']}`")
                lines.append("")
        skill_path.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")
    return path_map


def rebuild_knowledge_index() -> dict[str, Any]:
    cards: list[dict[str, Any]] = []
    for adapter_id, adapter_dir in _iter_installed_adapter_dirs():
        notes_dir = adapter_dir / "notes"
        if notes_dir.exists():
            for note_path in sorted(notes_dir.glob("*.md")):
                cards.extend(_build_note_cards(adapter_id, note_path))
    for bundle_dir in _iter_probe_bundle_dirs():
        cards.extend(_build_probe_cards(bundle_dir))

    cards.sort(key=lambda item: (item.get("adapter_id", ""), item.get("task_id", ""), item.get("title", "")))
    skill_paths = _write_skill_docs(cards)
    for card in cards:
        card["skill_path"] = skill_paths.get((card["adapter_id"], card.get("task_id") or "_general"), "")
        card["search_text"] = "\n".join([
            str(card.get("adapter_id") or ""),
            str(card.get("task_id") or ""),
            str(card.get("title") or ""),
            str(card.get("kind") or ""),
            str(card.get("content") or ""),
            " ".join(card.get("url_patterns") or []),
        ])

    _cards_path().write_text(json.dumps(cards, ensure_ascii=False, indent=2), encoding="utf-8")
    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "fingerprint": _source_fingerprint(),
        "card_count": len(cards),
    }
    _meta_path().write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, **meta}


def ensure_knowledge_index() -> dict[str, Any]:
    current_fingerprint = _source_fingerprint()
    if not _meta_path().exists() or not _cards_path().exists():
        return rebuild_knowledge_index()
    try:
        meta = json.loads(_meta_path().read_text(encoding="utf-8"))
    except Exception:
        return rebuild_knowledge_index()
    if meta.get("fingerprint") != current_fingerprint:
        return rebuild_knowledge_index()
    return {"ok": True, **meta}


def search_knowledge(
    query: str,
    *,
    adapter_id: str = "",
    task_id: str = "",
    url: str = "",
    limit: int = 8,
) -> dict[str, Any]:
    ensure_knowledge_index()
    cards = _load_cards()
    normalized_adapter = str(adapter_id or "").strip()
    normalized_task = str(task_id or "").strip()
    normalized_url = str(url or "").strip()
    tokens = _normalize_query_tokens(query)

    matches: list[dict[str, Any]] = []
    for card in cards:
        if normalized_adapter and card.get("adapter_id") != normalized_adapter:
            continue
        if normalized_task and card.get("task_id") not in {"", normalized_task}:
            continue

        title = str(card.get("title") or "").lower()
        content = str(card.get("search_text") or "").lower()
        score = 0
        if normalized_url and any(pattern and pattern in normalized_url for pattern in card.get("url_patterns") or []):
            score += 8
        for token in tokens:
            if token in title:
                score += 5
            if token in content:
                score += 2

        if not tokens:
            if normalized_url and score == 0:
                continue
            score = score or 1
        elif score <= 0:
            continue

        matches.append({
            **card,
            "score": score,
            "excerpt": str(card.get("content") or "")[:280],
        })

    matches.sort(key=lambda item: (int(item.get("score") or 0), str(item.get("updated_at") or "")), reverse=True)
    return {
        "ok": True,
        "query": query,
        "adapter_id": normalized_adapter,
        "task_id": normalized_task,
        "url": normalized_url,
        "total": len(matches),
        "cards": matches[: max(1, int(limit or 8))],
    }
