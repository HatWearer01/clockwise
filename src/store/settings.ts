import { create } from "zustand";
import { apiGetAppSettings, apiSaveAppSettings, apiSetMode } from "../lib/tauri";
import type { AppSettings } from "../types";

export type AppMode = "compact" | "expanded" | "fullscreen";
export type ExpandedTab = "today" | "tasks" | "schedule" | "week" | "settings";
export type ThemeMode = "dark" | "light" | "system";

type SettingsStore = {
  mode: AppMode;
  activeTab: ExpandedTab;
  theme: ThemeMode;
  appSettings: AppSettings;
  settingsSaving: boolean;
  init: () => void;
  setMode: (mode: AppMode) => Promise<void>;
  setActiveTab: (tab: ExpandedTab) => void;
  setTheme: (theme: ThemeMode) => void;
  setAppSettings: (next: Partial<AppSettings>) => Promise<void>;
};

function resolveTheme(theme: ThemeMode): "dark" | "light" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

function applyWindowOpacity(opacity: number) {
  document.documentElement.style.setProperty("--window-opacity", String(Math.max(0.45, Math.min(1, opacity))));
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  mode: "expanded",
  activeTab: "today",
  theme: "dark",
  appSettings: {
    autostart_enabled: true,
    notifications_enabled: true,
    idle_nudge_enabled: true,
    quiet_hours_enabled: false,
    quiet_hours_start_min: 22 * 60,
    quiet_hours_end_min: 8 * 60,
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
  init() {
    const saved = (localStorage.getItem("clockwise-theme") as ThemeMode | null) ?? "dark";
    const resolved = resolveTheme(saved);
    document.documentElement.setAttribute("data-theme", resolved);
    set({ theme: saved });
    if (saved === "system") {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => {
        if (get().theme === "system") {
          document.documentElement.setAttribute("data-theme", resolveTheme("system"));
        }
      };
      mql.addEventListener("change", handler);
    }
    const savedMode = (localStorage.getItem("clockwise-mode") as AppMode | null) ?? "expanded";
    set({ mode: savedMode });
    document.documentElement.setAttribute("data-mode", savedMode);
    void apiSetMode(savedMode).catch(() => {});
    void apiGetAppSettings()
      .then((appSettings) => {
        applyWindowOpacity(appSettings.window_opacity);
        set({ appSettings });
      })
      .catch(() => {});
  },
  async setMode(mode) {
    set({ mode });
    localStorage.setItem("clockwise-mode", mode);
    document.documentElement.setAttribute("data-mode", mode);
    try {
      await apiSetMode(mode);
    } catch {
      // Keep UI state if resize command fails in web-only contexts.
    }
  },
  setActiveTab(activeTab) {
    set({ activeTab });
  },
  setTheme(theme) {
    localStorage.setItem("clockwise-theme", theme);
    document.documentElement.setAttribute("data-theme", resolveTheme(theme));
    set({ theme });
    if (theme === "system") {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => {
        if (get().theme === "system") {
          document.documentElement.setAttribute("data-theme", resolveTheme("system"));
        }
      };
      mql.addEventListener("change", handler);
    }
  },
  async setAppSettings(next) {
    set({ settingsSaving: true });
    try {
      const merged: AppSettings = { ...get().appSettings, ...next };
      set({ appSettings: merged });
      applyWindowOpacity(merged.window_opacity);
      await apiSaveAppSettings(merged);
    } catch {
      // Keep optimistic state so UI stays responsive.
    } finally {
      set({ settingsSaving: false });
    }
  },
}));
