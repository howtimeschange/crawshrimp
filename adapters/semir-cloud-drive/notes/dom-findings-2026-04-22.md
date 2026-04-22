# Semir Cloud Drive DOM / API Findings

Date: 2026-04-22
Adapter: `semir-cloud-drive`
Task: `batch_image_download`
URL: `https://fmp.semirapp.com/web/index#/home/file`

## Summary

- Page stack is Vue 2 + Element UI.
- Mount `巴拉营运BU-商品` resolves to `mount_id=2023` via `GET /fengcloud/1/account/mount`.
- Folder navigation is URL-driven after the mount is known:
  - route pattern: `#/home/file/mount/<mount_id>?path=<urlencoded relative path>`
  - direct URL navigation to a deep path works without double-click traversal.
- Global search is URL-driven and API-backed:
  - route pattern: `#/home/file/mount/<mount_id>/search?keyword=<keyword>&mount_id=<mount_id>&scope=%5B%22filename%22,%20%22tag%22%5D`
  - search API: `POST /fengcloud/2/file/search`
  - form body example:
    - `size=100&start=0&keyword=208226111002-00316&mount_id=2023&scope=%5B%22filename%22%2C%20%22tag%22%5D`
- Search API returns enough metadata to do API-first filtering:
  - `filename`
  - `fullpath`
  - `dir`
  - `ext`
  - `filehash`
- Per-file download URL comes from:
  - `GET /fengcloud/2/file/info?fullpath=<...>&mount_id=2023`
  - response fields of interest:
    - `uri`
    - `uris`
    - `preview`
    - `thumbnail`

## DOM Findings

- Left mount entry:
  - text node under `li.mount-item`
  - clicking `巴拉营运BU-商品` switches route to `#/home/file/mount/2023`
- Folder list rows:
  - selector shape: `tr.gk-table-item.is-folder`
  - row text contains `文件夹名 + 最近修改人 + 最近修改时间`
  - opening a folder from the list behaves like double-click.
- Search box:
  - top-right input selector: `input.el-input__inner`
  - placeholder: `按Enter键搜索文件`
  - component ancestry includes `SearchBar`

## Search Evidence

### Exact SKC sample

Keyword: `208226111002-00316`

Observed `POST /fengcloud/2/file/search` response:

- `total=3`
- relevant filenames:
  - `208226111002-00316.jpg`
  - `208226111002-00316.jpg`
  - `208226111002-00316-1.jpg`

Conclusion:

- Exact SKC search should accept the exact stem plus an optional trailing numeric suffix like `-1`.

### SPU sample

Keyword: `208226111002`

Observed `POST /fengcloud/2/file/search` response includes mixed asset types:

- image files:
  - `208226111002.jpg`
  - `208226111002-00316.jpg`
  - `208226111002_01.jpg`
  - many other `208226111002-<color>.jpg`
- non-image files:
  - `208226111002.psd`
  - `货号208226111002 尺码表.pdf`
  - `208226111002-AI.mp4`
- directories:
  - `208226111002`
  - `208226111002包装图`

Conclusion:

- SPU search must filter by:
  - `dir != 1`
  - image extension only
  - configured `fullpath` prefix
  - filename stem starts with the SPU, allowing `-` and `_` suffix branches

## Implementation Decision

- Use API-first collection:
  - mount lookup via `account/mount`
  - search via `file/search`
  - signed download URL via `file/info`
- Do not depend on visible highlighted rows or toolbar download links for the core batch logic.
- Use runtime `download_urls` for artifact creation, then package results on the backend into:
  - grouped folder by input code
  - zip archive
  - summary Excel
