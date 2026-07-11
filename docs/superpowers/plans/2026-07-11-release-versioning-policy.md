# Crawshrimp Release Versioning Policy Implementation Plan

> **For agentic workers:** Execute this small documentation plan inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the repository's three-level release-versioning rule mandatory and discoverable before a desktop release is published.

**Architecture:** `docs/release-versioning.md` is the canonical rule. `README.md` points release operators to it, and `docs/desktop-update-release-checklist.md` requires every release to record its classification and rationale.

**Tech Stack:** Markdown, GitHub Actions release documentation.

## Global Constraints

- Formal versions use `vMAJOR.MINOR.PATCH`; package metadata omits the `v` prefix.
- Script or adapter work increments `PATCH`; product-function work increments `MINOR`; architecture work increments `MAJOR`.
- Select the highest applicable scope and reset lower positions to zero.
- Do not change `v2.1.0`, package metadata, tags, CI, or remote state.

---

### Task 1: Publish the canonical policy

**Files:**
- Create: `docs/release-versioning.md`

**Interfaces:**
- Consumes: the approved version categories and the current canonical version/tag convention.
- Produces: the sole detailed policy referenced by release documentation.

- [x] **Step 1: Add the version-format and source-of-truth rule.**
- [x] **Step 2: Add the exact PATCH, MINOR, and MAJOR classification table and examples.**
- [x] **Step 3: Require the highest applicable scope and lower-position reset.**

### Task 2: Wire the policy into release entrypoints

**Files:**
- Modify: `README.md`
- Modify: `docs/desktop-update-release-checklist.md`

**Interfaces:**
- Consumes: `docs/release-versioning.md`.
- Produces: a discoverable policy link and mandatory pre-release evidence fields.

- [x] **Step 1: Link the README build-and-release section to the policy.**
- [x] **Step 2: Add release scope, rationale, and target-version fields to the checklist's Release Identity section.**

### Task 3: Validate and commit the documentation change

**Files:**
- Verify: `docs/release-versioning.md`, `README.md`, `docs/desktop-update-release-checklist.md`

- [x] **Step 1: Confirm each link target exists and each required scope/example appears in the canonical policy.**
- [x] **Step 2: Run `git diff --check` and inspect the scoped diff.**
- [ ] **Step 3: Commit only the policy, links, checklist, and this plan.**
