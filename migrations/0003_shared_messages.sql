-- Forwarded ("shared") messages keep a reference to the original.
ALTER TABLE messages ADD COLUMN shared_from TEXT REFERENCES messages(id) ON DELETE SET NULL;
