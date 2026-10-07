ALTER TABLE appeals ADD COLUMN assigned_to TEXT;

CREATE TABLE IF NOT EXISTS appeal_staff_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appeal_id INTEGER NOT NULL,
  staff_id TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (appeal_id) REFERENCES appeals(id)
);

CREATE INDEX IF NOT EXISTS idx_appeal_notes_appeal ON appeal_staff_notes(appeal_id, id);
