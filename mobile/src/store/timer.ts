import { create } from "zustand";
import * as SessionService from "../services/session";
import type { PendingRecovery, StatusResponse } from "../types";

function toMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return fallback;
}

type TimerStore = {
  status: StatusResponse | null;
  statusFetchedAt: number;
  notice: string | null;
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
  applyPendingRecovery: (endedAt: number) => Promise<void>;
  liveWorkedMs: () => number;
  liveShiftCoverageMs: (inSchedule: boolean) => number;
};

export const useTimerStore = create<TimerStore>((set, get) => ({
  status: null,
  statusFetchedAt: Date.now(),
  notice: null,
  pendingRecovery: null,
  error: null,
  nowMs: Date.now(),

  async load() {
    try {
      set({ error: null });
      const [status, notice, pendingRecovery] = await Promise.all([
        SessionService.getStatus(),
        SessionService.consumeStartupNotice(),
        SessionService.getPendingRecovery(),
      ]);
      set({ status, notice, pendingRecovery, statusFetchedAt: Date.now() });
    } catch (error) {
      set({ error: toMessage(error, "Unable to load status") });
    }
  },

  async refreshStatus() {
    try {
      const status = await SessionService.getStatus();
      set({ status, statusFetchedAt: Date.now() });
    } catch (error) {
      set({ error: toMessage(error, "Failed to refresh status") });
    }
  },

  async clockIn() {
    try {
      set({ error: null });
      await SessionService.clockIn();
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
      await SessionService.clockOut(endedAt);
      await get().refreshStatus();
    } catch (error) {
      set({ error: toMessage(error, "Clock out failed") });
    }
  },

  async startBreak() {
    try {
      set({ error: null });
      await SessionService.startBreak();
      await get().refreshStatus();
    } catch (error) {
      set({ error: toMessage(error, "Could not start break") });
    }
  },

  async resumeBreak() {
    try {
      set({ error: null });
      await SessionService.resumeBreak();
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

  async applyPendingRecovery(endedAt) {
    try {
      await SessionService.applyPendingRecovery(endedAt);
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

  liveShiftCoverageMs(inSchedule: boolean) {
    const { status, statusFetchedAt, nowMs } = get();
    if (!status) return 0;
    if (status.active_session && !status.paused && inSchedule) {
      return status.shift_coverage_ms + Math.max(0, nowMs - statusFetchedAt);
    }
    return status.shift_coverage_ms;
  },
}));
