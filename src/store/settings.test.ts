import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "./settings";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
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
      always_on_top: false,
      week_start_day: 1,
      time_format: "12h",
      idle_nudge_work_min: 90,
      idle_nudge_idle_min: 15,
      accountability_mode: "shift",
    },
    settingsSaving: false,
  });
  vi.clearAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-mode");
});

describe("settings store", () => {
  describe("init", () => {
    it("reads theme from localStorage and applies to DOM", () => {
      localStorage.setItem("clockwise-theme", "light");
      mockInvoke.mockResolvedValue(undefined); // set_mode
      mockInvoke.mockResolvedValue({
        autostart_enabled: true,
        notifications_enabled: true,
        idle_nudge_enabled: true,
        quiet_hours_enabled: true,
        quiet_hours_start_min: 1320,
        quiet_hours_end_min: 480,
        window_opacity: 0.96,
      });

      useSettingsStore.getState().init();

      expect(useSettingsStore.getState().theme).toBe("light");
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    });

    it("reads mode from localStorage", () => {
      localStorage.setItem("clockwise-mode", "compact");
      mockInvoke.mockResolvedValue(undefined);

      useSettingsStore.getState().init();

      expect(useSettingsStore.getState().mode).toBe("compact");
      expect(document.documentElement.getAttribute("data-mode")).toBe("compact");
    });

    it("defaults to dark theme when nothing stored", () => {
      mockInvoke.mockResolvedValue(undefined);

      useSettingsStore.getState().init();

      expect(useSettingsStore.getState().theme).toBe("dark");
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });
  });

  describe("setMode", () => {
    it("updates state, localStorage and DOM", async () => {
      mockInvoke.mockResolvedValue(undefined);

      await useSettingsStore.getState().setMode("compact");

      expect(useSettingsStore.getState().mode).toBe("compact");
      expect(localStorage.getItem("clockwise-mode")).toBe("compact");
      expect(document.documentElement.getAttribute("data-mode")).toBe("compact");
      expect(mockInvoke).toHaveBeenCalledWith("set_mode", { mode: "compact" });
    });
  });

  describe("setActiveTab", () => {
    it("updates the active tab", () => {
      useSettingsStore.getState().setActiveTab("schedule");
      expect(useSettingsStore.getState().activeTab).toBe("schedule");
    });
  });

  describe("setTheme", () => {
    it("saves to localStorage and applies dark", () => {
      useSettingsStore.getState().setTheme("dark");
      expect(localStorage.getItem("clockwise-theme")).toBe("dark");
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });

    it("saves to localStorage and applies light", () => {
      useSettingsStore.getState().setTheme("light");
      expect(localStorage.getItem("clockwise-theme")).toBe("light");
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    });
  });

  describe("setAppSettings", () => {
    it("merges partial settings and saves", async () => {
      mockInvoke.mockResolvedValue(undefined);

      await useSettingsStore.getState().setAppSettings({ notifications_enabled: false });

      const state = useSettingsStore.getState();
      expect(state.appSettings.notifications_enabled).toBe(false);
      expect(state.appSettings.autostart_enabled).toBe(true); // unchanged
      expect(mockInvoke).toHaveBeenCalledWith("save_app_settings", {
        settings: expect.objectContaining({ notifications_enabled: false }),
      });
    });

    it("applies window opacity to CSS variable", async () => {
      mockInvoke.mockResolvedValue(undefined);

      await useSettingsStore.getState().setAppSettings({ window_opacity: 0.8 });

      const opacity = document.documentElement.style.getPropertyValue("--window-opacity");
      expect(opacity).toBe("0.8");
    });

    it("sets settingsSaving during save", async () => {
      let resolveFn: () => void;
      const prom = new Promise<void>((resolve) => { resolveFn = resolve; });
      mockInvoke.mockReturnValueOnce(prom as never);

      const savePromise = useSettingsStore.getState().setAppSettings({ idle_nudge_enabled: false });
      expect(useSettingsStore.getState().settingsSaving).toBe(true);

      resolveFn!();
      await savePromise;
      expect(useSettingsStore.getState().settingsSaving).toBe(false);
    });
  });
});
