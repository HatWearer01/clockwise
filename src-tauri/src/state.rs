use sqlx::SqlitePool;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub heartbeat_path: PathBuf,
    pub data_dir: PathBuf,
    pub sync: Arc<SyncState>,
}

pub struct SyncState {
    pub pairing_code: RwLock<Option<String>>,
    pub paired_device: RwLock<Option<String>>,
    pub connected: RwLock<bool>,
}

impl Default for SyncState {
    fn default() -> Self {
        Self {
            pairing_code: RwLock::new(None),
            paired_device: RwLock::new(None),
            connected: RwLock::new(false),
        }
    }
}
