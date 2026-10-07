ALTER TABLE tickets ADD COLUMN submission_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_submission ON tickets(submission_id) WHERE submission_id IS NOT NULL;
