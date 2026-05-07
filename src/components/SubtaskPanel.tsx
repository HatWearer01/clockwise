import { useState } from "react";
import { apiAddSubtask, apiToggleSubtask, apiDeleteSubtask } from "../lib/tauri";
import type { Subtask } from "../types";

interface SubtaskPanelProps {
  taskId: number;
  subtasks: Subtask[];
  onChanged: () => void;
}

export default function SubtaskPanel({ taskId, subtasks, onChanged }: SubtaskPanelProps) {
  const [text, setText] = useState("");

  async function handleAdd() {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      await apiAddSubtask(taskId, trimmed);
      setText("");
      onChanged();
    } catch { /* ignore */ }
  }

  async function handleToggle(id: number, done: boolean) {
    try {
      await apiToggleSubtask(id, done);
      onChanged();
    } catch { /* ignore */ }
  }

  async function handleDelete(id: number) {
    try {
      await apiDeleteSubtask(id);
      onChanged();
    } catch { /* ignore */ }
  }

  return (
    <div className="subtask-panel">
      {subtasks.map((sub) => (
        <div key={sub.id} className={`subtask-item ${sub.done ? "subtask-done" : ""}`}>
          <label className="subtask-label">
            <input
              type="checkbox"
              checked={sub.done}
              onChange={() => void handleToggle(sub.id, !sub.done)}
            />
            <span className={sub.done ? "daily-task-text-done" : ""}>{sub.text}</span>
          </label>
          <button
            className="ghost subtask-delete"
            title="Remove subtask"
            onClick={() => void handleDelete(sub.id)}
          >
            &times;
          </button>
        </div>
      ))}
      <form
        className="subtask-add"
        onSubmit={(e) => { e.preventDefault(); void handleAdd(); }}
      >
        <input
          type="text"
          placeholder="Add subtask..."
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          className="subtask-input"
          autoFocus
        />
        <button type="submit" className="chip chip-active chip-sm" disabled={!text.trim()}>
          Add
        </button>
      </form>
    </div>
  );
}
