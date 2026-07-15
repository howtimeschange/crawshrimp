# Network Intelligence

## Default: Inspect Requests

For every task, inspect or infer the page-owned request/API path before falling back to manual DOM actions. The goal is to solve through the application surface the page already uses, then verify through API/application readback and visible UI.

Good candidates:

- reads, searches, filters, pagination, and table extraction backed by JSON payloads
- export buttons that call an API before downloading
- detail drawers backed by JSON payloads
- false empty or false busy states
- pagination where the UI hides total count
- file URLs that can be downloaded more safely than clicked
- creates, updates, saves, or publishes after the user has authorized the exact external effect and the payload/business rules are understood

## When To Fall Back To DOM

Use DOM or visible UI actions when:

- user-visible page state is the source of truth
- the task is explicitly about a visible interaction, editor behavior, or active account context
- the request contains sensitive or unstable auth payloads
- replaying the request would bypass business UI checks
- the page-owned API path cannot be understood, cannot be safely authorized, or cannot be verified

## Capture Rules

Redact tokens, cookies, signatures, passwords, and session fields before writing request evidence into reusable notes.

Treat a captured endpoint as the primary candidate path, not a complete solution. It becomes an adapter strategy only after it supports recovery, pagination, auth reality, business rules, and verification.
