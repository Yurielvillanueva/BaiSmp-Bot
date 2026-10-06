-- schema version 1
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS config_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  actor_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  host TEXT NOT NULL,
  query_port INTEGER NOT NULL DEFAULT 25565,
  rcon_port INTEGER NOT NULL DEFAULT 25575,
  rcon_password_enc TEXT,
  plugin_api_url TEXT,
  world_path TEXT,
  log_path TEXT,
  backup_path TEXT,
  status_channel_id TEXT,
  status_message_id TEXT,
  console_channel_id TEXT,
  chat_channel_id TEXT,
  alert_channel_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  maintenance INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS linked_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT NOT NULL,
  minecraft_uuid TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  linked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_linked_discord ON linked_accounts(discord_id);

CREATE TABLE IF NOT EXISTS link_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash TEXT NOT NULL UNIQUE,
  minecraft_uuid TEXT NOT NULL,
  username TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS staff_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL,
  actor_discord_id TEXT NOT NULL,
  target_discord_id TEXT,
  target_uuid TEXT,
  target_name TEXT,
  action TEXT NOT NULL,
  reason TEXT,
  result TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_staff_log_target ON staff_log(target_name, target_uuid);
CREATE INDEX IF NOT EXISTS idx_staff_log_case ON staff_log(case_id);

CREATE TABLE IF NOT EXISTS punishments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL,
  type TEXT NOT NULL,
  target_discord_id TEXT,
  target_uuid TEXT,
  target_name TEXT,
  duration_ms INTEGER,
  expires_at INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number INTEGER NOT NULL UNIQUE,
  discord_id TEXT NOT NULL,
  channel_id TEXT,
  category TEXT,
  reason TEXT,
  mc_name TEXT,
  claimed_by TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  last_activity_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS whitelist_apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT NOT NULL,
  username TEXT NOT NULL,
  uuid TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  message_id TEXT,
  channel_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alerts_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  channel_id TEXT,
  UNIQUE(server_id, event_type)
);

CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  uuid TEXT,
  service TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_claims (
  discord_id TEXT PRIMARY KEY,
  streak INTEGER NOT NULL DEFAULT 0,
  last_claim_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS appeals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL,
  discord_id TEXT NOT NULL,
  channel_id TEXT,
  explanation TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  accept_votes TEXT NOT NULL DEFAULT '[]',
  deny_votes TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  cron_expr TEXT NOT NULL,
  payload TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS perf_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL,
  tps REAL,
  mspt REAL,
  ram_used INTEGER,
  ram_max INTEGER,
  cpu REAL,
  chunks INTEGER,
  entities INTEGER,
  lag_sources TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_perf_time ON perf_samples(server_id, created_at);

CREATE TABLE IF NOT EXISTS ip_hashes (
  hashed_ip TEXT NOT NULL,
  minecraft_uuid TEXT NOT NULL,
  username TEXT,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (hashed_ip, minecraft_uuid)
);

CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  bytes INTEGER
);

CREATE TABLE IF NOT EXISTS rank_links (
  discord_role_id TEXT PRIMARY KEY,
  lp_group TEXT NOT NULL,
  donor INTEGER NOT NULL DEFAULT 0,
  expires_ms INTEGER
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_event_id TEXT,
  name TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  reminded_1h INTEGER NOT NULL DEFAULT 0,
  reminded_5m INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS giveaways (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT,
  channel_id TEXT,
  prize TEXT NOT NULL,
  winners INTEGER NOT NULL DEFAULT 1,
  require_linked INTEGER NOT NULL DEFAULT 1,
  min_playtime_min INTEGER NOT NULL DEFAULT 0,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  reward_command TEXT
);

CREATE TABLE IF NOT EXISTS giveaway_entries (
  giveaway_id INTEGER NOT NULL,
  discord_id TEXT NOT NULL,
  PRIMARY KEY (giveaway_id, discord_id)
);

CREATE TABLE IF NOT EXISTS raid_state (
  guild_id TEXT PRIMARY KEY,
  locked INTEGER NOT NULL DEFAULT 0,
  locked_at INTEGER
);

CREATE TABLE IF NOT EXISTS status_state (
  server_id INTEGER PRIMARY KEY,
  fail_streak INTEGER NOT NULL DEFAULT 0,
  last_rename_times TEXT NOT NULL DEFAULT '[]',
  last_online INTEGER
);
