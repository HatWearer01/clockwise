import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { listen, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { useTimerStore } from "./store/timer";
import { useScheduleStore } from "./store/schedule";
import { useSettingsStore } from "./store/settings";

const mockListen = vi.mocked(listen);
const mockEmit = vi.mocked(emit);
const mockInvoke = vi.mocked(invoke);

vi.mock("framer-motion", () => ({
  motion: {
    section: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => <section {...props}>{children}</section>,
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue(undefined);
  mockListen.mockImplementation(() => Promise.resolve(() => {}));
  mockEmit.mockResolvedValue(undefined);
  localStorage.clear();

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
    statusFetchedAt: Date.now(),
    notice: null,
    resumePrompt: false,
    actionPrompt: null,
    pendingRecovery: null,
    error: null,
    nowMs: Date.now(),
  });

  useScheduleStore.setState({
    templates: [],
    activeTemplateId: 1,
    blocks: [],
    checklistItems: [],
    saving: false,
    error: null,
    draftTemplateName: "",
    selectedBlockId: null,
  });

  useSettingsStore.setState({
    mode: "expanded",
    activeTab: "today",
    theme: "dark",
    appSettings: {
      autostart_enabled: true,
      notifications_enabled: true,
      idle_nudge_enabled: true,
      quiet_hours_enabled: true,
      quiet_hours_start_min: 1320,
      quiet_hours_end_min: 480,
      reminder_interval_min: 5,
      window_opacity: 0.96,
    },
    settingsSaving: false,
  });
});

describe("App", () => {
  it("renders without crashing", () => {
    render(<App />);
    expect(screen.getByText("Clockwise")).toBeInTheDocument();
  });

  it("renders Expanded view in expanded mode", () => {
    useSettingsStore.setState({ mode: "expanded" });
    render(<App />);
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("renders Compact view in compact mode", () => {
    localStorage.setItem("clockwise-mode", "compact");
    useSettingsStore.setState({ mode: "compact" });
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
    render(<App />);
    expect(screen.getByText("Ready when you are")).toBeInTheDocument();
  });

  it("shows notice banner when present", () => {
    useTimerStore.setState({ notice: "Session recovered at 17:00" });
    render(<App />);
    expect(screen.getByText("Session recovered at 17:00")).toBeInTheDocument();
  });

  it("shows pending recovery banner", () => {
    useTimerStore.setState({
      pendingRecovery: { session_id: 1, started_at: 1000, suggested_end_at: 2000 },
    });
    render(<App />);
    expect(screen.getByText(/Previous session was interrupted/)).toBeInTheDocument();
    expect(screen.getByText("Accept suggested")).toBeInTheDocument();
    expect(screen.getByText("Save edited")).toBeInTheDocument();
  });

  it("shows resume prompt banner", () => {
    useTimerStore.setState({ resumePrompt: true });
    render(<App />);
    expect(screen.getByText("You are back. Resume your session now?")).toBeInTheDocument();
    expect(screen.getByText("Resume")).toBeInTheDocument();
    expect(screen.getByText("Keep paused")).toBeInTheDocument();
  });

  it("shows action prompt banner for clock_in", () => {
    useTimerStore.setState({
      actionPrompt: { kind: "clock_in", message: "Scheduled start reached. Clock in now?" },
    });
    render(<App />);
    expect(screen.getByText("Scheduled start reached. Clock in now?")).toBeInTheDocument();
    expect(screen.getByText("Dismiss")).toBeInTheDocument();
    const clockInButtons = screen.getAllByText("Clock in");
    expect(clockInButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("shows action prompt banner for clock_out", () => {
    useTimerStore.setState({
      actionPrompt: { kind: "clock_out", message: "Clock out now?" },
    });
    render(<App />);
    expect(screen.getByText("Clock out now?")).toBeInTheDocument();
    expect(screen.getByText("Clock out")).toBeInTheDocument();
  });

  it("shows action prompt banner for break", () => {
    useTimerStore.setState({
      actionPrompt: { kind: "break", message: "Take a break?" },
    });
    render(<App />);
    expect(screen.getByText("Take a break?")).toBeInTheDocument();
    expect(screen.getByText("Start break")).toBeInTheDocument();
  });

  it("shows error banner when error is set", async () => {
    mockInvoke.mockRejectedValue({ message: "Something went wrong" });
    render(<App />);
    // The load() call will fail and set the error
    await vi.waitFor(() => {
      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    });
  });

  it("registers event listeners on mount", () => {
    render(<App />);
    expect(mockListen).toHaveBeenCalledWith("tray-clock-in", expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith("tray-clock-out", expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith("session-away", expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith("session-back", expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith("notification-action", expect.any(Function));
  });
});
