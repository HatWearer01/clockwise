import { useEffect, useMemo, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import Expanded from "./views/Expanded";
import Compact from "./views/Compact";
import WeeklyReview from "./components/WeeklyReview";
import { useScheduleStore } from "./store/schedule";
import { useSettingsStore } from "./store/settings";
import { useTimerStore } from "./store/timer";
import { apiCheckNotifications, apiGetLastReviewedWeek, apiGetWeeklyReview, apiSetLastReviewedWeek, apiShowWindow } from "./lib/tauri";
import { parseTimeInput, timeInputValue, weekDayDates } from "./lib/time";
import Titlebar from "./components/Titlebar";
import type { WeeklyReview as WeeklyReviewType } from "./types";

function App() {
  const { mode } = useSettingsStore();
  const timerStore = useTimerStore();
  const scheduleStore = useScheduleStore();
  const error = timerStore.error || scheduleStore.error;
  const [recoveryEditTime, setRecoveryEditTime] = useState<string>("");
  const [weeklyReview, setWeeklyReview] = useState<WeeklyReviewType | null>(null);

  const suggestedRecoveryTime = useMemo(() => {
    if (!timerStore.pendingRecovery) return "";
    return timeInputValue(Math.floor((timerStore.pendingRecovery.suggested_end_at / 60000) % 1440));
  }, [timerStore.pendingRecovery]);

  useEffect(() => {
    if (timerStore.pendingRecovery) {
      setRecoveryEditTime(suggestedRecoveryTime);
    }
  }, [suggestedRecoveryTime, timerStore.pendingRecovery]);

  useEffect(() => {
    async function checkWeeklyReview() {
      try {
        const { appSettings } = useSettingsStore.getState();
        const wsd = appSettings.week_start_day as 0 | 1;
        const thisWeekDays = weekDayDates(0, wsd);
        const thisWeekStart = thisWeekDays[0].date;
        const lastReviewed = await apiGetLastReviewedWeek();
        if (lastReviewed !== thisWeekStart) {
          const review = await apiGetWeeklyReview(wsd);
          if (review && (review.total_actual_ms > 0 || review.total_target_ms > 0)) {
            setWeeklyReview(review);
          }
          await apiSetLastReviewedWeek(thisWeekStart);
        }
      } catch { /* ignore */ }
    }
    const timer = setTimeout(checkWeeklyReview, 2000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    useSettingsStore.getState().init();
    void emit("app-ready");
    void timerStore.load();
    void scheduleStore.load();
    void apiShowWindow().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const tick = window.setInterval(() => {
      timerStore.tick();
      const state = useTimerStore.getState();
      if (
        state.status?.next_boundary_ms &&
        state.nowMs >= state.status.next_boundary_ms &&
        !state.status.active_session
      ) {
        void timerStore.refreshStatus();
      }
    }, 1000);
    return () => window.clearInterval(tick);
  }, [timerStore]);

  useEffect(() => {
    const statusRefresh = window.setInterval(() => {
      void timerStore.refreshStatus();
      void apiCheckNotifications().catch(() => {});
    }, 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void timerStore.refreshStatus();
        void scheduleStore.load();
        void apiCheckNotifications().catch(() => {});
      }
    };
    const onFocus = () => {
      void timerStore.refreshStatus();
      void apiCheckNotifications().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(statusRefresh);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [timerStore, scheduleStore]);

  useEffect(() => {
    let unlistenClockIn: (() => void) | undefined;
    let unlistenClockOut: (() => void) | undefined;
    let unlistenAway: (() => void) | undefined;
    let unlistenBack: (() => void) | undefined;
    let unlistenAction: (() => void) | undefined;

    void listen("tray-clock-in", () => {
      void timerStore.clockIn();
    }).then((fn) => {
      unlistenClockIn = fn;
    });
    void listen("tray-clock-out", () => {
      void timerStore.clockOut();
    }).then((fn) => {
      unlistenClockOut = fn;
    });
    void listen<{ reason?: string }>("session-away", () => {
      const state = useTimerStore.getState();
      if (state.status?.active_session && !state.status.paused) {
        void timerStore.startBreak();
      }
    }).then((fn) => {
      unlistenAway = fn;
    });
    void listen<{ reason?: string }>("session-back", async () => {
      await timerStore.refreshStatus();
      const state = useTimerStore.getState();
      if (state.status?.active_session && state.status.paused) {
        state.setResumePrompt(true);
      }
    }).then((fn) => {
      unlistenBack = fn;
    });
    void listen<{ kind: "clock_in" | "clock_out" | "break"; message: string }>("notification-action", (event) => {
      useTimerStore.getState().setActionPrompt(event.payload);
    }).then((fn) => {
      unlistenAction = fn;
    });

    return () => {
      unlistenClockIn?.();
      unlistenClockOut?.();
      unlistenAway?.();
      unlistenBack?.();
      unlistenAction?.();
    };
  }, [timerStore]);

  return (
    <main className="app-shell">
      <Titlebar />
      {weeklyReview ? (
        <WeeklyReview review={weeklyReview} onClose={() => setWeeklyReview(null)} />
      ) : null}
      {timerStore.notice ? <div className="banner banner-info">{timerStore.notice}</div> : null}
      {timerStore.pendingRecovery ? (
        <div className="banner banner-info banner-action">
          <span>Previous session was interrupted. Confirm recovered end time or edit it.</span>
          <div className="button-group">
            <button
              className="chip chip-active"
              onClick={() => void timerStore.applyPendingRecovery(timerStore.pendingRecovery!.suggested_end_at)}
            >
              Accept suggested
            </button>
            <input type="time" value={recoveryEditTime} onChange={(e) => setRecoveryEditTime(e.currentTarget.value)} />
            <button
              className="chip"
              onClick={() => {
                const minute = parseTimeInput(recoveryEditTime);
                if (Number.isNaN(minute)) return;
                const base = new Date(timerStore.pendingRecovery!.suggested_end_at);
                base.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
                void timerStore.applyPendingRecovery(base.getTime());
              }}
            >
              Save edited
            </button>
          </div>
        </div>
      ) : null}
      {timerStore.resumePrompt ? (
        <div className="banner banner-info banner-action">
          <span>You are back. Resume your session now?</span>
          <div className="button-group">
            <button
              className="chip chip-active"
              onClick={() => {
                void timerStore.resumeBreak();
                timerStore.setResumePrompt(false);
              }}
            >
              Resume
            </button>
            <button className="chip" onClick={() => timerStore.setResumePrompt(false)}>
              Keep paused
            </button>
          </div>
        </div>
      ) : null}
      {timerStore.actionPrompt ? (
        <div className="banner banner-info banner-action">
          <span>{timerStore.actionPrompt.message}</span>
          <div className="button-group">
            {timerStore.actionPrompt.kind === "clock_in" ? (
              <button
                className="chip chip-active"
                onClick={() => {
                  void timerStore.clockIn();
                  timerStore.setActionPrompt(null);
                }}
              >
                Clock in
              </button>
            ) : null}
            {timerStore.actionPrompt.kind === "clock_out" ? (
              <button
                className="chip chip-active"
                onClick={() => {
                  void timerStore.clockOut();
                  timerStore.setActionPrompt(null);
                }}
              >
                Clock out
              </button>
            ) : null}
            {timerStore.actionPrompt.kind === "break" ? (
              <button
                className="chip chip-active"
                onClick={() => {
                  void timerStore.startBreak();
                  timerStore.setActionPrompt(null);
                }}
              >
                Start break
              </button>
            ) : null}
            <button className="chip" onClick={() => timerStore.setActionPrompt(null)}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <button className="banner banner-error" onClick={() => { timerStore.clearError(); scheduleStore.clearError(); }}>
          {error}
        </button>
      ) : null}
      <div className="view-slot">
        {mode === "compact" ? <Compact /> : <Expanded />}
      </div>
    </main>
  );
}

export default App;
