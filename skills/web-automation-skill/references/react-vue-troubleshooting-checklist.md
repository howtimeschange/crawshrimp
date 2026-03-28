# React / Vue Control Troubleshooting Checklist

Use this checklist when a page is driven by React or Vue and a control is flaky, re-renders, or looks clickable but does not actually change state.

## 1. General Rules

- Re-query the DOM after every important interaction.
- Read back the display value after every write.
- Do not trust container `innerText` if the popup renders in a portal.
- Separate “action executed” from “state changed”.
- Prefer page-level proof over abstract theory.

## 2. Date Picker Checklist

Check these first:

- Is the trigger an actual input, a styled div, or a component shell?
- Does the popup render inside the field or in `body`?
- Is there a component `onChange` / instance method you can call directly?
- Is the displayed value formatted differently from the internal value?
- Does confirm need a final button click after selecting date/time?

Recommended order:

1. Try component state / `onChange` injection.
2. Read back the visible trigger value.
3. If confirm is required, validate whether value changes before or after confirm.
4. Only use CDP clicks if no stable injection path exists.

Common traps:

- month arrows overshoot due to repeated clicks
- start picker and end picker use different delayed render timing
- selected date changes but time stays stale
- displayed value changes only after confirm

## 3. Select / Dropdown Checklist

Check these first:

- Does the popup live in a portal?
- Is the trigger text mixed with popup option text?
- Is there a component prop like `modelValue`, `value`, or `selectedKey`?
- Is there a bound handler such as `onChange`, `onSelect`, `onOptionClick`?

Recommended order:

1. Read the actual display node, not the whole select root.
2. Try state injection or component event.
3. If using click, re-open and re-query the option each time.
4. After selection, verify the trigger text changed.

Common traps:

- root `innerText` includes hidden or portal option text
- option click fires but trigger node gets replaced
- old option reference is stale after popup re-render
- default value remains even though the click looked successful

## 4. Radio / Checkbox Checklist

Check these first:

- Is the real state stored on hidden input or component wrapper?
- Does click need to happen on label instead of input?
- Does changing this control reveal dependent fields?

Recommended order:

1. Change the control.
2. Verify checked / active state.
3. Wait for dependent block to appear.
4. Only then fill dependent fields.

Common traps:

- wrapper shows selected style but hidden input did not change
- dependent block appears asynchronously
- setting `checked` directly does not trigger framework state

## 5. Text Input Checklist

Check these first:

- Is it a native input, masked input, or component-wrapped input?
- Does the page expect `input`, `change`, or blur to commit value?
- Is the visible formatted value different from the raw model value?

Recommended order:

1. Set value using the native setter when needed.
2. Fire the events the framework expects.
3. Read back the current visible value.
4. If formatting occurs, compare normalized values.

Common traps:

- typed value is visually present but not committed
- thousands separators or currency formatting cause false mismatches
- a rerender restores the old value

## 6. Dependent Block Checklist

Use when field B depends on field A.

Checklist:

- after changing A, did B appear?
- is B in the same container or newly rendered elsewhere?
- does B require an additional micro-delay or rerender cycle?
- are you still holding a stale reference from before A changed?

Rule:

- never fill B until B is visible and freshly queried

## 7. Portal / Popover Checklist

Checklist:

- does the popup render under `body`?
- do option nodes only exist while open?
- does the popup close and recreate on every interaction?
- is the readback target inside the popup instead of the trigger?

Rule:

- treat popup nodes as disposable; re-find them every time

## 8. Success / Failure Interpretation Checklist

Before declaring the page broken, classify the result:

- script failure
- business-rule rejection
- auth/session failure
- environment / network / anti-bot issue

Examples:

- duplicate date range: business failure
- redirected login: auth failure
- selector missing after rerender: script failure
- CDP connection reset by proxy: environment failure

## 9. When to Stop Clicking and Switch Strategy

Stop pure click-based attempts when:

- the control re-renders after every click
- old nodes go stale immediately
- timing is inconsistent across start/end pickers
- display text and internal state diverge
- repeated clicks “look right” but never produce stable readback

At that point, switch to:

- state injection
- component event calls
- page-level mini experiments
- DOM report update before further adapter edits
