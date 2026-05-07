import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import WeekTab from "./WeekTab";
import type { WeeklyReview } from "../../types";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
});

const mockWeekSummary = [
  { day_of_week: 1, label: "Mon", planned_ms: 28_800_000, actual_ms: 25_200_000, target_ms: 0, shift_coverage_ms: 0 },
  { day_of_week: 2, label: "Tue", planned_ms: 28_800_000, actual_ms: 28_800_000, target_ms: 0, shift_coverage_ms: 0 },
  { day_of_week: 3, label: "Wed", planned_ms: 28_800_000, actual_ms: 14_400_000, target_ms: 0, shift_coverage_ms: 0 },
  { day_of_week: 4, label: "Thu", planned_ms: 28_800_000, actual_ms: 0, target_ms: 0, shift_coverage_ms: 0 },
  { day_of_week: 5, label: "Fri", planned_ms: 28_800_000, actual_ms: 0, target_ms: 0, shift_coverage_ms: 0 },
  { day_of_week: 6, label: "Sat", planned_ms: 0, actual_ms: 0, target_ms: 0, shift_coverage_ms: 0 },
  { day_of_week: 0, label: "Sun", planned_ms: 0, actual_ms: 0, target_ms: 0, shift_coverage_ms: 0 },
];

const mockStats = {
  week_points: [
    { week_label: "04/07", worked_ms: 100_000_000, week_start_date: "2026-04-06" },
    { week_label: "04/14", worked_ms: 120_000_000, week_start_date: "2026-04-13" },
    { week_label: "04/21", worked_ms: 90_000_000, week_start_date: "2026-04-20" },
    { week_label: "04/28", worked_ms: 110_000_000, week_start_date: "2026-04-27" },
  ],
  avg_start_minute: 540,
  avg_end_minute: 1020,
  month_total_ms: 400_000_000,
};

const mockWeeklyReview: WeeklyReview = {
  week_label: "04/28 – 05/04",
  days_worked: 4,
  days_scheduled: 5,
  total_target_ms: 144_000_000,
  total_actual_ms: 140_000_000,
  avg_start_minute: 540,
  avg_end_minute: 1020,
  on_time_days: 3,
  off_schedule_sessions: 0,
  day_details: [
    { label: "Mon", target_ms: 28_800_000, actual_ms: 28_800_000, on_time: true },
  ],
  insights: [],
};

function setupMocks() {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "get_week_summary") return Promise.resolve(mockWeekSummary);
    if (cmd === "get_stats_summary") return Promise.resolve(mockStats);
    if (cmd === "is_week_done") return Promise.resolve(false);
    if (cmd === "get_weekly_review") return Promise.resolve(mockWeeklyReview);
    if (cmd === "get_tasks_for_week") return Promise.resolve({ days: {} });
    return Promise.resolve(undefined);
  });
}

describe("WeekTab", () => {
  it("shows loading state initially", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}) as never);
    render(<WeekTab />);
    expect(screen.getByText("Loading week...")).toBeInTheDocument();
  });

  it("renders current week view with data", async () => {
    setupMocks();
    render(<WeekTab />);

    await waitFor(() => {
      expect(screen.getByText("This Week")).toBeInTheDocument();
    });

    expect(screen.getByText("Shift coverage")).toBeInTheDocument();
    expect(screen.getByText(/Days present/)).toBeInTheDocument();
  });

  it("shows day labels", async () => {
    setupMocks();
    render(<WeekTab />);

    await waitFor(() => {
      expect(screen.getByText("Mon")).toBeInTheDocument();
    });
    expect(screen.getByText("Tue")).toBeInTheDocument();
    expect(screen.getByText("Wed")).toBeInTheDocument();
  });

  it("switches to history view", async () => {
    setupMocks();
    render(<WeekTab />);

    await waitFor(() => {
      expect(screen.getByText("This Week")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("History"));

    expect(screen.getByText("Past Weeks")).toBeInTheDocument();
    expect(screen.getByText("This month")).toBeInTheDocument();
  });

  it("shows error on API failure", async () => {
    mockInvoke.mockRejectedValueOnce({ message: "DB error" });

    render(<WeekTab />);

    await waitFor(() => {
      expect(screen.getByText("DB error")).toBeInTheDocument();
    });
  });

  it("shows week navigation controls", async () => {
    setupMocks();
    render(<WeekTab />);

    await waitFor(() => {
      expect(screen.getByText("This Week")).toBeInTheDocument();
    });

    expect(screen.getByTitle("Previous week")).toBeInTheDocument();
    expect(screen.getByText("Current week")).toBeInTheDocument();
  });

  it("history bars are clickable with tooltips", async () => {
    setupMocks();
    render(<WeekTab />);

    await waitFor(() => {
      expect(screen.getByText("This Week")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("History"));

    await waitFor(() => {
      expect(screen.getByText("Past Weeks")).toBeInTheDocument();
    });

    expect(screen.getByTitle("View week of 2026-04-06")).toBeInTheDocument();
    expect(screen.getByTitle("View week of 2026-04-27")).toBeInTheDocument();
  });
});
