pub mod auth;
pub mod mail;
mod rate_limit;
pub mod routes;
mod security;
mod session_cache;
pub mod state;

use anyhow::Result;
use axum::extract::DefaultBodyLimit;
use axum::middleware;
use axum::Router;
use rate_limit::RateLimiter;
use state::AppState;
use std::sync::Arc;
use tavern_core::Config;
use tavern_db::Db;
use tower_http::compression::CompressionLayer;
use tower_http::trace::TraceLayer;

/// Campfire HTML exports embed images as data-URIs and routinely exceed Axum's
/// 2 MiB default; asset uploads allow up to 12 MiB. Keep headroom for both.
const MAX_REQUEST_BODY_BYTES: usize = 32 * 1024 * 1024;

pub async fn build_state(config: Config) -> Result<Arc<AppState>> {
    config.ensure_dirs()?;
    let db = Db::connect(&config.database_url).await?;
    let force = std::env::var("TAVERN_ADMIN_PASS_FORCE")
        .map(|v| matches!(v.as_str(), "1" | "true" | "yes"))
        .unwrap_or(false);
    let force_password = if force {
        Some(config.admin_password.as_str())
    } else {
        None
    };
    let admin = db
        .ensure_admin(
            &config.admin_username,
            &config.admin_password,
            force_password,
        )
        .await?;
    if let Some(ref raw) = config.admin_email {
        if let Some(email) = tavern_core::normalize_email(raw) {
            db.set_email(admin.id, Some(&email), true).await?;
        }
    }
    let mailer = crate::mail::Mailer::from_config(&config);
    let dummy_password_hash = Db::hash_password("tavern-timing-dummy-not-a-login")?;
    Ok(Arc::new(AppState {
        db,
        config,
        limiter: RateLimiter::new(),
        dummy_password_hash,
        mailer,
        sessions: crate::session_cache::SessionCache::new(),
    }))
}

pub fn app(state: Arc<AppState>) -> Router {
    Router::new()
        .merge(routes::router())
        .layer(middleware::from_fn(security::security_headers))
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BODY_BYTES))
        .with_state(state)
}
