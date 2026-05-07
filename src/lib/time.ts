import type { ScheduleBlock, StatusState } from "../types";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_NAMES_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_NAMES_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dayName(dayOfWeek: number): string {
  return DAY_NAMES[dayOfWeek] ?? "Unknown";
}

export function dayNameShort(dayOfWeek: number): string {
  return DAY_NAMES_SHORT[dayOfWeek] ?? "?";
}

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m ${seconds.toString().padStart(2, "0")}s`;
}

export function formatHoursMinutes(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours === 0 && minutes < 5) return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function formatDecimalHours(ms: number): string {
  const hours = ms / 3_600_000;
  return hours.toFixed(1) + "h";
}

export function formatShortTime(timestampMs: number, format: "12h" | "24h" = "12h"): string {
  return new Date(timestampMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: format === "12h" });
}

export function formatMinuteAsTime(minuteOfDay: number, format: "12h" | "24h" = "12h"): string {
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  if (format === "24h") {
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
  }
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

export function timeInputValue(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

export function parseTimeInput(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function todayDateString(): string {
  const now = new Date();
  return `${DAY_NAMES[now.getDay()]}, ${MONTH_NAMES[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
}

export function todayISODate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function weekDayDates(weekOffset = 0, startDay: 0 | 1 = 1): Array<{ dow: number; label: string; date: string }> {
  const now = new Date();
  const dayIdx = now.getDay();
  const firstDayOffset = startDay === 0
    ? -dayIdx
    : (dayIdx === 0 ? -6 : 1 - dayIdx);
  const first = new Date(now);
  first.setDate(now.getDate() + firstDayOffset + weekOffset * 7);
  const result: Array<{ dow: number; label: string; date: string }> = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    result.push({
      dow: d.getDay(),
      label: DAY_NAMES_SHORT[d.getDay()],
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    });
  }
  return result;
}

export function weekRangeLabel(weekOffset: number, startDay: 0 | 1 = 1): string {
  const days = weekDayDates(weekOffset, startDay);
  const first = new Date(days[0].date + "T00:00:00");
  const last = new Date(days[6].date + "T00:00:00");
  return `${MONTH_NAMES_SHORT[first.getMonth()]} ${first.getDate()} – ${MONTH_NAMES_SHORT[last.getMonth()]} ${last.getDate()}, ${last.getFullYear()}`;
}

export function currentWeekRange(startDay: 0 | 1 = 1): string {
  return weekRangeLabel(0, startDay);
}

export function currentWeekNumber(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now.getTime() - start.getTime();
  const oneWeek = 7 * 24 * 60 * 60 * 1000;
  return Math.ceil((diff / oneWeek) + 1);
}

export function blockDurationMs(startMin: number, endMin: number): number {
  if (endMin > startMin) return (endMin - startMin) * 60_000;
  if (endMin < startMin) return (1440 - startMin + endMin) * 60_000;
  return 0;
}

export function isCurrentlyInSchedule(blocks: ScheduleBlock[]): boolean {
  const now = new Date();
  const todayDow = now.getDay();
  const todayBlocks = blocks.filter((b) => b.day_of_week === todayDow);
  if (todayBlocks.length === 0) return false;
  const minuteNow = now.getHours() * 60 + now.getMinutes();
  return todayBlocks.some((b) => {
    if (b.start_min > b.end_min) return minuteNow >= b.start_min || minuteNow < b.end_min;
    return minuteNow >= b.start_min && minuteNow < b.end_min;
  });
}

export function pct(actual: number, planned: number): number {
  if (planned <= 0) return 0;
  return Math.min(100, Math.round((actual / planned) * 100));
}

export function stateLabel(state: StatusState): string {
  if (state === "on_clock") return "Working";
  if (state === "on_break") return "On break";
  if (state === "off_day") return "Day off";
  if (state === "before_shift") return "Before shift";
  if (state === "in_shift") return "Shift active";
  if (state === "week_done") return "Week done";
  if (state === "day_done") return "Done for today";
  if (state === "behind_target") return "Behind target";
  return "After shift";
}

export function stateMessage(state: StatusState, boundary: number | null): string {
  if (state === "on_clock") return "You are clocked in and on the clock.";
  if (state === "on_break") return "Break is active. Resume when you're ready.";
  if (state === "off_day") return "No shift scheduled today. Enjoy your day off.";
  if (state === "week_done") return "You're done for the week. Enjoy your time off!";
  if (state === "day_done") return "You're done for today. See you tomorrow!";
  if (state === "before_shift") {
    if (!boundary) return "Your shift starts later today.";
    return `Your shift starts at ${formatShortTime(boundary)}. Clock in when you're ready.`;
  }
  if (state === "in_shift") return "You're within your scheduled hours. Clock in to start tracking.";
  if (state === "behind_target") return "You haven't hit your daily target yet. Clock in when ready.";
  return "Your scheduled shift has ended for today.";
}
