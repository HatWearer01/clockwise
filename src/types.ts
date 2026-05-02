export type SessionRecord = {
  id: number;
  started_at: number;
  ended_at: number | null;
};

export type ScheduleBlock = {
  id: number;
  template_id: number;
  day_of_week: number;
  start_min: number;
  end_min: number;
  label: string;
  color: string;
};

export type StatusState = "on_clock" | "on_break" | "off_day" | "before_shift" | "in_shift" | "after_shift" | "week_done";

export type StatusResponse = {
  active_session: SessionRecord | null;
  worked_today_ms: number;
  break_today_ms: number;
  state: StatusState;
  next_boundary_ms: number | null;
  paused: boolean;
  week_done: boolean;
};

export type ScheduleTemplate = {
  id: number;
  name: string;
  is_active: boolean;
};

export type BlockChecklistItem = {
  id: number;
  block_id: number;
  text: string;
  position: number;
};

export type SchedulePayload = {
  templates: ScheduleTemplate[];
  active_template_id: number;
  blocks: ScheduleBlock[];
  checklist_items: BlockChecklistItem[];
};

export type SaveSchedulePayload = {
  template_id: number;
  blocks: ScheduleBlock[];
  checklist_items: BlockChecklistItem[];
};

export type WeekDaySummary = {
  day_of_week: number;
  label: string;
  planned_ms: number;
  actual_ms: number;
};

export type WeekPoint = {
  week_label: string;
  worked_ms: number;
};

export type StatsSummary = {
  week_points: WeekPoint[];
  avg_start_minute: number | null;
  avg_end_minute: number | null;
  month_total_ms: number;
};

export type AppSettings = {
  autostart_enabled: boolean;
  notifications_enabled: boolean;
  idle_nudge_enabled: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start_min: number;
  quiet_hours_end_min: number;
  reminder_interval_min: number;
  corner_snap: "TL" | "TR" | "BL" | "BR";
  window_opacity: number;
};

export type PendingRecovery = {
  session_id: number;
  started_at: number;
  suggested_end_at: number;
};
