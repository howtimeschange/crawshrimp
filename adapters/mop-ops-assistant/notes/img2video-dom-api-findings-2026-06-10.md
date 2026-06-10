# 千牛素材中心图生视频探查记录

目标页：`https://qn.taobao.com/home.htm/material-center/video-production/img2video`

探查方式：连接本机 9222 端口已登录 CDP 浏览器，仅执行只读 DOM / MTop 调用，没有点击“立即生成”或提交真实任务。

## 页面状态

- 当前页面标题：`素材中心`
- 页面正文包含：`商品素材管理`、`视频生产`、`选择商品`、`立即生成`、`行业模板`
- 初始状态可见按钮包括：`解说视频`、`解说配置`、`立即生成`、`换图做同款`
- 初始 DOM 没有可见 `input[type=file]`，上传应使用脚本创建隐藏 input 并由抓虾 `inject_files` 注入本地文件，再调用页面上传 helper。

## 可用前端能力

- `window.lib.mtop.request` 存在，可直接调用千牛页面自己的 MTop 客户端。
- `window.$startFileUpload` 存在，可把 data URL 上传为图片中心/千牛可用图片 URL。
- 店铺类目接口返回示例：
  - `mainCateId`: `16`
  - `mainCateIdLv2`: `30`
  - `mainCateName`: `女装/女士精品`
  - `mainCateNameLv2`: `男装`
- `mtop.taobao.qn.copilot.video.template.list` 以 `女装/女士精品` 查询时返回 152 个模板。

## 关键 MTop 接口

- `mtop.taobao.qn.copilot.node.aigc.seller.category.get`
- `mtop.taobao.qn.copilot.video.template.list`
- `mtop.taobao.qianniu.shop.item.search`
- `mtop.taobao.qn.copilot.item.material.get`
- `mtop.taobao.qn.copilot.img2video.template.video.generate`
- `mtop.taobao.qn.copilot.video.template.generate`
- `mtop.taobao.qn.copilot.quick.video.generate.task.submit`

## 实现策略

- API 优先，不模拟“选择商品/立即生成”的 DOM 点击。
- 本地素材通过抓虾 `inject_files` 注入隐藏 input；脚本读取 `File` 后转 data URL，调用页面 `$startFileUpload` 获取远程图片 URL。
- 模板模式优先：
  - 精确匹配 `模板ID`
  - 再按 `模板主题` 匹配模板名称/描述/分类
  - 再按图片数量选择能吃满素材槽位的模板
- 默认预检不提交；只有 `execute_mode=live` 时才上传和调用生成接口。
