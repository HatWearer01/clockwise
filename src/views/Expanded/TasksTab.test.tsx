import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import TasksTab from "./TasksTab";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue([] as never);
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
    const tasks = [
      { id: 1, date: "2026-05-04", text: "Write tests", done: false, done_at: null, created_at: 1000, position: 0 },
      { id: 2, date: "2026-05-04", text: "Review PR", done: true, done_at: 2000, created_at: 1001, position: 1 },
    ];
    mockInvoke.mockResolvedValue(tasks as never);

    render(<TasksTab />);

    await waitFor(() => {
      expect(screen.getByText("Write tests")).toBeInTheDocument();
    });
    expect(screen.getByText("Review PR")).toBeInTheDocument();
    expect(screen.getByText(/1\/2 done/)).toBeInTheDocument();
  });

  it("calls invoke to add a task on form submit", async () => {
    mockInvoke.mockResolvedValue([] as never);
    render(<TasksTab />);

    const input = screen.getByPlaceholderText(/Add a task/);
    fireEvent.change(input, { target: { value: "New task" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("add_daily_task", expect.objectContaining({ text: "New task" }));
    });
  });

  it("calls invoke to toggle a task when checkbox clicked", async () => {
    const tasks = [
      { id: 1, date: "2026-05-04", text: "Toggle me", done: false, done_at: null, created_at: 1000, position: 0 },
    ];
    mockInvoke.mockResolvedValue(tasks as never);

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

  it("shows delete button on hover and deletes", async () => {
    const tasks = [
      { id: 5, date: "2026-05-04", text: "Delete me", done: false, done_at: null, created_at: 1000, position: 0 },
    ];
    mockInvoke.mockResolvedValue(tasks as never);

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
    const tasks = [
      { id: 3, date: "2026-05-04", text: "Rollover task", done: false, done_at: null, created_at: 1000, position: 0 },
    ];
    mockInvoke.mockResolvedValue(tasks as never);

    render(<TasksTab />);

    await waitFor(() => {
      expect(screen.getByText("Rollover task")).toBeInTheDocument();
    });

    expect(screen.getByTitle("Move to another day")).toBeInTheDocument();
  });

  it("does not show rollover button for completed tasks", async () => {
    const tasks = [
      { id: 3, date: "2026-05-04", text: "Done task", done: true, done_at: 2000, created_at: 1000, position: 0 },
    ];
    mockInvoke.mockResolvedValue(tasks as never);

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
});
