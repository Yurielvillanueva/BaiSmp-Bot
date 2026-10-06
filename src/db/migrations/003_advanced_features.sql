-- schema version 3: advanced features (toxicity, enhanced audit, reports)

CREATE TABLE IF NOT EXISTS toxicity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT,
  minecraft_uuid TEXT,
  message TEXT NOT NULL,
  score REAL NOT NULL,
  categories TEXT NOT NULL,
  matches TEXT,
  detected_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_toxicity_discord ON toxicity_log(discord_id);
CREATE INDEX IF NOT EXISTS idx_toxicity_uuid ON toxicity_log(minecraft_uuid);
CREATE INDEX IF NOT EXISTS idx_toxicity_score ON toxicity_log(score);

CREATE TABLE IF NOT EXISTS enhanced_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id TEXT UNIQUE NOT NULL,
  actor_id TEXT NOT NULL,
  target_id TEXT,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  changes TEXT,
  ip_hash TEXT,
  user_agent TEXT,
  session_id TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  metadata TEXT,
  blockchain_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON enhanced_audit(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_target ON enhanced_audit(target_id);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON enhanced_audit(resource);
CREATE INDEX IF NOT EXISTS idx_audit_severity ON enhanced_audit(severity);
CREATE INDEX IF NOT EXISTS idx_audit_created ON enhanced_audit(created_at);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  parameters TEXT,
  file_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(type);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);

CREATE TABLE IF NOT EXISTS player_analytics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT,
  minecraft_uuid TEXT,
  event_type TEXT NOT NULL,
  value REAL,
  metadata TEXT,
  recorded_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_discord ON player_analytics(discord_id);
CREATE INDEX IF NOT EXISTS idx_analytics_uuid ON player_analytics(minecraft_uuid);
CREATE INDEX IF NOT EXISTS idx_analytics_type ON player_analytics(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_recorded ON player_analytics(recorded_at);
