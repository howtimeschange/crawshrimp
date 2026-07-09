CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  password_hash TEXT NOT NULL,
  last_login_at TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(email)
);

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  built_in INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  role_id INTEGER NOT NULL,
  assigned_by INTEGER,
  assigned_at TEXT NOT NULL,
  UNIQUE(user_id, role_id)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL,
  permission_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  session_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER,
  actor_machine_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  ip_address TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS machine_enrollment_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  owner_user_id INTEGER,
  allowed_capabilities_json TEXT NOT NULL DEFAULT '[]',
  require_approval INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'issued',
  expires_at TEXT NOT NULL,
  used_by_machine_id TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS task_machines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id TEXT NOT NULL,
  machine_name TEXT NOT NULL,
  owner_user_id INTEGER,
  app_version TEXT NOT NULL DEFAULT '',
  fingerprint_hash TEXT NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  auth_status TEXT NOT NULL DEFAULT 'pending_approval',
  health TEXT NOT NULL DEFAULT 'offline',
  current_job_id TEXT,
  last_seen_at TEXT,
  registered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(machine_id),
  UNIQUE(fingerprint_hash)
);

CREATE TABLE IF NOT EXISTS machine_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  issued_by INTEGER,
  issued_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS dispatch_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_uid TEXT NOT NULL UNIQUE,
  batch_uid TEXT NOT NULL DEFAULT '',
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  requested_by INTEGER,
  assigned_machine_id TEXT,
  required_capabilities_json TEXT NOT NULL DEFAULT '[]',
  priority INTEGER NOT NULL DEFAULT 100,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT NOT NULL,
  lease_id TEXT,
  lease_expires_at TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(job_type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_claim ON dispatch_jobs (status, assigned_machine_id, priority, created_at);

CREATE TABLE IF NOT EXISTS dispatch_job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_uid TEXT NOT NULL,
  machine_id TEXT,
  lease_id TEXT,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_libraries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  scenario TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER NOT NULL,
  group_name TEXT NOT NULL,
  field_name TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  size_label TEXT NOT NULL DEFAULT '960x1280',
  output_format TEXT NOT NULL DEFAULT 'jpeg',
  quality TEXT NOT NULL DEFAULT 'auto',
  category_rules_json TEXT NOT NULL DEFAULT '[]',
  gender_rules_json TEXT NOT NULL DEFAULT '[]',
  priority_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_template_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  version_no INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by INTEGER,
  UNIQUE(template_id, version_no)
);

CREATE TABLE IF NOT EXISTS ai_image_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_uid TEXT NOT NULL UNIQUE,
  local_instance_uid TEXT NOT NULL DEFAULT '',
  local_run_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'syncing',
  prompt_library_id INTEGER,
  prompt_version_set_json TEXT NOT NULL DEFAULT '[]',
  source_machine_id TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_image_styles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_uid TEXT NOT NULL,
  style_code TEXT NOT NULL,
  item_id TEXT NOT NULL DEFAULT '',
  skc_code TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending_review',
  missing_prompt_reason TEXT NOT NULL DEFAULT '',
  source_summary_json TEXT NOT NULL DEFAULT '{}',
  review_summary_json TEXT NOT NULL DEFAULT '{}',
  submit_summary_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(batch_uid, style_code, item_id)
);

CREATE TABLE IF NOT EXISTS ai_image_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_uid TEXT NOT NULL UNIQUE,
  batch_uid TEXT NOT NULL,
  style_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  object_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_hash TEXT NOT NULL DEFAULT '',
  prompt_template_version_id INTEGER,
  prompt_text TEXT NOT NULL DEFAULT '',
  parent_asset_uid TEXT,
  generation_job_id TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_uid TEXT NOT NULL,
  style_id INTEGER,
  asset_uid TEXT,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
