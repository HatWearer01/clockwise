import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ProgressRing from "./ProgressRing";

describe("ProgressRing", () => {
  it("renders SVG with track and value circles", () => {
    const { container } = render(<ProgressRing progress={0.5} />);
    const circles = container.querySelectorAll("circle");
    expect(circles).toHaveLength(2);
    expect(container.querySelector(".progress-ring-track")).toBeInTheDocument();
    expect(container.querySelector(".progress-ring-value")).toBeInTheDocument();
  });

  it("sets strokeDashoffset based on progress", () => {
    const { container } = render(<ProgressRing progress={0.5} />);
    const valueCircle = container.querySelector(".progress-ring-value");
    const circumference = 2 * Math.PI * 52;
    const expectedOffset = circumference * 0.5;
    expect(valueCircle).toHaveAttribute(
      "stroke-dashoffset",
      String(expectedOffset)
    );
  });

  it("clamps progress at 0", () => {
    const { container } = render(<ProgressRing progress={-0.5} />);
    const valueCircle = container.querySelector(".progress-ring-value");
    const circumference = 2 * Math.PI * 52;
    expect(valueCircle).toHaveAttribute(
      "stroke-dashoffset",
      String(circumference) // offset = circumference * (1 - 0) = full
    );
  });

  it("clamps progress at 1", () => {
    const { container } = render(<ProgressRing progress={1.5} />);
    const valueCircle = container.querySelector(".progress-ring-value");
    expect(valueCircle).toHaveAttribute("stroke-dashoffset", "0");
  });

  it("renders children in inner div", () => {
    render(
      <ProgressRing progress={0.75}>
        <span>75%</span>
      </ProgressRing>
    );
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("does not render inner div when no children", () => {
    const { container } = render(<ProgressRing progress={0.5} />);
    expect(container.querySelector(".progress-ring-inner")).not.toBeInTheDocument();
  });
});
