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

export type StatusState = "on_clock" | "on_break" | "off_day" | "before_shift" | "in_shift" | "after_shift" | "week_done" | "day_done" | "behind_target";

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
  target_today_ms: number;
  off_schedule: boolean;
};

export type DayTarget = {
  day_of_week: number;
  target_min: number;
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
  day_targets: DayTarget[];
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
  target_ms: number;
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
  always_on_top: boolean;
  week_start_day: 0 | 1;
  time_format: "12h" | "24h";
  idle_nudge_work_min: number;
  idle_nudge_idle_min: number;
};

export type PendingRecovery = {
  session_id: number;
  started_at: number;
  suggested_end_at: number;
};

export type Subtask = {
  id: number;
  task_id: number;
  text: string;
  done: boolean;
  position: number;
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
  subtasks: Subtask[];
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

export type Insight = {
  kind: string;
  message: string;
  severity: "info" | "warning" | "positive";
};

export type WeeklyReviewDay = {
  label: string;
  target_ms: number;
  actual_ms: number;
  on_time: boolean;
};

export type WeeklyReview = {
  week_label: string;
  days_worked: number;
  days_scheduled: number;
  total_target_ms: number;
  total_actual_ms: number;
  avg_start_minute: number | null;
  avg_end_minute: number | null;
  on_time_days: number;
  off_schedule_sessions: number;
  day_details: WeeklyReviewDay[];
  insights: Insight[];
};
