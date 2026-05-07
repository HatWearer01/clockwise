import { describe, it, expect, vi, afterEach } from "vitest";
import type { ScheduleBlock } from "../types";
import {
  dayName,
  dayNameShort,
  formatDuration,
  formatHoursMinutes,
  formatDecimalHours,
  formatMinuteAsTime,
  isCurrentlyInSchedule,
  timeInputValue,
  parseTimeInput,
  weekDayDates,
  pct,
  stateLabel,
  stateMessage,
} from "./time";

describe("dayName", () => {
  it("returns full day names for valid indices", () => {
    expect(dayName(0)).toBe("Sunday");
    expect(dayName(1)).toBe("Monday");
    expect(dayName(6)).toBe("Saturday");
  });

  it("returns Unknown for out-of-range", () => {
    expect(dayName(7)).toBe("Unknown");
    expect(dayName(-1)).toBe("Unknown");
  });
});

describe("dayNameShort", () => {
  it("returns short day names", () => {
    expect(dayNameShort(0)).toBe("Sun");
    expect(dayNameShort(5)).toBe("Fri");
  });

  it("returns ? for out-of-range", () => {
    expect(dayNameShort(9)).toBe("?");
  });
});

describe("formatDuration", () => {
  it("formats zero", () => {
    expect(formatDuration(0)).toBe("0h 00m 00s");
  });

  it("formats negative as zero", () => {
    expect(formatDuration(-5000)).toBe("0h 00m 00s");
  });

  it("formats hours, minutes, seconds", () => {
    const ms = (2 * 3600 + 15 * 60 + 30) * 1000;
    expect(formatDuration(ms)).toBe("2h 15m 30s");
  });

  it("pads minutes and seconds", () => {
    const ms = (1 * 3600 + 5 * 60 + 3) * 1000;
    expect(formatDuration(ms)).toBe("1h 05m 03s");
  });
});

describe("formatHoursMinutes", () => {
  it("returns seconds for less than a minute", () => {
    expect(formatHoursMinutes(30_000)).toBe("30s");
  });

  it("returns minutes and seconds for short durations", () => {
    expect(formatHoursMinutes(150_000)).toBe("2m 30s"); // 2.5 minutes
  });

  it("returns just minutes for 5+ min under 1 hour", () => {
    expect(formatHoursMinutes(600_000)).toBe("10m");
  });

  it("returns hours for exact hour", () => {
    expect(formatHoursMinutes(3_600_000)).toBe("1h");
  });

  it("returns hours and minutes for mixed", () => {
    expect(formatHoursMinutes(5_400_000)).toBe("1h 30m");
  });

  it("handles zero", () => {
    expect(formatHoursMinutes(0)).toBe("0s");
  });

  it("handles negative as zero", () => {
    expect(formatHoursMinutes(-100)).toBe("0s");
  });
});

describe("formatDecimalHours", () => {
  it("converts ms to decimal hours", () => {
    expect(formatDecimalHours(3_600_000)).toBe("1.0h");
    expect(formatDecimalHours(5_400_000)).toBe("1.5h");
    expect(formatDecimalHours(0)).toBe("0.0h");
  });
});

describe("formatMinuteAsTime", () => {
  it("formats midnight 12h", () => {
    expect(formatMinuteAsTime(0)).toBe("12:00 AM");
    expect(formatMinuteAsTime(0, "12h")).toBe("12:00 AM");
  });

  it("formats noon 12h", () => {
    expect(formatMinuteAsTime(720)).toBe("12:00 PM");
  });

  it("formats morning time 12h", () => {
    expect(formatMinuteAsTime(540)).toBe("9:00 AM");
  });

  it("formats afternoon time 12h", () => {
    expect(formatMinuteAsTime(810)).toBe("1:30 PM");
  });

  it("formats 11 PM 12h", () => {
    expect(formatMinuteAsTime(1380)).toBe("11:00 PM");
  });

  it("formats midnight 24h", () => {
    expect(formatMinuteAsTime(0, "24h")).toBe("00:00");
  });

  it("formats noon 24h", () => {
    expect(formatMinuteAsTime(720, "24h")).toBe("12:00");
  });

  it("formats morning 24h", () => {
    expect(formatMinuteAsTime(540, "24h")).toBe("09:00");
  });

  it("formats afternoon 24h", () => {
    expect(formatMinuteAsTime(810, "24h")).toBe("13:30");
  });

  it("formats 11 PM 24h", () => {
    expect(formatMinuteAsTime(1380, "24h")).toBe("23:00");
  });
});

describe("timeInputValue", () => {
  it("converts minutes to HH:MM", () => {
    expect(timeInputValue(540)).toBe("09:00");
    expect(timeInputValue(1020)).toBe("17:00");
    expect(timeInputValue(0)).toBe("00:00");
    expect(timeInputValue(90)).toBe("01:30");
  });
});

describe("parseTimeInput", () => {
  it("parses HH:MM to minutes", () => {
    expect(parseTimeInput("09:00")).toBe(540);
    expect(parseTimeInput("17:00")).toBe(1020);
    expect(parseTimeInput("00:00")).toBe(0);
    expect(parseTimeInput("01:30")).toBe(90);
  });
});

describe("weekDayDates", () => {
  it("returns 7 days with Monday start (default)", () => {
    const days = weekDayDates(0, 1);
    expect(days).toHaveLength(7);
    expect(days[0].dow).toBe(1); // Monday
    expect(days[6].dow).toBe(0); // Sunday
  });

  it("returns 7 days with Sunday start", () => {
    const days = weekDayDates(0, 0);
    expect(days).toHaveLength(7);
    expect(days[0].dow).toBe(0); // Sunday
    expect(days[6].dow).toBe(6); // Saturday
  });

  it("week offset shifts by 7 days", () => {
    const current = weekDayDates(0, 1);
    const prev = weekDayDates(-1, 1);
    const currentStart = new Date(current[0].date + "T00:00:00");
    const prevStart = new Date(prev[0].date + "T00:00:00");
    const diffDays = (currentStart.getTime() - prevStart.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBe(7);
  });
});

describe("isCurrentlyInSchedule", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns false when there are no blocks for today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T12:00:00")); // Wednesday
    const blocks: ScheduleBlock[] = [
      { id: 1, template_id: 1, day_of_week: 1, start_min: 540, end_min: 1020, label: "Work", color: "#000" },
    ];
    expect(isCurrentlyInSchedule(blocks)).toBe(false);
  });

  it("returns true when now is inside a same-day block", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T14:00:00"));
    const dow = new Date("2026-05-06T14:00:00").getDay();
    const blocks: ScheduleBlock[] = [
      { id: 1, template_id: 1, day_of_week: dow, start_min: 540, end_min: 1020, label: "Work", color: "#000" },
    ];
    expect(isCurrentlyInSchedule(blocks)).toBe(true);
  });

  it("returns true when now is in an overnight block before midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T23:00:00"));
    const dow = new Date("2026-05-06T23:00:00").getDay();
    const blocks: ScheduleBlock[] = [
      { id: 1, template_id: 1, day_of_week: dow, start_min: 1320, end_min: 360, label: "Night", color: "#000" },
    ];
    expect(isCurrentlyInSchedule(blocks)).toBe(true);
  });

  it("returns true when now is in an overnight block after midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T02:00:00"));
    const dow = new Date("2026-05-07T02:00:00").getDay();
    const blocks: ScheduleBlock[] = [
      { id: 1, template_id: 1, day_of_week: dow, start_min: 1320, end_min: 360, label: "Night", color: "#000" },
    ];
    expect(isCurrentlyInSchedule(blocks)).toBe(true);
  });
});

describe("pct", () => {
  it("returns 0 when planned is 0", () => {
    expect(pct(100, 0)).toBe(0);
    expect(pct(100, -5)).toBe(0);
  });

  it("caps at 100", () => {
    expect(pct(200, 100)).toBe(100);
  });

  it("calculates percentage correctly", () => {
    expect(pct(50, 100)).toBe(50);
    expect(pct(75, 100)).toBe(75);
    expect(pct(1, 3)).toBe(33);
  });
});

describe("stateLabel", () => {
  it("returns correct labels for all states", () => {
    expect(stateLabel("on_clock")).toBe("Working");
    expect(stateLabel("on_break")).toBe("On break");
    expect(stateLabel("off_day")).toBe("Day off");
    expect(stateLabel("before_shift")).toBe("Before shift");
    expect(stateLabel("in_shift")).toBe("Shift active");
    expect(stateLabel("after_shift")).toBe("After shift");
    expect(stateLabel("week_done")).toBe("Week done");
    expect(stateLabel("day_done")).toBe("Done for today");
  });
});

describe("stateMessage", () => {
  it("returns message for on_clock", () => {
    expect(stateMessage("on_clock", null)).toBe("You are clocked in and on the clock.");
  });

  it("returns message for on_break", () => {
    expect(stateMessage("on_break", null)).toBe("Break is active. Resume when you're ready.");
  });

  it("returns message for off_day", () => {
    expect(stateMessage("off_day", null)).toBe("No shift scheduled today. Enjoy your day off.");
  });

  it("returns message for before_shift without boundary", () => {
    expect(stateMessage("before_shift", null)).toBe("Your shift starts later today.");
  });

  it("returns message for before_shift with boundary", () => {
    const msg = stateMessage("before_shift", Date.now());
    expect(msg).toContain("Your shift starts at");
    expect(msg).toContain("Clock in when you're ready.");
  });

  it("returns message for in_shift", () => {
    expect(stateMessage("in_shift", null)).toBe(
      "You're within your scheduled hours. Clock in to start tracking."
    );
  });

  it("returns message for after_shift", () => {
    expect(stateMessage("after_shift", null)).toBe("Your scheduled shift has ended for today.");
  });

  it("returns message for week_done", () => {
    expect(stateMessage("week_done", null)).toBe("You're done for the week. Enjoy your time off!");
  });

  it("returns message for day_done", () => {
    expect(stateMessage("day_done", null)).toBe("You're done for today. See you tomorrow!");
  });
});
