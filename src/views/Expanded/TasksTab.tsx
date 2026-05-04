import { useCallback, useEffect, useRef, useState } from "react";
import {
  apiAddDailyTask,
  apiDeleteDailyTask,
  apiGetDailyTasks,
  apiRolloverDailyTask,
  apiToggleDailyTask,
  apiUpdateDailyTask,
} from "../../lib/tauri";
import { todayISODate, weekDayDates } from "../../lib/time";
import type { DailyTask } from "../../types";

export default function TasksTab() {
  const allWeekDays = weekDayDates();
  const isoToday = todayISODate();
  const [selectedDate, setSelectedDate] = useState(isoToday);
  const [tasks, setTasks] = useState<DailyTask[]>([]);
  const [newTaskText, setNewTaskText] = useState("");
  const [rolloverTaskId, setRolloverTaskId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const loadTasks = useCallback(async () => {
    try {
      const fetched = await apiGetDailyTasks(selectedDate);
      setTasks(fetched ?? []);
    } catch { /* ignore */ }
  }, [selectedDate]);

  useEffect(() => { void loadTasks(); }, [loadTasks]);

  async function handleAdd() {
    const text = newTaskText.trim();
    if (!text) return;
    try {
      await apiAddDailyTask(selectedDate, text);
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

  async function handleSaveEdit(id: number) {
    const text = editText.trim();
    if (!text) return;
    try {
      await apiUpdateDailyTask(id, text);
      setEditingId(null);
      setEditText("");
      await loadTasks();
    } catch { /* ignore */ }
  }

  const rolloverTargets = allWeekDays.filter((d) => d.date !== selectedDate);
  const isToday = selectedDate === isoToday;
  const selectedDayLabel = allWeekDays.find((d) => d.date === selectedDate)?.label ?? selectedDate;
  const doneCount = tasks.filter((t) => t.done).length;

  return (
    <section className="tab-panel">
      <div className="tasks-tab-header">
        <div>
          <h2 style={{ margin: 0 }}>Tasks</h2>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: "0.85rem" }}>
            {isToday ? "Today" : selectedDayLabel} — {doneCount}/{tasks.length} done
          </p>
        </div>
      </div>

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

      {tasks.length > 0 ? (
        <ul className="daily-tasks-list">
          {tasks.map((task) => (
            <li key={task.id} className={`daily-task-item ${task.done ? "daily-task-done" : ""}`}>
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
                    onDoubleClick={() => { if (!task.done) { setEditingId(task.id); setEditText(task.text); } }}
                  >
                    {task.text}
                  </span>
                </label>
              )}
              <div className="daily-task-actions">
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
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted" style={{ fontSize: "0.85rem", margin: "8px 0 0" }}>
          No tasks for {isToday ? "today" : selectedDayLabel} yet.
        </p>
      )}
    </section>
  );
}
