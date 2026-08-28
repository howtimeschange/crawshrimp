# 【服饰】整理深绘上新图包：吊牌/洗唛 AI 识别与裁图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 只在 `prepare_upload_package` 中实现可审计的 `yq1` 吊牌、`yq2` 洗唛短路、废图剔除、多尺码 110 优先、并发视觉识别和 800×800 白底裁图闭环。

**Architecture:** 浏览器适配器只收集候选并携带角色/款色提示；新的 Python 处理器负责验证现成 yq、并发调用 Terra/Luna、用 Sol 复核分歧、合并 PDF 页候选、执行尺码排序与本地裁图。`core/api_server.py` 只在 `task_id == "prepare_upload_package"` 的最终整理分支调用新处理器，其他任务继续走现有代码。

**Tech Stack:** JavaScript Node test runner、Python 3、PyMuPDF、Pillow、`concurrent.futures`、现有 `core.llm_gateway.generate_multimodal_json`、现有 `core.ocr_service`、pytest/unittest。

## Global Constraints

- 作用范围严格限定为 `【服饰】整理深绘上新图包`，task id 为 `prepare_upload_package`。
- 不修改 `batch_label_tile_download`、`pdf_batch_screenshot`、鞋品任务或其他适配器行为。
- `yq1` 是吊牌，`yq2` 是洗唛；现成 yq 仍必须通过废图、角色和款号门禁。
- 款号级 yq 短路整个款号对应角色；款色前缀 yq 只短路对应款色角色。
- 尺码顺序固定为 `110 -> 最近的大于 110 -> 最大的小尺码`。
- 手写纸占位、图片文字“无吊牌/无水洗”、错误款号和证据不足候选必须 fail-closed。
- Terra/Luna 对同一批页或图片并发初审；只有冲突候选调用 Sol，不得逐候选串行等待。
- 输出裁图等比缩放到 800×800 白底，不拉伸；模型只给语义和坐标，本地代码负责裁切与验收。
- 真实测试严格串行：`201426105102` 完全通过后才能运行 `202426107206`。
- 不保存用户提供的 API key，不 push、不发布、不发送外部消息；本轮实现完成前不创建新的代码 commit。

---

### Task 1: 浏览器候选元数据与 yq 作用域

**Files:**
- Modify: `adapters/shenhui-new-arrival/prepare-upload-package.js`
- Test: `tests/shenhui-new-arrival-prepare-upload-package.test.js`

**Interfaces:**
- Consumes: `classifySopAsset(sourceType, item)` 已返回 `yqKind` 和 `pdfType`。
- Produces: `rowForAsset(...)` 为后端提供 `__yq_kind: "hang_tag" | "wash_label" | ""`、`__style_color_code` 和原始 `__package_filename`。

- [ ] **Step 1: 写失败测试**

  在 JS 测试中构造 `yq1.jpg`、`202426107206-70013_yq2.jpg`、`yq20.jpg`，断言前两者分别携带 `hang_tag`、`wash_label`，最后一个不被误识别；断言 `rowForAsset` 生成的下载行保留 `__yq_kind` 和款色编码。

- [ ] **Step 2: 验证 RED**

  Run: `node --test tests/shenhui-new-arrival-prepare-upload-package.test.js`

  Expected: FAIL，提示结果行缺少 `__yq_kind` 或测试 helper 尚未导出 `rowForAsset`。

- [ ] **Step 3: 最小实现**

  `rowForAsset` 增加：

  ```js
  '__yq_kind': classification.yqKind || '',
  ```

  测试 helper 只读导出 `rowForAsset`；不改变下载计划和其他任务脚本。

- [ ] **Step 4: 验证 GREEN**

  Run: `node --test tests/shenhui-new-arrival-prepare-upload-package.test.js`

  Expected: 17 个测试全部 PASS。

### Task 2: 纯规则、候选模型和废图门禁

**Files:**
- Create: `core/shenhui_apparel_label_processing.py`
- Create: `tests/test_shenhui_apparel_label_processing.py`

**Interfaces:**
- Produces: `detect_yq_role(filename: str) -> str`。
- Produces: `extract_scope(style_code: str, row: Mapping, filename: str) -> tuple[str, str]`，返回款号和可选款色。
- Produces: `preferred_size(sizes: Iterable[str]) -> int | None`，忽略 `90-175` 这类范围，只取独立标签主尺码。
- Produces: `is_waste_path(value: str) -> bool`。
- Produces dataclass `LabelCandidate(kind, style_code, color_code, sizes, bbox, confidence, printed_label, handwritten_placeholder, negative_text, source_path, page_index, model_id)`。

- [ ] **Step 1: 写失败测试**

  覆盖 yq 变体边界、款号级/款色级 scope、废图路径词、错误款号、`[90,100,110,120] -> 110`、`[90,120,130] -> 120`、`[90,100] -> 100`、`["110/56","90-175"] -> 110`。

- [ ] **Step 2: 验证 RED**

  Run: `python3 -m pytest tests/test_shenhui_apparel_label_processing.py -q`

  Expected: collection FAIL，模块尚不存在。

- [ ] **Step 3: 最小实现**

  使用边界正则识别 yq；使用固定 waste marker tuple；尺码解析只接受 2–3 位独立主尺码或 `110/56` 左侧值，不把范围两端当候选。

- [ ] **Step 4: 验证 GREEN**

  Run: `python3 -m pytest tests/test_shenhui_apparel_label_processing.py -q`

  Expected: Task 2 全部 PASS。

### Task 3: 并发视觉初审、分歧复核与现成 yq 短路

**Files:**
- Modify: `core/shenhui_apparel_label_processing.py`
- Modify: `tests/test_shenhui_apparel_label_processing.py`

**Interfaces:**
- Produces: `review_inputs_concurrently(jobs, *, model_ids=("gpt-5.6-terra", "gpt-5.6-luna"), reviewer=default_reviewer, max_workers=8) -> dict[str, list[LabelCandidate]]`。
- Produces: `validate_existing_yq(row, path, style_code, *, reviews, sol_reviewer) -> ExistingYqDecision`。
- `default_reviewer` 调用 `llm_gateway.generate_multimodal_json(..., retry_same_model=False, timeout_seconds=90)`；仅传本地图片路径或 data URL，不传密钥。

- [ ] **Step 1: 写失败测试**

  用 barrier/fake reviewer 证明 Terra/Luna 同时开始，而不是串行；覆盖两票一致直接通过、角色与文件名冲突拒绝、款号冲突拒绝、手写占位拒绝、`无吊牌/无水洗` 拒绝、模型分歧只调用一次 Sol、模型不可用且无本地证据时 fail-closed。

- [ ] **Step 2: 验证 RED**

  Run: `python3 -m pytest tests/test_shenhui_apparel_label_processing.py -k 'concurrent or existing_yq or waste or disagreement' -q`

  Expected: FAIL，缺少并发审查和决策函数。

- [ ] **Step 3: 最小实现**

  使用一个 `ThreadPoolExecutor` 提交全部 `(input, model)` 组合；按 job id 回收。现成 yq 只有在两模型（或一模型 + Sol）一致确认 `printed_label=true`、非手写/非否定文本、角色和款号正确时建立锁；无款色前缀建立款号锁，有前缀只建立款色锁。

- [ ] **Step 4: 验证 GREEN**

  Run: `python3 -m pytest tests/test_shenhui_apparel_label_processing.py -k 'concurrent or existing_yq or waste or disagreement' -q`

  Expected: 全部 PASS，fake reviewer 记录最大同时执行数至少为 2。

### Task 4: PDF 页候选合并、多尺码选择和 800×800 裁图

**Files:**
- Modify: `core/shenhui_apparel_label_processing.py`
- Modify: `tests/test_shenhui_apparel_label_processing.py`

**Interfaces:**
- Produces: `render_pdf_pages(pdf_path: Path, work_dir: Path, *, zoom=2.0) -> list[RenderedPage]`。
- Produces: `merge_page_reviews(reviews, *, iou_threshold=0.75) -> list[LabelCandidate]`，同页 Terra/Luna 差异通过 IoU 合并，不记为跨页冲突。
- Produces: `select_candidates(candidates, style_code, missing_scopes) -> list[LabelCandidate]`，按 `(style, color, kind)` 分组并应用 110 排序。
- Produces: `crop_candidate_to_canvas(page_path: Path, bbox, output_path: Path, *, size=800) -> None`。
- Produces: `verify_crop(candidate, output_path, *, ocr_fn=recognize_image_with_tesseract_js) -> CropVerification`。

- [ ] **Step 1: 写失败测试**

  生成一张 6 单元横排测试页，Terra/Luna 返回轻微不同 bbox 和尺码字段，断言合并为 6 个而不是 12 个；断言同页差异不触发 Sol，跨页同款色候选按 110 排序；裁图为 RGB 800×800、四角白色、主体等比且完整；背面 Logo、空白框、框越界、错误款号 OCR 被拒绝。

- [ ] **Step 2: 验证 RED**

  Run: `python3 -m pytest tests/test_shenhui_apparel_label_processing.py -k 'page or size or crop or bbox' -q`

  Expected: FAIL，缺少页渲染/合并/裁图函数。

- [ ] **Step 3: 最小实现**

  PyMuPDF 逐页渲染；页级 prompt 要求 `kind/printed_label/handwritten_placeholder/negative_text/style_code/color_code/sizes/bbox/confidence`。IoU 配对后使用两框坐标中位值；Sol 只处理无法配对、角色/款号/色号/主尺码冲突的单元。裁框外扩 1.5%，限制在页内，按 `thumbnail((760,760))` 等比缩放并居中贴到 RGB 白底 800×800。

  OCR 可用时必须复核款号和选定尺码；OCR 不可用时，仅允许 Terra/Luna 两票一致且置信度均不低于 0.9 的 PDF 单元继续，否则 fail-closed。

- [ ] **Step 4: 验证 GREEN**

  Run: `python3 -m pytest tests/test_shenhui_apparel_label_processing.py -q`

  Expected: 新模块全部 PASS。

### Task 5: 仅接入 prepare_upload_package 最终整理分支

**Files:**
- Modify: `core/api_server.py`
- Modify: `tests/test_shenhui_new_arrival_packaging.py`
- Modify: `core/shenhui_apparel_label_processing.py`

**Interfaces:**
- Produces: `process_prepare_upload_package_labels(*, data_rows, package_root, pdf_rows, work_dir, run_params, log) -> ApparelLabelProcessingResult`。
- Result fields: `generated_count: int`、`accepted_existing: list[Path]`、`rejected_paths: list[Path]`、`missing_roles: list[str]`、`audit_rows: list[dict]`。
- API server calls it only inside `if task_id == "prepare_upload_package"` after ordinary files are arranged and before compression/zip.

- [ ] **Step 1: 写失败集成测试**

  Patch `core.api_server.process_prepare_upload_package_labels`，运行 `prepare_upload_package`、`batch_label_tile_download`、`pdf_batch_screenshot` 和 `prepare_shoe_upload_package`，断言只有第一个调用一次。覆盖有效现成 yq 跳过对应 PDF、只缺 yq1 时只处理 hang_tag PDF、无可靠候选时保留 PDF 到 `_PDF待裁图` 并写清晰备注。

- [ ] **Step 2: 验证 RED**

  Run: `python3 -m pytest tests/test_shenhui_new_arrival_packaging.py -k 'apparel_label or prepare_upload_package_label_boundary' -q`

  Expected: FAIL，新处理器尚未接入。

- [ ] **Step 3: 最小接入**

  替换 `prepare_upload_package` 分支内旧的固定框 `convert_pdf_rows_to_yq_output_root` 调用；保留通用函数供 `pdf_batch_screenshot` 使用。处理器追加审计字段：`标签角色`、`识别模型`、`识别款号`、`识别色号`、`识别尺码`、`标签判定`、`标签证据`、`最终裁图`；结果表 rewrite 将这些列和 `处理动作/下载结果/备注` 一并读回。

- [ ] **Step 4: 验证 GREEN 和边界回归**

  Run: `python3 -m pytest tests/test_shenhui_new_arrival_packaging.py tests/test_shenhui_pdf_screenshot.py -q`

  Expected: 全部 PASS，旧 `pdf_batch_screenshot` 固定接口测试不变。

  Run: `node --test tests/shenhui-new-arrival-batch-label-tile-download.test.js tests/shenhui-new-arrival-prepare-upload-package.test.js`

  Expected: 全部 PASS，`batch_label_tile_download` 无代码 diff。

### Task 6: 手写样例和真实 PDF 的本地集成验证

**Files:**
- No production file changes unless validation exposes a defect.
- Evidence output: `artifacts/shenhui-apparel-label-ai-validation-20260828/`

**Interfaces:**
- Uses: `process_prepare_upload_package_labels` 和真实配置路由，不保存密钥。

- [ ] **Step 1: 两张手写废图直接识别**

  对以下文件并发运行 Terra/Luna，必要时 Sol 复核：

  ```text
  /var/folders/kk/y55jpfk113xcv1bjkn7ypr680000gn/T/codex-clipboard-1d8fae26-cf74-40ae-8504-1a6898d809d7.png
  /var/folders/kk/y55jpfk113xcv1bjkn7ypr680000gn/T/codex-clipboard-e6544532-e166-4436-8a8b-eec5e2c2c4dd.png
  ```

  Expected: 两张均 `accepted=false`，原因包含 `handwritten_placeholder` 或等价手写占位说明。

- [ ] **Step 2: 真实 4 页 PDF 定向集成**

  Run processor against:

  ```text
  /Users/xingyicheng/Downloads/深绘服饰反馈修复验证-20260828-configured/深绘服饰反馈修复验证-202426107206-标签平铺-rerun-yqclass/202426107206/101冬季414更新K228044904合格证-日常RFID 202426107206腾亚.pdf
  ```

  Expected: 识别 4 页；色号 70013 和 81322 各选择一个 110 正面吊牌；不选 90，不选黄色背面 Logo；输出均为 800×800 RGB 白底。

- [ ] **Step 3: 检查真实产物**

  打开生成 yq contact sheet，读取 audit JSON/结果表，核对角色、款号、色号、尺码、模型票和最终路径，不只看 `issues=[]` 或退出码。

### Task 7: 串行真实任务复跑与完整回归

**Files:**
- Evidence output: `artifacts/shenhui-apparel-label-ai-validation-20260828/201426105102/`
- Evidence output: `artifacts/shenhui-apparel-label-ai-validation-20260828/202426107206/`

- [ ] **Step 1: 运行并验收 201426105102**

  只运行 `prepare_upload_package` 单款。打开实际 `yq1/yq2`、结果表和目录；确认 yq1 是正确款号吊牌、yq2 是正确款号洗唛，历史错误款 `201426122101` 不入包，手写/否定素材不入包。任何失败立即修复并从本款重跑，未通过不得进入下一步。

- [ ] **Step 2: 运行并验收 202426107206**

  仅在上一款完全通过后运行。打开两个款色的 yq1 和现成 yq2；确认两个吊牌均为 110、没有背面 Logo、800×800 白底不拉伸，现成有效 yq2 触发洗唛短路。

- [ ] **Step 3: 完整验证阶梯**

  Run:

  ```bash
  node --test tests/shenhui-new-arrival-batch-label-tile-download.test.js tests/shenhui-new-arrival-prepare-upload-package.test.js
  python3 -m pytest tests/test_shenhui_apparel_label_processing.py tests/test_shenhui_new_arrival_packaging.py tests/test_shenhui_pdf_screenshot.py -q
  python3 -m py_compile core/shenhui_apparel_label_processing.py core/api_server.py
  git diff --check
  ```

  Expected: 全部 PASS；`git diff -- adapters/shenhui-new-arrival/batch-label-tile-download.js core/shenhui_pdf_screenshot.py` 为空；没有密钥、调试输出或无关文件进入 diff。

## Plan Self-Review

- Spec coverage: yq 角色/作用域、废图、错误款号、110 排序、并发双模型、Sol 分歧复核、本地裁图/OCR、结果审计、任务边界和两款串行真实验收均有对应任务。
- Placeholder scan: 每个代码步骤都有精确接口、命令和预期结果，没有未定实现项。
- Type consistency: `LabelCandidate` 贯穿审查、合并、选择、裁图；集成入口和返回类型在 Task 5 唯一定义；JS 元数据名统一为 `__yq_kind`。
