import assert from 'node:assert/strict'
import test from 'node:test'

import { focusFirstInDialog, trapDialogFocus } from './dialogAccessibility.mjs'

function focusable(name) {
  return {
    name,
    disabled: false,
    hidden: false,
    tabIndex: 0,
    focus() { globalThis.__focusedDialogElement = this },
    getAttribute() { return null },
  }
}

function containerWith(elements) {
  return {
    tabIndex: -1,
    querySelectorAll() { return elements },
    focus() { globalThis.__focusedDialogElement = this },
  }
}

test('dialog focus starts on the first enabled control', () => {
  const first = focusable('first')
  const second = focusable('second')
  focusFirstInDialog(containerWith([first, second]))
  assert.equal(globalThis.__focusedDialogElement, first)
})

test('dialog Tab focus wraps in both directions', () => {
  const first = focusable('first')
  const last = focusable('last')
  const container = containerWith([first, last])
  let prevented = 0

  trapDialogFocus({ key: 'Tab', shiftKey: false, target: last, preventDefault: () => { prevented += 1 } }, container)
  assert.equal(globalThis.__focusedDialogElement, first)
  trapDialogFocus({ key: 'Tab', shiftKey: true, target: first, preventDefault: () => { prevented += 1 } }, container)
  assert.equal(globalThis.__focusedDialogElement, last)
  assert.equal(prevented, 2)
})

test('dialog without enabled controls focuses its panel fallback', () => {
  const disabled = focusable('disabled')
  disabled.disabled = true
  const container = containerWith([disabled])
  focusFirstInDialog(container)
  assert.equal(globalThis.__focusedDialogElement, container)
})
