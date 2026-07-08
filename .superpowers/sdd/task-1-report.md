状态: DONE

改动文件:
- core/config.py
- tests/test_ai_settings_config.py
- app/src/renderer/App.vue
- app/src/renderer/views/SettingsPage.vue
- app/src/renderer/views/AiImageWorkbench.vue
- tests/ai-image-workbench-navigation.test.js

红灯测试失败摘要:
- `python -m unittest tests.test_ai_settings_config -v`: 先失败于 `KeyError: 'gemini_3_1_flash_image_preview_key'`，确认默认 1XM Gemini key 未实现。
- `node --test tests/ai-image-workbench-navigation.test.js`: 先失败于 AI image route 缺失、AI image focus sidebar 条件缺失、Settings focus/Gemini 字段缺失、`AiImageWorkbench.vue` 文件不存在。

绿灯验证命令和结果:
- `python -m unittest tests.test_ai_settings_config -v`: PASS, 3 tests.
- `node --test tests/ai-image-workbench-navigation.test.js`: PASS, 4 tests.
- `cd app && npm test`: PASS, 69 tests. Existing Node `MODULE_TYPELESS_PACKAGE_JSON` warnings appeared for neighboring ESM-style tests.

commit hash:
- f3ac0bf804263c8af32acc32ea2035425d1edc23

自审说明:
- 只修改和提交了 brief 指定的 6 个 Task 1 文件。
- 新增 `ai_image` route 位于 `任务中心` 后、`数据文件` 前，并在该 view 隐藏全局 sidebar。
- Settings 支持 `focusPanelId`，工作台 `去设置 1XM Key` 进入 `ai-1xm` 面板。
- 1XM 设置面板从旧 GPT-Image-2 命名改为 `1XM 图片模型`，并纳入两组 Gemini key 保存字段。
- `AiImageWorkbench.vue` 仅实现本地工作台壳，不接入 Task 2+ 的生成执行链路。

concerns:
- `cd app && npm test` 中的 `MODULE_TYPELESS_PACKAGE_JSON` 警告为既有测试风格提示，本次未改 `package.json`。
- `.crawshrimp-runtime/`、`cloud/approval-workbench/.wrangler/`、`docs/superpowers/...` 保持未暂存，符合 brief。

reviewer fix:
- Important finding: `AiImageWorkbench.vue` subtitle must exactly include `支持主图、参考图、Prompt、自定义尺寸和多模型生成`, default output folder examples must include `~/Downloads/抓虾导出/AI生图` and `%USERPROFILE%\Downloads\抓虾导出\AI生图`, and the static navigation test must assert those exact strings.
- TDD red: after adding the exact string assertions to `tests/ai-image-workbench-navigation.test.js`, `node --test tests/ai-image-workbench-navigation.test.js` failed on missing subtitle copy.
- TDD green: updated `app/src/renderer/views/AiImageWorkbench.vue` to use the exact subtitle and default output folder examples. `node --test tests/ai-image-workbench-navigation.test.js` passed, 4 tests.
- Regression: `cd app && npm test` passed, 69 tests. Existing Node `MODULE_TYPELESS_PACKAGE_JSON` warnings appeared for neighboring ESM-style tests.
