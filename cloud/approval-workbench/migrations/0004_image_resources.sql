CREATE TABLE IF NOT EXISTS image_resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_uid TEXT NOT NULL UNIQUE,
  batch_uid TEXT NOT NULL DEFAULT '',
  style_code TEXT NOT NULL DEFAULT '',
  item_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  asset_uid TEXT NOT NULL,
  object_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_hash TEXT NOT NULL DEFAULT '',
  source_label TEXT NOT NULL DEFAULT '',
  created_by_machine_id TEXT,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_image_resources_batch_style_item
  ON image_resources(batch_uid, style_code, item_id);
