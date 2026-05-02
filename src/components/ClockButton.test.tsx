import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ClockButton from "./ClockButton";

describe("ClockButton", () => {
  it("renders Clock in when inactive", () => {
    render(<ClockButton active={false} onClick={() => {}} />);
    expect(screen.getByText("Clock in")).toBeInTheDocument();
  });

  it("renders Clock out when active", () => {
    render(<ClockButton active={true} onClick={() => {}} />);
    expect(screen.getByText("Clock out")).toBeInTheDocument();
  });

  it("applies start class when inactive", () => {
    const { container } = render(<ClockButton active={false} onClick={() => {}} />);
    expect(container.querySelector(".clock-button-start")).toBeInTheDocument();
  });

  it("applies stop class when active", () => {
    const { container } = render(<ClockButton active={true} onClick={() => {}} />);
    expect(container.querySelector(".clock-button-stop")).toBeInTheDocument();
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<ClockButton active={false} onClick={onClick} />);
    fireEvent.click(screen.getByText("Clock in"));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
