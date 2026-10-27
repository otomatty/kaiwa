-- "Remind me about this" on saved (later) items.
ALTER TABLE saved_items ADD COLUMN remind_at INTEGER;
ALTER TABLE saved_items ADD COLUMN reminded_at INTEGER;
CREATE INDEX idx_saved_remind_due ON saved_items(remind_at) WHERE remind_at IS NOT NULL AND reminded_at IS NULL;
