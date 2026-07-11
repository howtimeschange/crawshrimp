# Crawshrimp Release Versioning Policy Design

## Goal

Make the version-selection rule for future Crawshrimp desktop releases explicit, discoverable, and consistently applied before a version bump, tag, and release publication.

## Context

- `app/package.json` and `app/package-lock.json` are the canonical desktop-version files.
- Formal Git tags use the matching `vX.Y.Z` form; the desktop workflow already rejects a tag whose version differs from `app/package.json`.
- The current release checklist verifies updater evidence, but does not require an explicit reason for selecting a patch, feature, or architecture version change.
- `ship-github-cloudflare` is the appropriate execution skill for a version bump, release metadata, tags, CI, and GitHub Release readback. This policy is repository-specific guidance for that workflow, not an adapter rule or a new generic skill.

## Decision

Create a dedicated release-versioning policy document and surface it from the two existing release entrypoints: the README's build-and-release section and the desktop-update release checklist.

### Version format

Formal desktop releases use `vMAJOR.MINOR.PATCH`; `app/package.json` and `app/package-lock.json` store the same value without the `v` prefix.

| Change scope | Required increment | Example |
| --- | --- | --- |
| Script-level or adapter-level update | Increment `PATCH` | `v2.1.0` to `v2.1.1` |
| Product-function update, including a new first-level menu function | Increment `MINOR` and reset `PATCH` to zero | `v2.1.0` to `v2.2.0` |
| Overall architecture update, including the AI image generation, AI image testing, cloud approval, and desktop auto-update capability family | Increment `MAJOR` and reset `MINOR` and `PATCH` to zero | `v2.1.0` to `v3.0.0` |

When a release contains more than one scope, select the highest applicable increment. The policy deliberately does not add a separate compatibility or migration rule beyond these three user-defined classes.

## Documentation Shape

1. Add `docs/release-versioning.md` as the canonical policy, including the selection rule and exact examples.
2. Add one concise README link next to the canonical-version and tag-matching statement.
3. Add required release-identity fields to `docs/desktop-update-release-checklist.md`: change scope, selection rationale, and target version. The checklist links to the canonical policy instead of duplicating the full table.

## Out of Scope

- Do not change the already released `v2.1.0` tag or application version.
- Do not add a CI classifier for human product-scope judgment.
- Do not create or change an adapter skill.
- Do not publish, push, tag, or trigger a release as part of this documentation change.

## Validation

This is documentation-only work. Validate that all new links resolve to tracked files, the three release scopes and examples appear exactly once in the canonical policy, the checklist contains its required fields, and `git diff --check` reports no whitespace errors.
