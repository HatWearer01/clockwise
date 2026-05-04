import { useCallback, useEffect, useState } from "react";
import { apiGetDailyTasks, apiGetStatsSummary, apiGetWeekSummary, apiIsWeekDone, apiMarkWeekDone, apiRolloverDailyTask } from "../../lib/tauri";
import { useTimerStore } from "../../store/timer";
import type { DailyTask, StatsSummary, WeekDaySummary } from "../../types";
import {
  currentWeekNumber,
  currentWeekRange,
  formatDecimalHours,
  formatHoursMinutes,
  formatMinuteAsTime,
  pct,
  todayISODate,
  weekDayDates,
} from "../../lib/time";

type ViewMode = "current" | "history";

export default function WeekTab() {
  const [days, setDays] = useState<WeekDaySummary[] | null>(null);
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("current");
  const [weekDone, setWeekDone] = useState(false);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [dayTasks, setDayTasks] = useState<DailyTask[]>([]);

  const weekDates = weekDayDates();
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

  const load = useCallback(async () => {
    try {
      setError(null);
      const [weekData, statsData, doneStatus] = await Promise.all([
        apiGetWeekSummary(),
        apiGetStatsSummary(),
        apiIsWeekDone(),
      ]);
      setDays(weekData);
      setStats(statsData);
      setWeekDone(doneStatus);
    } catch (e) {
      setError(
        typeof e === "object" && e && "message" in e
          ? String((e as { message: unknown }).message)
          : "Failed to load data",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <section className="tab-panel"><p className="muted">{error}</p></section>;
  if (!days || !stats) return <section className="tab-panel"><p className="muted">Loading week...</p></section>;

  const totalPlanned = days.reduce((s, d) => s + d.planned_ms, 0);
  const totalActual = days.reduce((s, d) => s + d.actual_ms, 0);
  const remainingMs = Math.max(0, totalPlanned - totalActual);
  const daysWorked = days.filter((d) => d.actual_ms > 60_000).length;
  const daysPlanned = days.filter((d) => d.planned_ms > 0).length;
  const completion = pct(totalActual, totalPlanned);
  const isOver = totalActual > totalPlanned && totalPlanned > 0;

  const todayDow = new Date().getDay();
  const todayWeekIndex = todayDow === 0 ? 6 : todayDow - 1;
  const daysLeft = days.filter((_, i) => i >= todayWeekIndex && days[i].planned_ms > 0).length;

  const maxWeekWorked = Math.max(...stats.week_points.map((w) => w.worked_ms), 1);

  return (
    <section className="tab-panel">
      <div className="week-header">
        <div>
          <div className="row" style={{ gap: 8, alignItems: "baseline" }}>
            <h2 style={{ margin: 0 }}>
              {view === "current" ? "This Week" : "Past Weeks"}
            </h2>
            <span className="muted" style={{ fontSize: "0.82rem" }}>
              Week {currentWeekNumber()}
            </span>
          </div>
          {view === "current" ? (
            <p className="muted" style={{ margin: "2px 0 0", fontSize: "0.85rem" }}>
              {currentWeekRange()}
            </p>
          ) : null}
        </div>
        <div className="button-group">
          <button
            className={view === "current" ? "chip chip-active" : "chip"}
            onClick={() => setView("current")}
          >
            This week
          </button>
          <button
            className={view === "history" ? "chip chip-active" : "chip"}
            onClick={() => setView("history")}
          >
            History
          </button>
        </div>
      </div>

      {view === "current" ? (
        <>
          <div className="stats-grid">
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
              <strong>
                {daysWorked} / {daysPlanned}
              </strong>
              <span className="muted">{weekDone ? "Week done" : `${completion}% complete`}</span>
            </article>
          </div>

          <div className="week-list">
            {days.map((day, idx) => {
              const progress = pct(day.actual_ms, day.planned_ms);
              const isOff = day.planned_ms === 0;
              const isToday = day.day_of_week === todayDow;
              const dayOver = day.actual_ms > day.planned_ms && day.planned_ms > 0;
              const dayDate = weekDates[idx]?.date ?? "";
              const isExpanded = expandedDay === dayDate;

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
                                <span className={task.done ? "daily-task-text-done" : ""}>{task.text}</span>
                              </span>
                              {!task.done && dayDate !== isoToday && (
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

          {totalPlanned > 0 && (
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
              <strong>{formatHoursMinutes(stats.month_total_ms)}</strong>
              <span className="muted">total logged</span>
            </article>
            {stats.avg_start_minute !== null ? (
              <article>
                <span className="today-stat-label">Avg clock-in</span>
                <strong>{formatMinuteAsTime(stats.avg_start_minute)}</strong>
                <span className="muted">last 60 days</span>
              </article>
            ) : null}
            {stats.avg_end_minute !== null ? (
              <article>
                <span className="today-stat-label">Avg clock-out</span>
                <strong>{formatMinuteAsTime(stats.avg_end_minute)}</strong>
                <span className="muted">last 60 days</span>
              </article>
            ) : null}
          </div>

          <div>
            <p className="muted" style={{ margin: "0 0 8px", fontSize: "0.85rem" }}>
              Weekly hours over the last 8 weeks
            </p>
            <div className="history-chart">
              {stats.week_points.map((wp, i) => {
                const barH = Math.max(4, Math.round((wp.worked_ms / maxWeekWorked) * 140));
                const isCurrent = i === stats.week_points.length - 1;
                return (
                  <div key={wp.week_label} className="history-bar-col">
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
