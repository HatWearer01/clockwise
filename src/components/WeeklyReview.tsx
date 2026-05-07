import { formatHoursMinutes, formatMinuteAsTime } from "../lib/time";
import { useSettingsStore } from "../store/settings";
import type { WeeklyReview as WeeklyReviewType } from "../types";

type Props = {
  review: WeeklyReviewType;
  onClose: () => void;
};

export default function WeeklyReview({ review, onClose }: Props) {
  const tf = useSettingsStore.getState().appSettings.time_format;

  const targetMet = review.total_actual_ms >= review.total_target_ms && review.total_target_ms > 0;
  const pct = review.total_target_ms > 0
    ? Math.round((review.total_actual_ms / review.total_target_ms) * 100)
    : 0;

  return (
    <div className="review-overlay" onClick={onClose}>
      <div className="review-modal" onClick={(e) => e.stopPropagation()}>
        <header className="review-header">
          <h2>Weekly Review</h2>
          <span className="muted">{review.week_label}</span>
        </header>

        <div className="review-grade">
          <div className="review-grade-circle" data-met={targetMet}>
            {pct}%
          </div>
          <span>{targetMet ? "Target met!" : "Short of target"}</span>
        </div>

        <div className="review-stats">
          <div className="review-stat">
            <span className="review-stat-label">Days worked</span>
            <strong>
              {review.days_worked}
              {" "}
              /
              {" "}
              {review.days_scheduled}
            </strong>
          </div>
          <div className="review-stat">
            <span className="review-stat-label">Total hours</span>
            <strong>{formatHoursMinutes(review.total_actual_ms)}</strong>
            <span className="muted">
              of
              {" "}
              {formatHoursMinutes(review.total_target_ms)}
              {" "}
              target
            </span>
          </div>
          <div className="review-stat">
            <span className="review-stat-label">On time</span>
            <strong>
              {review.on_time_days}
              {" "}
              /
              {" "}
              {review.days_scheduled}
              {" "}
              days
            </strong>
          </div>
          {review.avg_start_minute != null && (
            <div className="review-stat">
              <span className="review-stat-label">Avg start</span>
              <strong>{formatMinuteAsTime(review.avg_start_minute, tf)}</strong>
            </div>
          )}
          {review.avg_end_minute != null && (
            <div className="review-stat">
              <span className="review-stat-label">Avg end</span>
              <strong>{formatMinuteAsTime(review.avg_end_minute, tf)}</strong>
            </div>
          )}
          {review.off_schedule_sessions > 0 && (
            <div className="review-stat">
              <span className="review-stat-label">Off-schedule</span>
              <strong>
                {review.off_schedule_sessions}
                {" "}
                session
                {review.off_schedule_sessions !== 1 ? "s" : ""}
              </strong>
            </div>
          )}
        </div>

        <div className="review-days">
          {review.day_details.map((d) => {
            const dayPct = d.target_ms > 0 ? Math.min(100, Math.round((d.actual_ms / d.target_ms) * 100)) : 0;
            const isOff = d.target_ms === 0 && d.actual_ms === 0;
            return (
              <div key={d.label} className={`review-day-row ${isOff ? "review-day-off" : ""}`}>
                <span className="review-day-label">
                  {d.label}
                  {d.on_time && d.target_ms > 0 ? <span className="review-check" title="On time">✓</span> : null}
                </span>
                <div className="review-day-bar-wrap">
                  <div
                    className={`review-day-bar ${d.actual_ms >= d.target_ms && d.target_ms > 0 ? "review-day-bar-met" : ""}`}
                    style={{ width: `${dayPct}%` }}
                  />
                </div>
                <span className="review-day-hours">
                  {isOff ? "off" : `${formatHoursMinutes(d.actual_ms)} / ${formatHoursMinutes(d.target_ms)}`}
                </span>
              </div>
            );
          })}
        </div>

        {review.insights.length > 0 ? (
          <div className="review-insights">
            {review.insights.map((insight) => (
              <div key={insight.kind} className={`insight-card insight-${insight.severity}`}>
                <span className="insight-icon">
                  {insight.severity === "positive" ? "✓" : insight.severity === "warning" ? "!" : "i"}
                </span>
                <span className="insight-message">{insight.message}</span>
              </div>
            ))}
          </div>
        ) : null}

        <button type="button" className="primary" style={{ marginTop: 12, width: "100%" }} onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}
