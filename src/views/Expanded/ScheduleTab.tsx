import { blockDurationMs, dayName, formatHoursMinutes, parseTimeInput, timeInputValue } from "../../lib/time";
import { useScheduleStore } from "../../store/schedule";
import { useTimerStore } from "../../store/timer";

const DAYS = [1, 2, 3, 4, 5, 6, 0]; // Mon-Sun

export default function ScheduleTab() {
  const { addBlock, updateBlock, deleteBlock, getDayBlocks, saving, save } = useScheduleStore();
  const { refreshStatus } = useTimerStore();

  const todayDow = new Date().getDay();

  const totalWeeklyMs = DAYS.reduce((sum, day) => {
    const dayBlocks = getDayBlocks(day);
    return sum + dayBlocks.reduce((s, b) => s + blockDurationMs(b.start_min, b.end_min), 0);
  }, 0);
  const workDays = DAYS.filter((day) => getDayBlocks(day).length > 0).length;

  async function handleSave() {
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
