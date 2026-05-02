import type { ReactNode } from "react";

type ProgressRingProps = {
  progress: number;
  children?: ReactNode;
};

export default function ProgressRing({ progress, children }: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(1, progress));
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped);

  return (
    <div className="progress-ring-wrap">
      <svg viewBox="0 0 120 120" className="progress-ring">
        <circle cx="60" cy="60" r={radius} className="progress-ring-track" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          className="progress-ring-value"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      {children ? <div className="progress-ring-inner">{children}</div> : null}
    </div>
  );
}
