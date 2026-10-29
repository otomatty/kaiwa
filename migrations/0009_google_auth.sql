-- Sign-in is Google-only: accounts are keyed by the Google account ID (the ID token's `sub`).
-- Accounts created before this are linked by their email address on their first Google sign-in.
ALTER TABLE users ADD COLUMN google_sub TEXT;
CREATE UNIQUE INDEX idx_users_google_sub ON users(google_sub);
ALTER TABLE users DROP COLUMN password_hash;
