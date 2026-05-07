import { useCallback, useEffect, useRef, useState } from "react";
import {
  apiAddDailyTask,
  apiAddRecurringTask,
  apiAddSubtask,
  apiDeleteDailyTask,
  apiDeleteRecurringTask,
  apiDeleteSubtask,
  apiGetRecurringTasks,
  apiGetTasksForWeek,
  apiRolloverDailyTask,
  apiToggleDailyTask,
  apiToggleSubtask,
  apiUpdateDailyTask,
  apiUpdateRecurringTask,
} from "../../lib/tauri";
import { todayISODate, weekDayDates, weekRangeLabel } from "../../lib/time";
import { useSettingsStore } from "../../store/settings";
import type { DailyTask, RecurrenceType, RecurringTask, WeekTasksResponse } from "../../types";

const RECURRENCE_LABELS: Record<RecurrenceType, string> = {
  daily: "Every day",
  weekdays: "Weekdays (Mon–Fri)",
  specific_days: "Specific days",
  weekly: "Weekly",
  every_n_days: "Every N days",
};

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function TasksTab() {
  const { appSettings } = useSettingsStore();
  const wsd = appSettings.week_start_day as 0 | 1;
  const isoToday = todayISODate();

  const [weekOffset, setWeekOffset] = useState(0);
  const allWeekDays = weekDayDates(weekOffset, wsd);
  const weekStart = allWeekDays[0].date;
  const isCurrentWeek = weekOffset === 0;
  const isPastWeek = weekOffset < 0;

  const [selectedDate, setSelectedDate] = useState(isoToday);
  const [weekData, setWeekData] = useState<WeekTasksResponse | null>(null);
  const [newTaskText, setNewTaskText] = useState("");
  const [rolloverTaskId, setRolloverTaskId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);
  const [newSubtaskText, setNewSubtaskText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const [showRecurring, setShowRecurring] = useState(false);
  const [recurringTasks, setRecurringTasks] = useState<RecurringTask[]>([]);
  const [newRecText, setNewRecText] = useState("");
  const [newRecType, setNewRecType] = useState<RecurrenceType>("daily");
  const [newRecDays, setNewRecDays] = useState<number[]>([]);
  const [newRecInterval, setNewRecInterval] = useState(2);
  const [newRecEndDate, setNewRecEndDate] = useState("");
  const [editRecId, setEditRecId] = useState<number | null>(null);

  const loadWeek = useCallback(async () => {
    try {
      const data = await apiGetTasksForWeek(weekStart);
      setWeekData(data ?? null);
    } catch { /* ignore */ }
  }, [weekStart]);

  const loadRecurring = useCallback(async () => {
    try {
      const list = await apiGetRecurringTasks();
      setRecurringTasks(list ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void loadWeek(); }, [loadWeek]);
  useEffect(() => { void loadRecurring(); }, [loadRecurring]);

  useEffect(() => {
    const dayInWeek = allWeekDays.find((d) => d.date === isoToday);
    if (isCurrentWeek && dayInWeek) {
      setSelectedDate(isoToday);
    } else {
      setSelectedDate(allWeekDays[0].date);
    }
    setRolloverTaskId(null);
    setEditingId(null);
  }, [weekOffset]);

  const tasks: DailyTask[] = weekData?.days[selectedDate] ?? [];
  const isToday = selectedDate === isoToday;
  const selectedDayLabel = allWeekDays.find((d) => d.date === selectedDate)?.label ?? selectedDate;
  const doneCount = tasks.filter((t) => t.done).length;

  async function handleAdd() {
    const text = newTaskText.trim();
    if (!text) return;
    try {
      await apiAddDailyTask(selectedDate, text);
      setNewTaskText("");
      inputRef.current?.focus();
      await loadWeek();
    } catch { /* ignore */ }
  }

  async function handleToggle(id: number, done: boolean) {
    try {
      await apiToggleDailyTask(id, done);
      await loadWeek();
    } catch { /* ignore */ }
  }

  async function handleDelete(id: number) {
    try {
      await apiDeleteDailyTask(id);
      await loadWeek();
    } catch { /* ignore */ }
  }

  async function handleRollover(id: number, targetDate: string) {
    try {
      await apiRolloverDailyTask(id, targetDate);
      setRolloverTaskId(null);
      await loadWeek();
    } catch { /* ignore */ }
  }

  async function handleSaveEdit(id: number) {
    const text = editText.trim();
    if (!text) return;
    try {
      await apiUpdateDailyTask(id, text);
      setEditingId(null);
      setEditText("");
      await loadWeek();
    } catch { /* ignore */ }
  }

  async function handleAddSubtask(taskId: number) {
    const text = newSubtaskText.trim();
    if (!text) return;
    try {
      await apiAddSubtask(taskId, text);
      setNewSubtaskText("");
      await loadWeek();
    } catch { /* ignore */ }
  }

  async function handleToggleSubtask(id: number, done: boolean) {
    try {
      await apiToggleSubtask(id, done);
      await loadWeek();
    } catch { /* ignore */ }
  }

  async function handleDeleteSubtask(id: number) {
    try {
      await apiDeleteSubtask(id);
      await loadWeek();
    } catch { /* ignore */ }
  }

  async function handleAddRecurring() {
    const text = newRecText.trim();
    if (!text) return;
    const days = newRecType === "specific_days" ? newRecDays.join(",") : null;
    const interval = newRecType === "every_n_days" ? newRecInterval : null;
    const endDate = newRecEndDate || null;
    try {
      await apiAddRecurringTask(text, newRecType, days, interval, selectedDate, endDate);
      setNewRecText("");
      setNewRecType("daily");
      setNewRecDays([]);
      setNewRecInterval(2);
      setNewRecEndDate("");
      await loadRecurring();
      await loadWeek();
    } catch { /* ignore */ }
  }

  async function handleToggleRecActive(rt: RecurringTask) {
    try {
      await apiUpdateRecurringTask(rt.id, rt.text, rt.recurrence_type as RecurrenceType, rt.recurrence_days, rt.interval_days, rt.end_date, !rt.active);
      await loadRecurring();
      await loadWeek();
    } catch { /* ignore */ }
  }

  async function handleDeleteRecurring(id: number) {
    try {
      await apiDeleteRecurringTask(id, false);
      await loadRecurring();
      await loadWeek();
    } catch { /* ignore */ }
  }

  function toggleDowSelection(d: number) {
    setNewRecDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);
  }

  function recurrenceDescription(rt: RecurringTask): string {
    if (rt.recurrence_type === "specific_days" && rt.recurrence_days) {
      const labels = rt.recurrence_days.split(",").map((s) => DOW_LABELS[parseInt(s)] ?? s);
      return labels.join(", ");
    }
    if (rt.recurrence_type === "every_n_days" && rt.interval_days) {
      return `Every ${rt.interval_days} days`;
    }
    return RECURRENCE_LABELS[rt.recurrence_type as RecurrenceType] ?? rt.recurrence_type;
  }

  const rolloverTargets = weekDayDates(0, wsd).filter((d) => d.date !== selectedDate);
  const recurringStats = weekData?.recurring_stats ?? {};

  return (
    <section className="tab-panel">
      <div className="tasks-tab-header">
        <div>
          <h2 style={{ margin: 0 }}>Tasks</h2>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: "0.85rem" }}>
            {isToday ? "Today" : selectedDayLabel} — {doneCount}/{tasks.length} done
          </p>
        </div>
        <button
          className={showRecurring ? "chip chip-active" : "chip"}
          onClick={() => setShowRecurring(!showRecurring)}
          style={{ fontSize: "0.78rem" }}
        >
          ↻ Recurring
        </button>
      </div>

      {/* Week navigation */}
      <div className="tasks-week-nav">
        <button className="ghost daily-task-btn" onClick={() => setWeekOffset((o) => o - 1)} title="Previous week">
          ‹
        </button>
        <span className="tasks-week-label">
          {isCurrentWeek ? "This week" : weekRangeLabel(weekOffset, wsd)}
        </span>
        <button
          className="ghost daily-task-btn"
          onClick={() => setWeekOffset((o) => o + 1)}
          title="Next week"
          disabled={weekOffset >= 0}
        >
          ›
        </button>
        {!isCurrentWeek && (
          <button className="chip" style={{ fontSize: "0.72rem", marginLeft: 4 }} onClick={() => setWeekOffset(0)}>
            Today
          </button>
        )}
      </div>

      {/* Day picker chips */}
      <div className="tasks-day-picker">
        {allWeekDays.map((d) => (
          <button
            key={d.date}
            className={selectedDate === d.date ? "chip chip-active" : "chip"}
            onClick={() => { setSelectedDate(d.date); setRolloverTaskId(null); setEditingId(null); }}
          >
            {d.label}
            {d.date === isoToday ? " •" : ""}
          </button>
        ))}
      </div>

      {/* Add task form (only for current/future weeks) */}
      {!isPastWeek && (
        <form
          className="daily-tasks-add"
          onSubmit={(e) => { e.preventDefault(); void handleAdd(); }}
        >
          <input
            ref={inputRef}
            type="text"
            placeholder={`Add a task for ${isToday ? "today" : selectedDayLabel}...`}
            value={newTaskText}
            onChange={(e) => setNewTaskText(e.currentTarget.value)}
            className="daily-tasks-input"
          />
          <button type="submit" className="chip chip-active" disabled={!newTaskText.trim()}>
            Add
          </button>
        </form>
      )}

      {/* Task list */}
      {tasks.length > 0 ? (
        <ul className="daily-tasks-list">
          {tasks.map((task) => {
            const stat = task.recurring_task_id ? recurringStats[task.recurring_task_id] : null;
            const isExpanded = expandedTaskId === task.id;
            const subDone = task.subtasks.filter((s) => s.done).length;
            const subTotal = task.subtasks.length;
            return (
              <li key={task.id} className={`daily-task-item ${task.done ? "daily-task-done" : ""}`}>
                <div className="daily-task-row">
                  {editingId === task.id ? (
                    <form
                      className="daily-tasks-add"
                      style={{ flex: 1 }}
                      onSubmit={(e) => { e.preventDefault(); void handleSaveEdit(task.id); }}
                    >
                      <input
                        type="text"
                        className="daily-tasks-input"
                        value={editText}
                        onChange={(e) => setEditText(e.currentTarget.value)}
                        autoFocus
                        onBlur={() => { setEditingId(null); setEditText(""); }}
                        onKeyDown={(e) => { if (e.key === "Escape") { setEditingId(null); setEditText(""); } }}
                      />
                    </form>
                  ) : (
                    <label className="daily-task-label">
                      <input
                        type="checkbox"
                        checked={task.done}
                        onChange={() => void handleToggle(task.id, !task.done)}
                      />
                      <span
                        className={task.done ? "daily-task-text-done" : ""}
                        onDoubleClick={() => { if (!task.done && !isPastWeek) { setEditingId(task.id); setEditText(task.text); } }}
                      >
                        {task.recurring_task_id != null && <span className="recurring-badge" title="Recurring task">↻</span>}
                        {task.text}
                      </span>
                      {subTotal > 0 && (
                        <span className="subtask-count" title={`${subDone}/${subTotal} subtasks done`}>
                          {subDone}/{subTotal}
                        </span>
                      )}
                      {stat && (
                        <span className="recurring-stat-chip" title="Completions this week">
                          {stat.done}/{stat.total}
                        </span>
                      )}
                    </label>
                  )}
                  {!isPastWeek && (
                    <div className="daily-task-actions">
                      {editingId !== task.id && (
                        <button
                          className={`ghost daily-task-btn ${isExpanded ? "daily-task-btn-active" : ""}`}
                          title="Subtasks"
                          onClick={() => {
                            setExpandedTaskId(isExpanded ? null : task.id);
                            setNewSubtaskText("");
                          }}
                        >
                          ⋯
                        </button>
                      )}
                      {!task.done && editingId !== task.id && (
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
                              {rolloverTargets.map((d) => (
                                <button
                                  key={d.date}
                                  className="daily-task-rollover-option"
                                  onClick={() => void handleRollover(task.id, d.date)}
                                >
                                  {d.label}{d.date === isoToday ? " (today)" : ""}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {editingId !== task.id && (
                        <button
                          className="ghost daily-task-btn"
                          title="Delete task"
                          onClick={() => void handleDelete(task.id)}
                        >
                          &times;
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {isExpanded && (
                  <div className="subtask-panel">
                    {task.subtasks.map((sub) => (
                      <div key={sub.id} className={`subtask-item ${sub.done ? "subtask-done" : ""}`}>
                        <label className="subtask-label">
                          <input
                            type="checkbox"
                            checked={sub.done}
                            onChange={() => void handleToggleSubtask(sub.id, !sub.done)}
                          />
                          <span className={sub.done ? "daily-task-text-done" : ""}>{sub.text}</span>
                        </label>
                        <button
                          className="ghost subtask-delete"
                          title="Remove subtask"
                          onClick={() => void handleDeleteSubtask(sub.id)}
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                    <form
                      className="subtask-add"
                      onSubmit={(e) => { e.preventDefault(); void handleAddSubtask(task.id); }}
                    >
                      <input
                        type="text"
                        placeholder="Add subtask..."
                        value={newSubtaskText}
                        onChange={(e) => setNewSubtaskText(e.currentTarget.value)}
                        className="subtask-input"
                        autoFocus
                      />
                      <button type="submit" className="chip chip-active chip-sm" disabled={!newSubtaskText.trim()}>
                        Add
                      </button>
                    </form>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted" style={{ fontSize: "0.85rem", margin: "8px 0 0" }}>
          No tasks for {isToday ? "today" : selectedDayLabel} yet.
        </p>
      )}

      {/* Recurring task manager */}
      {showRecurring && (
        <div className="recurring-manager">
          <h3 style={{ margin: "0 0 6px" }}>Recurring Tasks</h3>

          {recurringTasks.length > 0 && (
            <ul className="recurring-list">
              {recurringTasks.map((rt) => (
                <li key={rt.id} className={`recurring-item ${rt.active ? "" : "recurring-inactive"}`}>
                  {editRecId === rt.id ? (
                    <RecurringEditForm
                      initial={rt}
                      onSave={async (updated) => {
                        await apiUpdateRecurringTask(
                          rt.id, updated.text, updated.recurrence_type,
                          updated.recurrence_days, updated.interval_days,
                          updated.end_date, updated.active,
                        );
                        setEditRecId(null);
                        await loadRecurring();
                        await loadWeek();
                      }}
                      onCancel={() => setEditRecId(null)}
                    />
                  ) : (
                    <>
                      <div className="recurring-item-info">
                        <span className="recurring-item-text">{rt.text}</span>
                        <span className="muted" style={{ fontSize: "0.75rem" }}>
                          {recurrenceDescription(rt)}
                        </span>
                      </div>
                      <div className="recurring-item-actions">
                        <button className="ghost daily-task-btn" title="Edit" onClick={() => setEditRecId(rt.id)}>✎</button>
                        <button
                          className="ghost daily-task-btn"
                          title={rt.active ? "Pause" : "Resume"}
                          onClick={() => void handleToggleRecActive(rt)}
                        >
                          {rt.active ? "⏸" : "▶"}
                        </button>
                        <button className="ghost daily-task-btn" title="Delete" onClick={() => void handleDeleteRecurring(rt.id)}>×</button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="recurring-add-form">
            <input
              type="text"
              className="daily-tasks-input"
              placeholder="New recurring task..."
              value={newRecText}
              onChange={(e) => setNewRecText(e.currentTarget.value)}
            />
            <select
              className="recurring-select"
              value={newRecType}
              onChange={(e) => setNewRecType(e.currentTarget.value as RecurrenceType)}
            >
              {Object.entries(RECURRENCE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            {newRecType === "specific_days" && (
              <div className="recurring-day-picker">
                {DOW_LABELS.map((label, i) => (
                  <button
                    key={i}
                    className={newRecDays.includes(i) ? "chip chip-active" : "chip"}
                    style={{ padding: "2px 6px", fontSize: "0.72rem" }}
                    onClick={() => toggleDowSelection(i)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {newRecType === "every_n_days" && (
              <div className="recurring-interval-input">
                <label className="muted" style={{ fontSize: "0.78rem" }}>Every</label>
                <input
                  type="number"
                  min={2}
                  max={365}
                  value={newRecInterval}
                  onChange={(e) => setNewRecInterval(parseInt(e.currentTarget.value) || 2)}
                  className="daily-tasks-input"
                  style={{ width: 50 }}
                />
                <label className="muted" style={{ fontSize: "0.78rem" }}>days</label>
              </div>
            )}
            <div className="recurring-end-row">
              <label className="muted" style={{ fontSize: "0.78rem" }}>End date (optional):</label>
              <input
                type="date"
                className="daily-tasks-input"
                value={newRecEndDate}
                onChange={(e) => setNewRecEndDate(e.currentTarget.value)}
                style={{ width: 140 }}
              />
            </div>
            <button
              className="chip chip-active"
              disabled={!newRecText.trim()}
              onClick={() => void handleAddRecurring()}
            >
              Add recurring
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function RecurringEditForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: RecurringTask;
  onSave: (updated: { text: string; recurrence_type: RecurrenceType; recurrence_days: string | null; interval_days: number | null; end_date: string | null; active: boolean }) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial.text);
  const [recType, setRecType] = useState<RecurrenceType>(initial.recurrence_type as RecurrenceType);
  const [days, setDays] = useState<number[]>(
    initial.recurrence_days ? initial.recurrence_days.split(",").map(Number) : [],
  );
  const [interval, setInterval] = useState(initial.interval_days ?? 2);
  const [endDate, setEndDate] = useState(initial.end_date ?? "");
  const [active, setActive] = useState(initial.active);

  return (
    <div className="recurring-add-form" style={{ flex: 1 }}>
      <input type="text" className="daily-tasks-input" value={text} onChange={(e) => setText(e.currentTarget.value)} />
      <select className="recurring-select" value={recType} onChange={(e) => setRecType(e.currentTarget.value as RecurrenceType)}>
        {Object.entries(RECURRENCE_LABELS).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
      {recType === "specific_days" && (
        <div className="recurring-day-picker">
          {DOW_LABELS.map((label, i) => (
            <button
              key={i}
              className={days.includes(i) ? "chip chip-active" : "chip"}
              style={{ padding: "2px 6px", fontSize: "0.72rem" }}
              onClick={() => setDays((prev) => prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i])}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {recType === "every_n_days" && (
        <div className="recurring-interval-input">
          <label className="muted" style={{ fontSize: "0.78rem" }}>Every</label>
          <input type="number" min={2} max={365} value={interval} onChange={(e) => setInterval(parseInt(e.currentTarget.value) || 2)} className="daily-tasks-input" style={{ width: 50 }} />
          <label className="muted" style={{ fontSize: "0.78rem" }}>days</label>
        </div>
      )}
      <div className="recurring-end-row">
        <label className="muted" style={{ fontSize: "0.78rem" }}>End date:</label>
        <input type="date" className="daily-tasks-input" value={endDate} onChange={(e) => setEndDate(e.currentTarget.value)} style={{ width: 140 }} />
      </div>
      <label className="daily-task-label" style={{ gap: 4, fontSize: "0.82rem" }}>
        <input type="checkbox" checked={active} onChange={() => setActive(!active)} />
        Active
      </label>
      <div className="row" style={{ gap: 4 }}>
        <button className="chip chip-active" disabled={!text.trim()} onClick={() => void onSave({
          text, recurrence_type: recType,
          recurrence_days: recType === "specific_days" ? days.join(",") : null,
          interval_days: recType === "every_n_days" ? interval : null,
          end_date: endDate || null, active,
        })}>Save</button>
        <button className="chip" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
