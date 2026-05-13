import * as TaskManager from "expo-task-manager";
import * as Notifications from "expo-notifications";
import { getStatus } from "./session";
import { checkAndNotify } from "./notification";
import { formatDuration, stateLabel } from "../lib/time";

const BACKGROUND_TASK_NAME = "clockwise-background-check";
const NOTIFICATION_CHANNEL_ID = "clockwise-tracking";
const PERSISTENT_NOTIFICATION_ID = "clockwise-session";

let _tickInterval: ReturnType<typeof setInterval> | null = null;

export async function setupNotificationChannel(): Promise<void> {
  try {
    await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
      name: "Session Tracking",
      importance: Notifications.AndroidImportance.LOW,
      sound: undefined,
      vibrationPattern: [0],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });

    await Notifications.setNotificationChannelAsync("clockwise-alerts", {
      name: "Alerts & Reminders",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
    });
  } catch {
    // Not available in Expo Go
  }
}

export async function requestPermissions(): Promise<boolean> {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === "granted") return true;
    const { status } = await Notifications.requestPermissionsAsync();
    return status === "granted";
  } catch {
    return false;
  }
}

export async function updatePersistentNotification(): Promise<void> {
  try {
    const status = await getStatus();
    const isActive = status.state === "on_clock" || status.state === "on_break";

    if (!isActive) {
      await Notifications.dismissNotificationAsync(PERSISTENT_NOTIFICATION_ID);
      return;
    }

    const title = stateLabel(status.state);
    const body = `${formatDuration(status.worked_today_ms)} worked today`;

    await Notifications.scheduleNotificationAsync({
      identifier: PERSISTENT_NOTIFICATION_ID,
      content: {
        title,
        body,
        sticky: true,
        autoDismiss: false,
        categoryIdentifier: "session",
        data: { type: "persistent" },
      },
      trigger: null,
    });
  } catch {
    // non-fatal
  }
}

export function startSessionTicker(): void {
  if (_tickInterval) return;
  _tickInterval = setInterval(async () => {
    await updatePersistentNotification();
  }, 60_000);

  updatePersistentNotification();
}

export function stopSessionTicker(): void {
  if (_tickInterval) {
    clearInterval(_tickInterval);
    _tickInterval = null;
  }
  Notifications.dismissNotificationAsync(PERSISTENT_NOTIFICATION_ID).catch(() => {});
}

TaskManager.defineTask(BACKGROUND_TASK_NAME, async () => {
  try {
    await checkAndNotify();
    await updatePersistentNotification();
  } catch {
    // non-fatal
  }
});

export async function registerBackgroundTask(): Promise<void> {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK_NAME);
  if (isRegistered) return;

  // Note: expo-background-fetch or expo-task-manager background fetch
  // requires configuration; this is the task definition.
  // The actual periodic invocation is set up in lifecycle.ts
}

export { BACKGROUND_TASK_NAME };
