use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use sqlx::{Column, Row, SqlitePool};
use std::sync::Arc;

use crate::state::{AppState, SyncState};

pub const SYNC_PORT: u16 = 19847;

#[derive(Clone)]
struct SyncAppState {
    pool: SqlitePool,
    sync: Arc<SyncState>,
    device_name: String,
}

#[derive(Serialize)]
struct PingResponse {
    device_name: String,
    paired: bool,
    version: &'static str,
}

#[derive(Deserialize)]
struct PairRequest {
    code: String,
    device_name: String,
}

#[derive(Serialize)]
struct PairResponse {
    paired: bool,
    device_name: String,
}

#[derive(Deserialize)]
struct PullQuery {
    since: i64,
}

#[derive(Serialize)]
struct SyncChange {
    table_name: String,
    row_id: i64,
    action: String,
    changed_at: i64,
    data: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct PushPayload {
    changes: Vec<IncomingChange>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct IncomingChange {
    table_name: String,
    row_id: i64,
    action: String,
    changed_at: i64,
    data: Option<serde_json::Value>,
}

pub async fn start_sync_server(app_state: AppState) {
    ensure_firewall_rule();

    let device_name = whoami::devicename();

    let state = SyncAppState {
        pool: app_state.pool.clone(),
        sync: app_state.sync.clone(),
        device_name,
    };

    let app = Router::new()
        .route("/api/ping", get(handle_ping))
        .route("/api/pair", post(handle_pair))
        .route("/api/pull", get(handle_pull))
        .route("/api/push", post(handle_push))
        .route("/api/sync", get(handle_ws_upgrade))
        .with_state(state);

    let addr = format!("0.0.0.0:{SYNC_PORT}");
    log::info!("[sync] starting sync server on {addr}");

    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            log::error!("[sync] failed to bind: {e}");
            return;
        }
    };

    if let Err(e) = axum::serve(listener, app).await {
        log::error!("[sync] server error: {e}");
    }
}

async fn handle_ping(State(state): State<SyncAppState>) -> Json<PingResponse> {
    let paired = state.sync.paired_device.read().await.is_some();
    Json(PingResponse {
        device_name: state.device_name.clone(),
        paired,
        version: "1",
    })
}

async fn handle_pair(
    State(state): State<SyncAppState>,
    Json(req): Json<PairRequest>,
) -> Result<Json<PairResponse>, StatusCode> {
    let expected = state.sync.pairing_code.read().await;
    match &*expected {
        Some(code) if *code == req.code => {
            drop(expected);
            *state.sync.paired_device.write().await = Some(req.device_name.clone());
            *state.sync.pairing_code.write().await = None;
            Ok(Json(PairResponse {
                paired: true,
                device_name: state.device_name.clone(),
            }))
        }
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}

async fn handle_pull(
    State(state): State<SyncAppState>,
    Query(params): Query<PullQuery>,
) -> Result<Json<Vec<SyncChange>>, StatusCode> {
    if state.sync.paired_device.read().await.is_none() {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let rows = sqlx::query(
        "SELECT id, table_name, row_id, action, changed_at FROM sync_log WHERE changed_at > ? ORDER BY id ASC LIMIT 1000",
    )
    .bind(params.since)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut changes = Vec::with_capacity(rows.len());
    for row in &rows {
        let table_name: String = row.try_get("table_name").unwrap_or_default();
        let row_id: i64 = row.try_get("row_id").unwrap_or(0);
        let action: String = row.try_get("action").unwrap_or_default();
        let changed_at: i64 = row.try_get("changed_at").unwrap_or(0);

        let data = if action != "delete" {
            fetch_row_data(&state.pool, &table_name, row_id).await
        } else {
            None
        };

        changes.push(SyncChange {
            table_name,
            row_id,
            action,
            changed_at,
            data,
        });
    }

    Ok(Json(changes))
}

async fn handle_push(
    State(state): State<SyncAppState>,
    Json(payload): Json<PushPayload>,
) -> Result<StatusCode, StatusCode> {
    if state.sync.paired_device.read().await.is_none() {
        return Err(StatusCode::UNAUTHORIZED);
    }

    for change in payload.changes {
        apply_incoming_change(&state.pool, &change).await.ok();
    }

    Ok(StatusCode::OK)
}

async fn handle_ws_upgrade(
    State(state): State<SyncAppState>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws_connection(socket, state))
}

async fn handle_ws_connection(socket: WebSocket, state: SyncAppState) {
    let (mut sender, mut receiver) = socket.split();
    *state.sync.connected.write().await = true;
    log::info!("[sync] WebSocket client connected");

    let pool = state.pool.clone();
    let send_pool = pool.clone();

    let send_task = tokio::spawn(async move {
        let mut last_id: i64 = 0;
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

            let rows = sqlx::query(
                "SELECT id, table_name, row_id, action, changed_at FROM sync_log WHERE id > ? AND synced = 0 ORDER BY id ASC LIMIT 50",
            )
            .bind(last_id)
            .fetch_all(&send_pool)
            .await;

            let rows = match rows {
                Ok(r) => r,
                Err(_) => continue,
            };

            for row in &rows {
                let id: i64 = row.try_get("id").unwrap_or(0);
                let table_name: String = row.try_get("table_name").unwrap_or_default();
                let row_id: i64 = row.try_get("row_id").unwrap_or(0);
                let action: String = row.try_get("action").unwrap_or_default();
                let changed_at: i64 = row.try_get("changed_at").unwrap_or(0);

                let data = if action != "delete" {
                    fetch_row_data(&send_pool, &table_name, row_id).await
                } else {
                    None
                };

                let change = SyncChange {
                    table_name,
                    row_id,
                    action,
                    changed_at,
                    data,
                };

                if let Ok(json) = serde_json::to_string(&change) {
                    if sender.send(Message::Text(json.into())).await.is_err() {
                        return;
                    }
                }

                let _ = sqlx::query("UPDATE sync_log SET synced = 1 WHERE id = ?")
                    .bind(id)
                    .execute(&send_pool)
                    .await;

                last_id = id;
            }
        }
    });

    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                if let Ok(change) = serde_json::from_str::<IncomingChange>(&text) {
                    let _ = apply_incoming_change(&pool, &change).await;
                }
            }
            Ok(Message::Close(_)) | Err(_) => break,
            _ => {}
        }
    }

    send_task.abort();
    *state.sync.connected.write().await = false;
    log::info!("[sync] WebSocket client disconnected");
}

async fn fetch_row_data(pool: &SqlitePool, table: &str, row_id: i64) -> Option<serde_json::Value> {
    let allowed = [
        "session", "session_pause", "daily_task", "subtask",
        "recurring_task", "schedule_template", "schedule_block",
        "schedule_day_target", "settings", "app_meta",
    ];
    if !allowed.contains(&table) {
        return None;
    }

    let pk_col = match table {
        "settings" | "app_meta" => "rowid",
        _ => "id",
    };

    let query = format!("SELECT * FROM {table} WHERE {pk_col} = ?");
    let row = sqlx::query(&query).bind(row_id).fetch_optional(pool).await.ok()??;

    let columns = row.columns();
    let mut map = serde_json::Map::new();
    for col in columns {
        let name = col.name();
        if let Ok(v) = row.try_get::<i64, _>(name) {
            map.insert(name.to_string(), serde_json::Value::Number(v.into()));
        } else if let Ok(v) = row.try_get::<String, _>(name) {
            map.insert(name.to_string(), serde_json::Value::String(v));
        } else if let Ok(v) = row.try_get::<f64, _>(name) {
            if let Some(n) = serde_json::Number::from_f64(v) {
                map.insert(name.to_string(), serde_json::Value::Number(n));
            }
        } else {
            map.insert(name.to_string(), serde_json::Value::Null);
        }
    }

    Some(serde_json::Value::Object(map))
}

async fn apply_incoming_change(pool: &SqlitePool, change: &IncomingChange) -> Result<(), String> {
    let allowed = [
        "session", "session_pause", "daily_task", "subtask",
        "recurring_task", "schedule_template", "schedule_block",
        "schedule_day_target", "settings", "app_meta",
    ];
    if !allowed.contains(&change.table_name.as_str()) {
        return Err("table not allowed".into());
    }

    match change.action.as_str() {
        "insert" | "update" => {
            let data = change.data.as_ref().ok_or("no data for upsert")?;
            let obj = data.as_object().ok_or("data is not object")?;

            let columns: Vec<&String> = obj.keys().collect();
            let placeholders: Vec<String> = columns.iter().map(|_| "?".to_string()).collect();
            let col_names: Vec<&str> = columns.iter().map(|s| s.as_str()).collect();

            let sql = format!(
                "INSERT OR REPLACE INTO {} ({}) VALUES ({})",
                change.table_name,
                col_names.join(", "),
                placeholders.join(", ")
            );

            let mut query = sqlx::query(&sql);
            for col in &columns {
                let val = &obj[col.as_str()];
                match val {
                    serde_json::Value::Number(n) => {
                        if let Some(i) = n.as_i64() {
                            query = query.bind(i);
                        } else if let Some(f) = n.as_f64() {
                            query = query.bind(f);
                        }
                    }
                    serde_json::Value::String(s) => {
                        query = query.bind(s.clone());
                    }
                    serde_json::Value::Null => {
                        query = query.bind(Option::<String>::None);
                    }
                    _ => {
                        query = query.bind(val.to_string());
                    }
                }
            }

            query.execute(pool).await.map_err(|e| e.to_string())?;
        }
        "delete" => {
            let pk_col = match change.table_name.as_str() {
                "settings" | "app_meta" => "rowid",
                _ => "id",
            };
            let sql = format!("DELETE FROM {} WHERE {} = ?", change.table_name, pk_col);
            sqlx::query(&sql)
                .bind(change.row_id)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
        }
        _ => return Err(format!("unknown action: {}", change.action)),
    }

    Ok(())
}

pub fn get_local_ip() -> Option<String> {
    local_ip_address::local_ip().ok().map(|ip| ip.to_string())
}

pub fn generate_pairing_code() -> String {
    use rand::Rng;
    let mut rng = rand::rng();
    format!("{:06}", rng.random_range(0..1_000_000u32))
}

fn ensure_firewall_rule() {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let check = Command::new("netsh")
            .args(["advfirewall", "firewall", "show", "rule", "name=Clockwise Sync"])
            .output();

        let needs_rule = match check {
            Ok(output) => !output.status.success(),
            Err(_) => true,
        };

        if needs_rule {
            log::info!("[sync] Adding firewall rule for port {SYNC_PORT}...");
            let _ = Command::new("powershell")
                .args([
                    "-Command",
                    &format!(
                        "Start-Process netsh -ArgumentList 'advfirewall firewall add rule name=\"Clockwise Sync\" dir=in action=allow protocol=tcp localport={SYNC_PORT}' -Verb RunAs -WindowStyle Hidden"
                    ),
                ])
                .spawn();
        }
    }
}
