# Crawshrimp Skill Landing Plan

## 1. Product Goal

Build a reusable AI-agent web operation protocol inspired by crawshrimp's browser automation experience, but not limited to writing fixed crawshrimp adapter scripts.

The project has two explicit goals:

1. Reuse crawshrimp's web automation style so an AI agent can control a CDP browser, explore pages, execute safe actions, and complete live web tasks.
2. Freeze successful automation routes into reusable assets: a skill, script, CLI command, workflow notes, or future crawshrimp adapter draft.

## 2. V1 Scope

Support three task families:

1. Read tasks: scrape tables, search information, export page data, summarize page content.
2. Operate tasks: filter, paginate, open details, download files, and fill forms without submitting dangerous actions.
3. Flow tasks: complete multi-page, multi-dialog, or multi-step web workflows with evidence and reusable notes.

V1 is not a full browser automation runtime. It defines the agent protocol and a minimal executable framework that other browser tools can use.

## 3. Design Principles

- Observe before acting.
- Prefer small reversible actions.
- Require readback after every meaningful action.
- Treat success as evidence, not intent.
- Stop before dangerous external side effects.
- Journal the task so failures and successful paths can be reused.
- Distill proven workflows into scripts only after the free-form path is understood.

## 4. Repository Shape

```text
crawshrimp-skill/
  SKILL.md
  PLAN.md
  agents/openai.yaml
  references/
    protocol.md
    page-observation.md
    task-planning.md
    action-primitives.md
    network-intelligence.md
    browser-execution.md
    verification.md
    safety.md
    workflow-distillation.md
    verification-and-journal.md
    workflow-reuse.md
  scripts/
    __init__.py
    adapter_registry.py
    browser_executor.py
    knowledge_service.py
    phase_runner.py
    probe_bundle.py
    runtime_downloads.py
    web_operator.py
    workflow_builder.py
    web_agent_protocol.py
  tests/
    test_browser_executor.py
    test_web_operator.py
    test_workflow_builder.py
    test_web_agent_protocol.py
```

## 5. Protocol Model

The protocol uses these core objects:

- `PageState`: URL, title, visible text, controls, tables, downloads, and network clues.
- `Observation`: a summary plus the page state that supports it.
- `Plan`: user goal, task family, steps, and stop conditions.
- `Action`: one browser action with target, value, risk, and reason.
- `Verification`: pass/fail plus evidence and the next step.
- `Journal`: append-only evidence chain for the whole task.

## 6. Execution Loop

1. Classify the task.
2. Observe the page.
3. Build or update the page model.
4. Draft a small-step plan.
5. Validate action risk.
6. Execute one action through the available browser tool.
7. Re-observe and verify.
8. Continue, replan, or stop.
9. Produce final evidence and reusable workflow notes.

## 7. Safety Model

Actions are grouped as:

- `safe`: read, click harmless UI, open detail, filter, paginate, download, fill local form fields.
- `caution`: upload, long-running batch action, cross-account navigation, ambiguous confirmation dialogs.
- `dangerous`: submit, publish, send, delete, pay, purchase, confirm, bulk modify, or any irreversible external side effect.

The protocol must block dangerous actions unless the user explicitly confirms the specific target and consequence.

## 8. V1 Deliverables

- A valid Codex skill with short trigger metadata and progressive references.
- A Python protocol module with task classification, action safety validation, plan templates, and journal serialization.
- A direct Chrome/CDP browser execution layer:
  - low-level tab observation, JavaScript evaluation, coordinate click, navigation, and request capture
  - adapter/task registry and manifest-safe script resolution
  - adapter auth-check execution through the same CDP eval channel
  - knowledge-card rebuild/search from adapter notes and probe bundles
  - probe bundle materialization with DOM, framework, network, endpoint, strategy, recommendations, and redacted evidence
  - crawshrimp-style JSRunner phase/shared runtime for multi-stage workflows
  - runtime actions for CDP clicks, file input injection, file chooser upload, click/url/wheel request capture, URL downloads, browser-session URL downloads, click downloads, reload, and abort
  - request-capture compatibility for `matches`, `min_matches`, `settle_ms`, and `include_response_body`
  - high-level `observe / act / verify / journal / distill` commands for agents
  - DOM snapshot and action scripts inspired by crawshrimp dev harness but implemented inside this skill
  - file upload through CDP file-input primitives and download verification through artifact readback
  - concurrent URL download artifacts with retries, progress snapshots, data URL support, existing-file skip, and temporary-tab browser-session downloads
  - click download artifact detection with transient-tab hooks for host-specific confirmation flows
- A workflow reuse builder:
  - reads a successful journal
  - emits `workflow.md`, `commands.json`, `run_workflow.py`, and optional `SKILL.md`
  - lets the next agent rerun or install the proven route instead of rediscovering it
- Unit tests covering task classification, dangerous action blocking, and evidence journal structure.
- Unit tests covering cross-command journal append, structured verification, upload, download artifacts, enriched observation, and workflow distillation.
- A landing plan that defines the path toward a general AI-agent webpage operation system.

## 9. V2 Roadmap

1. Add browser adapters for multiple host environments:
   - Codex in-app browser
   - Chrome plugin / CDP
   - Playwright-like runtimes
2. Add observation normalizers:
   - accessibility tree to `PageState`
   - DOM snapshot to `PageState`
   - network capture to stable request clues
   - download directory to artifact evidence
3. Add workflow distillation:
   - convert journal to reusable checklist
   - convert journal to crawshrimp adapter notes
   - propose script skeleton only when repeated execution is likely
4. Add safety prompts:
   - dangerous action confirmation template
   - account/store/context confirmation
   - batch-size and rate-limit confirmation
5. Add scenario tests:
   - read a static table
   - filter and download a CSV
   - traverse a detail dialog
   - stop before a dangerous submit

## 10. Acceptance Criteria

V1 is acceptable when:

- `quick_validate.py` accepts the skill folder.
- Unit tests pass with `python3 -m unittest`.
- A future agent can read `SKILL.md`, classify the task, create a plan, explain safety boundaries, and produce a journal template without knowing crawshrimp internals.
- The protocol clearly separates free-form webpage operation from fixed adapter authoring.
