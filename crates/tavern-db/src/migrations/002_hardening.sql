-- Invites + session expiry index (idempotent)
CREATE TABLE IF NOT EXISTS project_invites (
    id TEXT PRIMARY KEY NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_invites_project ON project_invites(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
