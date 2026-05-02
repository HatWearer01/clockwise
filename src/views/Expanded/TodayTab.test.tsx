import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import TodayTab from "./TodayTab";
import { useTimerStore } from "../../store/timer";
import { useScheduleStore } from "../../store/schedule";

beforeEach(() => {
  vi.clearAllMocks();
  useScheduleStore.setState({
    blocks: [
      { id: 1, template_id: 1, day_of_week: new Date().getDay(), start_min: 540, end_min: 1020, label: "Work", color: "#34D399" },
    ],
  });
});

describe("TodayTab", () => {
  it("shows loading when status is null", () => {
    useTimerStore.setState({ status: null });
    render(<TodayTab />);
    expect(screen.getByText("Loading today...")).toBeInTheDocument();
  });

  it("shows today's date", () => {
    useTimerStore.setState({
      status: {
        active_session: null,
        worked_today_ms: 0,
        break_today_ms: 0,
        state: "before_shift",
        next_boundary_ms: null,
        paused: false,
        week_done: false,
      },
      nowMs: Date.now(),
    });

    render(<TodayTab />);
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const today = days[new Date().getDay()];
    expect(screen.getByText(new RegExp(today))).toBeInTheDocument();
  });

  it("shows No shift today when no blocks", () => {
    useScheduleStore.setState({ blocks: [] });
    useTimerStore.setState({
      status: {
        active_session: null,
        worked_today_ms: 0,
        break_today_ms: 0,
        state: "off_day",
        next_boundary_ms: null,
        paused: false,
        week_done: false,
      },
      nowMs: Date.now(),
    });

    render(<TodayTab />);
    expect(screen.getByText("No shift today")).toBeInTheDocument();
  });

  it("shows current session info when clocked in", () => {
    const started = Date.now() - 3_600_000;
    useTimerStore.setState({
      status: {
        active_session: { id: 1, started_at: started, ended_at: null },
        worked_today_ms: 3_600_000,
        break_today_ms: 0,
        state: "on_clock",
        next_boundary_ms: null,
        paused: false,
        week_done: false,
      },
      statusFetchedAt: Date.now(),
      nowMs: Date.now(),
    });

    render(<TodayTab />);
    expect(screen.getByText("Current session")).toBeInTheDocument();
    expect(screen.getByText("Worked today")).toBeInTheDocument();
  });

  it("shows Clock in button when not active", () => {
    useTimerStore.setState({
      status: {
        active_session: null,
        worked_today_ms: 0,
        break_today_ms: 0,
        state: "in_shift",
        next_boundary_ms: null,
        paused: false,
        week_done: false,
      },
      nowMs: Date.now(),
    });

    render(<TodayTab />);
    expect(screen.getByText("Clock in")).toBeInTheDocument();
  });

  it("shows Take a break button when clocked in", () => {
    useTimerStore.setState({
      status: {
        active_session: { id: 1, started_at: Date.now() - 1000, ended_at: null },
        worked_today_ms: 1000,
        break_today_ms: 0,
        state: "on_clock",
        next_boundary_ms: null,
        paused: false,
        week_done: false,
      },
      nowMs: Date.now(),
    });

    render(<TodayTab />);
    expect(screen.getByText("Take a break")).toBeInTheDocument();
  });
});
