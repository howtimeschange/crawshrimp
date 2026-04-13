# DOM Snippet Library

Use this file as a practical toolbox during DOM Lab work.

All snippets are meant to be:

- run in page context
- adapted to the target page
- used for small experiments before full adapter changes

Do not paste them blindly into production adapter code. First prove them on a live page.

## 1. Page Snapshot

### Basic page snapshot

```js
(() => {
  const title = document.title
  const href = location.href
  const heading = document.querySelector('h1,h2,[role="heading"]')?.textContent?.trim() || ''
  return { title, href, heading }
})()
```

### Visible form controls overview

```js
(() => {
  const isVisible = el => !!(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')

  const inputs = [...document.querySelectorAll('input, textarea, select, button')]
    .filter(isVisible)
    .slice(0, 80)
    .map(el => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      name: el.getAttribute('name') || '',
      placeholder: el.getAttribute('placeholder') || '',
      text: (el.textContent || '').trim().slice(0, 60),
      value: 'value' in el ? String(el.value || '') : '',
      testid: el.getAttribute('data-testid') || '',
      className: String(el.className || '').slice(0, 120),
    }))

  return inputs
})()
```

### Popup / portal roots

```js
(() => {
  const isVisible = el => !!(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
  return [...document.querySelectorAll('body > *')]
    .filter(isVisible)
    .map(el => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      className: String(el.className || '').slice(0, 160),
      role: el.getAttribute('role') || '',
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120),
    }))
    .filter(x => /dialog|popover|tooltip|menu|select|dropdown|modal/i.test(`${x.className} ${x.role}`))
})()
```

### Basic host and route context

```js
(() => ({
  href: location.href,
  host: location.host,
  pathname: location.pathname,
  search: location.search,
}))
```

## 2. Framework Clue Probes

### Probe React props-like keys on an element

```js
(() => {
  const el = document.querySelector('[data-testid], input, button, .target')
  if (!el) return null
  const keys = Object.keys(el).filter(k => k.startsWith('__reactProps') || k.startsWith('__reactFiber'))
  return { keys, hasReact: keys.length > 0 }
})()
```

### Probe Vue instance clues on an element

```js
(() => {
  const el = document.querySelector('.target, [data-testid], input')
  if (!el) return null
  return {
    hasVue: Boolean(el.__vueParentComponent || el.__vue__),
    vueKeys: Object.keys(el).filter(k => k.startsWith('__vue')).slice(0, 20),
  }
})()
```

### Walk up to find a component-like parent

```js
(() => {
  let node = document.querySelector('.target')
  const chain = []
  while (node && chain.length < 8) {
    chain.push({
      tag: node.tagName?.toLowerCase(),
      className: String(node.className || '').slice(0, 120),
      testid: node.getAttribute?.('data-testid') || '',
      hasReact: Object.keys(node).some(k => k.startsWith('__react')),
      hasVue: Boolean(node.__vueParentComponent || node.__vue__),
    })
    node = node.parentElement
  }
  return chain
})()
```

## 3. Readback Snippets

### Read visible text safely

```js
const readText = el => (el?.textContent || '').replace(/\s+/g, ' ').trim()
```

### Read current input value

```js
(() => {
  const el = document.querySelector('input, textarea')
  return el ? { value: el.value, placeholder: el.placeholder || '' } : null
})()
```

### Read select trigger display instead of container root

```js
(() => {
  const root = document.querySelector('.eds-react-select, .eds-selector, .select, [role="combobox"]')
  if (!root) return null
  const display = root.querySelector('.eds-react-select__inner, .eds-selector__inner, [class*="selector__inner"], [class*="select__selection"]')
  return {
    rootText: (root.textContent || '').trim(),
    displayText: (display?.textContent || '').trim(),
  }
})()
```

### Read radio / checkbox state

```js
(() => {
  return [...document.querySelectorAll('input[type="radio"], input[type="checkbox"]')].map(el => ({
    name: el.name || '',
    value: el.value || '',
    checked: el.checked,
    text: (el.closest('label, .radio, .checkbox')?.textContent || '').trim(),
  }))
})()
```

### Normalize numeric text before compare

```js
const normalizeNumberText = value =>
  String(value ?? '')
    .replace(/[,\s￥¥$RM%]/g, '')
    .trim()
```

## 4. Refresh Evidence Snippets

### Build a simple page signature

```js
(() => {
  const text = [...document.querySelectorAll('table tbody tr, [role="row"], li, .row')]
    .slice(0, 20)
    .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' || ')
  return {
    host: location.host,
    title: document.title,
    signature: text.slice(0, 400),
  }
})()
```

### Build a row signature list

```js
(() => {
  return [...document.querySelectorAll('table tbody tr, [role="row"], li, .row')]
    .filter(el => el.getClientRects().length)
    .slice(0, 30)
    .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
})()
```

### Snapshot visible busy / empty / rows together

```js
(() => {
  const isVisible = el => !!(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
  const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ')
  const rows = [...document.querySelectorAll('table tbody tr, [role="row"], li, .row')]
    .filter(isVisible)
    .slice(0, 20)
    .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  return {
    rowCount: rows.length,
    rows,
    hasBusyHint: /Too many visitors|timeout|loading|请稍后/i.test(bodyText),
    hasEmptyHint: /暂无数据|无数据|empty/i.test(bodyText),
  }
})()
```

## 5. API-First Probes

### Probe page-owned webpack require or chunk runtime

```js
(() => {
  const chunk = window.chunkLoadingGlobal_bgb_sca_main || window.webpackChunktemu_sca_container || window.webpackChunkbuild || null
  return {
    hasChunkRuntime: Boolean(chunk && typeof chunk.push === 'function'),
    chunkType: chunk ? Object.prototype.toString.call(chunk) : '',
  }
})()
```

### Capture fetch and XHR requests briefly

```js
(() => {
  if (window.__DOM_LAB_NET_CAPTURE__) return 'already-installed'
  window.__DOM_LAB_NET_CAPTURE__ = { fetches: [], xhrs: [] }

  const rawFetch = window.fetch
  window.fetch = async (...args) => {
    try {
      window.__DOM_LAB_NET_CAPTURE__.fetches.push({
        url: String(args[0] || ''),
        at: Date.now(),
      })
    } catch {}
    return rawFetch.apply(window, args)
  }

  const rawOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    try {
      window.__DOM_LAB_NET_CAPTURE__.xhrs.push({
        method: String(method || ''),
        url: String(url || ''),
        at: Date.now(),
      })
    } catch {}
    return rawOpen.call(this, method, url, ...rest)
  }

  return 'installed'
})()
```

### Read captured network summary

```js
(() => {
  const cap = window.__DOM_LAB_NET_CAPTURE__ || { fetches: [], xhrs: [] }
  return {
    fetches: cap.fetches.slice(-20),
    xhrs: cap.xhrs.slice(-20),
  }
})()
```

## 6. Minimal Write Experiments

### Native input setter + events

```js
(() => {
  const el = document.querySelector('input, textarea')
  const nextValue = '123'
  if (!el) return { ok: false, reason: 'input not found' }

  const setter = Object.getOwnPropertyDescriptor(el.__proto__, 'value')?.set
  if (setter) setter.call(el, nextValue)
  else el.value = nextValue

  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))

  return { ok: true, value: el.value }
})()
```

### Click sequence helper

```js
const clickSequence = el => {
  if (!el) return false
  ;['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(type => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
  })
  return true
}
```

### Wait for dependent field to appear

```js
async function waitForVisible(selector, timeoutMs = 3000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const el = document.querySelector(selector)
    if (el && el.getClientRects().length) return el
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`Timeout waiting for ${selector}`)
}
```

## 7. Select / Portal Mini Experiments

### Open trigger and list visible options

```js
(() => {
  const trigger = document.querySelector('[role="combobox"], .eds-react-select, .eds-selector')
  if (!trigger) return null
  trigger.click()

  const options = [...document.querySelectorAll('[role="option"], .eds-select-option, .eds-react-select-option, li')]
    .filter(el => el.getClientRects().length)
    .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  return { options }
})()
```

### Choose option by text with re-query

```js
(() => {
  const targetText = '扣除百分比'
  const option = [...document.querySelectorAll('[role="option"], .eds-select-option, .eds-react-select-option, li')]
    .find(el => (el.textContent || '').replace(/\s+/g, ' ').trim() === targetText)

  if (!option) return { ok: false, reason: 'option not found' }

  option.click()
  return { ok: true, clicked: targetText }
})()
```

### Read back trigger after option change

```js
(() => {
  const trigger = document.querySelector('.eds-react-select, .eds-selector, [role="combobox"]')
  const display = trigger?.querySelector('.eds-react-select__inner, .eds-selector__inner, [class*="selector__inner"]')
  return { displayText: (display?.textContent || '').trim() }
})()
```

## 8. Date Picker Mini Experiments

### Read current visible date input values

```js
(() => {
  return [...document.querySelectorAll('input')]
    .filter(el => /date|time|日期|时间/i.test(`${el.placeholder || ''} ${el.id || ''} ${el.className || ''}`))
    .map(el => ({
      id: el.id || '',
      placeholder: el.placeholder || '',
      value: el.value || '',
      className: String(el.className || '').slice(0, 120),
    }))
})()
```

### Minimal onChange experiment hook

```js
(() => {
  const input = document.querySelector('#startDate, input')
  if (!input) return null
  const reactPropKey = Object.keys(input).find(k => k.startsWith('__reactProps'))
  const props = reactPropKey ? input[reactPropKey] : null
  return {
    hasOnChange: Boolean(props?.onChange),
    propKeys: props ? Object.keys(props).slice(0, 20) : [],
  }
})()
```

### Check whether confirm button is required

```js
(() => {
  const buttons = [...document.querySelectorAll('button')]
    .filter(el => el.getClientRects().length)
    .map(el => (el.textContent || '').trim())
    .filter(Boolean)
  return { buttons }
})()
```

## 9. Page-Level Closed Loop Skeleton

### Fill one field and read it back

```js
;(async () => {
  const input = document.querySelector('input')
  if (!input) return { ok: false, reason: 'input not found' }

  const nextValue = '150'
  const setter = Object.getOwnPropertyDescriptor(input.__proto__, 'value')?.set
  if (setter) setter.call(input, nextValue)
  else input.value = nextValue

  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))

  await new Promise(r => setTimeout(r, 200))
  return { ok: input.value === nextValue, value: input.value }
})()
```

### Read success and failure signals together

```js
(() => {
  const text = document.body.innerText.replace(/\s+/g, ' ')
  const successHints = ['成功', '已新增', '查看详情', '返回列表页面']
  const failureHints = ['错误', '失败', '不可为空', '超过限制', '请先登录']

  return {
    success: successHints.filter(x => text.includes(x)),
    failure: failureHints.filter(x => text.includes(x)),
  }
})()
```

## 10. Practical Rules for Using These Snippets

- Run one snippet at a time.
- Capture the output into your DOM report.
- If a snippet proves a path works, turn that path into a dedicated helper.
- If a snippet only proves visual click but not state change, do not stop there.
- For list and export flows, capture before/after signatures instead of trusting one banner or one click.
- Treat this file as a starter kit, not a finished adapter.
