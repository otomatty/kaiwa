-- Separate "auto-join for new members" (is_default) from "everyone must stay" (is_required, #general only).
ALTER TABLE channels ADD COLUMN is_required INTEGER NOT NULL DEFAULT 0;
UPDATE channels SET is_required = 1 WHERE is_default = 1 AND name = 'general';
