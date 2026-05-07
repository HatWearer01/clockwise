import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StatusChip from "./StatusChip";
import type { StatusState } from "../types";

describe("StatusChip", () => {
  const states: Array<{ state: StatusState; label: string }> = [
    { state: "on_clock", label: "On the clock" },
    { state: "on_break", label: "On break" },
    { state: "off_day", label: "Off day" },
    { state: "before_shift", label: "Starts later" },
    { state: "in_shift", label: "In shift" },
    { state: "after_shift", label: "After shift" },
    { state: "week_done", label: "Week done" },
    { state: "day_done", label: "Done for today" },
    { state: "behind_target", label: "Behind target" },
  ];

  for (const { state, label } of states) {
    it(`renders "${label}" for state "${state}"`, () => {
      render(<StatusChip state={state} />);
      expect(screen.getByText(label)).toBeInTheDocument();
    });

    it(`applies correct CSS class for "${state}"`, () => {
      const { container } = render(<StatusChip state={state} />);
      expect(container.querySelector(`.status-chip-${state}`)).toBeInTheDocument();
    });
  }

  it("renders the dot element", () => {
    const { container } = render(<StatusChip state="on_clock" />);
    expect(container.querySelector(".status-chip-dot")).toBeInTheDocument();
  });
});
