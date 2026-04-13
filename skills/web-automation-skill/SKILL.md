---
name: web-automation-skill
description: Workflow for developing and debugging new web automation or adapter flows against live pages. Use when building automation for a new site, probing DOM with CDP, deciding between DOM-first and API-first collection, stabilizing flaky form interactions, handling false busy or empty states, or turning page-level experiments into reliable adapter code.
---

# Web Automation Skill

Use this skill for **operation-style web automation**, especially when the page is driven by React, Vue, portal popovers, or dynamic forms.

Typical triggers:

- “帮我开发一个新的网页自动化”
- “先探查一下 DOM 结构”
- “这个日期/下拉/弹窗总是失败”
- “先做页面级联调，再回写脚本”
- “把这个页面流程做成 adapter”
- “这个导出/下载流程总是缺文件”
- “浏览器明明下载了，但运行时拿不到文件”

This skill is optimized for **new pages and flaky controls**, not just pure table scraping.

## Quick Start

1. Confirm the live page, account/store context, and exact business step under test.
2. Decide whether the flow should stay **DOM-first**, switch to **API-first**, or use a mixed strategy.
3. For list/detail, drawer, modal, or paginator flows, do a **full DOM sweep** of the critical states before writing batch loops.
4. Build a small DOM report before writing batch logic.
5. Run **single-control experiments** for stubborn controls such as date pickers, selects, radios, and dependent fields.
6. After every important interaction, **read back the resulting UI state** before advancing.
7. Choose the most stable interaction path using this priority:
   - state injection
   - component event
   - native DOM event
   - CDP click
8. For list or export flows, wait on **refresh evidence** such as row signature, active container, host, or real result change, not just a click or input echo.
9. Achieve a **page-level closed loop**:
   - fill
   - read back
   - submit
   - detect success or business failure
10. Only after the page-level loop is stable, write it back into the adapter.
11. Regress in stages:
   - single control
   - single page
   - single row
   - small batch
   - multi-row / multi-store
   - soak or rate-limit validation when pacing changed

## Working Rules

- Prefer **business-level phases** over field-level phases.
- Choose **DOM-first** by default, but move to **API-first** when the UI is lying or less reliable than the page's own request path.
- Do a full DOM sweep of the list page and any active drawer / modal / detail page before designing batch traversal.
- Re-query DOM nodes after re-render. Do not trust stale references.
- Read back the **display value** after every important interaction.
- Treat false busy, false empty, and stale warning banners as an **evidence problem** first, not an immediate no-data conclusion.
- Wait on **state transition evidence**: row signature, page signature, active container, host or URL scope, or visible result replacement.
- Treat refresh as a **last recovery step**. Retry the current target or reopen the current business context before reloading the page.
- Layer recovery: targeted re-query, current-context restore, then refresh-and-restore.
- Keep request pacing conservative and explicit when the flow is long-running or platform-throttled.
- Separate **script failure**, **auth/session failure**, **environment issue**, and **business-rule rejection**.
- Back up any proven injection path before large refactors.

## Use This Reference

For the full playbook and checklist, read:

- [references/dom-lab-playbook.md](references/dom-lab-playbook.md)
- [references/dom-report-template.md](references/dom-report-template.md)
- [references/dom-snippet-library.md](references/dom-snippet-library.md)
- [references/react-vue-troubleshooting-checklist.md](references/react-vue-troubleshooting-checklist.md)
- [references/live-page-probing-notes.md](references/live-page-probing-notes.md)
- [references/batch-flow-hardening.md](references/batch-flow-hardening.md)
- [references/api-first-fallback-playbook.md](references/api-first-fallback-playbook.md)
- [references/rate-limit-and-soak-playbook.md](references/rate-limit-and-soak-playbook.md)
- [references/download-export-stability-playbook.md](references/download-export-stability-playbook.md)

Load them when you need:

- the detailed DOM Lab workflow and regression ladder
- a standard DOM experiment report template
- a reusable snippet library for probing DOM, reading values, and running mini experiments
- a React / Vue control troubleshooting checklist
- live-page state mapping, container scoping, retry / recovery, and failure classification notes
- batch-flow patterns for list/detail pages, readback-first execution, layered recovery, and high-volume regression
- API-first fallback rules for false busy/empty pages, page-owned request clients, and mixed DOM/API collection
- conservative pacing, bounded backoff, and soak-test patterns for throttled pages
- export/download stabilization rules for task-history pages, multi-file exports, transient tabs, and runtime artifact verification
