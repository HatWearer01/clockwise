import { Menu } from "lucide-react";
import { motion } from "framer-motion";
import ClockButton from "../components/ClockButton";
import ProgressRing from "../components/ProgressRing";
import StatusChip from "../components/StatusChip";
import {
  blockDurationMs,
  formatDuration,
  formatHoursMinutes,
  stateMessage,
} from "../lib/time";
import { apiMarkDayDone } from "../lib/tauri";
import { useScheduleStore } from "../store/schedule";
import { useSettingsStore } from "../store/settings";
import { useTimerStore } from "../store/timer";

export default function Compact() {
  const { status, nowMs, clockIn, clockOut, startBreak, resumeBreak } = useTimerStore();
  const { setMode } = useSettingsStore();
  const { blocks } = useScheduleStore();

  if (!status) return <section className="card">Loading...</section>;

  const todayDow = new Date().getDay();
  const todayBlocks = blocks.filter((b) => b.day_of_week === todayDow);
  const plannedMs = todayBlocks.reduce((s, b) => s + blockDurationMs(b.start_min, b.end_min), 0);

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
  const progressFrac = plannedMs > 0 ? Math.min(1, liveWorked / plannedMs) : 0;
  const remainingMs = Math.max(0, plannedMs - liveWorked);
  const isOver = liveWorked > plannedMs && plannedMs > 0;

  return (
    <motion.section
      className="card compact-view"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
    >
      <header className="compact-header">
        <div className="brand">
          <img src="/app-icon.png" alt="" width={16} height={16} />
          Clockwise
        </div>
        <button className="ghost" onClick={() => void setMode("expanded")}>
          <Menu size={14} />
        </button>
      </header>

      <motion.div className="compact-center" layout transition={{ type: "spring", stiffness: 260, damping: 24 }}>
        <ProgressRing progress={progressFrac}>
          <strong>{Math.round(progressFrac * 100)}%</strong>
          <span className="muted" style={{ fontSize: "0.65rem" }}>{formatHoursMinutes(liveWorked)}</span>
        </ProgressRing>
        <div className="compact-copy">
          <h1>{headline}</h1>
          <p>{stateMessage(status.state, status.next_boundary_ms)}</p>
          <div className="compact-info-row">
            <span>Worked: <strong>{formatHoursMinutes(liveWorked)}</strong></span>
            {status.break_today_ms > 0 ? (
              <span>Break: <strong>{formatHoursMinutes(status.break_today_ms)}</strong></span>
            ) : null}
            {plannedMs > 0 ? (
              <span>
                {isOver ? "Over: " : "Left: "}
                <strong>
                  {isOver
                    ? `+${formatHoursMinutes(liveWorked - plannedMs)}`
                    : formatHoursMinutes(remainingMs)}
                </strong>
              </span>
            ) : null}
          </div>
        </div>
      </motion.div>

      <div className="compact-footer">
        <StatusChip state={status.state} />
        <div className="row">
          {status.active_session ? (
            <button className="chip" onClick={() => (status.paused ? void resumeBreak() : void startBreak())}>
              {status.paused ? "Resume" : "Break"}
            </button>
          ) : null}
          <ClockButton active={Boolean(status.active_session)} onClick={() => (status.active_session ? void clockOut() : void clockIn())} />
          {!status.active_session && plannedMs > 0 && (
            <button
              className={`chip ${isDayDone ? "chip-active" : ""}`}
              style={{ fontSize: "0.75rem", padding: "2px 8px" }}
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
