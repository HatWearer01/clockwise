import { Play, Square } from "lucide-react";

type ClockButtonProps = {
  active: boolean;
  onClick: () => void;
  offSchedule?: boolean;
};

export default function ClockButton({ active, onClick, offSchedule }: ClockButtonProps) {
  const cls = active
    ? "clock-button clock-button-stop"
    : offSchedule
      ? "clock-button clock-button-off-schedule"
      : "clock-button clock-button-start";

  return (
    <button className={cls} onClick={onClick}>
      {active ? <Square size={16} /> : <Play size={16} />}
      {active ? "Clock out" : "Clock in"}
    </button>
  );
}
