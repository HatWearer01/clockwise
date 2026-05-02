#![cfg(test)]

use std::path::PathBuf;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

use crate::db::init_db;
use crate::state::AppState;

pub async fn test_pool() -> SqlitePool {
    let options = SqliteConnectOptions::new()
        .filename(":memory:")
        .create_if_missing(true)
        .foreign_keys(true);
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("Failed to create in-memory SQLite pool")
}

pub async fn test_state() -> AppState {
    let pool = test_pool().await;
    init_db(&pool).await.expect("Failed to initialize test DB");
    AppState {
        pool,
        heartbeat_path: PathBuf::from("test_heartbeat"),
        data_dir: PathBuf::from("test_data"),
    }
}
