import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ScheduleTab from "./ScheduleTab";
import { useScheduleStore } from "../../store/schedule";
import { useTimerStore } from "../../store/timer";

beforeEach(() => {
  vi.clearAllMocks();
  useScheduleStore.setState({
    activeTemplateId: 1,
    blocks: [
      { id: 1, template_id: 1, day_of_week: 1, start_min: 540, end_min: 1020, label: "Work", color: "#34D399" },
      { id: 2, template_id: 1, day_of_week: 2, start_min: 540, end_min: 1020, label: "Work", color: "#34D399" },
      { id: 3, template_id: 1, day_of_week: 3, start_min: 540, end_min: 1020, label: "Work", color: "#34D399" },
      { id: 4, template_id: 1, day_of_week: 4, start_min: 540, end_min: 1020, label: "Work", color: "#34D399" },
      { id: 5, template_id: 1, day_of_week: 5, start_min: 540, end_min: 1020, label: "Work", color: "#34D399" },
    ],
    checklistItems: [],
    dayTargets: [],
    saving: false,
    error: null,
  });
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
      target_today_ms: 0,
      off_schedule: false,
      shift_coverage_ms: 0,
    },
  });
});

describe("ScheduleTab", () => {
  it("renders all 7 days", () => {
    render(<ScheduleTab />);
    expect(screen.getByText("Monday")).toBeInTheDocument();
    expect(screen.getByText("Tuesday")).toBeInTheDocument();
    expect(screen.getByText("Wednesday")).toBeInTheDocument();
    expect(screen.getByText("Thursday")).toBeInTheDocument();
    expect(screen.getByText("Friday")).toBeInTheDocument();
    expect(screen.getByText("Saturday")).toBeInTheDocument();
    expect(screen.getByText("Sunday")).toBeInTheDocument();
  });

  it("shows On for active days and Off for inactive", () => {
    render(<ScheduleTab />);
    const onButtons = screen.getAllByText("On");
    const offButtons = screen.getAllByText("Off");
    expect(onButtons).toHaveLength(5); // Mon-Fri
    expect(offButtons).toHaveLength(2); // Sat, Sun
  });

  it("shows weekly total", () => {
    render(<ScheduleTab />);
    expect(screen.getByText(/\/ week/)).toBeInTheDocument();
  });

  it("shows save button", () => {
    render(<ScheduleTab />);
    expect(screen.getByText("Save schedule")).toBeInTheDocument();
  });

  it("shows Saving... when saving", () => {
    useScheduleStore.setState({ saving: true });
    render(<ScheduleTab />);
    expect(screen.getByText("Saving...")).toBeInTheDocument();
  });

  it("toggles day off when Off is clicked for active day", () => {
    render(<ScheduleTab />);
    const onButtons = screen.getAllByText("On");
    fireEvent.click(onButtons[0]); // Toggle Monday off
    // After click, Monday's block should be deleted
    expect(useScheduleStore.getState().blocks.find(b => b.day_of_week === 1)).toBeUndefined();
  });
});
