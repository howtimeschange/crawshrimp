# Web Agent Protocol

## Core Idea

The agent treats the webpage as an environment to understand and operate, not as a script target to hard-code immediately.

The loop is:

```text
observe -> model -> plan -> act -> verify -> journal -> replan or finish
```

## Task Families

| Family | Examples | Default posture |
| --- | --- | --- |
| `read` | scrape a table, search visible content, summarize a page, export visible data | read-only and cite evidence |
| `operate` | filter, paginate, open details, download, fill fields | one safe action plus readback at a time |
| `flow` | multi-page collection, multi-dialog traversal, repeated details, workflow discovery | build a state map and journal transitions |

## Protocol Objects

- `PageState`: current URL, title, visible text, controls, tables, downloads, network clues, and blocking states.
- `Observation`: a claim about the page plus the page state evidence.
- `Plan`: goal, task family, steps, and stop conditions.
- `Action`: action kind, target, value, risk, and reason.
- `Verification`: whether the expected state happened, with concrete evidence.
- `Journal`: append-only record of observations, plan, actions, and verifications.

## Required Stop Conditions

Stop and ask the user when:

- Login, permission, account, or store context is unclear.
- The next step is submit, publish, send, delete, pay, purchase, confirm, or bulk modify.
- The page state contradicts the plan.
- The task depends on data hidden behind unavailable auth.
- The requested action could affect real users, money, inventory, messages, listings, or production state.

## Completion Rule

The task is not complete when an action is attempted. It is complete only when verification evidence proves the user's requested outcome or when a stop condition is reached and reported clearly.
