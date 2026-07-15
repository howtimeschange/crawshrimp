# Workflow Distillation

## Purpose

Distillation turns a proven route into reusable assets only after the free-form webpage task succeeds with evidence.

The generated package can include:

- `workflow.md`: human route, evidence, failure branches, and adapter notes
- `commands.json`: machine-readable actions and verifications
- `run_workflow.py`: a replay wrapper around `scripts/web_operator.py`
- optional `SKILL.md`: a reusable skill draft

## Adapter Draft Fields

A crawshrimp adapter draft should preserve:

- phase boundaries from page states
- stable selectors and their confidence
- field mapping hints from observed controls
- request clues from capture or resource timing
- download artifacts and acceptance rules
- failure branches and recovery notes

Script generation is a sediment of a successful route, not the default goal.
