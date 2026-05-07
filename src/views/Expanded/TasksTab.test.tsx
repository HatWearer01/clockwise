import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import TasksTab from "./TasksTab";
import type { WeekTasksResponse } from "../../types";
import { todayISODate } from "../../lib/time";

const mockInvoke = vi.mocked(invoke);

function makeWeekResponse(tasks: WeekTasksResponse["days"] = {}): WeekTasksResponse {
  return { days: tasks, recurring_stats: {} };
}

const isoToday = todayISODate();

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "get_tasks_for_week") return Promise.resolve(makeWeekResponse());
    if (cmd === "get_recurring_tasks") return Promise.resolve([]);
    return Promise.resolve(undefined);
  });
});

describe("TasksTab", () => {
  it("shows day picker with all days of the week", () => {
    render(<TasksTab />);
    expect(screen.getByText(/Mon/)).toBeInTheDocument();
    expect(screen.getByText(/Tue/)).toBeInTheDocument();
    expect(screen.getByText(/Wed/)).toBeInTheDocument();
    expect(screen.getByText(/Thu/)).toBeInTheDocument();
    expect(screen.getByText(/Fri/)).toBeInTheDocument();
    expect(screen.getByText(/Sat/)).toBeInTheDocument();
    expect(screen.getByText(/Sun/)).toBeInTheDocument();
  });

  it("shows empty state when no tasks", async () => {
    render(<TasksTab />);
    await waitFor(() => {
      expect(screen.getByText(/No tasks for/)).toBeInTheDocument();
    });
  });

  it("shows the add task input and button", () => {
    render(<TasksTab />);
    expect(screen.getByPlaceholderText(/Add a task/)).toBeInTheDocument();
    expect(screen.getByText("Add")).toBeInTheDocument();
  });

  it("add button is disabled when input is empty", () => {
    render(<TasksTab />);
    const addBtn = screen.getByText("Add");
    expect(addBtn).toBeDisabled();
  });

  it("renders tasks returned by the API", async () => {
    const weekData = makeWeekResponse({
      [isoToday]: [
        { id: 1, date: isoToday, text: "Write tests", done: false, done_at: null, created_at: 1000, position: 0, recurring_task_id: null, subtasks: [] },
        { id: 2, date: isoToday, text: "Review PR", done: true, done_at: 2000, created_at: 1001, position: 1, recurring_task_id: null, subtasks: [] },
      ],
    });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_tasks_for_week") return Promise.resolve(weekData);
      if (cmd === "get_recurring_tasks") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    render(<TasksTab />);

    await waitFor(() => {
      expect(screen.getByText("Write tests")).toBeInTheDocument();
    });
    expect(screen.getByText("Review PR")).toBeInTheDocument();
    expect(screen.getByText(/1\/2 done/)).toBeInTheDocument();
  });

  it("calls invoke to add a task on form submit", async () => {
    render(<TasksTab />);

    const input = screen.getByPlaceholderText(/Add a task/);
    fireEvent.change(input, { target: { value: "New task" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("add_daily_task", expect.objectContaining({ text: "New task" }));
    });
  });

  it("calls invoke to toggle a task when checkbox clicked", async () => {
    const weekData = makeWeekResponse({
      [isoToday]: [
        { id: 1, date: isoToday, text: "Toggle me", done: false, done_at: null, created_at: 1000, position: 0, recurring_task_id: null, subtasks: [] },
      ],
    });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_tasks_for_week") return Promise.resolve(weekData);
      if (cmd === "get_recurring_tasks") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    render(<TasksTab />);

    await waitFor(() => {
      expect(screen.getByText("Toggle me")).toBeInTheDocument();
    });

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("toggle_daily_task", { id: 1, done: true });
    });
  });

  it("shows delete button and deletes", async () => {
    const weekData = makeWeekResponse({
      [isoToday]: [
        { id: 5, date: isoToday, text: "Delete me", done: false, done_at: null, created_at: 1000, position: 0, recurring_task_id: null, subtasks: [] },
      ],
    });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_tasks_for_week") return Promise.resolve(weekData);
      if (cmd === "get_recurring_tasks") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    render(<TasksTab />);

    await waitFor(() => {
      expect(screen.getByText("Delete me")).toBeInTheDocument();
    });

    const deleteBtn = screen.getByTitle("Delete task");
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("delete_daily_task", { id: 5 });
    });
  });

  it("shows rollover button for incomplete tasks", async () => {
    const weekData = makeWeekResponse({
      [isoToday]: [
        { id: 3, date: isoToday, text: "Rollover task", done: false, done_at: null, created_at: 1000, position: 0, recurring_task_id: null, subtasks: [] },
      ],
    });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_tasks_for_week") return Promise.resolve(weekData);
      if (cmd === "get_recurring_tasks") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    render(<TasksTab />);

    await waitFor(() => {
      expect(screen.getByText("Rollover task")).toBeInTheDocument();
    });

    expect(screen.getByTitle("Move to another day")).toBeInTheDocument();
  });

  it("does not show rollover button for completed tasks", async () => {
    const weekData = makeWeekResponse({
      [isoToday]: [
        { id: 3, date: isoToday, text: "Done task", done: true, done_at: 2000, created_at: 1000, position: 0, recurring_task_id: null, subtasks: [] },
      ],
    });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_tasks_for_week") return Promise.resolve(weekData);
      if (cmd === "get_recurring_tasks") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    render(<TasksTab />);

    await waitFor(() => {
      expect(screen.getByText("Done task")).toBeInTheDocument();
    });

    expect(screen.queryByTitle("Move to another day")).not.toBeInTheDocument();
  });

  it("header shows Tasks title", () => {
    render(<TasksTab />);
    expect(screen.getByText("Tasks")).toBeInTheDocument();
  });

  it("shows week navigation controls", () => {
    render(<TasksTab />);
    expect(screen.getByText("This week")).toBeInTheDocument();
    expect(screen.getByTitle("Previous week")).toBeInTheDocument();
  });

  it("shows recurring button", () => {
    render(<TasksTab />);
    expect(screen.getByText(/Recurring/)).toBeInTheDocument();
  });

  it("shows recurring badge on tasks with recurring_task_id", async () => {
    const weekData: WeekTasksResponse = {
      days: {
        [isoToday]: [
          { id: 1, date: isoToday, text: "Standup", done: false, done_at: null, created_at: 1000, position: 0, recurring_task_id: 10, subtasks: [] },
        ],
      },
      recurring_stats: { 10: { total: 3, done: 2 } },
    };
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_tasks_for_week") return Promise.resolve(weekData);
      if (cmd === "get_recurring_tasks") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    render(<TasksTab />);

    await waitFor(() => {
      expect(screen.getByText("Standup")).toBeInTheDocument();
    });

    expect(screen.getByTitle("Recurring task")).toBeInTheDocument();
    expect(screen.getByTitle("Completions this week")).toHaveTextContent("2/3");
  });

  it("opens recurring manager on button click", async () => {
    render(<TasksTab />);
    fireEvent.click(screen.getByText(/Recurring/));
    await waitFor(() => {
      expect(screen.getByText("Recurring Tasks")).toBeInTheDocument();
    });
  });
});
