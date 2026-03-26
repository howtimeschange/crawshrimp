# Adapter Development Guide

## What is an Adapter?

An adapter is a folder containing:

- `manifest.yaml` - declares metadata, tasks, and triggers
- `*.js` scripts - page-specific scraping/automation logic
- `icon.png` (optional) - display icon

The crawshrimp core handles everything else: Chrome connection, JS injection, scheduling, data export, notifications.

## 5-Minute Quickstart

**1. Create your adapter folder**

```
my-adapter/
  manifest.yaml
  my-task.js
```

**2. Write `manifest.yaml`**

```yaml
id: my-adapter           # unique, lowercase, no spaces
name: My Adapter
version: 1.0.0
author: yourname
description: "What this adapter does"
entry_url: https://example.com

tasks:
  - id: my_task
    name: My Task
    script: my-task.js
    trigger:
      type: manual       # manual | interval | cron
    output:
      - type: excel
        filename: "result_{date}.xlsx"
```

**3. Write `my-task.js`**

```js
;(async () => {
  try {
    const data = []

    // Your scraping logic here.
    // You have full access to: document, window, fetch, etc.
    // The page is already loaded and the user is already logged in.

    // Example: scrape a table
    document.querySelectorAll('table tr').forEach(row => {
      const cells = [...row.querySelectorAll('td')].map(td => td.textContent.trim())
      if (cells.length > 0) data.push({ row: cells })
    })

    return {
      success: true,
      data,              // required: array of objects
      meta: {            // optional
        total: data.length,
        has_more: false  // set true to trigger auto-pagination
      }
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
})()
```

**4. Install**

In crawshrimp GUI: Platform Manager > Install > select your folder.

Or via API:
```bash
curl -X POST http://localhost:18765/adapters/install \
  -H 'Content-Type: application/json' \
  -d '{"path": "/absolute/path/to/my-adapter"}'
```

---

## manifest.yaml Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique adapter ID (lowercase, no spaces) |
| `name` | string | yes | Display name |
| `version` | string | no | Semver (default: 1.0.0) |
| `author` | string | no | Your name |
| `description` | string | no | Short description |
| `entry_url` | string | yes | URL prefix to match Chrome tab |
| `auth.check_script` | string | no | JS file that returns `{meta: {logged_in: bool}}` |
| `auth.login_url` | string | no | URL to redirect to if not logged in |
| `tasks[].id` | string | yes | Task ID (unique within adapter) |
| `tasks[].name` | string | yes | Display name |
| `tasks[].script` | string | yes | Relative path to JS file |
| `tasks[].trigger.type` | enum | no | `manual` / `interval` / `cron` (default: manual) |
| `tasks[].trigger.interval_minutes` | int | no | Used when type=interval |
| `tasks[].trigger.cron` | string | no | Cron expression, used when type=cron |
| `tasks[].output[].type` | enum | no | `excel` / `json` / `sqlite` / `notify` |
| `tasks[].output[].filename` | string | no | Filename template, supports `{date}` |
| `tasks[].output[].channel` | string | no | `dingtalk` / `feishu` / `webhook` |
| `tasks[].output[].condition` | string | no | JS expression, e.g. `data.length > 0` |

---

## JS Script Protocol

Every script must:
1. Be an async IIFE: `;(async () => { ... })()`
2. Return an object with `success: bool`
3. On success: include `data` array
4. On failure: include `error` string

```js
;(async () => {
  try {
    const data = []
    // ... your logic ...
    return {
      success: true,
      data,             // array of plain objects
      meta: {
        has_more: false // optional pagination signal
      }
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
})()
```

### Pagination

If your data spans multiple pages, use `meta.has_more`:

```js
;(async () => {
  try {
    const page = window.__CRAWSHRIMP_PAGE__ || 1  // injected by core
    // ... fetch page N ...
    return {
      success: true,
      data: pageData,
      meta: { has_more: page < totalPages }
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
})()
```

### Debug your script in Chrome DevTools

Before packaging, test your JS directly:
1. Open the target page in Chrome
2. Open DevTools > Console
3. Paste your script and run it
4. Check the returned object

---

## Distribute as ZIP

```bash
zip -r my-adapter.zip my-adapter/
```

Users install via GUI > Install > select ZIP, or API with `zip_base64`.
