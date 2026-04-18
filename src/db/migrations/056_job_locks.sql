-- Job execution locks for distributed lock during rolling deploys (DEFECT-0047)
CREATE TABLE IF NOT EXISTS job_locks (
  job_name TEXT PRIMARY KEY,
  locked_at DATETIME NOT NULL,
  locked_by TEXT NOT NULL,
  expires_at DATETIME NOT NULL
);
