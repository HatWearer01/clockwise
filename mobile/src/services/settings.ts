import { getDb } from "../db/connection";
import type { AppSettings } from "../types";

async function getBool(key: string, defaultVal: boolean): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  if (!row) return defaultVal;
  return row.value === "1" || row.value.toLowerCase() === "true";
}

async function getString(key: string, defaultVal: string): Promise<string> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  return row?.value ?? defaultVal;
}

async function getInt(key: string, defaultVal: number): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  if (!row) return defaultVal;
  const parsed = parseInt(row.value, 10);
  return isNaN(parsed) ? defaultVal : parsed;
}

export async function getAppSettings(): Promise<AppSettings> {
  return {
    notifications_enabled: await getBool("notifications_enabled", true),
    quiet_hours_enabled: await getBool("quiet_hours_enabled", false),
    quiet_hours_start_min: await getInt("quiet_hours_start_min", 1320),
    quiet_hours_end_min: await getInt("quiet_hours_end_min", 480),
    reminder_interval_min: Math.max(1, Math.min(60, await getInt("reminder_interval_min", 5))),
    week_start_day: (Math.max(0, Math.min(1, await getInt("week_start_day", 1))) as 0 | 1),
    time_format: (await getString("time_format", "12h")) as "12h" | "24h",
    accountability_mode: (await getString("accountability_mode", "shift")) as "shift" | "target",
  };
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  const db = await getDb();
  const entries: [string, string][] = [
    ["notifications_enabled", settings.notifications_enabled ? "1" : "0"],
    ["quiet_hours_enabled", settings.quiet_hours_enabled ? "1" : "0"],
    ["quiet_hours_start_min", String(settings.quiet_hours_start_min)],
    ["quiet_hours_end_min", String(settings.quiet_hours_end_min)],
    ["reminder_interval_min", String(Math.max(1, Math.min(60, settings.reminder_interval_min)))],
    ["week_start_day", String(settings.week_start_day)],
    ["time_format", settings.time_format],
    ["accountability_mode", settings.accountability_mode],
  ];
  for (const [key, value] of entries) {
    await db.runAsync(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value]
    );
  }
}

export async function consumeStartupNotice(): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM app_meta WHERE key = 'startup_notice'");
  if (!row) return null;
  await db.runAsync("DELETE FROM app_meta WHERE key = 'startup_notice'");
  return row.value;
}
