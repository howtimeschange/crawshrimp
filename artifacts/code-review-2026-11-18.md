# Crawshrimp main 分支代码审查

2026-11-18 · v2.5.16 · `efca3ec20933415a7231faa6947ce21962668d8f`

本地与远端 main 在审查时指向同一提交。共确认 19 项问题，其中 4 项 P1、15 项 P2。复核在独立检出的提交副本中进行。涉及供应商、天猫和云端写入的场景使用本地替身，保留实际业务代码。

## P1 · 优先修复

1. **云端驳回图片无法在任务机上重新生成**　云端给重生任务分配新的结果素材 ID，并另存被驳回素材的 ID。任务机把新 ID 填入临时审批批次，却要求天猫适配器在该批次查找旧 ID。本地使用真实适配器复核，调用在访问生图服务前就报“未找到审批图片”。现有测试替换了整个重生函数。应在本地批次保留旧 ID，上传新图时再用结果 ID。 [临时审批批次](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/core/cloud_job_executors.py#L451) · [查找素材](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/adapters/tmall-ops-assistant/tools/run_tmall_ai_image_test_chain.py#L1946) · [现有测试](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/tests/test_cloud_job_executors.py#L239)

2. **一次提交 99 张批准图片会留下半完成的天猫回写**　任务机报告天猫提交成功后，Worker 先把批次改为 submitted，再用一条 SQL 更新素材。该语句绑定时间、批次 ID 和每张图的 ID。用实际 SQL 在本地 D1 执行，98 张成功，99 张报 too many SQL variables。此时批次已锁定，素材仍是 approved，任务也没有完成。应在一个 D1 事务中更新批次、素材、款式和任务，并按参数限额分块。 [提交回写](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/cloud/approval-workbench/src/worker/machine-routes.ts#L897) · [D1 官方限额](https://developers.cloudflare.com/d1/platform/limits/)

3. **云端直接生图在提交回执丢失后可能重复计费**　在线生图页面没有为一次提交生成稳定标识。若服务已接单而浏览器丢失响应，重试会生成新的 request_uid，传给 1XM 的幂等键也随之改变。在模拟上游对同一请求重试，两次都返回 201，创建了两个不同幂等键。应由客户端为每次有意发起的生成创建标识，重试沿用它，由服务端返回已有任务。 [创建生成请求](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/cloud/approval-workbench/src/worker/batch-routes.ts#L634) · [页面提交](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/cloud/approval-workbench/src/app/views/OnlineGenerationView.vue#L290)

4. **1XM 代理托管上游密钥时，缺少代理凭据会放行付费请求**　代码允许单独配置上游密钥。此时 Worker 会代填付费账户凭据，而代理令牌缺失时鉴权直接通过。公开部署若使用这组配置，匿名请求可消耗账户额度。托管密钥模式应强制启用调用方鉴权，并在配置不全时拒绝转发。本项为源码审查，线上密钥配置未核验。 [代理鉴权](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/cloud/one-xm-proxy/src/index.js#L248) · [上游凭据选择](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/cloud/one-xm-proxy/src/index.js#L314)

## P2 · 影响特定数据或运行条件

5. **晚到的轮询响应会清空已完成的生图结果**　两个审核页面同时轮询时，较新的请求可以先保存 completed 和素材 ID。较早请求随后收到 running，会无条件覆盖状态并清空结果 ID。本地控制响应先后顺序，观察到 completed 退回 running，结果列表变为空。应限制 running 更新的前置状态，竞争失败时读回最新记录。 [轮询更新](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/cloud/approval-workbench/src/worker/batch-routes.ts#L749) · [写入条件](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/cloud/approval-workbench/src/worker/batch-routes.ts#L1402)

6. **一次轮询断网会终止仍在上游执行的生成任务**　已有上游任务 ID 时，查询过程中的连接异常也会把生成请求写成 failed。模拟一次读连接中断，首次轮询返回 502，网络恢复后的再次轮询直接返回 409。应保留上游句柄和可轮询状态，区分暂时的查询失败与供应商确认的任务失败。 [轮询异常处理](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/cloud/approval-workbench/src/worker/batch-routes.ts#L783) · [后续轮询门槛](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/cloud/approval-workbench/src/worker/batch-routes.ts#L731)

7. **云端最终保存图片时中断，生成请求会永久停在 finalizing**　Worker 先把请求标记为 finalizing，再写入 R2 和数据库。若执行实例在两步之间终止，没有接管超时任务的逻辑。为旧记录连续调用轮询，两次均返回 202，重新打开页面也不会主动恢复该状态。应为最终保存设置可过期的占用时间，按已有确定性素材 ID 恢复。 [终态等待分支](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/cloud/approval-workbench/src/worker/batch-routes.ts#L728) · [页面恢复条件](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/cloud/approval-workbench/src/app/views/OnlineGenerationView.vue#L320)

8. **大批量天猫任务在下载素材期间不会续租**　任务机串行下载全部批准图片，同款每张图还会再下载一次原图。第一次续租发生在整批下载之后，后台续租器仅覆盖后续天猫提交。下载时间超过 300 秒时，任务会在提交前失去租约，且该类任务只有一次尝试。应让续租覆盖下载阶段，并按款复用已下载原图。 [下载与续租](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/core/cloud_job_executors.py#L234) · [重复下载原图](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/core/cloud_job_executors.py#L529) · [租期](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/cloud/approval-workbench/src/worker/machine-routes.ts#L67)

9. **启用第 101 个模板后，云端提示词库无法解析**　解析接口把所有启用模板的 ID 绑定到一条 SQL 查询，再对返回结果应用展示数量限制。101 个模板就超过 D1 每条语句的 100 个参数上限，即使调用方只取一条也会失败。应使用按库查询的 JOIN 或分块读取版本。 [载入启用模板](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/cloud/approval-workbench/src/worker/prompt-routes.ts#L481) · [绑定模板 ID](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/cloud/approval-workbench/src/worker/prompt-routes.ts#L683)

10. **本地生图重启恢复时，会锁死尚未发出的排队项**　批量生图先保存整个队列，再由线程池分批发出请求。若此时退出，尚未获得线程的项仍为 pending_submission，也没有 submitted_at。恢复逻辑会把它们与已经发出但丢失回执的项一起标成 UNKNOWN_SUBMIT_RESULT，随后禁止重试。本地用临时数据库验证了该状态变化。应依据持久化的提交标记区分两种情况。 [重启恢复](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/core/ai_image_service.py#L1371) · [初始状态](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/core/ai_image_service.py#L1507) · [提交前预留](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/core/ai_image_service.py#L1072)

11. **禁用适配包后仍可运行，重启还会恢复为启用**　禁用接口只更新内存并移除清单自带的调度项。手动运行入口只检查适配包和任务是否存在，用户创建的定时任务也走独立入口。本地禁用后调用正常运行接口，仍进入启动函数；重新加载适配包后 enabled 又变为 true。应持久化开关，并让手动、实例和定时执行共用启用检查。 [任务启动](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/core/api_server.py#L13820) · [用户定时任务](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/core/api_server.py#L13679) · [启用状态存储](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/core/adapter_loader.py#L304)

12. **Electron 完成后端端口切换后，本次请求仍发往旧端口**　apiCall 在等待后端就绪前就捕获端口和令牌。若就绪检查切换后端，原请求及其重试仍使用之前的连接参数。用两个本地服务模拟切换，响应来自旧服务。应在每次就绪检查完成后解析端口和对应凭据。 [捕获连接参数](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/app/src/main.js#L1243) · [请求执行时机](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/app/src/backendController.js#L269)

13. **后端响应传输中断时，桌面操作会一直等待**　通用 HTTP 调用监听了请求错误和响应结束，却没有处理响应体已开始后的 aborted、error 或提前关闭。用本地后端发送部分 JSON 后断开，设置 80 毫秒超时的 Promise 在 400 毫秒后仍未结束。应统一结算响应中断和超时；已有健康检查实现可复用。 [通用 HTTP 调用](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/app/src/backendApi.js#L246) · [健康检查的中断处理](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/app/src/backendHealth.js#L60)

14. **迷你巴拉图包复核会把全透明图判为原图一致**　用于判定“原图一致”的指纹先移除透明通道，再缩至 96 像素。两张同尺寸 PNG 只要缩图 RGB 相同便会跳过后续视觉比较。用不透明黑图和完全透明图验证，输出被判一致，未进入待复核列表。应比较全尺寸 RGBA 像素，缩图只用于近似匹配。 [指纹生成](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/core/mini_bala_reference_review.py#L19) · [复核判定](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/core/mini_bala_reference_review.py#L61)

15. **迷你巴拉文案缺少颜色时会生成虚构色号 00000**　没有有效款色号时，空的颜色编码会被 zfill(5) 补成 00000，随后通过五位数字校验。本地输入仅含款号和文案的记录，颜色映射中就出现了 00000。若素材也没有颜色线索，后续会把它当唯一颜色并用于目录、标签归类。应先验证原字段非空且为数字，再保留前导零。 [颜色解析](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/core/mini_bala_packaging.py#L72) · [图片颜色兜底](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/core/mini_bala_packaging.py#L403)

16. **两个视频 CLI 的下载中断会破坏已有成品**　Seedance 和百炼 CLI 都直接向用户指定的最终路径写流。用原先已有内容的文件模拟下载中断，两者最后都只留下已收到的部分字节。应在同目录写入临时文件，成功结束后再原子替换成品。 [Seedance 下载](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/integrations/seedanceCLI/src/ark-client.js#L115) · [百炼下载](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/integrations/bailianCLI/src/bailian-client.js#L126)

17. **相邻版本并行发布时，GitHub 的 latest 可能回退**　R2 发布有共享锁和版本比较，后续 GitHub 发布步骤脱离这把锁。若较旧版本先完成 R2、后完成 GitHub，它可以重新取得 latest 标记，或把 desktop-latest 强制指回旧提交。应按发布目标串行更新两个公共指针，并在实际写入前再次比较版本。本项依据工作流顺序和并发配置判定。 [R2 并发控制](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/.github/workflows/build-desktop.yml#L598) · [滚动标签](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/.github/workflows/build-desktop.yml#L586) · [正式版 latest](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/.github/workflows/build-desktop.yml#L1032)

18. **开发启动日志会写出可复用的本地 API 令牌**　dev.sh 每次启动都会把从运行目录读取或生成的完整令牌写到标准输出。开发者一旦把终端日志附到问题单，就会连同仍有效的凭据一起分享。保留验证头名称与配置状态即可，令牌值应仅从受限文件或环境变量读取。 [启动日志](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/dev.sh#L37)

19. **1XM 代理对分块 JSON 的重写大小限制失效**　缺少 Content-Length 时，代理会把整个响应读入内存，然后解析并重新序列化。将上限设为 1 KiB，模拟返回超过 1.5 KiB 且不带长度的 JSON，仍发生了重写。大图的 Base64 响应会造成多份内存占用，并可能触发 Worker 内存限制。应按实际读取字节数设置上限，超过时转为流式透传。 [JSON 代理响应](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/cloud/one-xm-proxy/src/index.js#L164)

## 审查与验证范围

| 范围 | 实际验证结果 |
| --- | --- |
| Python 后端和业务处理 | 1,781 项通过，另有 175 个子测试通过。1 项 Amazon 标签样本用例因缺少指定 PDF 和 Excel 跳过 |
| 桌面端、渲染器、打包脚本 | 533 项通过，含真实图片解码与 PDF Worker 测试。Vite 生产构建通过 |
| 根目录 JavaScript 测试 | 1,384 项通过，涵盖适配器、操作流程与桌面界面契约 |
| 云审批工作台 | TypeScript 检查、243 项测试、生产构建通过。另用本地 D1 验证了第 2 项的实际 SQL，用模拟上游验证了生成请求重试、轮询竞争和异常恢复 |
| 1XM 代理与视频 CLI | 代理 9 项、Seedance 与百炼合计 22 项通过 |
| 随仓技能与 SDK | 技能 82 项及 18 个子测试通过。25 个内置适配包、SDK 模板通过清单校验，99 个任务的脚本均能在包内定位 |
| 发布流程 | 静态审查 GitHub Actions 的构建、恢复、R2 更新和 GitHub 发布依赖及并发控制 |

合计 **4,054 项既有测试通过，1 项跳过**，另有 193 个通过的 Python 子测试。桌面和云端前端构建均有包体积提示。现有 GitHub Actions 的 `Test` 作业运行桌面、根目录 JavaScript 和 Python 测试，云审批、代理、视频 CLI 和随仓技能测试是本次单独运行的。[CI 测试作业](https://github.com/howtimeschange/crawshrimp/blob/efca3ec20933415a7231faa6947ce21962668d8f/.github/workflows/build-desktop.yml#L69)

本次未运行真实店铺提交、付费生成、生产部署或跨平台安装包签名。业务影响对应报告中注明的触发条件，生产发生频次未核验。
