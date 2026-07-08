CREATE TABLE IF NOT EXISTS ai_generation_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_uid TEXT NOT NULL UNIQUE,
  batch_uid TEXT NOT NULL,
  style_id INTEGER NOT NULL,
  source_asset_uid TEXT NOT NULL DEFAULT '',
  reference_asset_uids_json TEXT NOT NULL DEFAULT '[]',
  prompt_template_version_id INTEGER,
  prompt_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  dispatch_job_uid TEXT NOT NULL DEFAULT '',
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_generation_requests_batch ON ai_generation_requests (batch_uid, style_id, status);
