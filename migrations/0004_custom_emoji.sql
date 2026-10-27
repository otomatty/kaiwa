-- Workspace custom emoji (:name: → uploaded image)
CREATE TABLE custom_emoji (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, name)
);
CREATE INDEX idx_custom_emoji_file ON custom_emoji(file_id);
