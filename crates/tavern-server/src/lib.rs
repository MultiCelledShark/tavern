pub mod auth;
pub mod routes;
pub mod state;

use anyhow::Result;
use axum::extract::DefaultBodyLimit;
use axum::Router;
use state::AppState;
use std::sync::Arc;
use tavern_core::Config;
use tavern_db::Db;
use tower_http::trace::TraceLayer;

/// Campfire HTML exports embed images as data-URIs and routinely exceed Axum's
/// 2 MiB default; asset uploads allow up to 12 MiB. Keep headroom for both.
const MAX_REQUEST_BODY_BYTES: usize = 32 * 1024 * 1024;

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
    Ok(Arc::new(AppState { db, config }))
}

pub fn app(state: Arc<AppState>) -> Router {
    Router::new()
        .merge(routes::router())
        .layer(TraceLayer::new_for_http())
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BODY_BYTES))
        .with_state(state)
}
