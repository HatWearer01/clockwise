import { Play, Square } from "lucide-react";

type ClockButtonProps = {
  active: boolean;
  onClick: () => void;
};

export default function ClockButton({ active, onClick }: ClockButtonProps) {
  return (
    <button className={`clock-button ${active ? "clock-button-stop" : "clock-button-start"}`} onClick={onClick}>
      {active ? <Square size={16} /> : <Play size={16} />}
      {active ? "Clock out" : "Clock in"}
    </button>
  );
}
