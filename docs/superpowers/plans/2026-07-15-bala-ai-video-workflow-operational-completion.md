# Bala AI 视频工作流真实可用补齐执行记录

日期：2026-07-15

工作区：`/Users/xingyicheng/Documents/crawshrimp`

目标：以 `2026-07-15-bala-ai-video-workflow-entry-design.md` 为唯一产品口径，先补功能和真实链路，再做只读 code review、统一修复、最终复核和本地提交。

当前结果：功能补齐、四类 AI 改图、Seedance/HappyHorse 真实 5 秒视频、只读 code review 和 Electron 五步走查已经完成。软件管家运行 `22` 因 `9222` 当前停在千牛登录页而失败，未绕过登录，也未把失败伪装成上传或生成成功。

## 硬边界

- 继续在用户明确指定的本地 `main` 上工作，保留已有提交历史。
- API Key 只写入运行时 AI 能力配置或进程环境，不进入源码、测试、fixture、文档、命令输出和日志。
- 软件管家、Seedance、HappyHorse 的 live 提交已由用户明确授权；单条视频时长不超过 5 秒。
- 外部动作前先检查 `127.0.0.1:9222` 登录态、软件管家页面和权限；优先使用页面自己的 API/请求路径，每个动作都做读回。
- Seedance 与 HappyHorse 只能通过 `integrations/seedanceCLI`、`integrations/bailianCLI` 调用，应用层不复制 Ark/DashScope 客户端。
- 生视频保持显式 `新增视频任务`，一个款号可有多条独立任务；审核是进入视频的硬闸口。

## Task 1：锁定前端产品语义

先扩展 `tests/bala-ai-video-workflow-ui.test.js`，并确认新增断言会因当前旧行为失败：

- 找图当前批缩略图不使用强制低优先级；工作区无个人机器硬编码默认路径。
- AI 工具区独立滚动、手风琴不拉伸、主动作固定底部。
- AI 选择表示输入批次；不在生成完成后自动跳审核。
- 换姿势复用 Prompt 库，换装/细节参考共用本地素材库。
- 大图编辑包含 Prompt、四工具、历史缩略图和精确标注入口。
- 删除 AI 结果前必须二次确认；确认后只允许真实删除已授权工作区内的普通图片文件，并同步移出工作台、审核池和视频素材池。
- 审核全量包含原图与未删除 AI 结果。
- 视频素材拒绝 rejected，pending/retry 禁选，只有 approved 可选。
- 新增视频任务不显示款号下拉和成片拆分，不保存 `groupMode`。
- 视频输出目录使用系统文件夹选择器并继承工作区。

再以最小实现修正 `AiVideoWorkflow.vue`、公共工具函数和必要组件，并让测试转绿。

## Task 2：审核与持久化

先补 Python/API 回归测试并确认失败：

- 原图可进入审核、通过和驳回。
- 生成结果可先留在工作台，显式构建审核批次时再送审。
- 重跑返回刚创建的 retry asset，不返回旧 retry。
- 视频任务、provider task ID、结果和本地路径可在刷新/重启后恢复。

实现后复跑相关 Node/Python 测试。

## Task 3：AI 能力配置与 provider 注入

先扩展配置测试并确认失败：

- AI 能力配置具备 GPT Image 2 4K、Seedance、HappyHorse 三组独立凭据和配置状态。
- 设置页密码输入不回显明文，工作流只读取“已配置/未配置”。
- 主进程调用共享 CLI 时，从 AI 能力配置注入子进程环境；环境变量仅作回退。
- 错误和日志不包含凭据。

实现后用无敏感值 fixture 验证三个 provider 的注入优先级和缺配置恢复状态。

## Task 4：真实联调

款号：`208326102205`

1. 观察 9222 tab、登录态、软件管家页面和账号权限，建立脱敏 journal。
2. 从森马云盘新页面执行找图并下载到选择的工作区；记录任务/run ID、款号命中数、文件数与本地目录。
3. 在真实工作流依次执行 AI 换脸、换装、换背景、换姿势；每类至少一张，记录 job ID、结果文件和 UI 回显。
4. 审核全量原图和 AI 结果，明确通过供视频使用的图片；验证驳回图不进入视频素材库。
5. 新增一条软件管家任务，上传已审核图片并执行真实生成/下载；如业务侧阻塞，记录脱敏响应码和页面证据。
6. 新增一条 Seedance 2.0 任务，时长不超过 5 秒，等待完成并下载 MP4。
7. 新增一条 HappyHorse 任务，时长不超过 5 秒，等待完成并下载 MP4。
8. 对每个 MP4 校验存在、非零、容器/时长；结果页必须回显 provider、task ID、状态和本地路径。

任何失败先按“观察 -> 根因 -> 失败测试 -> 单点修复 -> 重试”处理，不跳过失败环节。

执行证据：

- 工作区：`/Users/xingyicheng/Downloads/巴拉AI视频素材/208326102205-20260715-live`
- 找图：款号 `208326102205`，127 张素材，其中 48 张模拍、79 张细节。
- AI 改图：换背景 `0d546dbb6576483e88d404e02947661b`、换脸 `73472428e5cd4d27bc9781f6bcc6274c`、换装 `aabfe5b0bdb244e785b0a7e6f33b45db`、换姿势 `35fa6ff0cec04700b88434d4c7080aa5`、精确单图修改 `3b0dcbcb310d49f0a45aa1ef826ecdee`。
- 软件管家：运行 ID `22`；`9222` 实际观察为千牛登录页，终态错误为 `软件管家页面加载超时，请保留已登录页面后重试`，未创建可验证的生成任务或 MP4。
- Seedance：任务 `cgt-20260716015202-rpz94`；隐私保护触发后按产品规则降级为文字描述的原创人物模式；本地 MP4 为 `208326102205_seedance_20260716-015202.mp4`，5.042 秒。
- HappyHorse：任务 `4a9890b4-191c-4359-86b9-83ba0adb0949`；本地 MP4 为 `208326102205_happyhorse_i2v_20260716-015636.mp4`，5.075 秒。
- Electron 结果页已读回三条持久化结果：Seedance/HappyHorse 为已完成，软件管家为失败并显示具体原因。

## Task 5：完成主链路后的只读 code review

审查范围：`origin/main...HEAD` 和本轮未提交 diff。只读代理输出 P0/P1/P2、触发条件、影响、文件和行号。主会话逐条复现，虚假 finding 不修；真实 finding 先写失败回归测试再统一修复。

优先复核：

- 本地文件接口权限和路径边界。
- Excel 最终路径一致性。
- 指定模板不存在时是否错误回退。
- 审核 HTML 转义。
- 重跑任务、审核状态和视频候选池语义。
- 视频任务/结果恢复和真实下载动作。
- 抓虾 skill 的危险点击、下载归属和阶段失败传播。

执行结果：三路只读审查未发现 P0；后端/provider 和前端最终复核无 finding。抓虾运行时最后一个 P2 是旧 journal 句子内嵌相对 URL 的敏感 query 未脱敏，已按失败回归测试修复。其余真实 finding 包括审核保存失败传播、本地审核持久化、QN 终态/行级失败传播、危险控件识别和旧 journal 全区域脱敏，均已统一修复。

## Task 6：最终对齐与交付门禁

再次逐条对齐指定 spec 与 HTML 视觉锚点，并在真实 Electron/浏览器表面走查五步。

至少运行：

```bash
node --test tests/bala-ai-video-workflow-ui.test.js
python3 -m unittest tests.test_bala_ai_video_assistant_packaging
npm --prefix integrations/seedanceCLI test
npm --prefix integrations/bailianCLI test
npm --prefix app run vite:build
npm --prefix app test
```

同时运行本轮新增的 Python/Node 回归套件、`git diff --check` 和凭据扫描。所有门禁通过后创建一个本地 commit，并确认 `main` 工作区 clean。

Electron 五步走查结果：找图默认 0 选中并以 20 张为一批；AI 改图、审核和视频素材池承接真实工作区状态；同款号存在软件管家、Seedance、HappyHorse 三条独立视频任务；失败的软件管家结果卡不会显示预览、重新下载或打开文件，只提供返回生视频。

最终门禁结果：工作流 UI 56/56、Bala/安全 Python 36/36、Seedance 6/6、HappyHorse 8/8、原子适配器与工作区文件 26/26、桌面应用 244/244、抓虾 skill 75/75；Vite production build 通过，凭据候选文件 0，`git diff --check` 通过。
