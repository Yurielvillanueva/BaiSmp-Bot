ALTER TABLE appeals ADD COLUMN decision_reason TEXT;
ALTER TABLE appeals ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));

CREATE INDEX IF NOT EXISTS idx_appeals_owner_status ON appeals(discord_id, status);
CREATE INDEX IF NOT EXISTS idx_appeals_case_status ON appeals(case_id, status);
