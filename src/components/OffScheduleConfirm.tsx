import { useTimerStore } from "../store/timer";

export default function OffScheduleConfirm() {
  const { clockIn, setOffSchedulePrompt } = useTimerStore();

  return (
    <div className="off-schedule-confirm" role="dialog" aria-live="polite">
      <span>You&apos;re clocking in outside your schedule. Continue?</span>
      <div className="button-group">
        <button
          type="button"
          className="chip chip-active"
          onClick={() => void clockIn()}
        >
          Yes, clock in
        </button>
        <button type="button" className="chip" onClick={() => setOffSchedulePrompt(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
