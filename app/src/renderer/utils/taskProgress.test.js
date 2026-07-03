import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildTaskRunnerProgressSummary,
  resolveTaskProgressConfig,
} from './taskProgress.js'

test('tmall material match-buy uses Semir batch download progress in task runner', () => {
  const config = resolveTaskProgressConfig('semir-cloud-drive', 'tmall_material_match_buy')
  assert.equal(config.mode, 'enhanced')
  assert.equal(config.usage.taskRunner, 'enhanced')

  const summary = buildTaskRunnerProgressSummary({
    adapterId: 'semir-cloud-drive',
    taskId: 'tmall_material_match_buy',
    liveStatus: 'running',
    isRunning: true,
    live: {
      status: 'running',
      phase: 'collect_job',
      current: 1,
      total: 2,
      buyer_id: '109326124011',
      store: '26Q2/模拍',
      download_total: 5,
      download_completed: 2,
      download_success: 2,
      download_concurrency: 10,
      download_retry_attempts: 3,
      download_started: true,
      download_active: true,
    },
  })

  assert.equal(summary.title, '双阶段进度')
  assert.equal(summary.ariaLabel, '森马云盘双阶段进度')
  assert.equal(summary.tracks.length, 2)
  assert.equal(summary.tracks[0].title, '上层 · 检索链接')
  assert.equal(summary.tracks[0].main, '1 / 2 个编码')
  assert.equal(summary.tracks[1].title, '下层 · 批量下载')
  assert.equal(summary.tracks[1].main, '2 / 5 个文件')
})

test('tmall material new 6.24 uses Semir batch download progress in task runner', () => {
  const config = resolveTaskProgressConfig('semir-cloud-drive', 'tmall_material_new_624')
  assert.equal(config.mode, 'enhanced')
  assert.equal(config.usage.taskRunner, 'enhanced')

  const summary = buildTaskRunnerProgressSummary({
    adapterId: 'semir-cloud-drive',
    taskId: 'tmall_material_new_624',
    liveStatus: 'running',
    isRunning: true,
    live: {
      status: 'running',
      phase: 'collect_job',
      current: 1,
      total: 2,
      buyer_id: '103526124101A-80325',
      store: '26Q3/模特/服饰/AI',
      download_total: 2,
      download_completed: 1,
      download_success: 1,
      download_concurrency: 10,
      download_retry_attempts: 3,
      download_started: true,
      download_active: true,
    },
  })

  assert.equal(summary.title, '双阶段进度')
  assert.equal(summary.tracks.length, 2)
  assert.equal(summary.tracks[0].main, '1 / 2 个编码')
  assert.equal(summary.tracks[1].main, '1 / 2 个文件')
})

test('tiktok creator video download uses two-stage progress in task runner', () => {
  const config = resolveTaskProgressConfig('tiktok-ops-assistant', 'creator_video_download')
  assert.equal(config.mode, 'enhanced')
  assert.equal(config.usage.taskRunner, 'enhanced')

  const probeSummary = buildTaskRunnerProgressSummary({
    adapterId: 'tiktok-ops-assistant',
    taskId: 'creator_video_download',
    liveStatus: 'running',
    isRunning: true,
    live: {
      status: 'running',
      phase: 'main',
      current: 1,
      total: 4,
      buyer_id: '7619062455813131550',
      store: 'TikTok达人视频下载 / US',
      search_total_codes: 4,
      search_completed_codes: 1,
      download_total: 0,
      download_completed: 0,
      download_started: false,
      download_active: false,
    },
  })

  assert.equal(probeSummary.title, '双阶段进度')
  assert.equal(probeSummary.tracks.length, 2)
  assert.equal(probeSummary.tracks[0].title, '第一阶段 · 探查视频')
  assert.equal(probeSummary.tracks[0].main, '1 / 4 条视频')
  assert.equal(probeSummary.tracks[1].title, '第二阶段 · 批量下载')
  assert.equal(probeSummary.tracks[1].percentLabel, '待开始')

  const downloadSummary = buildTaskRunnerProgressSummary({
    adapterId: 'tiktok-ops-assistant',
    taskId: 'creator_video_download',
    liveStatus: 'running',
    isRunning: true,
    live: {
      status: 'running',
      phase: 'after_download',
      current: 4,
      total: 4,
      buyer_id: '7619062455813131550',
      store: 'TikTok达人视频下载 / US',
      search_total_codes: 4,
      search_completed_codes: 4,
      download_total: 4,
      download_completed: 2,
      download_success: 2,
      download_failed: 0,
      download_started: true,
      download_active: true,
      download_concurrency: 2,
      download_retry_attempts: 2,
      download_current_label: 'US_7619062455813131550.mp4',
    },
  })

  assert.equal(downloadSummary.title, '双阶段进度')
  assert.equal(downloadSummary.tracks[0].main, '4 / 4 条视频')
  assert.equal(downloadSummary.tracks[1].main, '2 / 4 个视频')
  assert.match(downloadSummary.sub, /批量下载/)
})

test('tmall ai image test chain uses find-image and generation progress tracks', () => {
  const config = resolveTaskProgressConfig('tmall-ops-assistant', 'tmall_ai_image_test_chain')
  assert.equal(config.mode, 'enhanced')
  assert.equal(config.usage.taskRunner, 'enhanced')

  const summary = buildTaskRunnerProgressSummary({
    adapterId: 'tmall-ops-assistant',
    taskId: 'tmall_ai_image_test_chain',
    liveStatus: 'running',
    isRunning: true,
    live: {
      status: 'running',
      phase: 'tmall_ai_chain_generate',
      current: 6,
      total: 6,
      buyer_id: '208326108101',
      store: '1XM 生图完成 3/24',
      search_total_codes: 6,
      search_completed_codes: 6,
      generation_total_jobs: 24,
      generation_completed_jobs: 3,
    },
  })

  assert.equal(summary.title, '双阶段进度')
  assert.equal(summary.ariaLabel, '巴拉 AI 测图双阶段进度')
  assert.equal(summary.main, '批量生图')
  assert.equal(summary.tracks.length, 2)
  assert.equal(summary.tracks[0].title, '找图进度')
  assert.equal(summary.tracks[0].main, '6 / 6 款')
  assert.equal(summary.tracks[0].state, 'complete')
  assert.equal(summary.tracks[1].title, '生图进度')
  assert.equal(summary.tracks[1].main, '3 / 24 张')
  assert.equal(summary.tracks[1].state, 'active')
  assert.match(summary.sub, /并发/)
})

test('tmall ai image test chain keeps generation progress moving from status text fallback', () => {
  const summary = buildTaskRunnerProgressSummary({
    adapterId: 'tmall-ops-assistant',
    taskId: 'tmall_ai_image_test_chain',
    liveStatus: 'running',
    isRunning: true,
    live: {
      status: 'running',
      phase: 'tmall_ai_chain_generate',
      current: 6,
      total: 6,
      store: '1XM 生图完成 3/20',
      search_total_codes: 6,
      search_completed_codes: 6,
    },
  })

  assert.equal(summary.main, '批量生图')
  assert.equal(summary.percentValue, 57.5)
  assert.equal(summary.tracks[0].state, 'complete')
  assert.equal(summary.tracks[1].main, '3 / 20 张')
  assert.equal(summary.tracks[1].percentLabel, '15%')
  assert.equal(summary.tracks[1].indeterminate, false)
})

test('tmall ai image test chain shows completed over submitted jobs before completion', () => {
  const summary = buildTaskRunnerProgressSummary({
    adapterId: 'tmall-ops-assistant',
    taskId: 'tmall_ai_image_test_chain',
    liveStatus: 'running',
    isRunning: true,
    live: {
      status: 'running',
      phase: 'tmall_ai_chain_generate',
      current: 6,
      total: 6,
      buyer_id: '208326100202',
      store: '1XM 生图提交 12/20',
      search_total_codes: 6,
      search_completed_codes: 6,
      generation_total_jobs: 20,
      generation_submitted_jobs: 12,
      generation_completed_jobs: 3,
    },
  })

  assert.equal(summary.main, '批量生图')
  assert.equal(summary.percentValue, 62.5)
  assert.equal(summary.tracks[0].state, 'complete')
  assert.equal(summary.tracks[1].main, '3 / 12 张')
  assert.equal(summary.tracks[1].percentLabel, '25%')
  assert.equal(summary.tracks[1].state, 'active')
  assert.match(summary.tracks[1].caption, /已提交 12\/20/)
  assert.match(summary.tracks[1].caption, /已完成 3\/20/)
})

test('shein commodity quality uses two-stage list and return detail progress', () => {
  const config = resolveTaskProgressConfig('shein-helper', 'commodity_quality')
  assert.equal(config.mode, 'enhanced')
  assert.equal(config.usage.taskRunner, 'enhanced')

  const summary = buildTaskRunnerProgressSummary({
    adapterId: 'shein-helper',
    taskId: 'commodity_quality',
    liveStatus: 'running',
    isRunning: true,
    live: {
      status: 'running',
      phase: 'collect_detail_page',
      current: 20363,
      total: 20363,
      completed: 20363,
      store: '客退详情 sk25050817072795161 1221/20363',
      list_total_rows: 20363,
      list_completed_rows: 20363,
      list_total_batches: 113,
      list_completed_batches: 113,
      detail_total_targets: 20363,
      detail_completed_targets: 1220,
      detail_current_target_index: 1221,
      detail_current_target: 'sk25050817072795161',
      detail_request_count: 1221,
      detail_records_collected: 42,
    },
  })

  assert.equal(summary.title, '双阶段进度')
  assert.equal(summary.ariaLabel, 'SHEIN 商品质量双阶段进度')
  assert.equal(summary.main, '抓取客退详情')
  assert.equal(summary.tracks.length, 2)
  assert.equal(summary.tracks[0].title, '第一阶段 · 商品质量列表')
  assert.equal(summary.tracks[0].main, '20363 / 20363 条商品')
  assert.equal(summary.tracks[0].state, 'complete')
  assert.equal(summary.tracks[1].title, '第二阶段 · 客退详情')
  assert.equal(summary.tracks[1].main, '1220 / 20363 个 SKC')
  assert.equal(summary.tracks[1].state, 'active')
  assert.match(summary.tracks[1].detail, /sk25050817072795161/)
})

test('tmall material-test data export exposes enhanced full-run progress', () => {
  const config = resolveTaskProgressConfig('tmall-ops-assistant', 'tmall_material_test_data_export')
  assert.equal(config.mode, 'enhanced')
  assert.equal(config.usage.taskRunner, 'enhanced')

  const summary = buildTaskRunnerProgressSummary({
    adapterId: 'tmall-ops-assistant',
    taskId: 'tmall_material_test_data_export',
    liveStatus: 'running',
    isRunning: true,
    live: {
      status: 'running',
      phase: 'collect_download_data',
      current: 40,
      total: 220,
      completed: 238,
      percent: 18.2,
      progress_text: '40/220',
    },
  })

  assert.equal(summary.title, '批处理进度')
  assert.equal(summary.percentValue, 18.2)
  assert.equal(summary.tracks[0].main, '第 40 / 220 条')
  assert.match(summary.sub, /collect_download_data/)
})

test('amazon reviews full export uses product and current-review two-layer progress', () => {
  const config = resolveTaskProgressConfig('amazon-ops-assistant', 'amazon_reviews_full_export')
  assert.equal(config.mode, 'enhanced')
  assert.equal(config.usage.taskRunner, 'enhanced')

  const summary = buildTaskRunnerProgressSummary({
    adapterId: 'amazon-ops-assistant',
    taskId: 'amazon_reviews_full_export',
    liveStatus: 'running',
    isRunning: true,
    live: {
      status: 'running',
      phase: 'collect_reviews_page',
      current: 2,
      total: 3,
      records: 75,
      buyer_id: 'B0D9221K6K',
      store: 'Amazon Reviews · B0D9221K6K',
      list_total_rows: 3,
      list_completed_rows: 1,
      detail_total_targets: 120,
      detail_completed_targets: 35,
      detail_current_target_index: 2,
      detail_current_target: 'B0D9221K6K',
      detail_dimension_index: 8,
      detail_dimension_total: 12,
      detail_dimension_label: '最有帮助 / 5星',
      detail_current_page: 4,
      detail_total_pages: 12,
    },
  })

  assert.equal(summary.title, '双层进度')
  assert.equal(summary.ariaLabel, 'Amazon Reviews 双层进度')
  assert.equal(summary.tracks.length, 2)
  assert.equal(summary.tracks[0].title, '上层 · 商品链接')
  assert.equal(summary.tracks[0].main, '第 2 / 3 个商品')
  assert.equal(summary.tracks[1].title, '下层 · 当前链接评论')
  assert.equal(summary.tracks[1].main, '35 / 120 条评论')
  assert.match(summary.tracks[1].caption, /维度 8\/12 最有帮助 \/ 5星/)
  assert.match(summary.tracks[1].caption, /页 4\/12/)
  assert.match(summary.sub, /B0D9221K6K/)
})

test('aliexpress cutout download uses enhanced batch progress for long Excel runs', () => {
  const config = resolveTaskProgressConfig('aliexpress-ops-assistant', 'product_cutout_download')
  assert.equal(config.mode, 'enhanced')
  assert.equal(config.usage.taskRunner, 'enhanced')
  assert.equal(config.usage.sidebar, 'enhanced')

  const summary = buildTaskRunnerProgressSummary({
    adapterId: 'aliexpress-ops-assistant',
    taskId: 'product_cutout_download',
    liveStatus: 'running',
    isRunning: true,
    live: {
      status: 'running',
      phase: 'cutout_current',
      current: 18,
      total: 1200,
      completed: 17,
      row_no: 24,
      buyer_id: '1005012042309848',
      store: '速卖通商品抠图下载 · 成功 16 / 失败 1 / 重试 3',
    },
  })

  assert.equal(summary.title, '批处理进度')
  assert.equal(summary.main, '第 18 / 1200 条')
  assert.equal(summary.tracks.length, 1)
  assert.equal(summary.tracks[0].title, '总进度')
  assert.equal(summary.rowText, '源表行 24')
  assert.equal(summary.targetText, '目标 1005012042309848')
  assert.match(summary.sub, /重试 3/)
})

test('doudian mixed fund signup monitor shows activity and product detail progress', () => {
  const config = resolveTaskProgressConfig('doudian-ops-assistant', 'mixed_fund_signup_monitor')
  assert.equal(config.mode, 'enhanced')
  assert.equal(config.usage.taskRunner, 'enhanced')

  const summary = buildTaskRunnerProgressSummary({
    adapterId: 'doudian-ops-assistant',
    taskId: 'mixed_fund_signup_monitor',
    liveStatus: 'running',
    isRunning: true,
    live: {
      status: 'running',
      phase: 'main',
      doudian_stage: 'signup_products',
      doudian_activity_total: 4,
      doudian_activity_completed: 2,
      doudian_current_activity: '必报！抖音商城混资券长期报名入口【商家出资5%】',
      doudian_current_product_total: 784,
      doudian_current_product_completed: 300,
      doudian_detail_rows: 1250,
    },
  })

  assert.equal(summary.title, '商城混资报名进度')
  assert.equal(summary.tracks.length, 2)
  assert.equal(summary.tracks[0].title, '活动入口')
  assert.equal(summary.tracks[0].main, '2 / 4 个入口')
  assert.equal(summary.tracks[1].title, '当前入口商品')
  assert.equal(summary.tracks[1].main, '300 / 784 个商品')
  assert.match(summary.sub, /必报！抖音商城混资券长期报名入口/)
})

test('doudian mixed fund order replay shows signup, order list, and detail progress', () => {
  const config = resolveTaskProgressConfig('doudian-ops-assistant', 'mixed_fund_order_replay')
  assert.equal(config.mode, 'enhanced')
  assert.equal(config.usage.taskRunner, 'enhanced')

  const summary = buildTaskRunnerProgressSummary({
    adapterId: 'doudian-ops-assistant',
    taskId: 'mixed_fund_order_replay',
    liveStatus: 'running',
    isRunning: true,
    live: {
      status: 'running',
      phase: 'collect_order_detail_batch',
      doudian_stage: 'order_details',
      doudian_signup_total: 4,
      doudian_signup_completed: 4,
      list_total_rows: 3600,
      list_completed_rows: 3600,
      detail_total_targets: 208,
      detail_completed_targets: 100,
      detail_current_target: 'SO-DETAIL-100',
      doudian_mixed_rows: 42,
    },
  })

  assert.equal(summary.title, '商城混资复盘进度')
  assert.equal(summary.tracks.length, 3)
  assert.equal(summary.tracks[0].title, '报名商品归因')
  assert.equal(summary.tracks[0].main, '4 / 4 个入口')
  assert.equal(summary.tracks[1].title, '订单列表')
  assert.equal(summary.tracks[1].main, '3600 / 3600 条订单')
  assert.equal(summary.tracks[2].title, '订单详情优惠')
  assert.equal(summary.tracks[2].main, '100 / 208 个订单')
  assert.match(summary.sub, /SO-DETAIL-100/)
})
