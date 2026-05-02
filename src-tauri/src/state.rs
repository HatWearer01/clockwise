use sqlx::SqlitePool;
use std::path::PathBuf;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub heartbeat_path: PathBuf,
    pub data_dir: PathBuf,
}
