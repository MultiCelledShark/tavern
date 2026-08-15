use axum::body::Body;
use axum::extract::{ConnectInfo, Multipart, Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use rust_embed::Embed;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tavern_core::{
    default_panel_layout_for, Element, GrantRole, ModuleType, PanelLayout, PanelType, ProjectView,
    User,
};
use tavern_export::{
    compile_manuscript_markdown, compile_world_bible_markdown, elements_to_intermediate,
    write_tavern_backup, write_with_pandoc, ChapterBody, ExportFormat,
};
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use crate::auth::{AdminUser, AuthUser};
use crate::security::client_ip;
use crate::state::AppState;

async fn reserve_owner_quota(
    state: &Arc<AppState>,
    owner_id: Uuid,
    additional: u64,
) -> Result<(), ApiError> {
    // Refresh counter when dirty (includes DB text + on-disk assets/exports).
    let used = crate::storage::storage_used(state, owner_id)
        .await
        .map_err(|e| ApiError::bad(&e.to_string()))?;
    let quota = state.config.user_quota_bytes;
    if additional == 0 {
        if used > quota {
            return Err(quota_exceeded(used, quota));
        }
        return Ok(());
    }
    let ok = state
        .db
        .try_reserve_storage(owner_id, additional, quota)
        .await?;
    if !ok {
        return Err(quota_exceeded(used, quota));
    }
    Ok(())
}

fn quota_exceeded(used: u64, quota: u64) -> ApiError {
    ApiError::bad(&format!(
        "storage quota exceeded ({} of {} used). Delete projects or assets to free space.",
        crate::storage::format_bytes(used),
        crate::storage::format_bytes(quota),
    ))
}

/// After writing a file that was reserved with `reserved` bytes, adjust the counter to `actual`.
async fn settle_file_reservation(
    state: &Arc<AppState>,
    owner_id: Uuid,
    reserved: u64,
    actual: u64,
    path: &std::path::Path,
) -> Result<(), ApiError> {
    let quota = state.config.user_quota_bytes;
    if actual > reserved {
        let extra = actual - reserved;
        let ok = state
            .db
            .try_reserve_storage(owner_id, extra, quota)
            .await?;
        if !ok {
            let _ = std::fs::remove_file(path);
            let _ = state.db.release_storage(owner_id, reserved).await;
            let used = state.db.get_storage_used(owner_id).await.unwrap_or(0);
            return Err(quota_exceeded(used, quota));
        }
    } else if reserved > actual {
        let _ = state
            .db
            .release_storage(owner_id, reserved - actual)
            .await;
    }
    Ok(())
}

async fn project_owner_id(state: &Arc<AppState>, project_id: Uuid) -> Result<Uuid, ApiError> {
    Ok(state
        .db
        .get_project(project_id)
        .await?
        .ok_or(ApiError::not_found("project"))?
        .owner_id)
}

async fn stream_file_response(
    path: PathBuf,
    content_type: String,
    filename: String,
) -> Result<Response, ApiError> {
    let meta = tokio::fs::metadata(&path)
        .await
        .map_err(|_| ApiError::not_found("file"))?;
    let file = tokio::fs::File::open(&path)
        .await
        .map_err(|_| ApiError::not_found("file"))?;
    let body = Body::from_stream(ReaderStream::new(file));
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{filename}\""),
        )
        .header(header::CONTENT_LENGTH, meta.len())
        .body(body)
        .map_err(|e| ApiError::bad(&e.to_string()))
}

#[derive(Embed)]
#[folder = "../../web/dist/"]
struct Assets;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/auth/login", post(login))
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/me", get(me))
        .route("/api/auth/config", get(auth_config))
        .route("/api/auth/storage", get(storage_usage))
        .route("/api/auth/signup", post(signup))
        .route("/api/auth/verify", post(verify_email))
        .route("/api/auth/resend", post(resend_verify))
        .route("/api/auth/forgot", post(forgot_password))
        .route("/api/auth/reset", post(reset_password))
        .route("/api/auth/vault", get(get_vault).put(put_vault))
        .route("/api/auth/reset-vault", post(reset_vault))
        .route("/api/crypto/pubkey/{username}", get(crypto_pubkey))
        .route("/api/projects/{id}/key-wrap", put(put_project_key_wrap))
        .route(
            "/api/projects/{id}/invites/{invite_id}/key-wrap",
            put(put_invite_key_wrap),
        )
        .route("/api/users", get(list_users).post(create_user))
        .route("/api/projects", get(list_projects).post(create_project))
        .route(
            "/api/projects/{id}",
            get(get_project).put(update_project).delete(delete_project),
        )
        .route(
            "/api/projects/{id}/grants",
            get(list_grants).post(upsert_grant),
        )
        .route("/api/projects/{id}/grants/{user_id}", delete(delete_grant))
        .route(
            "/api/projects/{id}/invites",
            get(list_invites).post(create_invite),
        )
        .route(
            "/api/projects/{id}/invites/{invite_id}",
            delete(revoke_invite),
        )
        .route("/api/invites/accept", post(accept_invite))
        .route(
            "/api/projects/{id}/elements",
            get(list_elements).post(create_element),
        )
        .route(
            "/api/elements/{id}",
            get(get_element).put(update_element).delete(delete_element),
        )
        .route(
            "/api/elements/{id}/pages",
            get(list_pages).post(create_page),
        )
        .route("/api/pages/{id}", put(update_page).delete(delete_page))
        .route(
            "/api/pages/{id}/panels",
            get(list_panels).post(create_panel),
        )
        .route("/api/panels/{id}", put(update_panel).delete(delete_panel))
        .route(
            "/api/projects/{id}/links",
            get(list_links).post(create_link),
        )
        .route("/api/links/{id}", delete(delete_link))
        .route(
            "/api/elements/{id}/manuscript",
            get(get_manuscript).put(put_manuscript),
        )
        .route("/api/templates", get(list_templates).post(save_template))
        .route("/api/projects/{id}/export", post(export_project))
        .route("/api/projects/{id}/backup", post(backup_project))
        .route(
            "/api/projects/{id}/assets",
            get(list_assets).post(upload_asset),
        )
        .route("/api/projects/{id}/assets/{name}", get(get_asset).delete(delete_asset))
        .route("/api/modules", get(list_modules))
        .route("/", get(index))
        .route("/assets/{*path}", get(static_asset))
        .fallback(index)
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "ok": true,
        "name": "tavern",
        "pandoc": tavern_export::pandoc_available()
    }))
}

#[derive(Deserialize)]
struct LoginBody {
    username: String,
    password: String,
}

async fn login(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    jar: CookieJar,
    Json(body): Json<LoginBody>,
) -> Result<(CookieJar, Json<serde_json::Value>), ApiError> {
    let ip = client_ip(&headers, Some(addr), state.config.trust_proxy);
    let window = Duration::from_secs(15 * 60);
    let ip_key = format!("login:ip:{ip}");
    let user_key = format!("login:user:{}", body.username);
    // Peek only — successful sign-ins must not burn the budget.
    if state.limiter.is_limited(&ip_key, 10, window)
        || state.limiter.is_limited(&user_key, 8, window)
    {
        return Err(ApiError::limited());
    }
    let hash = state
        .db
        .get_password_hash(&body.username)
        .await?
        .unwrap_or_else(|| state.dummy_password_hash.clone());
    let password_ok = tavern_db::Db::verify_password(&body.password, &hash)?;
    let user = state.db.get_user_by_username(&body.username).await?;
    if !password_ok || user.is_none() {
        state.limiter.hit(&ip_key, window);
        state.limiter.hit(&user_key, window);
        return Err(ApiError::unauthorized("invalid credentials"));
    }
    let user = user.unwrap();
    if !user.email_verified && !user.is_admin {
        return Err(ApiError::forbidden_msg(
            "verify your email before signing in",
        ));
    }
    let _ = state.db.purge_expired_sessions().await;
    let token = state.db.create_session(user.id).await?;
    let mut cookie = Cookie::new("tavern_session", token);
    cookie.set_http_only(true);
    cookie.set_path("/");
    cookie.set_same_site(SameSite::Lax);
    cookie.set_max_age(cookie::time::Duration::days(30));
    if state.config.cookie_secure || state.config.trust_proxy {
        cookie.set_secure(true);
    }
    let vault = state.db.get_crypto_json(user.id).await?;
    Ok((
        jar.add(cookie),
        Json(serde_json::json!({ "user": user, "vault": parse_vault_json(vault) })),
    ))
}

async fn logout(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    headers: HeaderMap,
) -> Result<(CookieJar, StatusCode), ApiError> {
    let token = jar
        .get("tavern_session")
        .map(|c| c.value().to_string())
        .or_else(|| {
            headers
                .get(header::AUTHORIZATION)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
                .map(|s| s.to_string())
        });
    if let Some(token) = token {
        state
            .sessions
            .remove(&tavern_db::Db::hash_secret(&token));
        let _ = state.db.delete_session(&token).await;
    }
    let mut cookie = Cookie::new("tavern_session", "");
    cookie.set_path("/");
    cookie.set_http_only(true);
    cookie.set_same_site(SameSite::Lax);
    if state.config.cookie_secure || state.config.trust_proxy {
        cookie.set_secure(true);
    }
    cookie.make_removal();
    Ok((jar.add(cookie), StatusCode::NO_CONTENT))
}

async fn me(AuthUser(user): AuthUser) -> Json<User> {
    Json(user)
}

async fn storage_usage(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let used = crate::storage::storage_used(&state, user.id)
        .await
        .map_err(|e| ApiError::bad(&e.to_string()))?;
    let quota = state.config.user_quota_bytes;
    Ok(Json(serde_json::json!({
        "used_bytes": used,
        "quota_bytes": quota,
        "used": crate::storage::format_bytes(used),
        "quota": crate::storage::format_bytes(quota),
    })))
}

async fn auth_config(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    Json(serde_json::json!({ "signup": state.config.signup_enabled }))
}

#[derive(Deserialize)]
struct SignupBody {
    username: String,
    email: String,
    password: String,
    crypto_json: Option<serde_json::Value>,
}

async fn signup(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<SignupBody>,
) -> Result<StatusCode, ApiError> {
    if !state.config.signup_enabled {
        return Err(ApiError::forbidden_msg("sign up is disabled"));
    }
    let ip = client_ip(&headers, Some(addr), state.config.trust_proxy);
    if !state
        .limiter
        .check(&format!("signup:ip:{ip}"), 5, Duration::from_secs(15 * 60))
    {
        return Err(ApiError::limited());
    }
    if !tavern_core::valid_username(&body.username) {
        return Err(ApiError::bad(
            "username must be 3–32 letters, numbers, _ or -",
        ));
    }
    let Some(email) = tavern_core::normalize_email(&body.email) else {
        return Err(ApiError::bad("invalid email"));
    };
    tavern_db::Db::validate_password_strength(&body.password)
        .map_err(|e| ApiError::bad(&e.to_string()))?;
    if !state.limiter.check(
        &format!("signup:email:{email}"),
        3,
        Duration::from_secs(60 * 60),
    ) {
        return Err(ApiError::limited());
    }
    if state
        .db
        .get_user_by_username(body.username.trim())
        .await?
        .is_some()
    {
        return Err(ApiError::bad("username taken"));
    }
    if let Some(existing) = state.db.get_user_by_email(&email).await? {
        if existing.email_verified {
            state.mailer.send_already_registered(&email);
        } else {
            let token = state
                .db
                .issue_email_token(existing.id, "verify", chrono::Duration::hours(48))
                .await?;
            state.mailer.send_verify(&email, &token);
        }
        return Ok(StatusCode::NO_CONTENT);
    }
    let user = state
        .db
        .create_user(
            body.username.trim(),
            &body.password,
            false,
            Some(&email),
            false,
        )
        .await?;
    if let Some(crypto) = body.crypto_json.as_ref() {
        let raw = crypto.to_string();
        validate_crypto_json(&raw)?;
        state.db.set_crypto_json(user.id, &raw).await?;
    }
    let token = state
        .db
        .issue_email_token(user.id, "verify", chrono::Duration::hours(48))
        .await?;
    state.mailer.send_verify(&email, &token);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct TokenBody {
    token: String,
}

async fn verify_email(
    State(state): State<Arc<AppState>>,
    Json(body): Json<TokenBody>,
) -> Result<StatusCode, ApiError> {
    let Some(user_id) = state
        .db
        .consume_email_token(body.token.trim(), "verify")
        .await?
    else {
        return Err(ApiError::bad("invalid or expired link"));
    };
    state.db.set_email_verified(user_id, true).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct EmailBody {
    email: String,
}

async fn resend_verify(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<EmailBody>,
) -> Result<StatusCode, ApiError> {
    let ip = client_ip(&headers, Some(addr), state.config.trust_proxy);
    if !state
        .limiter
        .check(&format!("resend:ip:{ip}"), 5, Duration::from_secs(15 * 60))
    {
        return Err(ApiError::limited());
    }
    let Some(email) = tavern_core::normalize_email(&body.email) else {
        return Ok(StatusCode::NO_CONTENT);
    };
    if let Some(user) = state.db.get_user_by_email(&email).await? {
        if !user.email_verified {
            let token = state
                .db
                .issue_email_token(user.id, "verify", chrono::Duration::hours(48))
                .await?;
            state.mailer.send_verify(&email, &token);
        }
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn forgot_password(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<EmailBody>,
) -> Result<StatusCode, ApiError> {
    let ip = client_ip(&headers, Some(addr), state.config.trust_proxy);
    if !state
        .limiter
        .check(&format!("forgot:ip:{ip}"), 5, Duration::from_secs(15 * 60))
    {
        return Err(ApiError::limited());
    }
    let Some(email) = tavern_core::normalize_email(&body.email) else {
        return Ok(StatusCode::NO_CONTENT);
    };
    if !state.limiter.check(
        &format!("forgot:email:{email}"),
        3,
        Duration::from_secs(60 * 60),
    ) {
        return Ok(StatusCode::NO_CONTENT);
    }
    if let Some(user) = state.db.get_user_by_email(&email).await? {
        if user.email_verified {
            let token = state
                .db
                .issue_email_token(user.id, "reset", chrono::Duration::hours(2))
                .await?;
            state.mailer.send_reset(&email, &token);
        } else {
            let token = state
                .db
                .issue_email_token(user.id, "verify", chrono::Duration::hours(48))
                .await?;
            state.mailer.send_verify(&email, &token);
        }
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct ResetBody {
    token: String,
    password: String,
    crypto_json: Option<serde_json::Value>,
}

async fn reset_password(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ResetBody>,
) -> Result<StatusCode, ApiError> {
    tavern_db::Db::validate_password_strength(&body.password)
        .map_err(|e| ApiError::bad(&e.to_string()))?;
    let Some(user_id) = state
        .db
        .consume_email_token(body.token.trim(), "reset")
        .await?
    else {
        return Err(ApiError::bad("invalid or expired link"));
    };
    if let Some(crypto) = body.crypto_json.as_ref() {
        let raw = crypto.to_string();
        validate_crypto_json(&raw)?;
        if let Some(existing) = state.db.get_crypto_json(user_id).await? {
            let old: serde_json::Value = serde_json::from_str(&existing)
                .map_err(|_| ApiError::bad("stored vault envelope is corrupt"))?;
            let new: serde_json::Value = serde_json::from_str(&raw)
                .map_err(|_| ApiError::bad("invalid vault envelope"))?;
            let old_pub = old.get("pub").and_then(|x| x.as_str());
            let new_pub = new.get("pub").and_then(|x| x.as_str());
            if old_pub.is_none() || old_pub != new_pub {
                return Err(ApiError::bad(
                    "vault recovery does not match this account",
                ));
            }
        }
        state.db.set_crypto_json(user_id, &raw).await?;
    }
    state.db.set_password(user_id, &body.password).await?;
    state.sessions.remove_user(user_id);
    state.db.delete_sessions_for_user(user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

fn parse_vault_json(raw: Option<String>) -> serde_json::Value {
    raw.and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::Value::Null)
}

fn validate_crypto_json(s: &str) -> Result<(), ApiError> {
    if s.len() > 32_768 {
        return Err(ApiError::bad("vault envelope too large"));
    }
    let v: serde_json::Value =
        serde_json::from_str(s).map_err(|_| ApiError::bad("invalid vault envelope"))?;
    let ok = v.get("v").and_then(|x| x.as_i64()) == Some(1)
        && v.get("vault_pw").and_then(|x| x.as_str()).is_some()
        && v.get("vault_rk").and_then(|x| x.as_str()).is_some()
        && v.get("pub").and_then(|x| x.as_str()).is_some()
        && v.get("priv_wrap").and_then(|x| x.as_str()).is_some();
    if !ok {
        return Err(ApiError::bad("invalid vault envelope"));
    }
    let pub_b64 = v.get("pub").and_then(|x| x.as_str()).unwrap_or("");
    let priv_wrap = v.get("priv_wrap").and_then(|x| x.as_str()).unwrap_or("");
    // P-256 uncompressed point is 65 bytes → ~88 chars base64; reject empty/huge.
    if !(40..=256).contains(&pub_b64.len()) || !(40..=8_192).contains(&priv_wrap.len()) {
        return Err(ApiError::bad("invalid vault envelope field sizes"));
    }
    Ok(())
}

fn validate_wrap(s: &str) -> Result<(), ApiError> {
    if s.is_empty() || s.len() > 16_384 {
        return Err(ApiError::bad("invalid key wrap"));
    }
    Ok(())
}

async fn get_vault(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let vault = state.db.get_crypto_json(user.id).await?;
    Ok(Json(
        serde_json::json!({ "vault": parse_vault_json(vault) }),
    ))
}

#[derive(Deserialize)]
struct VaultBody {
    crypto_json: serde_json::Value,
}

async fn put_vault(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Json(body): Json<VaultBody>,
) -> Result<StatusCode, ApiError> {
    let raw = body.crypto_json.to_string();
    validate_crypto_json(&raw)?;
    if let Some(existing) = state.db.get_crypto_json(user.id).await? {
        let old: serde_json::Value =
            serde_json::from_str(&existing).map_err(|_| ApiError::bad("corrupt vault on server"))?;
        let old_pub = old.get("pub").and_then(|x| x.as_str()).unwrap_or("");
        let new_pub = body
            .crypto_json
            .get("pub")
            .and_then(|x| x.as_str())
            .unwrap_or("");
        if !old_pub.is_empty() && old_pub != new_pub {
            return Err(ApiError::bad(
                "vault public key cannot change; use password reset with recovery key",
            ));
        }
    }
    state.db.set_crypto_json(user.id, &raw).await?;
    // Session cache may still have has_vault=false from login; drop it so /me refreshes.
    state.sessions.remove_user(user.id);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct ResetVaultBody {
    token: String,
}

async fn reset_vault(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<ResetVaultBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let ip = client_ip(&headers, Some(addr), state.config.trust_proxy);
    let window = Duration::from_secs(3600);
    if !state.limiter.check(&format!("reset-vault:{ip}"), 20, window) {
        return Err(ApiError::limited());
    }
    let Some(user_id) = state.db.peek_email_token(body.token.trim(), "reset").await? else {
        return Err(ApiError::not_found("reset"));
    };
    let vault = state.db.get_crypto_json(user_id).await?;
    Ok(Json(
        serde_json::json!({ "vault": parse_vault_json(vault) }),
    ))
}

async fn crypto_pubkey(
    AuthUser(_user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(username): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let Some((id, pub_b64)) = state.db.crypto_pub_for_username(&username).await? else {
        return Err(ApiError::not_found("user"));
    };
    Ok(Json(serde_json::json!({ "user_id": id, "pub": pub_b64 })))
}

#[derive(Deserialize)]
struct KeyWrapBody {
    wrap: String,
    username: Option<String>,
    user_id: Option<Uuid>,
}

async fn put_project_key_wrap(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<KeyWrapBody>,
) -> Result<StatusCode, ApiError> {
    validate_wrap(&body.wrap)?;
    let target = if let Some(uid) = body.user_id {
        require_manage(&state, &user, id).await?;
        uid
    } else if let Some(name) = &body.username {
        require_manage(&state, &user, id).await?;
        match state.db.get_user_by_username(name).await? {
            Some(u) => u.id,
            None => return Ok(StatusCode::NO_CONTENT),
        }
    } else {
        require_access(&state, &user, id).await?;
        user.id
    };
    state
        .db
        .upsert_project_key_wrap(id, target, &body.wrap)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct InviteWrapBody {
    wrap: String,
}

async fn put_invite_key_wrap(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path((id, invite_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<InviteWrapBody>,
) -> Result<StatusCode, ApiError> {
    require_manage(&state, &user, id).await?;
    validate_wrap(&body.wrap)?;
    if !state
        .db
        .set_invite_key_wrap(id, invite_id, &body.wrap)
        .await?
    {
        return Err(ApiError::not_found("invite"));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct CreateUserBody {
    username: String,
    password: String,
    email: Option<String>,
    is_admin: Option<bool>,
}

async fn list_users(
    _admin: AdminUser,
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<User>>, ApiError> {
    Ok(Json(state.db.list_users().await?))
}

async fn create_user(
    _admin: AdminUser,
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateUserBody>,
) -> Result<(StatusCode, Json<User>), ApiError> {
    if !state.limiter.check(
        &format!("admin:create-user:{}", _admin.0.id),
        30,
        Duration::from_secs(60 * 60),
    ) {
        return Err(ApiError::limited());
    }
    tavern_db::Db::validate_password_strength(&body.password)
        .map_err(|e| ApiError::bad(&e.to_string()))?;
    if !tavern_core::valid_username(&body.username) {
        return Err(ApiError::bad(
            "username must be 3–32 letters, numbers, _ or -",
        ));
    }
    if state
        .db
        .get_user_by_username(&body.username)
        .await?
        .is_some()
    {
        return Err(ApiError::bad("username taken"));
    }
    let email = match body
        .email
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(raw) => {
            let Some(e) = tavern_core::normalize_email(raw) else {
                return Err(ApiError::bad("invalid email"));
            };
            if state.db.get_user_by_email(&e).await?.is_some() {
                return Err(ApiError::bad("email taken"));
            }
            Some(e)
        }
        None => None,
    };
    let user = state
        .db
        .create_user(
            body.username.trim(),
            &body.password,
            body.is_admin.unwrap_or(false),
            email.as_deref(),
            true,
        )
        .await?;
    Ok((StatusCode::CREATED, Json(user)))
}

#[derive(Deserialize)]
struct CreateProjectBody {
    title: String,
    synopsis: Option<String>,
}

fn with_role(project: tavern_core::Project, my_role: GrantRole) -> ProjectView {
    ProjectView {
        project,
        my_role,
        key_wrap: None,
    }
}

fn with_wrap(
    project: tavern_core::Project,
    my_role: GrantRole,
    key_wrap: Option<String>,
) -> ProjectView {
    ProjectView {
        project,
        my_role,
        key_wrap,
    }
}

async fn list_projects(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<ProjectView>>, ApiError> {
    let rows = state.db.list_projects_for_user(&user).await?;
    Ok(Json(
        rows.into_iter()
            .map(|(p, role, wrap)| with_wrap(p, role, wrap))
            .collect(),
    ))
}

async fn create_project(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateProjectBody>,
) -> Result<(StatusCode, Json<ProjectView>), ApiError> {
    let synopsis = body.synopsis.as_deref().unwrap_or("");
    let approx = (body.title.len() + synopsis.len()) as u64;
    reserve_owner_quota(&state, user.id, approx.max(1)).await?;
    let p = match state.db.create_project(user.id, &body.title, synopsis).await {
        Ok(p) => p,
        Err(e) => {
            let _ = state.db.release_storage(user.id, approx.max(1)).await;
            return Err(e.into());
        }
    };
    Ok((StatusCode::CREATED, Json(with_role(p, GrantRole::Owner))))
}

async fn get_project(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<ProjectView>, ApiError> {
    let role = require_access(&state, &user, id).await?;
    let p = state
        .db
        .get_project(id)
        .await?
        .ok_or(ApiError::not_found("project"))?;
    let wrap = state.db.get_project_key_wrap(id, user.id).await?;
    Ok(Json(with_wrap(p, role, wrap)))
}

#[derive(Deserialize)]
struct UpdateProjectBody {
    title: String,
    synopsis: String,
    theme_json: Option<serde_json::Value>,
}

async fn update_project(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateProjectBody>,
) -> Result<Json<ProjectView>, ApiError> {
    let role = require_edit(&state, &user, id).await?;
    let theme = body.theme_json.unwrap_or_else(tavern_core::default_theme);
    let p = state
        .db
        .update_project(id, &body.title, &body.synopsis, &theme)
        .await?;
    let wrap = state.db.get_project_key_wrap(id, user.id).await?;
    Ok(Json(with_wrap(p, role, wrap)))
}

async fn delete_project(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    require_manage(&state, &user, id).await?;
    let owner = project_owner_id(&state, id).await?;
    state.db.delete_project(id).await?;
    let assets = state.config.project_assets_dir(id);
    let exports = state.config.project_exports_dir(id);
    let imports = state.config.data_dir.join("imports").join(id.to_string());
    for dir in [assets, exports, imports] {
        if dir.exists() {
            if let Err(e) = std::fs::remove_dir_all(&dir) {
                tracing::warn!(?dir, error = %e, "failed to remove project files on delete");
            }
        }
    }
    let _ = state.db.mark_storage_dirty(owner).await;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_grants(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<tavern_core::ProjectGrant>>, ApiError> {
    require_access(&state, &user, id).await?;
    Ok(Json(state.db.list_grants(id).await?))
}

#[derive(Deserialize)]
struct GrantBody {
    user_id: Option<Uuid>,
    username: Option<String>,
    role: String,
}

async fn upsert_grant(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<GrantBody>,
) -> Result<StatusCode, ApiError> {
    require_manage(&state, &user, id).await?;
    if !state.limiter.check(
        &format!("grant:{}", user.id),
        30,
        Duration::from_secs(15 * 60),
    ) {
        return Err(ApiError::limited());
    }
    let role = GrantRole::parse_shareable(&body.role).ok_or(ApiError::bad("invalid role"))?;
    let uid = if let Some(u) = body.user_id {
        u
    } else if let Some(name) = &body.username {
        match state.db.get_user_by_username(name).await? {
            Some(u) => u.id,
            None => return Ok(StatusCode::NO_CONTENT),
        }
    } else {
        return Err(ApiError::bad("user_id or username required"));
    };
    if state.db.get_user(uid).await?.is_none() {
        return Ok(StatusCode::NO_CONTENT);
    }
    state.db.upsert_grant(id, uid, role).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct InviteBody {
    role: String,
}

#[derive(Deserialize)]
struct AcceptInviteBody {
    token: String,
}

async fn list_invites(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<tavern_core::ProjectInvite>>, ApiError> {
    require_manage(&state, &user, id).await?;
    Ok(Json(state.db.list_invites(id).await?))
}

async fn create_invite(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<InviteBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_manage(&state, &user, id).await?;
    if !state.limiter.check(
        &format!("invite:{}", user.id),
        20,
        Duration::from_secs(15 * 60),
    ) {
        return Err(ApiError::limited());
    }
    let role = GrantRole::parse_shareable(&body.role).ok_or(ApiError::bad("invalid role"))?;
    let (token, invite) = state.db.create_invite(id, user.id, role).await?;
    Ok(Json(serde_json::json!({
        "token": token,
        "invite": invite,
    })))
}

async fn revoke_invite(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path((id, invite_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    require_manage(&state, &user, id).await?;
    state.db.delete_invite(id, invite_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn accept_invite(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Json(body): Json<AcceptInviteBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !state.limiter.check(
        &format!("invite-accept:{}", user.id),
        20,
        Duration::from_secs(15 * 60),
    ) {
        return Err(ApiError::limited());
    }
    let Some((project_id, role, key_wrap)) = state.db.accept_invite(&body.token).await? else {
        return Err(ApiError::bad("invite is invalid or expired"));
    };
    let current = state.db.project_access(&user, project_id).await?;
    let should_write = match current {
        Some(existing) if existing.can_manage() => false,
        Some(existing) if existing.can_edit() && !role.can_edit() => false,
        _ => true,
    };
    if should_write {
        state.db.upsert_grant(project_id, user.id, role).await?;
    }
    Ok(Json(serde_json::json!({
        "project_id": project_id,
        "role": role,
        "key_wrap": key_wrap,
    })))
}

async fn delete_grant(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path((id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let role = require_access(&state, &user, id).await?;
    if user_id == user.id {
        if role.can_manage() {
            return Err(ApiError::bad(
                "owners cannot leave; delete the project instead",
            ));
        }
        state.db.delete_grant(id, user_id).await?;
        return Ok(StatusCode::NO_CONTENT);
    }
    if !role.can_manage() {
        return Err(ApiError::forbidden());
    }
    state.db.delete_grant(id, user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct ListElementsQuery {
    module: Option<String>,
}

#[derive(Deserialize)]
struct CreateElementBody {
    module_type: String,
    title: String,
    parent_id: Option<Uuid>,
    metadata: Option<serde_json::Value>,
    apply_template: Option<bool>,
}

async fn list_elements(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Query(q): Query<ListElementsQuery>,
) -> Result<Json<Vec<Element>>, ApiError> {
    require_access(&state, &user, id).await?;
    let module = q.module.as_deref().and_then(ModuleType::parse);
    Ok(Json(state.db.list_elements(id, module).await?))
}

async fn create_element(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateElementBody>,
) -> Result<(StatusCode, Json<Element>), ApiError> {
    require_edit(&state, &user, id).await?;
    let module =
        ModuleType::parse(&body.module_type).ok_or(ApiError::bad("invalid module_type"))?;
    if let Some(parent) = body.parent_id {
        if !state.db.element_in_project(parent, id).await? {
            return Err(ApiError::bad("parent is not in this project"));
        }
    }
    let el = state
        .db
        .create_element(
            id,
            module,
            &body.title,
            body.parent_id,
            body.metadata.unwrap_or_else(|| serde_json::json!({})),
            body.apply_template.unwrap_or(true),
        )
        .await?;
    let owner = project_owner_id(&state, id).await?;
    let _ = state.db.mark_storage_dirty(owner).await;
    Ok((StatusCode::CREATED, Json(el)))
}

async fn get_element(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<Element>, ApiError> {
    let el = visible_element(&state, &user, id).await?;
    Ok(Json(el))
}

#[derive(Deserialize)]
struct UpdateElementBody {
    title: String,
    parent_id: Option<Uuid>,
    sort_order: i64,
    metadata: serde_json::Value,
}

async fn update_element(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateElementBody>,
) -> Result<Json<Element>, ApiError> {
    let el = visible_element(&state, &user, id).await?;
    require_edit(&state, &user, el.project_id).await?;
    if let Some(parent) = body.parent_id {
        if !state.db.element_in_project(parent, el.project_id).await? {
            return Err(ApiError::bad("parent is not in this project"));
        }
    }
    let updated = state
        .db
        .update_element(
            id,
            &body.title,
            body.parent_id,
            body.sort_order,
            body.metadata,
        )
        .await?;
    // Keep manuscript [[Module:Title]] tokens in sync when a linked element is renamed.
    if el.title != body.title {
        let _ = state
            .db
            .rewrite_wikilinks_in_project(el.project_id, el.module_type, &el.title, &body.title)
            .await?;
    }
    Ok(Json(updated))
}

async fn delete_element(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let el = visible_element(&state, &user, id).await?;
    require_edit(&state, &user, el.project_id).await?;
    state.db.delete_element(id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct CreatePageBody {
    title: String,
    description: Option<String>,
    sort_order: Option<i64>,
}

async fn list_pages(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<tavern_core::Page>>, ApiError> {
    visible_element(&state, &user, id).await?;
    Ok(Json(state.db.list_pages(id).await?))
}

async fn create_page(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<CreatePageBody>,
) -> Result<(StatusCode, Json<tavern_core::Page>), ApiError> {
    let el = visible_element(&state, &user, id).await?;
    require_edit(&state, &user, el.project_id).await?;
    let page = state
        .db
        .create_page(
            id,
            &body.title,
            body.description.as_deref().unwrap_or(""),
            body.sort_order.unwrap_or(0),
        )
        .await?;
    Ok((StatusCode::CREATED, Json(page)))
}

#[derive(Deserialize)]
struct UpdatePageBody {
    title: String,
    description: String,
    sort_order: i64,
}

async fn update_page(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdatePageBody>,
) -> Result<Json<tavern_core::Page>, ApiError> {
    let pages_el = visible_element_for_page(&state, &user, id).await?;
    require_edit(&state, &user, pages_el.project_id).await?;
    Ok(Json(
        state
            .db
            .update_page(id, &body.title, &body.description, body.sort_order)
            .await?,
    ))
}

async fn delete_page(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let el = visible_element_for_page(&state, &user, id).await?;
    require_edit(&state, &user, el.project_id).await?;
    state.db.delete_page(id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct CreatePanelBody {
    panel_type: String,
    title: String,
    border_color: Option<String>,
    layout: Option<PanelLayout>,
    content: Option<serde_json::Value>,
    sort_order: Option<i64>,
}

async fn list_panels(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<tavern_core::Panel>>, ApiError> {
    visible_element_for_page(&state, &user, id).await?;
    Ok(Json(state.db.list_panels(id).await?))
}

async fn create_panel(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<CreatePanelBody>,
) -> Result<(StatusCode, Json<tavern_core::Panel>), ApiError> {
    let el = visible_element_for_page(&state, &user, id).await?;
    require_edit(&state, &user, el.project_id).await?;
    let ptype = PanelType::parse(&body.panel_type).ok_or(ApiError::bad("invalid panel_type"))?;
    let sort = body.sort_order.unwrap_or(0);
    let layout = body
        .layout
        .unwrap_or_else(|| default_panel_layout_for(ptype.as_str(), sort as usize));
    let panel = state
        .db
        .create_panel(
            id,
            ptype,
            &body.title,
            body.border_color.as_deref(),
            layout,
            body.content.unwrap_or_else(|| serde_json::json!({})),
            sort,
        )
        .await?;
    let owner = project_owner_id(&state, el.project_id).await?;
    let _ = state.db.mark_storage_dirty(owner).await;
    Ok((StatusCode::CREATED, Json(panel)))
}

#[derive(Deserialize)]
struct UpdatePanelBody {
    title: String,
    border_color: Option<String>,
    layout: PanelLayout,
    content: serde_json::Value,
    sort_order: i64,
}

async fn update_panel(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdatePanelBody>,
) -> Result<Json<tavern_core::Panel>, ApiError> {
    let el = visible_element_for_panel(&state, &user, id).await?;
    require_edit(&state, &user, el.project_id).await?;
    let panel = state
        .db
        .update_panel(
            id,
            &body.title,
            body.border_color.as_deref(),
            body.layout,
            body.content,
            body.sort_order,
        )
        .await?;
    let owner = project_owner_id(&state, el.project_id).await?;
    let _ = state.db.mark_storage_dirty(owner).await;
    Ok(Json(panel))
}

async fn delete_panel(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let el = visible_element_for_panel(&state, &user, id).await?;
    require_edit(&state, &user, el.project_id).await?;
    state.db.delete_panel(id).await?;
    let owner = project_owner_id(&state, el.project_id).await?;
    let _ = state.db.mark_storage_dirty(owner).await;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct CreateLinkBody {
    from_element_id: Uuid,
    to_element_id: Uuid,
    label: Option<String>,
    link_type: Option<String>,
    metadata: Option<serde_json::Value>,
}

async fn list_links(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<tavern_core::ElementLink>>, ApiError> {
    require_access(&state, &user, id).await?;
    Ok(Json(state.db.list_links(id).await?))
}

async fn create_link(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateLinkBody>,
) -> Result<(StatusCode, Json<tavern_core::ElementLink>), ApiError> {
    require_edit(&state, &user, id).await?;
    if !state
        .db
        .element_in_project(body.from_element_id, id)
        .await?
        || !state.db.element_in_project(body.to_element_id, id).await?
    {
        return Err(ApiError::bad("link endpoints must belong to this project"));
    }
    let link = state
        .db
        .create_link(
            id,
            body.from_element_id,
            body.to_element_id,
            body.label.as_deref().unwrap_or(""),
            body.link_type.as_deref().unwrap_or("related"),
            body.metadata.unwrap_or_else(|| serde_json::json!({})),
        )
        .await?;
    Ok((StatusCode::CREATED, Json(link)))
}

async fn delete_link(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let Some(link) = state.db.get_link(id).await? else {
        return Err(ApiError::not_found("link"));
    };
    if state
        .db
        .project_access(&user, link.project_id)
        .await?
        .is_none()
    {
        return Err(ApiError::not_found("link"));
    }
    require_edit(&state, &user, link.project_id).await?;
    state.db.delete_link(id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize)]
struct ManuscriptBody {
    markdown: String,
    word_goal: i64,
    word_count: usize,
    updated_at: String,
}

#[derive(Deserialize)]
struct PutManuscriptBody {
    markdown: String,
    word_goal: Option<i64>,
    updated_at: Option<String>,
}

async fn get_manuscript(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<ManuscriptBody>, ApiError> {
    visible_element(&state, &user, id).await?;
    let (markdown, word_goal, updated_at) = state.db.get_manuscript(id).await?;
    let word_count = count_words(&markdown);
    Ok(Json(ManuscriptBody {
        markdown,
        word_goal,
        word_count,
        updated_at,
    }))
}

async fn put_manuscript(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<PutManuscriptBody>,
) -> Result<Json<ManuscriptBody>, ApiError> {
    let el = visible_element(&state, &user, id).await?;
    require_edit(&state, &user, el.project_id).await?;
    if body.markdown.len() > 8 * 1024 * 1024 {
        return Err(ApiError::bad("manuscript too large (max 8MB)"));
    }
    let (current_md, current_goal, current_at) = state.db.get_manuscript(id).await?;
    let owner = project_owner_id(&state, el.project_id).await?;
    let old_len = current_md.len() as u64;
    let new_len = body.markdown.len() as u64;
    if new_len > old_len {
        reserve_owner_quota(&state, owner, new_len - old_len).await?;
    }
    let goal = body.word_goal.unwrap_or(current_goal);
    let Some(updated_at) = state
        .db
        .set_manuscript(id, &body.markdown, goal, body.updated_at.as_deref())
        .await?
    else {
        if new_len > old_len {
            let _ = state.db.release_storage(owner, new_len - old_len).await;
        }
        return Err(ApiError::conflict(serde_json::json!({
            "error": "edit conflict",
            "markdown": current_md,
            "word_goal": current_goal,
            "word_count": count_words(&current_md),
            "updated_at": current_at,
        })));
    };
    if old_len > new_len {
        let _ = state.db.release_storage(owner, old_len - new_len).await;
    }
    Ok(Json(ManuscriptBody {
        word_count: count_words(&body.markdown),
        markdown: body.markdown,
        word_goal: goal,
        updated_at,
    }))
}

#[derive(Deserialize)]
struct TemplateQuery {
    module: Option<String>,
}

#[derive(Deserialize)]
struct SaveTemplateBody {
    name: String,
    description: Option<String>,
    module_type: String,
    project_id: Option<Uuid>,
    pages_json: serde_json::Value,
}

async fn list_templates(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Query(q): Query<TemplateQuery>,
) -> Result<Json<Vec<tavern_core::Template>>, ApiError> {
    let module = q.module.as_deref().and_then(ModuleType::parse);
    Ok(Json(state.db.list_templates(user.id, module).await?))
}

async fn save_template(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Json(body): Json<SaveTemplateBody>,
) -> Result<(StatusCode, Json<tavern_core::Template>), ApiError> {
    let module =
        ModuleType::parse(&body.module_type).ok_or(ApiError::bad("invalid module_type"))?;
    if let Some(pid) = body.project_id {
        require_access(&state, &user, pid).await?;
    }
    let t = state
        .db
        .save_template(
            user.id,
            body.project_id,
            module,
            &body.name,
            body.description.as_deref().unwrap_or(""),
            body.pages_json,
        )
        .await?;
    Ok((StatusCode::CREATED, Json(t)))
}

#[derive(Deserialize)]
struct ExportBody {
    format: String,
    kind: Option<String>, // manuscript | bible
}

async fn export_project(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<ExportBody>,
) -> Result<Response, ApiError> {
    require_edit(&state, &user, id).await?;
    let format = ExportFormat::parse(&body.format).ok_or(ApiError::bad("invalid format"))?;
    let wrap = state.db.get_project_key_wrap(id, user.id).await?;
    if wrap.is_some() {
        return Err(ApiError::bad(
            "this project is encrypted; export from the browser",
        ));
    }
    let owner = project_owner_id(&state, id).await?;
    let project = state
        .db
        .get_project(id)
        .await?
        .ok_or(ApiError::not_found("project"))?;
    let kind = body.kind.as_deref().unwrap_or("manuscript");
    let markdown = if kind == "bible" {
        let elements = state.db.list_elements(id, None).await?;
        let mut pairs = Vec::new();
        for el in elements {
            let body_md = if el.module_type == ModuleType::Manuscript {
                None
            } else {
                // gather text panels
                let pages = state.db.list_pages(el.id).await?;
                let mut md = String::new();
                for page in pages {
                    for panel in state.db.list_panels(page.id).await? {
                        if let Some(t) = panel.content.get("markdown").and_then(|v| v.as_str()) {
                            md.push_str(t);
                            md.push_str("\n\n");
                        }
                    }
                }
                Some(md)
            };
            pairs.push((el, body_md));
        }
        compile_world_bible_markdown(&project.title, &pairs)
    } else {
        let chapters = state
            .db
            .list_elements(id, Some(ModuleType::Manuscript))
            .await?;
        let mut bodies = Vec::new();
        for ch in chapters {
            let (md, _, _) = state.db.get_manuscript(ch.id).await?;
            bodies.push(ChapterBody {
                title: ch.title,
                markdown: md,
                sort_order: ch.sort_order,
            });
        }
        compile_manuscript_markdown(&project.title, &bodies)
    };

    // Soft estimate: pandoc output is usually near markdown size (docx/epub can be larger).
    let estimate = (markdown.len() as u64).saturating_mul(2).max(1);
    reserve_owner_quota(&state, owner, estimate).await?;

    let out_dir = state.config.project_exports_dir(id);
    let filename = format!(
        "{}-{}.{}",
        sanitize(&project.title),
        kind,
        format.extension()
    );
    let out_path = out_dir.join(&filename);
    if let Err(e) = write_with_pandoc(&markdown, &out_path, format) {
        let _ = state.db.release_storage(owner, estimate).await;
        return Err(e.into());
    }
    let meta = match std::fs::metadata(&out_path) {
        Ok(m) => m,
        Err(e) => {
            let _ = state.db.release_storage(owner, estimate).await;
            return Err(e.into());
        }
    };
    const MAX_EXPORT: u64 = 256 * 1024 * 1024;
    let actual = meta.len();
    if actual > MAX_EXPORT {
        let _ = std::fs::remove_file(&out_path);
        let _ = state.db.release_storage(owner, estimate).await;
        return Err(ApiError::bad(
            "export too large (max 256MB); split the project or delete assets",
        ));
    }
    if let Err(e) = settle_file_reservation(&state, owner, estimate, actual, &out_path).await {
        return Err(e);
    }
    stream_file_response(out_path, content_type_for(format), filename).await
}

async fn backup_project(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Response, ApiError> {
    require_edit(&state, &user, id).await?;
    if state.db.project_has_key_wrap(id).await? {
        return Err(ApiError::bad(
            "this project is encrypted; backup from the browser (downloads recoverable JSON)",
        ));
    }
    let owner = project_owner_id(&state, id).await?;
    reserve_owner_quota(&state, owner, 0).await?;
    let project = state
        .db
        .get_project(id)
        .await?
        .ok_or(ApiError::not_found("project"))?;
    let elements = state.db.list_elements(id, None).await?;
    let mut id_to_title = HashMap::new();
    for el in &elements {
        id_to_title.insert(el.id, el.title.clone());
    }
    let mut packed = Vec::new();
    for el in elements {
        let body = if el.module_type == ModuleType::Manuscript {
            Some(state.db.get_manuscript(el.id).await?.0)
        } else {
            None
        };
        let mut panels = Vec::new();
        for page in state.db.list_pages(el.id).await? {
            panels.extend(state.db.list_panels(page.id).await?);
        }
        packed.push((el, body, panels));
    }
    let links = state.db.list_links(id).await?;
    let intermediate = elements_to_intermediate(
        &project.title,
        &project.synopsis,
        packed,
        links,
        &id_to_title,
    );
    let assets = state.config.project_assets_dir(id);
    let out_dir = state.config.project_exports_dir(id);
    std::fs::create_dir_all(&out_dir)?;
    let out = out_dir.join(format!("{}.tavern", sanitize(&project.title)));
    // Reserve a soft estimate from assets dir size + JSON overhead, then settle to actual.
    let asset_estimate = crate::storage::dir_size(&assets).saturating_add(1_048_576);
    reserve_owner_quota(&state, owner, asset_estimate).await?;
    if let Err(e) = write_tavern_backup(&out, &intermediate, Some(&assets)) {
        let _ = state.db.release_storage(owner, asset_estimate).await;
        return Err(e.into());
    }
    let meta = match std::fs::metadata(&out) {
        Ok(m) => m,
        Err(e) => {
            let _ = state.db.release_storage(owner, asset_estimate).await;
            return Err(e.into());
        }
    };
    const MAX_BACKUP: u64 = 256 * 1024 * 1024;
    let actual = meta.len();
    if actual > MAX_BACKUP {
        let _ = std::fs::remove_file(&out);
        let _ = state.db.release_storage(owner, asset_estimate).await;
        return Err(ApiError::bad(
            "backup too large (max 256MB); remove assets or export chapters separately",
        ));
    }
    if let Err(e) = settle_file_reservation(&state, owner, asset_estimate, actual, &out).await {
        return Err(e);
    }
    let filename = format!("{}.tavern", sanitize(&project.title));
    stream_file_response(out, "application/zip".into(), filename).await
}

#[derive(Serialize)]
struct AssetInfo {
    name: String,
    url: String,
    size: u64,
}

fn safe_asset_name(original: &str) -> Result<String, ApiError> {
    let ext = std::path::Path::new(original)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("bin")
        .to_ascii_lowercase();
    // SVG omitted: served inline it becomes same-origin scriptable XSS.
    let allowed = ["png", "jpg", "jpeg", "webp", "gif"];
    if !allowed.contains(&ext.as_str()) {
        return Err(ApiError::bad("only image uploads (png/jpg/webp/gif)"));
    }
    Ok(format!("{}.{}", Uuid::new_v4(), ext))
}

async fn list_assets(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<AssetInfo>>, ApiError> {
    require_access(&state, &user, id).await?;
    let dir = state.config.project_assets_dir(id);
    let mut out = Vec::new();
    if dir.is_dir() {
        for entry in std::fs::read_dir(&dir)? {
            let entry = entry?;
            let meta = entry.metadata()?;
            if !meta.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            out.push(AssetInfo {
                url: format!("/api/projects/{id}/assets/{name}"),
                name,
                size: meta.len(),
            });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(Json(out))
}

async fn upload_asset(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<AssetInfo>), ApiError> {
    require_edit(&state, &user, id).await?;
    let dir = state.config.project_assets_dir(id);
    std::fs::create_dir_all(&dir)?;

    let mut stored: Option<AssetInfo> = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| ApiError::bad(&e.to_string()))?
    {
        if field.name() != Some("file") {
            continue;
        }
        let original = field
            .file_name()
            .map(|s| s.to_string())
            .unwrap_or_else(|| "upload.bin".into());
        let name = safe_asset_name(&original)?;
        let bytes = field
            .bytes()
            .await
            .map_err(|e| ApiError::bad(&e.to_string()))?;
        if bytes.len() > 12 * 1024 * 1024 {
            return Err(ApiError::bad("file too large (max 12MB)"));
        }
        let owner = project_owner_id(&state, id).await?;
        reserve_owner_quota(&state, owner, bytes.len() as u64).await?;
        let path = dir.join(&name);
        if let Err(e) = std::fs::write(&path, &bytes) {
            let _ = state.db.release_storage(owner, bytes.len() as u64).await;
            return Err(e.into());
        }
        stored = Some(AssetInfo {
            name: name.clone(),
            url: format!("/api/projects/{id}/assets/{name}"),
            size: bytes.len() as u64,
        });
    }
    let info = stored.ok_or(ApiError::bad("missing file field"))?;
    Ok((StatusCode::CREATED, Json(info)))
}

async fn get_asset(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path((id, name)): Path<(Uuid, String)>,
) -> Result<Response, ApiError> {
    require_access(&state, &user, id).await?;
    if name.contains("..") || name.contains('/') || name.contains('\\') {
        return Err(ApiError::bad("invalid asset name"));
    }
    let path = state.config.project_assets_dir(id).join(&name);
    let bytes = std::fs::read(&path).map_err(|_| ApiError::not_found("asset"))?;
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".svg") || lower.ends_with(".svgz") {
        return Ok((
            [
                (header::CONTENT_TYPE, "application/octet-stream".to_string()),
                (
                    header::CONTENT_DISPOSITION,
                    format!("attachment; filename=\"{name}\""),
                ),
            ],
            bytes,
        )
            .into_response());
    }
    let mime = mime_guess::from_path(&path)
        .first_or_octet_stream()
        .to_string();
    // Refuse to serve leftover SVGs as navigable documents (XSS).
    if mime.starts_with("image/svg") || name.to_ascii_lowercase().ends_with(".svg") {
        return Err(ApiError::bad("svg assets are disabled"));
    }
    let mut res = ([(header::CONTENT_TYPE, mime)], bytes).into_response();
    res.headers_mut().insert(
        header::HeaderName::from_static("x-content-type-options"),
        header::HeaderValue::from_static("nosniff"),
    );
    Ok(res)
}

async fn delete_asset(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path((id, name)): Path<(Uuid, String)>,
) -> Result<StatusCode, ApiError> {
    require_edit(&state, &user, id).await?;
    if name.contains("..") || name.contains('/') || name.contains('\\') {
        return Err(ApiError::bad("invalid asset name"));
    }
    let owner = project_owner_id(&state, id).await?;
    let path = state.config.project_assets_dir(id).join(&name);
    if path.is_file() {
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        std::fs::remove_file(&path)?;
        let _ = state.db.release_storage(owner, size).await;
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn list_modules() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "modules": ModuleType::all().iter().map(|m| m.as_str()).collect::<Vec<_>>()
    }))
}

async fn index() -> Response {
    match Assets::get("index.html") {
        Some(f) => (
            [(header::CACHE_CONTROL, "no-cache, no-store, must-revalidate")],
            Html(
                std::str::from_utf8(f.data.as_ref())
                    .unwrap_or("<p>Tavern UI missing</p>")
                    .to_string(),
            ),
        )
            .into_response(),
        None => Html(
            r#"<!DOCTYPE html><html><head><meta charset="utf-8"><title>Tavern</title></head>
<body style="font-family:system-ui;background:#e6e9e6;color:#1c2421;padding:2rem">
<h1>Tavern</h1>
<p>API is running. Build the UI with <code>cd web && npm install && npm run build</code>.</p>
</body></html>"#
                .to_string(),
        )
        .into_response(),
    }
}

async fn static_asset(Path(path): Path<String>) -> Response {
    // Route is `/assets/{*path}`, but rust-embed keys are relative to `web/dist/`
    // (e.g. `assets/index-….js`), so re-prefix the folder segment.
    let path = path.trim_start_matches('/');
    let key = if path.starts_with("assets/") {
        path.to_string()
    } else {
        format!("assets/{path}")
    };
    match Assets::get(&key) {
        Some(f) => {
            let mime = mime_guess::from_path(&key)
                .first_or_octet_stream()
                .to_string();
            (
                [
                    (header::CONTENT_TYPE, mime.as_str()),
                    (header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
                ],
                f.data.to_vec(),
            )
                .into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn require_access(
    state: &AppState,
    user: &User,
    project_id: Uuid,
) -> Result<GrantRole, ApiError> {
    state
        .db
        .project_access(user, project_id)
        .await?
        .ok_or(ApiError::forbidden())
}

async fn require_edit(
    state: &AppState,
    user: &User,
    project_id: Uuid,
) -> Result<GrantRole, ApiError> {
    let role = require_access(state, user, project_id).await?;
    if !role.can_edit() {
        return Err(ApiError::forbidden());
    }
    Ok(role)
}

async fn require_manage(
    state: &AppState,
    user: &User,
    project_id: Uuid,
) -> Result<GrantRole, ApiError> {
    let role = require_access(state, user, project_id).await?;
    if !role.can_manage() {
        return Err(ApiError::forbidden());
    }
    Ok(role)
}

async fn visible_element(
    state: &AppState,
    user: &User,
    element_id: Uuid,
) -> Result<Element, ApiError> {
    let Some(el) = state.db.get_element(element_id).await? else {
        return Err(ApiError::not_found("element"));
    };
    if state
        .db
        .project_access(user, el.project_id)
        .await?
        .is_none()
    {
        return Err(ApiError::not_found("element"));
    }
    Ok(el)
}

async fn visible_element_for_page(
    state: &AppState,
    user: &User,
    page_id: Uuid,
) -> Result<Element, ApiError> {
    use sqlx::Row;
    let r = sqlx::query("SELECT element_id FROM pages WHERE id = $1")
        .bind(page_id.to_string())
        .fetch_optional(state.db.pool())
        .await?;
    let Some(r) = r else {
        return Err(ApiError::not_found("page"));
    };
    let eid = Uuid::parse_str(r.get::<String, _>("element_id").as_str()).unwrap();
    let Some(el) = state.db.get_element(eid).await? else {
        return Err(ApiError::not_found("page"));
    };
    if state
        .db
        .project_access(user, el.project_id)
        .await?
        .is_none()
    {
        return Err(ApiError::not_found("page"));
    }
    Ok(el)
}

async fn visible_element_for_panel(
    state: &AppState,
    user: &User,
    panel_id: Uuid,
) -> Result<Element, ApiError> {
    use sqlx::Row;
    let r = sqlx::query(
        "SELECT p.element_id FROM panels pan JOIN pages p ON p.id = pan.page_id WHERE pan.id = $1",
    )
    .bind(panel_id.to_string())
    .fetch_optional(state.db.pool())
    .await?;
    let Some(r) = r else {
        return Err(ApiError::not_found("panel"));
    };
    let eid = Uuid::parse_str(r.get::<String, _>("element_id").as_str()).unwrap();
    let Some(el) = state.db.get_element(eid).await? else {
        return Err(ApiError::not_found("panel"));
    };
    if state
        .db
        .project_access(user, el.project_id)
        .await?
        .is_none()
    {
        return Err(ApiError::not_found("panel"));
    }
    Ok(el)
}

fn count_words(s: &str) -> usize {
    if s.starts_with("tv1.") {
        0
    } else {
        s.split_whitespace().count()
    }
}

fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn content_type_for(format: ExportFormat) -> String {
    match format {
        ExportFormat::Markdown => "text/markdown; charset=utf-8".into(),
        ExportFormat::Docx => {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document".into()
        }
        ExportFormat::Epub => "application/epub+zip".into(),
        ExportFormat::Pdf => "application/pdf".into(),
        ExportFormat::Html => "text/html; charset=utf-8".into(),
    }
}

struct ApiError {
    status: StatusCode,
    message: String,
    body: Option<serde_json::Value>,
}

impl ApiError {
    fn bad(msg: &str) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: msg.into(),
            body: None,
        }
    }
    fn unauthorized(msg: &str) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            message: msg.into(),
            body: None,
        }
    }
    fn forbidden() -> Self {
        Self::forbidden_msg("forbidden")
    }
    fn forbidden_msg(msg: &str) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message: msg.into(),
            body: None,
        }
    }
    fn not_found(what: &str) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: format!("{what} not found"),
            body: None,
        }
    }
    fn limited() -> Self {
        Self {
            status: StatusCode::TOO_MANY_REQUESTS,
            message: "too many requests".into(),
            body: None,
        }
    }
    fn conflict(body: serde_json::Value) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            message: "edit conflict".into(),
            body: Some(body),
        }
    }
    fn internal() -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: "internal error".into(),
            body: None,
        }
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        let message = e.to_string();
        let lower = message.to_ascii_lowercase();
        if lower.contains("title required")
            || lower.contains("must belong")
            || lower.contains("not found")
            || lower.contains("refusing")
            || lower.contains("password must")
            || lower.contains("elements must")
            || lower.contains("parent element")
        {
            return Self {
                status: if lower.contains("not found") {
                    StatusCode::NOT_FOUND
                } else {
                    StatusCode::BAD_REQUEST
                },
                message,
                body: None,
            };
        }
        tracing::error!(error = %e, "request failed");
        Self::internal()
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        tracing::error!(error = %e, "database error");
        Self::internal()
    }
}

impl From<std::io::Error> for ApiError {
    fn from(e: std::io::Error) -> Self {
        tracing::error!(error = %e, "io error");
        Self::internal()
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = self
            .body
            .unwrap_or_else(|| serde_json::json!({ "error": self.message }));
        (self.status, Json(body)).into_response()
    }
}
