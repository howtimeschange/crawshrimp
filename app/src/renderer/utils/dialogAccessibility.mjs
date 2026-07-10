const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function getFocusableDialogElements(container) {
  if (!container?.querySelectorAll) return []
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => (
    !element.disabled
    && !element.hidden
    && Number(element.tabIndex) >= 0
    && element.getAttribute?.('aria-hidden') !== 'true'
    && !element.closest?.('[inert]')
  ))
}

export function focusFirstInDialog(container) {
  const [first] = getFocusableDialogElements(container)
  const target = first || container
  target?.focus?.({ preventScroll: true })
  return target || null
}

export function trapDialogFocus(event, container) {
  if (event?.key !== 'Tab' || !container) return false
  const focusable = getFocusableDialogElements(container)
  if (!focusable.length) {
    event.preventDefault?.()
    container.focus?.({ preventScroll: true })
    return true
  }
  const first = focusable[0]
  const last = focusable.at(-1)
  if (event.shiftKey && event.target === first) {
    event.preventDefault?.()
    last.focus?.({ preventScroll: true })
    return true
  }
  if (!event.shiftKey && event.target === last) {
    event.preventDefault?.()
    first.focus?.({ preventScroll: true })
    return true
  }
  if (!focusable.includes(event.target)) {
    event.preventDefault?.()
    first.focus?.({ preventScroll: true })
    return true
  }
  return false
}
