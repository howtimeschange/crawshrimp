"""Backend probe orchestration."""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from core.browser_session import open_browser_session
from core.probe_analyzer import (
    analyze_endpoints,
    build_page_map,
    build_recommendations,
    infer_strategy,
    render_report,
)
from core.probe_models import ProbeBundleFullResponse, ProbeBundleResponse, ProbeRequest, ProbeRunResponse
from core.probe_profiles import load_probe_profile


DOM_SNAPSHOT_EXPR = r"""
(() => {
  /* crawshrimp-probe:dom-snapshot */
  try {
    const textOf = (el) => String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => !!(el && typeof el.getClientRects === 'function' && el.getClientRects().length > 0);
    const cssPath = (el) => {
      if (!el || !el.tagName) return '';
      const tag = String(el.tagName || '').toLowerCase();
      const id = String(el.id || '').trim();
      if (id) return `${tag}#${id}`;
      const testId = String(el.getAttribute?.('data-testid') || '').trim();
      if (testId) return `${tag}[data-testid="${testId}"]`;
      const className = String(el.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      return className ? `${tag}.${className}` : tag;
    };
    const collect = (selector, limit, mapFn) => {
      return [...document.querySelectorAll(selector)]
        .filter(visible)
        .slice(0, limit)
        .map((el) => mapFn(el))
        .filter(Boolean);
    };
    const headings = collect('h1, h2, [role="heading"]', 12, (el) => textOf(el)).filter(Boolean);
    const buttons = collect('button, [role="button"], a, [data-testid]', 30, (el) => {
      const text = textOf(el);
      if (!text && !el.getAttribute('data-testid')) return null;
      return {
        text,
        selector: cssPath(el),
        tag: String(el.tagName || '').toLowerCase(),
      };
    });
    const inputs = collect('input, textarea', 20, (el) => ({
      selector: cssPath(el),
      type: String(el.getAttribute('type') || 'text'),
      value: String(el.value || ''),
      placeholder: String(el.getAttribute('placeholder') || ''),
    }));
    const selects = collect('select, [role="combobox"]', 20, (el) => ({
      selector: cssPath(el),
      text: textOf(el),
      value: String(el.value || ''),
    }));
    const drawerRoots = collect(
      '[role="dialog"], [class*="Drawer"], [class*="drawer"], [data-testid*="drawer"]',
      8,
      (el) => cssPath(el)
    );
    const modalRoots = collect(
      '[class*="Modal"], [class*="modal"], [data-testid*="modal"], [aria-modal="true"]',
      8,
      (el) => cssPath(el)
    );
    const activeContainers = [...new Set([
      ...drawerRoots,
      ...modalRoots,
      ...collect('main, form, table, [class*="content"], [class*="panel"]', 12, (el) => cssPath(el)),
    ])].filter(Boolean).slice(0, 12);
    const bodySample = textOf(document.body).slice(0, 1000);
    const tableCount = document.querySelectorAll('table').length;
    return {
      success: true,
      data: [{
        url: String(location.href || ''),
        title: String(document.title || ''),
        headings,
        buttons,
        inputs,
        selects,
        drawer_roots: drawerRoots,
        modal_roots: modalRoots,
        active_containers: activeContainers,
        body_text_sample: bodySample,
        table_count: tableCount,
      }],
      meta: { has_more: false },
    };
  } catch (error) {
    return { success: false, error: String(error?.message || error) };
  }
})()
"""


FRAMEWORK_SNAPSHOT_EXPR = r"""
(() => {
  /* crawshrimp-probe:framework-snapshot */
  try {
    const result = { framework: {}, stores: [] };
    const app = document.querySelector('#app');
    const win = window;
    result.framework.vue3 = !!(app && app.__vue_app__);
    result.framework.vue2 = !!(app && app.__vue__);
    result.framework.react = !!win.__REACT_DEVTOOLS_GLOBAL_HOOK__ || !!document.querySelector('[data-reactroot]');
    result.framework.nextjs = !!win.__NEXT_DATA__;
    result.framework.nuxt = !!win.__NUXT__;
    if (result.framework.vue3 && app && app.__vue_app__) {
      const gp = app.__vue_app__.config?.globalProperties;
      result.framework.pinia = !!(gp && gp.$pinia);
      result.framework.vuex = !!(gp && gp.$store);
      if (gp?.$pinia?._s) {
        gp.$pinia._s.forEach((store, id) => {
          const actions = [];
          const stateKeys = [];
          for (const key in store) {
            if (key.startsWith('$') || key.startsWith('_')) continue;
            if (typeof store[key] === 'function') actions.push(key);
            else stateKeys.push(key);
          }
          result.stores.push({ type: 'pinia', id, actions: actions.slice(0, 12), stateKeys: stateKeys.slice(0, 12) });
        });
      }
      if (gp?.$store?._modules?.root?._children) {
        const children = gp.$store._modules.root._children;
        for (const [modName, mod] of Object.entries(children)) {
          result.stores.push({
            type: 'vuex',
            id: modName,
            actions: Object.keys(mod?._rawModule?.actions || {}).slice(0, 12),
            stateKeys: Object.keys(mod?.state || {}).slice(0, 12),
          });
        }
      }
    }
    return { success: true, data: [result], meta: { has_more: false } };
  } catch (error) {
    return { success: false, error: String(error?.message || error) };
  }
})()
"""


def _safe_target_expr(labels: list[str], selectors: list[str], limit: int) -> str:
    return (
        "(() => {\n"
        "  /* crawshrimp-probe:safe-targets */\n"
        "  try {\n"
        "    const visible = (el) => !!(el && typeof el.getClientRects === 'function' && el.getClientRects().length > 0);\n"
        "    const textOf = (el) => String(el?.innerText || el?.textContent || '').replace(/\\s+/g, ' ').trim();\n"
        "    const cssPath = (el) => {\n"
        "      const tag = String(el?.tagName || '').toLowerCase();\n"
        "      const testId = String(el?.getAttribute?.('data-testid') || '').trim();\n"
        "      if (testId) return `${tag}[data-testid=\"${testId}\"]`;\n"
        "      const className = String(el?.className || '').trim().split(/\\s+/).filter(Boolean).slice(0, 2).join('.');\n"
        "      return className ? `${tag}.${className}` : tag;\n"
        "    };\n"
        f"    const labels = {json.dumps(labels, ensure_ascii=False)};\n"
        f"    const selectors = {json.dumps(selectors, ensure_ascii=False)};\n"
        f"    const limit = {max(int(limit), 1)};\n"
        "    const seen = new Set();\n"
        "    const targets = [];\n"
        "    const push = (el, reason, matched) => {\n"
        "      if (!visible(el)) return;\n"
        "      const rect = el.getBoundingClientRect();\n"
        "      if (!rect.width || !rect.height) return;\n"
        "      const key = `${Math.round(rect.left)}:${Math.round(rect.top)}:${reason}:${matched || ''}`;\n"
        "      if (seen.has(key)) return;\n"
        "      seen.add(key);\n"
        "      targets.push({\n"
        "        text: textOf(el),\n"
        "        selector: cssPath(el),\n"
        "        reason,\n"
        "        matched: matched || '',\n"
        "        x: Math.round(rect.left + rect.width / 2),\n"
        "        y: Math.round(rect.top + rect.height / 2),\n"
        "      });\n"
        "    };\n"
        "    selectors.forEach((selector) => {\n"
        "      try {\n"
        "        document.querySelectorAll(selector).forEach((el) => push(el, 'selector', selector));\n"
        "      } catch (e) {}\n"
        "    });\n"
        "    labels.forEach((label) => {\n"
        "      [...document.querySelectorAll('button, [role=\"button\"], [role=\"tab\"], a, span, div')]\n"
        "        .filter(visible)\n"
        "        .filter((el) => textOf(el).includes(label))\n"
        "        .forEach((el) => push(el, 'label', label));\n"
        "    });\n"
        "    return { success: true, data: [{ targets: targets.slice(0, limit) }], meta: { has_more: false } };\n"
        "  } catch (error) {\n"
        "    return { success: false, error: String(error?.message || error) };\n"
        "  }\n"
        "})()\n"
    )


def _probe_root() -> Path:
    base = os.environ.get("CRAWSHRIMP_DATA", str(Path.home() / ".crawshrimp"))
    root = Path(base) / "probes"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _probe_id(mode: str) -> str:
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    return f"{timestamp}-{mode or 'probe'}"


def _bundle_dir(adapter_id: str, task_id: str, probe_id: str) -> Path:
    out_dir = _probe_root() / adapter_id / task_id / probe_id
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir


async def _evaluate_row(runner, expression: str) -> dict[str, Any]:
    result = await runner.evaluate_with_reconnect(expression, allow_navigation_retry=True)
    if not result.success:
        raise RuntimeError(result.error or "probe evaluate failed")
    if not result.data or not isinstance(result.data, list):
        return {}
    row = result.data[0] or {}
    return row if isinstance(row, dict) else {}


def _flatten_network_entries(passive_capture: dict, interaction_captures: list[dict]) -> list[dict]:
    entries: list[dict] = []
    for item in passive_capture.get("matches") or []:
        row = dict(item)
        row["capture_mode"] = "passive"
        entries.append(row)
    for capture in interaction_captures:
        trigger_label = str(capture.get("trigger_label") or capture.get("trigger_selector") or "")
        for item in capture.get("capture", {}).get("matches") or []:
            row = dict(item)
            row["capture_mode"] = "click"
            row["trigger"] = trigger_label
            entries.append(row)
    return entries


def _write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


async def run_probe_request(req: ProbeRequest) -> ProbeRunResponse:
    profile = load_probe_profile(req.adapter_id, req.task_id, str(req.profile or ""))
    merged_entry_url = str(req.entry_url or profile.get("entry_url") or "")
    merged_tab_prefixes = list(profile.get("tab_match_prefixes") or [])
    merged_labels = list(profile.get("safe_click_labels") or []) + list(req.safe_click_labels or [])
    merged_selectors = list(profile.get("safe_click_selectors") or []) + list(req.safe_click_selectors or [])
    merged_limit = int(req.safe_click_limit or profile.get("safe_click_limit") or 3)
    effective_safe_auto = bool(req.safe_auto) if req.safe_auto is not None else bool(merged_labels or merged_selectors)

    started_at = datetime.now(timezone.utc)
    session = await open_browser_session(
        req.adapter_id,
        req.task_id,
        mode=req.mode,
        current_tab_id=str(req.current_tab_id or ""),
        entry_url_override=merged_entry_url,
        tab_match_prefixes_override=merged_tab_prefixes,
    )
    runner = session.runner
    dom_snapshot = await _evaluate_row(runner, DOM_SNAPSHOT_EXPR)
    framework_snapshot = await _evaluate_row(runner, FRAMEWORK_SNAPSHOT_EXPR)

    passive_capture = await runner.capture_passive_requests(
        timeout_ms=max(int(req.network_timeout_ms), 1000),
        settle_ms=max(int(req.settle_ms), 0),
        include_response_body=bool(req.capture_response_body),
    )

    interaction_captures: list[dict[str, Any]] = []
    if effective_safe_auto and (merged_labels or merged_selectors):
        target_result = await _evaluate_row(
            runner,
            _safe_target_expr(merged_labels, merged_selectors, merged_limit),
        )
        for target in target_result.get("targets") or []:
            click_payload = {"x": float(target["x"]), "y": float(target["y"]), "delay_ms": 120}
            capture = await runner.capture_click_requests(
                [click_payload],
                timeout_ms=max(int(req.network_timeout_ms), 1000),
                settle_ms=max(int(req.settle_ms), 0),
                include_response_body=bool(req.capture_response_body),
            )
            after_dom = await _evaluate_row(runner, DOM_SNAPSHOT_EXPR)
            interaction_captures.append({
                "trigger_label": target.get("matched") if target.get("reason") == "label" else target.get("text"),
                "trigger_selector": target.get("selector"),
                "trigger_reason": target.get("reason"),
                "capture": capture,
                "after_dom": after_dom,
            })

    combined_entries = _flatten_network_entries(passive_capture, interaction_captures)
    endpoints = analyze_endpoints(combined_entries, framework_snapshot)
    page_map = build_page_map(dom_snapshot, interaction_captures)
    strategy = infer_strategy(dom_snapshot, endpoints, framework_snapshot)
    recommendations = build_recommendations(page_map, dom_snapshot, endpoints, strategy)

    probe_id = _probe_id(req.mode)
    bundle_dir = _bundle_dir(req.adapter_id, req.task_id, probe_id)
    final_url = str(dom_snapshot.get("url") or session.tab.get("url") or "")
    manifest = {
        "probe_id": probe_id,
        "adapter_id": req.adapter_id,
        "task_id": req.task_id,
        "goal": req.goal or "",
        "mode": session.mode,
        "target_url": session.target_entry_url,
        "final_url": final_url,
        "tab_id": str(session.tab.get("id") or ""),
        "profile": str(profile.get("_profile_name") or req.profile or ""),
        "started_at": started_at.isoformat(),
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "profile_applied": {
            "safe_auto": effective_safe_auto,
            "safe_click_labels": merged_labels,
            "safe_click_selectors": merged_selectors,
            "tab_match_prefixes": merged_tab_prefixes,
        },
    }

    report_md = render_report(
        adapter_id=req.adapter_id,
        task_id=req.task_id,
        goal=req.goal or "",
        manifest=manifest,
        dom_snapshot=dom_snapshot,
        framework_snapshot=framework_snapshot,
        endpoints=endpoints,
        strategy=strategy,
        recommendations=recommendations,
    )

    _write_json(bundle_dir / "manifest.json", manifest)
    _write_json(bundle_dir / "page-map.json", page_map)
    _write_json(bundle_dir / "dom.json", dom_snapshot)
    _write_json(bundle_dir / "framework.json", framework_snapshot)
    _write_json(
        bundle_dir / "network.json",
        {
            "passive_capture": passive_capture,
            "interaction_captures": interaction_captures,
            "captured_requests": combined_entries,
        },
    )
    _write_json(bundle_dir / "endpoints.json", endpoints)
    _write_json(bundle_dir / "strategy.json", strategy)
    _write_json(bundle_dir / "recommendations.json", recommendations)
    report_path = bundle_dir / "report.md"
    report_path.write_text(report_md, encoding="utf-8")

    summary = {
        "final_url": final_url,
        "page_strategy": strategy.get("page_strategy"),
        "auth_strategy": strategy.get("auth_strategy"),
        "endpoint_count": len(endpoints),
        "captured_request_count": len(combined_entries),
        "interaction_count": len(interaction_captures),
        "profile": str(profile.get("_profile_name") or req.profile or ""),
    }
    return ProbeRunResponse(
        ok=True,
        probe_id=probe_id,
        adapter_id=req.adapter_id,
        task_id=req.task_id,
        bundle_dir=str(bundle_dir),
        manifest_path=str(bundle_dir / "manifest.json"),
        report_path=str(report_path),
        summary=summary,
    )


def _probe_dir_by_id(probe_id: str) -> Path:
    root = _probe_root()
    matches = [path.parent for path in root.glob(f"**/{probe_id}/manifest.json")]
    if not matches:
        raise FileNotFoundError(f"Probe not found: {probe_id}")
    if len(matches) > 1:
        matches = sorted(matches)
    return matches[0]


def _read_json_if_exists(path: Path) -> Any:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def read_probe_bundle(probe_id: str) -> ProbeBundleResponse:
    bundle_dir = _probe_dir_by_id(probe_id)
    manifest = _read_json_if_exists(bundle_dir / "manifest.json") or {}
    strategy = _read_json_if_exists(bundle_dir / "strategy.json") or {}
    summary = {
        "final_url": manifest.get("final_url") or manifest.get("target_url") or "",
        "page_strategy": strategy.get("page_strategy"),
        "auth_strategy": strategy.get("auth_strategy"),
        "profile": manifest.get("profile") or "",
    }
    files = sorted(path.name for path in bundle_dir.iterdir() if path.is_file())
    return ProbeBundleResponse(
        ok=True,
        probe_id=probe_id,
        bundle_dir=str(bundle_dir),
        manifest=manifest,
        strategy=strategy,
        summary=summary,
        files=files,
    )


def read_probe_bundle_full(probe_id: str) -> ProbeBundleFullResponse:
    bundle_dir = _probe_dir_by_id(probe_id)
    bundle = {
        "manifest": _read_json_if_exists(bundle_dir / "manifest.json") or {},
        "page_map": _read_json_if_exists(bundle_dir / "page-map.json") or {},
        "dom": _read_json_if_exists(bundle_dir / "dom.json") or {},
        "framework": _read_json_if_exists(bundle_dir / "framework.json") or {},
        "network": _read_json_if_exists(bundle_dir / "network.json") or {},
        "endpoints": _read_json_if_exists(bundle_dir / "endpoints.json") or [],
        "strategy": _read_json_if_exists(bundle_dir / "strategy.json") or {},
        "recommendations": _read_json_if_exists(bundle_dir / "recommendations.json") or {},
        "report_markdown": (bundle_dir / "report.md").read_text(encoding="utf-8") if (bundle_dir / "report.md").exists() else "",
    }
    return ProbeBundleFullResponse(
        ok=True,
        probe_id=probe_id,
        bundle_dir=str(bundle_dir),
        bundle=bundle,
    )
