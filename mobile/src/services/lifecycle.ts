import { AppState, AppStateStatus } from "react-native";
import * as BackgroundFetch from "expo-background-fetch";
import * as Notifications from "expo-notifications";
import { getDb } from "../db/connection";
import { checkAndNotify, scheduleShiftNotifications } from "./notification";
import {
  BACKGROUND_TASK_NAME,
  setupNotificationChannel,
  requestPermissions,
  startSessionTicker,
  stopSessionTicker,
  updatePersistentNotification,
} from "./foreground";
import type { PendingRecovery } from "../types";

const HEARTBEAT_KEY = "heartbeat_ms";
const HEARTBEAT_INTERVAL = 30_000;

let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let _notificationCheckTimer: ReturnType<typeof setInterval> | null = null;

async function writeHeartbeat(): Promise<void> {
  try {
    const db = await getDb();
    const now = Date.now();
    await db.runAsync(
      "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [HEARTBEAT_KEY, String(now)]
    );
  } catch {
    // non-fatal
  }
}

async function readHeartbeat(): Promise<number | null> {
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM app_meta WHERE key = ?", [HEARTBEAT_KEY]);
    if (!row) return null;
    const val = parseInt(row.value, 10);
    return isNaN(val) ? null : val;
  } catch {
    return null;
  }
}

export async function reconcileStaleSession(): Promise<PendingRecovery | null> {
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<{ id: number; started_at: number }>(
      "SELECT id, started_at FROM session WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1"
    );
    if (!row) return null;

    const lastHeartbeat = await readHeartbeat();
    const now = Date.now();

    if (lastHeartbeat && (now - lastHeartbeat) > 5 * 60_000) {
      return {
        session_id: row.id,
        started_at: row.started_at,
        suggested_end_at: lastHeartbeat,
      };
    }

    return null;
  } catch {
    return null;
  }
}

function startHeartbeat(): void {
  if (_heartbeatTimer) return;
  writeHeartbeat();
  _heartbeatTimer = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL);
}

function stopHeartbeat(): void {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
}

function startNotificationChecks(): void {
  if (_notificationCheckTimer) return;
  _notificationCheckTimer = setInterval(async () => {
    try {
      await checkAndNotify();
    } catch {
      // non-fatal
    }
  }, 60_000);
}

function stopNotificationChecks(): void {
  if (_notificationCheckTimer) {
    clearInterval(_notificationCheckTimer);
    _notificationCheckTimer = null;
  }
}

async function onForeground(): Promise<void> {
  startHeartbeat();
  startSessionTicker();
  startNotificationChecks();
  await updatePersistentNotification();
  try { await scheduleShiftNotifications(); } catch { /* non-fatal */ }
}

async function onBackground(): Promise<void> {
  writeHeartbeat();
  stopHeartbeat();
  stopSessionTicker();
  stopNotificationChecks();
}

export async function initLifecycle(): Promise<void> {
  await setupNotificationChannel();
  await requestPermissions();

  try {
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        const data = notification.request.content.data;
        if (data?.type === "persistent") {
          return { shouldShowAlert: false, shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: false, shouldShowList: false };
        }
        return { shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true };
      },
    });
  } catch {
    // Not available in Expo Go
  }

  try {
    await BackgroundFetch.registerTaskAsync(BACKGROUND_TASK_NAME, {
      minimumInterval: 15 * 60,
      stopOnTerminate: false,
      startOnBoot: true,
    });
  } catch {
    // background fetch may not be available on all devices
  }

  AppState.addEventListener("change", handleAppStateChange);

  await onForeground();
}

async function handleAppStateChange(nextState: AppStateStatus): Promise<void> {
  if (nextState === "active") {
    await onForeground();
  } else if (nextState === "background" || nextState === "inactive") {
    await onBackground();
  }
}
