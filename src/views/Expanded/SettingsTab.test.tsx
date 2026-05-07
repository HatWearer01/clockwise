import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import SettingsTab from "./SettingsTab";
import { useSettingsStore } from "../../store/settings";

const mockInvoke = vi.mocked(invoke);

const fullSettings = {
  autostart_enabled: true,
  notifications_enabled: true,
  idle_nudge_enabled: true,
  quiet_hours_enabled: true,
  quiet_hours_start_min: 1320,
  quiet_hours_end_min: 480,
  reminder_interval_min: 5,
  window_opacity: 0.96,
  always_on_top: false,
  week_start_day: 1 as 0 | 1,
  time_format: "12h" as "12h" | "24h",
  idle_nudge_work_min: 90,
  idle_nudge_idle_min: 15,
  accountability_mode: "shift" as "shift" | "target",
};

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({
    theme: "dark",
    appSettings: { ...fullSettings },
    settingsSaving: false,
  });
});

describe("SettingsTab", () => {
  it("renders all setting sections", () => {
    render(<SettingsTab />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Theme")).toBeInTheDocument();
    expect(screen.getByText("Always on top")).toBeInTheDocument();
    expect(screen.getByText("Window opacity")).toBeInTheDocument();
    expect(screen.getByText("Week starts on")).toBeInTheDocument();
    expect(screen.getByText("Time format")).toBeInTheDocument();
    expect(screen.getByText("Autostart with Windows")).toBeInTheDocument();
    expect(screen.getByText("Notifications")).toBeInTheDocument();
    expect(screen.getByText("Idle nudge")).toBeInTheDocument();
    expect(screen.getByText("Quiet hours")).toBeInTheDocument();
    expect(screen.getByText("Data folder")).toBeInTheDocument();
  });

  it("shows theme buttons with dark active", () => {
    render(<SettingsTab />);
    const darkBtn = screen.getByText("Dark");
    expect(darkBtn.className).toContain("chip-active");
  });

  it("switches theme to light when clicked", () => {
    render(<SettingsTab />);
    fireEvent.click(screen.getByText("Light"));
    expect(useSettingsStore.getState().theme).toBe("light");
  });

  it("toggles always-on-top on", () => {
    mockInvoke.mockResolvedValue(undefined);
    render(<SettingsTab />);
    const onButtons = screen.getAllByText("On");
    fireEvent.click(onButtons[0]); // first On is under Always on top
    expect(useSettingsStore.getState().appSettings.always_on_top).toBe(true);
  });

  it("switches week start to Sunday", () => {
    mockInvoke.mockResolvedValue(undefined);
    render(<SettingsTab />);
    fireEvent.click(screen.getByText("Sunday"));
    expect(useSettingsStore.getState().appSettings.week_start_day).toBe(0);
  });

  it("switches time format to 24h", () => {
    mockInvoke.mockResolvedValue(undefined);
    render(<SettingsTab />);
    fireEvent.click(screen.getByText("24h"));
    expect(useSettingsStore.getState().appSettings.time_format).toBe("24h");
  });

  it("toggles autostart off", () => {
    mockInvoke.mockResolvedValue(undefined);
    render(<SettingsTab />);

    const offButtons = screen.getAllByText("Off");
    fireEvent.click(offButtons[1]); // second Off is Autostart

    expect(useSettingsStore.getState().appSettings.autostart_enabled).toBe(false);
  });

  it("toggles notifications off", () => {
    mockInvoke.mockResolvedValue(undefined);
    render(<SettingsTab />);

    const offButtons = screen.getAllByText("Off");
    fireEvent.click(offButtons[2]); // third Off is Notifications

    expect(useSettingsStore.getState().appSettings.notifications_enabled).toBe(false);
  });

  it("shows quiet hours time pickers when enabled", () => {
    render(<SettingsTab />);
    const timeInputs = screen.getAllByDisplayValue(/:/);
    expect(timeInputs.length).toBeGreaterThanOrEqual(2);
  });

  it("shows idle nudge sub-controls when enabled", () => {
    render(<SettingsTab />);
    expect(screen.getByText("Break reminder after")).toBeInTheDocument();
    expect(screen.getByText("Inactivity alert after")).toBeInTheDocument();
  });

  it("hides idle nudge sub-controls when disabled", () => {
    useSettingsStore.setState({
      appSettings: { ...fullSettings, idle_nudge_enabled: false },
    });
    render(<SettingsTab />);
    expect(screen.queryByText("Break reminder after")).not.toBeInTheDocument();
  });

  it("changes idle nudge work threshold", () => {
    mockInvoke.mockResolvedValue(undefined);
    render(<SettingsTab />);
    fireEvent.click(screen.getByText("2h")); // 120 min
    expect(useSettingsStore.getState().appSettings.idle_nudge_work_min).toBe(120);
  });

  it("shows Saving... when saving", () => {
    useSettingsStore.setState({ settingsSaving: true });
    render(<SettingsTab />);
    expect(screen.getByText("Saving...")).toBeInTheDocument();
  });

  it("opens data folder on button click", () => {
    mockInvoke.mockResolvedValue(undefined);
    render(<SettingsTab />);
    fireEvent.click(screen.getByText("Open"));
    expect(mockInvoke).toHaveBeenCalledWith("open_data_folder");
  });
});
