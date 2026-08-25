"""Rule-based slot locking for DeepDraw shoe package candidates."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any


RULESET_VERSION = "shoe-slot-rules.v2"
LOCK_SCORE_THRESHOLD = 0.80
LOCK_SCORE_GAP = 0.15


def _text(value: Any) -> str:
    return str(value or "").strip()


def _lower(value: Any) -> str:
    return _text(value).lower()


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    text = _lower(value)
    return text in {"1", "true", "yes", "y", "是", "有", "完整"}


def _confidence(value: Any) -> float:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return 0.0
    if confidence > 1.0:
        confidence = confidence / 100.0
    return max(0.0, min(1.0, confidence))


SLOT_ALIASES: dict[str, str] = {
    "main1": "tmz1",
    "main2": "tmz2",
    "main3": "tmz3",
    "main4": "tmz4",
    "main5": "tmz5",
    "main_pose1": "tmz1",
    "main_pose2": "tmz2",
    "main_pose3": "tmz3",
    "main_pose4": "tmz4",
    "main_pose5": "tmz5",
    "pose1": "tmz1",
    "pose2": "tmz2",
    "pose3": "tmz3",
    "pose4": "tmz4",
    "pose5": "tmz5",
    "box": "wpz6",
    "box_label": "wpz6",
    "label": "wpz6",
    "shoe_box": "wpz6",
    "outsole": "yq2",
    "sole": "yq2",
    "outer_side": "yq3",
    "side_view": "yq3",
    "feature_card": "yx",
    "hangtag": "yx",
    "tag": "yx",
}


def normalize_slot_name(value: Any) -> str:
    text = _lower(value).replace("-", "_").replace(" ", "_")
    text = re.sub(r"[\u4e00-\u9fff]+", "", text)
    text = SLOT_ALIASES.get(text, text)
    match = re.fullmatch(r"(tmz|wpz|yq)(\d+)", text)
    if match:
        return text
    if text in {"o", "yx", "yk", "tms"}:
        return text
    return SLOT_ALIASES.get(text, "")


def _split_slot_values(value: Any) -> list[str]:
    if isinstance(value, dict):
        return [str(key) for key, enabled in value.items() if enabled]
    if isinstance(value, list):
        raw = value
    else:
        raw = re.split(r"[,，、/;\s]+", _text(value))
    return [item for item in (normalize_slot_name(item) for item in raw) if item]


def _pose_slot_hints(value: Any) -> list[str]:
    text = _lower(value).replace("-", "_").replace(" ", "_")
    hints: list[str] = []
    for slot in (
        "tmz1",
        "tmz2",
        "tmz3",
        "tmz4",
        "tmz5",
        "wpz5",
        "wpz6",
        "yq1",
        "yq2",
        "yq3",
        "yx",
    ):
        if slot in text:
            hints.append(slot)
    if re.search(r"main(?:_pose)?_?([1-5])", text):
        hints.append(f"tmz{re.search(r'main(?:_pose)?_?([1-5])', text).group(1)}")
    for alias, slot in SLOT_ALIASES.items():
        if alias in text and slot:
            hints.append(slot)
    return list(dict.fromkeys(hints))


@dataclass(frozen=True)
class CandidateFacts:
    candidate_id: str
    filename: str
    asset_type: str = ""
    shoe_count: str = ""
    pose: str = ""
    background: str = ""
    complete: bool = False
    side: str = ""
    outsole_visible: bool = False
    feature_card: bool = False
    confidence: float = 0.0
    matched_slots: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class SlotDecision:
    slot: str
    candidate_id: str = ""
    filename: str = ""
    score: float = 0.0
    second_score: float = 0.0
    status: str = "empty_no_candidate"
    reason: str = ""


def has_candidate_facts_payload(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    return any(isinstance(payload.get(key), list) for key in ("candidates", "candidate_facts", "items"))


def _candidate_rows(payload: dict[str, Any]) -> list[Any]:
    for key in ("candidates", "candidate_facts", "items"):
        rows = payload.get(key)
        if isinstance(rows, list):
            return rows
    return []


def parse_candidate_facts(
    payload: dict[str, Any],
    candidate_ids: dict[str, str],
) -> list[CandidateFacts]:
    facts: list[CandidateFacts] = []
    for row in _candidate_rows(payload):
        if not isinstance(row, dict):
            continue
        candidate_id = _text(
            row.get("candidate_id")
            or row.get("id")
            or row.get("image_id")
            or row.get("candidate")
        )
        filename = _text(row.get("filename") or row.get("file") or row.get("name"))
        if candidate_id in candidate_ids:
            filename = candidate_ids[candidate_id]
        elif filename:
            candidate_id = next(
                (key for key, value in candidate_ids.items() if value == filename),
                candidate_id,
            )
        if not candidate_id or candidate_id not in candidate_ids:
            continue
        matched_slots: list[str] = []
        for key in (
            "matched_slots",
            "slot_hints",
            "recommended_slots",
            "slots",
            "slot",
            "matched_slot",
        ):
            matched_slots.extend(_split_slot_values(row.get(key)))
        matched_slots.extend(_pose_slot_hints(row.get("pose")))
        matched_slots = list(dict.fromkeys(matched_slots))
        facts.append(
            CandidateFacts(
                candidate_id=candidate_id,
                filename=filename or candidate_ids[candidate_id],
                asset_type=_lower(row.get("asset_type") or row.get("type")),
                shoe_count=_lower(row.get("shoe_count") or row.get("count")),
                pose=_lower(row.get("pose")),
                background=_lower(row.get("background")),
                complete=_truthy(row.get("complete") or row.get("is_complete")),
                side=_lower(row.get("side")),
                outsole_visible=_truthy(row.get("outsole_visible") or row.get("sole_visible")),
                feature_card=_truthy(row.get("feature_card") or row.get("has_feature_card")),
                confidence=_confidence(row.get("confidence")),
                matched_slots=tuple(matched_slots),
            )
        )
    return facts


def _slot_aliases(slot: str) -> set[str]:
    aliases = {slot}
    if slot == "tmz2":
        aliases.update({"wpz2", "yq1"})
    elif slot.startswith("tmz"):
        aliases.add(f"wpz{slot[-1]}")
    elif slot == "yq1":
        aliases.update({"tmz2", "wpz2"})
    return aliases


def _candidate_score(fact: CandidateFacts, slot: str) -> float:
    hints = set(fact.matched_slots)
    if hints & _slot_aliases(slot):
        return 0.82 + 0.15 * (fact.confidence or 0.85)

    text = " ".join(
        [
            fact.asset_type,
            fact.shoe_count,
            fact.pose,
            fact.background,
            fact.side,
        ]
    )
    score = 0.0
    if slot == "tmz1":
        if fact.complete and any(value in text for value in ("pair", "double", "two", "双", "两")):
            score = 0.58
    elif slot == "tmz2":
        if fact.complete and fact.outsole_visible and any(value in text for value in ("pair", "double", "two", "双", "两")):
            score = 0.68
    elif slot == "tmz3":
        if fact.complete and "single" in text and any(value in text for value in ("vertical", "standing", "outer", "side")):
            score = 0.58
    elif slot == "tmz4":
        if fact.complete and any(value in text for value in ("back", "rear", "opening", "inner", "heel")):
            score = 0.58
    elif slot == "tmz5":
        if fact.complete and "single" in text and any(value in fact.background for value in ("white", "gray", "grey", "白", "灰")):
            score = 0.60
    elif slot == "wpz5":
        if fact.complete and "single" in text and any(value in fact.background for value in ("gray", "grey", "灰")):
            score = 0.62
    elif slot == "wpz6":
        if any(value in text for value in ("box", "label", "shoe_box", "鞋盒", "标签")):
            score = 0.72
    elif slot == "yq2":
        if fact.outsole_visible or any(value in text for value in ("outsole", "sole", "鞋底")):
            score = 0.68
    elif slot == "yq3":
        if fact.complete and any(value in text for value in ("outer", "side", "profile", "外侧", "侧面")):
            score = 0.62
    elif slot == "yx":
        if fact.feature_card or any(value in text for value in ("feature", "card", "tag", "hangtag", "吊牌", "功能卡")):
            score = 0.72
    if score:
        score += min(fact.confidence, 1.0) * 0.08
    return min(score, 0.79)


def _candidate_order(candidate_id: str) -> int:
    match = re.search(r"(\d+)", candidate_id)
    return int(match.group(1)) if match else 99999


def _choose_slot(
    facts: list[CandidateFacts],
    slot: str,
    *,
    used_filenames: set[str],
) -> SlotDecision:
    scored = [
        (_candidate_score(fact, slot), fact)
        for fact in facts
        if fact.filename not in used_filenames
    ]
    scored = [item for item in scored if item[0] > 0.0]
    if not scored:
        return SlotDecision(slot=slot, reason="no candidate matched hard facts")
    scored.sort(
        key=lambda item: (
            -item[0],
            -item[1].confidence,
            _candidate_order(item[1].candidate_id),
            item[1].filename.lower(),
        )
    )
    best_score, best_fact = scored[0]
    second_score = scored[1][0] if len(scored) > 1 else 0.0
    gap = best_score - second_score
    if best_score >= LOCK_SCORE_THRESHOLD and (not second_score or gap >= LOCK_SCORE_GAP):
        return SlotDecision(
            slot=slot,
            candidate_id=best_fact.candidate_id,
            filename=best_fact.filename,
            score=round(best_score, 4),
            second_score=round(second_score, 4),
            status="locked",
            reason=RULESET_VERSION,
        )
    return SlotDecision(
        slot=slot,
        candidate_id=best_fact.candidate_id,
        filename=best_fact.filename,
        score=round(best_score, 4),
        second_score=round(second_score, 4),
        status="empty_low_confidence",
        reason=f"score/gap below lock threshold: {RULESET_VERSION}",
    )


def slot_payload_from_candidate_facts(
    payload: dict[str, Any],
    candidate_ids: dict[str, str],
    *,
    shoe_category: str = "",
) -> dict[str, Any]:
    facts = parse_candidate_facts(payload, candidate_ids)
    used: set[str] = set()
    decisions: list[SlotDecision] = []
    selected: dict[str, str] = {}

    for slot in ("tmz1", "tmz2", "tmz3", "tmz4", "tmz5"):
        decision = _choose_slot(facts, slot, used_filenames=used)
        decisions.append(decision)
        if decision.status == "locked":
            selected[slot] = decision.candidate_id
            used.add(decision.filename)

    yq1 = selected.get("tmz2", "")
    for slot in ("yq2", "yq3", "wpz5", "wpz6", "yx"):
        decision = _choose_slot(facts, slot, used_filenames=used)
        decisions.append(decision)
        if decision.status == "locked":
            selected[slot] = decision.candidate_id
            if slot != "yx":
                used.add(decision.filename)

    slots: dict[str, Any] = {
        "tmz1": selected.get("tmz1", ""),
        "tmz2": selected.get("tmz2", ""),
        "tmz3": selected.get("tmz3", ""),
        "tmz4": selected.get("tmz4", ""),
        "tmz5": selected.get("tmz5", ""),
        "o": "",
        "wpz": [
            selected.get("tmz1", ""),
            selected.get("tmz2", ""),
            selected.get("tmz3", ""),
            selected.get("tmz4", ""),
            selected.get("wpz5", ""),
            selected.get("wpz6", ""),
        ],
        "yq": [
            yq1,
            selected.get("yq2", ""),
            selected.get("yq3", ""),
        ],
        "yk": [],
        "yx": selected.get("yx", ""),
    }
    return {
        "color_name": _text(payload.get("color_name")),
        "shoe_category": _text(payload.get("shoe_category")) or _text(shoe_category),
        "slots": slots,
        "_candidate_facts": [asdict(fact) for fact in facts],
        "_slot_decisions": [asdict(decision) for decision in decisions],
        "_ruleset": RULESET_VERSION,
    }
