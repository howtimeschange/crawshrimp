# 我的脚本收藏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Persist a user's script favorites in the core service and render them first in a single-page, two-section script list.

**Architecture:** A focused Python module owns the adapter_id to ISO-8601 UTC timestamp map in the core-service data-root config. FastAPI validates adapters and exposes the map; Electron and browser development relay the same contract. The renderer derives its two non-overlapping sections with a pure utility.

**Tech Stack:** Python/FastAPI, JSON config persistence, Electron IPC/preload, Vue 3, Node node:test.

## Global Constraints

- Favorites persist in core-service config.json; never use localStorage.
- The page is a single scrollable view: 我的收藏 first, then 全部脚本; no tabs.
- A card appears in exactly one section. Favorites sort by newest time first; ordinary cards retain backend order.
- A star click must not open its card.
- Preserve concurrent, unrelated changes in TaskRunner.vue, taskProgress.test.js, and any file not named in a task.

---

### Task 1: Add favorites persistence

**Files:**
- Create: core/script_favorites.py
- Modify: core/config.py
- Test: tests/test_script_favorites.py

**Interfaces:**
- Consumes: core.config.load_config() and core.config.patch_config(patch).
- Produces: list_favorites(), favorite(adapter_id, now=None), and unfavorite(adapter_id).

- [ ] **Step 1: Write the failing test**

~~~python
def test_favorite_persists_a_utc_timestamp_and_loads_after_a_new_read(self):
    with isolated_config_path() as config_path:
        saved = script_favorites.favorite("tmall-ops", now=datetime(2026, 7, 17, 9, 0, tzinfo=timezone.utc))
        self.assertEqual(saved, {"tmall-ops": "2026-07-17T09:00:00+00:00"})
        self.assertEqual(json.loads(config_path.read_text(encoding="utf-8"))["script_favorites"], saved)
        self.assertEqual(script_favorites.list_favorites(), saved)

def test_unfavorite_removes_only_the_requested_adapter(self):
    with isolated_config_path():
        save_config({"script_favorites": {"tmall": "2026-07-17T09:00:00+00:00", "shopee": "2026-07-17T10:00:00+00:00"}})
        self.assertEqual(script_favorites.unfavorite("tmall"), {"shopee": "2026-07-17T10:00:00+00:00"})

def test_list_favorites_discards_invalid_entries_without_losing_valid_entries(self):
    with isolated_config_path():
        save_config({"script_favorites": {"valid": "2026-07-17T09:00:00+00:00", "bad-date": "never", "bad-key": 3}})
        self.assertEqual(script_favorites.list_favorites(), {"valid": "2026-07-17T09:00:00+00:00"})
~~~

- [ ] **Step 2: Verify RED**

Run: python3 -m unittest tests.test_script_favorites -v

Expected: FAIL with ModuleNotFoundError: No module named core.script_favorites.

- [ ] **Step 3: Implement the minimum persistence contract**

Add "script_favorites": {} to DEFAULT_CONFIG. Create core/script_favorites.py:

~~~python
from datetime import datetime, timezone
from core.config import load_config, patch_config

def _normalize(raw):
    if not isinstance(raw, dict):
        return {}
    normalized = {}
    for adapter_id, value in raw.items():
        key, timestamp = str(adapter_id or "").strip(), str(value or "").strip()
        if not key or not timestamp:
            continue
        try:
            datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        except ValueError:
            continue
        normalized[key] = timestamp
    return normalized

def list_favorites():
    return _normalize(load_config().get("script_favorites"))

def favorite(adapter_id, now=None):
    favorites = list_favorites()
    favorites[str(adapter_id).strip()] = (now or datetime.now(timezone.utc)).isoformat()
    patch_config({"script_favorites": favorites})
    return favorites

def unfavorite(adapter_id):
    favorites = list_favorites()
    favorites.pop(str(adapter_id or "").strip(), None)
    patch_config({"script_favorites": favorites})
    return favorites
~~~

- [ ] **Step 4: Verify GREEN**

Run: python3 -m unittest tests.test_script_favorites -v

Expected: PASS with all persistence tests.

- [ ] **Step 5: Commit**

~~~bash
git add core/config.py core/script_favorites.py tests/test_script_favorites.py
git commit -m "feat: persist script favorites"
~~~

### Task 2: Add validated core-service endpoints

**Files:**
- Modify: core/api_server.py
- Test: tests/test_script_favorites_api.py

**Interfaces:**
- Consumes: Task 1 functions and adapter_loader.get_adapter(adapter_id).
- Produces: GET /script-favorites, PUT /script-favorites/{adapter_id}, and DELETE /script-favorites/{adapter_id}.

- [ ] **Step 1: Write the failing API test**

~~~python
def test_favorite_routes_return_the_saved_map_for_an_installed_adapter(self):
    with patch("core.api_server.adapter_loader.get_adapter", return_value=object()), \
         patch("core.api_server.script_favorites.list_favorites", return_value={}), \
         patch("core.api_server.script_favorites.favorite", return_value={"tmall": "2026-07-17T09:00:00+00:00"}) as favorite:
        self.assertEqual(api_server.get_script_favorites(), {"favorites": {}})
        self.assertEqual(api_server.favorite_script("tmall"), {"favorites": {"tmall": "2026-07-17T09:00:00+00:00"}})
    favorite.assert_called_once_with("tmall")

def test_favoriting_an_unknown_adapter_returns_404_without_writing(self):
    with patch("core.api_server.adapter_loader.get_adapter", return_value=None), \
         patch("core.api_server.script_favorites.favorite") as favorite:
        with self.assertRaises(api_server.HTTPException) as raised:
            api_server.favorite_script("missing")
    self.assertEqual(raised.exception.status_code, 404)
    favorite.assert_not_called()

def test_uninstall_removes_its_favorite(self):
    with patch("core.api_server.adapter_loader.get_adapter", return_value=object()), \
         patch("core.api_server.sched_module.unregister_adapter"), \
         patch("core.api_server.adapter_loader.uninstall"), \
         patch("core.api_server.script_favorites.unfavorite") as unfavorite:
        self.assertEqual(api_server.uninstall_adapter("tmall"), {"ok": True})
    unfavorite.assert_called_once_with("tmall")
~~~

- [ ] **Step 2: Verify RED**

Run: python3 -m unittest tests.test_script_favorites_api -v

Expected: FAIL because favorite route functions are missing.

- [ ] **Step 3: Implement routes and uninstall cleanup**

Import from core import script_favorites. Add this immediately before the adapters route section:

~~~python
@app.get("/script-favorites")
def get_script_favorites():
    return {"favorites": script_favorites.list_favorites()}

@app.put("/script-favorites/{adapter_id}")
def favorite_script(adapter_id: str):
    if not adapter_loader.get_adapter(adapter_id):
        raise HTTPException(404, "Adapter not found: " + adapter_id)
    return {"favorites": script_favorites.favorite(adapter_id)}

@app.delete("/script-favorites/{adapter_id}")
def unfavorite_script(adapter_id: str):
    if not adapter_loader.get_adapter(adapter_id):
        raise HTTPException(404, "Adapter not found: " + adapter_id)
    return {"favorites": script_favorites.unfavorite(adapter_id)}
~~~

In uninstall_adapter, call script_favorites.unfavorite(adapter_id) after adapter_loader.uninstall(adapter_id) and before the response.

- [ ] **Step 4: Verify GREEN**

Run: python3 -m unittest tests.test_script_favorites_api -v

Expected: PASS with all API tests.

- [ ] **Step 5: Commit**

~~~bash
git add core/api_server.py tests/test_script_favorites_api.py
git commit -m "feat: expose script favorites API"
~~~

### Task 3: Relay the contract to Electron and browser development

**Files:**
- Modify: app/src/main.js
- Modify: app/src/preload.js
- Modify: app/src/renderer/utils/devCsBridge.js
- Test: tests/script-favorites-bridge.test.js

**Interfaces:**
- Consumes: Task 2 endpoints.
- Produces: window.cs.getScriptFavorites(), favoriteScript(id), and unfavoriteScript(id).

- [ ] **Step 1: Write the failing bridge test**

~~~javascript
test('Electron and browser-development bridges expose matching favorite methods', () => {
  assert.match(read('app/src/main.js'), /secureHandle\('get-script-favorites'/)
  assert.match(read('app/src/main.js'), /secureHandle\('favorite-script'/)
  assert.match(read('app/src/preload.js'), /getScriptFavorites:\s*\(\) => ipcRenderer\.invoke\('get-script-favorites'\)/)
  assert.match(read('app/src/preload.js'), /favoriteScript:\s*\(id\) => ipcRenderer\.invoke\('favorite-script', id\)/)
  assert.match(read('app/src/renderer/utils/devCsBridge.js'), /getScriptFavorites:\s*\(\) => apiCall\('GET', '\/script-favorites'\)/)
  assert.match(read('app/src/renderer/utils/devCsBridge.js'), /favoriteScript:\s*\(id\) => apiCall\('PUT'/)
})
~~~

- [ ] **Step 2: Verify RED**

Run: node --test tests/script-favorites-bridge.test.js

Expected: FAIL because no favorite bridge methods exist.

- [ ] **Step 3: Implement forwarding methods**

Add beside adapter handlers in app/src/main.js:

~~~javascript
secureHandle('get-script-favorites', async () => apiCall('GET', '/script-favorites'))
secureHandle('favorite-script', async (_, id) => apiCall('PUT', '/script-favorites/' + id))
secureHandle('unfavorite-script', async (_, id) => apiCall('DELETE', '/script-favorites/' + id))
~~~

Add beside getAdapters in app/src/preload.js:

~~~javascript
getScriptFavorites: () => ipcRenderer.invoke('get-script-favorites'),
favoriteScript: (id) => ipcRenderer.invoke('favorite-script', id),
unfavoriteScript: (id) => ipcRenderer.invoke('unfavorite-script', id),
~~~

Add beside development adapter methods in devCsBridge.js:

~~~javascript
getScriptFavorites: () => apiCall('GET', '/script-favorites'),
favoriteScript: (id) => apiCall('PUT', '/script-favorites/' + encodePathPart(id)),
unfavoriteScript: (id) => apiCall('DELETE', '/script-favorites/' + encodePathPart(id)),
~~~

- [ ] **Step 4: Verify GREEN**

Run: node --test tests/script-favorites-bridge.test.js

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add app/src/main.js app/src/preload.js app/src/renderer/utils/devCsBridge.js tests/script-favorites-bridge.test.js
git commit -m "feat: bridge script favorites"
~~~

### Task 4: Create deterministic UI partitioning

**Files:**
- Create: app/src/renderer/utils/scriptFavorites.js
- Create: app/src/renderer/utils/scriptFavorites.test.js

**Interfaces:**
- Consumes: groups Array and favorites object.
- Produces: partitionScriptGroups(groups, favorites) returning favorites and scripts arrays.

- [ ] **Step 1: Write the failing sorting test**

~~~javascript
test('partitions favorites newest-first and retains normal source order', () => {
  const groups = [{ adapter_id: 'first' }, { adapter_id: 'old' }, { adapter_id: 'middle' }, { adapter_id: 'new' }]
  const result = partitionScriptGroups(groups, { old: '2026-07-17T09:00:00+00:00', new: '2026-07-17T10:00:00+00:00' })
  assert.deepEqual(result.favorites.map(({ adapter_id }) => adapter_id), ['new', 'old'])
  assert.deepEqual(result.scripts.map(({ adapter_id }) => adapter_id), ['first', 'middle'])
})

test('uses stable original order for invalid favorite time', () => {
  const result = partitionScriptGroups([{ adapter_id: 'first' }, { adapter_id: 'second' }], { first: 'invalid', second: 'invalid' })
  assert.deepEqual(result.favorites.map(({ adapter_id }) => adapter_id), ['first', 'second'])
})
~~~

- [ ] **Step 2: Verify RED**

Run: cd app && node --test src/renderer/utils/scriptFavorites.test.js

Expected: FAIL with module-not-found for scriptFavorites.js.

- [ ] **Step 3: Implement the partition function**

~~~javascript
function favoriteTime(value) {
  const time = Date.parse(String(value || ''))
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY
}

export function partitionScriptGroups(groups = [], favorites = {}) {
  const all = (Array.isArray(groups) ? groups : []).map((group, index) => ({ group, index }))
  const hasFavorite = group => Object.prototype.hasOwnProperty.call(favorites || {}, group && group.adapter_id)
  const favoriteRecords = all.filter(({ group }) => hasFavorite(group))
  favoriteRecords.sort((left, right) =>
    favoriteTime(favorites[right.group.adapter_id]) - favoriteTime(favorites[left.group.adapter_id]) || left.index - right.index)
  return {
    favorites: favoriteRecords.map(({ group }) => group),
    scripts: all.filter(({ group }) => !hasFavorite(group)).map(({ group }) => group),
  }
}
~~~

- [ ] **Step 4: Verify GREEN**

Run: cd app && node --test src/renderer/utils/scriptFavorites.test.js

Expected: PASS with 2 tests.

- [ ] **Step 5: Commit**

~~~bash
git add app/src/renderer/utils/scriptFavorites.js app/src/renderer/utils/scriptFavorites.test.js
git commit -m "feat: sort script favorites"
~~~

### Task 5: Render the one-page favorite section and star action

**Files:**
- Modify: app/src/renderer/views/ScriptList.vue
- Test: app/src/renderer/utils/scriptFavorites.test.js

**Interfaces:**
- Consumes: Task 3 bridge methods and Task 4 partition function.
- Produces: a nonempty 我的收藏 section, 全部脚本 section, and a disabled-while-saving star with aria-pressed.

- [ ] **Step 1: Add a failing page source contract test**

~~~javascript
test('script list is a single-page favorite-first layout with an isolated star action', () => {
  const source = readFileSync(new URL('../views/ScriptList.vue', import.meta.url), 'utf8')
  assert.match(source, /我的收藏/)
  assert.match(source, /全部脚本/)
  assert.match(source, /@click\.stop="toggleFavorite\(entry\.group\.adapter_id\)"/)
  assert.match(source, /:aria-pressed="isFavorite\(entry\.group\.adapter_id\)"/)
  assert.match(source, /window\.cs\.getScriptFavorites\(\)/)
  assert.match(source, /window\.cs\.favoriteScript\(adapterId\)/)
  assert.match(source, /window\.cs\.unfavoriteScript\(adapterId\)/)
})
~~~

- [ ] **Step 2: Verify RED**

Run: cd app && node --test src/renderer/utils/scriptFavorites.test.js

Expected: FAIL because page sections and favorite calls do not exist.

- [ ] **Step 3: Implement page state and interaction**

Import partitionScriptGroups. Add favorites, favoriteError, and favoritePendingIds refs. Derive favorite and normal groups, then map both through the existing preview and progress mapper to preserve card behavior.

~~~javascript
async function loadFavorites({ quiet = false } = {}) {
  try {
    const response = await window.cs.getScriptFavorites()
    favorites.value = response && typeof response.favorites === 'object' ? response.favorites : {}
    if (!quiet) favoriteError.value = ''
  } catch (error) {
    if (!quiet) favoriteError.value = error && error.message || '收藏列表加载失败，请稍后重试'
  }
}

function isFavorite(adapterId) {
  return Object.prototype.hasOwnProperty.call(favorites.value, adapterId)
}

async function toggleFavorite(adapterId) {
  if (favoritePendingIds.value.has(adapterId)) return
  favoritePendingIds.value = new Set(favoritePendingIds.value).add(adapterId)
  try {
    const response = isFavorite(adapterId)
      ? await window.cs.unfavoriteScript(adapterId)
      : await window.cs.favoriteScript(adapterId)
    favorites.value = response && typeof response.favorites === 'object' ? response.favorites : favorites.value
    favoriteError.value = ''
  } catch (error) {
    favoriteError.value = error && error.message || '收藏操作失败，请重试'
  } finally {
    const next = new Set(favoritePendingIds.value)
    next.delete(adapterId)
    favoritePendingIds.value = next
  }
}
~~~

Call loadFavorites beside initial and quiet script group loads without allowing a favorite-read failure to hide scripts. Loop the existing card markup under a sections computed value so the markup is not duplicated. Render 我的收藏 only when nonempty, followed by 全部脚本. Add this button before the version pill:

~~~html
<button class="favorite-btn" type="button"
  :class="{ active: isFavorite(entry.group.adapter_id) }"
  :aria-label="isFavorite(entry.group.adapter_id) ? '取消收藏 ' + entry.group.adapter_name : '收藏 ' + entry.group.adapter_name"
  :aria-pressed="isFavorite(entry.group.adapter_id)"
  :disabled="favoritePendingIds.has(entry.group.adapter_id)"
  @click.stop="toggleFavorite(entry.group.adapter_id)">
  {{ isFavorite(entry.group.adapter_id) ? '★' : '☆' }}
</button>
~~~

Add scoped styles for section heading, a scrollable section wrapper, orange active star, and enough right padding so star/version do not overlap. Render favoriteError above the sections with role=status and retain loaded cards.

- [ ] **Step 4: Verify GREEN**

Run: cd app && node --test src/renderer/utils/scriptFavorites.test.js

Expected: PASS with sorting and page-contract tests.

- [ ] **Step 5: Commit**

~~~bash
git add app/src/renderer/views/ScriptList.vue app/src/renderer/utils/scriptFavorites.test.js
git commit -m "feat: add script favorites page"
~~~

### Task 6: Validate the full flow

**Files:**
- Modify: no production files expected.

**Interfaces:**
- Consumes: the complete favorites implementation.
- Produces: fresh test, build, and live Electron evidence.

- [ ] **Step 1: Run targeted tests**

~~~bash
python3 -m unittest tests.test_script_favorites tests.test_script_favorites_api -v
cd app && node --test src/renderer/utils/scriptFavorites.test.js ../tests/script-favorites-bridge.test.js
~~~

Expected: all targeted tests PASS.

- [ ] **Step 2: Run package regression checks**

~~~bash
cd app && npm test && npm run vite:build
~~~

Expected: both commands exit 0.

- [ ] **Step 3: Verify the real Electron shell**

Run: cd app && npm run dev

Check: one scrollable page, no tabs; star does not open its card; the last newly favorited card is first; unstarred cards return once to 全部脚本; fully quit/reopen Electron and confirm a remaining favorite persists.

- [ ] **Step 4: Commit the finished feature**

~~~bash
git status --short
git add core/config.py core/script_favorites.py core/api_server.py tests/test_script_favorites.py tests/test_script_favorites_api.py tests/script-favorites-bridge.test.js app/src/main.js app/src/preload.js app/src/renderer/utils/devCsBridge.js app/src/renderer/utils/scriptFavorites.js app/src/renderer/utils/scriptFavorites.test.js app/src/renderer/views/ScriptList.vue
git commit -m "feat: add persistent script favorites"
~~~
