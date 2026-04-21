# Crawshrimp Dev Harness Recon Workflow

This filename is historical. In this repo, the standard reconnaissance entrypoint is `scripts/crawshrimp_dev_harness.py`.

Use this note when the page is still mostly unknown and you need a fast, structured first-pass reconnaissance before deeper DOM Lab work.

## 1. What the dev harness is for

`crawshrimp_dev_harness.py` is the standard reconnaissance step for live pages in this repo. `probe` is only one subcommand inside that entrypoint.

The harness should answer:

- what page state am I actually on
- which container is active
- whether this flow looks `dom_first`, `api_first`, or `mixed`
- what prior notes or probe findings already exist
- which requests are worth following
- which selectors and signals are worth testing next

It should not replace single-control experiments.

## 2. Recommended order

1. Run `snapshot` first for DOM structure and current-page context.
2. Read `knowledge` hits before inventing new notes or experiments.
3. Use `capture` or `eval` for single-control and request-path experiments.
4. Run `probe` only when you need a reusable bundle under `~/.crawshrimp/probes`.

## 3. Run the structured `probe` subcommand before deeper DOM Lab only when

- the page is new
- the current note is stale
- you do not yet know whether API-first is viable
- you need to map drawer / modal / portal states before coding

## 4. Safe probe rules

- Reuse the current logged-in Chrome tab whenever possible.
- Default to passive DOM + network capture first.
- Only trigger safe interactions:
  - tabs
  - capsules
  - filters
  - expand / detail
  - pagination
- Do not click create / submit / delete / confirm actions during probe.
- After each probe-triggered interaction, record both:
  - DOM transition evidence
  - network requests triggered by that interaction

## 5. Outputs to expect

The harness can produce three kinds of evidence:

- `snapshot`
  - current URL / title / headings
  - optional framework snapshot
  - matching knowledge cards
- `knowledge`
  - searchable cards materialized from `adapters/*/notes/*.md`
  - grouped skill docs under `~/.crawshrimp/knowledge/skills/<adapter>/<task>.md`
- `probe`
  - a reusable bundle with at least:
    - `page-map.json`
    - `dom.json`
    - `network.json`
    - `endpoints.json`
    - `framework.json`
    - `strategy.json`
    - `recommendations.json`
    - `report.md`

Use all of those outputs as raw evidence, not as final conclusions.

## 6. How to use the harness inside DOM Lab

1. Read `snapshot` and `knowledge` hits first.
2. If a probe bundle exists and the result is `api_first` or `mixed`, inspect `endpoints.json` before spending more time on DOM control hacks.
3. If the result is `dom_first`, read `dom.json` and `page-map.json` first, then move into single-control experiments.
4. Use `report.md` only as a starter; replace weak claims with direct evidence from live experiments.

## 7. Handoff to adapter work

Once the harness has identified:

- active containers
- transition signals
- candidate API surfaces
- recovery clues

hand the result to the crawshrimp adapter workflow so those clues become:

- phases
- `shared` carry
- restore logic
- runtime actions
- regression cases

## 8. Good outcome

A good harness run gives you enough structure to say one of these:

- “This page is mostly DOM-first; now I need a single-control date/select experiment.”
- “The list stays in DOM, but the detail payload can move to API-first.”
- “This export flow needs runtime request capture, not raw table scraping.”

If you still cannot say which of those three is true, the reconnaissance was too shallow.
