# Verification And Journal

## Evidence Before Completion

A web task is complete only when evidence proves the requested result.

Good evidence:

- extracted rows with source table or visible text context
- final URL/title and visible success state
- selected filters and result count
- downloaded file path, size, and if possible content sanity check
- completed workflow transition log

Weak evidence:

- "I clicked the button"
- "It should have downloaded"
- "No error appeared"
- "The script finished"

## Journal Shape

Use an append-only journal:

```json
{
  "task": "download filtered orders",
  "observations": [],
  "plan": {},
  "actions": [],
  "verifications": [],
  "failures": []
}
```

Record:

- what was seen
- why the next step was chosen
- what action was taken
- what evidence changed
- where the workflow stopped or finished
- failed branches and the recovery chosen before retrying

## Final Response Pattern

For read tasks, report the extracted data and the evidence source.

For operate tasks, report the final page state or downloaded artifact.

For flow tasks, report the completed path, checkpoints, failures recovered, and reusable workflow notes.

If stopped for safety, report the exact blocked action and why confirmation is required.
