import { getDb } from "../db/connection";

export const SYNC_PORT = 19847;

export interface SyncChange {
  table_name: string;
  row_id: number;
  action: "insert" | "update" | "delete";
  changed_at: number;
  data?: Record<string, unknown>;
}

interface PingResponse {
  device_name: string;
  paired: boolean;
  version: string;
}

interface PairResponse {
  paired: boolean;
  device_name: string;
}

let _ws: WebSocket | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export async function getSyncMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM sync_meta WHERE key = ?",
    [key]
  );
  return row?.value ?? null;
}

export async function setSyncMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)",
    [key, value]
  );
}

export async function discoverDesktop(ip: string): Promise<PingResponse | null> {
  try {
    const resp = await fetch(`http://${ip}:${SYNC_PORT}/api/ping`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    if (!resp.ok) return null;
    return (await resp.json()) as PingResponse;
  } catch {
    return null;
  }
}

export async function pairWithDesktop(
  ip: string,
  code: string,
  deviceName: string
): Promise<PairResponse | null> {
  try {
    const resp = await fetch(`http://${ip}:${SYNC_PORT}/api/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, device_name: deviceName }),
    });
    if (!resp.ok) return null;
    const result = (await resp.json()) as PairResponse;
    if (result.paired) {
      await setSyncMeta("paired_ip", ip);
      await setSyncMeta("paired_device", result.device_name);
    }
    return result;
  } catch {
    return null;
  }
}

export async function pullChanges(ip: string): Promise<number> {
  const lastSync = (await getSyncMeta("last_pull_at")) ?? "0";
  const resp = await fetch(
    `http://${ip}:${SYNC_PORT}/api/pull?since=${lastSync}`,
    { headers: { "Content-Type": "application/json" } }
  );
  if (!resp.ok) throw new Error(`Pull failed: ${resp.status}`);
  const changes = (await resp.json()) as SyncChange[];

  for (const change of changes) {
    await applyIncomingChange(change);
  }

  if (changes.length > 0) {
    const maxTime = Math.max(...changes.map((c) => c.changed_at));
    await setSyncMeta("last_pull_at", String(maxTime));
  }

  return changes.length;
}

export async function pushChanges(ip: string): Promise<number> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: number;
    table_name: string;
    row_id: number;
    action: string;
    changed_at: number;
  }>("SELECT * FROM sync_log WHERE synced = 0 ORDER BY id ASC LIMIT 200");

  if (rows.length === 0) return 0;

  const changes: SyncChange[] = [];
  for (const row of rows) {
    let data: Record<string, unknown> | undefined;
    if (row.action !== "delete") {
      data = await fetchLocalRow(row.table_name, row.row_id);
    }
    changes.push({
      table_name: row.table_name,
      row_id: row.row_id,
      action: row.action as SyncChange["action"],
      changed_at: row.changed_at,
      data,
    });
  }

  const resp = await fetch(`http://${ip}:${SYNC_PORT}/api/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changes }),
  });

  if (!resp.ok) throw new Error(`Push failed: ${resp.status}`);

  const ids = rows.map((r) => r.id);
  await db.runAsync(
    `UPDATE sync_log SET synced = 1 WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids
  );

  return rows.length;
}

export function startWebSocket(ip: string, onMessage?: (change: SyncChange) => void): void {
  stopWebSocket();

  const url = `ws://${ip}:${SYNC_PORT}/api/sync`;
  _ws = new WebSocket(url);

  _ws.onopen = () => {
    console.log("[sync] WebSocket connected");
  };

  _ws.onmessage = async (event) => {
    try {
      const change = JSON.parse(event.data as string) as SyncChange;
      await applyIncomingChange(change);
      onMessage?.(change);
    } catch (e) {
      console.warn("[sync] failed to process WS message", e);
    }
  };

  _ws.onclose = () => {
    console.log("[sync] WebSocket disconnected, reconnecting in 5s...");
    _reconnectTimer = setTimeout(() => startWebSocket(ip, onMessage), 5000);
  };

  _ws.onerror = () => {
    _ws?.close();
  };
}

export function stopWebSocket(): void {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  if (_ws) {
    _ws.onclose = null;
    _ws.close();
    _ws = null;
  }
}

export function sendChange(change: SyncChange): void {
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify(change));
  }
}

export function isConnected(): boolean {
  return _ws !== null && _ws.readyState === WebSocket.OPEN;
}

export async function fullSync(ip: string): Promise<{ pushed: number; pulled: number }> {
  const pushed = await pushChanges(ip);
  const pulled = await pullChanges(ip);
  return { pushed, pulled };
}

async function fetchLocalRow(table: string, rowId: number): Promise<Record<string, unknown> | undefined> {
  const db = await getDb();
  const pk = table === "settings" || table === "app_meta" ? "rowid" : "id";
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE ${pk} = ?`,
    [rowId]
  );
  return row ?? undefined;
}

async function applyIncomingChange(change: SyncChange): Promise<void> {
  const db = await getDb();
  const allowed = [
    "session", "session_pause", "daily_task", "subtask",
    "recurring_task", "schedule_template", "schedule_block",
    "schedule_day_target", "settings", "app_meta",
  ];
  if (!allowed.includes(change.table_name)) return;

  if (change.action === "delete") {
    const pk = change.table_name === "settings" || change.table_name === "app_meta" ? "rowid" : "id";
    await db.runAsync(`DELETE FROM ${change.table_name} WHERE ${pk} = ?`, [change.row_id]);
    return;
  }

  if (!change.data) return;

  const columns = Object.keys(change.data);
  const values = Object.values(change.data);
  const placeholders = columns.map(() => "?").join(", ");
  const sql = `INSERT OR REPLACE INTO ${change.table_name} (${columns.join(", ")}) VALUES (${placeholders})`;
  await db.runAsync(sql, values as (string | number | null)[]);
}
