# DeepDraw Upload Page Findings

Date: 2026-04-27
Adapter: `shenhui-new-arrival`
Target: `https://www.deepdraw.biz/authorized/merchant/index`
Menu: 产品素材 / 图片包上传

## Safety Boundary

The page was probed in production. Do not perform a real upload during exploration.

Allowed probe actions used:

- inspect the main page and `uploadPictures` iframe DOM
- search by one known style code
- select one result row
- open the ZIP upload modal
- inject a local fake ZIP into the front-end file queue only
- clear the queue and uncheck selected rows

Forbidden until the user explicitly approves a production run:

- click `#uploadFilesButton`
- call `uploader.start()`
- call `continueUpload()`
- invoke upload-to-OSS requests
- call post-upload processing endpoints for a real ZIP

## Page Structure

The main URL is only the shell page. The useful business page is a same-origin iframe:

- iframe URL: `/authorized/merchant/product/uploadPictures`
- page title: `图片包上传 | 深绘 DEEPDRAW`
- search input: `#searchKeyword`
- search form: `#form1`, action `/authorized/merchant/product/uploadPictures`, method `POST`
- search trigger: `updateSearchKeyword(); search();`
- product table: `#tbodyTable`
- row checkbox attributes include `data-id`, `data-code`, `data-day`, and `data-status`

Search result shape observed with style code `208226103201`:

- product id: `6227681`
- code: `208226103201`
- day: `2026-02-07`
- checkbox value: `208226103201`
- checkbox `data-status`: `true`

## Batch Upload Entry

The visible button text is `群体批量上传图片`; its inline action is:

```text
prevCheck()
```

The sibling `批量从数字资产选择` action calls `prevCheckDam()`, but the DAM picker iframe (`dam.leycloud.com/dam/resourcePicker`) showed account setup failure in this probe, so the ZIP path is the practical route.

Opening the batch ZIP modal after selecting one row triggered only pre-upload checks:

- `POST /authorized/merchant/product/ajaxBatchCheckCountAccountByPictureZip`
- request body: `[{"id":6227681,"templateId":"","type":"PVRC"}]`
- `POST /authorized/merchant/product/getImageUploadState`

No file upload was started.

## Upload Modal

Modal:

- id: `#uploadBatchModal`
- title: `图片包上传(ZIP)`
- style when open: `display: block;`

Key controls:

- choose file button: `#selectFilesButton`
- hidden file input: `#uploadBatchModal input[type="file"][accept=".zip"]`
- clear queue button: `#clearFilesButton`
- upload button: `#uploadFilesButton`
- continue button: `#continueUploadFilesButton`

The hidden file input id is generated dynamically, so future code should query by modal and `input[type="file"]`, not by id.

The modal copy states these package rules:

- upload ZIP only
- ZIP filename must exactly match the product style code
- ZIP must be no larger than 2048 MB
- single image must be no larger than 30 MB
- if image filenames specify colors, color names must match the product color fields

## File Queue Probe

A local fake ZIP named `208226103201.zip` was injected into the hidden file input to verify plupload queue behavior without starting upload.

Observed result:

- `uploader.files` contained one file named `208226103201.zip`
- file size was shown in the queue
- `#uploadFilesButton` became enabled
- `#clearFilesButton` became enabled
- upload was not clicked and `uploader.start()` was not called

After the probe, the queue was cleared and selected checkboxes were unchecked. The upload button returned to disabled.

## Runtime Functions

Relevant functions found on the iframe window:

- `prevCheck(singleObj)`: prepares ZIP batch upload, then calls `prevNewCheck`
- `batchUpload(singleObj)`: builds the style-code queue and calls `doUpload(codes)`
- `doUpload(codes)`: opens `#uploadBatchModal` and initializes plupload
- `uploaderConfig(codes)`: configures plupload
- `refreshUploadParams()`: synchronously fetches `/authorized/merchant/product/getUploadParams`
- `refreshOssSTSParams()`: synchronously fetches `/authorized/merchant/authorized/sts?type=PICTURE`
- `analyzeResult(file, json)`: handles server-side ZIP processing result
- `ajaxRefreshArchiveHandlingStatus(file)`: polls `/authorized/merchant/product/{productId}/ajaxRefreshArchiveHandlingStatus`

`refreshUploadParams()` returns these keys:

- `OSSAccessKeyId`
- `signature`
- `key`
- `policy`

Do not persist live credential values in notes or tests.

## Adapter Implementation

The adapter now exposes a separate DeepDraw task, `upload_to_deepdraw`, with its own `entry_url`:

```yaml
entry_url: https://www.deepdraw.biz/authorized/merchant/index
tab_match_prefixes:
  - https://www.deepdraw.biz/authorized/merchant/index
```

Implemented phases:

- verify the `uploadPictures` iframe is active
- search each style code with exact product-code mode
- read back the rendered row and checkbox attributes
- validate that the generated ZIP basename exactly matches a row style code
- select matching rows
- open the ZIP modal
- attach locally batch-selected ZIP files to the plupload file input
- stop before upload by default in `dry_run`
- call `uploader.start()` when `upload_mode=upload`

Production upload is still fail-closed in dry-run mode. The default mode only validates search, selection, and file queueing, then clears the queue and leaves rows marked as `未上传`. Switching the UI execution mode to production upload is the explicit user action that submits the queued ZIPs.
