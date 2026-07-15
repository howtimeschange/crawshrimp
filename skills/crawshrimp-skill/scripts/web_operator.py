#!/usr/bin/env python3
"""High-level web operation protocol built on direct browser execution."""

from __future__ import annotations

import argparse
import json
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any

try:
    from scripts.browser_executor import (
        BrowserAction,
        BrowserResult,
        ChromeCDPBackend,
        find_new_download,
        normalize_crawshrimp_snapshot,
        snapshot_download_dir,
    )
    from scripts.web_agent_protocol import Action, Journal, Observation, PageState, Plan, TaskKind, Verification, draft_plan, validate_action
except ModuleNotFoundError:
    from browser_executor import BrowserAction, BrowserResult, ChromeCDPBackend, find_new_download, normalize_crawshrimp_snapshot, snapshot_download_dir
    from web_agent_protocol import Action, Journal, Observation, PageState, Plan, TaskKind, Verification, draft_plan, validate_action


DOM_SNAPSHOT_SCRIPT = r"""
(() => {
  const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim()
  const selectorOf = (el) => {
    if (!el || !el.tagName) return ''
    if (el.id) return `#${CSS.escape(el.id)}`
    const attrs = ['name', 'aria-label', 'placeholder', 'data-testid', 'data-test', 'title']
    for (const attr of attrs) {
      const value = el.getAttribute?.(attr)
      if (value) return `${el.tagName.toLowerCase()}[${attr}=${JSON.stringify(value)}]`
    }
    const parent = el.parentElement
    if (!parent) return el.tagName.toLowerCase()
    const siblings = [...parent.children].filter((item) => item.tagName === el.tagName)
    const index = siblings.indexOf(el) + 1
    return `${selectorOf(parent)} > ${el.tagName.toLowerCase()}${siblings.length > 1 ? `:nth-of-type(${index})` : ''}`
  }
  const visible = (el) => {
    const rect = el.getBoundingClientRect?.()
    const style = window.getComputedStyle?.(el)
    return !!rect && rect.width > 0 && rect.height > 0 && style?.visibility !== 'hidden' && style?.display !== 'none'
  }
  const controls = (selector, role, mapper = (el) => ({})) => [...document.querySelectorAll(selector)]
    .filter(visible)
    .slice(0, 80)
    .map((el) => ({
      role,
      name: textOf(el) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.value || selectorOf(el),
      selector: selectorOf(el),
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
      ...mapper(el)
    }))
  const tables = [...document.querySelectorAll('table')]
    .filter(visible)
    .slice(0, 20)
    .map((table) => ({
      caption: textOf(table.querySelector('caption')) || textOf(table.querySelector('thead')) || 'table',
      rows: table.querySelectorAll('tbody tr, tr').length,
      columns: [...table.querySelectorAll('th')].slice(0, 20).map(textOf).filter(Boolean)
    }))
  const activeRegions = [...document.querySelectorAll('[role=dialog],[aria-modal=true],[class*=modal i],[class*=drawer i],[class*=popover i],[class*=dropdown i]')]
    .filter(visible)
    .slice(0, 20)
    .map((el) => ({
      kind: el.getAttribute('role') || (String(el.className || '').toLowerCase().includes('drawer') ? 'drawer' : 'region'),
      selector: selectorOf(el),
      text: textOf(el).slice(0, 300)
    }))
  const accessibility = controls('button,[role=button],a[href],input,textarea,select,[role=tab],[role=menuitem],[role=checkbox],[role=radio]', 'control')
    .slice(0, 120)
  const dangerousPattern = /(delete|remove|publish|submit|send|pay|purchase|confirm|bulk|删除|发布|提交|发送|付款|支付|购买|确认|批量)/
  const blockingStates = [...document.querySelectorAll('button,[role=button],a,input[type=submit]')]
    .filter(visible)
    .map((el) => textOf(el) || el.value || el.getAttribute('aria-label') || '')
    .filter((text) => dangerousPattern.test(String(text).toLowerCase()))
    .slice(0, 20)
    .map((text) => ({ kind: 'dangerous-control', text }))
  const resourceEntries = performance.getEntriesByType ? performance.getEntriesByType('resource').slice(-80).map((entry) => ({
    url: entry.name,
    initiatorType: entry.initiatorType || '',
    duration: Math.round(entry.duration || 0)
  })) : []
  const framework = {
    vue3: !!(document.querySelector('#app')?.__vue_app__),
    vue2: !!(document.querySelector('#app')?.__vue__),
    react: !!window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || !!document.querySelector('[data-reactroot]'),
    nextjs: !!window.__NEXT_DATA__,
    nuxt: !!window.__NUXT__
  }
  const stores = []
  const app = document.querySelector('#app')
  const gp = app?.__vue_app__?.config?.globalProperties
  try {
    if (gp?.$pinia?._s) {
      gp.$pinia._s.forEach((store, id) => {
        const actions = []
        const stateKeys = []
        for (const key in store) {
          if (key.startsWith('$') || key.startsWith('_')) continue
          if (typeof store[key] === 'function') actions.push(key)
          else stateKeys.push(key)
        }
        stores.push({ type: 'pinia', id, actions: actions.slice(0, 12), stateKeys: stateKeys.slice(0, 12) })
      })
    }
    if (gp?.$store?._modules?.root?._children) {
      for (const [id, mod] of Object.entries(gp.$store._modules.root._children)) {
        stores.push({ type: 'vuex', id, actions: Object.keys(mod?._rawModule?.actions || {}).slice(0, 12), stateKeys: Object.keys(mod?.state || {}).slice(0, 12) })
      }
    }
  } catch (error) {}
  return {
    url: location.href,
    title: document.title,
    context: {
      origin: location.origin,
      path: location.pathname,
      host: location.host
    },
    headings: [...document.querySelectorAll('h1,h2,h3,[role=heading]')].filter(visible).slice(0, 30).map(textOf).filter(Boolean),
    texts: [...document.querySelectorAll('main,section,article,[role=main],body')].slice(0, 2).map(textOf).filter(Boolean),
    buttons: controls('button,[role=button],input[type=button],input[type=submit]', 'button'),
    inputs: controls('input:not([type=button]):not([type=submit]):not([type=hidden]),textarea', 'input', (el) => ({ value: el.value || '', placeholder: el.getAttribute('placeholder') || '' })),
    selects: controls('select,[role=combobox],[aria-haspopup=listbox]', 'select', (el) => ({ value: el.value || textOf(el) })),
    links: controls('a[href]', 'link', (el) => ({ href: el.href || '' })),
    active_regions: activeRegions,
    accessibility,
    blocking_states: blockingStates,
    resources: resourceEntries,
    framework,
    stores,
    tables
  }
})()
""".strip()


def _json_string(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def make_action_script(kind: str, *, selector: str = "", value: str | None = None, text: str = "", timeout_ms: int = 8000) -> str:
    payload = {
        "kind": kind,
        "selector": selector,
        "value": value,
        "text": text,
        "timeoutMs": timeout_ms,
    }
    return f"""
window.__webAgentAct = async function(payload) {{
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\\s+/g, ' ').trim()
  const byText = (text) => {{
    if (!text) return null
    const needle = String(text).trim()
    return [...document.querySelectorAll('button,a,[role=button],label,option,div,span')]
      .find((el) => textOf(el) === needle || textOf(el).includes(needle))
  }}
  const waitFor = async () => {{
    const deadline = Date.now() + Number(payload.timeoutMs || 8000)
    while (Date.now() <= deadline) {{
      const found = payload.selector ? document.querySelector(payload.selector) : byText(payload.text)
      if (found) return found
      await sleep(100)
    }}
    throw new Error(`target not found: ${{payload.selector || payload.text || payload.kind}}`)
  }}
  const setNativeValue = (el, nextValue) => {{
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    if (setter) setter.call(el, nextValue)
    else el.value = nextValue
    el.dispatchEvent(new Event('input', {{ bubbles: true }}))
    el.dispatchEvent(new Event('change', {{ bubbles: true }}))
  }}
  const target = payload.kind === 'wait' ? await waitFor() : await waitFor()
  if (payload.kind === 'click' || payload.kind === 'download' || payload.kind === 'paginate') {{
    target.click()
    return {{ ok: true, action: payload.kind, evidence: textOf(target) || target.href || payload.selector }}
  }}
  if (payload.kind === 'type') {{
    target.focus()
    setNativeValue(target, payload.value || '')
    return {{ ok: true, action: payload.kind, evidence: target.value || '' }}
  }}
  if (payload.kind === 'select') {{
    target.value = payload.value || ''
    target.dispatchEvent(new Event('input', {{ bubbles: true }}))
    target.dispatchEvent(new Event('change', {{ bubbles: true }}))
    return {{ ok: true, action: payload.kind, evidence: target.value || textOf(target) }}
  }}
  if (payload.kind === 'upload') {{
    return {{ ok: false, action: payload.kind, evidence: 'file upload requires host tool support; target located' }}
  }}
  if (payload.kind === 'wait') {{
    return {{ ok: true, action: payload.kind, evidence: textOf(target) || payload.selector }}
  }}
  throw new Error(`unsupported action: ${{payload.kind}}`)
}}
window.__webAgentAct({_json_string(payload)})
""".strip()


def make_verify_script(expression: str, evidence: str = "") -> str:
    return f"""
window.__webAgentVerify = async function() {{
  const value = await (async () => {{ return Boolean({expression}) }})()
  return {{ passed: Boolean(value), evidence: {_json_string(evidence)} || String(value) }}
}}
window.__webAgentVerify()
""".strip()


def _missing_upload_file(files: list[str] | None) -> str:
    for raw_path in files or []:
        if not Path(str(raw_path or "")).expanduser().is_file():
            return str(raw_path)
    return ""


def _task_kind(raw: Any) -> TaskKind:
    try:
        return TaskKind(str(raw))
    except Exception:
        return TaskKind.READ


def _page_state_from_dict(payload: dict[str, Any]) -> PageState:
    return PageState(
        url=str(payload.get("url") or ""),
        title=str(payload.get("title") or ""),
        visible_text=list(payload.get("visible_text") or []),
        controls=list(payload.get("controls") or []),
        tables=list(payload.get("tables") or []),
        downloads=list(payload.get("downloads") or []),
        network=list(payload.get("network") or []),
        blocking_states=list(payload.get("blocking_states") or []),
        context=dict(payload.get("context") or {}),
        active_regions=list(payload.get("active_regions") or []),
        accessibility=list(payload.get("accessibility") or []),
    )


def _plan_from_dict(payload: dict[str, Any] | None) -> Plan | None:
    if not isinstance(payload, dict):
        return None
    return Plan(
        goal=str(payload.get("goal") or ""),
        kind=_task_kind(payload.get("kind")),
        steps=list(payload.get("steps") or []),
        stop_conditions=list(payload.get("stop_conditions") or []),
    )


def journal_from_dict(payload: dict[str, Any]) -> Journal:
    journal = Journal(task=str(payload.get("task") or "web task"))
    plan = _plan_from_dict(payload.get("plan"))
    if plan is not None:
        journal.set_plan(plan)
    for item in payload.get("observations") or []:
        if isinstance(item, dict):
            page_payload = item.get("page") if isinstance(item.get("page"), dict) else {}
            journal.add_observation(Observation(summary=str(item.get("summary") or ""), page=_page_state_from_dict(page_payload)))
    for item in payload.get("actions") or []:
        if isinstance(item, dict):
            journal.add_action(
                Action(
                    kind=str(item.get("kind") or ""),
                    target=str(item.get("target") or ""),
                    value=item.get("value"),
                    risk=str(item.get("risk") or "safe"),
                    reason=str(item.get("reason") or ""),
                    metadata=dict(item.get("metadata") or {}),
                )
            )
    for item in payload.get("verifications") or []:
        if isinstance(item, dict):
            journal.add_verification(
                Verification(
                    passed=bool(item.get("passed")),
                    evidence=str(item.get("evidence") or ""),
                    next_step=str(item.get("next_step") or ""),
                    check=dict(item.get("check") or {}),
                )
            )
    for item in payload.get("failures") or []:
        if isinstance(item, dict):
            journal.add_failure(item)
    return journal


def load_journal(path: Path | str) -> Journal:
    return journal_from_dict(json.loads(Path(path).read_text(encoding="utf-8")))


class WebOperator:
    def __init__(self, *, backend: Any, task: str, journal: Journal | None = None, download_dir: Path | str | None = None) -> None:
        self.backend = backend
        self.download_dir = Path(download_dir).expanduser() if download_dir else Path.home() / "Downloads"
        self.task = journal.task if journal is not None else task
        self.journal = journal or Journal(task=task)
        if self.journal.plan is None:
            self.journal.set_plan(draft_plan(self.task))

    def observe(self, summary: str = "page observed") -> PageState:
        result = self.backend.execute(BrowserAction(kind="eval", script=DOM_SNAPSHOT_SCRIPT))
        if not result.ok:
            raise RuntimeError(result.error or "observe failed")
        value = result.data.get("value")
        if not isinstance(value, dict):
            value = result.data
        page = normalize_crawshrimp_snapshot({"dom": value})
        if self.download_dir.exists() and self.download_dir.is_dir():
            page.downloads.append({
                "kind": "directory",
                "path": str(self.download_dir),
                "file_count": len(snapshot_download_dir(self.download_dir)),
            })
        self.journal.add_observation(Observation(summary=summary, page=page))
        return page

    def act(
        self,
        kind: str,
        *,
        selector: str = "",
        text: str = "",
        value: str | None = None,
        reason: str = "",
        risk: str = "safe",
        timeout_ms: int = 8000,
        user_confirmed: bool = False,
        files: list[str] | None = None,
        clicks: list[dict[str, Any]] | None = None,
        wheels: list[dict[str, Any]] | None = None,
        expected_file: str = "",
        url: str = "",
    ) -> BrowserResult:
        target = selector or text or url
        backend_kind = {"upload-chooser": "upload_chooser", "capture-wheel": "capture_wheel"}.get(kind, kind)
        if backend_kind == "upload_chooser" and files:
            target = "file chooser"
            value = ",".join(files)
        if kind == "upload" and files:
            target = selector
            value = ",".join(files)
        if kind == "navigate":
            target = url or value or selector
            value = target
        metadata: dict[str, Any] = {}
        if kind == "upload":
            metadata = {"files": list(files or []), "timeout_ms": timeout_ms}
        elif backend_kind == "upload_chooser":
            metadata = {"clicks": list(clicks or []), "files": list(files or []), "timeout_ms": timeout_ms}
        elif backend_kind == "capture_wheel":
            parsed_matches = []
            if value:
                parsed = json.loads(value)
                if not isinstance(parsed, list):
                    raise ValueError("capture-wheel value must be a JSON array of matchers")
                parsed_matches = parsed
            metadata = {"wheels": list(wheels or []), "matchers": parsed_matches, "timeout_ms": timeout_ms}
        elif kind == "download":
            metadata = {"expected_file": expected_file, "timeout_ms": timeout_ms}
        elif kind == "navigate":
            metadata = {"url": str(value or url or selector), "timeout_ms": timeout_ms}
        protocol_action = Action(kind=kind, target=target, value=value, risk=risk, reason=reason, metadata=metadata)
        validate_action(protocol_action, user_confirmed=user_confirmed)

        if backend_kind in {"upload", "upload_chooser"}:
            missing_file = _missing_upload_file(files)
            if missing_file:
                result = BrowserResult(ok=False, action=backend_kind, error=f"upload file not found: {missing_file}")
                self.journal.add_action(protocol_action)
                self.journal.add_failure({"action": asdict(protocol_action), "evidence": result.error, "recovery": "provide an existing local file path"})
                self.journal.add_verification(Verification(passed=False, evidence=result.error))
                return result

        baseline: dict[str, dict[str, int]] = {}
        started_at_ns = time.time_ns()
        if kind == "download":
            baseline = snapshot_download_dir(self.download_dir)

        if backend_kind == "upload_chooser":
            result = self.backend.execute(
                BrowserAction(kind="upload_chooser", clicks=list(clicks or []), files=list(files or []), timeout_ms=timeout_ms, user_gesture=True)
            )
        elif backend_kind == "capture_wheel":
            matches = list(metadata.get("matchers") or [])
            result = self.backend.execute(
                BrowserAction(kind="capture", capture_mode="wheel", wheels=list(wheels or []), matches=matches, timeout_ms=timeout_ms)
            )
        elif kind == "upload":
            result = self.backend.execute(
                BrowserAction(kind="upload", selector=selector, files=list(files or []), timeout_ms=timeout_ms, user_gesture=True)
            )
        elif kind == "navigate":
            result = self.backend.execute(BrowserAction(kind="navigate", url=str(value or url or selector), timeout_ms=timeout_ms))
        else:
            script = make_action_script(kind, selector=selector, value=value, text=text, timeout_ms=timeout_ms)
            result = self.backend.execute(BrowserAction(kind="eval", script=script, timeout_ms=timeout_ms, user_gesture=True))

        self.journal.add_action(protocol_action)
        if not result.ok:
            failure = {"action": asdict(protocol_action), "evidence": result.error or "action failed", "recovery": "re-observe and replan"}
            self.journal.add_failure(failure)
            self.journal.add_verification(Verification(passed=False, evidence=result.error or "action failed"))
            return result

        if backend_kind in {"upload", "upload_chooser"}:
            files_text = ", ".join(Path(path).name for path in (files or []))
            self.journal.add_verification(
                Verification(
                    passed=True,
                    evidence=f"Uploaded {len(files or [])} file(s): {files_text}",
                    check={"kind": kind, "selector": selector, "files": list(files or [])},
                )
            )
        if kind == "download":
            deadline = time.monotonic() + max(timeout_ms, 1000) / 1000.0
            download: dict[str, Any] | None = None
            while time.monotonic() < deadline:
                download = find_new_download(
                    self.download_dir,
                    baseline,
                    expected_file=expected_file,
                    started_at_ns=started_at_ns,
                )
                if download:
                    break
                time.sleep(0.1)
            if download:
                merged = dict(result.data)
                merged["download"] = download
                result = BrowserResult(ok=True, action=result.action, data=merged)
                self.journal.add_verification(
                    Verification(
                        passed=True,
                        evidence=f"Downloaded file {download['filename']} ({download['bytes']} bytes) at {download['path']}",
                        check={"kind": "file-exists", "target": download["filename"], "path": download["path"]},
                    )
                )
            else:
                failure_text = f"No downloaded file detected in {self.download_dir}"
                self.journal.add_failure({"action": asdict(protocol_action), "evidence": failure_text, "recovery": "check download directory or use direct URL download"})
                self.journal.add_verification(Verification(passed=False, evidence=failure_text))
                result = BrowserResult(ok=False, action=result.action, data=result.data, error=failure_text)
        return result

    def verify(self, expression: str, evidence: str) -> Verification:
        result = self.backend.execute(BrowserAction(kind="eval", script=make_verify_script(expression, evidence)))
        value = result.data.get("value") if isinstance(result.data, dict) else {}
        if not isinstance(value, dict):
            value = {"passed": bool(value), "evidence": evidence}
        verification = Verification(
            passed=bool(value.get("passed")),
            evidence=str(value.get("evidence") or evidence),
        )
        self.journal.add_verification(verification)
        return verification

    def verify_check(self, kind: str, *, target: str = "", evidence: str = "", minimum: int | None = None) -> Verification:
        check_kind = kind.strip().lower()
        check = {"kind": check_kind, "target": target}
        if minimum is not None:
            check["minimum"] = minimum
        if check_kind == "file-exists":
            path = Path(target).expanduser()
            if not path.is_absolute():
                path = self.download_dir / target
            passed = path.is_file() and path.stat().st_size > 0
            detail = evidence or (f"File exists: {path}" if passed else f"File missing or empty: {path}")
            verification = Verification(passed=passed, evidence=detail, check={**check, "path": str(path)})
        elif check_kind == "text":
            escaped = json.dumps(target)
            verification = self.verify(f"document.body.innerText.includes({escaped})", evidence or f"Visible text contains {target}")
            verification = Verification(passed=verification.passed, evidence=verification.evidence, next_step=verification.next_step, check=check)
            self.journal.verifications[-1] = verification
            return verification
        elif check_kind == "url":
            escaped = json.dumps(target)
            verification = self.verify(f"location.href.includes({escaped})", evidence or f"URL contains {target}")
            verification = Verification(passed=verification.passed, evidence=verification.evidence, next_step=verification.next_step, check=check)
            self.journal.verifications[-1] = verification
            return verification
        elif check_kind == "selector-exists":
            escaped = json.dumps(target)
            verification = self.verify(f"!!document.querySelector({escaped})", evidence or f"Selector exists {target}")
            verification = Verification(passed=verification.passed, evidence=verification.evidence, next_step=verification.next_step, check=check)
            self.journal.verifications[-1] = verification
            return verification
        elif check_kind == "table-rows-min":
            min_rows = int(minimum or 1)
            verification = self.verify(
                f"[...document.querySelectorAll({json.dumps(target or 'table')})].some((table) => table.querySelectorAll('tbody tr, tr').length >= {min_rows})",
                evidence or f"Table has at least {min_rows} rows",
            )
            verification = Verification(passed=verification.passed, evidence=verification.evidence, next_step=verification.next_step, check=check)
            self.journal.verifications[-1] = verification
            return verification
        else:
            raise ValueError(f"Unsupported structured verify check: {kind}")

        self.journal.add_verification(verification)
        return verification

    def save_journal(self, path: Path) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(self.journal.to_json(), encoding="utf-8")
        return path


def build_snapshot(operator: WebOperator) -> dict[str, Any]:
    page = operator.observe(summary="snapshot captured")
    dom = asdict(page)
    return {
        "dom": dom,
        "framework": dict(page.context.get("framework") or {}),
        "stores": list(page.context.get("stores") or []),
        "network": list(page.network or []),
    }


def distill_workflow(journal_payload: dict[str, Any]) -> str:
    task = str(journal_payload.get("task") or "")
    plan = journal_payload.get("plan") or {}
    observations = journal_payload.get("observations") or []
    actions = journal_payload.get("actions") or []
    verifications = journal_payload.get("verifications") or []
    failures = journal_payload.get("failures") or []
    first_page = ((observations[0] or {}).get("page") or {}) if observations else {}
    controls = [item for item in first_page.get("controls") or [] if isinstance(item, dict)]
    network = [item for item in first_page.get("network") or [] if isinstance(item, dict)]
    lines = [
        "## Workflow Draft",
        "",
        f"Task: {task}",
        f"Kind: {plan.get('kind') or ''}",
        "",
        "### Steps",
    ]
    for index, action in enumerate(actions, start=1):
        reason = str(action.get("reason") or "").strip()
        target = str(action.get("target") or "").strip()
        lines.append(f"{index}. {action.get('kind')} {target}".strip())
        if reason:
            lines.append(f"   Reason: {reason}")
    lines.extend(["", "### Verification Evidence"])
    for item in verifications:
        lines.append(f"- [{'pass' if item.get('passed') else 'fail'}] {item.get('evidence') or ''}")
    lines.extend(["", "### Selector Confidence"])
    for action in actions:
        target = str(action.get("target") or "").strip()
        if not target:
            continue
        confidence = "high" if target.startswith("#") or "data-testid" in target or "[name=" in target else "medium"
        lines.append(f"- `{target}`: {confidence}; used by `{action.get('kind')}`")
    if not any(str(action.get("target") or "").strip() for action in actions):
        lines.append("- No stable selectors captured yet.")
    lines.extend(["", "### Field Mapping Hints"])
    for control in controls[:20]:
        selector = str(control.get("selector") or "").strip()
        name = str(control.get("name") or control.get("placeholder") or "").strip()
        role = str(control.get("role") or "").strip()
        if selector or name:
            lines.append(f"- {role or 'control'} `{selector or name}` -> {name or selector}")
    if not controls:
        lines.append("- No controls captured in the first observation.")
    lines.extend(["", "### Request Clues"])
    for item in network[:20]:
        url = str(item.get("url") or item.get("responseUrl") or "").strip()
        method = str(item.get("method") or "").strip()
        if url:
            lines.append(f"- {method or 'GET'} {url}")
    if not network:
        lines.append("- No network clues captured in the journal.")
    lines.extend(["", "### Failure Branches"])
    for failure in failures:
        evidence = str(failure.get("evidence") or "").strip()
        recovery = str(failure.get("recovery") or "").strip()
        lines.append(f"- {evidence or 'failure recorded'}; recovery: {recovery or 're-observe and replan'}")
    if not failures:
        lines.append("- No failure branches recorded.")
    lines.extend([
        "",
        "### Crawshrimp Adapter Draft",
        "- Phase shape: observe context, execute one safe transition, read back state, then continue.",
        "- Suggested runtime actions: selector actions for DOM state; capture requests or URL downloads when DOM evidence is weaker.",
        "- Shared state candidates: current URL, selected filters, downloaded artifacts, and captured request clues.",
        "",
        "### Adapter Draft Notes",
        "- Convert stable selectors and readback checks into reusable helper functions.",
        "- Keep dangerous submit/publish/delete/send actions behind explicit confirmation.",
        "- Re-observe after navigation, dialog, filter, or table refresh transitions.",
    ])
    return "\n".join(lines).rstrip() + "\n"


def _read_journal(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _build_backend(args: argparse.Namespace) -> ChromeCDPBackend:
    return ChromeCDPBackend(cdp_url=args.cdp_url, tab_id=args.tab_id, url_prefix=args.url_prefix)


def _operator(args: argparse.Namespace) -> WebOperator:
    journal = None
    if getattr(args, "journal", ""):
        journal_path = Path(args.journal)
        if journal_path.exists():
            journal = load_journal(journal_path)
    return WebOperator(
        backend=_build_backend(args),
        task=args.task,
        journal=journal,
        download_dir=getattr(args, "download_dir", "") or None,
    )


def _print_json(payload: Any) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def _cmd_observe(args: argparse.Namespace) -> int:
    operator = _operator(args)
    page = operator.observe()
    if args.journal:
        operator.save_journal(Path(args.journal))
    _print_json(asdict(page))
    return 0


def _cmd_snapshot(args: argparse.Namespace) -> int:
    operator = _operator(args)
    snapshot = build_snapshot(operator)
    if args.journal:
        operator.save_journal(Path(args.journal))
    _print_json(snapshot)
    return 0


def _cmd_act(args: argparse.Namespace) -> int:
    operator = _operator(args)
    files = list(args.file or [])
    if args.files_json:
        parsed_files = json.loads(args.files_json)
        if not isinstance(parsed_files, list):
            raise ValueError("--files-json must be a JSON array")
        files.extend(str(item) for item in parsed_files)
    clicks = []
    if args.clicks_json:
        clicks = json.loads(args.clicks_json)
        if not isinstance(clicks, list):
            raise ValueError("--clicks-json must be a JSON array")
    elif args.x is not None and args.y is not None:
        clicks = [{"x": args.x, "y": args.y}]
    wheels = []
    if args.wheels_json:
        wheels = json.loads(args.wheels_json)
        if not isinstance(wheels, list):
            raise ValueError("--wheels-json must be a JSON array")
    elif args.x is not None and args.y is not None and args.kind == "capture-wheel":
        wheels = [{"x": args.x, "y": args.y, "delta_y": args.delta_y}]
    result = operator.act(
        args.kind,
        selector=args.selector,
        text=args.text,
        value=args.value,
        reason=args.reason,
        risk=args.risk,
        timeout_ms=args.timeout_ms,
        user_confirmed=args.user_confirmed,
        files=files,
        clicks=clicks,
        wheels=wheels,
        expected_file=args.expected_file,
        url=args.url,
    )
    if args.journal:
        operator.save_journal(Path(args.journal))
    print(result.to_json())
    return 0 if result.ok else 1


def _cmd_verify(args: argparse.Namespace) -> int:
    operator = _operator(args)
    if args.check:
        verification = operator.verify_check(args.check, target=args.target, evidence=args.evidence, minimum=args.minimum)
    else:
        verification = operator.verify(args.expression, args.evidence)
    if args.journal:
        operator.save_journal(Path(args.journal))
    _print_json(asdict(verification))
    return 0 if verification.passed else 1


def _cmd_journal(args: argparse.Namespace) -> int:
    operator = _operator(args)
    path = operator.save_journal(Path(args.output))
    _print_json({"journal": str(path)})
    return 0


def _cmd_distill(args: argparse.Namespace) -> int:
    payload = _read_journal(Path(args.journal))
    if args.output_dir:
        try:
            from scripts.workflow_builder import build_reusable_workflow
        except ModuleNotFoundError:
            from workflow_builder import build_reusable_workflow

        result = build_reusable_workflow(
            journal_path=Path(args.journal),
            output_dir=Path(args.output_dir),
            name=args.name,
            include_skill=args.include_skill,
        )
        _print_json(result)
        return 0
    output = distill_workflow(payload)
    if args.output:
        Path(args.output).write_text(output, encoding="utf-8")
        _print_json({"workflow": args.output})
    else:
        print(output)
    return 0


def _add_browser_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--cdp-url", default="http://127.0.0.1:9222")
    parser.add_argument("--tab-id", default="")
    parser.add_argument("--url-prefix", default="")
    parser.add_argument("--task", default="web task")
    parser.add_argument("--journal", default="")
    parser.add_argument("--download-dir", default="")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="High-level AI web operator over direct Chrome/CDP.")
    sub = parser.add_subparsers(dest="command", required=True)

    observe = sub.add_parser("observe", help="Get a normalized page model")
    _add_browser_args(observe)
    observe.set_defaults(func=_cmd_observe)

    snapshot = sub.add_parser("snapshot", help="Get DOM, framework, store, and network clues for probe planning")
    _add_browser_args(snapshot)
    snapshot.set_defaults(func=_cmd_snapshot)

    act = sub.add_parser("act", help="Run one safe browser action")
    _add_browser_args(act)
    act.add_argument("kind", choices=["click", "type", "select", "upload", "upload-chooser", "download", "wait", "navigate", "paginate", "capture-wheel"])
    act.add_argument("--selector", default="")
    act.add_argument("--text", default="")
    act.add_argument("--value", default=None)
    act.add_argument("--url", default="")
    act.add_argument("--file", action="append", default=[])
    act.add_argument("--files-json", default="")
    act.add_argument("--clicks-json", default="")
    act.add_argument("--wheels-json", default="")
    act.add_argument("--x", type=float, default=None)
    act.add_argument("--y", type=float, default=None)
    act.add_argument("--delta-y", type=float, default=600)
    act.add_argument("--expected-file", default="")
    act.add_argument("--reason", default="")
    act.add_argument("--risk", default="safe")
    act.add_argument("--timeout-ms", type=int, default=8000)
    act.add_argument("--user-confirmed", action="store_true")
    act.set_defaults(func=_cmd_act)

    verify = sub.add_parser("verify", help="Evaluate a verification expression")
    _add_browser_args(verify)
    verify.add_argument("--expression", default="")
    verify.add_argument("--evidence", required=True)
    verify.add_argument("--check", default="", choices=["", "text", "url", "selector-exists", "table-rows-min", "file-exists"])
    verify.add_argument("--target", default="")
    verify.add_argument("--minimum", type=int, default=None)
    verify.set_defaults(func=_cmd_verify)

    journal = sub.add_parser("journal", help="Create an empty journal")
    journal.add_argument("--task", default="web task")
    journal.add_argument("--output", default=f"web-agent-journal-{int(time.time())}.json")
    journal.set_defaults(func=_cmd_journal)

    distill = sub.add_parser("distill", help="Distill a journal into workflow notes")
    distill.add_argument("--journal", required=True)
    distill.add_argument("--output", default="")
    distill.add_argument("--output-dir", default="", help="create reusable workflow package directory")
    distill.add_argument("--name", default="", help="reusable workflow name")
    distill.add_argument("--include-skill", action="store_true", help="include a generated SKILL.md")
    distill.set_defaults(func=_cmd_distill)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
