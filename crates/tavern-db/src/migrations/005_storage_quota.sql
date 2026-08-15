-- Per-user storage accounting (disk assets/exports + DB text payloads).
CREATE TABLE IF NOT EXISTS user_storage (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    used_bytes BIGINT NOT NULL DEFAULT 0,
    needs_reconcile BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_user_storage_reconcile
    ON user_storage (needs_reconcile)
    WHERE needs_reconcile = TRUE;
