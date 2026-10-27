-- Messages scheduled to be sent later (delivered by the cron trigger).
CREATE TABLE scheduled_messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  thread_root_id TEXT,
  broadcast INTEGER NOT NULL DEFAULT 0,
  send_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  error TEXT
);
CREATE INDEX idx_scheduled_due ON scheduled_messages(send_at) WHERE error IS NULL;
CREATE INDEX idx_scheduled_user ON scheduled_messages(user_id, workspace_id);
