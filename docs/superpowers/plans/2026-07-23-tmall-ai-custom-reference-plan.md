# 天猫 AI 生图款号参考图池实施计划

**规格：** `docs/superpowers/specs/2026-07-23-tmall-ai-custom-reference-design.md`

**执行分支：** `codex/tmall-ai-custom-reference`

**执行方式：** 当前会话内执行，不使用子代理；所有行为变更遵循测试先行。

## 范围校准

现有 `bd394e61` 已经提供第二步确认看板、本地多图导入、逐 Prompt 选图、批量重生已舍弃图片、任务中心实例化、明显审批角标和 macOS/Windows 原生通知。本计划在这些能力上增量实现，不重复建设已有功能。

本轮必须补齐：

1. `direct_create` 也必须进入第二步，由审批批次保存整批执行模式。
2. 用户上传的自定义参考图按款号隔离，并默认绑定名称包含“创意拍”或“组合拍”的 Prompt。
3. Prompt 显示明确的查看明细、修改本次和重新选择入口，并保留原始快照。
4. 云端 Prompt 库选择控件以已选名称作为主值回显。
5. 自动模式生图完成后真实调用测试任务创建；失败不得显示为成功。
6. 审批批次保存 Prompt 库名称、来源、执行模式和分阶段状态。
7. 系统通知点击后能把操作目标发送回渲染进程。

## Task 1：建立干净基线

**验证：**

- 安装或复用 `app` 依赖。
- 运行：
  - `python3 -m unittest tests.test_tmall_ai_image_chain_script`
  - `node --test tests/task-center-navigation.test.js`
  - `cd app && npm test`

如果基线失败，先区分环境问题和既有回归，不在未知基线上继续修改。

## Task 2：审批批次契约与执行模式

**修改文件：**

- `tests/test_tmall_ai_image_chain_script.py`
- `adapters/tmall-ops-assistant/tools/run_tmall_ai_image_test_chain.py`
- `core/api_server.py`

**RED：**

1. 修改执行模式测试，要求 `approval_then_create` 和 `direct_create` 都返回 `confirm_generation=true`、`generate=false`。
2. 新增批次快照测试，要求顶层保存：
   - `schema_version`
   - `execution_mode`
   - `cloud_prompt_library.id/name/source`
   - `generation_status`
   - `approval_status`
   - `test_task_status`
3. 新增第二步更新测试，要求执行模式写入顶层和 `run_params.execute_mode`。

**GREEN：**

- 调整 `normalize_chain_execution_mode()`。
- 在 `write_approval_batch()` / `write_generation_confirmation_batch()` 中建立兼容快照。
- 扩展确认提交请求和 `update_generation_confirmation()`，持久化整批模式。
- 旧批次缺失字段时继续按旧字段读取。

**验证：**

- 运行新增的 Python 测试。
- 运行完整 `tests.test_tmall_ai_image_chain_script`。

## Task 3：款号自定义参考图池与自动绑定

**新增/修改文件：**

- `app/src/renderer/utils/tmallAiApproval.js`
- `app/src/renderer/utils/tmallAiApproval.test.js`
- `app/src/renderer/views/TmallAiApprovalDrawer.vue`
- `tests/task-center-navigation.test.js`

**RED：**

为纯函数新增测试：

1. Prompt 名称包含“创意拍”或“组合拍”时可自动绑定。
2. 不匹配名称时不自动绑定。
3. 同一款号的新自定义图只追加到自动绑定 Prompt。
4. `reference_binding_mode=manual` 时不覆盖人工选择。
5. 删除自定义图时从该款所有 Prompt 中解除。

**GREEN：**

- 抽取匹配、追加和解除的纯函数。
- 用户导入到款号参考图池的图片标记 `custom_upload=true`。
- 新上传图片自动应用到该款匹配 Prompt。
- 用户打开选图器并修改选择后，将该 Prompt 标记为人工绑定。
- 保存确认批次时传递 `custom_upload`、来源信息和绑定模式。
- 不提供跨款号应用操作。

**验证：**

- `cd app && node --test src/renderer/utils/tmallAiApproval.test.js`
- `node --test tests/task-center-navigation.test.js`

## Task 4：第二步执行模式、Prompt 明细与库回显

**修改文件：**

- `app/src/renderer/views/TaskRunner.vue`
- `app/src/renderer/views/TmallAiApprovalDrawer.vue`
- `tests/task-center-navigation.test.js`

**RED：**

新增结构与行为契约：

1. 第一阶段不再显示天猫 AI 链路的 `execute_mode`。
2. 第二步顶部存在整批执行模式单选。
3. 确认提交 payload 带 `execution_mode`。
4. Prompt 卡片具有“查看明细”“修改本次”“重新选择”。
5. 选择 Prompt 后保存来源和原始正文。
6. Prompt 库选择控件的主文案是选中名称，“更换 Prompt 库”作为操作文案。

**GREEN：**

- 隐藏第一步执行模式，但保留兼容默认值。
- 在第二步显示并保存执行模式。
- 增加 Prompt 明细弹窗和本批次编辑状态。
- 重新选择时更新来源快照，并保留人工参考图配置。
- 优化 Prompt 库选中后的主值、来源和模板数量回显。

**验证：**

- `node --test tests/task-center-navigation.test.js`
- `cd app && npm test`
- `cd app && npm run vite:build`

## Task 5：自动创建模式的真实任务创建

**修改文件：**

- `tests/test_tmall_ai_image_chain_script.py`
- `tests/test_task_instances_api.py`
- `adapters/tmall-ops-assistant/tools/run_tmall_ai_image_test_chain.py`
- `core/api_server.py`

**RED：**

1. 新增测试：自动模式生图成功后，AI 图被明确确认并进入真实上传创建。
2. 新增测试：测试任务创建失败时批次为 `create_failed` 或 `partial_failed`，任务实例不能是 `completed`。
3. 新增测试：已经有真实任务 ID 的结果不会因超时重试而重复创建。

**GREEN：**

- 增加自动模式审批选择辅助函数，只选择当前批次运行产生的 AI 图。
- 生图后台任务完成后，根据 `execution_mode` 分支：
  - 人工模式：进入 `pending_approval`。
  - 自动模式：自动确认生成图并调用 `upload_approved_tmall_batch()`。
- 统一任务实例的 `generation_status`、`approval_status` 和 `test_task_status`。
- 只有真实创建全部成功时才标记完成。

**验证：**

- 运行新增 Python 测试。
- 运行：
  - `python3 -m unittest tests.test_tmall_ai_image_chain_script`
  - `python3 -m unittest tests.test_task_instances_api`

## Task 6：通知点击目标

**修改文件：**

- `app/src/main.js`
- `app/src/preload.js`
- `app/src/renderer/views/TaskRunner.vue`
- `tests/task-center-navigation.test.js`

**RED：**

新增契约测试：

- 通知 payload 包含任务实例、批次和目标阶段。
- 点击原生通知后主进程发送 `operator-alert-open`。
- preload 暴露监听接口。
- TaskRunner 收到事件后切换到对应步骤并打开审批抽屉。

**GREEN：**

- 扩展现有 `show-operator-alert`，保留 macOS 横幅和 Windows Toast。
- 点击通知时聚焦窗口并发送目标。
- 渲染进程注册和清理监听器。

**验证：**

- `node --test tests/task-center-navigation.test.js`
- `cd app && npm test`

## Task 7：综合验证与真实界面检查

**自动化：**

- `python3 -m unittest tests.test_tmall_ai_image_chain_script tests.test_task_instances_api`
- `node --test tests/task-center-navigation.test.js tests/ai-image-workbench-navigation.test.js`
- `cd app && npm test`
- `cd app && npm run vite:build`

**真实界面：**

1. 启动后端、Vite 和 Electron。
2. 打开“巴拉-AI测图全链路”。
3. 验证 Prompt 库选中名称回显。
4. 验证两种模式都进入第二步。
5. 为一个款号上传多张自定义参考图，确认仅匹配 Prompt 默认绑定。
6. 验证查看明细、修改本次、重新选择和重新打开后的恢复。
7. 验证关闭第二步不停止后台任务。
8. 验证人工模式进入审批，自动模式进入真实创建状态。
9. 验证系统通知和点击定位。

真实天猫写入需要有效登录和业务环境；若当前环境不能安全完成外部写入，则以本地后台分支、真实 Electron 页面和自动化契约为本轮完成边界，并明确记录未执行项。

## Task 8：提交与交付

- 运行 `git diff --check`。
- 确认不包含主工作区的无关文件。
- 汇总变更、测试和真实验证证据。
- 创建独立本地 Git commit。
- 保留隔离分支和工作树，等待用户决定是否合并到 `main`。
