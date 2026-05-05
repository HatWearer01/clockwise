import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import Compact from "./Compact";
import { useTimerStore } from "../store/timer";
import { useScheduleStore } from "../store/schedule";
import { useSettingsStore } from "../store/settings";

vi.mock("framer-motion", () => ({
  motion: {
    section: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => <section {...props}>{children}</section>,
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => <div {...props}>{children}</div>,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ mode: "compact" });
  useScheduleStore.setState({
    blocks: [
      { id: 1, template_id: 1, day_of_week: new Date().getDay(), start_min: 540, end_min: 1020, label: "Work", color: "#34D399" },
    ],
  });
});

describe("Compact view", () => {
  it("shows loading when status is null", () => {
    useTimerStore.setState({ status: null });
    render(<Compact />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows ready message when not clocked in", () => {
    useTimerStore.setState({
      status: {
        active_session: null,
        worked_today_ms: 0,
        break_today_ms: 0,
        state: "before_shift",
        next_boundary_ms: null,
        paused: false,
        week_done: false,
        day_done: false,
      overnight_session: false,
      },
      nowMs: Date.now(),
    });

    render(<Compact />);
    expect(screen.getByText("Ready when you are")).toBeInTheDocument();
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
        day_done: false,
      overnight_session: false,
      },
      nowMs: Date.now(),
    });

    render(<Compact />);
    expect(screen.getByText("Clock in")).toBeInTheDocument();
  });

  it("shows Clock out and Break buttons when active", () => {
    useTimerStore.setState({
      status: {
        active_session: { id: 1, started_at: Date.now() - 3_600_000, ended_at: null },
        worked_today_ms: 3_600_000,
        break_today_ms: 0,
        state: "on_clock",
        next_boundary_ms: null,
        paused: false,
        week_done: false,
        day_done: false,
      overnight_session: false,
      },
      nowMs: Date.now(),
    });

    render(<Compact />);
    expect(screen.getByText("Clock out")).toBeInTheDocument();
    expect(screen.getByText("Break")).toBeInTheDocument();
  });

  it("shows Resume button when paused", () => {
    useTimerStore.setState({
      status: {
        active_session: { id: 1, started_at: Date.now() - 3_600_000, ended_at: null },
        worked_today_ms: 3_600_000,
        break_today_ms: 0,
        state: "on_break",
        next_boundary_ms: null,
        paused: true,
        week_done: false,
        day_done: false,
      overnight_session: false,
      },
      nowMs: Date.now(),
    });

    render(<Compact />);
    expect(screen.getByText("Resume")).toBeInTheDocument();
  });

  it("shows progress percentage", () => {
    useTimerStore.setState({
      status: {
        active_session: { id: 1, started_at: Date.now() - 3_600_000, ended_at: null },
        worked_today_ms: 14_400_000,
        break_today_ms: 0,
        state: "on_clock",
        next_boundary_ms: null,
        paused: false,
        week_done: false,
        day_done: false,
      overnight_session: false,
      },
      statusFetchedAt: Date.now(),
      nowMs: Date.now(),
    });

    render(<Compact />);
    expect(screen.getByText(/\d+%/)).toBeInTheDocument();
  });
});
