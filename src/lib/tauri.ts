import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  PendingRecovery,
  SaveSchedulePayload,
  SchedulePayload,
  SessionRecord,
  StatsSummary,
  StatusResponse,
  WeekDaySummary,
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

export function apiGetWeekSummary() {
  return invoke<WeekDaySummary[]>("get_week_summary");
}

export function apiGetStatsSummary() {
  return invoke<StatsSummary>("get_stats_summary");
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
