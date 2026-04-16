-- Call transcripts from Fathom/Gong/Fireflies/Zoom
CREATE TABLE IF NOT EXISTS call_transcripts (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  source TEXT NOT NULL, -- 'fathom' | 'gong' | 'fireflies' | 'zoom' | 'manual'
  call_type TEXT NOT NULL, -- 'customer' | 'prospect' | 'internal' | 'investor'
  participant_emails TEXT, -- comma-separated
  duration_minutes INTEGER,
  transcript_text TEXT,
  summary TEXT,
  sentiment_score REAL, -- -1 to 1
  key_topics_json TEXT, -- JSON array of extracted topics
  competitor_mentions_json TEXT, -- JSON array: [{name, context, sentiment}]
  objections_json TEXT, -- JSON array of extracted objections
  commitments_json TEXT, -- JSON array of next steps/commitments
  call_date TEXT NOT NULL,
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_transcripts_product ON call_transcripts(product_id, call_date DESC);
CREATE INDEX IF NOT EXISTS idx_transcripts_type ON call_transcripts(product_id, call_type);

-- Competitor job posting signals
CREATE TABLE IF NOT EXISTS competitor_job_signals (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  competitor_name TEXT NOT NULL,
  job_title TEXT NOT NULL,
  department TEXT, -- 'engineering' | 'sales' | 'marketing' | 'product' | 'support'
  seniority TEXT, -- 'junior' | 'mid' | 'senior' | 'lead' | 'executive'
  job_url TEXT,
  description_excerpt TEXT,
  signal_interpretation TEXT, -- AI-generated "what this hiring signal means"
  posted_at TEXT NOT NULL,
  detected_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_job_signals_product ON competitor_job_signals(product_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_signals_competitor ON competitor_job_signals(product_id, competitor_name);

-- Calendar time allocation (founder time audit)
CREATE TABLE IF NOT EXISTS calendar_allocations (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  week_start TEXT NOT NULL, -- ISO date of Monday
  category TEXT NOT NULL, -- 'customer' | 'sales' | 'engineering' | 'admin' | 'investors' | 'recruiting' | 'strategy' | 'other'
  hours REAL NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_alloc_week ON calendar_allocations(product_id, week_start, category);
