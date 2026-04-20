# crawshrimp 项目评估与改进路线图

## 文档目的

这份文档用于后续接手 `crawshrimp` 的研发、重构和产品化推进。

目标不是重复 README，而是回答下面 6 个问题：

1. 这个项目现在到底是什么
2. 这个项目已经做对了什么
3. 这个项目现在最危险的地方是什么
4. 后续应该优先修哪里，而不是继续堆功能
5. `probe` / `agent` 这些新方向该怎么接
6. 接手人第一阶段应该按什么顺序落地

---

## 一句话结论

`crawshrimp` 已经不是“若干网站脚本集合”，而是一套较完整的**网页自动化桌面底座**：

- 前端是 Electron + Vue
- 后端是 FastAPI + Chrome CDP + JS 注入执行
- 业务扩展通过 adapter 完成
- 数据通过 Excel / JSON / SQLite 落盘
- 当前已经从“能不能做”阶段进入“如何把经验沉淀成平台能力”阶段

当前项目最强的地方，不是某个单独站点脚本，而是围绕网页执行建立出来的**执行协议层**。

当前项目最大的风险，也不是功能不够，而是**协议复杂度开始高于当前代码结构的承载能力**。

---

## 评估范围

本次评估覆盖了以下内容：

- 项目入口文档与开发文档
- 后端核心执行链路
- 前端主界面与任务运行页
- adapter 协议与 Temu 主线 manifest
- probe / agent 两条 RFC
- 现有 Python / Node 测试与回归结构

核心参考文件：

- `README.md`
- `DEVELOPMENT.md`
- `sdk/ADAPTER_GUIDE.md`
- `core/api_server.py`
- `core/js_runner.py`
- `core/data_sink.py`
- `core/adapter_loader.py`
- `app/src/renderer/App.vue`
- `app/src/renderer/views/TaskRunner.vue`
- `app/src/renderer/utils/taskProgress.js`
- `adapters/temu/manifest.yaml`
- `RFC-crawshrimp-probe.md`
- Hermes agent integration RFC 草案

---

## 项目定位

### 当前产品语义

`crawshrimp` 的真实产品定位可以概括为：

> 连接真实登录态 Chrome，在用户已经登录的网页中执行业务自动化任务，并自动导出结果的桌面底座。

它不是：

- 通用爬虫框架
- Playwright / Puppeteer 替代品
- 纯脚本仓库
- 纯 agent 平台

它更像：

- 面向业务用户的自动化桌面应用
- 面向工程团队的 adapter 运行平台
- 面向后续智能化能力的执行底座

### 现阶段最准确的分层

```text
用户 / 运营
  ↓
Electron + Vue GUI
  ↓
FastAPI 任务编排层
  ↓
CDP Bridge + JS Runner 执行协议层
  ↓
Adapter（manifest + JS + auth + template）
  ↓
真实登录态 Chrome 页面
  ↓
Excel / JSON / SQLite / 通知
```

### 仓库中已经存在的第二增长曲线

主产品线之外，仓库已经出现两条很明确的新方向：

- `probe`：把人工探查页面的过程标准化
- `agent`：把页面探查、脚本草稿、单次试跑、数据分析接到同一个 agent 工作流中

这两条方向都是合理的，但前提是先把当前底座继续收口。

---

## 当前架构总览

### 1. 后端主核

后端目前的主线是：

- `core/api_server.py`
  负责 HTTP API、任务生命周期、运行控制、导出触发、状态回传
- `core/js_runner.py`
  负责脚本注入、分页循环、phase/shared 协议、重连、CDP 点击、文件注入、请求捕获、下载
- `core/cdp_bridge.py`
  负责连接 Chrome 远程调试端口，拿 tab、开 tab、找 tab
- `core/data_sink.py`
  负责 SQLite 任务记录、Excel/JSON 导出、多 sheet 组装
- `core/adapter_loader.py`
  负责安装、扫描、启用/禁用 adapter

### 2. 前端主核

前端当前是轻量结构：

- `App.vue` 做全局布局、视图切换和左侧脚本导航
- `ScriptList.vue` 做脚本入口
- `TaskRunner.vue` 做任务执行主界面
- `taskProgress.js` 做进度逻辑收敛

### 3. Adapter 协议

adapter 当前的发布单元是一个目录或 zip：

```text
adapter/
  manifest.yaml
  *.js
  auth_check.js
  模板文件
  图标
```

其中：

- `manifest.yaml` 定义任务、参数、输出、入口、认证、模板
- `*.js` 是页面中实际执行的业务逻辑
- 底座负责运行时注入、状态管理、分页、导出和通知

### 4. 当前已形成的“执行协议”

这个项目最有价值的部分，其实是下面这套运行协议：

- `mode=current/new`
- adapter 安装副本机制
- manifest 驱动的参数与输出
- JS 返回 `data + meta`
- `meta.has_more`
- `phase + shared`
- live progress 契约
- 任务 pause / resume / stop
- 失败后的部分导出
- 最终导出 guard / 去重

这个协议层才是项目真正的壁垒。

---

## 做得好的地方

## 1. 产品边界清楚

项目不是为了“炫技自动化”，而是围绕一个清晰用户动作闭环设计：

1. 打开已登录的 Chrome
2. 在桌面端选择脚本
3. 运行任务
4. 导出文件
5. 查看任务状态与结果

这个产品闭环是成立的，且对业务用户友好。

### 为什么这是优点

- 降低用户环境门槛
- 不需要重复登录
- 不需要用户理解 CDP / Node / Python
- 让“适配器市场”成为自然扩展点

## 2. Adapter 协议设计简单但够用

`manifest.yaml + JS` 这个协议没有过度设计，但已经覆盖了：

- 任务参数
- 模板下载
- 运行模式
- 登录检查
- 输出格式
- 文件命名
- 前端特定执行模式

优点在于：

- 新 adapter 上手成本低
- 人和 AI 都容易理解
- 业务扩展速度快

## 3. 执行内核明显有深度

`js_runner.py` 不是简单的 `Runtime.evaluate` 包一层。

它已经覆盖了网页自动化里最难稳定的几类动作：

- phase / shared 多阶段重入
- 导航后重连
- runtime 文件注入
- CDP 真实鼠标点击
- network capture
- URL / click 两类下载流程
- 页面瞬时 tab / modal / download 处理

这说明项目不是停留在“能跑一个站点”的阶段，而是已经在处理网页自动化的共性难题。

## 4. 已经有工程化经验，而不是只靠个人记忆

这点非常重要。仓库里已经有：

- `sdk/ADAPTER_GUIDE.md`
- `DEVELOPMENT.md`
- `handover/`
- `RFC-*`
- `skills/crawshrimp-adapter-skill`

这说明很多经验已经开始从“脑内经验”变成“项目资产”。

这对后续交接、多人协作、AI 协作都很关键。

## 5. 长任务体验不是临时补丁

进度逻辑已经有集中收口：

- `taskProgress.js`
- live 状态字段
- whitelist 驱动 enhanced progress

这意味着前端没有把所有任务都做成“硬编码特判”，而是开始建立统一约束。

## 6. 测试思路正确

虽然测试环境还没完全收口，但测试策略是对的：

- Python 侧做底座与协议测试
- Node 侧做 adapter regression

特别是 adapter regression 很关键，因为这类项目的主要回归往往发生在：

- 页面结构变化
- phase/shared 恢复错误
- 导出链路漏数据
- 点击 / 下载链路漂移

这部分已经不是空白。

## 7. 新方向选得对

`probe` 和 `agent` 都不是“脱离现有底座另起炉灶”，而是复用现有 CDP、runner、导出和页面上下文。

这是正确路径。

如果以后要把 AI 真正接进来，应该建立在现有底座之上，而不是重做第二套浏览器控制层。

---

## 做得不好的地方

## 1. 后端主文件已经过大

当前几个核心文件体量如下：

- `core/api_server.py`: 1532 行
- `core/js_runner.py`: 1694 行
- `core/data_sink.py`: 502 行
- `core/probe_service.py`: 444 行

这说明当前存在明显的“中心文件膨胀”。

### 具体问题

- 任务编排、导出上下文、Temu 特判、运行控制、API endpoint 混在一个文件里
- runner 内同时承载注入、重连、下载、抓包、点击、文件缓存等多种职责
- 新人难以快速找到“应该在哪一层改”
- 回归风险开始跟文件大小成正比增长

### 影响

- 功能继续增长时修改成本会明显上升
- 单个 PR 更容易跨越多个职责边界
- 很难建立稳定的模块级测试边界

## 2. 前端已经出现“单页巨石化”

当前主要风险点：

- `app/src/renderer/views/TaskRunner.vue`: 1711 行
- `app/src/renderer/App.vue`: 391 行
- `app/src` 下缺少明显的 `components/`、`composables/`、`store/`、`router/` 分层

### 具体问题

- 任务参数、运行控制、日志、结果、进度都堆在 `TaskRunner.vue`
- 状态更新逻辑散在页面层
- 后续如果接入 probe / agent，当前页面复杂度会继续爆炸

### 影响

- UI 一旦扩功能，容易引入连带回归
- 很难做局部重构
- 很难给不同功能区域建立独立测试和复用能力

## 3. 平台逻辑与平台特例耦合偏深

项目表面上有 core / adapter 分层，但在实际代码里，一些 adapter 特例已经深入到了平台逻辑中。

典型表现：

- 导出文件名上下文构建里直接写了大量 Temu 逻辑
- 某些 tab 匹配、URL 规则、业务命名直接进入后端主流程
- 新平台容易沿用同样方式继续往 core 塞特例

### 这为什么危险

短期看，这种方式开发效率高。

长期看，会出现：

- core 被头部平台绑架
- adapter 与 core 的边界越来越不清晰
- 平台能力无法从 Temu 经验中真正抽象出来

## 4. adapter 体系对“纪律”依赖很高

现在很多重要规则主要靠：

- 文档约束
- skill 约束
- handover 约束

这比没有强很多，但仍然说明很多协议还没有真正工具化。

例如：

- 是否重装执行副本
- 是否补 regression
- 是否遵守 shared/live 约定
- 是否配置了正确输出字段

如果没有更强的自动校验，未来 adapter 数量一上来，就会越来越依赖资深开发者经验。

## 5. 测试环境未完全产品化

本次实际检查到：

- Node 侧测试可以跑，抽样运行通过
- Python 侧仓库内有测试，但当前虚拟环境没有安装 `pytest`
- 系统 Python 能跑 `pytest`，但又缺 `fastapi` 等运行依赖

### 这说明什么

说明“仓库如何稳定跑完整回归”这件事还没有被项目自己完全封装。

这不是功能 bug，但这是非常真实的工程风险。

一旦接手人换机器或切 CI 环境，这里会直接影响维护效率。

## 6. 当前产品主成功路径过度依赖 Temu 主线

当前最成熟、最复杂、也最能体现协议价值的 adapter 是 Temu。

这没有问题，但要警惕两个偏移：

1. 底座能力其实是在为 Temu 量身生长
2. 新平台接入时复用率可能低于预期

如果不做抽象提炼，项目可能会演变成：

> 一个带平台壳的 Temu 自动化系统

而不是：

> 一个通用网页自动化底座

---

## 当前主要风险

## 风险 1：继续扩功能，但不先拆主核

如果继续高频加任务、加平台、加前端交互，而不优先拆 `api_server` / `js_runner` / `TaskRunner`，半年内维护成本会非常高。

## 风险 2：adapter 协议继续增长，但缺少工具化验证

manifest、phase/shared、导出、进度协议都在增长。

如果没有 lint / validate / regression 模板，未来 adapter 质量会出现明显分层：

- 老开发者写的稳定
- 新开发者写的脆
- AI 草稿更容易踩协议坑

## 风险 3：probe / agent 过早做重，但底座还没收口

`probe` 和 `agent` 方向都合理，但如果在当前主核未拆解、前端未组件化之前直接重做一层复杂 UI / workflow，会把旧复杂度直接带入新系统。

## 风险 4：前端复杂度增长过快

如果后续在 `TaskRunner.vue` 里继续叠加：

- probe
- data analysis
- agent chat
- draft install / test

那这个页面很快会失控。

## 风险 5：缺乏明确的“平台能力目录”

当前很多平台能力已经存在，但还没有被正式编成能力清单，例如：

- click request capture
- download orchestration
- file injection
- phase/shared carry
- export guard
- live progress summary

如果这些能力不显式整理出来，后续开发仍然会把“已有能力”误当“单次特例”重复实现。

---

## 未来改进路径

下面的 roadmap 按 3 个阶段设计：

- 短期：先稳住主核
- 中期：把 adapter 工程化做深
- 长期：把 probe / agent 接到一个更稳定的底座上

---

## 第一阶段：短期 0-6 周

### 目标

先做架构收口，不优先追求功能面继续扩张。

### 核心任务

#### 1. 拆分后端主核

优先从 `api_server.py` 和 `js_runner.py` 开始拆。

建议目标模块：

- `core/task_service.py`
  负责任务启动、生命周期编排、状态更新
- `core/export_service.py`
  负责导出上下文、输出文件生成、导出后处理
- `core/run_control.py`
  负责 pause / resume / stop 状态机
- `core/runtime_actions.py`
  负责 click capture / url capture / download / file inject
- `core/navigation_runtime.py`
  负责 evaluate reconnect、reload、navigation retry

第一阶段不要求彻底重写，只要求先按职责切出模块边界。

#### 2. 拆分前端任务页

把 `TaskRunner.vue` 拆成至少 5 个子模块：

- `TaskParamForm`
- `TaskRunControls`
- `TaskLivePanel`
- `TaskLogPanel`
- `TaskResultPanel`

同时引入轻量 composable：

- `useTaskRun`
- `useTaskStatusPolling`
- `useTaskParams`

目标不是引入复杂框架，而是把页面从“巨型单文件”降到可维护状态。

#### 3. 收口测试环境

必须把“完整回归怎么跑”变成项目原生能力。

建议做法：

- 增加 `requirements-dev.txt`
- 或增加 `pyproject.toml` 统一 Python 开发依赖
- 增加仓库级测试命令：
  - `scripts/test-python.sh`
  - `scripts/test-adapters.sh`
  - `scripts/test-all.sh`

同时补一个最小 CI 路径：

- Python 单元测试
- Node regression
- 前端 build

#### 4. 补“平台能力目录”

建议新增一份文档，例如：

- `sdk/RUNTIME_CAPABILITIES.md`

显式列出底座已具备的能力、适用场景、输入输出协议。

这样能减少后续重复发明轮子。

### 第一阶段完成标准

- `api_server.py` 明显缩小
- `TaskRunner.vue` 明显缩小
- 新接手人可以一条命令跑核心测试
- adapter 开发者知道哪些能力已经由底座提供

---

## 第二阶段：中期 1-3 个月

### 目标

把 adapter 体系从“能开发”升级到“能稳定扩张”。

### 核心任务

#### 1. 强化 adapter 静态校验

在当前 manifest schema 基础上继续补：

- script 文件是否存在
- 模板文件是否存在
- output 配置是否合法
- task id 是否重复
- 参数默认值是否落在选项范围内

建议把这套校验做成：

- 安装前校验
- CI 校验
- 独立命令行工具

#### 2. 建 adapter regression 模板

现在已有一些高价值 JS 回归，但还不够模板化。

建议沉淀成：

- `tests/fixtures/...`
- adapter regression starter
- phase/shared/live/recovery 的标准测试骨架

目标是让每个复杂 adapter 都能快速复制出自己的最小回归套件。

#### 3. 建立“协议型能力”的复用层

把当前已经出现但散在脚本中的能力抽出来：

- 多站点循环
- 多时间范围循环
- source file -> detail 扩展
- export guard / final dedupe
- drawer/detail 页恢复
- click capture -> fileUrl -> download 流程

这类能力不应一直靠单个业务脚本重复实现。

#### 4. 统一错误分类

当前对失败的理解还偏“脚本错误 / 页面错误”。

建议统一成更清楚的错误模型：

- auth_error
- environment_error
- script_error
- business_error
- export_error
- validation_error

这会直接提升：

- UI 反馈质量
- 日志可读性
- agent 接入后的决策质量

#### 5. 提升观测性

建议逐步引入结构化运行摘要：

- 任务开始 / 结束
- 关键 phase 切换
- 恢复次数
- 下载成功率
- 导出耗时
- 去重条数

不用一开始就做完整 telemetry，但要开始从“文本日志”走向“结构化摘要”。

### 第二阶段完成标准

- 新 adapter 接入成本下降
- adapter 回归能力标准化
- 常见执行链路不再靠业务脚本重复发明
- 运行失败能快速定位是哪个层面的问题

---

## 第三阶段：长期 3-6 个月

### 目标

在更稳的底座上接入 `probe` 和 `agent`，把项目升级为“自动化 + 侦察 + 智能协作”平台。

### 核心任务

#### 1. 先做 probe，后做 agent

优先级应该是：

1. `probe`
2. `agent`

理由：

- `probe` 更贴近现有能力
- `probe` 可以先提升 adapter 开发效率
- `agent` 没有 probe 的结构化产物，容易变成盲写脚本

#### 2. probe 只做“侦察层”，不直接承诺生成可上线 adapter

probe 的正确定位是：

- 看 DOM
- 看 network
- 看框架
- 输出 bundle
- 输出 note 草稿
- 给后续 adapter 开发提供线索

不要把 probe 直接变成“自动生成并上线脚本”的承诺系统。

#### 3. agent 先做“builder + analyst”双模式

这一点当前 RFC 判断是对的。

建议 agent 第一阶段只做两件事：

- Builder：根据 probe 和当前页面上下文给出 adapter 草稿，并能试跑修正
- Analyst：读取导出文件，给出结构化分析和建议

不要太早开放通用 shell / 通用浏览器全权限能力。

#### 4. 给 probe / agent 单独留出 UI 区域

不要继续把所有新能力直接塞进现有 `TaskRunner.vue`。

可以复用当前任务上下文，但 UI 上应逐步分离为：

- 执行工作区
- 探查工作区
- 分析工作区

哪怕一开始不做完整 router，也应该先建立组件和数据边界。

### 第三阶段完成标准

- probe 能稳定输出结构化 bundle
- agent 能基于现有能力完成草稿生成与单次试跑闭环
- 数据分析能力能直接消费现有导出文件

---

## 优先级建议

如果资源有限，建议按下面顺序推进。

### P0：必须优先做

- 拆 `api_server.py`
- 拆 `js_runner.py`
- 拆 `TaskRunner.vue`
- 收口 Python / Node 测试运行方式

### P1：应尽快做

- adapter 静态校验增强
- adapter regression 模板化
- 运行错误分类统一
- 平台能力目录文档

### P2：在 P0/P1 稳定后推进

- probe 产品化
- agent builder / analyst
- 更完整的数据分析工作流

---

## 接手建议

## 接手人第一周应该做什么

1. 跑通当前前端 build 与 Node regression
2. 补齐 Python 测试环境并跑通核心后端测试
3. 读完以下文档：
   - `README.md`
   - `DEVELOPMENT.md`
   - `sdk/ADAPTER_GUIDE.md`
   - `RFC-crawshrimp-probe.md`
   - Hermes agent integration RFC 草案
4. 通读以下代码：
   - `core/api_server.py`
   - `core/js_runner.py`
   - `core/data_sink.py`
   - `app/src/renderer/views/TaskRunner.vue`
   - `adapters/temu/manifest.yaml`

## 接手人第二周建议动作

优先做一个“低风险但价值大的结构优化”：

- 先拆 `TaskRunner.vue`
或
- 先把 `api_server.py` 中任务执行服务抽出

不建议一接手就做：

- 新平台大扩展
- 新 agent UI
- 大规模美化前端
- 重做整套 adapter 协议

## 接手时不要做的事

- 不要在当前主核未拆的情况下继续把新特例塞进 `api_server.py`
- 不要继续把所有任务 UI 逻辑塞进 `TaskRunner.vue`
- 不要在没有 regression 的情况下大改 Temu 主线
- 不要让 probe / agent 绕开现有 CDP / runner 体系自建第二运行时

---

## 建议的近期实施顺序

### 顺序 A：先稳前端，再稳后端

适合当前主要痛点是 UI 复杂度和接手成本。

1. 拆 `TaskRunner.vue`
2. 补前端数据流与 composable
3. 补脚本运行页回归
4. 再拆 `api_server.py`

### 顺序 B：先稳后端，再补前端

适合当前主要痛点是执行内核复杂、功能还要继续增长。

1. 拆 `api_server.py`
2. 拆 `js_runner.py`
3. 补测试命令
4. 再拆 `TaskRunner.vue`

### 推荐顺序

建议优先走 **顺序 B**。

原因：

- 当前项目真正的风险中心仍然在后端主核
- probe / agent 未来也会主要复用后端能力
- 后端结构清晰后，前端拆分会更顺

---

## 建议保留的核心设计

以下设计应明确视为项目资产，不建议轻易推翻：

- adapter 安装副本机制
- manifest 驱动任务参数与输出
- phase/shared 执行协议
- current/new tab 模式
- 通过 CDP 复用真实登录态
- runtime action 思路
- final export guard
- enhanced progress 白名单机制
- probe / agent 复用当前底座而不是另起运行时

这些设计已经被证明是有价值的。

---

## 建议重构但不要推倒重来的部分

- `api_server.py`
- `js_runner.py`
- `TaskRunner.vue`
- adapter 校验与 regression 工具链
- 错误模型
- 测试环境入口

这些应该做的是“拆分与收口”，不是推翻重写。

---

## 当前验证说明

本次评估期间做了以下验证：

- 阅读了项目主文档、开发文档、adapter 指南、RFC
- 阅读了后端主核、前端主界面、任务页、Temu manifest、probe 代码
- 抽样运行了 Node 侧 adapter regression，结果通过

未完全跑通的部分：

- Python 侧完整测试未在当前仓库自带环境中一键跑通

发现的问题：

- 仓库内 `venv` 缺少 `pytest`
- 系统 `python3 -m pytest` 可运行，但缺少 `fastapi` 等项目运行依赖

这不是本次评估阻塞，但说明测试环境收口是短期需要补的工程项。

---

## 最终结论

`crawshrimp` 当前最值得肯定的地方，是它已经把网页自动化从“脚本问题”抬到了“执行协议问题”。

这意味着它已经具备平台化潜力。

`crawshrimp` 当前最需要修复的地方，是主核正在持续膨胀，前后端都开始出现中心文件过重、特例下沉过深的问题。

这意味着它现在最需要的不是继续高频扩功能，而是：

- 先拆主核
- 再固化 adapter 工程化
- 最后接 probe / agent

如果按这个顺序推进，项目后续会比较稳。

如果反过来，在主核未收口时继续叠加新平台、新 UI、新 agent 能力，复杂度会很快超过当前结构的承载上限。

---

## 推荐的下一步动作

接手后建议第一批任务直接开成 4 条：

1. `core/api_server.py` 拆分方案与首轮落地
2. `core/js_runner.py` runtime action / navigation 责任切分
3. `TaskRunner.vue` 组件化拆分
4. Python / Node 回归脚本与开发依赖收口

这 4 条完成后，再启动：

5. adapter validate / regression 模板化
6. probe 产品化
7. Hermes agent builder / analyst 接入
