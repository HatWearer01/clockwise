import { useCallback, useEffect, useState } from "react";
import {
  apiGetDailyTasks,
  apiGetStatsSummary,
  apiGetTasksForWeek,
  apiGetWeekSummary,
  apiGetWeeklyReview,
  apiIsWeekDone,
  apiMarkWeekDone,
  apiRolloverDailyTask,
} from "../../lib/tauri";
import WeeklyReviewModal from "../../components/WeeklyReview";
import { useSettingsStore } from "../../store/settings";
import { useTimerStore } from "../../store/timer";
import type { DailyTask, StatsSummary, WeekDaySummary, WeeklyReview } from "../../types";
import WeekNav from "../../components/WeekNav";
import {
  formatDecimalHours,
  formatHoursMinutes,
  formatMinuteAsTime,
  pct,
  todayISODate,
  weekDayDates,
  weekRangeLabel,
} from "../../lib/time";

type ViewMode = "current" | "history";

export default function WeekTab() {
  const { appSettings } = useSettingsStore();
  const wsd = appSettings.week_start_day as 0 | 1;
  const tf = appSettings.time_format;
  const isShiftMode = appSettings.accountability_mode === "shift";
  const [days, setDays] = useState<WeekDaySummary[] | null>(null);
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("current");
  const [weekDone, setWeekDone] = useState(false);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [dayTasks, setDayTasks] = useState<DailyTask[]>([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [review, setReview] = useState<WeeklyReview | null>(null);
  const [weekTaskCounts, setWeekTaskCounts] = useState<Record<string, { total: number; done: number }>>({});

  const isCurrentWeek = weekOffset === 0;
  const allWeekDays = weekDayDates(weekOffset, wsd);
  const weekStart = allWeekDays[0].date;
  const isoToday = todayISODate();

  async function toggleExpandDay(date: string) {
    if (expandedDay === date) {
      setExpandedDay(null);
      setDayTasks([]);
      return;
    }
    setExpandedDay(date);
    try {
      const tasks = await apiGetDailyTasks(date);
      setDayTasks(tasks ?? []);
    } catch {
      setDayTasks([]);
    }
  }

  async function handleRolloverToToday(taskId: number) {
    try {
      await apiRolloverDailyTask(taskId, isoToday);
      if (expandedDay) {
        const tasks = await apiGetDailyTasks(expandedDay);
        setDayTasks(tasks ?? []);
      }
    } catch { /* ignore */ }
  }

  const loadWeekData = useCallback(async () => {
    try {
      setError(null);
      const weekData = await apiGetWeekSummary(weekStart, wsd);
      setDays(weekData);
      if (isCurrentWeek) {
        const doneStatus = await apiIsWeekDone();
        setWeekDone(doneStatus);
      } else {
        setWeekDone(false);
      }
    } catch (e) {
      setError(
        typeof e === "object" && e && "message" in e
          ? String((e as { message: unknown }).message)
          : "Failed to load data",
      );
    }
  }, [weekStart, isCurrentWeek, wsd]);

  const loadStats = useCallback(async () => {
    try {
      const statsData = await apiGetStatsSummary(wsd);
      setStats(statsData);
    } catch { /* ignore */ }
  }, [wsd]);

  async function showReview() {
    try {
      const r = await apiGetWeeklyReview(wsd, weekStart);
      setReview(r);
    } catch { /* ignore */ }
  }

  useEffect(() => { void loadWeekData(); }, [loadWeekData]);
  useEffect(() => { void loadStats(); }, [loadStats]);

  useEffect(() => {
    if (!isShiftMode) return;
    apiGetTasksForWeek(weekStart)
      .then((resp) => {
        const counts: Record<string, { total: number; done: number }> = {};
        for (const [date, tasks] of Object.entries(resp.days)) {
          counts[date] = { total: tasks.length, done: tasks.filter((t) => t.done).length };
        }
        setWeekTaskCounts(counts);
      })
      .catch(() => {});
  }, [weekStart, isShiftMode]);

  useEffect(() => {
    setExpandedDay(null);
    setDayTasks([]);
  }, [weekOffset]);

  function navigateToWeekStart(startDate: string) {
    const today = new Date();
    const todayDow = today.getDay();
    const startDay = wsd === 0 ? 0 : 1;
    const diff = (todayDow - startDay + 7) % 7;
    const thisWeekAnchor = new Date(today);
    thisWeekAnchor.setDate(today.getDate() - diff);
    thisWeekAnchor.setHours(0, 0, 0, 0);

    const target = new Date(startDate + "T00:00:00");
    const diffMs = target.getTime() - thisWeekAnchor.getTime();
    const diffWeeks = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));

    setWeekOffset(diffWeeks);
    setView("current");
  }

  if (error) return <section className="tab-panel"><p className="muted">{error}</p></section>;
  if (!days) return <section className="tab-panel"><p className="muted">Loading week...</p></section>;

  const totalPlanned = days.reduce((s, d) => s + d.planned_ms, 0);
  const totalActual = days.reduce((s, d) => s + d.actual_ms, 0);
  const totalCoverage = days.reduce((s, d) => s + d.shift_coverage_ms, 0);
  const remainingMs = Math.max(0, totalPlanned - totalActual);
  const daysWorked = days.filter((d) => d.actual_ms > 60_000).length;
  const daysPresent = days.filter((d) => d.shift_coverage_ms > 60_000).length;
  const daysPlanned = days.filter((d) => d.planned_ms > 0).length;
  const completion = pct(totalActual, totalPlanned);
  const coveragePct = pct(totalCoverage, totalPlanned);
  const isOver = totalActual > totalPlanned && totalPlanned > 0;

  const weekTaskTotal = Object.values(weekTaskCounts).reduce((s, c) => s + c.total, 0);
  const weekTaskDone = Object.values(weekTaskCounts).reduce((s, c) => s + c.done, 0);

  const todayDow = new Date().getDay();
  const todayWeekIndex = todayDow === 0 ? 6 : todayDow - 1;
  const daysLeft = isCurrentWeek
    ? days.filter((_, i) => i >= todayWeekIndex && days[i].planned_ms > 0).length
    : 0;

  const maxWeekWorked = stats ? Math.max(...stats.week_points.map((w) => w.worked_ms), 1) : 1;

  return (
    <section className="tab-panel">
      {review ? <WeeklyReviewModal review={review} onClose={() => setReview(null)} /> : null}
      <div className="week-header">
        <div>
          <div className="row" style={{ gap: 8, alignItems: "baseline" }}>
            <h2 style={{ margin: 0 }}>
              {view === "current"
                ? (isCurrentWeek ? "This Week" : "Week View")
                : "Past Weeks"}
            </h2>
          </div>
          {view === "current" ? (
            <p className="muted" style={{ margin: "2px 0 0", fontSize: "0.85rem" }}>
              {weekRangeLabel(weekOffset, wsd)}
            </p>
          ) : null}
        </div>
        <div className="button-group">
          <button
            className={view === "current" ? "chip chip-active" : "chip"}
            onClick={() => setView("current")}
          >
            {isCurrentWeek ? "This week" : "Detail"}
          </button>
          <button
            className={view === "history" ? "chip chip-active" : "chip"}
            onClick={() => setView("history")}
          >
            History
          </button>
          <button type="button" className="chip" onClick={() => void showReview()}>
            Review
          </button>
        </div>
      </div>

      {view === "current" ? (
        <>
          <WeekNav
            weekOffset={weekOffset}
            onPrev={() => setWeekOffset((o) => o - 1)}
            onNext={() => setWeekOffset((o) => o + 1)}
            onToday={() => setWeekOffset(0)}
            wsd={wsd}
            currentLabel="Current week"
          />

          <div className="stats-grid">
            {isShiftMode ? (
              <>
                <article>
                  <span className="today-stat-label">Shift coverage</span>
                  <strong>{formatHoursMinutes(totalCoverage)}</strong>
                  <span className="muted">of {formatHoursMinutes(totalPlanned)} scheduled</span>
                </article>
                <article>
                  <span className="today-stat-label">Tasks</span>
                  <strong>{weekTaskDone} / {weekTaskTotal}</strong>
                  <span className="muted">done this week</span>
                </article>
                <article>
                  <span className="today-stat-label">Days present</span>
                  <strong>{daysPresent} / {daysPlanned}</strong>
                  <span className="muted">{weekDone ? "Week done" : `${coveragePct}% coverage`}</span>
                </article>
              </>
            ) : (
              <>
                <article>
                  <span className="today-stat-label">Hours logged</span>
                  <strong>{formatHoursMinutes(totalActual)}</strong>
                  <span className="muted">of {formatHoursMinutes(totalPlanned)} planned</span>
                </article>
                <article>
                  <span className="today-stat-label">
                    {weekDone ? "Week complete" : isOver ? "Overtime" : "Still need"}
                  </span>
                  <strong>
                    {weekDone
                      ? formatHoursMinutes(totalActual)
                      : isOver
                        ? `+${formatHoursMinutes(totalActual - totalPlanned)}`
                        : formatHoursMinutes(remainingMs)}
                  </strong>
                  <span className="muted">
                    {weekDone
                      ? "done early"
                      : isOver
                        ? "over target"
                        : daysLeft > 0
                          ? `across ${daysLeft} remaining day${daysLeft === 1 ? "" : "s"}`
                          : "to hit target"}
                  </span>
                </article>
                <article>
                  <span className="today-stat-label">Days worked</span>
                  <strong>{daysWorked} / {daysPlanned}</strong>
                  <span className="muted">{weekDone ? "Week done" : `${completion}% complete`}</span>
                </article>
              </>
            )}
          </div>

          <div className="week-list">
            {days.map((day, idx) => {
              const dayMs = isShiftMode ? day.shift_coverage_ms : day.actual_ms;
              const progress = pct(dayMs, day.planned_ms);
              const isOff = day.planned_ms === 0;
              const isToday = isCurrentWeek && day.day_of_week === todayDow;
              const dayOver = dayMs > day.planned_ms && day.planned_ms > 0;
              const dayDate = allWeekDays[idx]?.date ?? "";
              const isExpanded = expandedDay === dayDate;
              const dtc = weekTaskCounts[dayDate];

              return (
                <div key={day.day_of_week}>
                  <div
                    className={`week-row ${isOff ? "schedule-day-off" : ""} ${isToday ? "week-row-today" : ""}`}
                    style={{ cursor: "pointer" }}
                    onClick={() => void toggleExpandDay(dayDate)}
                  >
                    <span className="week-row-day">
                      {day.label}
                      {isToday ? <span className="week-today-dot" /> : null}
                    </span>
                    <div style={{ flex: 1, display: "grid", gap: 4 }}>
                      <div className="week-bar-wrap">
                        {day.planned_ms > 0 && (
                          <div className="week-bar week-bar-planned" style={{ width: "100%", borderRadius: 999 }} />
                        )}
                        <div
                          className={`week-bar ${dayOver ? "week-bar-overtime" : "week-bar-actual"}`}
                          style={{ width: `${Math.min(100, progress)}%`, borderRadius: 999 }}
                        />
                      </div>
                    </div>
                    <span className="week-row-hours">
                      {isOff
                        ? "off"
                        : isShiftMode
                          ? `${formatHoursMinutes(day.shift_coverage_ms)} / ${formatHoursMinutes(day.planned_ms)}${dtc ? ` · ${dtc.done}/${dtc.total} tasks` : ""}`
                          : `${formatHoursMinutes(day.actual_ms)} / ${formatHoursMinutes(day.planned_ms)}`}
                    </span>
                  </div>
                  {isExpanded && (
                    <div className="week-day-tasks">
                      {dayTasks.length === 0 ? (
                        <p className="muted" style={{ fontSize: "0.82rem", margin: "4px 0 4px 28px" }}>
                          No tasks for this day.
                        </p>
                      ) : (
                        <ul className="daily-tasks-list" style={{ padding: "4px 0 4px 28px" }}>
                          {dayTasks.map((task) => (
                            <li key={task.id} className={`daily-task-item ${task.done ? "daily-task-done" : ""}`}>
                              <span className="daily-task-label" style={{ cursor: "default" }}>
                                <span style={{ width: 16, textAlign: "center", flexShrink: 0, fontSize: "0.82rem" }}>
                                  {task.done ? "✓" : "○"}
                                </span>
                                <span className={task.done ? "daily-task-text-done" : ""}>
                                  {task.recurring_task_id != null && <span className="recurring-badge" title="Recurring task">↻</span>}
                                  {task.text}
                                </span>
                              </span>
                              {!task.done && !task.recurring_task_id && dayDate !== isoToday && (
                                <button
                                  className="chip"
                                  style={{ fontSize: "0.72rem", padding: "1px 6px" }}
                                  onClick={(e) => { e.stopPropagation(); void handleRolloverToToday(task.id); }}
                                >
                                  → Today
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {isCurrentWeek && totalPlanned > 0 && (
            <button
              className={`done-toggle ${weekDone ? "done-toggle-active" : ""}`}
              style={{ marginTop: 8, alignSelf: "flex-start" }}
              onClick={async () => {
                const next = !weekDone;
                await apiMarkWeekDone(next);
                setWeekDone(next);
                void useTimerStore.getState().refreshStatus();
              }}
            >
              {weekDone ? "Week done ✓" : "Done for the week"}
            </button>
          )}
        </>
      ) : (
        <>
          <div className="stats-grid">
            <article>
              <span className="today-stat-label">This month</span>
              <strong>{formatHoursMinutes(stats?.month_total_ms ?? 0)}</strong>
              <span className="muted">total logged</span>
            </article>
            {stats?.avg_start_minute != null ? (
              <article>
                <span className="today-stat-label">Avg clock-in</span>
                <strong>{formatMinuteAsTime(stats.avg_start_minute, tf)}</strong>
                <span className="muted">last 60 days</span>
              </article>
            ) : null}
            {stats?.avg_end_minute != null ? (
              <article>
                <span className="today-stat-label">Avg clock-out</span>
                <strong>{formatMinuteAsTime(stats.avg_end_minute, tf)}</strong>
                <span className="muted">last 60 days</span>
              </article>
            ) : null}
          </div>

          <div>
            <p className="muted" style={{ margin: "0 0 8px", fontSize: "0.85rem" }}>
              Weekly hours over the last 8 weeks — click a bar to view details
            </p>
            <div className="history-chart">
              {(stats?.week_points ?? []).map((wp, i) => {
                const barH = Math.max(4, Math.round((wp.worked_ms / maxWeekWorked) * 140));
                const isCurrent = i === (stats?.week_points.length ?? 0) - 1;
                return (
                  <div
                    key={wp.week_label}
                    className="history-bar-col history-bar-clickable"
                    onClick={() => navigateToWeekStart(wp.week_start_date)}
                    title={`View week of ${wp.week_start_date}`}
                  >
                    <span className="history-bar-value">
                      {wp.worked_ms > 0 ? formatDecimalHours(wp.worked_ms) : "-"}
                    </span>
                    <div
                      className={`history-bar ${isCurrent ? "history-bar-current" : ""}`}
                      style={{ height: barH }}
                    />
                    <span className="history-bar-label">{wp.week_label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
