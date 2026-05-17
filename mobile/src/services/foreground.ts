import * as TaskManager from "expo-task-manager";
import * as Notifications from "expo-notifications";
import { getStatus } from "./session";
import { checkAndNotify, scheduleShiftNotifications } from "./notification";
import { formatHoursMinutes, stateLabel } from "../lib/time";

const BACKGROUND_TASK_NAME = "clockwise-background-check";
const PERSISTENT_NOTIFICATION_ID = "clockwise-session";

let _tickInterval: ReturnType<typeof setInterval> | null = null;

export async function setupNotificationChannels(): Promise<void> {
  try {
    await Notifications.setNotificationChannelAsync("clockwise-tracking", {
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

    await Notifications.setNotificationChannelAsync("clockwise-tasks", {
      name: "Task Reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: "default",
    });
  } catch {
    // Not available in Expo Go
  }
}

export { setupNotificationChannels as setupNotificationChannel };

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

    const elapsed = formatHoursMinutes(status.worked_today_ms);
    let body: string;

    if (status.target_today_ms > 0) {
      const remaining = Math.max(0, status.target_today_ms - status.worked_today_ms);
      if (remaining > 0) {
        body = `${elapsed} elapsed · ${formatHoursMinutes(remaining)} left until target`;
      } else {
        const over = status.worked_today_ms - status.target_today_ms;
        body = `${elapsed} elapsed · target hit! (+${formatHoursMinutes(over)})`;
      }
    } else {
      body = `${elapsed} worked today`;
    }

    const title = status.state === "on_break" ? "On break" : "Clocked in";

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
      trigger: { channelId: "clockwise-tracking" },
    });
  } catch {
    // non-fatal
  }
}

export function startSessionTicker(): void {
  if (_tickInterval) return;
  _tickInterval = setInterval(async () => {
    await updatePersistentNotification();
  }, 30_000);

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
}

export { BACKGROUND_TASK_NAME };
