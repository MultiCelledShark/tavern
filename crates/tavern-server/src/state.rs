use tavern_core::Config;
use tavern_db::Db;

pub struct AppState {
    pub db: Db,
    pub config: Config,
}
