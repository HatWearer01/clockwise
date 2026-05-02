import type { StatusState } from "../types";

type StatusChipProps = {
  state: StatusState;
};

const LABELS: Record<StatusState, string> = {
  on_clock: "On the clock",
  on_break: "On break",
  off_day: "Off day",
  before_shift: "Starts later",
  in_shift: "In shift",
  after_shift: "After shift",
  week_done: "Week done",
};

export default function StatusChip({ state }: StatusChipProps) {
  return (
    <span className={`status-chip status-chip-${state}`}>
      <span className="status-chip-dot" />
      {LABELS[state]}
    </span>
  );
}
