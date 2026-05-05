import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  DailyTask,
  PendingRecovery,
  RecurrenceType,
  RecurringTask,
  SaveSchedulePayload,
  SchedulePayload,
  SessionRecord,
  StatsSummary,
  StatusResponse,
  WeekDaySummary,
  WeekTasksResponse,
} from "../types";

export function apiClockIn() {
  return invoke<SessionRecord>("clock_in");
}

export function apiClockOut(endedAt?: number) {
  return invoke<SessionRecord>("clock_out", { endedAt: endedAt ?? null });
}

export function apiStartBreak() {
  return invoke<void>("start_break");
}

export function apiResumeBreak() {
  return invoke<void>("resume_break");
}

export function apiGetStatus() {
  return invoke<StatusResponse>("get_status");
}

export function apiGetSchedule() {
  return invoke<SchedulePayload>("get_schedule");
}

export function apiSaveSchedule(payload: SaveSchedulePayload) {
  return invoke<void>("save_schedule", { payload });
}

export function apiCreateTemplate(name: string) {
  return invoke<number>("create_template", { name });
}

export function apiActivateTemplate(templateId: number) {
  return invoke<void>("activate_template", { templateId });
}

export function apiGetWeekSummary(weekStart?: string, weekStartDay?: number) {
  return invoke<WeekDaySummary[]>("get_week_summary", { weekStart: weekStart ?? null, weekStartDay: weekStartDay ?? null });
}

export function apiGetStatsSummary(weekStartDay?: number) {
  return invoke<StatsSummary>("get_stats_summary", { weekStartDay: weekStartDay ?? null });
}

export function apiConsumeStartupNotice() {
  return invoke<string | null>("consume_startup_notice");
}

export function apiGetPendingRecovery() {
  return invoke<PendingRecovery | null>("get_pending_recovery");
}

export function apiApplyPendingRecovery(endedAt: number) {
  return invoke<void>("apply_pending_recovery", { endedAt });
}

export function apiSetMode(mode: "compact" | "expanded" | "fullscreen") {
  return invoke<void>("set_mode", { mode });
}

export function apiShowWindow() {
  return invoke<void>("show_window");
}

export function apiGetAppSettings() {
  return invoke<AppSettings>("get_app_settings");
}

export function apiSaveAppSettings(settings: AppSettings) {
  return invoke<void>("save_app_settings", { settings });
}

export function apiCheckNotifications() {
  return invoke<void>("check_notifications");
}

export function apiOpenDataFolder() {
  return invoke<void>("open_data_folder");
}

export function apiGetSessionChecklist(sessionId: number) {
  return invoke<number[]>("get_session_checklist", { sessionId });
}

export function apiToggleChecklistItem(sessionId: number, itemId: number, done: boolean) {
  return invoke<void>("toggle_checklist_item", { sessionId, itemId, done });
}

export function apiMarkWeekDone(done: boolean) {
  return invoke<void>("mark_week_done", { done });
}

export function apiIsWeekDone() {
  return invoke<boolean>("is_week_done");
}

export function apiMarkDayDone(done: boolean) {
  return invoke<void>("mark_day_done", { done });
}

export function apiIsDayDone() {
  return invoke<boolean>("is_day_done");
}

export function apiGetDailyTasks(date: string) {
  return invoke<DailyTask[]>("get_daily_tasks", { date });
}

export function apiAddDailyTask(date: string, text: string) {
  return invoke<DailyTask>("add_daily_task", { date, text });
}

export function apiUpdateDailyTask(id: number, text: string) {
  return invoke<void>("update_daily_task", { id, text });
}

export function apiToggleDailyTask(id: number, done: boolean) {
  return invoke<void>("toggle_daily_task", { id, done });
}

export function apiDeleteDailyTask(id: number) {
  return invoke<void>("delete_daily_task", { id });
}

export function apiRolloverDailyTask(id: number, targetDate: string) {
  return invoke<void>("rollover_daily_task", { id, targetDate });
}

export function apiGetRecurringTasks() {
  return invoke<RecurringTask[]>("get_recurring_tasks");
}

export function apiAddRecurringTask(
  text: string,
  recurrenceType: RecurrenceType,
  recurrenceDays: string | null,
  intervalDays: number | null,
  startDate: string,
  endDate: string | null,
) {
  return invoke<RecurringTask>("add_recurring_task", {
    text, recurrenceType, recurrenceDays, intervalDays, startDate, endDate,
  });
}

export function apiUpdateRecurringTask(
  id: number,
  text: string,
  recurrenceType: RecurrenceType,
  recurrenceDays: string | null,
  intervalDays: number | null,
  endDate: string | null,
  active: boolean,
) {
  return invoke<void>("update_recurring_task", {
    id, text, recurrenceType, recurrenceDays, intervalDays, endDate, active,
  });
}

export function apiDeleteRecurringTask(id: number, deleteInstances: boolean) {
  return invoke<void>("delete_recurring_task", { id, deleteInstances });
}

export function apiGetTasksForWeek(weekStart: string) {
  return invoke<WeekTasksResponse>("get_tasks_for_week", { weekStart });
}
