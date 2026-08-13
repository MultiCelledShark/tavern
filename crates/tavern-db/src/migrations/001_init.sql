-- Postgres schema (current). CREATE IF NOT EXISTS so boot is idempotent.
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_admin BIGINT NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    email TEXT,
    email_verified BIGINT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    synopsis TEXT NOT NULL DEFAULT '',
    owner_id TEXT NOT NULL REFERENCES users(id),
    theme_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_grants (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'viewer',
    PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS elements (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    module_type TEXT NOT NULL,
    title TEXT NOT NULL,
    parent_id TEXT REFERENCES elements(id) ON DELETE SET NULL,
    sort_order BIGINT NOT NULL DEFAULT 0,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY NOT NULL,
    element_id TEXT NOT NULL REFERENCES elements(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'Page',
    sort_order BIGINT NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS panels (
    id TEXT PRIMARY KEY NOT NULL,
    page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    panel_type TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    border_color TEXT,
    layout_json TEXT NOT NULL DEFAULT '{}',
    content_json TEXT NOT NULL DEFAULT '{}',
    sort_order BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS element_links (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    from_element_id TEXT NOT NULL REFERENCES elements(id) ON DELETE CASCADE,
    to_element_id TEXT NOT NULL REFERENCES elements(id) ON DELETE CASCADE,
    label TEXT NOT NULL DEFAULT '',
    link_type TEXT NOT NULL DEFAULT 'related',
    metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    module_type TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    pages_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS manuscript_bodies (
    element_id TEXT PRIMARY KEY NOT NULL REFERENCES elements(id) ON DELETE CASCADE,
    markdown TEXT NOT NULL DEFAULT '',
    word_goal BIGINT NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS email_tokens (
    token_hash TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_elements_project ON elements(project_id);
CREATE INDEX IF NOT EXISTS idx_elements_module ON elements(project_id, module_type);
CREATE INDEX IF NOT EXISTS idx_pages_element ON pages(element_id);
CREATE INDEX IF NOT EXISTS idx_panels_page ON panels(page_id);
CREATE INDEX IF NOT EXISTS idx_links_project ON element_links(project_id);
CREATE INDEX IF NOT EXISTS idx_grants_user ON project_grants(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_invites_project ON project_invites(project_id);
CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
