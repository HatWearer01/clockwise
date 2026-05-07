import { weekRangeLabel } from "../lib/time";

interface WeekNavProps {
  weekOffset: number;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  wsd: 0 | 1;
  currentLabel?: string;
}

export default function WeekNav({ weekOffset, onPrev, onNext, onToday, wsd, currentLabel }: WeekNavProps) {
  const isCurrentWeek = weekOffset === 0;

  return (
    <div className="tasks-week-nav">
      <button className="ghost daily-task-btn" onClick={onPrev} title="Previous week">
        &#x2039;
      </button>
      <span className="tasks-week-label">
        {isCurrentWeek ? (currentLabel ?? "This week") : weekRangeLabel(weekOffset, wsd)}
      </span>
      <button
        className="ghost daily-task-btn"
        onClick={onNext}
        title="Next week"
        disabled={weekOffset >= 0}
      >
        &#x203A;
      </button>
      {!isCurrentWeek && (
        <button className="chip" style={{ fontSize: "0.72rem", marginLeft: 4 }} onClick={onToday}>
          Today
        </button>
      )}
    </div>
  );
}
