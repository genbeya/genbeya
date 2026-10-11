import { formatDate } from "../ui/calendar-date";
import { DATE_TRIGGER, dateSuggestions } from "./smart-dates";

/** A Sunday. */
const TODAY = "2026-10-11";
const suggest = (query: string) => dateSuggestions(query, TODAY).map(({ label, date }) => [label, date]);

describe("dateSuggestions", () => {
  it("offers the usual dates and a calendar for an empty query", () => {
    expect(suggest("")).toEqual([
      ["Today", "2026-10-11"],
      ["Tomorrow", "2026-10-12"],
      // Next Monday is tomorrow, so it shows once.
      ["In a week", "2026-10-18"],
      ["End of month", "2026-10-31"],
      ["Pick a date…", null],
    ]);
  });

  it("finds dates by name, weekday and distance", () => {
    expect(suggest("tom")).toEqual([
      ["Tomorrow", "2026-10-12"],
      ["Pick a date…", null],
    ]);
    expect(suggest("fri")[0]).toEqual(["Friday", "2026-10-16"]);
    expect(suggest("next fr")[0]).toEqual(["Friday", "2026-10-16"]);
    expect(suggest("sun")[0]).toEqual(["Sunday", "2026-10-18"]);
    expect(suggest("3d")[0]).toEqual(["In 3 days", "2026-10-14"]);
    expect(suggest("in 2 weeks")[0]).toEqual(["In 2 weeks", "2026-10-25"]);
    expect(suggest("1m")[0]).toEqual(["In 1 month", "2026-11-11"]);
    expect(suggest("1 y")[0]).toEqual(["In 1 year", "2027-10-11"]);
    expect(suggest("eom")[0]).toEqual(["End of month", "2026-10-31"]);
    expect(suggest("5").map(([label]) => label)).toEqual(["In 5 days", "In 5 weeks", "In 5 months", "In 5 years", "Pick a date…"]);
  });

  it("takes ISO dates as typed, and offers nothing for words that name no date", () => {
    expect(suggest("2026-12-24")[0]).toEqual([formatDate("2026-12-24", { weekday: true }), "2026-12-24"]);
    expect(suggest("2026-02-30")).toEqual([]);
    expect(suggest("banana")).toEqual([]);
    expect(suggest("cal")).toEqual([["Pick a date…", null]]);
  });
});

describe("DATE_TRIGGER", () => {
  it("starts after a space or at the start of a line, never inside URLs or words", () => {
    expect(DATE_TRIGGER.exec("Due //tom")?.[1]).toBe("tom");
    expect(DATE_TRIGGER.exec("//")?.[1]).toBe("");
    expect(DATE_TRIGGER.exec("(//next mon")?.[1]).toBe("next mon");
    expect(DATE_TRIGGER.exec("https://example")).toBeNull();
    expect(DATE_TRIGGER.exec("a//b")).toBeNull();
    expect(DATE_TRIGGER.exec("///")).toBeNull();
  });
});
