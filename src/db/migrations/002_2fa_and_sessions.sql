-- schema version 2: 2FA and session management

CREATE TABLE IF NOT EXISTS two_factor_secrets (
  discord_id TEXT PRIMARY KEY,
  secret TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  backup_codes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  discord_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  user_agent TEXT,
  device_fingerprint TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at INTEGER NOT NULL,
  valid INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_sessions_discord ON user_sessions(discord_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions(expires_at);

CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT,
  event_type TEXT NOT NULL,
  details TEXT,
  ip_hash TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_security_events_discord ON security_events(discord_id);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type);

CREATE TABLE IF NOT EXISTS hardware_fingerprints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT,
  minecraft_uuid TEXT,
  fingerprint TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  is_banned INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_hw_fingerprint ON hardware_fingerprints(fingerprint);
CREATE INDEX IF NOT EXISTS idx_hw_discord ON hardware_fingerprints(discord_id);
CREATE INDEX IF NOT EXISTS idx_hw_uuid ON hardware_fingerprints(minecraft_uuid);

CREATE TABLE IF NOT EXISTS anomaly_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT,
  minecraft_uuid TEXT,
  anomaly_type TEXT NOT NULL,
  score REAL NOT NULL,
  threshold REAL NOT NULL,
  details TEXT,
  detected_at INTEGER NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_anomaly_discord ON anomaly_scores(discord_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_score ON anomaly_scores(score);
