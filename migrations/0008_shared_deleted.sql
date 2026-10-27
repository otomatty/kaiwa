-- Set on forwarded copies when their original is deleted (shared_from is nulled by the FK).
ALTER TABLE messages ADD COLUMN shared_deleted_at INTEGER;
