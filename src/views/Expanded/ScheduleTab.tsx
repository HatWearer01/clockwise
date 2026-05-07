import { blockDurationMs, dayName, formatHoursMinutes, parseTimeInput, timeInputValue } from "../../lib/time";
import { useScheduleStore } from "../../store/schedule";
import { useSettingsStore } from "../../store/settings";
import { useTimerStore } from "../../store/timer";

const DAYS_MON = [1, 2, 3, 4, 5, 6, 0]; // Mon-Sun
const DAYS_SUN = [0, 1, 2, 3, 4, 5, 6]; // Sun-Sat

export default function ScheduleTab() {
  const { addBlock, updateBlock, deleteBlock, getDayBlocks, getDayTarget, setDayTarget, saving, save, saveDayTargets } =
    useScheduleStore();
  const { refreshStatus } = useTimerStore();
  const wsd = useSettingsStore().appSettings.week_start_day;
  const DAYS = wsd === 0 ? DAYS_SUN : DAYS_MON;

  const todayDow = new Date().getDay();

  const totalWeeklyMs = DAYS.reduce((sum, day) => {
    const dayBlocks = getDayBlocks(day);
    const target = getDayTarget(day);
    if (target > 0) return sum + target * 60_000;
    return sum + dayBlocks.reduce((s, b) => s + blockDurationMs(b.start_min, b.end_min), 0);
  }, 0);
  const workDays = DAYS.filter((day) => getDayBlocks(day).length > 0).length;

  async function handleSave() {
    await saveDayTargets();
    await save();
    await refreshStatus();
  }

  return (
    <section className="tab-panel">
      <div className="schedule-header-row">
        <div>
          <h2 style={{ margin: 0 }}>Schedule</h2>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: "0.85rem" }}>
            Set your working hours for each day of the week.
          </p>
        </div>
        <div className="schedule-summary">
          <span><strong>{formatHoursMinutes(totalWeeklyMs)}</strong> / week</span>
          <span className="muted">{workDays} day{workDays !== 1 ? "s" : ""}</span>
        </div>
      </div>

      <div className="schedule-simple">
        {DAYS.map((day) => {
          const dayBlocks = getDayBlocks(day);
          const block = dayBlocks[0] ?? null;
          const active = block !== null;
          const isToday = day === todayDow;
          const blockMs = active ? blockDurationMs(block.start_min, block.end_min) : 0;
          const target = getDayTarget(day);
          const targetHours = target > 0 ? target / 60 : "";
          const placeholderHours =
            active && blockMs > 0 ? (blockMs / 3_600_000).toFixed(1) : "No target";

          return (
            <div
              key={day}
              className={`schedule-day-row ${active ? "" : "schedule-day-off"} ${isToday ? "schedule-day-today" : ""}`}
            >
              <span className="schedule-day-name">
                {dayName(day)}
                {isToday ? <span className="week-today-dot" /> : null}
              </span>

              <button
                className={active ? "chip chip-active" : "chip"}
                onClick={() => {
                  if (active) {
                    dayBlocks.forEach((b) => deleteBlock(b.id));
                  } else {
                    addBlock(day, 9 * 60, 17 * 60);
                  }
                }}
              >
                {active ? "On" : "Off"}
              </button>

              {active ? (
                <div className="schedule-times">
                  <input
                    type="time"
                    value={timeInputValue(block.start_min)}
                    onChange={(e) => updateBlock(block.id, { start_min: parseTimeInput(e.currentTarget.value) })}
                  />
                  <span className="muted">to</span>
                  <input
                    type="time"
                    value={timeInputValue(block.end_min)}
                    onChange={(e) => updateBlock(block.id, { end_min: parseTimeInput(e.currentTarget.value) })}
                  />
                  <span className="muted schedule-day-hours">{formatHoursMinutes(blockMs)}</span>
                </div>
              ) : (
                <div className="schedule-times">
                  <span className="muted">Day off</span>
                </div>
              )}

              <div className="schedule-day-target">
                <span className="muted" style={{ fontSize: "0.78rem", whiteSpace: "nowrap" }}>
                  Target:
                </span>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  className={`schedule-target-input ${target === 0 ? "schedule-target-placeholder" : ""}`}
                  value={targetHours}
                  placeholder={placeholderHours}
                  onChange={(e) => {
                    const raw = e.currentTarget.value;
                    if (raw === "") {
                      setDayTarget(day, 0);
                      return;
                    }
                    const h = parseFloat(raw);
                    if (Number.isNaN(h) || h < 0) return;
                    setDayTarget(day, Math.round(h * 60));
                  }}
                  aria-label={`Target hours for ${dayName(day)}`}
                />
                <span className="muted" style={{ fontSize: "0.78rem" }}>
                  h
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <button className="primary" disabled={saving} onClick={() => void handleSave()}>
        {saving ? "Saving..." : "Save schedule"}
      </button>
    </section>
  );
}
