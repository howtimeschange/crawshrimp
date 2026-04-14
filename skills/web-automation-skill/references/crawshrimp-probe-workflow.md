# Crawshrimp Probe Workflow

Use this note when the page is still mostly unknown and you need a fast, structured first-pass reconnaissance before deeper DOM Lab work.

## 1. What probe is for

`crawshrimp probe` is the standard reconnaissance step for live pages in this repo.

It should answer:

- what page state am I actually on
- which container is active
- whether this flow looks `dom_first`, `api_first`, or `mixed`
- which requests are worth following
- which selectors and signals are worth testing next

It should not replace single-control experiments.

## 2. Run probe before deeper DOM Lab when

- the page is new
- the current note is stale
- you do not yet know whether API-first is viable
- you need to map drawer / modal / portal states before coding

## 3. Safe probe rules

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

## 4. Probe outputs to expect

Probe should produce a bundle with at least:

- `page-map.json`
- `dom.json`
- `network.json`
- `endpoints.json`
- `framework.json`
- `strategy.json`
- `recommendations.json`
- `report.md`

Use those outputs as raw evidence, not as final conclusions.

## 5. How to use probe inside DOM Lab

1. Read `strategy.json` first.
2. If the result is `api_first` or `mixed`, inspect `endpoints.json` before spending more time on DOM control hacks.
3. If the result is `dom_first`, read `dom.json` and `page-map.json` first, then move into single-control experiments.
4. Use `report.md` only as a starter; replace weak claims with direct evidence from live experiments.

## 6. Handoff to adapter work

Once probe has identified:

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

## 7. Good probe outcome

A good probe run gives you enough structure to say one of these:

- “This page is mostly DOM-first; now I need a single-control date/select experiment.”
- “The list stays in DOM, but the detail payload can move to API-first.”
- “This export flow needs runtime request capture, not raw table scraping.”

If you still cannot say which of those three is true, the probe was too shallow.
