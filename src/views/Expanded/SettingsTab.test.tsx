import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import SettingsTab from "./SettingsTab";
import { useSettingsStore } from "../../store/settings";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({
    theme: "dark",
    appSettings: {
      autostart_enabled: true,
      notifications_enabled: true,
      idle_nudge_enabled: true,
      quiet_hours_enabled: true,
      quiet_hours_start_min: 1320,
      quiet_hours_end_min: 480,
      corner_snap: "TR",
      window_opacity: 0.96,
    },
    settingsSaving: false,
  });
});

describe("SettingsTab", () => {
  it("renders all setting sections", () => {
    render(<SettingsTab />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Theme")).toBeInTheDocument();
    expect(screen.getByText("Autostart with Windows")).toBeInTheDocument();
    expect(screen.getByText("Notifications")).toBeInTheDocument();
    expect(screen.getByText("Idle nudge")).toBeInTheDocument();
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

  it("toggles autostart off", () => {
    mockInvoke.mockResolvedValue(undefined);
    render(<SettingsTab />);

    const offButtons = screen.getAllByText("Off");
    fireEvent.click(offButtons[0]); // first Off under Autostart

    expect(useSettingsStore.getState().appSettings.autostart_enabled).toBe(false);
  });

  it("toggles notifications off", () => {
    mockInvoke.mockResolvedValue(undefined);
    render(<SettingsTab />);

    const offButtons = screen.getAllByText("Off");
    fireEvent.click(offButtons[1]); // second Off under Notifications

    expect(useSettingsStore.getState().appSettings.notifications_enabled).toBe(false);
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
