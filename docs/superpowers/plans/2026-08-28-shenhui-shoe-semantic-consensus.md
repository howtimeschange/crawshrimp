# 深绘鞋品图包语义共识与八款串行验收 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用双视觉模型结构化语义共识、确定性硬门禁和严格成图验证修复鞋品图包，并依次完成 Excel 中八个款号的真实单款闭环。

**Architecture:** 姿势模型只返回逐候选事实；`core/shenhui_shoe_rules.py` 将每个模型结果独立映射为槽位，再由 `core/shenhui_shoe_packaging.py` 进行双模型共识并把证据写入报告。`artifacts/shenhui_shoe_rerun_validator.py` 对输出文件、语义证据、命名和 tmq 款号框做二次验证，串行运行器只在当前款完全通过后推进。

**Tech Stack:** Python 3、Pillow、项目 LLM Gateway、Tesseract.js、本地 XLSX 输入、`unittest/pytest`。

## Global Constraints

- 处理顺序固定为：204426146036、204426146127、204426146023、204426141113、204426141112、204426141127、204426140034、204426140143。
- 单款自动验证或逐图可视检查未通过时不得进入下一款。
- 不写死款号或素材文件名；`204426146036` 仅作为首个回归样本。
- 至少两个不同模型路由独立同意，槽位才允许自动锁定。
- 几何特征仅作过滤器，不作模板语义最终裁判。
- 不上传、不发布、不发送外部消息；不输出或持久化任何 API 密钥。
- 保留当前工作区无关改动，不做广泛格式化或清理。

---

### Task 1: 锁定语义硬门禁的失败样本

**Files:**
- Modify: `core/shenhui_shoe_rules.py`
- Create: `tests/test_shenhui_shoe_rules.py`

**Interfaces:**
- Consumes: `CandidateFacts`、`slot_payload_from_candidate_facts()`。
- Produces: `candidate_is_valid_for_slot(fact: CandidateFacts, slot: str, shoe_category: str) -> tuple[bool, str]`。

- [ ] **Step 1: 写失败测试**

```python
def test_yq3_rejects_feature_card_even_when_pose_hint_matches():
    fact = rules.CandidateFacts(
        candidate_id="I01", filename="tag.jpg", asset_type="shoe",
        shoe_count="single", pose="yq3", complete=True,
        side="outer", feature_card=True, confidence=0.99,
        matched_slots=("yq3",),
    )
    assert rules.candidate_is_valid_for_slot(fact, "yq3", "婴童")[0] is False

def test_baby_tmz4_requires_rear_or_side_rear_semantics():
    outer = rules.CandidateFacts(
        candidate_id="I01", filename="outer.jpg", asset_type="shoe",
        shoe_count="single", pose="yq3", complete=True,
        side="outer", confidence=0.99, matched_slots=("tmz4",),
    )
    rear = dataclasses.replace(outer, filename="rear.jpg", pose="tmz4", side="rear")
    assert rules.candidate_is_valid_for_slot(outer, "tmz4", "婴童")[0] is False
    assert rules.candidate_is_valid_for_slot(rear, "tmz4", "婴童")[0] is True
```

- [ ] **Step 2: 验证 RED**

Run: `python -m pytest tests/test_shenhui_shoe_rules.py -q`

Expected: FAIL，因为 `candidate_is_valid_for_slot` 尚不存在或当前提示可绕过硬门禁。

- [ ] **Step 3: 实施最小硬门禁并接入 `_candidate_score()`**

```python
def candidate_is_valid_for_slot(fact, slot, shoe_category):
    if slot in {"tmz1", "tmz2", "tmz3", "tmz4", "tmz5", "yq3", "wpz5"}:
        if not fact.complete or fact.feature_card:
            return False, "requires complete unobstructed shoe"
    if slot == "tmz4" and shoe_category != "雪地":
        if fact.side not in {"rear", "side_rear", "heel"} and fact.pose != "tmz4":
            return False, "requires rear or side-rear"
    if slot == "yq3" and fact.side != "outer":
        return False, "requires outer side"
    if slot == "yx" and not (fact.complete and fact.feature_card):
        return False, "requires complete shoe plus feature card"
    return True, ""
```

- [ ] **Step 4: 验证 GREEN**

Run: `python -m pytest tests/test_shenhui_shoe_rules.py -q`

Expected: PASS。

### Task 2: 将所有姿势策略改为结构化事实并要求双模型共识

**Files:**
- Modify: `core/shenhui_shoe_packaging.py`
- Modify: `core/shenhui_shoe_rules.py`
- Test: `tests/test_shenhui_shoe_packaging.py`
- Test: `tests/test_shenhui_shoe_rules.py`

**Interfaces:**
- Consumes: 每个模型返回的 `candidates[]`。
- Produces: `_consensus_pose_payload(payloads, candidate_ids, shoe_category, required_votes=2) -> dict[str, Any]`。

- [ ] **Step 1: 写双模型分歧与一致的失败测试**

```python
def test_consensus_leaves_slot_empty_when_models_disagree():
    result = shoe._consensus_pose_payload(
        [payload_for("model-a", tmz4="I01"), payload_for("model-b", tmz4="I02")],
        {"I01": "front.jpg", "I02": "rear.jpg"}, "婴童", required_votes=2,
    )
    assert result["slots"]["tmz4"] == ""
    assert result["_consensus_issues"]

def test_consensus_locks_slot_when_two_models_agree():
    result = shoe._consensus_pose_payload(
        [payload_for("model-a", tmz4="I02"), payload_for("model-b", tmz4="I02")],
        {"I02": "rear.jpg"}, "婴童", required_votes=2,
    )
    assert result["slots"]["tmz4"] == "I02"
```

- [ ] **Step 2: 验证 RED**

Run: `python -m pytest tests/test_shenhui_shoe_packaging.py -k 'consensus' -q`

Expected: FAIL，因为当前 fallback 在首个模型成功后停止且不存在共识函数。

- [ ] **Step 3: 统一 prompt 返回 `candidates[]`，调度至少两个不同模型路由**

修改 `_shoe_selection_prompt()` 的返回 schema；让 `_default_analyze_color()` 按批次保存不同路由的有效 payload，达到两票前继续 fallback。一个模型的重试不算第二票。

- [ ] **Step 4: 独立映射后逐槽投票**

将每个候选事实 payload 单独传入 `slot_payload_from_candidate_facts()`；按槽位和 `_copy_variant_key()` 聚合投票。票数不足的槽位留空，证据写入 `_model_votes` 与 `_consensus_issues`。

- [ ] **Step 5: 验证 GREEN 与相邻调度测试**

Run: `python -m pytest tests/test_shenhui_shoe_packaging.py -k 'consensus or pose_model or global_pages or single_sheet' -q`

Expected: PASS，且测试证明两个不同路由才构成两票。

### Task 3: 传递语义证据并加强输出验证器

**Files:**
- Modify: `core/shenhui_shoe_packaging.py`
- Modify: `artifacts/shenhui_shoe_rerun_validator.py`
- Modify: `tests/test_shenhui_shoe_packaging.py`
- Create: `tests/test_shenhui_shoe_rerun_validator.py`

**Interfaces:**
- Consumes: selection 中的 `_candidate_facts`、`_model_votes`、`_consensus_issues`。
- Produces: 报告列 `语义属性`、`模型共识`、`鞋盒命名已验证`；`validate_style()` 返回语义问题。

- [ ] **Step 1: 写 validator 失败测试**

```python
def test_validator_rejects_yq3_semantics_with_feature_card(tmp_path):
    rows = [{
        "规则槽位": "yq3", "语义属性": json.dumps({
            "complete": True, "side": "outer", "feature_card": True,
        }), "模型共识": "2/2",
    }]
    issues, _ = validator.validate_semantic_rows(rows, category="婴童")
    assert any("yq3" in issue and "feature_card" in issue for issue in issues)
```

- [ ] **Step 2: 验证 RED**

Run: `python -m pytest tests/test_shenhui_shoe_rerun_validator.py -q`

Expected: FAIL，因为当前验证器不读取语义证据。

- [ ] **Step 3: 在报告行写入候选事实与共识票据**

`_resolve_selection_payload()` 保留元数据；复制每个 assignment 时按源文件关联候选事实和对应槽位投票。

- [ ] **Step 4: 增加确定性语义、命名与近重复检查**

验证 `tmz1..5/yq1..3/wpz5/wpz6/yx` 的语义证据和至少两票；验证文件夹为已验证鞋盒款色名；验证 `wpz (15)` 与 `wpz (16)` 不近重复。

- [ ] **Step 5: 验证 GREEN**

Run: `python -m pytest tests/test_shenhui_shoe_rerun_validator.py tests/test_shenhui_shoe_packaging.py -k 'semantic or consensus or duplicate' -q`

Expected: PASS。

### Task 4: tmq 与鞋盒命名失败关闭

**Files:**
- Modify: `core/ocr_service.py`
- Modify: `core/shenhui_shoe_packaging.py`
- Modify: `artifacts/shenhui_shoe_rerun_validator.py`
- Test: `tests/test_shenhui_shoe_packaging.py`
- Test: `tests/test_shenhui_pdf_screenshot.py`
- Test: `tests/test_shenhui_shoe_rerun_validator.py`

**Interfaces:**
- Consumes: 鞋盒原图、模型 `label_bbox/style_code_bbox/color_name/color_code`、本地 OCR words。
- Produces: 经完整 12 位款号复核的 tmq 与经鞋盒验证的款色名。

- [ ] **Step 1: 写失败测试**

测试空款色名被 `_validate_label_ocr_payload()` 拒绝；测试没有完整款号 bbox 时 `_create_tmq_asset(..., require_style_code_bbox=True)` 拒绝；测试 red rectangle 未包含款号 OCR bbox 时 validator 报错。

- [ ] **Step 2: 验证 RED**

Run: `python -m pytest tests/test_shenhui_shoe_packaging.py tests/test_shenhui_shoe_rerun_validator.py -k 'label_color or tmq or red_box' -q`

Expected: 至少一个新增断言失败。

- [ ] **Step 3: 实施严格 OCR 与本地复核**

鞋盒模型必须返回非空款色名、正确色号和完整款号框；用 Tesseract words 优先精修款号 bbox。生成 tmq 时必须有已验证 bbox，不再使用固定比例猜款号位置。

- [ ] **Step 4: 验证成图中的款号与红框包含关系**

validator OCR `tmq.jpg`，定位当前款号文字框和红线包围框；完整款号缺失或红框不包含文字框均失败。

- [ ] **Step 5: 验证 GREEN**

Run: `python -m pytest tests/test_shenhui_shoe_packaging.py tests/test_shenhui_shoe_rerun_validator.py -k 'label_color or tmq or red_box' -q`

Expected: PASS。

### Task 5: 跑聚焦与相邻回归

**Files:**
- Verify: `core/shenhui_shoe_rules.py`
- Verify: `core/shenhui_shoe_packaging.py`
- Verify: `core/ocr_service.py`
- Verify: `artifacts/shenhui_shoe_rerun_validator.py`

- [ ] **Step 1: 运行语义规则与打包测试**

Run: `python -m pytest tests/test_shenhui_shoe_rules.py tests/test_shenhui_shoe_packaging.py tests/test_shenhui_shoe_rerun_validator.py -q`

Expected: 0 failed。

- [ ] **Step 2: 运行相邻 OCR 测试**

Run: `python -m pytest tests/test_shenhui_pdf_screenshot.py -q`

Expected: 0 failed。

- [ ] **Step 3: 检查差异**

Run: `git diff --check -- core/shenhui_shoe_rules.py core/shenhui_shoe_packaging.py core/ocr_service.py artifacts/shenhui_shoe_rerun_validator.py tests/test_shenhui_shoe_rules.py tests/test_shenhui_shoe_packaging.py tests/test_shenhui_shoe_rerun_validator.py`

Expected: 无输出，退出码 0。

### Task 6: 首款 204426146036 单款闭环

**Files:**
- Runtime output: `artifacts/shenhui-shoe-semantic-consensus-20260828/_attempts/204426146036/`

- [ ] **Step 1: 真实单款重跑**

Run: `python artifacts/shenhui_shoe_rerun_validator.py 204426146036 --attempt semantic-consensus --source-root /Users/xingyicheng/Downloads/鞋品测试 --report-xlsx /Users/xingyicheng/Downloads/鞋品测试/深绘鞋品上新图包整理结果_20260822-202441.xlsx --category-xlsx /Users/xingyicheng/Downloads/鞋品品类映射模板测试.xlsx --output-root artifacts/shenhui-shoe-semantic-consensus-20260828 --pose-models gpt-5.6-sol,glm-official-5.3-flash,gpt-5.6-terra,gpt-5.6-luna --label-models gpt-5.6-sol,glm-official-5.3-flash,gpt-5.6-terra --pose-strategy single_sheet`

Expected: 退出码 0；但仍需后续可视检查。

- [ ] **Step 2: 核验明确回归点**

确认 `tmz4` 为后侧/侧后、两色 `yq3` 无功能卡且为外侧、两色 `yx` 在有功能卡素材时正确、文件夹来自鞋盒名称、`tmq` 框住 `204426146036`。

- [ ] **Step 3: 逐图 contact sheet 可视检查**

打开主图、o、两色 yq/yx、tmq 与渠道图 contact sheet。任何错误回到 Task 1–4 增加失败测试、修复、重跑本款。

- [ ] **Step 4: 只在三层均通过后复制 final**

重新以 `--copy-final` 运行同款，确认 `validation.json`、实际图片和 final 路径一致。

### Task 7: 其余七款严格串行闭环

**Files:**
- Runtime output: `artifacts/shenhui-shoe-semantic-consensus-20260828/_attempts/<style>/`
- Runtime final: `artifacts/shenhui-shoe-semantic-consensus-20260828/final/<style>/`

- [ ] **Step 1: 按 Excel 顺序逐款运行**

依次执行：`204426146127`、`204426146023`、`204426141113`、`204426141112`、`204426141127`、`204426140034`、`204426140143`。每次只传一个款号。

- [ ] **Step 2: 每款读取 validation.json 与报告**

核对 `issues=[]`、语义共识票据、模板数量、命名、tmq、渠道图属性和关键近重复。

- [ ] **Step 3: 每款逐图可视复核**

对当前款 contact sheet 逐槽检查；若失败，停止序列，写失败测试、修复代码并只重跑当前款，直到通过。

- [ ] **Step 4: 当前款通过后以 `--copy-final` 固化并进入下一款**

禁止提前批量跑后续款，也禁止把失败款复制到 final。

### Task 8: 最终交付门禁

**Files:**
- Verify: `artifacts/shenhui-shoe-semantic-consensus-20260828/final/`

- [ ] **Step 1: 重新运行完整聚焦测试和 diff check**

Run: `python -m pytest tests/test_shenhui_shoe_rules.py tests/test_shenhui_shoe_packaging.py tests/test_shenhui_shoe_rerun_validator.py tests/test_shenhui_pdf_screenshot.py -q`

Run: `git diff --check`

Expected: 0 failed；diff check 退出码 0。

- [ ] **Step 2: 汇总八款当前证据**

确认 final 下恰有八个款号目录，每个款号的最后一次 validation、报告和 contact sheet 均来自同一次通过运行。

- [ ] **Step 3: 自审敏感信息与无关改动**

确认日志、报告、源码、命令输出没有 API key；没有上传、发布或外部消息；没有覆盖无关工作区改动。

- [ ] **Step 4: 交付本地路径与逐款结果**

列出八款各自品类、颜色数、关键槽位数量、最终验证结果和 final 路径；任何残余未验证层必须明确标为未完成，不能宣称交付。
