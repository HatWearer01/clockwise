import { create } from "zustand";
import {
  apiApplyPendingRecovery,
  apiClockIn,
  apiClockOut,
  apiConsumeStartupNotice,
  apiGetPendingRecovery,
  apiGetStatus,
  apiResumeBreak,
  apiStartBreak,
} from "../lib/tauri";
import type { PendingRecovery, StatusResponse } from "../types";

type TimerStore = {
  status: StatusResponse | null;
  statusFetchedAt: number;
  notice: string | null;
  resumePrompt: boolean;
  actionPrompt: { kind: "clock_in" | "clock_out" | "break"; message: string } | null;
  pendingRecovery: PendingRecovery | null;
  error: string | null;
  nowMs: number;
  load: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  clockIn: () => Promise<void>;
  clockOut: () => Promise<void>;
  startBreak: () => Promise<void>;
  resumeBreak: () => Promise<void>;
  tick: () => void;
  clearError: () => void;
  setResumePrompt: (value: boolean) => void;
  setActionPrompt: (prompt: { kind: "clock_in" | "clock_out" | "break"; message: string } | null) => void;
  applyPendingRecovery: (endedAt: number) => Promise<void>;
  liveWorkedMs: () => number;
};

function toMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return fallback;
}

export const useTimerStore = create<TimerStore>((set, get) => ({
  status: null,
  statusFetchedAt: Date.now(),
  notice: null,
  resumePrompt: false,
  actionPrompt: null,
  pendingRecovery: null,
  error: null,
  nowMs: Date.now(),
  async load() {
    try {
      set({ error: null });
      const [status, notice, pendingRecovery] = await Promise.all([
        apiGetStatus(),
        apiConsumeStartupNotice(),
        apiGetPendingRecovery(),
      ]);
      set({ status, notice, pendingRecovery, statusFetchedAt: Date.now() });
    } catch (error) {
      set({ error: toMessage(error, "Unable to load status") });
    }
  },
  async refreshStatus() {
    try {
      const status = await apiGetStatus();
      set({ status, statusFetchedAt: Date.now() });
    } catch (error) {
      set({ error: toMessage(error, "Failed to refresh status") });
    }
  },
  async clockIn() {
    try {
      set({ error: null });
      await apiClockIn();
      await get().refreshStatus();
    } catch (error) {
      set({ error: toMessage(error, "Clock in failed") });
    }
  },
  async clockOut() {
    try {
      set({ error: null });
      const { status, nowMs } = get();
      let endedAt: number | undefined;
      if (status?.active_session) {
        const elapsedMs = nowMs - status.active_session.started_at;
        const flooredSeconds = Math.floor(elapsedMs / 1000);
        endedAt = status.active_session.started_at + flooredSeconds * 1000;
      }
      await apiClockOut(endedAt);
      await get().refreshStatus();
    } catch (error) {
      set({ error: toMessage(error, "Clock out failed") });
    }
  },
  async startBreak() {
    try {
      set({ error: null });
      await apiStartBreak();
      await get().refreshStatus();
    } catch (error) {
      set({ error: toMessage(error, "Could not start break") });
    }
  },
  async resumeBreak() {
    try {
      set({ error: null });
      await apiResumeBreak();
      await get().refreshStatus();
    } catch (error) {
      set({ error: toMessage(error, "Could not resume break") });
    }
  },
  tick() {
    set({ nowMs: Date.now() });
  },
  clearError() {
    set({ error: null });
  },
  setResumePrompt(value) {
    set({ resumePrompt: value });
  },
  setActionPrompt(actionPrompt) {
    set({ actionPrompt });
  },
  async applyPendingRecovery(endedAt) {
    try {
      await apiApplyPendingRecovery(endedAt);
      await get().refreshStatus();
      set({ pendingRecovery: null, notice: null, error: null });
    } catch (error) {
      set({ error: toMessage(error, "Could not apply recovered session time") });
    }
  },
  liveWorkedMs() {
    const { status, statusFetchedAt, nowMs } = get();
    if (!status) return 0;
    if (status.active_session && !status.paused) {
      return status.worked_today_ms + Math.max(0, nowMs - statusFetchedAt);
    }
    return status.worked_today_ms;
  },
}));
