# 唯品会包装+主图替换 API 探查（2026-08-03）

## 文档流程要点

- 输入表需要同时保留「款号」和完整「货号/款色号」，不能只按款号宽泛匹配。
- 包装流程：商品资料按货号搜索 -> 取消提交审核 -> 编辑 -> 在「货号与条码」中用完整货号匹配颜色名称备注 -> 商品图片中只更新对应颜色；拼款时只更新目标商品款号对应颜色并备注。
- 包装图片：微详情使用 1200x1200；商品详情图使用 `images` 或 `切片` 目录切片，跳过整张预览图；`balaone` 头图应在详情首位。
- 主图打标流程：按完整货号搜索 -> 取消提交审核 -> 编辑 -> 商品图片上传 1200x1200 对应颜色主图并置首 -> 商品列表图上传 950x1200。

## 已验证只读接口

- 商品资料列表：`POST https://nov-admin.vip.com/normal/normalMerchandiseQuery`
  - JSON payload：`{ pageNo, pageSize, param: { msnSet: ["完整货号"] } }`
  - 返回行包含：`merchandiseNo`, `msn`, `osn`, `vendorSpuId`, `prodSpuId`, `name`, `skuStatus`, `imageUrl`。
- PDC 商品详情：`POST https://pdc-portal.vip.com/product/queryVendorProductByVpIdForVc`
  - form payload：`vendorProductId=<V_SPU>&vendorType=1`
  - 注意：该老页面接口用 `application/x-www-form-urlencoded`；JSON payload 会返回 ID 非法。
  - 返回 `result.itemSkuAttr[]`，关键字段为 `colourGSN`, `colourName`, `imageGroupIdStr`, `sizeAttr[]`, `colourImages[]`, `squareImages[]`。

## 编辑页与后续 live 端点线索

- 列表页编辑入口：`https://vis.vip.com/portal-iframe.php#!/app-v/pdc-vue/product/edit/{vendorSpuId}/1`
- 运行入口建议使用 `https://nov-admin.vip.com/admin/index.html#/normal/normalMerchandise`。外层 `vis.vip.com`/PDC 顶层页读取 `nov-admin` 商品资料接口会被浏览器 CORS 拦截；`nov-admin` 执行上下文可同时读取商品资料和 PDC 详情。
- PDC 静态包暴露的上传/保存端点：
  - `/product/uploadMainImage`
  - `/product/uploadListImage`
  - `/product/uploadDetailImage`
  - `/product/saveProduct?editPreCheck&vendorType=1`
  - `/product/saveProduct`
  - `/product/publishProduct`
- live 上传/保存需要继续抓取真实文件上传请求体和保存 payload，并且必须通过独立确认后再执行。

## 示例只读验证

- `20132610801500311` 命中 `201326108015` 的目标颜色 `白色调`，当前 PDC 回读为「已提交审核」，需要先取消提交审核/撤回后再编辑。
- `20032610810600488` 命中 `200326108106` 的目标颜色 `蓝色调`，当前 PDC 回读为「草稿/可编辑」。
