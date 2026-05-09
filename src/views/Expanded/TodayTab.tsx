import { useCallback, useEffect, useRef, useState } from "react";
import ClockButton from "../../components/ClockButton";
import OffScheduleConfirm from "../../components/OffScheduleConfirm";
import ProgressRing from "../../components/ProgressRing";
import StatusChip from "../../components/StatusChip";
import SubtaskPanel from "../../components/SubtaskPanel";
import {
  blockDurationMs,
  formatDuration,
  formatHoursMinutes,
  formatMinuteAsTime,
  formatShortTime,
  isCurrentlyInSchedule,
  pct,
  shiftProgressFraction,
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
  apiGetInsights,
  apiGetNotificationHistory,
  apiMarkDayDone,
  apiRolloverDailyTask,
  apiToggleDailyTask,
} from "../../lib/tauri";
import type { DailyTask, Insight, NotificationLogEntry } from "../../types";
import { useScheduleStore } from "../../store/schedule";
import { useTimerStore } from "../../store/timer";

type BellItem = { id: string; message: string; severity: "info" | "warning" | "positive"; source: "insight" | "notification" };


export default function TodayTab() {
  const { status, nowMs, clockIn, clockOut, startBreak, resumeBreak, offSchedulePrompt, setOffSchedulePrompt, notice, actionPrompt } = useTimerStore();
  const { blocks } = useScheduleStore();
  const { appSettings } = useSettingsStore();
  const wsd = appSettings.week_start_day as 0 | 1;
  const tf = appSettings.time_format;

  const isoToday = todayISODate();
  const [tasks, setTasks] = useState<DailyTask[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [dismissedInsights, setDismissedInsights] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("cw_dismissed_insights");
      return stored ? new Set(JSON.parse(stored) as string[]) : new Set();
    } catch { return new Set(); }
  });
  const [newTaskText, setNewTaskText] = useState("");
  const [rolloverTaskId, setRolloverTaskId] = useState<number | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);
  const [showInsightsPanel, setShowInsightsPanel] = useState(false);
  const [bellTab, setBellTab] = useState<"active" | "history">("active");
  const [historyEntries, setHistoryEntries] = useState<NotificationLogEntry[]>([]);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [insightsBannerExpanded, setInsightsBannerExpanded] = useState(false);
  const historyScrollRef = useRef<HTMLDivElement>(null);

  function dismissInsight(kind: string) {
    setDismissedInsights((prev) => {
      const next = new Set([...prev, kind]);
      localStorage.setItem("cw_dismissed_insights", JSON.stringify([...next]));
      return next;
    });
  }

  const PAGE_SIZE = 50;
  async function loadHistory(reset = false) {
    if (historyLoading) return;
    setHistoryLoading(true);
    try {
      const off = reset ? 0 : historyOffset;
      const entries = await apiGetNotificationHistory(off, PAGE_SIZE);
      if (reset) {
        setHistoryEntries(entries ?? []);
        setHistoryOffset(PAGE_SIZE);
      } else {
        setHistoryEntries((prev) => [...prev, ...(entries ?? [])]);
        setHistoryOffset(off + PAGE_SIZE);
      }
      setHistoryHasMore((entries ?? []).length >= PAGE_SIZE);
    } catch { /* ignore */ }
    setHistoryLoading(false);
  }

  function handleHistoryScroll() {
    const el = historyScrollRef.current;
    if (!el || !historyHasMore || historyLoading) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
      void loadHistory();
    }
  }

  const inputRef = useRef<HTMLInputElement>(null);

  const loadTasks = useCallback(async () => {
    try {
      const fetched = await apiGetDailyTasks(isoToday);
      setTasks(fetched ?? []);
    } catch { /* ignore */ }
  }, [isoToday]);

  useEffect(() => { void loadTasks(); }, [loadTasks]);

  useEffect(() => {
    apiGetInsights(wsd).then((r) => setInsights(r ?? [])).catch(() => {});
  }, [wsd]);

  if (!status) return <p className="muted">Loading today...</p>;

  const todayDow = new Date().getDay();
  const todayBlocks = blocks
    .filter((b) => b.day_of_week === todayDow)
    .sort((a, b) => a.start_min - b.start_min);
  const plannedMs = todayBlocks.reduce((s, b) => s + blockDurationMs(b.start_min, b.end_min), 0);
  const targetMs = status.target_today_ms > 0 ? status.target_today_ms : plannedMs;
  const scheduleStart = todayBlocks.length > 0 ? todayBlocks[0].start_min : null;
  const scheduleEnd = todayBlocks.length > 0 ? todayBlocks[todayBlocks.length - 1].end_min : null;

  const isShiftMode = appSettings.accountability_mode === "shift";
  const tasksDone = tasks.filter((t) => t.done).length;

  const activeElapsed = status.active_session
    ? nowMs - status.active_session.started_at
    : 0;
  const workedMs = useTimerStore.getState().liveWorkedMs();
  const remainingMs = Math.max(0, targetMs - workedMs);
  const progress = pct(workedMs, targetMs);
  const progressFrac = targetMs > 0 ? Math.min(1, workedMs / targetMs) : 0;
  const isOvertime = workedMs > targetMs && targetMs > 0;

  const inScheduleNow = isCurrentlyInSchedule(blocks);
  const liveCoverageMs = useTimerStore.getState().liveShiftCoverageMs(inScheduleNow);
  const shiftRingFrac =
    isShiftMode && plannedMs > 0 ? shiftProgressFraction(workedMs, liveCoverageMs, plannedMs) : progressFrac;
  const shiftRingPct = Math.round(shiftRingFrac * 100);

  let scheduleStatText: string;
  if (scheduleStart !== null && scheduleEnd !== null) {
    scheduleStatText = `${formatMinuteAsTime(scheduleStart, tf)} - ${formatMinuteAsTime(scheduleEnd, tf)} (${formatHoursMinutes(plannedMs)})`;
    if (status.target_today_ms > 0 && status.target_today_ms !== plannedMs) {
      scheduleStatText += ` · Target: ${formatHoursMinutes(status.target_today_ms)}`;
    }
  } else if (plannedMs === 0 && status.target_today_ms > 0) {
    scheduleStatText = `Flex day · Target: ${formatHoursMinutes(status.target_today_ms)}`;
  } else {
    scheduleStatText = "No shift today";
  }

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
      const updated = await apiGetDailyTasks(isoToday);
      setTasks(updated ?? []);
      if (updated && updated.length > 0 && updated.every((t) => t.done)) {
        await apiMarkDayDone(true);
        void useTimerStore.getState().refreshStatus();
      } else if (!done && status?.day_done) {
        await apiMarkDayDone(false);
        void useTimerStore.getState().refreshStatus();
      }
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

  const bellItems: BellItem[] = [];
  if (notice) {
    bellItems.push({ id: "notice", message: notice, severity: "info", source: "notification" });
  }
  if (actionPrompt) {
    bellItems.push({ id: `action-${actionPrompt.kind}`, message: actionPrompt.message, severity: "warning", source: "notification" });
  }
  if (status.state === "behind_target") {
    bellItems.push({ id: "behind", message: "You're behind on your daily hour target.", severity: "warning", source: "notification" });
  }
  if (status.off_schedule && status.active_session) {
    bellItems.push({ id: "offsched", message: "Working outside scheduled hours.", severity: "warning", source: "notification" });
  }
  for (const i of insights) {
    bellItems.push({ id: i.kind, message: i.message, severity: i.severity, source: "insight" });
  }

  const newItems = bellItems.filter((b) => !dismissedInsights.has(b.id));
  const historyItems = bellItems.filter((b) => dismissedInsights.has(b.id));
  const badgeCount = newItems.length;

  const todayDateStr = new Date(nowMs).toLocaleDateString();
  const yesterdayDateStr = new Date(nowMs - 86400000).toLocaleDateString();

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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div className="insight-bell-wrap">
            <button
              className={`ghost insight-bell ${showInsightsPanel ? "insight-bell-active" : ""}`}
              title="Notifications &amp; insights"
              onClick={() => {
                const opening = !showInsightsPanel;
                setShowInsightsPanel(opening);
                if (opening && bellTab === "history" && historyEntries.length === 0) {
                  void loadHistory(true);
                }
              }}
            >
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2a1 1 0 0 1 1 1v1.07A7.002 7.002 0 0 1 19 11v3.76l1.71 1.71A1 1 0 0 1 20 18h-4a4 4 0 0 1-8 0H4a1 1 0 0 1-.71-1.53L5 14.76V11a7.002 7.002 0 0 1 6-6.93V3a1 1 0 0 1 1-1zm-2 16a2 2 0 0 0 4 0h-4zm2-12a5 5 0 0 0-5 5v4a1 1 0 0 1-.17.55L5.54 16h12.92l-1.29-1.45A1 1 0 0 1 17 14v-3a5 5 0 0 0-5-5z"/>
              </svg>
              {badgeCount > 0 && <span className="insight-bell-badge">{badgeCount}</span>}
            </button>
            {showInsightsPanel && (
              <>
                <div className="insights-panel-backdrop" onClick={() => setShowInsightsPanel(false)} />
                <div className="insights-panel">
                  <div className="insights-panel-header">
                    <strong>Notifications</strong>
                    <button className="ghost daily-task-btn" onClick={() => setShowInsightsPanel(false)}>×</button>
                  </div>
                  <div className="bell-tab-strip">
                    <button
                      className={`bell-tab ${bellTab === "active" ? "bell-tab-active" : ""}`}
                      onClick={() => setBellTab("active")}
                    >
                      Active{badgeCount > 0 ? ` (${badgeCount})` : ""}
                    </button>
                    <button
                      className={`bell-tab ${bellTab === "history" ? "bell-tab-active" : ""}`}
                      onClick={() => {
                        setBellTab("history");
                        if (historyEntries.length === 0) void loadHistory(true);
                      }}
                    >
                      History
                    </button>
                  </div>
                  {bellTab === "active" ? (
                    <div className="bell-tab-content">
                      {newItems.length > 0 ? (
                        newItems.map((item) => (
                          <div key={item.id} className={`insight-card insight-${item.severity}`}>
                            <span className="insight-icon">
                              {item.severity === "positive" ? "✓" : item.severity === "warning" ? "!" : "i"}
                            </span>
                            <span className="insight-message">{item.message}</span>
                            <button
                              type="button"
                              className="insight-dismiss"
                              title="Dismiss"
                              onClick={() => dismissInsight(item.id)}
                            >
                              ×
                            </button>
                          </div>
                        ))
                      ) : (
                        <p className="muted" style={{ fontSize: "0.8rem", margin: "4px 0" }}>No new notifications.</p>
                      )}
                      {historyItems.length > 0 && (
                        <>
                          <div className="insights-panel-divider">
                            <span className="muted" style={{ fontSize: "0.72rem" }}>Dismissed</span>
                          </div>
                          {historyItems.map((item) => (
                            <div key={item.id} className="insight-card insight-dismissed">
                              <span className="insight-icon">
                                {item.severity === "positive" ? "✓" : item.severity === "warning" ? "!" : "i"}
                              </span>
                              <span className="insight-message">{item.message}</span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  ) : (
                    <div
                      className="bell-history-scroll"
                      ref={historyScrollRef}
                      onScroll={handleHistoryScroll}
                    >
                      {historyEntries.length > 0 ? (
                        (() => {
                          let lastGroup = "";
                          return historyEntries.map((entry) => {
                            const d = new Date(entry.created_at);
                            const dateStr = d.toLocaleDateString();
                            const groupLabel = dateStr === todayDateStr ? "Today" : dateStr === yesterdayDateStr ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
                            const showHeader = groupLabel !== lastGroup;
                            lastGroup = groupLabel;
                            return (
                              <div key={entry.id}>
                                {showHeader && (
                                  <div className="history-date-header">{groupLabel}</div>
                                )}
                                <div className="history-entry">
                                  <div className="history-entry-title">{entry.title}</div>
                                  <div className="history-entry-body">{entry.body}</div>
                                  <div className="history-entry-time">
                                    {d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                  </div>
                                </div>
                              </div>
                            );
                          });
                        })()
                      ) : historyLoading ? (
                        <p className="muted" style={{ fontSize: "0.8rem", margin: "4px 0" }}>Loading...</p>
                      ) : (
                        <p className="muted" style={{ fontSize: "0.8rem", margin: "4px 0" }}>No notification history yet.</p>
                      )}
                      {historyLoading && historyEntries.length > 0 && (
                        <p className="muted" style={{ fontSize: "0.75rem", textAlign: "center", margin: "4px 0" }}>Loading more...</p>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <StatusChip state={status.state} />
        </div>
      </div>

      <div className="today-hero">
        <ProgressRing progress={isShiftMode && plannedMs > 0 ? shiftRingFrac : progressFrac}>
          <strong>{isShiftMode && plannedMs > 0 ? shiftRingPct : progress}%</strong>
          <span className="muted" style={{ fontSize: "0.72rem" }}>
            {isShiftMode && plannedMs > 0 ? "progress" : "done"}
          </span>
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

          {isShiftMode && plannedMs > 0 ? (
            <>
              <div className="today-stat">
                <span className="today-stat-label">Hours</span>
                <span className="today-stat-value">
                  {formatHoursMinutes(workedMs)} / {formatHoursMinutes(plannedMs)}
                </span>
                <span className="muted" style={{ fontSize: "0.78rem" }}>
                  {formatHoursMinutes(liveCoverageMs)} in scheduled hours
                </span>
              </div>
              {tasks.length > 0 && (
                <div className="today-stat">
                  <span className="today-stat-label">Tasks</span>
                  <span className="today-stat-value">{tasksDone}/{tasks.length} done</span>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="today-stat">
                <span className="today-stat-label">Worked today</span>
                <span className="today-stat-value">{formatHoursMinutes(workedMs)}</span>
              </div>
              {targetMs > 0 ? (
                <div className="today-stat">
                  <span className="today-stat-label">
                    {isOvertime ? "Overtime" : "Remaining"}
                  </span>
                  <span className="today-stat-value">
                    {isOvertime
                      ? `+${formatHoursMinutes(workedMs - targetMs)}`
                      : formatHoursMinutes(remainingMs)}
                  </span>
                </div>
              ) : null}
            </>
          )}

          {status.break_today_ms > 0 ? (
            <div className="today-stat">
              <span className="today-stat-label">Break time</span>
              <span className="today-stat-value">{formatHoursMinutes(status.break_today_ms)}</span>
            </div>
          ) : null}

          <div className="today-stat">
            <span className="today-stat-label">Today's schedule</span>
            <span className="today-stat-value" style={{ fontSize: "0.95rem" }}>
              {scheduleStatText}
            </span>
          </div>
        </div>
      </div>

      {isShiftMode && plannedMs > 0 ? (
        <div className="today-progress-bar-wrap">
          <div className="today-progress-track">
            <div
              className="today-progress-fill"
              style={{ width: `${Math.min(100, shiftRingPct)}%` }}
            />
          </div>
          <div className="row between" style={{ fontSize: "0.78rem" }}>
            <span className="muted">{formatHoursMinutes(workedMs)} worked</span>
            <span className="muted">{formatHoursMinutes(plannedMs)} planned shift</span>
          </div>
        </div>
      ) : targetMs > 0 ? (
        <div className="today-progress-bar-wrap">
          <div className="today-progress-track">
            <div
              className={`today-progress-fill ${isOvertime ? "today-progress-overtime" : ""}`}
              style={{ width: `${Math.min(100, progress)}%` }}
            />
          </div>
          <div className="row between" style={{ fontSize: "0.78rem" }}>
            <span className="muted">{formatHoursMinutes(workedMs)} worked</span>
            <span className="muted">{formatHoursMinutes(targetMs)} target</span>
          </div>
        </div>
      ) : null}

      {(() => {
        const activeInsights = insights.filter((i) => !dismissedInsights.has(i.kind));
        if (activeInsights.length === 0) return null;
        const top = activeInsights[0];
        const moreCount = activeInsights.length - 1;
        return (
          <div className="insights-inline-banner">
            {insightsBannerExpanded ? (
              activeInsights.map((insight) => (
                <div key={insight.kind} className={`insight-inline-item insight-${insight.severity}`}>
                  <span className="insight-icon">
                    {insight.severity === "positive" ? "✓" : insight.severity === "warning" ? "!" : "i"}
                  </span>
                  <span className="insight-message">{insight.message}</span>
                  <button type="button" className="insight-dismiss" onClick={() => dismissInsight(insight.kind)}>×</button>
                </div>
              ))
            ) : (
              <div className={`insight-inline-item insight-${top.severity}`}>
                <span className="insight-icon">
                  {top.severity === "positive" ? "✓" : top.severity === "warning" ? "!" : "i"}
                </span>
                <span className="insight-message">{top.message}</span>
                {moreCount > 0 && (
                  <button
                    type="button"
                    className="insight-more-badge"
                    onClick={() => setInsightsBannerExpanded(true)}
                  >
                    +{moreCount} more
                  </button>
                )}
                <button type="button" className="insight-dismiss" onClick={() => dismissInsight(top.kind)}>×</button>
              </div>
            )}
            {insightsBannerExpanded && (
              <button
                type="button"
                className="insight-collapse-btn"
                onClick={() => setInsightsBannerExpanded(false)}
              >
                Show less
              </button>
            )}
          </div>
        );
      })()}

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
            {tasks.map((task) => {
              const isExpanded = expandedTaskId === task.id;
              const subDone = task.subtasks.filter((s) => s.done).length;
              const subTotal = task.subtasks.length;
              return (
                <li key={task.id} className={`daily-task-item ${task.done ? "daily-task-done" : ""}`}>
                  <div className="daily-task-row">
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
                      {subTotal > 0 && (
                        <span className="subtask-count" title={`${subDone}/${subTotal} subtasks done`}>
                          {subDone}/{subTotal}
                        </span>
                      )}
                    </label>
                    <div className="daily-task-actions">
                      <button
                        className={`ghost daily-task-btn ${isExpanded ? "daily-task-btn-active" : ""}`}
                        title="Subtasks"
                        onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                      >
                        ⋯
                      </button>
                      {!task.done && !task.recurring_task_id && (
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
                  </div>
                  {isExpanded && (
                    <SubtaskPanel taskId={task.id} subtasks={task.subtasks} onChanged={() => void loadTasks()} />
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted" style={{ fontSize: "0.85rem", margin: "8px 0 0" }}>
            No tasks yet. Add one above.
          </p>
        )}
      </div>

      {offSchedulePrompt && !status.active_session ? <OffScheduleConfirm /> : null}

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
          offSchedule={!status.active_session && appSettings.accountability_mode === "shift" && todayBlocks.length > 0 && !isCurrentlyInSchedule(blocks)}
          onClick={() => {
            if (status.active_session) {
              void clockOut();
              return;
            }
            if (isCurrentlyInSchedule(blocks)) {
              void clockIn();
              return;
            }
            setOffSchedulePrompt(true);
          }}
        />
        {!status.active_session && (targetMs > 0 || status.day_done) && (
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
