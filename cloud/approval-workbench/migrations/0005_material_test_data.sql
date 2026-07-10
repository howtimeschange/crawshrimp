CREATE TABLE IF NOT EXISTS material_test_task_overviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_uid TEXT NOT NULL DEFAULT '',
  source_filename TEXT NOT NULL DEFAULT '',
  record_type TEXT NOT NULL DEFAULT '',
  row_no INTEGER,
  style_code TEXT NOT NULL DEFAULT '',
  item_id TEXT NOT NULL,
  item_title TEXT NOT NULL DEFAULT '',
  task_id TEXT NOT NULL,
  test_status TEXT NOT NULL DEFAULT '',
  test_channel TEXT NOT NULL DEFAULT '',
  material_count INTEGER NOT NULL DEFAULT 0,
  statistic_type TEXT NOT NULL DEFAULT '',
  best_material TEXT NOT NULL DEFAULT '',
  execution_result TEXT NOT NULL DEFAULT '',
  remark TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(item_id, task_id, statistic_type)
);

CREATE INDEX IF NOT EXISTS idx_material_test_overviews_style_item
  ON material_test_task_overviews (style_code, item_id);

CREATE TABLE IF NOT EXISTS material_test_image_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_uid TEXT NOT NULL DEFAULT '',
  source_filename TEXT NOT NULL DEFAULT '',
  record_type TEXT NOT NULL DEFAULT '',
  row_no INTEGER,
  style_code TEXT NOT NULL DEFAULT '',
  item_id TEXT NOT NULL,
  item_title TEXT NOT NULL DEFAULT '',
  task_id TEXT NOT NULL,
  test_status TEXT NOT NULL DEFAULT '',
  test_channel TEXT NOT NULL DEFAULT '',
  material_count INTEGER NOT NULL DEFAULT 0,
  statistic_type TEXT NOT NULL,
  statistic_date TEXT NOT NULL,
  image_type TEXT NOT NULL DEFAULT '',
  material_id TEXT NOT NULL DEFAULT '',
  material_ratio TEXT NOT NULL DEFAULT '',
  material_share REAL NOT NULL DEFAULT 0,
  material_url TEXT NOT NULL,
  search_impressions INTEGER NOT NULL DEFAULT 0,
  search_clicks INTEGER NOT NULL DEFAULT 0,
  search_ctr REAL NOT NULL DEFAULT 0,
  detail_impressions INTEGER NOT NULL DEFAULT 0,
  detail_clicks INTEGER NOT NULL DEFAULT 0,
  detail_ctr REAL NOT NULL DEFAULT 0,
  detail_add_to_cart INTEGER NOT NULL DEFAULT 0,
  detail_pay_conversion INTEGER NOT NULL DEFAULT 0,
  detail_pay_conversion_rate REAL NOT NULL DEFAULT 0,
  data_download_url TEXT NOT NULL DEFAULT '',
  execution_result TEXT NOT NULL DEFAULT '',
  remark TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(item_id, task_id, statistic_type, statistic_date, material_id, material_url)
);

CREATE INDEX IF NOT EXISTS idx_material_test_image_metrics_filters
  ON material_test_image_metrics (statistic_type, statistic_date, image_type, style_code, item_id);

CREATE TABLE IF NOT EXISTS material_test_crawl_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_uid TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  statistic_type TEXT NOT NULL DEFAULT 'ACCUMULATE_30_DAYS',
  schedule_time TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  status TEXT NOT NULL DEFAULT 'active',
  target_machine_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_material_test_crawl_schedules_status
  ON material_test_crawl_schedules (status, schedule_time);
