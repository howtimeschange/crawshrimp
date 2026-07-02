# 唯品会轻供款商品报表 API 探查记录

- SOP 附件流程包含两个报表：
  - 商品信息：`https://vis.vip.com/index.php#/app-i/nov-admin-i-simple/vendor/normal/normalMerchandise?...`
  - 商品明细：`https://compass.vip.com/frontend/index.html#/product/details`
- 货品匹配表为单 sheet：`大货款号`、`类别`；本次样例共 5869 行，`轻供` 1893 行。
- 商品明细页当前筛选通过 `POST https://compass.vip.com/product/detail/getGoodsList` 分页读取。
  - 已验证 payload 示例：`brandStoreSn: "all"`, `dtType: 0`, `calType: 1`, `startDt/endDt: YYYYMMDD`, `queryHll: false`, `pageNo`, `pageSize`, `dimType: 0`, `channelType: 1`。
  - 当前页面 500 条/页可稳定返回，响应结构为 `data.goodsList` + `data.total`。
  - 款号字段使用 `osn`，货号字段使用 `goodsNo`。
- 商品信息页在 `vis.vip.com` 外壳的 `nov-admin.vip.com` iframe 中，列表接口为 `POST https://nov-admin.vip.com/normal/normalMerchandiseQuery`。
  - 已验证 payload 示例：`{ "pageNo": 1, "pageSize": 500, "param": {} }`。
  - 响应结构为顶层 `data` 数组 + 顶层 `total`。
  - 款号字段使用 `osn`，货号字段使用 `msn`。
- 浏览器 CORS 结果：
  - 从罗盘页 `compass.vip.com` 可直接 `fetch` 供应商平台 `nov-admin.vip.com` 商品信息接口。
  - 从供应商平台页反向调用罗盘商品明细接口会被浏览器拦截。
  - 因此任务入口固定为罗盘商品明细页，脚本在该页一次生成双报表。
