use crate::mail::Mailer;
use crate::rate_limit::RateLimiter;
use tavern_core::Config;
use tavern_db::Db;

pub struct AppState {
    pub db: Db,
    pub config: Config,
    pub limiter: RateLimiter,
    /// Argon2 hash used only so failed logins take the same time as real ones.
    pub dummy_password_hash: String,
    pub mailer: Mailer,
}
