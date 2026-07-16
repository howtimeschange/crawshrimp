# 千牛生意管家 img2video 页面探查记录 2026-07-15

页面：`https://quick.taobao.com/videostudio/img2video`

## 页面能力

- 当前 9222 登录页标题为“生意管家”。
- 页面暴露 `window.$startFileUpload(dataUrl)`，可把本地图片上传到淘系 OSS，返回在线图片 URL。
- 页面暴露 `window.lib.mtop.request(...)`，可在当前登录态内调用 MTop。
- 店铺类目接口：
  - `mtop.taobao.qn.copilot.node.aigc.seller.category.get`
  - 实测返回主类目：`童装/婴儿装/亲子装`

## 模板目录

模板列表接口：

```text
mtop.taobao.qn.copilot.video.template.list
```

请求参数：

```json
{"mainCategory":"童装/婴儿装/亲子装"}
```

实测模板数：26。

模板关键字段：

- `templateId`
- `name`
- `type`
- `ratio`
- `duration`
- `coverUrl`
- `videoUrl`
- `provider`
- `inputImages`

童装页当前模板多为 `type=action`，输入槽位通常为 `code=7` / `slotName=模特全身`。

## 上传与提交

本地图片上传：

```js
const uploaded = await window.$startFileUpload(dataUrl)
```

实测返回 URL 示例：

```text
https://img.alicdn.com/imgextra/i2/642320867/O1CN01cmBcJ81IH8XgDmBVb_!!642320867-2-qnaigc.png
```

action 模板提交接口：

```text
mtop.taobao.qn.copilot.img2video.template.video.generate
```

请求核心参数：

```json
{
  "templateId": "641241_62536236_21",
  "templateVO": "{...完整模板 JSON...}",
  "imageUrl": "https://img.alicdn.com/...",
  "prompt": "",
  "provider": "content"
}
```

非 action 多槽位模板保留接口：

```text
mtop.taobao.qn.copilot.video.template.generate
```

请求核心参数：

```json
{
  "templateId": "...",
  "templateVO": "{...完整模板 JSON...}",
  "modelVO": "",
  "provider": "...",
  "modelImages": "{\"front\":\"...\"}",
  "inputImages": "[{\"code\":\"0\",\"imageUrl\":\"...\"}]"
}
```

## 任务状态与视频结果

提交返回的 `result.task.id` 是后续轮询使用的数字任务 ID。

实测提交返回：

- 数字任务 ID：`157159610967`
- `funcType`: `template_generate_video`
- 初始 `status`: `0`

状态轮询接口：

```text
mtop.taobao.qn.copilot.quick.task.get
```

请求参数：

```json
{"id":157159610967}
```

完成状态：

- `task.status = 1`
- `task.result` 是 JSON 字符串
- 视频 URL 位于 `result.compositeVideo.videoUrl` 或 `result.videoList[0].videoUrl`
- 封面位于 `result.compositeVideo.coverUrl`
- 内容 ID 位于 `result.compositeVideo.contentId`

实测完成视频 URL 形态：

```text
http://video-data-online.oss-cn-zhangjiakou.aliyuncs.com/audio_vision_production/qianniu/outputs/20260715/....mp4
```

`mtop.taobao.qn.copilot.quick.item.customized.offline.result.pull` 也会在页面加载/我的作品中出现，但实测参数为：

```json
{"sceneCode":"QUICK","forcePull":false}
```

它当前更像结果提醒/未读结果入口，刚提交任务轮询应优先使用 `quick.task.get`。
