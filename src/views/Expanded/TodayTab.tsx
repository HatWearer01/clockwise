import { useCallback, useEffect, useRef, useState } from "react";
import ClockButton from "../../components/ClockButton";
import ProgressRing from "../../components/ProgressRing";
import StatusChip from "../../components/StatusChip";
import {
  blockDurationMs,
  formatDuration,
  formatHoursMinutes,
  formatMinuteAsTime,
  formatShortTime,
  pct,
  stateMessage,
  todayDateString,
  todayISODate,
  weekDayDates,
} from "../../lib/time";
import { useSettingsStore } from "../../store/settings";
import {
  apiAddDailyTask,
  apiDeleteDailyTask,
  apiGetDailyTasks,
  apiMarkDayDone,
  apiRolloverDailyTask,
  apiToggleDailyTask,
} from "../../lib/tauri";
import type { DailyTask } from "../../types";
import { useScheduleStore } from "../../store/schedule";
import { useTimerStore } from "../../store/timer";

export default function TodayTab() {
  const { status, nowMs, clockIn, clockOut, startBreak, resumeBreak } = useTimerStore();
  const { blocks } = useScheduleStore();
  const { appSettings } = useSettingsStore();
  const wsd = appSettings.week_start_day as 0 | 1;
  const tf = appSettings.time_format;

  const isoToday = todayISODate();
  const [tasks, setTasks] = useState<DailyTask[]>([]);
  const [newTaskText, setNewTaskText] = useState("");
  const [rolloverTaskId, setRolloverTaskId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadTasks = useCallback(async () => {
    try {
      const fetched = await apiGetDailyTasks(isoToday);
      setTasks(fetched ?? []);
    } catch { /* ignore */ }
  }, [isoToday]);

  useEffect(() => { void loadTasks(); }, [loadTasks]);

  if (!status) return <p className="muted">Loading today...</p>;

  const todayDow = new Date().getDay();
  const todayBlocks = blocks
    .filter((b) => b.day_of_week === todayDow)
    .sort((a, b) => a.start_min - b.start_min);
  const plannedMs = todayBlocks.reduce((s, b) => s + blockDurationMs(b.start_min, b.end_min), 0);
  const scheduleStart = todayBlocks.length > 0 ? todayBlocks[0].start_min : null;
  const scheduleEnd = todayBlocks.length > 0 ? todayBlocks[todayBlocks.length - 1].end_min : null;

  const activeElapsed = status.active_session
    ? nowMs - status.active_session.started_at
    : 0;
  const workedMs = useTimerStore.getState().liveWorkedMs();
  const remainingMs = Math.max(0, plannedMs - workedMs);
  const progress = pct(workedMs, plannedMs);
  const progressFrac = plannedMs > 0 ? Math.min(1, workedMs / plannedMs) : 0;
  const isOvertime = workedMs > plannedMs && plannedMs > 0;

  async function handleAddTask() {
    const text = newTaskText.trim();
    if (!text) return;
    try {
      await apiAddDailyTask(isoToday, text);
      setNewTaskText("");
      inputRef.current?.focus();
      await loadTasks();
    } catch { /* ignore */ }
  }

  async function handleToggle(id: number, done: boolean) {
    try {
      await apiToggleDailyTask(id, done);
      await loadTasks();
    } catch { /* ignore */ }
  }

  async function handleDelete(id: number) {
    try {
      await apiDeleteDailyTask(id);
      await loadTasks();
    } catch { /* ignore */ }
  }

  async function handleRollover(id: number, targetDate: string) {
    try {
      await apiRolloverDailyTask(id, targetDate);
      setRolloverTaskId(null);
      await loadTasks();
    } catch { /* ignore */ }
  }

  const weekDays = weekDayDates(0, wsd).filter((d) => d.date !== isoToday);

  return (
    <section className="tab-panel">
      <div className="today-header">
        <div>
          <h2 style={{ marginBottom: 2 }}>{todayDateString()}</h2>
          <p className="muted" style={{ margin: 0, fontSize: "0.88rem", minHeight: "2.4em" }}>
            {status.overnight_session && status.active_session
              ? "Continuing overnight shift"
              : stateMessage(status.state, status.next_boundary_ms)}
          </p>
        </div>
        <StatusChip state={status.state} />
      </div>

      <div className="today-hero">
        <ProgressRing progress={progressFrac}>
          <strong>{progress}%</strong>
          <span className="muted" style={{ fontSize: "0.72rem" }}>done</span>
        </ProgressRing>

        <div className="today-stats-col">
          {status.active_session ? (
            <div className="today-stat today-stat-highlight">
              <span className="today-stat-label">
                Current session{status.overnight_session ? " (started yesterday)" : ""}
              </span>
              <span className="today-stat-value">{formatDuration(activeElapsed)}</span>
              <span className="muted" style={{ fontSize: "0.78rem" }}>
                Started at {formatShortTime(status.active_session.started_at, tf)}
              </span>
            </div>
          ) : null}

          <div className="today-stat">
            <span className="today-stat-label">Worked today</span>
            <span className="today-stat-value">{formatHoursMinutes(workedMs)}</span>
          </div>

          {status.break_today_ms > 0 ? (
            <div className="today-stat">
              <span className="today-stat-label">Break time</span>
              <span className="today-stat-value">{formatHoursMinutes(status.break_today_ms)}</span>
            </div>
          ) : null}

          {plannedMs > 0 ? (
            <div className="today-stat">
              <span className="today-stat-label">
                {isOvertime ? "Overtime" : "Remaining"}
              </span>
              <span className="today-stat-value">
                {isOvertime
                  ? `+${formatHoursMinutes(workedMs - plannedMs)}`
                  : formatHoursMinutes(remainingMs)}
              </span>
            </div>
          ) : null}

          <div className="today-stat">
            <span className="today-stat-label">Today's schedule</span>
            <span className="today-stat-value" style={{ fontSize: "0.95rem" }}>
              {scheduleStart !== null && scheduleEnd !== null
                ? `${formatMinuteAsTime(scheduleStart, tf)} - ${formatMinuteAsTime(scheduleEnd, tf)} (${formatHoursMinutes(plannedMs)})`
                : "No shift today"}
            </span>
          </div>
        </div>
      </div>

      {plannedMs > 0 ? (
        <div className="today-progress-bar-wrap">
          <div className="today-progress-track">
            <div
              className={`today-progress-fill ${isOvertime ? "today-progress-overtime" : ""}`}
              style={{ width: `${Math.min(100, progress)}%` }}
            />
          </div>
          <div className="row between" style={{ fontSize: "0.78rem" }}>
            <span className="muted">{formatHoursMinutes(workedMs)} worked</span>
            <span className="muted">{formatHoursMinutes(plannedMs)} target</span>
          </div>
        </div>
      ) : null}

      <div className="daily-tasks">
        <div className="daily-tasks-header">
          <h3 style={{ margin: 0 }}>Tasks</h3>
          <span className="muted" style={{ fontSize: "0.78rem" }}>
            {tasks.filter((t) => t.done).length}/{tasks.length} done
          </span>
        </div>
        <form
          className="daily-tasks-add"
          onSubmit={(e) => { e.preventDefault(); void handleAddTask(); }}
        >
          <input
            ref={inputRef}
            type="text"
            placeholder="Add a task..."
            value={newTaskText}
            onChange={(e) => setNewTaskText(e.currentTarget.value)}
            className="daily-tasks-input"
          />
          <button type="submit" className="chip chip-active" disabled={!newTaskText.trim()}>
            Add
          </button>
        </form>
        {tasks.length > 0 ? (
          <ul className="daily-tasks-list">
            {tasks.map((task) => (
              <li key={task.id} className={`daily-task-item ${task.done ? "daily-task-done" : ""}`}>
                <label className="daily-task-label">
                  <input
                    type="checkbox"
                    checked={task.done}
                    onChange={() => void handleToggle(task.id, !task.done)}
                  />
                  <span className={task.done ? "daily-task-text-done" : ""}>
                    {task.recurring_task_id != null && <span className="recurring-badge" title="Recurring task">↻</span>}
                    {task.text}
                  </span>
                </label>
                <div className="daily-task-actions">
                  {!task.done && (
                    <div style={{ position: "relative" }}>
                      <button
                        className="ghost daily-task-btn"
                        title="Move to another day"
                        onClick={() => setRolloverTaskId(rolloverTaskId === task.id ? null : task.id)}
                      >
                        &#x21B7;
                      </button>
                      {rolloverTaskId === task.id && (
                        <div className="daily-task-rollover-menu">
                          {weekDays.map((d) => (
                            <button
                              key={d.date}
                              className="daily-task-rollover-option"
                              onClick={() => void handleRollover(task.id, d.date)}
                            >
                              {d.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <button
                    className="ghost daily-task-btn"
                    title="Delete task"
                    onClick={() => void handleDelete(task.id)}
                  >
                    &times;
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted" style={{ fontSize: "0.85rem", margin: "8px 0 0" }}>
            No tasks yet. Add one above.
          </p>
        )}
      </div>

      <div className="today-actions">
        {status.active_session ? (
          <button
            className={`chip ${status.paused ? "chip-active" : ""}`}
            onClick={() => (status.paused ? void resumeBreak() : void startBreak())}
          >
            {status.paused ? "Resume work" : "Take a break"}
          </button>
        ) : null}
        <ClockButton
          active={Boolean(status.active_session)}
          onClick={() => (status.active_session ? void clockOut() : void clockIn())}
        />
        {!status.active_session && plannedMs > 0 && (
          <button
            className={`done-toggle ${status.day_done ? "done-toggle-active" : ""}`}
            onClick={async () => {
              const next = !status.day_done;
              await apiMarkDayDone(next);
              void useTimerStore.getState().refreshStatus();
            }}
          >
            {status.day_done ? "Day done ✓" : "Done for the day"}
          </button>
        )}
      </div>
    </section>
  );
}
