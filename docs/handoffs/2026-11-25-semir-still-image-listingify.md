# 森马静物图分包与标签核验 · Listingify 开发交接

抓虾本地仓库位于 `/Users/xingyicheng/Documents/crawshrimp`。适配器 ID 为 `semir-launch-assistant`，任务 ID 为 `organize_still_image_package`。默认采用 PP-LCNetV2 INT8 排序加浏览器 Tesseract 核验。图包复制由森马云盘完成，原图在浏览器中处理。

## 两阶段流程

1. **读上架表。** 季度、批次和上市日期来自 Excel。将「第8批」与「8P」解析成同一批次；目标目录按 `8P/男或女/款号/中文色名+五位色号` 命名。中性归男款，色号保留前导零，款号保留字母后缀。款色字段和独立款号、色号冲突时，用后两者找图并在结果表提示。
2. **先整理图包。** 源目录可配置多条，目标目录单独配置。优先按完整款号和色号匹配，同等候选交业务确认。源款目录全部款色都在任务内时可整款复制，否则按表中款色分别复制。写操作限定在选定目标根内，按挂载库串行执行。复制和改名后读回相对路径、目录类型、文件哈希和字节数。同名且内容一致时复用，冲突时保留现状。
3. **再核验标签。** 整批整理结束后，OCR 读取已整理的图包。预览模式直接读来源。任务在同一浏览器标签页保存已整理清单和已完成的 OCR 结果。云盘返回登录过期时进入等待状态，恢复登录后从剩余款色继续。
4. **最后导出。** 原上架表另存副本，用季度批次、款号、款色、色号、上市日期组合定位回填行。末尾追加「缺吊牌」「缺洗唛」「款号是否一致」「备注」。只有已完成扫描且判缺才填红字「缺」；读图失败、候选类型不清或款号读不清分别记录原因。已有四列的表可以重新导出，旧值和缺项红字会按本次结果清理。

## 翻到代码就能复用的部分

| 位置 | 入口和边界 |
| --- | --- |
| [organize-still-image-package.js](../../adapters/semir-launch-assistant/organize-still-image-package.js) | `batchRows` 负责表格和命名，`findSource`、`prepareStyle` 和 `copyPackage` 负责规划、复制和验真，`scanColor` 负责标签候选排序和核验。 |
| [semir_still_image_classifier.py](../../core/semir_still_image_classifier.py) | `classify_rgb_batch` 接收最多 8 张 224×224 RGB 缩略图的连续字节，返回按输入顺序对齐的 `[吊牌, 洗唛, 其他]` 概率。 |
| [模型权重、输入和校验清单](../../core/semir_still_image_assets/model.json) | PP-LCNetV2-base SSLD，INT8 ONNX，5,751,718 字节。等比缩放、白色补边，ImageNet RGB mean/std，NCHW float32。ONNX 输入名为 `image`，输出名为 `scores`。 |
| [api_server.py](../../core/api_server.py) | `classify_semir_still_images` 提供本机分类接口。云盘页面只把缩略图 RGB 发到 loopback。接口校验来源、当前任务临时令牌、字节长度和分类响应。令牌随任务结束回收。 |
| [semir_launch_packaging.py](../../core/semir_launch_packaging.py) | `still_ocr_host_hardware` 读取本机硬件；`write_still_package_report` 负责结果语义和 Excel 样式。 |
| [after-pack.js](../../app/scripts/after-pack.js) | 打包钩子检查分类代码、模型及 SHA-256。桌面端复用现有 Python ONNX Runtime 和内置 Tesseract WASM、中文与英文语言包。 |

### 候选顺序与证据

- 文件名仅在精确匹配当前款号、色号和已验证的正背面序号时用于跳过商品视图。其他文件名用于排序。最多对前 16 张候选做分类，每次至多 8 张；每类高分图优先，`other ≥ 0.995` 的图延后。两种正式标签均已匹配款号时提前结束；缺证据时继续回扫。分类不可用时保留 OCR 回退。
- Tesseract 首读后按需要尝试标签中心、下半部分或更窄的细节区域。多次读到互相冲突的款号时保留待复核。同主款缺字母后缀属于未读清，明确的不同后缀才属于不一致。形似款号且只多一位数字的结果不能充当零售 EAN，例如 OCR 把后缀 `B` 读成 `8`。
- 正式吊牌依赖零售证据和款号证据。供应商样版卡、手写缺项说明、宣传附属卡和普通商品图可出现在同一个图包。内容证据弱时保留不确定状态。每款色的底层结果带标签类型、识别款号、对应图片名和失败信息，Excel 只展示业务需要的四列。
- Worker 按逻辑核数与物理内存确定上限，最多 12 个。单图 OCR 超时会回收该 Worker，用较小图自动重试一次。标签图读失败与云盘登录暂停走不同状态，避免把失败的图片写成缺项。

## Listingify 接入建议

在 Listingify 的云盘图包入口加一个候选排序层，复用 Node Worker 的图片读取、OCR provider 和模型并发限流。用 `onnxruntime-node` 在 Worker 内初始化一个可复用会话，移植上面同一份 RGB 预处理和标签概率顺序。候选层应传递文件 ID、文件名、概率及排位，OCR 层再返回类型证据、印刷款号、文件 ID 和人工复核原因。

本机检视到 Listingify 的现有入口为 `scripts/lib/product_archive_hangtag_ocr.mjs` 中的 `recognizeProductArchiveOcrFiles`、`recognizeProductArchiveOcrFile`、`analyzeProductArchiveOcrDocument` 和 `extractStyleCodesFromText`。候选排序适合接在批量调度前。云盘来源场景中要区分文件名带出的款号和照片上 OCR 读到的款号。现有建档字段归并继续由 `web/server/services/product-archive-hangtag-ocr.ts` 处理。把森马款号解析和样卡判定限定在对应工作区，保留其他品牌、PDF 和批量建档分支的现有规则。

服务端可把整理和核验状态持久化到任务记录，以款色和图包内容版本去重。每张图能保存可追溯的判定结果，重试只处理未完成项。并发按容器 CPU/内存配额限制；桌面端的 Worker 上限用于桌面环境。

## 实测结论与复现

新抽 20 款，共 370 张照片，含 5 款 A/B 后缀。逐包目检吊牌、洗唛及印刷款号。A 和 B 使用同样的图片、OCR 代码和 6 个 Worker，浏览器段顺序运行，两组共同使用预先算好的 PP-LCNetV2 分数。B 在 PP-LCNetV2 初筛后加 DINOv2 候选判断，OCR 仍核验最终证据。

| 指标 | A · PP-LCNetV2 + OCR | B · 加 DINOv2 |
| --- | ---: | ---: |
| 标签有无判断准确 | 40/40 | 39/40 |
| 有标签的款号核对正确 | 33/33 | 32/33 |
| 进入 OCR 的照片 | 109 | 71 |
| 浏览器段 | 101.0 秒 | 228.7 秒 |
| DINOv2 MPS 冷启动和推理 | — | 1.9 秒 |

B 组漏掉 `101526120007 / 00355` 的正式吊牌 `536A0770.jpg`。DINOv2 单独分类找对 32/32 张洗唛照片和 3/4 张样卡，分别高于 PP-LCNetV2 的 28/32 和 0/4；仍有 28/39 张宣传附属卡被 DINOv2 归为吊牌。选用 A 作为默认，DINOv2 的实验权重可用来测试疑难图候选。DINOv2 对照分类头按款号族隔离了这 20 款。旧 PP-LCNetV2 训练集含其中 7 款。

全表检索 571 款，520 款取得图包并训练，选入 5,614 张图，其中 72 张样卡。其余 51 款未找到唯一可用来源。全表分类头含本轮目检数据，与用于 A/B 的留出分类头是两个文件。全表分类头需要匹配的 DINOv2-small 骨干。留出实验覆盖 macOS 浏览器与本机 MPS，安装包大小及 Windows 实机不在本次实测中。

真实抓虾客户端最终复跑约 144 秒，读回 20 个目标图包和 370 张图片的文件名、哈希和字节数。找证据时，在共享机器可查 `.codex-tmp/dont-stop/semir-new20/final-metrics.json` 和 `cloud-file-readback.json`。逐款、逐图对照和模型分类头位于本轮 Codex 产物目录。

```bash
node --test tests/semir-launch-materials.test.js
app/python-dist/mac-arm64/bin/python3 -m unittest discover -s tests -p test_semir_launch_packaging.py
app/python-dist/mac-arm64/bin/python3 -m unittest discover -s tests -p test_api_security.py
```
