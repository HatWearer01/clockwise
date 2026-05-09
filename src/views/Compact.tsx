import { useState, useEffect, useCallback } from "react";
import { Menu } from "lucide-react";
import { motion } from "framer-motion";
import ClockButton from "../components/ClockButton";
import Logo from "../components/Logo";
import OffScheduleConfirm from "../components/OffScheduleConfirm";
import ProgressRing from "../components/ProgressRing";
import StatusChip from "../components/StatusChip";
import {
  blockDurationMs,
  formatDuration,
  formatHoursMinutes,
  isCurrentlyInSchedule,
  shiftProgressFraction,
  stateMessage,
  todayISODate,
} from "../lib/time";
import { apiGetDailyTasks, apiMarkDayDone } from "../lib/tauri";
import { useScheduleStore } from "../store/schedule";
import { useSettingsStore } from "../store/settings";
import { useTimerStore } from "../store/timer";
import type { DailyTask } from "../types";

export default function Compact() {
  const { status, nowMs, clockIn, clockOut, startBreak, resumeBreak, offSchedulePrompt, setOffSchedulePrompt } = useTimerStore();
  const { setMode, appSettings } = useSettingsStore();
  const { blocks } = useScheduleStore();
  const isShiftMode = appSettings.accountability_mode === "shift";

  const [now, setNow] = useState(new Date());
  const [tasks, setTasks] = useState<DailyTask[]>([]);
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const isoToday = todayISODate();
  const loadTasks = useCallback(async () => {
    try {
      const fetched = await apiGetDailyTasks(isoToday);
      setTasks(fetched ?? []);
    } catch { /* ignore */ }
  }, [isoToday]);

  useEffect(() => {
    if (isShiftMode) void loadTasks();
  }, [isShiftMode, loadTasks]);

  if (!status) return <section className="card">Loading...</section>;

  const todayDow = now.getDay();
  const todayBlocks = blocks.filter((b) => b.day_of_week === todayDow);
  const plannedMs = todayBlocks.reduce((s, b) => s + blockDurationMs(b.start_min, b.end_min), 0);
  const targetMs = status.target_today_ms > 0 ? status.target_today_ms : plannedMs;

  const isWeekDone = status.state === "week_done" || status.week_done;
  const isDayDone = status.state === "day_done" || status.day_done;
  const activeElapsed = status.active_session ? nowMs - status.active_session.started_at : 0;
  const headline = isWeekDone && !status.active_session
    ? "Week complete"
    : isDayDone && !status.active_session
      ? "Done for today"
      : status.active_session
        ? formatDuration(activeElapsed)
        : "Ready when you are";
  const liveWorked = useTimerStore.getState().liveWorkedMs();
  const progressFrac = targetMs > 0 ? Math.min(1, liveWorked / targetMs) : 0;
  const remainingMs = Math.max(0, targetMs - liveWorked);
  const isOver = liveWorked > targetMs && targetMs > 0;

  const inScheduleNow = isCurrentlyInSchedule(blocks);
  const liveCoverageMs = useTimerStore.getState().liveShiftCoverageMs(inScheduleNow);
  const shiftRingFrac =
    isShiftMode && plannedMs > 0 ? shiftProgressFraction(liveWorked, liveCoverageMs, plannedMs) : progressFrac;
  const tasksDone = tasks.filter((t) => t.done).length;

  return (
    <motion.section
      className="card compact-view"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
    >
      <header className="compact-header">
        <div className="brand">
          <Logo size={16} />
          Clockwise
        </div>
        <time className="compact-datetime">
          {now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
          {" \u00B7 "}
          {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: useSettingsStore.getState().appSettings.time_format === "12h" })}
        </time>
        <button className="ghost" onClick={() => void setMode("expanded")}>
          <Menu size={14} />
        </button>
      </header>

      <div className="compact-center">
        <ProgressRing progress={isShiftMode && plannedMs > 0 ? shiftRingFrac : progressFrac}>
          <strong>{isShiftMode && plannedMs > 0 ? Math.round(shiftRingFrac * 100) : Math.round(progressFrac * 100)}%</strong>
          <span className="muted" style={{ fontSize: "0.65rem" }}>
            {formatHoursMinutes(liveWorked)}
          </span>
        </ProgressRing>
        <div className="compact-copy">
          <h1>{headline}</h1>
          <p style={{ minHeight: "2.4em" }}>
            {status.overnight_session && status.active_session
              ? "Continuing overnight shift"
              : stateMessage(status.state, status.next_boundary_ms)}
          </p>
          <div className="compact-info-row">
            {isShiftMode && plannedMs > 0 ? (
              <>
                <span>
                  Worked: <strong>{formatHoursMinutes(liveWorked)}/{formatHoursMinutes(plannedMs)}</strong>
                  {liveCoverageMs < liveWorked ? (
                    <span className="muted"> ({formatHoursMinutes(liveCoverageMs)} in shift)</span>
                  ) : null}
                </span>
                {tasks.length > 0 && (
                  <span>Tasks: <strong>{tasksDone}/{tasks.length}</strong></span>
                )}
              </>
            ) : (
              <>
                <span>Worked: <strong>{formatHoursMinutes(liveWorked)}</strong></span>
                {targetMs > 0 ? (
                  <span>
                    {isOver ? "Over: " : "Left: "}
                    <strong>
                      {isOver
                        ? `+${formatHoursMinutes(liveWorked - targetMs)}`
                        : formatHoursMinutes(remainingMs)}
                    </strong>
                  </span>
                ) : null}
              </>
            )}
            {status.break_today_ms > 0 ? (
              <span>Break: <strong>{formatHoursMinutes(status.break_today_ms)}</strong></span>
            ) : null}
          </div>
        </div>
      </div>

      {offSchedulePrompt && !status.active_session ? <OffScheduleConfirm /> : null}

      <div className="compact-footer">
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <StatusChip state={status.state} />
          {status.off_schedule && status.active_session ? (
            <span className="off-schedule-dot" title="Outside scheduled hours" aria-label="Outside scheduled hours" />
          ) : null}
        </div>
        <div className="row">
          {status.active_session ? (
            <button className="chip" onClick={() => (status.paused ? void resumeBreak() : void startBreak())}>
              {status.paused ? "Resume" : "Break"}
            </button>
          ) : null}
          <ClockButton
            active={Boolean(status.active_session)}
            offSchedule={!status.active_session && useSettingsStore.getState().appSettings.accountability_mode === "shift" && todayBlocks.length > 0 && !isCurrentlyInSchedule(blocks)}
            onClick={() => {
              if (status.active_session) {
                void clockOut();
                return;
              }
              if (isCurrentlyInSchedule(blocks)) {
                void clockIn();
                return;
              }
              setOffSchedulePrompt(true);
            }}
          />
          {!status.active_session && (targetMs > 0 || isDayDone) && (
            <button
              className={`done-toggle ${isDayDone ? "done-toggle-active" : ""}`}
              onClick={async () => {
                const next = !isDayDone;
                await apiMarkDayDone(next);
                void useTimerStore.getState().refreshStatus();
              }}
            >
              {isDayDone ? "Day done ✓" : "Day done"}
            </button>
          )}
        </div>
      </div>
    </motion.section>
  );
}
