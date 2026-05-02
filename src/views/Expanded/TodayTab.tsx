import ClockButton from "../../components/ClockButton";
import ProgressRing from "../../components/ProgressRing";
import StatusChip from "../../components/StatusChip";
import {
  blockDurationMs,
  formatDuration,
  formatHoursMinutes,
  formatMinuteAsTime,
  formatShortTime,
  pct,
  stateMessage,
  todayDateString,
} from "../../lib/time";
import { useScheduleStore } from "../../store/schedule";
import { useTimerStore } from "../../store/timer";

export default function TodayTab() {
  const { status, nowMs, clockIn, clockOut, startBreak, resumeBreak } = useTimerStore();
  const { blocks } = useScheduleStore();

  if (!status) return <p className="muted">Loading today...</p>;

  const isWeekDone = status.state === "week_done" || status.week_done;
  const todayDow = new Date().getDay();
  const todayBlocks = blocks
    .filter((b) => b.day_of_week === todayDow)
    .sort((a, b) => a.start_min - b.start_min);
  const plannedMs = todayBlocks.reduce((s, b) => s + blockDurationMs(b.start_min, b.end_min), 0);
  const scheduleStart = todayBlocks.length > 0 ? todayBlocks[0].start_min : null;
  const scheduleEnd = todayBlocks.length > 0 ? todayBlocks[todayBlocks.length - 1].end_min : null;

  const activeElapsed = status.active_session
    ? nowMs - status.active_session.started_at
    : 0;
  const workedMs = useTimerStore.getState().liveWorkedMs();
  const remainingMs = Math.max(0, plannedMs - workedMs);
  const progress = pct(workedMs, plannedMs);
  const progressFrac = plannedMs > 0 ? Math.min(1, workedMs / plannedMs) : 0;
  const isOvertime = workedMs > plannedMs && plannedMs > 0;

  return (
    <section className="tab-panel">
      <div className="today-header">
        <div>
          <h2 style={{ marginBottom: 2 }}>{todayDateString()}</h2>
          <p className="muted" style={{ margin: 0, fontSize: "0.88rem" }}>
            {stateMessage(status.state, status.next_boundary_ms)}
          </p>
        </div>
        <StatusChip state={status.state} />
      </div>

      <div className="today-hero">
        <ProgressRing progress={progressFrac}>
          <strong>{progress}%</strong>
          <span className="muted" style={{ fontSize: "0.72rem" }}>done</span>
        </ProgressRing>

        <div className="today-stats-col">
          {status.active_session ? (
            <div className="today-stat today-stat-highlight">
              <span className="today-stat-label">Current session</span>
              <span className="today-stat-value">{formatDuration(activeElapsed)}</span>
              <span className="muted" style={{ fontSize: "0.78rem" }}>
                Started at {formatShortTime(status.active_session.started_at)}
              </span>
            </div>
          ) : null}

          <div className="today-stat">
            <span className="today-stat-label">Worked today</span>
            <span className="today-stat-value">{formatHoursMinutes(workedMs)}</span>
          </div>

          {status.break_today_ms > 0 ? (
            <div className="today-stat">
              <span className="today-stat-label">Break time</span>
              <span className="today-stat-value">{formatHoursMinutes(status.break_today_ms)}</span>
            </div>
          ) : null}

          {plannedMs > 0 ? (
            <div className="today-stat">
              <span className="today-stat-label">
                {isOvertime ? "Overtime" : "Remaining"}
              </span>
              <span className="today-stat-value">
                {isOvertime
                  ? `+${formatHoursMinutes(workedMs - plannedMs)}`
                  : formatHoursMinutes(remainingMs)}
              </span>
            </div>
          ) : null}

          <div className="today-stat">
            <span className="today-stat-label">Today's schedule</span>
            <span className="today-stat-value" style={{ fontSize: "0.95rem" }}>
              {scheduleStart !== null && scheduleEnd !== null
                ? `${formatMinuteAsTime(scheduleStart)} - ${formatMinuteAsTime(scheduleEnd)} (${formatHoursMinutes(plannedMs)})`
                : "No shift today"}
            </span>
          </div>
        </div>
      </div>

      {plannedMs > 0 ? (
        <div className="today-progress-bar-wrap">
          <div className="today-progress-track">
            <div
              className={`today-progress-fill ${isOvertime ? "today-progress-overtime" : ""}`}
              style={{ width: `${Math.min(100, progress)}%` }}
            />
          </div>
          <div className="row between" style={{ fontSize: "0.78rem" }}>
            <span className="muted">0h</span>
            <span className="muted">{formatHoursMinutes(plannedMs)} target</span>
          </div>
        </div>
      ) : null}

      <div className="today-actions">
        {status.active_session ? (
          <button
            className={`chip ${status.paused ? "chip-active" : ""}`}
            onClick={() => (status.paused ? void resumeBreak() : void startBreak())}
          >
            {status.paused ? "Resume work" : "Take a break"}
          </button>
        ) : null}
        <ClockButton
          active={Boolean(status.active_session)}
          onClick={() => (status.active_session ? void clockOut() : void clockIn())}
        />
      </div>
    </section>
  );
}
