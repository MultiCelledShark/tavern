ALTER TABLE users ADD COLUMN IF NOT EXISTS crypto_json TEXT;

ALTER TABLE project_invites ADD COLUMN IF NOT EXISTS key_wrap TEXT;

CREATE TABLE IF NOT EXISTS project_key_wraps (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wrap TEXT NOT NULL,
    PRIMARY KEY (project_id, user_id)
);
