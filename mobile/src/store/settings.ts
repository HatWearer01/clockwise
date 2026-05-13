import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Appearance } from "react-native";
import * as SettingsService from "../services/settings";
import { checkAndNotify } from "../services/notification";
import type { AppSettings } from "../types";
import { useTimerStore } from "./timer";

export type ThemeMode = "dark" | "light" | "system";

type SettingsStore = {
  theme: ThemeMode;
  resolvedTheme: "dark" | "light";
  appSettings: AppSettings;
  settingsSaving: boolean;
  init: () => Promise<void>;
  setTheme: (theme: ThemeMode) => void;
  setAppSettings: (next: Partial<AppSettings>) => Promise<void>;
};

function resolveTheme(theme: ThemeMode): "dark" | "light" {
  if (theme === "system") {
    return Appearance.getColorScheme() === "light" ? "light" : "dark";
  }
  return theme;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  theme: "dark",
  resolvedTheme: "dark",
  appSettings: {
    notifications_enabled: true,
    quiet_hours_enabled: false,
    quiet_hours_start_min: 22 * 60,
    quiet_hours_end_min: 8 * 60,
    reminder_interval_min: 5,
    week_start_day: 1,
    time_format: "12h",
    accountability_mode: "shift",
  },
  settingsSaving: false,

  async init() {
    try {
      const saved = ((await AsyncStorage.getItem("clockwise-theme")) as ThemeMode | null) ?? "dark";
      set({ theme: saved, resolvedTheme: resolveTheme(saved) });

      Appearance.addChangeListener(() => {
        if (get().theme === "system") {
          set({ resolvedTheme: resolveTheme("system") });
        }
      });

      const appSettings = await SettingsService.getAppSettings();
      if (appSettings) set({ appSettings });
    } catch {
      // keep defaults
    }
  },

  setTheme(theme) {
    AsyncStorage.setItem("clockwise-theme", theme).catch(() => {});
    set({ theme, resolvedTheme: resolveTheme(theme) });
  },

  async setAppSettings(next) {
    set({ settingsSaving: true });
    try {
      const merged: AppSettings = { ...get().appSettings, ...next };
      set({ appSettings: merged });
      await SettingsService.saveAppSettings(merged);
      void useTimerStore.getState().refreshStatus();
      void checkAndNotify().catch(() => {});
    } catch {
      // keep optimistic state
    } finally {
      set({ settingsSaving: false });
    }
  },
}));
