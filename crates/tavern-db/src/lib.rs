use anyhow::{anyhow, Result};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use chrono::{Duration, Utc};
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::path::Path;
use std::str::FromStr;
use tavern_core::{
    default_panel_layout_for, default_template_pages, default_theme, Element, ElementLink, GrantRole,
    ModuleType, Page, Panel, PanelLayout, PanelType, Project, ProjectGrant, Template, User,
};
use uuid::Uuid;

pub struct Db {
    pool: SqlitePool,
}

impl Db {
    pub async fn connect(db_path: &Path) -> Result<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let url = format!("sqlite://{}?mode=rwc", db_path.display());
        let options = SqliteConnectOptions::from_str(&url)?
            .create_if_missing(true)
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(8)
            .connect_with(options)
            .await?;
        let db = Self { pool };
        db.migrate().await?;
        Ok(db)
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    async fn migrate(&self) -> Result<()> {
        let sql = include_str!("migrations/001_init.sql");
        sqlx::raw_sql(sql).execute(&self.pool).await?;
        Ok(())
    }

    pub const MIN_PASSWORD_LEN: usize = 12;

    pub async fn ensure_admin(
        &self,
        username: &str,
        password: &str,
        force_password: Option<&str>,
    ) -> Result<User> {
        if let Some(u) = self.get_user_by_username(username).await? {
            if let Some(new_pass) = force_password {
                Self::validate_password_strength(new_pass)?;
                self.set_password(u.id, new_pass).await?;
                tracing::info!(user = %username, "admin password rotated via TAVERN_ADMIN_PASS_FORCE");
                return self
                    .get_user(u.id)
                    .await?
                    .ok_or_else(|| anyhow!("admin missing after rotate"));
            }
            return Ok(u);
        }
        Self::validate_password_strength(password)?;
        self.create_user(username, password, true).await
    }

    pub fn validate_password_strength(password: &str) -> Result<()> {
        if password == "admin" || password == "change-me-to-a-strong-password" {
            // allow bootstrap default only if long enough for first boot docs;
            // operators should change it — warn elsewhere
        }
        if password == "admin" {
            return Err(anyhow!(
                "refusing default password 'admin'; set a strong TAVERN_ADMIN_PASS"
            ));
        }
        if password.len() < Self::MIN_PASSWORD_LEN {
            return Err(anyhow!(
                "password must be at least {} characters",
                Self::MIN_PASSWORD_LEN
            ));
        }
        Ok(())
    }

    pub fn hash_password(password: &str) -> Result<String> {
        let salt = SaltString::generate(&mut OsRng);
        let hash = Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map_err(|e| anyhow!("hash: {e}"))?
            .to_string();
        Ok(hash)
    }

    pub fn verify_password(password: &str, hash: &str) -> Result<bool> {
        let parsed = PasswordHash::new(hash).map_err(|e| anyhow!("parse hash: {e}"))?;
        Ok(Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok())
    }

    pub async fn set_password(&self, user_id: Uuid, password: &str) -> Result<()> {
        let hash = Self::hash_password(password)?;
        let r = sqlx::query("UPDATE users SET password_hash = ? WHERE id = ?")
            .bind(&hash)
            .bind(user_id.to_string())
            .execute(&self.pool)
            .await?;
        if r.rows_affected() == 0 {
            return Err(anyhow!("user not found"));
        }
        Ok(())
    }

    pub async fn create_user(&self, username: &str, password: &str, is_admin: bool) -> Result<User> {
        let id = Uuid::new_v4();
        let now = Utc::now();
        let hash = Self::hash_password(password)?;
        sqlx::query(
            "INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id.to_string())
        .bind(username)
        .bind(hash)
        .bind(is_admin as i64)
        .bind(now.to_rfc3339())
        .execute(&self.pool)
        .await?;
        Ok(User {
            id,
            username: username.to_string(),
            is_admin,
            created_at: now,
        })
    }

    pub async fn get_user(&self, id: Uuid) -> Result<Option<User>> {
        let row = sqlx::query(
            "SELECT id, username, is_admin, created_at FROM users WHERE id = ?",
        )
        .bind(id.to_string())
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| User {
            id: Uuid::parse_str(r.get::<String, _>("id").as_str()).unwrap(),
            username: r.get("username"),
            is_admin: r.get::<i64, _>("is_admin") != 0,
            created_at: parse_dt(r.get::<String, _>("created_at")),
        }))
    }

    pub async fn get_user_by_username(&self, username: &str) -> Result<Option<User>> {
        let row = sqlx::query(
            "SELECT id, username, is_admin, created_at FROM users WHERE username = ?",
        )
        .bind(username)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| User {
            id: Uuid::parse_str(r.get::<String, _>("id").as_str()).unwrap(),
            username: r.get("username"),
            is_admin: r.get::<i64, _>("is_admin") != 0,
            created_at: parse_dt(r.get::<String, _>("created_at")),
        }))
    }

    pub async fn get_password_hash(&self, username: &str) -> Result<Option<String>> {
        let row = sqlx::query("SELECT password_hash FROM users WHERE username = ?")
            .bind(username)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(|r| r.get("password_hash")))
    }

    pub async fn list_users(&self) -> Result<Vec<User>> {
        let rows = sqlx::query(
            "SELECT id, username, is_admin, created_at FROM users ORDER BY username",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| User {
                id: Uuid::parse_str(r.get::<String, _>("id").as_str()).unwrap(),
                username: r.get("username"),
                is_admin: r.get::<i64, _>("is_admin") != 0,
                created_at: parse_dt(r.get::<String, _>("created_at")),
            })
            .collect())
    }

    pub async fn create_session(&self, user_id: Uuid) -> Result<String> {
        let mut bytes = [0u8; 32];
        OsRng.fill_bytes(&mut bytes);
        let token = hex::encode(Sha256::digest(bytes));
        let now = Utc::now();
        let expires = now + Duration::days(30);
        sqlx::query(
            "INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(&token)
        .bind(user_id.to_string())
        .bind(expires.to_rfc3339())
        .bind(now.to_rfc3339())
        .execute(&self.pool)
        .await?;
        Ok(token)
    }

    pub async fn user_for_session(&self, token: &str) -> Result<Option<User>> {
        let row = sqlx::query(
            "SELECT u.id, u.username, u.is_admin, u.created_at, s.expires_at
             FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?",
        )
        .bind(token)
        .fetch_optional(&self.pool)
        .await?;
        let Some(r) = row else {
            return Ok(None);
        };
        let expires = parse_dt(r.get::<String, _>("expires_at"));
        if expires < Utc::now() {
            let _ = sqlx::query("DELETE FROM sessions WHERE token = ?")
                .bind(token)
                .execute(&self.pool)
                .await;
            return Ok(None);
        }
        Ok(Some(User {
            id: Uuid::parse_str(r.get::<String, _>("id").as_str()).unwrap(),
            username: r.get("username"),
            is_admin: r.get::<i64, _>("is_admin") != 0,
            created_at: parse_dt(r.get::<String, _>("created_at")),
        }))
    }

    pub async fn delete_session(&self, token: &str) -> Result<()> {
        sqlx::query("DELETE FROM sessions WHERE token = ?")
            .bind(token)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn project_access(
        &self,
        user: &User,
        project_id: Uuid,
    ) -> Result<Option<GrantRole>> {
        if user.is_admin {
            return Ok(Some(GrantRole::Owner));
        }
        let row = sqlx::query(
            "SELECT owner_id FROM projects WHERE id = ?",
        )
        .bind(project_id.to_string())
        .fetch_optional(&self.pool)
        .await?;
        let Some(r) = row else {
            return Ok(None);
        };
        let owner_id = Uuid::parse_str(r.get::<String, _>("owner_id").as_str()).unwrap();
        if owner_id == user.id {
            return Ok(Some(GrantRole::Owner));
        }
        let grant = sqlx::query(
            "SELECT role FROM project_grants WHERE project_id = ? AND user_id = ?",
        )
        .bind(project_id.to_string())
        .bind(user.id.to_string())
        .fetch_optional(&self.pool)
        .await?;
        Ok(grant.and_then(|g| GrantRole::parse(&g.get::<String, _>("role"))))
    }

    pub async fn create_project(
        &self,
        owner_id: Uuid,
        title: &str,
        synopsis: &str,
    ) -> Result<Project> {
        let id = Uuid::new_v4();
        let now = Utc::now();
        let theme = default_theme().to_string();
        sqlx::query(
            "INSERT INTO projects (id, title, synopsis, owner_id, theme_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id.to_string())
        .bind(title)
        .bind(synopsis)
        .bind(owner_id.to_string())
        .bind(theme)
        .bind(now.to_rfc3339())
        .bind(now.to_rfc3339())
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "INSERT INTO project_grants (project_id, user_id, role) VALUES (?, ?, 'owner')",
        )
        .bind(id.to_string())
        .bind(owner_id.to_string())
        .execute(&self.pool)
        .await?;
        self.get_project(id)
            .await?
            .ok_or_else(|| anyhow!("project missing after create"))
    }

    pub async fn get_project(&self, id: Uuid) -> Result<Option<Project>> {
        let row = sqlx::query(
            "SELECT id, title, synopsis, owner_id, theme_json, created_at, updated_at FROM projects WHERE id = ?",
        )
        .bind(id.to_string())
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| map_project(r)))
    }

    pub async fn list_projects_for_user(&self, user: &User) -> Result<Vec<Project>> {
        let rows = if user.is_admin {
            sqlx::query(
                "SELECT id, title, synopsis, owner_id, theme_json, created_at, updated_at
                 FROM projects ORDER BY updated_at DESC",
            )
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query(
                "SELECT p.id, p.title, p.synopsis, p.owner_id, p.theme_json, p.created_at, p.updated_at
                 FROM projects p
                 LEFT JOIN project_grants g ON g.project_id = p.id AND g.user_id = ?
                 WHERE p.owner_id = ? OR g.user_id IS NOT NULL
                 ORDER BY p.updated_at DESC",
            )
            .bind(user.id.to_string())
            .bind(user.id.to_string())
            .fetch_all(&self.pool)
            .await?
        };
        Ok(rows.into_iter().map(map_project).collect())
    }

    pub async fn update_project(
        &self,
        id: Uuid,
        title: &str,
        synopsis: &str,
        theme_json: &serde_json::Value,
    ) -> Result<Project> {
        let now = Utc::now();
        sqlx::query(
            "UPDATE projects SET title = ?, synopsis = ?, theme_json = ?, updated_at = ? WHERE id = ?",
        )
        .bind(title)
        .bind(synopsis)
        .bind(theme_json.to_string())
        .bind(now.to_rfc3339())
        .bind(id.to_string())
        .execute(&self.pool)
        .await?;
        self.get_project(id)
            .await?
            .ok_or_else(|| anyhow!("project not found"))
    }

    pub async fn delete_project(&self, id: Uuid) -> Result<()> {
        sqlx::query("DELETE FROM projects WHERE id = ?")
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn list_grants(&self, project_id: Uuid) -> Result<Vec<ProjectGrant>> {
        let rows = sqlx::query(
            "SELECT g.project_id, g.user_id, g.role, u.username
             FROM project_grants g JOIN users u ON u.id = g.user_id
             WHERE g.project_id = ?",
        )
        .bind(project_id.to_string())
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| ProjectGrant {
                project_id: Uuid::parse_str(r.get::<String, _>("project_id").as_str()).unwrap(),
                user_id: Uuid::parse_str(r.get::<String, _>("user_id").as_str()).unwrap(),
                role: GrantRole::parse(&r.get::<String, _>("role")).unwrap_or(GrantRole::Viewer),
                username: Some(r.get("username")),
            })
            .collect())
    }

    pub async fn upsert_grant(
        &self,
        project_id: Uuid,
        user_id: Uuid,
        role: GrantRole,
    ) -> Result<()> {
        sqlx::query(
            "INSERT INTO project_grants (project_id, user_id, role) VALUES (?, ?, ?)
             ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role",
        )
        .bind(project_id.to_string())
        .bind(user_id.to_string())
        .bind(role.as_str())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn delete_grant(&self, project_id: Uuid, user_id: Uuid) -> Result<()> {
        sqlx::query("DELETE FROM project_grants WHERE project_id = ? AND user_id = ?")
            .bind(project_id.to_string())
            .bind(user_id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn create_element(
        &self,
        project_id: Uuid,
        module_type: ModuleType,
        title: &str,
        parent_id: Option<Uuid>,
        metadata: serde_json::Value,
        apply_default_template: bool,
    ) -> Result<Element> {
        let id = Uuid::new_v4();
        let now = Utc::now();
        let sort = self.next_element_sort(project_id, module_type).await?;
        sqlx::query(
            "INSERT INTO elements (id, project_id, module_type, title, parent_id, sort_order, metadata, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id.to_string())
        .bind(project_id.to_string())
        .bind(module_type.as_str())
        .bind(title)
        .bind(parent_id.map(|p| p.to_string()))
        .bind(sort)
        .bind(metadata.to_string())
        .bind(now.to_rfc3339())
        .bind(now.to_rfc3339())
        .execute(&self.pool)
        .await?;

        if module_type == ModuleType::Manuscript {
            sqlx::query(
                "INSERT INTO manuscript_bodies (element_id, markdown, word_goal, updated_at) VALUES (?, '', 0, ?)",
            )
            .bind(id.to_string())
            .bind(now.to_rfc3339())
            .execute(&self.pool)
            .await?;
        } else if apply_default_template {
            self.apply_template_pages(id, &default_template_pages(module_type))
                .await?;
        }

        self.touch_project(project_id).await?;
        self.get_element(id)
            .await?
            .ok_or_else(|| anyhow!("element missing after create"))
    }

    async fn next_element_sort(&self, project_id: Uuid, module_type: ModuleType) -> Result<i64> {
        let row = sqlx::query(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM elements WHERE project_id = ? AND module_type = ?",
        )
        .bind(project_id.to_string())
        .bind(module_type.as_str())
        .fetch_one(&self.pool)
        .await?;
        Ok(row.get::<i64, _>("n"))
    }

    pub async fn apply_template_pages(
        &self,
        element_id: Uuid,
        pages_json: &serde_json::Value,
    ) -> Result<()> {
        let Some(arr) = pages_json.as_array() else {
            return Ok(());
        };
        for (pi, page_val) in arr.iter().enumerate() {
            let title = page_val
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("Page");
            let page = self.create_page(element_id, title, "", pi as i64).await?;
            if let Some(panels) = page_val.get("panels").and_then(|v| v.as_array()) {
                for (i, p) in panels.iter().enumerate() {
                    let ptype = p
                        .get("panel_type")
                        .and_then(|v| v.as_str())
                        .and_then(PanelType::parse)
                        .unwrap_or(PanelType::Text);
                    let ptitle = p
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let content = p
                        .get("content")
                        .cloned()
                        .unwrap_or_else(|| serde_json::json!({}));
                    let layout = p
                        .get("layout")
                        .and_then(|v| serde_json::from_value::<PanelLayout>(v.clone()).ok())
                        .unwrap_or_else(|| default_panel_layout_for(ptype.as_str(), i));
                    self.create_panel(page.id, ptype, &ptitle, None, layout, content, i as i64)
                        .await?;
                }
            }
        }
        Ok(())
    }

    pub async fn get_element(&self, id: Uuid) -> Result<Option<Element>> {
        let row = sqlx::query(
            "SELECT id, project_id, module_type, title, parent_id, sort_order, metadata, created_at, updated_at
             FROM elements WHERE id = ?",
        )
        .bind(id.to_string())
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(map_element))
    }

    pub async fn list_elements(
        &self,
        project_id: Uuid,
        module_type: Option<ModuleType>,
    ) -> Result<Vec<Element>> {
        let rows = if let Some(m) = module_type {
            sqlx::query(
                "SELECT id, project_id, module_type, title, parent_id, sort_order, metadata, created_at, updated_at
                 FROM elements WHERE project_id = ? AND module_type = ?
                 ORDER BY sort_order, title",
            )
            .bind(project_id.to_string())
            .bind(m.as_str())
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query(
                "SELECT id, project_id, module_type, title, parent_id, sort_order, metadata, created_at, updated_at
                 FROM elements WHERE project_id = ?
                 ORDER BY module_type, sort_order, title",
            )
            .bind(project_id.to_string())
            .fetch_all(&self.pool)
            .await?
        };
        Ok(rows.into_iter().map(map_element).collect())
    }

    pub async fn update_element(
        &self,
        id: Uuid,
        title: &str,
        parent_id: Option<Uuid>,
        sort_order: i64,
        metadata: serde_json::Value,
    ) -> Result<Element> {
        let now = Utc::now();
        let el = self
            .get_element(id)
            .await?
            .ok_or_else(|| anyhow!("element not found"))?;
        sqlx::query(
            "UPDATE elements SET title = ?, parent_id = ?, sort_order = ?, metadata = ?, updated_at = ? WHERE id = ?",
        )
        .bind(title)
        .bind(parent_id.map(|p| p.to_string()))
        .bind(sort_order)
        .bind(metadata.to_string())
        .bind(now.to_rfc3339())
        .bind(id.to_string())
        .execute(&self.pool)
        .await?;
        self.touch_project(el.project_id).await?;
        self.get_element(id)
            .await?
            .ok_or_else(|| anyhow!("element not found"))
    }

    pub async fn delete_element(&self, id: Uuid) -> Result<()> {
        if let Some(el) = self.get_element(id).await? {
            sqlx::query("DELETE FROM elements WHERE id = ?")
                .bind(id.to_string())
                .execute(&self.pool)
                .await?;
            self.touch_project(el.project_id).await?;
        }
        Ok(())
    }

    pub async fn create_page(
        &self,
        element_id: Uuid,
        title: &str,
        description: &str,
        sort_order: i64,
    ) -> Result<Page> {
        let id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO pages (id, element_id, title, sort_order, description) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id.to_string())
        .bind(element_id.to_string())
        .bind(title)
        .bind(sort_order)
        .bind(description)
        .execute(&self.pool)
        .await?;
        Ok(Page {
            id,
            element_id,
            title: title.to_string(),
            sort_order,
            description: description.to_string(),
        })
    }

    pub async fn list_pages(&self, element_id: Uuid) -> Result<Vec<Page>> {
        let rows = sqlx::query(
            "SELECT id, element_id, title, sort_order, description FROM pages WHERE element_id = ? ORDER BY sort_order",
        )
        .bind(element_id.to_string())
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| Page {
                id: Uuid::parse_str(r.get::<String, _>("id").as_str()).unwrap(),
                element_id: Uuid::parse_str(r.get::<String, _>("element_id").as_str()).unwrap(),
                title: r.get("title"),
                sort_order: r.get("sort_order"),
                description: r.get("description"),
            })
            .collect())
    }

    pub async fn update_page(
        &self,
        id: Uuid,
        title: &str,
        description: &str,
        sort_order: i64,
    ) -> Result<Page> {
        sqlx::query(
            "UPDATE pages SET title = ?, description = ?, sort_order = ? WHERE id = ?",
        )
        .bind(title)
        .bind(description)
        .bind(sort_order)
        .bind(id.to_string())
        .execute(&self.pool)
        .await?;
        let row = sqlx::query(
            "SELECT id, element_id, title, sort_order, description FROM pages WHERE id = ?",
        )
        .bind(id.to_string())
        .fetch_one(&self.pool)
        .await?;
        Ok(Page {
            id: Uuid::parse_str(row.get::<String, _>("id").as_str()).unwrap(),
            element_id: Uuid::parse_str(row.get::<String, _>("element_id").as_str()).unwrap(),
            title: row.get("title"),
            sort_order: row.get("sort_order"),
            description: row.get("description"),
        })
    }

    pub async fn delete_page(&self, id: Uuid) -> Result<()> {
        sqlx::query("DELETE FROM pages WHERE id = ?")
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn create_panel(
        &self,
        page_id: Uuid,
        panel_type: PanelType,
        title: &str,
        border_color: Option<&str>,
        layout: PanelLayout,
        content: serde_json::Value,
        sort_order: i64,
    ) -> Result<Panel> {
        let id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO panels (id, page_id, panel_type, title, border_color, layout_json, content_json, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id.to_string())
        .bind(page_id.to_string())
        .bind(panel_type.as_str())
        .bind(title)
        .bind(border_color)
        .bind(serde_json::to_string(&layout)?)
        .bind(content.to_string())
        .bind(sort_order)
        .execute(&self.pool)
        .await?;
        Ok(Panel {
            id,
            page_id,
            panel_type,
            title: title.to_string(),
            border_color: border_color.map(|s| s.to_string()),
            layout,
            content,
            sort_order,
        })
    }

    pub async fn list_panels(&self, page_id: Uuid) -> Result<Vec<Panel>> {
        let rows = sqlx::query(
            "SELECT id, page_id, panel_type, title, border_color, layout_json, content_json, sort_order
             FROM panels WHERE page_id = ? ORDER BY sort_order",
        )
        .bind(page_id.to_string())
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(map_panel).collect())
    }

    pub async fn update_panel(
        &self,
        id: Uuid,
        title: &str,
        border_color: Option<&str>,
        layout: PanelLayout,
        content: serde_json::Value,
        sort_order: i64,
    ) -> Result<Panel> {
        sqlx::query(
            "UPDATE panels SET title = ?, border_color = ?, layout_json = ?, content_json = ?, sort_order = ? WHERE id = ?",
        )
        .bind(title)
        .bind(border_color)
        .bind(serde_json::to_string(&layout)?)
        .bind(content.to_string())
        .bind(sort_order)
        .bind(id.to_string())
        .execute(&self.pool)
        .await?;
        let row = sqlx::query(
            "SELECT id, page_id, panel_type, title, border_color, layout_json, content_json, sort_order
             FROM panels WHERE id = ?",
        )
        .bind(id.to_string())
        .fetch_one(&self.pool)
        .await?;
        Ok(map_panel(row))
    }

    pub async fn delete_panel(&self, id: Uuid) -> Result<()> {
        sqlx::query("DELETE FROM panels WHERE id = ?")
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn create_link(
        &self,
        project_id: Uuid,
        from_element_id: Uuid,
        to_element_id: Uuid,
        label: &str,
        link_type: &str,
        metadata: serde_json::Value,
    ) -> Result<ElementLink> {
        let id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO element_links (id, project_id, from_element_id, to_element_id, label, link_type, metadata)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id.to_string())
        .bind(project_id.to_string())
        .bind(from_element_id.to_string())
        .bind(to_element_id.to_string())
        .bind(label)
        .bind(link_type)
        .bind(metadata.to_string())
        .execute(&self.pool)
        .await?;
        Ok(ElementLink {
            id,
            project_id,
            from_element_id,
            to_element_id,
            label: label.to_string(),
            link_type: link_type.to_string(),
            metadata,
        })
    }

    pub async fn list_links(&self, project_id: Uuid) -> Result<Vec<ElementLink>> {
        let rows = sqlx::query(
            "SELECT id, project_id, from_element_id, to_element_id, label, link_type, metadata
             FROM element_links WHERE project_id = ?",
        )
        .bind(project_id.to_string())
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(map_link).collect())
    }

    pub async fn delete_link(&self, id: Uuid) -> Result<()> {
        sqlx::query("DELETE FROM element_links WHERE id = ?")
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn get_manuscript(&self, element_id: Uuid) -> Result<(String, i64)> {
        let row = sqlx::query(
            "SELECT markdown, word_goal FROM manuscript_bodies WHERE element_id = ?",
        )
        .bind(element_id.to_string())
        .fetch_optional(&self.pool)
        .await?;
        Ok(row
            .map(|r| (r.get("markdown"), r.get("word_goal")))
            .unwrap_or_else(|| (String::new(), 0)))
    }

    pub async fn set_manuscript(
        &self,
        element_id: Uuid,
        markdown: &str,
        word_goal: i64,
    ) -> Result<()> {
        let now = Utc::now();
        sqlx::query(
            "INSERT INTO manuscript_bodies (element_id, markdown, word_goal, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(element_id) DO UPDATE SET markdown = excluded.markdown, word_goal = excluded.word_goal, updated_at = excluded.updated_at",
        )
        .bind(element_id.to_string())
        .bind(markdown)
        .bind(word_goal)
        .bind(now.to_rfc3339())
        .execute(&self.pool)
        .await?;
        sqlx::query("UPDATE elements SET updated_at = ? WHERE id = ?")
            .bind(now.to_rfc3339())
            .bind(element_id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Rewrite `[[Module:old_title]]` tokens across every manuscript in a project.
    pub async fn rewrite_wikilinks_in_project(
        &self,
        project_id: Uuid,
        module: ModuleType,
        old_title: &str,
        new_title: &str,
    ) -> Result<usize> {
        use tavern_core::rewrite_wikilinks;

        if old_title == new_title || old_title.is_empty() {
            return Ok(0);
        }
        let rows = sqlx::query(
            "SELECT mb.element_id AS element_id, mb.markdown AS markdown, mb.word_goal AS word_goal
             FROM manuscript_bodies mb
             INNER JOIN elements e ON e.id = mb.element_id
             WHERE e.project_id = ?",
        )
        .bind(project_id.to_string())
        .fetch_all(&self.pool)
        .await?;

        let mut updated = 0usize;
        let now = Utc::now().to_rfc3339();
        for row in rows {
            let element_id: String = row.get("element_id");
            let markdown: String = row.get("markdown");
            let word_goal: i64 = row.get("word_goal");
            let next = rewrite_wikilinks(&markdown, module, old_title, new_title);
            if next == markdown {
                continue;
            }
            sqlx::query(
                "UPDATE manuscript_bodies SET markdown = ?, word_goal = ?, updated_at = ? WHERE element_id = ?",
            )
            .bind(&next)
            .bind(word_goal)
            .bind(&now)
            .bind(&element_id)
            .execute(&self.pool)
            .await?;
            updated += 1;
        }
        if updated > 0 {
            self.touch_project(project_id).await?;
        }
        Ok(updated)
    }

    pub async fn save_template(
        &self,
        owner_id: Uuid,
        project_id: Option<Uuid>,
        module_type: ModuleType,
        name: &str,
        description: &str,
        pages_json: serde_json::Value,
    ) -> Result<Template> {
        let id = Uuid::new_v4();
        let now = Utc::now();
        sqlx::query(
            "INSERT INTO templates (id, project_id, owner_id, module_type, name, description, pages_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id.to_string())
        .bind(project_id.map(|p| p.to_string()))
        .bind(owner_id.to_string())
        .bind(module_type.as_str())
        .bind(name)
        .bind(description)
        .bind(pages_json.to_string())
        .bind(now.to_rfc3339())
        .execute(&self.pool)
        .await?;
        Ok(Template {
            id,
            project_id,
            owner_id,
            module_type,
            name: name.to_string(),
            description: description.to_string(),
            pages_json,
            created_at: now,
        })
    }

    pub async fn list_templates(
        &self,
        owner_id: Uuid,
        module_type: Option<ModuleType>,
    ) -> Result<Vec<Template>> {
        let rows = if let Some(m) = module_type {
            sqlx::query(
                "SELECT id, project_id, owner_id, module_type, name, description, pages_json, created_at
                 FROM templates WHERE owner_id = ? AND module_type = ? ORDER BY name",
            )
            .bind(owner_id.to_string())
            .bind(m.as_str())
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query(
                "SELECT id, project_id, owner_id, module_type, name, description, pages_json, created_at
                 FROM templates WHERE owner_id = ? ORDER BY module_type, name",
            )
            .bind(owner_id.to_string())
            .fetch_all(&self.pool)
            .await?
        };
        Ok(rows.into_iter().map(map_template).collect())
    }

    async fn touch_project(&self, project_id: Uuid) -> Result<()> {
        sqlx::query("UPDATE projects SET updated_at = ? WHERE id = ?")
            .bind(Utc::now().to_rfc3339())
            .bind(project_id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

fn parse_dt(s: String) -> chrono::DateTime<Utc> {
    chrono::DateTime::parse_from_rfc3339(&s)
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

fn map_project(r: sqlx::sqlite::SqliteRow) -> Project {
    Project {
        id: Uuid::parse_str(r.get::<String, _>("id").as_str()).unwrap(),
        title: r.get("title"),
        synopsis: r.get("synopsis"),
        owner_id: Uuid::parse_str(r.get::<String, _>("owner_id").as_str()).unwrap(),
        theme_json: serde_json::from_str(&r.get::<String, _>("theme_json"))
            .unwrap_or_else(|_| default_theme()),
        created_at: parse_dt(r.get("created_at")),
        updated_at: parse_dt(r.get("updated_at")),
    }
}

fn map_element(r: sqlx::sqlite::SqliteRow) -> Element {
    Element {
        id: Uuid::parse_str(r.get::<String, _>("id").as_str()).unwrap(),
        project_id: Uuid::parse_str(r.get::<String, _>("project_id").as_str()).unwrap(),
        module_type: ModuleType::parse(&r.get::<String, _>("module_type"))
            .unwrap_or(ModuleType::Encyclopedia),
        title: r.get("title"),
        parent_id: r
            .get::<Option<String>, _>("parent_id")
            .and_then(|s| Uuid::parse_str(&s).ok()),
        sort_order: r.get("sort_order"),
        metadata: serde_json::from_str(&r.get::<String, _>("metadata"))
            .unwrap_or_else(|_| serde_json::json!({})),
        created_at: parse_dt(r.get("created_at")),
        updated_at: parse_dt(r.get("updated_at")),
    }
}

fn map_panel(r: sqlx::sqlite::SqliteRow) -> Panel {
    Panel {
        id: Uuid::parse_str(r.get::<String, _>("id").as_str()).unwrap(),
        page_id: Uuid::parse_str(r.get::<String, _>("page_id").as_str()).unwrap(),
        panel_type: PanelType::parse(&r.get::<String, _>("panel_type")).unwrap_or(PanelType::Text),
        title: r.get("title"),
        border_color: r.get("border_color"),
        layout: serde_json::from_str(&r.get::<String, _>("layout_json")).unwrap_or(PanelLayout {
            x: 0.0,
            y: 0.0,
            w: 4.0,
            h: 3.0,
        }),
        content: serde_json::from_str(&r.get::<String, _>("content_json"))
            .unwrap_or_else(|_| serde_json::json!({})),
        sort_order: r.get("sort_order"),
    }
}

fn map_link(r: sqlx::sqlite::SqliteRow) -> ElementLink {
    ElementLink {
        id: Uuid::parse_str(r.get::<String, _>("id").as_str()).unwrap(),
        project_id: Uuid::parse_str(r.get::<String, _>("project_id").as_str()).unwrap(),
        from_element_id: Uuid::parse_str(r.get::<String, _>("from_element_id").as_str()).unwrap(),
        to_element_id: Uuid::parse_str(r.get::<String, _>("to_element_id").as_str()).unwrap(),
        label: r.get("label"),
        link_type: r.get("link_type"),
        metadata: serde_json::from_str(&r.get::<String, _>("metadata"))
            .unwrap_or_else(|_| serde_json::json!({})),
    }
}

fn map_template(r: sqlx::sqlite::SqliteRow) -> Template {
    Template {
        id: Uuid::parse_str(r.get::<String, _>("id").as_str()).unwrap(),
        project_id: r
            .get::<Option<String>, _>("project_id")
            .and_then(|s| Uuid::parse_str(&s).ok()),
        owner_id: Uuid::parse_str(r.get::<String, _>("owner_id").as_str()).unwrap(),
        module_type: ModuleType::parse(&r.get::<String, _>("module_type"))
            .unwrap_or(ModuleType::Encyclopedia),
        name: r.get("name"),
        description: r.get("description"),
        pages_json: serde_json::from_str(&r.get::<String, _>("pages_json"))
            .unwrap_or_else(|_| serde_json::json!([])),
        created_at: parse_dt(r.get("created_at")),
    }
}
