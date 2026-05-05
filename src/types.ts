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

export type StatusState = "on_clock" | "on_break" | "off_day" | "before_shift" | "in_shift" | "after_shift" | "week_done" | "day_done";

export type StatusResponse = {
  active_session: SessionRecord | null;
  worked_today_ms: number;
  break_today_ms: number;
  state: StatusState;
  next_boundary_ms: number | null;
  paused: boolean;
  week_done: boolean;
  day_done: boolean;
  overnight_session: boolean;
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
  week_start_date: string;
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
  window_opacity: number;
};

export type PendingRecovery = {
  session_id: number;
  started_at: number;
  suggested_end_at: number;
};

export type DailyTask = {
  id: number;
  date: string;
  text: string;
  done: boolean;
  done_at: number | null;
  created_at: number;
  position: number;
  recurring_task_id: number | null;
};

export type RecurrenceType = "daily" | "weekdays" | "specific_days" | "weekly" | "every_n_days";

export type RecurringTask = {
  id: number;
  text: string;
  recurrence_type: RecurrenceType;
  recurrence_days: string | null;
  interval_days: number | null;
  start_date: string;
  end_date: string | null;
  created_at: number;
  active: boolean;
};

export type RecurringStatEntry = {
  total: number;
  done: number;
};

export type WeekTasksResponse = {
  days: Record<string, DailyTask[]>;
  recurring_stats: Record<number, RecurringStatEntry>;
};
