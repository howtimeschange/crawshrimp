ALTER TABLE ai_generation_requests ADD COLUMN request_meta_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE ai_generation_requests ADD COLUMN upstream_task_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE ai_generation_requests ADD COLUMN result_asset_uids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE ai_generation_requests ADD COLUMN error_message TEXT NOT NULL DEFAULT '';
