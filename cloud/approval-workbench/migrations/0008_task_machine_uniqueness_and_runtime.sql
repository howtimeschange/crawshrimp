UPDATE task_machines
SET fingerprint_hash = fingerprint_hash || ':legacy-duplicate:' || id
WHERE id NOT IN (
  SELECT MAX(id)
  FROM task_machines
  GROUP BY fingerprint_hash
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_machines_fingerprint_hash
ON task_machines (fingerprint_hash);

CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_machine_runtime
ON dispatch_jobs (assigned_machine_id, status, lease_expires_at);
