# 天猫素材测图探路 API 记录

日期：2026-07-01

## 目标

先在抓虾 `tmall-ops-assistant` 适配器内验证“森马云盘找图 -> 天猫素材中心测图任务 -> 测图数据读取/导出”的页面 API。稳定后再把编排、任务状态、报表沉到独立的“巴拉电商 AI 工作台”。

测试款：

- 商品 ID：`1060862679580`
- 款号/编码：`208326121203`

## 已验证

- 天猫素材测试页已在登录态页面中可调用 `window.lib.mtop.request`。
- 商品查询 API 能找到 `1060862679580`，标题为 `【balaOne】巴拉巴拉儿童卫衣男童女童2026秋季新款长袖上衣时尚`。
- 天猫素材测图列表用该商品 ID 查询返回 `total=0`，说明当前没有已存在的搜索测图任务。
- 森马云盘在 `巴拉营运BU-商品` 挂载点 `2023` 下搜索 `208326121203` 返回 24 条，指定秋季路径内 23 条，并能读取候选图片信息。
- 本阶段只做只读探路和 payload 计划；创建/加图/上线被 `allow_live_mutation` 显式保护。

## 森马云盘 API

挂载点：

```text
GET /fengcloud/1/account/mount
```

文件搜索：

```text
POST /fengcloud/2/file/search
Content-Type: application/x-www-form-urlencoded

size=100
start=0
keyword=208326121203
mount_id=2023
scope=["filename", "tag"]
```

文件信息：

```text
GET /fengcloud/2/file/info?mount_id=2023&fullpath=...
```

当前候选图排序规则：

- 只保留图片扩展名：`jpg/jpeg/png/webp/bmp/gif/tif/tiff`。
- 排除 `psd/pdf/ai/cdr/zip/rar/7z` 以及尺码表、制单、源文件、视觉推荐等非测图素材。
- 优先 `已选`、`yz`、`模拍原图`、`平拍原图`、`主图原图`、文件名含款号的候选。

## 天猫 MTop API

商品查询：

```js
api: "mtop.taobao.qianniu.shop.item.search"
data: {
  searchType: "all",
  param: JSON.stringify({
    currentPage: 1,
    pageSize: 24,
    k: "1060862679580"
  })
}
```

测图任务列表：

```js
api: "mtop.taobao.qn.copilot.framework.listmodel.data.search"
data: {
  modelCode: "image_test_mgr",
  params: JSON.stringify({
    tabCode: "all",
    testChannel: "common_search",
    itemIdOrName: "1060862679580"
  }),
  currentPage: 1,
  pageSize: 10
}
```

创建搜索测图任务：

```js
api: "mtop.taobao.qn.copilot.test.image.task.create"
data: {
  source: "qn",
  itemId: "1060862679580",
  imageTestSources: JSON.stringify(["COMMON_SEARCH"])
}
```

添加 3:4 测图素材：

```js
api: "mtop.taobao.qn.copilot.test.image.batch.add"
data: {
  experimentTaskId: "<taskId>",
  itemId: "1060862679580",
  source: "common_search",
  materials: JSON.stringify([
    { sourceType: 4, picUrl: "https://img.alicdn.com/...", size: "3:4" }
  ])
}
```

上线测图任务：

```js
api: "mtop.taobao.qn.copilot.test.image.task.online"
data: {
  source: "qn",
  itemId: "1060862679580",
  taskStatusList: JSON.stringify([
    { experimentTaskId: "<taskId>", source: "common_search" }
  ])
}
```

测图数据下载/读取：

```js
api: "mtop.taobao.qn.copilot.test.image.data.download"
data: {
  startDate: "YYYYMMDD",
  endDate: "YYYYMMDD",
  itemIds: JSON.stringify(["1060862679580"]),
  statisticType: "ACCUMULATE_30_DAYS"
}
```

## 独立 app 沉淀边界

独立工作台应保留“任务项”架构，把 `AI 测图任务` 作为一个任务类型：

- 输入层：业务 Excel、款号、商品 ID、AI 生成图 URL 或待上传文件。
- 资产层：森马云盘搜索、候选图排序、人工确认/勾选。
- 天猫层：商品查询、已有任务读取、创建任务、添加素材、上线任务。
- 数据层：定时拉取测图数据、保存历史、生成点击率/转化率报表。
- 安全层：创建/上线、替换主图、提交发布等动作必须有显式确认和回读校验。

当前仍待补齐的稳定逻辑：

- “本地/AI 生成文件 -> 天猫可用 `picUrl`” 的上传桥已捕获到素材选择器与上传组件端点；尚未执行真实文件上传，后续需要一次显式授权的小图上传来验证返回字段。
- 跨森马云盘与天猫素材中心的多页面编排适合放在独立 app 的任务调度层，而不是强行塞进单一页面脚本。

## 天猫素材上传端点

入口由测图任务里的空素材卡“上传”打开，实际加载素材选择器：

```text
GET https://market.m.taobao.com/app/crs-qn/sucai-selector-ng/index

type=pic
mime=png,jpg
needCrop=true
handleId=pic_space
picMaxSize=20MB
needClose=true
minWidth=undefined
bizScene=material_test
max=5
aspectRatio=1:1
```

本次捕获到的前端包：

- `crs-qn/sucai-selector-ng@0.0.78`
- `merchant-micro-mods/sucai-tu-selector@0.0.82`
- `merchant-micro-mods/sucai-center-components@0.0.50/PicUpload`

上传组件初始化会读取：

```js
api: "mtop.taobao.picturecenter.console.user.upload.config.query"
data: {}
```

普通图片上传使用：

```text
POST https://stream-upload.taobao.com/api/upload.api

query:
  appkey=tu
  folderId=0
  watermark=false
  picCompress=true
  _input_charset=utf-8

multipart:
  file=<image file>
  _tb_token_=<page cookie token>
  name=<file name>
  water=false
  ua=<window.uabModule.getUA(...)，可选>
```

普通上传成功结果由组件按以下字段读取：

```text
object.fileId   -> 素材 ID
object.folderId -> 文件夹 ID
object.url      -> fullUrl / picUrl
object.pix      -> 图片尺寸
object.size     -> 文件大小
object.quality  -> 质量分
```

上传成功后还有埋点/耗时回传：

```text
GET https://stream-upload.taobao.com/api/collect_client_upload_rt.api
query:
  file_Id=<fileId>
  rt=<upload ms>
  appkey=tu
```

大文件/分片路径由同一 `PicUpload` 组件控制，只有 `upload.config` 返回启用且文件超过阈值时触发：

```js
api: "mtop.taobao.mediacenter.pc.image.upload.config"
data: { bizCode: "tu" }
```

```js
api: "mtop.taobao.mediacenter.pc.image.upload.init"
data: {
  sha256: "<sha256>",
  bizCode: "tu",
  fileSize: 26214400,
  fileName: "208326121203-测试图.jpg",
  dirId: "0",
  clientType: 1,
  pixel: "1440x1920",
  fileType: "jpg"
}
```

如果 `upload.init` 没有直接返回 `imageUploadDTO`，前端会把文件按 `model.uploadPolicy.sliceSize` 切片，对 `model.uploadUrlList[].url` 逐片 `PUT`：

```text
PUT <uploadUrlList[].url>
Content-Type: application/octet-stream
body=<file chunk>
```

每片取响应头 `ETag` 作为 `partList[].md5`，然后合并：

```js
api: "mtop.taobao.mediacenter.pc.image.upload.complete"
type: "POST"
data: {
  bizCode: "tu",
  uploadId: "<uploadId>",
  clientType: "1",
  partList: JSON.stringify(partList.map(item => JSON.stringify(item)))
}
```

分片上传最终读取：

```text
model.imageUploadDTO.fileId
model.imageUploadDTO.url
model.imageUploadDTO.pixel
model.imageUploadDTO.quality
```
