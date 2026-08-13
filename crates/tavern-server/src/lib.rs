pub mod auth;
pub mod routes;
pub mod state;
mod rate_limit;
mod security;

use anyhow::Result;
use axum::extract::DefaultBodyLimit;
use axum::middleware;
use axum::Router;
use rate_limit::RateLimiter;
use state::AppState;
use std::sync::Arc;
use tavern_core::Config;
use tavern_db::Db;
use tower_http::trace::TraceLayer;

pub async fn build_state(config: Config) -> Result<Arc<AppState>> {
    config.ensure_dirs()?;
    let db = Db::connect(&config.db_path()).await?;
    let force = std::env::var("TAVERN_ADMIN_PASS_FORCE")
        .map(|v| matches!(v.as_str(), "1" | "true" | "yes"))
        .unwrap_or(false);
    let force_password = if force {
        Some(config.admin_password.as_str())
    } else {
        None
    };
    db.ensure_admin(
        &config.admin_username,
        &config.admin_password,
        force_password,
    )
    .await?;
    let dummy_password_hash = Db::hash_password("tavern-timing-dummy-not-a-login")?;
    Ok(Arc::new(AppState {
        db,
        config,
        limiter: RateLimiter::new(),
        dummy_password_hash,
    }))
}

pub fn app(state: Arc<AppState>) -> Router {
    Router::new()
        .merge(routes::router())
        .layer(DefaultBodyLimit::max(32 * 1024 * 1024))
        .layer(middleware::from_fn(security::security_headers))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
