# AI Image Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independent `AI 生图` workbench in Crawshrimp that reuses 1XM image generation, supports GPT Image 2 and Gemini image models, saves outputs to a local folder, and keeps API keys in Settings.

**Architecture:** Add standalone `ai_image_*` SQLite tables and `/ai-image/*` FastAPI routes instead of reusing `task_instances`. Reuse `core/one_xm_image.py` for 1XM async tasks, add a focused `core/ai_image_service.py` for model/key/payload/output handling, expose the routes through Electron preload/main and dev bridge, then add a full-width Vue workbench with no global left sidebar, a top parameter ribbon, a Prompt/material panel, batch results, and a right history drawer.

**Tech Stack:** Python FastAPI, SQLite through `core/data_sink.py`, existing `core/one_xm_image.py`, Electron IPC, Vue 3 renderer, Node `node:test`, Python `unittest`.

## Global Constraints

- Visual anchor: use `docs/superpowers/assets/ai-image-workbench-option-3-visual-anchor.png` as the primary UI reference.
- AI image screen: do not show the global Crawshrimp left menu/sidebar while `AI 生图` is open.
- Workbench layout: top title/header, horizontal parameter ribbon, left Prompt/material panel, central batch result grid, right history drawer.
- Subtitle copy: `支持主图、参考图、Prompt、自定义尺寸和多模型生成`.
- Default output folder examples: macOS/Linux `~/Downloads/抓虾导出/AI生图`; Windows `%USERPROFILE%\Downloads\抓虾导出\AI生图`.
- Key behavior: GPT Image 2 uses `ai.1xm.gpt_image_2k_key` / `ai.1xm.gpt_image_4k_key`; Gemini models use separate Gemini key fields.
- Missing key CTA: show `去设置 1XM Key` and jump directly to Settings panel `1XM 图片模型`.

---

## Visual Anchor

方案 3 is the locked visual direction for implementation:

![AI 生图方案 3 视觉锚点](../assets/ai-image-workbench-option-3-visual-anchor.png)

Use this image for layout, hierarchy, density, and styling decisions. The implementation must preserve its main structure: no global left sidebar, compact top parameter ribbon, Prompt/material panel under the ribbon, large batch image grid, orange selected states, and a right-side history drawer.

## File Map

- Modify `core/config.py`: add Gemini-specific 1XM image keys to `DEFAULT_CONFIG`.
- Modify `tests/test_ai_settings_config.py`: cover GPT Image 2 keys and Gemini image keys.
- Modify `app/src/renderer/views/SettingsPage.vue`: rename the 1XM panel to `1XM 图片模型`, add Gemini key fields, and allow direct focus from the workbench.
- Modify `app/src/renderer/App.vue`: add `AI 生图` route, hide the global sidebar in AI image focus mode, route to `AiImageWorkbench`, and support setting-page focus state.
- Create `app/src/renderer/views/AiImageWorkbench.vue`:方案 3 full-width workbench with top parameter ribbon, left Prompt/material panel, central batch result grid, right history drawer, fixed generate button, and missing-key setting link.
- Create `app/src/renderer/utils/aiImageModels.js`: model metadata, default form, config requirement helpers.
- Create `app/src/renderer/utils/aiImageModels.test.js`: renderer utility tests.
- Create `tests/ai-image-workbench-navigation.test.js`: static renderer tests for nav, settings, and workbench copy.
- Modify `core/data_sink.py`: add `ai_image_jobs`, `ai_image_assets`, `ai_image_canvases` schema and CRUD helpers.
- Create `tests/test_ai_image_data_sink.py`: schema and CRUD tests.
- Create `core/ai_image_service.py`: default output path, config/key selection, payload builder, data URL conversion, download, save-as, run orchestration.
- Create `tests/test_ai_image_service.py`: pure service tests with fake transport and local temp files.
- Modify `core/api_server.py`: add Pydantic request models and `/ai-image/*` endpoints.
- Create `tests/test_ai_image_api.py`: direct endpoint tests with patched runtime paths and fake service calls.
- Modify `app/src/main.js`: add Electron IPC handlers for AI image APIs.
- Modify `app/src/preload.js`: expose `window.cs` AI image methods with HTTP fallback.
- Modify `app/src/renderer/utils/devCsBridge.js`: expose the same AI image methods in browser dev mode.
- Create `tests/ai-image-ipc-bridge.test.js`: static IPC/dev-bridge tests.
- Create `app/src/renderer/utils/aiImageCanvas.js`: tiny canvas document helper for V1.
- Create `app/src/renderer/utils/aiImageCanvas.test.js`: canvas helper tests.

## Task 1: Settings Keys And Full-Width Workbench Entry

**Files:**
- Modify: `core/config.py`
- Modify: `tests/test_ai_settings_config.py`
- Modify: `app/src/renderer/views/SettingsPage.vue`
- Modify: `app/src/renderer/App.vue`
- Create: `tests/ai-image-workbench-navigation.test.js`
- Create: `app/src/renderer/views/AiImageWorkbench.vue`

- [ ] **Step 1: Write failing backend config tests**

Add these assertions to `tests/test_ai_settings_config.py`:

```python
    def test_default_config_exposes_all_1xm_image_model_keys_without_real_secret_values(self):
        one_xm = DEFAULT_CONFIG["ai"]["1xm"]

        self.assertEqual(one_xm["base_url"], "https://api.1xm.ai/v1")
        self.assertEqual(one_xm["gpt_image_2k_key"], "")
        self.assertEqual(one_xm["gpt_image_4k_key"], "")
        self.assertEqual(one_xm["gemini_3_1_flash_image_preview_key"], "")
        self.assertEqual(one_xm["gemini_3_pro_image_preview_key"], "")
        self.assertEqual(DEFAULT_CONFIG["notify"]["dingtalk_secret"], "")
```

Update `test_save_config_expands_dotted_settings_keys` with:

```python
                    "ai.1xm.gemini_3_1_flash_image_preview_key": "unit-flash",
                    "ai.1xm.gemini_3_pro_image_preview_key": "unit-pro",
```

and assert:

```python
        self.assertEqual(loaded["ai"]["1xm"]["gemini_3_1_flash_image_preview_key"], "unit-flash")
        self.assertEqual(loaded["ai"]["1xm"]["gemini_3_pro_image_preview_key"], "unit-pro")
```

- [ ] **Step 2: Run config tests and verify they fail**

Run:

```bash
python -m unittest tests.test_ai_settings_config -v
```

Expected: fails because `gemini_3_1_flash_image_preview_key` and `gemini_3_pro_image_preview_key` are not in `DEFAULT_CONFIG`.

- [ ] **Step 3: Add Gemini keys to config**

Modify `core/config.py`:

```python
        "1xm": {
            "base_url": "https://api.1xm.ai/v1",
            "gpt_image_2k_key": "",
            "gpt_image_4k_key": "",
            "gemini_3_1_flash_image_preview_key": "",
            "gemini_3_pro_image_preview_key": "",
        },
```

- [ ] **Step 4: Write failing renderer navigation/settings tests**

Create `tests/ai-image-workbench-navigation.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('AI image workbench route enters full-width focus mode', () => {
  const app = fs.readFileSync('app/src/renderer/App.vue', 'utf8')
  const navBlock = app.match(/const navItems = \\[[\\s\\S]*?\\n\\]/)?.[0] || ''
  assert.match(navBlock, /id: 'task_center'[\\s\\S]*id: 'ai_image'[\\s\\S]*id: 'files'/)
  assert.match(app, /label: 'AI 生图'/)
  assert.match(app, /AiImageWorkbench/)
  assert.match(app, /const isAiImageFocusMode = computed/)
  assert.match(app, /v-if="!isAiImageFocusMode"/)
})

test('AI image workbench follows option 3 visual structure', () => {
  const view = fs.readFileSync('app/src/renderer/views/AiImageWorkbench.vue', 'utf8')
  assert.match(view, /支持主图、参考图、Prompt、自定义尺寸和多模型生成/)
  assert.match(view, /class="aiw-param-ribbon"/)
  assert.match(view, /class="aiw-prompt-panel"/)
  assert.match(view, /class="aiw-results-grid"/)
  assert.match(view, /class="aiw-history-drawer"/)
  assert.match(view, /class="aiw-generate-footer"/)
  assert.match(view, /去设置 1XM Key/)
  assert.match(view, /@click="goToOneXmSettings"/)
})

test('settings page exposes separate 1XM image model keys', () => {
  const settings = fs.readFileSync('app/src/renderer/views/SettingsPage.vue', 'utf8')
  assert.match(settings, /1XM 图片模型/)
  assert.match(settings, /ai\\.1xm\\.gpt_image_2k_key/)
  assert.match(settings, /ai\\.1xm\\.gpt_image_4k_key/)
  assert.match(settings, /ai\\.1xm\\.gemini_3_1_flash_image_preview_key/)
  assert.match(settings, /ai\\.1xm\\.gemini_3_pro_image_preview_key/)
  assert.doesNotMatch(settings, /<h3>1XM GPT-Image-2<\\/h3>/)
})
```

- [ ] **Step 5: Run renderer static test and verify it fails**

Run:

```bash
cd /Users/xingyicheng/Documents/crawshrimp
node --test tests/ai-image-workbench-navigation.test.js
```

Expected: fails because the AI image nav item, workbench file, and Gemini setting fields are not implemented.

- [ ] **Step 6: Add the nav route and settings focus wiring**

Modify `app/src/renderer/App.vue`:

```vue
<div :class="['layout', { 'layout-focus': isAiImageFocusMode }]">
```

```vue
<aside v-if="!isAiImageFocusMode" class="sidebar">
```

```vue
<AiImageWorkbench
  v-else-if="currentView === 'ai_image'"
  @open-settings="openSettingsPanel"
/>
<SettingsPage
  v-else-if="currentView === 'settings'"
  :status="status"
  :focus-panel-id="settingsFocusPanelId"
  @launch-chrome="launchChrome"
/>
```

Add imports/state/functions:

```js
import AiImageWorkbench from './views/AiImageWorkbench.vue'

const isAiImageFocusMode = computed(() => currentView.value === 'ai_image')
const settingsFocusPanelId = ref('')

const navItems = [
  { id: 'scripts', icon: '📄', label: '我的脚本' },
  { id: 'task_center', icon: '📋', label: '任务中心' },
  { id: 'ai_image', icon: '🖼', label: 'AI 生图' },
  { id: 'files', icon: '📁', label: '数据文件' },
  { id: 'settings', icon: '⚙️', label: '设置' },
]

function openSettingsPanel(panelId = '') {
  settingsFocusPanelId.value = panelId || ''
  currentView.value = 'settings'
  activeInstanceUid.value = ''
  activeScript.value = null
  activeTaskId.value = null
}
```

Add focus layout CSS:

```css
.layout-focus {
  grid-template-columns: 1fr;
}
```

- [ ] **Step 7: Update the settings page 1XM panel**

Modify `app/src/renderer/views/SettingsPage.vue`:

```js
const props = defineProps(['status', 'focusPanelId'])
```

Change the AI settings menu child:

```js
children: [{ id: 'ai-1xm', label: '1XM 图片模型', statusKey: 'ai.1xm.gpt_image_2k_key' }],
```

Change `panelFields['ai-1xm']`:

```js
'ai-1xm': [
  'ai.1xm.base_url',
  'ai.1xm.gpt_image_2k_key',
  'ai.1xm.gpt_image_4k_key',
  'ai.1xm.gemini_3_1_flash_image_preview_key',
  'ai.1xm.gemini_3_pro_image_preview_key',
],
```

Change `normalizedSettings`:

```js
  if (!flat['ai.1xm.base_url']) flat['ai.1xm.base_url'] = 'https://api.1xm.ai/v1'
  if (flat['ai.1xm.gemini_3_1_flash_image_preview_key'] === undefined) flat['ai.1xm.gemini_3_1_flash_image_preview_key'] = ''
  if (flat['ai.1xm.gemini_3_pro_image_preview_key'] === undefined) flat['ai.1xm.gemini_3_pro_image_preview_key'] = ''
```

Add focus watcher:

```js
import { computed, defineComponent, h, onMounted, reactive, ref, watch } from 'vue'

watch(() => props.focusPanelId, (panelId) => {
  if (panelId === 'ai-1xm') selectPanel('ai', 'ai-1xm')
})
```

Change the panel title and add two fields:

```vue
<h3>1XM 图片模型</h3>
```

```vue
<div class="split-fields">
  <div class="field">
    <label>Gemini 3.1 Flash Image Preview Key</label>
    <input
      v-model="cfg['ai.1xm.gemini_3_1_flash_image_preview_key']"
      placeholder="sk-..."
      class="input"
      type="password"
      autocomplete="off"
    />
  </div>
  <div class="field">
    <label>Gemini 3 Pro Image Preview Key</label>
    <input
      v-model="cfg['ai.1xm.gemini_3_pro_image_preview_key']"
      placeholder="sk-..."
      class="input"
      type="password"
      autocomplete="off"
    />
  </div>
</div>
```

- [ ] **Step 8: Add a temporary workbench shell**

Create `app/src/renderer/views/AiImageWorkbench.vue` as a方案 3 shell:

```vue
<template>
  <div class="aiw-page">
    <header class="aiw-header">
      <div>
        <h2>AI 生图</h2>
        <p>支持主图、参考图、Prompt、自定义尺寸和多模型生成</p>
      </div>
      <div class="aiw-header-actions">
        <button type="button" class="btn-ghost">历史记录</button>
        <button type="button" class="btn-ghost">打开输出文件夹</button>
      </div>
    </header>

    <section class="aiw-param-ribbon">
      <label>
        <span>模型</span>
        <select><option>gpt-image-2</option></select>
      </label>
      <label>
        <span>尺寸</span>
        <select><option>1024 × 1024 (1:1)</option></select>
      </label>
      <label>
        <span>质量</span>
        <select><option>高</option></select>
      </label>
      <label>
        <span>格式</span>
        <select><option>PNG</option></select>
      </label>
      <label>
        <span>生成数量</span>
        <select><option>6 张</option></select>
      </label>
      <label class="aiw-output-folder">
        <span>输出文件夹</span>
        <input value="%USERPROFILE%\\Downloads\\抓虾导出\\AI生图" readonly />
      </label>
      <div class="aiw-key-state">Key 配置 <button type="button" class="btn-link" @click="goToOneXmSettings">去设置 1XM Key</button></div>
    </section>

    <section class="aiw-layout">
      <aside class="aiw-prompt-panel">
        <label class="aiw-field">
          <span>Prompt</span>
          <textarea rows="8" placeholder="描述你想生成或改造的图片"></textarea>
        </label>
        <div class="aiw-materials">
          <strong>素材</strong>
          <button type="button" class="btn-ghost">上传主图</button>
          <button type="button" class="btn-ghost">上传参考图</button>
        </div>
        <div class="aiw-generate-footer">
          <button type="button" class="btn-orange">开始生成</button>
          <button type="button" class="btn-link" @click="goToOneXmSettings">去设置 1XM Key</button>
        </div>
      </aside>
      <main class="aiw-main">
        <div class="aiw-result-toolbar">
          <button type="button">全选</button>
          <button type="button">另存为选中</button>
          <button type="button">下载</button>
          <button type="button">发送到画布</button>
          <select><option>按模型筛选</option></select>
        </div>
        <div class="aiw-results-grid">
          <article v-for="index in 6" :key="index" class="aiw-result-card">
            <div class="aiw-result-check"></div>
            <div class="aiw-result-image"></div>
            <div class="aiw-result-meta">AI_Image_00{{ index }}.png · 1024 × 1024</div>
            <div class="aiw-result-actions">设为主图 · 加入参考图 · 重新生成</div>
          </article>
        </div>
      </main>
      <aside class="aiw-history-drawer">
        <header>历史记录</header>
        <div class="aiw-history-item">批次 #20260708-001 · 完成</div>
        <div class="aiw-history-item">批次 #20260708-002 · 完成</div>
        <div class="aiw-history-item">批次 #20260708-003 · 完成</div>
      </aside>
    </section>
  </div>
</template>

<script setup>
const emit = defineEmits(['open-settings'])

function goToOneXmSettings() {
  emit('open-settings', 'ai-1xm')
}
</script>

<style scoped>
.aiw-page { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--bg); }
.aiw-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 28px 16px; border-bottom: 1px solid var(--border); }
.aiw-header h2 { margin: 0; font-size: 19px; font-weight: 750; }
.aiw-header p { margin: 6px 0 0; color: var(--text3); font-size: 12px; }
.aiw-header-actions { display: flex; gap: 8px; }
.aiw-param-ribbon { display: grid; grid-template-columns: 180px 180px 110px 110px 120px minmax(260px, 1fr) 180px; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--border); background: var(--bg2); }
.aiw-layout { flex: 1; min-height: 0; display: grid; grid-template-columns: 360px minmax(0, 1fr) 288px; gap: 12px; padding: 14px 16px 16px; }
.aiw-prompt-panel { position: relative; min-height: 0; display: flex; flex-direction: column; gap: 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg2); padding: 14px; overflow-y: auto; }
.aiw-field { display: flex; flex-direction: column; gap: 8px; color: var(--text2); }
.aiw-field textarea { resize: vertical; min-height: 160px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg3); color: var(--text); padding: 10px; }
.aiw-materials { display: grid; gap: 8px; }
.aiw-generate-footer { position: sticky; bottom: 0; margin-top: auto; display: grid; gap: 8px; padding-top: 12px; background: linear-gradient(180deg, rgba(28, 28, 34, 0), var(--bg2) 24px); }
.aiw-main { min-width: 0; min-height: 0; display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 8px; background: var(--bg2); }
.aiw-result-toolbar { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
.aiw-results-grid { min-height: 0; overflow-y: auto; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding: 12px; }
.aiw-result-card { min-width: 0; border: 1px solid var(--border); border-radius: 8px; background: var(--bg3); overflow: hidden; }
.aiw-result-card:nth-child(1), .aiw-result-card:nth-child(3), .aiw-result-card:nth-child(5) { border-color: rgba(255, 107, 43, 0.75); }
.aiw-result-image { aspect-ratio: 1 / 1; background: #f4f1ec; }
.aiw-result-meta, .aiw-result-actions { padding: 8px 10px; color: var(--text2); font-size: 12px; }
.aiw-history-drawer { min-height: 0; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--bg2); padding: 14px; }
.btn-orange, .btn-ghost, .btn-link { border: 1px solid var(--border); border-radius: 8px; min-height: 32px; padding: 0 12px; background: var(--bg3); color: var(--text); }
.btn-orange { border-color: rgba(255, 107, 43, 0.55); background: var(--orange); color: #fff; }
.btn-link { background: transparent; color: var(--orange); }
</style>
```

- [ ] **Step 9: Run task tests and commit**

Run:

```bash
python -m unittest tests.test_ai_settings_config -v
node --test tests/ai-image-workbench-navigation.test.js
cd app && npm test
```

Expected: all pass.

Commit:

```bash
git add core/config.py tests/test_ai_settings_config.py app/src/renderer/App.vue app/src/renderer/views/SettingsPage.vue app/src/renderer/views/AiImageWorkbench.vue tests/ai-image-workbench-navigation.test.js
git commit -m "feat(ai-image): add workbench shell and model settings"
```

## Task 2: AI Image SQLite Tables And CRUD

**Files:**
- Modify: `core/data_sink.py`
- Create: `tests/test_ai_image_data_sink.py`

- [ ] **Step 1: Write failing data-sink tests**

Create `tests/test_ai_image_data_sink.py`:

```python
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core import data_sink


class AiImageDataSinkTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        patcher = patch("core.runtime_paths.data_root", return_value=self.root)
        patcher.start()
        self.addCleanup(patcher.stop)
        data_sink.init_db()

    def test_create_get_update_and_list_ai_image_job(self):
        job = data_sink.create_ai_image_job({
            "title": "商品图试验",
            "model": "gpt-image-2",
            "prompt": "白底童装商品图",
            "size": "1024x1024",
            "width": 1024,
            "height": 1024,
            "quality": "high",
            "output_format": "png",
            "count": 2,
            "key_tier": "2k",
            "output_dir": "/tmp/ai-images",
            "params": {"ratio": "1:1"},
        })

        loaded = data_sink.get_ai_image_job(job["job_uid"])
        self.assertEqual(loaded["status"], "draft")
        self.assertEqual(loaded["model"], "gpt-image-2")
        self.assertEqual(json.loads(loaded["params_json"])["ratio"], "1:1")

        updated = data_sink.update_ai_image_job(job["job_uid"], status="succeeded", summary={"result_count": 2})
        self.assertEqual(updated["status"], "succeeded")
        self.assertEqual(json.loads(updated["summary_json"])["result_count"], 2)

        listed = data_sink.list_ai_image_jobs()
        self.assertEqual([row["job_uid"] for row in listed], [job["job_uid"]])

    def test_ai_image_assets_keep_roles_and_order(self):
        job = data_sink.create_ai_image_job({"title": "多参考图", "model": "gemini-3-pro-image-preview"})

        main = data_sink.create_ai_image_asset({
            "job_uid": job["job_uid"],
            "role": "main",
            "source_type": "local",
            "local_path": "/tmp/main.png",
            "filename": "main.png",
            "sort_order": 0,
            "meta": {"note": "主图"},
        })
        ref = data_sink.create_ai_image_asset({
            "job_uid": job["job_uid"],
            "role": "reference",
            "source_type": "local",
            "local_path": "/tmp/ref.png",
            "filename": "ref.png",
            "sort_order": 1,
        })

        assets = data_sink.list_ai_image_assets(job_uid=job["job_uid"])
        self.assertEqual([item["asset_uid"] for item in assets], [main["asset_uid"], ref["asset_uid"]])
        self.assertEqual(json.loads(assets[0]["meta_json"])["note"], "主图")

    def test_ai_image_canvas_document_round_trip(self):
        canvas = data_sink.create_ai_image_canvas("试验画布", {"nodes": []})

        updated = data_sink.update_ai_image_canvas(canvas["canvas_uid"], document={"nodes": [{"id": "n1"}]})
        loaded = data_sink.get_ai_image_canvas(canvas["canvas_uid"])

        self.assertEqual(updated["title"], "试验画布")
        self.assertEqual(json.loads(loaded["document_json"])["nodes"][0]["id"], "n1")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run data-sink tests and verify they fail**

Run:

```bash
python -m unittest tests.test_ai_image_data_sink -v
```

Expected: fails because the `ai_image_*` helpers do not exist.

- [ ] **Step 3: Add schema to `init_db`**

Add the three `CREATE TABLE` blocks inside `core/data_sink.py:init_db()` after task-schedule tables:

```python
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ai_image_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_uid TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'draft',
                model TEXT NOT NULL,
                prompt TEXT NOT NULL DEFAULT '',
                negative_prompt TEXT NOT NULL DEFAULT '',
                size TEXT NOT NULL DEFAULT '',
                width INTEGER,
                height INTEGER,
                quality TEXT NOT NULL DEFAULT 'auto',
                output_format TEXT NOT NULL DEFAULT 'png',
                count INTEGER NOT NULL DEFAULT 1,
                key_tier TEXT NOT NULL DEFAULT 'auto',
                params_json TEXT NOT NULL DEFAULT '{}',
                advanced_json TEXT NOT NULL DEFAULT '{}',
                summary_json TEXT NOT NULL DEFAULT '{}',
                error TEXT NOT NULL DEFAULT '',
                output_dir TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                completed_at TEXT
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_ai_image_jobs_status_updated
            ON ai_image_jobs (status, updated_at)
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ai_image_assets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                asset_uid TEXT NOT NULL UNIQUE,
                job_uid TEXT,
                canvas_uid TEXT,
                role TEXT NOT NULL,
                source_type TEXT NOT NULL,
                local_path TEXT NOT NULL DEFAULT '',
                source_path TEXT NOT NULL DEFAULT '',
                remote_url TEXT NOT NULL DEFAULT '',
                filename TEXT NOT NULL DEFAULT '',
                mime_type TEXT NOT NULL DEFAULT '',
                width INTEGER,
                height INTEGER,
                sha256 TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                meta_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_ai_image_assets_job_role
            ON ai_image_assets (job_uid, role, sort_order)
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ai_image_canvases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                canvas_uid TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                document_json TEXT NOT NULL DEFAULT '{}',
                thumbnail_path TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_ai_image_canvases_updated
            ON ai_image_canvases (updated_at)
        """)
```

- [ ] **Step 4: Add CRUD helpers**

Add these helper names to `core/data_sink.py`:

```python
def create_ai_image_job(values: Mapping[str, Any]) -> dict: ...
def get_ai_image_job(job_uid: str) -> Optional[dict]: ...
def list_ai_image_jobs(status: str = "", keyword: str = "", limit: int = 100) -> list[dict]: ...
def update_ai_image_job(job_uid: str, **fields: Any) -> Optional[dict]: ...
def delete_ai_image_job(job_uid: str) -> bool: ...
def create_ai_image_asset(values: Mapping[str, Any]) -> dict: ...
def get_ai_image_asset(asset_uid: str) -> Optional[dict]: ...
def list_ai_image_assets(job_uid: str = "", canvas_uid: str = "", role: str = "") -> list[dict]: ...
def update_ai_image_asset(asset_uid: str, **fields: Any) -> Optional[dict]: ...
def delete_ai_image_asset(asset_uid: str) -> bool: ...
def create_ai_image_canvas(title: str, document: Optional[Mapping[str, Any]] = None) -> dict: ...
def get_ai_image_canvas(canvas_uid: str) -> Optional[dict]: ...
def list_ai_image_canvases(limit: int = 50) -> list[dict]: ...
def update_ai_image_canvas(canvas_uid: str, title: Optional[str] = None, document: Optional[Mapping[str, Any]] = None, thumbnail_path: Optional[str] = None) -> Optional[dict]: ...
```

Implement them using `_now_iso()`, `uuid.uuid4().hex`, `_json_dumps()`, `_row_to_dict()`, and `_get_conn()` following the existing task-instance helpers.

- [ ] **Step 5: Run data-sink tests and commit**

Run:

```bash
python -m unittest tests.test_ai_image_data_sink -v
python -m unittest tests.test_task_instances_data_sink tests.test_task_schedules_data_sink -v
```

Expected: all pass.

Commit:

```bash
git add core/data_sink.py tests/test_ai_image_data_sink.py
git commit -m "feat(ai-image): add standalone persistence tables"
```

## Task 3: Pure AI Image Service

**Files:**
- Create: `core/ai_image_service.py`
- Create: `tests/test_ai_image_service.py`

- [ ] **Step 1: Write failing service tests**

Create `tests/test_ai_image_service.py`:

```python
import tempfile
import unittest
from pathlib import Path

from core import ai_image_service


class AiImageServiceTests(unittest.TestCase):
    def test_default_output_dir_is_platform_compatible(self):
        mac = ai_image_service.default_output_dir(home="/Users/demo", platform="darwin")
        win = ai_image_service.default_output_dir(home=r"C:\\Users\\demo", platform="win32")

        self.assertEqual(mac, "/Users/demo/Downloads/抓虾导出/AI生图")
        self.assertEqual(win, r"C:\\Users\\demo\\Downloads\\抓虾导出\\AI生图")

    def test_selects_gpt_image_key_by_tier(self):
        settings = {
            "base_url": "https://api.1xm.ai/v1",
            "gpt_image_2k_key": "two",
            "gpt_image_4k_key": "four",
            "gemini_3_1_flash_image_preview_key": "flash",
            "gemini_3_pro_image_preview_key": "pro",
        }

        selected = ai_image_service.select_model_key(settings, "gpt-image-2", key_tier="4k")

        self.assertEqual(selected["key_id"], "ai.1xm.gpt_image_4k_key")
        self.assertEqual(selected["api_key"], "four")

    def test_selects_gemini_keys_independently(self):
        settings = {
            "base_url": "https://api.1xm.ai/v1",
            "gpt_image_2k_key": "two",
            "gpt_image_4k_key": "four",
            "gemini_3_1_flash_image_preview_key": "flash",
            "gemini_3_pro_image_preview_key": "pro",
        }

        flash = ai_image_service.select_model_key(settings, "gemini-3.1-flash-image-preview")
        pro = ai_image_service.select_model_key(settings, "gemini-3-pro-image-preview")

        self.assertEqual(flash["key_id"], "ai.1xm.gemini_3_1_flash_image_preview_key")
        self.assertEqual(flash["api_key"], "flash")
        self.assertEqual(pro["key_id"], "ai.1xm.gemini_3_pro_image_preview_key")
        self.assertEqual(pro["api_key"], "pro")

    def test_missing_key_error_exposes_config_key_id(self):
        with self.assertRaises(ai_image_service.AIImageConfigError) as ctx:
            ai_image_service.select_model_key({}, "gemini-3-pro-image-preview")

        self.assertEqual(ctx.exception.key_id, "ai.1xm.gemini_3_pro_image_preview_key")
        self.assertIn("设置菜单未配置", str(ctx.exception))

    def test_build_payload_orders_main_and_reference_images(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            main = root / "main.png"
            ref = root / "ref.png"
            main.write_bytes(b"\\x89PNG\\r\\n\\x1a\\n")
            ref.write_bytes(b"\\x89PNG\\r\\n\\x1a\\n")

            payload = ai_image_service.build_one_xm_payload({
                "model": "gpt-image-2",
                "prompt": "生成商品图",
                "size": "1024x1024",
                "quality": "high",
                "output_format": "png",
                "count": 1,
                "assets": [
                    {"role": "reference", "local_path": str(ref), "sort_order": 1},
                    {"role": "main", "local_path": str(main), "sort_order": 0},
                ],
            })

        self.assertEqual(payload["model"], "gpt-image-2")
        self.assertEqual(payload["n"], 1)
        self.assertEqual(len(payload["image"]), 2)
        self.assertTrue(payload["image"][0].startswith("data:image/png;base64,"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run service tests and verify they fail**

Run:

```bash
python -m unittest tests.test_ai_image_service -v
```

Expected: fails because `core.ai_image_service` does not exist.

- [ ] **Step 3: Add service constants and key selection**

Create `core/ai_image_service.py` with:

```python
from __future__ import annotations

import os
import platform as platform_module
import shutil
import urllib.request
from pathlib import Path, PureWindowsPath
from typing import Any, Mapping, Optional

from core.config import load_config
from core.one_xm_image import DEFAULT_BASE_URL, OneXMImageClient, file_to_data_url, run_image_task_until_done

SUPPORTED_MODELS = {
    "gpt-image-2": {"label": "GPT Image 2", "default_key_tier": "2k"},
    "gemini-3.1-flash-image-preview": {"label": "Gemini 3.1 Flash Image Preview", "key_id": "ai.1xm.gemini_3_1_flash_image_preview_key"},
    "gemini-3-pro-image-preview": {"label": "Gemini 3 Pro Image Preview", "key_id": "ai.1xm.gemini_3_pro_image_preview_key"},
}

GPT_IMAGE_KEY_IDS = {
    "2k": "ai.1xm.gpt_image_2k_key",
    "4k": "ai.1xm.gpt_image_4k_key",
}

ADVANCED_JSON_ALLOWLIST = {"webhook_url", "webhook_secret", "seed"}


class AIImageConfigError(RuntimeError):
    def __init__(self, message: str, *, key_id: str = "") -> None:
        super().__init__(message)
        self.key_id = key_id


def _compact(value: Any) -> str:
    return str(value or "").strip()


def _nested(config: Mapping[str, Any], dotted: str, default: Any = "") -> Any:
    current: Any = config
    for part in dotted.split("."):
        if not isinstance(current, Mapping):
            return default
        current = current.get(part)
    return current if current is not None else default


def default_output_dir(home: Optional[str] = None, platform: Optional[str] = None) -> str:
    system = (platform or platform_module.system()).lower()
    home_text = _compact(home) or str(Path.home())
    if system.startswith("win"):
        return str(PureWindowsPath(home_text) / "Downloads" / "抓虾导出" / "AI生图")
    return str(Path(home_text).expanduser() / "Downloads" / "抓虾导出" / "AI生图")


def resolve_settings(config: Optional[Mapping[str, Any]] = None) -> dict[str, str]:
    cfg = config if config is not None else load_config()
    return {
        "base_url": _compact(_nested(cfg, "ai.1xm.base_url", DEFAULT_BASE_URL)) or DEFAULT_BASE_URL,
        "gpt_image_2k_key": _compact(_nested(cfg, "ai.1xm.gpt_image_2k_key", "")),
        "gpt_image_4k_key": _compact(_nested(cfg, "ai.1xm.gpt_image_4k_key", "")),
        "gemini_3_1_flash_image_preview_key": _compact(_nested(cfg, "ai.1xm.gemini_3_1_flash_image_preview_key", "")),
        "gemini_3_pro_image_preview_key": _compact(_nested(cfg, "ai.1xm.gemini_3_pro_image_preview_key", "")),
    }


def select_model_key(settings: Mapping[str, Any], model: str, *, key_tier: str = "auto", quality: str = "auto") -> dict[str, str]:
    model_id = _compact(model)
    if model_id not in SUPPORTED_MODELS:
        raise ValueError(f"Unsupported AI image model: {model_id}")

    if model_id == "gpt-image-2":
        tier = _compact(key_tier).lower()
        if tier not in {"2k", "4k"}:
            tier = "4k" if _compact(quality).upper() == "4K" else "2k"
        key_id = GPT_IMAGE_KEY_IDS[tier]
        value_key = "gpt_image_4k_key" if tier == "4k" else "gpt_image_2k_key"
    elif model_id == "gemini-3.1-flash-image-preview":
        key_id = "ai.1xm.gemini_3_1_flash_image_preview_key"
        value_key = "gemini_3_1_flash_image_preview_key"
    else:
        key_id = "ai.1xm.gemini_3_pro_image_preview_key"
        value_key = "gemini_3_pro_image_preview_key"

    api_key = _compact(settings.get(value_key))
    if not api_key:
        raise AIImageConfigError("设置菜单未配置 1XM 图片模型 API Key", key_id=key_id)
    return {"key_id": key_id, "api_key": api_key, "base_url": _compact(settings.get("base_url")) or DEFAULT_BASE_URL}
```

- [ ] **Step 4: Add payload and file helpers**

Append to `core/ai_image_service.py`:

```python
def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _ordered_image_assets(assets: list[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    def sort_key(item: Mapping[str, Any]) -> tuple[int, int]:
        role = _compact(item.get("role"))
        role_order = 0 if role == "main" else 1 if role == "reference" else 2
        return role_order, _safe_int(item.get("sort_order"), 0)
    return sorted([item for item in assets if _compact(item.get("local_path"))], key=sort_key)


def sanitize_advanced_json(value: Optional[Mapping[str, Any]]) -> dict[str, Any]:
    return {key: item for key, item in dict(value or {}).items() if key in ADVANCED_JSON_ALLOWLIST}


def build_one_xm_payload(job: Mapping[str, Any]) -> dict[str, Any]:
    model = _compact(job.get("model"))
    if model not in SUPPORTED_MODELS:
        raise ValueError(f"Unsupported AI image model: {model}")

    payload: dict[str, Any] = {
        "model": model,
        "prompt": _compact(job.get("prompt")),
        "size": _compact(job.get("size")) or _size_from_dimensions(job),
        "quality": _compact(job.get("quality")) or "auto",
    }
    if model == "gpt-image-2":
        payload["output_format"] = _compact(job.get("output_format")) or "png"
        payload["n"] = max(1, _safe_int(job.get("count"), 1))
    for key, value in sanitize_advanced_json(job.get("advanced") or job.get("advanced_json")).items():
        payload[key] = value

    images = [file_to_data_url(_compact(item.get("local_path"))) for item in _ordered_image_assets(list(job.get("assets") or []))]
    if images:
        payload["image"] = images
    return payload


def _size_from_dimensions(job: Mapping[str, Any]) -> str:
    width = _safe_int(job.get("width"), 0)
    height = _safe_int(job.get("height"), 0)
    return f"{width}x{height}" if width > 0 and height > 0 else "1024x1024"


def ensure_output_dir(path: str = "") -> Path:
    target = Path(_compact(path) or default_output_dir()).expanduser()
    target.mkdir(parents=True, exist_ok=True)
    return target


def copy_assets_to_directory(paths: list[str], target_dir: str) -> list[str]:
    target = ensure_output_dir(target_dir)
    copied = []
    for raw in paths:
        source = Path(raw).expanduser()
        if not source.is_file():
            continue
        dest = target / source.name
        if dest.exists():
            dest = target / f"{source.stem}-{source.stat().st_size:x}{source.suffix}"
        shutil.copy2(source, dest)
        copied.append(str(dest))
    return copied
```

- [ ] **Step 5: Run service tests and commit**

Run:

```bash
python -m unittest tests.test_ai_image_service -v
```

Expected: all pass.

Commit:

```bash
git add core/ai_image_service.py tests/test_ai_image_service.py
git commit -m "feat(ai-image): add model settings and payload service"
```

## Task 4: `/ai-image/*` API CRUD

**Files:**
- Modify: `core/api_server.py`
- Create: `tests/test_ai_image_api.py`

- [ ] **Step 1: Write failing API CRUD tests**

Create `tests/test_ai_image_api.py`:

```python
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core import api_server, data_sink


class AiImageApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        patcher = patch("core.runtime_paths.data_root", return_value=root)
        patcher.start()
        self.addCleanup(patcher.stop)
        data_sink.init_db()

    def test_create_list_and_get_ai_image_job(self):
        created = api_server.create_ai_image_job_endpoint(api_server.AiImageJobCreateRequest(
            title="商品图测试",
            model="gpt-image-2",
            prompt="生成白底商品图",
            size="1024x1024",
            quality="high",
            output_format="png",
            count=1,
            output_dir="/tmp/ai-images",
        ))

        self.assertTrue(created["job_uid"])
        self.assertEqual(created["model"], "gpt-image-2")

        listed = api_server.list_ai_image_jobs_endpoint()
        self.assertEqual([item["job_uid"] for item in listed["items"]], [created["job_uid"]])

        detail = api_server.get_ai_image_job_endpoint(created["job_uid"])
        self.assertEqual(detail["prompt"], "生成白底商品图")

    def test_asset_and_canvas_endpoints(self):
        created = api_server.create_ai_image_job_endpoint(api_server.AiImageJobCreateRequest(
            title="素材测试",
            model="gemini-3-pro-image-preview",
            prompt="参考图融合",
        ))

        asset = api_server.create_ai_image_asset_endpoint(api_server.AiImageAssetCreateRequest(
            job_uid=created["job_uid"],
            role="main",
            source_type="local",
            local_path="/tmp/main.png",
            filename="main.png",
        ))
        self.assertEqual(asset["role"], "main")

        canvas = api_server.create_ai_image_canvas_endpoint(api_server.AiImageCanvasCreateRequest(
            title="测试画布",
            document={"nodes": []},
        ))
        self.assertTrue(canvas["canvas_uid"])
```

- [ ] **Step 2: Run API tests and verify they fail**

Run:

```bash
python -m unittest tests.test_ai_image_api -v
```

Expected: fails because request classes and endpoints do not exist.

- [ ] **Step 3: Add request models and serializers**

Add near the existing task request models in `core/api_server.py`:

```python
class AiImageJobCreateRequest(BaseModel):
    title: str = ""
    model: str
    prompt: str = ""
    negative_prompt: str = ""
    size: str = ""
    width: Optional[int] = None
    height: Optional[int] = None
    quality: str = "auto"
    output_format: str = "png"
    count: int = 1
    key_tier: str = "auto"
    params: Optional[dict] = None
    advanced: Optional[dict] = None
    output_dir: str = ""
    run: bool = False


class AiImageJobPatchRequest(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    prompt: Optional[str] = None
    size: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    quality: Optional[str] = None
    output_format: Optional[str] = None
    count: Optional[int] = None
    key_tier: Optional[str] = None
    params: Optional[dict] = None
    advanced: Optional[dict] = None
    summary: Optional[dict] = None
    error: Optional[str] = None
    output_dir: Optional[str] = None


class AiImageAssetCreateRequest(BaseModel):
    job_uid: str = ""
    canvas_uid: str = ""
    role: str
    source_type: str = "local"
    local_path: str = ""
    source_path: str = ""
    remote_url: str = ""
    filename: str = ""
    mime_type: str = ""
    width: Optional[int] = None
    height: Optional[int] = None
    sha256: str = ""
    sort_order: int = 0
    meta: Optional[dict] = None


class AiImageCanvasCreateRequest(BaseModel):
    title: str = "未命名画布"
    document: Optional[dict] = None


def _serialize_ai_image_row(row: dict) -> dict:
    data = dict(row or {})
    for source_key, target_key in (("params_json", "params"), ("advanced_json", "advanced"), ("summary_json", "summary"), ("meta_json", "meta"), ("document_json", "document")):
        if source_key in data:
            data[target_key] = _parse_json_object(data.get(source_key))
    return data
```

- [ ] **Step 4: Add CRUD endpoints**

Add before the Settings routes:

```python
@app.get("/ai-image/jobs")
def list_ai_image_jobs_endpoint(status: str = "", keyword: str = "", limit: int = 100):
    return {"items": [_serialize_ai_image_row(row) for row in data_sink.list_ai_image_jobs(status=status, keyword=keyword, limit=limit)]}


@app.post("/ai-image/jobs")
def create_ai_image_job_endpoint(req: AiImageJobCreateRequest):
    values = _model_patch(req)
    values["params"] = values.pop("params", {}) or {}
    values["advanced"] = values.pop("advanced", {}) or {}
    row = data_sink.create_ai_image_job(values)
    return _serialize_ai_image_row(row)


@app.get("/ai-image/jobs/{job_uid}")
def get_ai_image_job_endpoint(job_uid: str):
    row = data_sink.get_ai_image_job(job_uid)
    if not row:
        raise HTTPException(404, "AI image job not found")
    data = _serialize_ai_image_row(row)
    data["assets"] = [_serialize_ai_image_row(item) for item in data_sink.list_ai_image_assets(job_uid=job_uid)]
    return data


@app.patch("/ai-image/jobs/{job_uid}")
def patch_ai_image_job_endpoint(job_uid: str, req: AiImageJobPatchRequest):
    patch = _model_patch(req)
    if "summary" in patch:
        patch["summary"] = patch.pop("summary") or {}
    if "advanced" in patch:
        patch["advanced"] = patch.pop("advanced") or {}
    row = data_sink.update_ai_image_job(job_uid, **patch)
    if not row:
        raise HTTPException(404, "AI image job not found")
    return _serialize_ai_image_row(row)


@app.post("/ai-image/assets")
def create_ai_image_asset_endpoint(req: AiImageAssetCreateRequest):
    return _serialize_ai_image_row(data_sink.create_ai_image_asset(_model_patch(req)))


@app.post("/ai-image/canvases")
def create_ai_image_canvas_endpoint(req: AiImageCanvasCreateRequest):
    return _serialize_ai_image_row(data_sink.create_ai_image_canvas(req.title, req.document or {}))
```

- [ ] **Step 5: Run API CRUD tests and commit**

Run:

```bash
python -m unittest tests.test_ai_image_api -v
```

Expected: all pass.

Commit:

```bash
git add core/api_server.py tests/test_ai_image_api.py
git commit -m "feat(ai-image): expose workbench CRUD API"
```

## Task 5: 1XM Execution, Local Download, And Save-As

**Files:**
- Modify: `core/ai_image_service.py`
- Modify: `core/api_server.py`
- Modify: `tests/test_ai_image_service.py`
- Modify: `tests/test_ai_image_api.py`

- [ ] **Step 1: Add failing run/save-as service tests**

Append to `tests/test_ai_image_service.py`:

```python
    def test_copy_assets_to_directory_keeps_original_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            source = root / "source.png"
            target = root / "selected"
            source.write_bytes(b"image")

            copied = ai_image_service.copy_assets_to_directory([str(source)], str(target))

        self.assertEqual(len(copied), 1)
        self.assertEqual(Path(copied[0]).name, "source.png")

    def test_download_image_url_writes_file_without_base64_in_summary(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir)

            def fake_urlretrieve(url, filename):
                Path(filename).write_bytes(b"image")
                return filename, {}

            output = ai_image_service.download_image_url(
                "https://img.1xm.ai/a.png",
                target,
                model="gpt-image-2",
                index=1,
                output_format="png",
                urlretrieve=fake_urlretrieve,
                timestamp="20260703-120000",
            )

        self.assertEqual(Path(output).name, "gpt-image-2_20260703-120000_001.png")
```

- [ ] **Step 2: Run service tests and verify they fail**

Run:

```bash
python -m unittest tests.test_ai_image_service -v
```

Expected: fails because `download_image_url` is missing.

- [ ] **Step 3: Add download and run helpers**

Append to `core/ai_image_service.py`:

```python
def _model_slug(model: str) -> str:
    return _compact(model).replace(".", "-").replace("_", "-")


def download_image_url(
    url: str,
    output_dir: Path,
    *,
    model: str,
    index: int,
    output_format: str = "png",
    timestamp: str = "",
    urlretrieve=urllib.request.urlretrieve,
) -> str:
    safe_ext = (_compact(output_format) or "png").lower().lstrip(".")
    stamp = timestamp or __import__("datetime").datetime.now().strftime("%Y%m%d-%H%M%S")
    target = output_dir / f"{_model_slug(model)}_{stamp}_{max(1, int(index)):03d}.{safe_ext}"
    urlretrieve(url, str(target))
    return str(target)


def run_job_with_one_xm(job: Mapping[str, Any], assets: list[Mapping[str, Any]], *, settings: Optional[Mapping[str, Any]] = None, client_factory=OneXMImageClient, sleep_fn=None) -> dict[str, Any]:
    resolved_settings = dict(settings or resolve_settings())
    key = select_model_key(resolved_settings, _compact(job.get("model")), key_tier=_compact(job.get("key_tier")) or "auto", quality=_compact(job.get("quality")) or "auto")
    output_dir = ensure_output_dir(_compact(job.get("output_dir")))
    payload = build_one_xm_payload({**dict(job), "assets": assets})
    client = client_factory(key["api_key"], base_url=key["base_url"])
    count = max(1, _safe_int(job.get("count"), 1))
    task_count = count if _compact(job.get("model")) != "gpt-image-2" else 1
    results = []
    errors = []
    for index in range(1, task_count + 1):
        per_payload = dict(payload)
        if _compact(job.get("model")) != "gpt-image-2":
            per_payload.pop("n", None)
        result = run_image_task_until_done(
            client,
            per_payload,
            idempotency_key=f"ai_image_{_compact(job.get('job_uid'))}_{index}_1",
            sleep_fn=sleep_fn or __import__("time").sleep,
        )
        if not result.get("ok"):
            errors.append(result.get("error") or "1XM 任务失败")
            continue
        for image_index, url in enumerate(result.get("image_urls") or [], start=1):
            local_path = download_image_url(url, output_dir, model=_compact(job.get("model")), index=image_index, output_format=_compact(job.get("output_format")) or "png")
            results.append({"url": url, "local_path": local_path, "task_id": result.get("task_id"), "poll_url": result.get("poll_url")})
    return {
        "ok": bool(results) and not errors,
        "status": "succeeded" if results and not errors else "partial_failed" if results else "failed",
        "results": results,
        "errors": errors,
        "output_dir": str(output_dir),
    }
```

- [ ] **Step 4: Add run and save-as API tests**

Append to `tests/test_ai_image_api.py`:

```python
    def test_save_as_copies_selected_assets(self):
        created = api_server.create_ai_image_job_endpoint(api_server.AiImageJobCreateRequest(
            title="另存为",
            model="gpt-image-2",
            prompt="测试",
        ))
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            source = root / "source.png"
            target = root / "target"
            source.write_bytes(b"image")
            asset = api_server.create_ai_image_asset_endpoint(api_server.AiImageAssetCreateRequest(
                job_uid=created["job_uid"],
                role="output",
                source_type="generated",
                local_path=str(source),
                filename="source.png",
            ))

            result = api_server.save_as_ai_image_job_endpoint(
                created["job_uid"],
                api_server.AiImageSaveAsRequest(asset_uids=[asset["asset_uid"]], target_dir=str(target)),
            )

        self.assertEqual(result["copied_count"], 1)
        self.assertEqual(Path(result["paths"][0]).name, "source.png")
```

- [ ] **Step 5: Add save-as request model and endpoint**

Add to `core/api_server.py`:

```python
class AiImageSaveAsRequest(BaseModel):
    asset_uids: list[str]
    target_dir: str
```

Add endpoint:

```python
@app.post("/ai-image/jobs/{job_uid}/save-as")
def save_as_ai_image_job_endpoint(job_uid: str, req: AiImageSaveAsRequest):
    assets = [data_sink.get_ai_image_asset(uid) for uid in (req.asset_uids or [])]
    paths = [str(item.get("local_path") or "") for item in assets if item and item.get("job_uid") == job_uid]
    copied = ai_image_service.copy_assets_to_directory(paths, req.target_dir)
    return {"ok": True, "copied_count": len(copied), "paths": copied}
```

Ensure `core/api_server.py` imports the service:

```python
from core import ai_image_service
```

- [ ] **Step 6: Run task tests and commit**

Run:

```bash
python -m unittest tests.test_ai_image_service tests.test_ai_image_api -v
```

Expected: all pass.

Commit:

```bash
git add core/ai_image_service.py core/api_server.py tests/test_ai_image_service.py tests/test_ai_image_api.py
git commit -m "feat(ai-image): run 1xm jobs and save selected outputs"
```

## Task 6: Electron IPC And Dev Bridge

**Files:**
- Modify: `app/src/main.js`
- Modify: `app/src/preload.js`
- Modify: `app/src/renderer/utils/devCsBridge.js`
- Create: `tests/ai-image-ipc-bridge.test.js`

- [ ] **Step 1: Write failing bridge tests**

Create `tests/ai-image-ipc-bridge.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('Electron main registers AI image IPC handlers', () => {
  const main = fs.readFileSync('app/src/main.js', 'utf8')
  for (const channel of [
    'list-ai-image-jobs',
    'create-ai-image-job',
    'get-ai-image-job',
    'update-ai-image-job',
    'run-ai-image-job',
    'save-as-ai-image-job',
    'create-ai-image-asset',
    'create-ai-image-canvas',
  ]) {
    assert.match(main, new RegExp(`secureHandle\\\\('${channel}'`))
  }
})

test('Preload and dev bridge expose AI image methods with HTTP fallback', () => {
  const preload = fs.readFileSync('app/src/preload.js', 'utf8')
  const devBridge = fs.readFileSync('app/src/renderer/utils/devCsBridge.js', 'utf8')

  for (const source of [preload, devBridge]) {
    assert.match(source, /listAiImageJobs/)
    assert.match(source, /createAiImageJob/)
    assert.match(source, /getAiImageJob/)
    assert.match(source, /updateAiImageJob/)
    assert.match(source, /runAiImageJob/)
    assert.match(source, /saveAsAiImageJob/)
    assert.match(source, /createAiImageAsset/)
    assert.match(source, /createAiImageCanvas/)
    assert.match(source, /\\/ai-image\\/jobs/)
  }
})
```

- [ ] **Step 2: Run bridge tests and verify they fail**

Run:

```bash
node --test tests/ai-image-ipc-bridge.test.js
```

Expected: fails because AI image IPC methods are missing.

- [ ] **Step 3: Add main-process handlers**

Add to `app/src/main.js` near task-instance handlers:

```js
secureHandle('list-ai-image-jobs', async (_, query = {}) =>
  apiCall('GET', `/ai-image/jobs?${new URLSearchParams(query || {})}`))
secureHandle('create-ai-image-job', async (_, payload) =>
  apiCall('POST', '/ai-image/jobs', payload || {}))
secureHandle('get-ai-image-job', async (_, jobUid) =>
  apiCall('GET', `/ai-image/jobs/${encodeURIComponent(String(jobUid || ''))}`))
secureHandle('update-ai-image-job', async (_, jobUid, payload) =>
  apiCall('PATCH', `/ai-image/jobs/${encodeURIComponent(String(jobUid || ''))}`, payload || {}))
secureHandle('run-ai-image-job', async (_, jobUid, payload = {}) =>
  apiCall('POST', `/ai-image/jobs/${encodeURIComponent(String(jobUid || ''))}/run`, payload || {}, { timeoutMs: 20 * 60 * 1000 }))
secureHandle('save-as-ai-image-job', async (_, jobUid, payload = {}) =>
  apiCall('POST', `/ai-image/jobs/${encodeURIComponent(String(jobUid || ''))}/save-as`, payload || {}))
secureHandle('create-ai-image-asset', async (_, payload) =>
  apiCall('POST', '/ai-image/assets', payload || {}))
secureHandle('create-ai-image-canvas', async (_, payload) =>
  apiCall('POST', '/ai-image/canvases', payload || {}))
```

- [ ] **Step 4: Add preload methods**

Add to `app/src/preload.js`:

```js
  listAiImageJobs: (query = {}) => invokeWithApiFallback('list-ai-image-jobs', [query],
    () => apiCall('GET', `/ai-image/jobs?${queryString(query)}`)),
  createAiImageJob: (payload) => invokeWithApiFallback('create-ai-image-job', [payload],
    () => apiCall('POST', '/ai-image/jobs', payload || {})),
  getAiImageJob: (uid) => invokeWithApiFallback('get-ai-image-job', [uid],
    () => apiCall('GET', `/ai-image/jobs/${encodePathPart(uid)}`)),
  updateAiImageJob: (uid, payload) => invokeWithApiFallback('update-ai-image-job', [uid, payload],
    () => apiCall('PATCH', `/ai-image/jobs/${encodePathPart(uid)}`, payload || {})),
  runAiImageJob: (uid, payload = {}) => invokeWithApiFallback('run-ai-image-job', [uid, payload || {}],
    () => apiCall('POST', `/ai-image/jobs/${encodePathPart(uid)}/run`, payload || {})),
  saveAsAiImageJob: (uid, payload = {}) => invokeWithApiFallback('save-as-ai-image-job', [uid, payload || {}],
    () => apiCall('POST', `/ai-image/jobs/${encodePathPart(uid)}/save-as`, payload || {})),
  createAiImageAsset: (payload) => invokeWithApiFallback('create-ai-image-asset', [payload],
    () => apiCall('POST', '/ai-image/assets', payload || {})),
  createAiImageCanvas: (payload) => invokeWithApiFallback('create-ai-image-canvas', [payload],
    () => apiCall('POST', '/ai-image/canvases', payload || {})),
```

- [ ] **Step 5: Add dev bridge methods**

Add the same method names to `app/src/renderer/utils/devCsBridge.js`, using direct `apiCall`:

```js
    listAiImageJobs: (query = {}) => apiCall('GET', `/ai-image/jobs?${queryString(query)}`),
    createAiImageJob: (payload) => apiCall('POST', '/ai-image/jobs', payload || {}),
    getAiImageJob: (uid) => apiCall('GET', `/ai-image/jobs/${encodePathPart(uid)}`),
    updateAiImageJob: (uid, payload) => apiCall('PATCH', `/ai-image/jobs/${encodePathPart(uid)}`, payload || {}),
    runAiImageJob: (uid, payload = {}) => apiCall('POST', `/ai-image/jobs/${encodePathPart(uid)}/run`, payload || {}),
    saveAsAiImageJob: (uid, payload = {}) => apiCall('POST', `/ai-image/jobs/${encodePathPart(uid)}/save-as`, payload || {}),
    createAiImageAsset: (payload) => apiCall('POST', '/ai-image/assets', payload || {}),
    createAiImageCanvas: (payload) => apiCall('POST', '/ai-image/canvases', payload || {}),
```

- [ ] **Step 6: Run bridge tests and commit**

Run:

```bash
node --test tests/ai-image-ipc-bridge.test.js
cd app && npm test
```

Expected: all pass.

Commit:

```bash
git add app/src/main.js app/src/preload.js app/src/renderer/utils/devCsBridge.js tests/ai-image-ipc-bridge.test.js
git commit -m "feat(ai-image): expose workbench APIs to renderer"
```

## Task 7: Renderer Utilities And Full Workbench UI

**Files:**
- Create: `app/src/renderer/utils/aiImageModels.js`
- Create: `app/src/renderer/utils/aiImageModels.test.js`
- Modify: `app/src/renderer/views/AiImageWorkbench.vue`

- [ ] **Step 1: Write failing utility tests**

Create `app/src/renderer/utils/aiImageModels.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { AI_IMAGE_MODELS, defaultAiImageForm, missingKeyForModel, outputDirHint } from './aiImageModels.js'

test('AI image models include GPT Image 2 and Gemini image models', () => {
  assert.deepEqual(AI_IMAGE_MODELS.map(item => item.id), [
    'gpt-image-2',
    'gemini-3.1-flash-image-preview',
    'gemini-3-pro-image-preview',
  ])
})

test('default form uses prompt workflow defaults', () => {
  const form = defaultAiImageForm()
  assert.equal(form.model, 'gpt-image-2')
  assert.equal(form.output_format, 'png')
  assert.equal(form.count, 1)
  assert.equal(form.key_tier, 'auto')
})

test('missing key helper distinguishes GPT and Gemini keys', () => {
  assert.equal(missingKeyForModel({}, 'gpt-image-2', '2k'), 'ai.1xm.gpt_image_2k_key')
  assert.equal(missingKeyForModel({}, 'gemini-3.1-flash-image-preview'), 'ai.1xm.gemini_3_1_flash_image_preview_key')
  assert.equal(missingKeyForModel({ 'ai.1xm.gemini_3_pro_image_preview_key': 'ok' }, 'gemini-3-pro-image-preview'), '')
})

test('output dir hint includes Windows-compatible path', () => {
  assert.match(outputDirHint(), /%USERPROFILE%\\\\Downloads\\\\抓虾导出\\\\AI生图/)
})
```

- [ ] **Step 2: Run utility tests and verify they fail**

Run:

```bash
cd /Users/xingyicheng/Documents/crawshrimp/app
node --test src/renderer/utils/aiImageModels.test.js
```

Expected: fails because the utility file does not exist.

- [ ] **Step 3: Add renderer utility**

Create `app/src/renderer/utils/aiImageModels.js`:

```js
export const AI_IMAGE_MODELS = [
  { id: 'gpt-image-2', label: 'GPT Image 2', note: '稳定通用', defaultQuality: 'high' },
  { id: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash', note: '快速', defaultQuality: '2K' },
  { id: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro', note: '高质量', defaultQuality: '4K' },
]

export function defaultAiImageForm() {
  return {
    title: '',
    model: 'gpt-image-2',
    prompt: '',
    size: '1024x1024',
    width: 1024,
    height: 1024,
    quality: 'high',
    output_format: 'png',
    count: 1,
    key_tier: 'auto',
    output_dir: '',
    advanced: '{}',
  }
}

export function missingKeyForModel(settings = {}, model, keyTier = 'auto') {
  if (model === 'gemini-3.1-flash-image-preview') {
    return String(settings['ai.1xm.gemini_3_1_flash_image_preview_key'] || '').trim()
      ? ''
      : 'ai.1xm.gemini_3_1_flash_image_preview_key'
  }
  if (model === 'gemini-3-pro-image-preview') {
    return String(settings['ai.1xm.gemini_3_pro_image_preview_key'] || '').trim()
      ? ''
      : 'ai.1xm.gemini_3_pro_image_preview_key'
  }
  const tier = keyTier === '4k' ? '4k' : '2k'
  const key = tier === '4k' ? 'ai.1xm.gpt_image_4k_key' : 'ai.1xm.gpt_image_2k_key'
  return String(settings[key] || '').trim() ? '' : key
}

export function outputDirHint() {
  return 'macOS/Linux: ~/Downloads/抓虾导出/AI生图 · Windows: %USERPROFILE%\\\\Downloads\\\\抓虾导出\\\\AI生图'
}
```

- [ ] **Step 4: Replace the workbench shell with the functional layout**

Modify `app/src/renderer/views/AiImageWorkbench.vue` to keep the方案 3 structure functional:

```js
import { computed, onMounted, reactive, ref } from 'vue'
import { AI_IMAGE_MODELS, defaultAiImageForm, missingKeyForModel, outputDirHint } from '../utils/aiImageModels'

const emit = defineEmits(['open-settings'])
const form = reactive(defaultAiImageForm())
const settings = ref({})
const mainImage = ref(null)
const references = ref([])
const results = ref([])
const selectedAssetUids = ref(new Set())
const logs = ref([])
const historyOpen = ref(true)
const workspaceMode = ref('results')
const running = ref(false)

const missingKeyId = computed(() => missingKeyForModel(settings.value, form.model, form.key_tier))
const canGenerate = computed(() => !running.value && String(form.prompt || '').trim() && !missingKeyId.value)
const dirHint = outputDirHint()

async function loadSettings() {
  settings.value = await window.cs.getSettings()
}

async function chooseMainImage() {
  const path = await window.cs.browseFile({ images: true, title: '选择主图' })
  if (path) mainImage.value = { role: 'main', local_path: path, filename: path.split(/[\\\\/]/).pop() || path, sort_order: 0 }
}

async function chooseReferences() {
  const paths = await window.cs.browseFile({ images: true, multi: true, title: '选择参考图' })
  references.value = (Array.isArray(paths) ? paths : [paths]).filter(Boolean).map((path, index) => ({
    role: 'reference',
    local_path: path,
    filename: path.split(/[\\\\/]/).pop() || path,
    sort_order: index + 1,
  }))
}

async function chooseOutputDir() {
  const path = await window.cs.browseFile({ directory: true, title: '选择 AI 生图保存文件夹' })
  if (path) form.output_dir = path
}

function goToOneXmSettings() {
  emit('open-settings', 'ai-1xm')
}

async function startGenerate() {
  if (missingKeyId.value) return goToOneXmSettings()
  running.value = true
  logs.value.push('创建 AI 生图任务')
  try {
    const job = await window.cs.createAiImageJob({
      ...form,
      count: Number(form.count || 1),
      advanced: parseAdvancedJson(),
    })
    for (const asset of [mainImage.value, ...references.value].filter(Boolean)) {
      await window.cs.createAiImageAsset({ ...asset, job_uid: job.job_uid, source_type: 'local' })
    }
    const detail = await window.cs.runAiImageJob(job.job_uid, {})
    results.value = detail.assets?.filter(item => item.role === 'output') || []
    logs.value.push(`完成：${results.value.length} 张`)
  } catch (error) {
    logs.value.push(error?.message || '生成失败')
  } finally {
    running.value = false
  }
}

function parseAdvancedJson() {
  const text = String(form.advanced || '').trim()
  if (!text) return {}
  return JSON.parse(text)
}

onMounted(loadSettings)
```

Keep the existing dark layout tokens from the shell and implement the方案 3 visual anchor: top parameter ribbon for model/size/quality/format/count/output folder/key status, left Prompt/material panel with fixed generate footer, central batch result grid with toolbar, and a right history drawer. Use `workspaceMode` for switching result/canvas/log work modes later; do not render the old bottom `结果/画布/日志` tab strip. Do not add or display the global left sidebar inside this component.

- [ ] **Step 5: Add batch save-as action**

In `AiImageWorkbench.vue`, add:

```js
async function saveSelectedAs() {
  const asset_uids = Array.from(selectedAssetUids.value)
  if (!asset_uids.length) return
  const targetDir = await window.cs.browseFile({ directory: true, title: '选择另存为目录' })
  if (!targetDir) return
  await window.cs.saveAsAiImageJob(results.value[0]?.job_uid || '', { asset_uids, target_dir: targetDir })
}
```

Render a checkbox for each result and a `另存为选中` button in the result toolbar.

- [ ] **Step 6: Run renderer tests and commit**

Run:

```bash
cd app
node --test src/renderer/utils/aiImageModels.test.js
npm test
cd ..
node --test tests/ai-image-workbench-navigation.test.js tests/ai-image-ipc-bridge.test.js
```

Expected: all pass.

Commit:

```bash
git add app/src/renderer/utils/aiImageModels.js app/src/renderer/utils/aiImageModels.test.js app/src/renderer/views/AiImageWorkbench.vue
git commit -m "feat(ai-image): build workbench UI"
```

## Task 8: Lightweight Canvas Tab

**Files:**
- Create: `app/src/renderer/utils/aiImageCanvas.js`
- Create: `app/src/renderer/utils/aiImageCanvas.test.js`
- Modify: `app/src/renderer/views/AiImageWorkbench.vue`

- [ ] **Step 1: Write failing canvas utility tests**

Create `app/src/renderer/utils/aiImageCanvas.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasDocument, insertImageNode, selectedNodesAsReferences } from './aiImageCanvas.js'

test('canvas document starts with empty nodes', () => {
  assert.deepEqual(createCanvasDocument(), { version: 1, nodes: [], selectedNodeIds: [] })
})

test('insertImageNode appends image node with stable role', () => {
  const doc = createCanvasDocument()
  const next = insertImageNode(doc, { asset_uid: 'a1', local_path: '/tmp/a.png' }, { x: 10, y: 20, role: 'reference' })

  assert.equal(next.nodes[0].asset_uid, 'a1')
  assert.equal(next.nodes[0].role, 'reference')
  assert.equal(next.nodes[0].x, 10)
})

test('selectedNodesAsReferences keeps selected image order', () => {
  const doc = {
    version: 1,
    selectedNodeIds: ['n2'],
    nodes: [
      { id: 'n1', asset_uid: 'a1', local_path: '/tmp/a.png', role: 'output' },
      { id: 'n2', asset_uid: 'a2', local_path: '/tmp/b.png', role: 'reference' },
    ],
  }

  assert.deepEqual(selectedNodesAsReferences(doc), [{ role: 'reference', local_path: '/tmp/b.png', asset_uid: 'a2', sort_order: 0 }])
})
```

- [ ] **Step 2: Run canvas tests and verify they fail**

Run:

```bash
cd app
node --test src/renderer/utils/aiImageCanvas.test.js
```

Expected: fails because the canvas utility file does not exist.

- [ ] **Step 3: Add canvas utility**

Create `app/src/renderer/utils/aiImageCanvas.js`:

```js
export function createCanvasDocument() {
  return { version: 1, nodes: [], selectedNodeIds: [] }
}

export function insertImageNode(document, asset, options = {}) {
  const doc = {
    version: Number(document?.version || 1),
    nodes: Array.isArray(document?.nodes) ? [...document.nodes] : [],
    selectedNodeIds: Array.isArray(document?.selectedNodeIds) ? [...document.selectedNodeIds] : [],
  }
  const id = options.id || `node_${Date.now()}_${doc.nodes.length + 1}`
  doc.nodes.push({
    id,
    type: 'image',
    asset_uid: asset?.asset_uid || '',
    local_path: asset?.local_path || '',
    role: options.role || 'output',
    x: Number(options.x || 0),
    y: Number(options.y || 0),
    width: Number(options.width || 220),
    height: Number(options.height || 220),
  })
  return doc
}

export function selectedNodesAsReferences(document) {
  const selected = new Set(Array.isArray(document?.selectedNodeIds) ? document.selectedNodeIds : [])
  return (Array.isArray(document?.nodes) ? document.nodes : [])
    .filter(node => selected.has(node.id) && node.local_path)
    .map((node, index) => ({
      role: node.role === 'main' ? 'main' : 'reference',
      local_path: node.local_path,
      asset_uid: node.asset_uid || '',
      sort_order: index,
    }))
}
```

- [ ] **Step 4: Wire canvas tab into workbench**

In `AiImageWorkbench.vue`, import and use the helpers:

```js
import { createCanvasDocument, insertImageNode, selectedNodesAsReferences } from '../utils/aiImageCanvas'

const canvasDoc = ref(createCanvasDocument())

function sendResultToCanvas(asset) {
  canvasDoc.value = insertImageNode(canvasDoc.value, asset, { role: 'output' })
  workspaceMode.value = 'canvas'
}

function useCanvasSelectionAsReferences() {
  references.value = selectedNodesAsReferences(canvasDoc.value)
}
```

Render the canvas mode as a light board:

```vue
<div v-if="workspaceMode === 'canvas'" class="aiw-canvas-board">
  <button type="button" class="btn-ghost" @click="useCanvasSelectionAsReferences">选中节点设为参考图</button>
  <div
    v-for="node in canvasDoc.nodes"
    :key="node.id"
    class="aiw-canvas-node"
    :style="{ left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px`, height: `${node.height}px` }"
  >
    <img :src="node.local_path" alt="" />
  </div>
</div>
```

- [ ] **Step 5: Run canvas tests and commit**

Run:

```bash
cd app
node --test src/renderer/utils/aiImageCanvas.test.js src/renderer/utils/aiImageModels.test.js
npm test
```

Expected: all pass.

Commit:

```bash
git add app/src/renderer/utils/aiImageCanvas.js app/src/renderer/utils/aiImageCanvas.test.js app/src/renderer/views/AiImageWorkbench.vue
git commit -m "feat(ai-image): add lightweight canvas workflow"
```

## Task 9: End-To-End Validation And Documentation Check

**Files:**
- Modify only if validation reveals a concrete defect in files touched above.

- [ ] **Step 1: Run focused Python tests**

Run:

```bash
python -m unittest \
  tests.test_ai_settings_config \
  tests.test_ai_image_data_sink \
  tests.test_ai_image_service \
  tests.test_ai_image_api \
  tests.test_one_xm_image_client \
  -v
```

Expected: all pass.

- [ ] **Step 2: Run focused Node tests**

Run:

```bash
node --test \
  tests/ai-image-workbench-navigation.test.js \
  tests/ai-image-ipc-bridge.test.js
cd app
node --test \
  src/renderer/utils/aiImageModels.test.js \
  src/renderer/utils/aiImageCanvas.test.js
npm test
```

Expected: all pass.

- [ ] **Step 3: Run build check**

Run:

```bash
cd /Users/xingyicheng/Documents/crawshrimp/app
npm run vite:build
```

Expected: Vite build completes without Vue template or import errors.

- [ ] **Step 4: Start local development app**

Run the existing harness or app dev command used for this repo:

```bash
cd /Users/xingyicheng/Documents/crawshrimp
python scripts/crawshrimp_dev_harness.py
```

Then open the renderer at the reported local URL, usually:

```text
http://127.0.0.1:5173
```

Expected manual checks:

1. Entering `AI 生图` hides the global left sidebar and shows the full-width focus workbench.
2. `AI 生图` subtitle is `支持主图、参考图、Prompt、自定义尺寸和多模型生成`.
3. The screen matches the方案 3 visual anchor: top parameter ribbon, left Prompt/material panel, central batch result grid, and right history drawer.
4. The parameter ribbon contains model, size, quality, format, count, output folder, key status, and Windows-compatible folder path.
5. Missing model key shows `去设置 1XM Key`.
6. Clicking `去设置 1XM Key` opens Settings and focuses `1XM 图片模型`.
7. Settings can save GPT Image 2 2K/4K keys and the two Gemini keys separately.
8. Browser dev mode can create a draft job without real 1XM call when key is absent.

- [ ] **Step 5: Run diff hygiene checks**

Run:

```bash
git diff --check
rg -n "1XM GPT-Image-2</h3>" app/src/renderer/views/SettingsPage.vue
rg -n "本次输出|三栏" docs/superpowers/specs/2026-07-02-ai-image-workbench-design.md
```

Expected:

- `git diff --check` has no output.
- The first `rg` command has no output.
- The second `rg` command has no matches except lines that explicitly say `本次输出` is canceled.

- [ ] **Step 6: Final commit**

Commit the final validation adjustments. Stage only files changed by this plan and keep unrelated dirty files out of the commit:

```bash
git status --short
git add docs/superpowers/plans/2026-07-03-ai-image-workbench.md
git commit -m "feat(ai-image): add general image generation workbench"
```

## Execution Notes

- Keep unrelated existing worktree files out of staging: `adapters/tmall-ops-assistant/tmall-packaging-upload.js`, `tests/tmall-ops-assistant-packaging-upload.test.js`, `.crawshrimp-dev/`, and temporary CSV files should not be included unless the user explicitly expands scope.
- Do not log API keys, full data URLs, or local image binary content.
- Do not route this feature through `task_instances`; only use `ai_image_jobs`, `ai_image_assets`, and `ai_image_canvases`.
- Keep the Cowart/tldraw idea isolated to the lightweight canvas data contract in V1. The first shippable value is the generation workbench and local asset loop.

## Self-Review Result

- Spec coverage: Tasks 1-8 cover the independent AI image workbench entry, no-global-sidebar focus mode,方案 3 visual anchor, confirmed subtitle, Settings keys, missing-key jump, Windows-compatible default output folder, standalone SQLite tables, 1XM `/images/tasks` execution, local save-as, history-ready jobs/assets, and lightweight canvas workflow.
- Execution safety: Every commit step stages exact files or the plan file only; unrelated current worktree files are explicitly excluded.
- Type consistency: The plan uses the same names across backend, IPC, and renderer: `job_uid`, `asset_uid`, `canvas_uid`, `ai_image_jobs`, `ai_image_assets`, `ai_image_canvases`, `listAiImageJobs`, `createAiImageJob`, `runAiImageJob`, and `saveAsAiImageJob`.
- Validation scope: Python tests, Node tests, Vite build, and manual browser/Electron checks are all included.
