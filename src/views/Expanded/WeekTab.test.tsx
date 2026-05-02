import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import WeekTab from "./WeekTab";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
});

const mockWeekSummary = [
  { day_of_week: 1, label: "Mon", planned_ms: 28_800_000, actual_ms: 25_200_000 },
  { day_of_week: 2, label: "Tue", planned_ms: 28_800_000, actual_ms: 28_800_000 },
  { day_of_week: 3, label: "Wed", planned_ms: 28_800_000, actual_ms: 14_400_000 },
  { day_of_week: 4, label: "Thu", planned_ms: 28_800_000, actual_ms: 0 },
  { day_of_week: 5, label: "Fri", planned_ms: 28_800_000, actual_ms: 0 },
  { day_of_week: 6, label: "Sat", planned_ms: 0, actual_ms: 0 },
  { day_of_week: 0, label: "Sun", planned_ms: 0, actual_ms: 0 },
];

const mockStats = {
  week_points: [
    { week_label: "04/07", worked_ms: 100_000_000 },
    { week_label: "04/14", worked_ms: 120_000_000 },
    { week_label: "04/21", worked_ms: 90_000_000 },
    { week_label: "04/28", worked_ms: 110_000_000 },
  ],
  avg_start_minute: 540,
  avg_end_minute: 1020,
  month_total_ms: 400_000_000,
};

describe("WeekTab", () => {
  it("shows loading state initially", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}) as never);
    render(<WeekTab />);
    expect(screen.getByText("Loading week...")).toBeInTheDocument();
  });

  it("renders current week view with data", async () => {
    mockInvoke
      .mockResolvedValueOnce(mockWeekSummary)
      .mockResolvedValueOnce(mockStats)
      .mockResolvedValueOnce(false);

    render(<WeekTab />);

    await waitFor(() => {
      expect(screen.getByText("This Week")).toBeInTheDocument();
    });

    expect(screen.getByText("Hours logged")).toBeInTheDocument();
    expect(screen.getByText(/Days worked/)).toBeInTheDocument();
  });

  it("shows day labels", async () => {
    mockInvoke
      .mockResolvedValueOnce(mockWeekSummary)
      .mockResolvedValueOnce(mockStats)
      .mockResolvedValueOnce(false);

    render(<WeekTab />);

    await waitFor(() => {
      expect(screen.getByText("Mon")).toBeInTheDocument();
    });
    expect(screen.getByText("Tue")).toBeInTheDocument();
    expect(screen.getByText("Wed")).toBeInTheDocument();
  });

  it("switches to history view", async () => {
    mockInvoke
      .mockResolvedValueOnce(mockWeekSummary)
      .mockResolvedValueOnce(mockStats)
      .mockResolvedValueOnce(false);

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
});
