use anyhow::Result;
use std::net::SocketAddr;
use tavern_core::Config;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let config = Config::from_env();
    let listen = config.listen.clone();
    let state = tavern_server::build_state(config).await?;
    let app = tavern_server::app(state).into_make_service_with_connect_info::<SocketAddr>();

    let listener = tokio::net::TcpListener::bind(&listen).await?;
    tracing::info!("Tavern listening on http://{listen}");
    axum::serve(listener, app).await?;
    Ok(())
}
