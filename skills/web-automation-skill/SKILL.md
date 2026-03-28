---
name: web-automation-skill
description: Workflow for developing and debugging new web automation or adapter flows against live pages. Use when building automation for a new site, probing DOM with CDP, stabilizing flaky form interactions, or turning page-level experiments into reliable adapter code.
---

# Web Automation Skill

Use this skill for **operation-style web automation**, especially when the page is driven by React, Vue, portal popovers, or dynamic forms.

Typical triggers:

- “帮我开发一个新的网页自动化”
- “先探查一下 DOM 结构”
- “这个日期/下拉/弹窗总是失败”
- “先做页面级联调，再回写脚本”
- “把这个页面流程做成 adapter”

This skill is optimized for **new pages and flaky controls**, not just pure table scraping.

## Quick Start

1. Confirm the live page, account/store context, and exact business step under test.
2. Build a small DOM report before writing batch logic.
3. Run **single-control experiments** for stubborn controls such as date pickers, selects, radios, and dependent fields.
4. Choose the most stable interaction path using this priority:
   - state injection
   - component event
   - native DOM event
   - CDP click
5. Achieve a **page-level closed loop**:
   - fill
   - read back
   - submit
   - detect success or business failure
6. Only after the page-level loop is stable, write it back into the adapter.
7. Regress in stages:
   - single control
   - single page
   - single row
   - multi-row / multi-store

## Working Rules

- Prefer **business-level phases** over field-level phases.
- Re-query DOM nodes after re-render. Do not trust stale references.
- Read back the **display value** after every important interaction.
- Separate **script failure**, **auth/session failure**, **environment issue**, and **business-rule rejection**.
- Back up any proven injection path before large refactors.

## Use This Reference

For the full playbook and checklist, read:

- [references/dom-lab-playbook.md](references/dom-lab-playbook.md)
- [references/dom-report-template.md](references/dom-report-template.md)
- [references/react-vue-troubleshooting-checklist.md](references/react-vue-troubleshooting-checklist.md)

Load them when you need:

- the detailed DOM Lab workflow and regression ladder
- a standard DOM experiment report template
- a React / Vue control troubleshooting checklist
