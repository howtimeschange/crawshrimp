#!/usr/bin/env python3
"""Searchable knowledge cards from adapter notes and probe bundles."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml


SECTION_PATTERN = re.compile(r"^(#{2,3})\s+(.*)$")
DATE_SUFFIX_PATTERN = re.compile(r"-20\d{2}(?:-\d{2}){2}$")
URL_PATTERN = re.compile(r"https?://[^\s`)>]+")
NON_WORD_PATTERN = re.compile(r"[^a-z0-9\u4e00-\u9fff]+")


def _slug(value: str) -> str:
    return NON_WORD_PATTERN.sub("-", str(value or "").strip().lower()).strip("-")


def _tokens(value: str) -> list[str]:
    return [token for token in NON_WORD_PATTERN.split(str(value or "").lower()) if token]


def _safe_time(path: Path) -> str:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()
    except Exception:
        return datetime.now(timezone.utc).isoformat()


def _card_id(*parts: str) -> str:
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:16]


def _urls(text: str) -> list[str]:
    seen = []
    for match in URL_PATTERN.finditer(str(text or "")):
        url = match.group(0).rstrip(".,)")
        if url not in seen:
            seen.append(url)
    return seen[:8]


def _split_sections(raw: str) -> tuple[str, list[tuple[str, str]]]:
    title = "Knowledge Note"
    sections: list[tuple[str, str]] = []
    current_heading = "Overview"
    current_lines: list[str] = []
    for line in str(raw or "").splitlines():
        stripped = line.rstrip()
        if stripped.startswith("# ") and title == "Knowledge Note":
            title = stripped[2:].strip() or title
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
    return title, sections


def _lines(raw: str) -> list[str]:
    result = []
    for line in str(raw or "").splitlines():
        stripped = re.sub(r"^\s*[-*]\s*", "", line.strip())
        if stripped:
            result.append(stripped)
    return result


def _kind(heading: str, content: str, source_type: str) -> str:
    label = f"{heading}\n{content}".lower()
    if source_type == "probe":
        if "runtime_action" in label or "capture_" in label:
            return "runtime-action"
        if "endpoint" in label or "api" in label:
            return "endpoint"
        if "phase" in label:
            return "phase-hint"
        return "probe-summary"
    if "selector" in label:
        return "selector"
    if "endpoint" in label or "api" in label or "request" in label:
        return "endpoint"
    if "trap" in label or "坑" in label:
        return "trap"
    if "phase" in label:
        return "phase-hint"
    if "drawer" in label or "modal" in label or "table" in label:
        return "page-shape"
    return "note"


def _read_manifest(path: Path) -> dict[str, Any]:
    try:
        payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


class KnowledgeService:
    def __init__(self, *, adapters_root: Path | str = "adapters", data_root: Path | str = "knowledge", probes_root: Path | str = "probes") -> None:
        self.adapters_root = Path(adapters_root).expanduser()
        self.data_root = Path(data_root).expanduser()
        self.probes_root = Path(probes_root).expanduser()

    @property
    def cards_path(self) -> Path:
        return self.data_root / "cards.json"

    @property
    def index_path(self) -> Path:
        return self.data_root / "index.json"

    def _source_files(self) -> list[Path]:
        paths: list[Path] = []
        if self.adapters_root.exists():
            for adapter_dir in sorted(self.adapters_root.iterdir()):
                manifest_path = adapter_dir / "manifest.yaml"
                if adapter_dir.is_dir() and manifest_path.exists():
                    paths.append(manifest_path)
                    notes_dir = adapter_dir / "notes"
                    if notes_dir.exists():
                        paths.extend(sorted(notes_dir.glob("*.md")))
        if self.probes_root.exists():
            for manifest_path in sorted(self.probes_root.glob("**/manifest.json")):
                bundle_dir = manifest_path.parent
                for name in ("manifest.json", "strategy.json", "recommendations.json", "endpoints.json"):
                    path = bundle_dir / name
                    if path.exists():
                        paths.append(path)
        return paths

    def _source_fingerprint(self) -> str:
        digest = hashlib.sha1()
        for path in self._source_files():
            try:
                marker = f"{path.resolve()}\0{path.stat().st_size}\0".encode("utf-8")
                digest.update(marker)
                digest.update(path.read_bytes())
            except Exception:
                digest.update(str(path).encode("utf-8"))
        return digest.hexdigest()

    def _task_candidates(self, adapter_dir: Path) -> list[tuple[str, str]]:
        manifest = _read_manifest(adapter_dir / "manifest.yaml")
        candidates = []
        for task in manifest.get("tasks") or []:
            if not isinstance(task, dict):
                continue
            task_id = str(task.get("id") or "")
            script_stem = Path(str(task.get("script") or "")).stem
            candidates.append((_slug(task_id), task_id))
            candidates.append((_slug(script_stem), task_id))
        return [(slug, task_id) for slug, task_id in candidates if slug and task_id]

    def _infer_task_id(self, adapter_dir: Path, note_path: Path) -> str:
        note_slug = _slug(note_path.stem).replace("-dom-findings", "").replace("-findings", "").replace("-probe", "")
        note_slug = DATE_SUFFIX_PATTERN.sub("", note_slug)
        best = ("", 0)
        for candidate, task_id in self._task_candidates(adapter_dir):
            score = 0
            if note_slug == candidate:
                score = 100
            elif note_slug.startswith(candidate):
                score = 80 + len(candidate)
            elif candidate in note_slug:
                score = 40 + len(candidate)
            elif note_slug in candidate:
                score = 20 + len(note_slug)
            if score > best[1]:
                best = (task_id, score)
        return best[0]

    def _note_cards(self, adapter_id: str, adapter_dir: Path, note_path: Path) -> list[dict[str, Any]]:
        title, sections = _split_sections(note_path.read_text(encoding="utf-8"))
        task_id = self._infer_task_id(adapter_dir, note_path)
        cards = []
        for heading, body in sections:
            content = "\n".join(_lines(body))
            if not content:
                continue
            card_title = title if heading == "Overview" else f"{title} / {heading}"
            kind = _kind(heading, content, "note")
            source_key = f"note:{note_path}"
            cards.append(
                {
                    "id": _card_id(source_key, card_title, kind, adapter_id, task_id),
                    "adapter_id": adapter_id,
                    "task_id": task_id,
                    "title": card_title,
                    "kind": kind,
                    "content": content,
                    "url_patterns": _urls(f"{heading}\n{content}"),
                    "source_type": "note",
                    "source_path": str(note_path),
                    "source_key": source_key,
                    "updated_at": _safe_time(note_path),
                }
            )
        return cards

    def _probe_cards(self, bundle_dir: Path) -> list[dict[str, Any]]:
        manifest_path = bundle_dir / "manifest.json"
        if not manifest_path.exists():
            return []
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        strategy = json.loads((bundle_dir / "strategy.json").read_text(encoding="utf-8")) if (bundle_dir / "strategy.json").exists() else {}
        recommendations = json.loads((bundle_dir / "recommendations.json").read_text(encoding="utf-8")) if (bundle_dir / "recommendations.json").exists() else {}
        endpoints = json.loads((bundle_dir / "endpoints.json").read_text(encoding="utf-8")) if (bundle_dir / "endpoints.json").exists() else []
        adapter_id = str(manifest.get("adapter_id") or "")
        task_id = str(manifest.get("task_id") or "")
        probe_id = str(manifest.get("probe_id") or bundle_dir.name)
        cards = [
            {
                "id": _card_id(f"probe:{probe_id}:summary", adapter_id, task_id),
                "adapter_id": adapter_id,
                "task_id": task_id,
                "title": f"Probe {probe_id}",
                "kind": "probe-summary",
                "content": "\n".join(
                    [
                        f"Goal: {manifest.get('goal') or '(none)'}",
                        f"Target URL: {manifest.get('target_url') or ''}",
                        f"Final URL: {manifest.get('final_url') or ''}",
                        f"Page Strategy: {strategy.get('page_strategy') or ''}",
                        f"Auth Strategy: {strategy.get('auth_strategy') or ''}",
                        f"Phase Candidates: {', '.join(recommendations.get('phase_candidates') or [])}",
                        f"Runtime Actions: {', '.join(recommendations.get('runtime_actions') or [])}",
                    ]
                ),
                "url_patterns": [value for value in [manifest.get("target_url"), manifest.get("final_url")] if value],
                "source_type": "probe",
                "source_path": str(bundle_dir / "report.md"),
                "source_key": f"probe:{probe_id}:summary",
                "updated_at": _safe_time(manifest_path),
            }
        ]
        for index, endpoint in enumerate(endpoints[:12], start=1):
            pattern = str(endpoint.get("pattern") or endpoint.get("url") or "")
            if not pattern:
                continue
            content = "\n".join(
                [
                    f"Method: {endpoint.get('method') or 'GET'}",
                    f"Pattern: {pattern}",
                    f"Runtime Action: {endpoint.get('runtime_action') or 'none'}",
                    f"Auth: {', '.join(endpoint.get('auth_indicators') or [])}",
                    f"Fields: {', '.join((endpoint.get('sample_fields') or [])[:12])}",
                ]
            )
            cards.append(
                {
                    "id": _card_id(f"probe:{probe_id}:endpoint:{index}", adapter_id, task_id),
                    "adapter_id": adapter_id,
                    "task_id": task_id,
                    "title": f"Probe {probe_id} / Endpoint {index}",
                    "kind": "endpoint",
                    "content": content,
                    "url_patterns": [pattern],
                    "source_type": "probe",
                    "source_path": str(bundle_dir / "endpoints.json"),
                    "source_key": f"probe:{probe_id}:endpoint:{index}",
                    "updated_at": _safe_time(bundle_dir / "endpoints.json"),
                }
            )
        return cards

    def rebuild(self) -> dict[str, Any]:
        cards: list[dict[str, Any]] = []
        if self.adapters_root.exists():
            for adapter_dir in sorted(self.adapters_root.iterdir()):
                manifest_path = adapter_dir / "manifest.yaml"
                if not adapter_dir.is_dir() or not manifest_path.exists():
                    continue
                manifest = _read_manifest(manifest_path)
                adapter_id = str(manifest.get("id") or adapter_dir.name)
                notes_dir = adapter_dir / "notes"
                if notes_dir.exists():
                    for note_path in sorted(notes_dir.glob("*.md")):
                        cards.extend(self._note_cards(adapter_id, adapter_dir, note_path))
        if self.probes_root.exists():
            for manifest_path in sorted(self.probes_root.glob("**/manifest.json")):
                cards.extend(self._probe_cards(manifest_path.parent))
        self.data_root.mkdir(parents=True, exist_ok=True)
        self.cards_path.write_text(json.dumps(cards, ensure_ascii=False, indent=2), encoding="utf-8")
        self.index_path.write_text(
            json.dumps(
                {
                    "card_count": len(cards),
                    "source_fingerprint": self._source_fingerprint(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        self._write_skill_docs(cards)
        return {"ok": True, "card_count": len(cards), "cards_path": str(self.cards_path)}

    def _write_skill_docs(self, cards: list[dict[str, Any]]) -> None:
        grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
        for card in cards:
            grouped[(str(card.get("adapter_id") or ""), str(card.get("task_id") or ""))].append(card)
        root = self.data_root / "skills"
        for (adapter_id, task_id), group in grouped.items():
            if not adapter_id or not task_id:
                continue
            path = root / adapter_id / f"{task_id}.md"
            path.parent.mkdir(parents=True, exist_ok=True)
            lines = [f"# {adapter_id}/{task_id} Knowledge", ""]
            for card in group:
                lines.extend([f"## [{card.get('kind')}] {card.get('title')}", "", str(card.get("content") or ""), ""])
            path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")

    def _load_cards(self) -> list[dict[str, Any]]:
        if not self.cards_path.exists() or not self.index_path.exists():
            self.rebuild()
        else:
            try:
                index = json.loads(self.index_path.read_text(encoding="utf-8"))
            except Exception:
                index = {}
            if not isinstance(index, dict) or index.get("source_fingerprint") != self._source_fingerprint():
                self.rebuild()
        payload = json.loads(self.cards_path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, list) else []

    def search(self, query: str = "", *, adapter_id: str = "", task_id: str = "", url: str = "", limit: int = 8) -> dict[str, Any]:
        query_tokens = set(_tokens(query))
        scored = []
        for card in self._load_cards():
            if adapter_id and card.get("adapter_id") != adapter_id:
                continue
            if task_id and card.get("task_id") != task_id:
                continue
            if url:
                patterns = card.get("url_patterns") or []
                if patterns and not any(str(pattern).split("?")[0] in url or url.startswith(str(pattern).split("?")[0]) for pattern in patterns):
                    continue
            haystack = f"{card.get('title')} {card.get('kind')} {card.get('content')}".lower()
            score = 1
            score += sum(3 for token in query_tokens if token in haystack)
            if adapter_id:
                score += 2
            if task_id:
                score += 2
            if query and score <= 1:
                continue
            excerpt = str(card.get("content") or "").replace("\n", " ")[:240]
            scored.append((score, {**card, "excerpt": excerpt}))
        scored.sort(key=lambda item: item[0], reverse=True)
        return {"cards": [item for _, item in scored[: max(1, int(limit or 8))]]}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build and search crawshrimp-style knowledge cards.")
    parser.add_argument("--adapters-root", default="adapters")
    parser.add_argument("--data-root", default="knowledge")
    parser.add_argument("--probes-root", default="probes")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("rebuild")
    search = sub.add_parser("search")
    search.add_argument("--query", default="")
    search.add_argument("--adapter", default="")
    search.add_argument("--task", default="")
    search.add_argument("--url", default="")
    search.add_argument("--limit", type=int, default=8)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    service = KnowledgeService(adapters_root=args.adapters_root, data_root=args.data_root, probes_root=args.probes_root)
    if args.command == "rebuild":
        print(json.dumps(service.rebuild(), ensure_ascii=False, indent=2))
    else:
        print(json.dumps(service.search(args.query, adapter_id=args.adapter, task_id=args.task, url=args.url, limit=args.limit), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
