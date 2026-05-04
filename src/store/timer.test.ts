import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useTimerStore } from "./timer";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  useTimerStore.setState({
    status: null,
    statusFetchedAt: Date.now(),
    notice: null,
    resumePrompt: false,
    actionPrompt: null,
    pendingRecovery: null,
    error: null,
    nowMs: Date.now(),
  });
  vi.clearAllMocks();
});

describe("timer store", () => {
  describe("load", () => {
    it("loads status, notice, and pending recovery", async () => {
      const mockStatus = {
        active_session: null,
        worked_today_ms: 3_600_000,
        break_today_ms: 0,
        state: "in_shift" as const,
        week_done: false,
        day_done: false,
        next_boundary_ms: null,
        paused: false,
      };
      mockInvoke
        .mockResolvedValueOnce(mockStatus) // get_status
        .mockResolvedValueOnce(null) // consume_startup_notice
        .mockResolvedValueOnce(null); // get_pending_recovery

      await useTimerStore.getState().load();

      const state = useTimerStore.getState();
      expect(state.status).toEqual(mockStatus);
      expect(state.notice).toBeNull();
      expect(state.pendingRecovery).toBeNull();
      expect(state.error).toBeNull();
    });

    it("sets error on failure", async () => {
      mockInvoke.mockRejectedValueOnce({ message: "DB error" });

      await useTimerStore.getState().load();

      expect(useTimerStore.getState().error).toBe("DB error");
    });
  });

  describe("clockIn", () => {
    it("invokes clock_in and refreshes status", async () => {
      mockInvoke
        .mockResolvedValueOnce({ id: 1, started_at: 1000, ended_at: null }) // clock_in
        .mockResolvedValueOnce({
          active_session: { id: 1, started_at: 1000, ended_at: null },
          worked_today_ms: 0,
          break_today_ms: 0,
          state: "on_clock",
          next_boundary_ms: 1001,
          paused: false,
          week_done: false,
          day_done: false,
        }); // get_status (refresh)

      await useTimerStore.getState().clockIn();

      expect(mockInvoke).toHaveBeenCalledWith("clock_in");
      expect(useTimerStore.getState().status?.state).toBe("on_clock");
    });

    it("sets error on duplicate clock in", async () => {
      mockInvoke.mockRejectedValueOnce({ message: "You are already clocked in." });

      await useTimerStore.getState().clockIn();

      expect(useTimerStore.getState().error).toBe("You are already clocked in.");
    });
  });

  describe("clockOut", () => {
    it("invokes clock_out with computed endedAt", async () => {
      const started = Date.now() - 3_600_000;
      useTimerStore.setState({
        status: {
          active_session: { id: 1, started_at: started, ended_at: null },
          worked_today_ms: 3_600_000,
          break_today_ms: 0,
          state: "on_clock",
          next_boundary_ms: null,
          paused: false,
          week_done: false,
          day_done: false,
        },
        nowMs: Date.now(),
      });

      mockInvoke
        .mockResolvedValueOnce({ id: 1, started_at: started, ended_at: Date.now() }) // clock_out
        .mockResolvedValueOnce({
          active_session: null,
          worked_today_ms: 3_600_000,
          break_today_ms: 0,
          state: "after_shift",
          next_boundary_ms: null,
          paused: false,
          week_done: false,
          day_done: false,
        }); // get_status

      await useTimerStore.getState().clockOut();

      expect(mockInvoke).toHaveBeenCalledWith("clock_out", expect.objectContaining({ endedAt: expect.any(Number) }));
    });
  });

  describe("startBreak / resumeBreak", () => {
    it("invokes start_break and refreshes", async () => {
      mockInvoke
        .mockResolvedValueOnce(undefined) // start_break
        .mockResolvedValueOnce({
          active_session: { id: 1, started_at: 1000, ended_at: null },
          worked_today_ms: 1000,
          break_today_ms: 0,
          state: "on_break",
          next_boundary_ms: null,
          paused: true,
          week_done: false,
          day_done: false,
        });

      await useTimerStore.getState().startBreak();

      expect(mockInvoke).toHaveBeenCalledWith("start_break");
      expect(useTimerStore.getState().status?.paused).toBe(true);
    });

    it("invokes resume_break and refreshes", async () => {
      mockInvoke
        .mockResolvedValueOnce(undefined) // resume_break
        .mockResolvedValueOnce({
          active_session: { id: 1, started_at: 1000, ended_at: null },
          worked_today_ms: 1000,
          break_today_ms: 0,
          state: "on_clock",
          next_boundary_ms: null,
          paused: false,
          week_done: false,
          day_done: false,
        });

      await useTimerStore.getState().resumeBreak();

      expect(mockInvoke).toHaveBeenCalledWith("resume_break");
      expect(useTimerStore.getState().status?.paused).toBe(false);
    });
  });

  describe("tick", () => {
    it("updates nowMs", () => {
      const before = useTimerStore.getState().nowMs;
      useTimerStore.getState().tick();
      expect(useTimerStore.getState().nowMs).toBeGreaterThanOrEqual(before);
    });
  });

  describe("liveWorkedMs", () => {
    it("returns worked_today_ms when no active session", () => {
      useTimerStore.setState({
        status: {
          active_session: null,
          worked_today_ms: 5000,
          break_today_ms: 0,
          state: "after_shift",
          next_boundary_ms: null,
          paused: false,
          week_done: false,
          day_done: false,
        },
        statusFetchedAt: Date.now(),
        nowMs: Date.now(),
      });

      expect(useTimerStore.getState().liveWorkedMs()).toBe(5000);
    });

    it("returns 0 when no status", () => {
      useTimerStore.setState({ status: null });
      expect(useTimerStore.getState().liveWorkedMs()).toBe(0);
    });

    it("adds elapsed time when active and not paused", () => {
      const fetchedAt = Date.now() - 5000;
      useTimerStore.setState({
        status: {
          active_session: { id: 1, started_at: fetchedAt - 10000, ended_at: null },
          worked_today_ms: 10000,
          break_today_ms: 0,
          state: "on_clock",
          next_boundary_ms: null,
          paused: false,
          week_done: false,
          day_done: false,
        },
        statusFetchedAt: fetchedAt,
        nowMs: Date.now(),
      });

      const live = useTimerStore.getState().liveWorkedMs();
      expect(live).toBeGreaterThanOrEqual(15000);
    });

    it("does not add elapsed when paused", () => {
      const fetchedAt = Date.now() - 5000;
      useTimerStore.setState({
        status: {
          active_session: { id: 1, started_at: fetchedAt - 10000, ended_at: null },
          worked_today_ms: 10000,
          break_today_ms: 0,
          state: "on_break",
          next_boundary_ms: null,
          paused: true,
          week_done: false,
          day_done: false,
        },
        statusFetchedAt: fetchedAt,
        nowMs: Date.now(),
      });

      expect(useTimerStore.getState().liveWorkedMs()).toBe(10000);
    });
  });

  describe("applyPendingRecovery", () => {
    it("clears pending recovery on success", async () => {
      useTimerStore.setState({
        pendingRecovery: { session_id: 1, started_at: 1000, suggested_end_at: 2000 },
        notice: "Found an open session",
      });

      mockInvoke
        .mockResolvedValueOnce(undefined) // apply_pending_recovery
        .mockResolvedValueOnce({
          active_session: null,
          worked_today_ms: 1000,
          break_today_ms: 0,
          state: "after_shift",
          next_boundary_ms: null,
          paused: false,
          week_done: false,
          day_done: false,
        }); // get_status

      await useTimerStore.getState().applyPendingRecovery(2000);

      const state = useTimerStore.getState();
      expect(state.pendingRecovery).toBeNull();
      expect(state.notice).toBeNull();
      expect(state.error).toBeNull();
    });
  });

  describe("setResumePrompt / setActionPrompt", () => {
    it("sets resume prompt", () => {
      useTimerStore.getState().setResumePrompt(true);
      expect(useTimerStore.getState().resumePrompt).toBe(true);
    });

    it("sets action prompt", () => {
      const prompt = { kind: "clock_in" as const, message: "Clock in now?" };
      useTimerStore.getState().setActionPrompt(prompt);
      expect(useTimerStore.getState().actionPrompt).toEqual(prompt);
    });

    it("clears action prompt", () => {
      useTimerStore.getState().setActionPrompt(null);
      expect(useTimerStore.getState().actionPrompt).toBeNull();
    });
  });

  describe("clearError", () => {
    it("clears the error", () => {
      useTimerStore.setState({ error: "some error" });
      useTimerStore.getState().clearError();
      expect(useTimerStore.getState().error).toBeNull();
    });
  });
});
