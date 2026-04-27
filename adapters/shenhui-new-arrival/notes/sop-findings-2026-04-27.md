# 深绘上新助手 SOP Findings

Date: 2026-04-27
Adapter: `shenhui-new-arrival`
Task: `prepare_upload_package`, `pdf_batch_screenshot`, `upload_to_deepdraw`

## Scope

This adapter splits the SOP into three user-visible tasks:

- `整理深绘上新图包`
- `PDF 批量截图`
- `上传深绘图片包`

The packaging task implements the cloud-drive collection half of the SOP:

- resolve the two Semir cloud-drive source paths:
  - 静物图 / 平拍原图
  - 模特图 / 模拍原图
- search by style code or color code to locate matching folders under the user-specified source directories
- recursively download assets from matched folders, instead of treating direct image search hits as standalone targets
- merge model and still assets into one style-code folder
- filter unusable assets according to the SOP
- download retained assets and export:
  - one DeepDraw-ready ZIP per style code
  - one full audit ZIP containing the complete style-code folder tree
  - an Excel summary
- skip cloud-drive PDF files; PDF screenshot/cropping is handled only by the separate local `PDF 批量截图` task

The DeepDraw website upload step is implemented as a separate task, `upload_to_deepdraw`. It defaults to dry-run queue validation; switching execution mode to production upload directly calls DeepDraw upload. See `deepdraw-upload-findings-2026-04-27.md`.

## SOP Rules Encoded

Model package:

- remove tag, wash-label, static/still, card-head, and packaging assets
- remove white-background images named as `12位款号-5位颜色码` or `m(1).12位款号-5位颜色码`
- ignore every file inside child folders whose folder name contains `包装`
- keep normal model images

Still package:

- remove `.psd`
- remove card-paper tag and handwritten wash-label assets
- keep normal still images
- rename usable tag / wash-label images to `yq.*`
- skip PDF files because the source PDF is selected locally in the separate PDF screenshot task

## Folder Matching

The SOP screenshots show that the style code can appear in the folder name while child image filenames may be generic, for example `balaBR...jpg`.

The script therefore:

- searches Semir cloud drive by the input code
- filters search results to the configured source path
- detects matched style folders under that source path
- attempts recursive folder listing for child images and filter-only assets
- ignores direct image hits unless they are descendants returned by a matched folder listing

Folder listing uses API-first endpoint fallbacks for `/fengcloud/2/file/list` and `/fengcloud/1/file/list`. This branch still needs live confirmation against the logged-in Semir environment.

## PDF Cropping Feasibility

Local exploration rendered the provided SOP PDF pages successfully with a PDF renderer. Backend support is implemented as best-effort in the separate `PDF 批量截图` task:

- primary renderer: PyMuPDF (`fitz`)
- crop/split: Pillow whitespace crop, plus a simple two-label split heuristic
- macOS fallback renderer: Quick Look `qlmanage`
- failure fallback: keep the original PDF under `_PDF待裁图`

`core/requirements.txt` now includes `Pillow` and `PyMuPDF` so packaged builds can perform real PDF-to-image conversion. If those dependencies are not installed in the current dev runtime, valid PDFs can still fall back to Quick Look on macOS, but crop quality is limited.
