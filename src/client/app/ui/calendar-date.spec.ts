import {
  addDays,
  addMonths,
  dayNumber,
  dueTone,
  endOfMonth,
  formatDate,
  isDate,
  nextWeekday,
  relativeDay,
  today,
  weekday,
} from "./calendar-date";

describe("calendar dates", () => {
  it("are valid ISO dates only", () => {
    expect(isDate("2026-10-11")).toBe(true);
    expect(isDate("2028-02-29")).toBe(true);
    for (const text of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-00-10", "2026-1-1", "20261011", "2026-10-11T10:00"])
      expect(isDate(text)).toBe(false);
    expect(dayNumber("1970-01-02")).toBe(1);
  });

  it("are today's on this computer's calendar", () => {
    expect(today(new Date(2026, 9, 11, 23, 59))).toBe("2026-10-11");
  });

  it("count days, months and weekdays", () => {
    expect(addDays("2026-10-11", 1)).toBe("2026-10-12");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-15", 2)).toBe("2027-01-15");
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
    // 2026-10-11 is a Sunday.
    expect(weekday("2026-10-11")).toBe(0);
    expect(nextWeekday("2026-10-11", 1)).toBe("2026-10-12");
    expect(nextWeekday("2026-10-11", 0)).toBe("2026-10-18");
    expect(nextWeekday("2026-10-11", 5)).toBe("2026-10-16");
  });

  it("show in the user's language, with how far away they are", () => {
    expect(formatDate("2026-10-11")).toBe(
      new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(2026, 9, 11)),
    );
    expect(relativeDay("2026-10-11", "2026-10-11")).toMatch(/today/);
    expect(relativeDay("2026-10-12", "2026-10-11")).toMatch(/tomorrow/);
    expect(relativeDay("2026-10-14", "2026-10-11")).toMatch(/in 3 days/);
    expect(relativeDay("2026-09-27", "2026-10-11")).toMatch(/2 weeks ago/);
    expect(relativeDay("2027-01-11", "2026-10-11")).toMatch(/in 3 months/);
    expect(relativeDay("2024-10-11", "2026-10-11")).toMatch(/2 years ago/);
  });

  it("are overdue once passed, and due soon within two days, for open work only", () => {
    expect(dueTone("2026-10-10", "2026-10-11")).toBe("overdue");
    expect(dueTone("2026-10-11", "2026-10-11")).toBe("soon");
    expect(dueTone("2026-10-13", "2026-10-11")).toBe("soon");
    expect(dueTone("2026-10-14", "2026-10-11")).toBeNull();
    expect(dueTone("2026-10-10", "2026-10-11", true)).toBeNull();
  });
});
