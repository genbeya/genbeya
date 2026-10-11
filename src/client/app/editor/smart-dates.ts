/**
 * What `//` offers while writing Markdown: dates by name ("tomorrow",
 * "fri", "end of month"), by distance ("3d", "2 weeks") or as typed
 * ("2026-12-24"), and a calendar. Dates are inserted as ISO dates.
 */
import { addDays, addMonths, endOfMonth, formatDate, isDate, nextWeekday } from "../ui/calendar-date";

export interface DateSuggestion {
  readonly label: string;
  /** The ISO date to insert; null for the calendar, which asks. */
  readonly date: string | null;
}

/** `//` and what follows it, at the end of the text before the cursor; not after a letter, digit or `:` (URLs). */
export const DATE_TRIGGER = /(?<![\p{L}\p{N}_:/])\/\/([\p{L}\p{N} -]*)$/u;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const UNITS: readonly (readonly [RegExp, (from: string, count: number) => string, string, string])[] = [
  [/^d(a(ys?)?)?$/, (from, count) => addDays(from, count), "day", "days"],
  [/^w(e(e(ks?)?)?)?$/, (from, count) => addDays(from, 7 * count), "week", "weeks"],
  [/^m(o(n(t(hs?)?)?)?)?$/, (from, count) => addMonths(from, count), "month", "months"],
  [/^y(e(a(rs?)?)?)?$/, (from, count) => addMonths(from, 12 * count), "year", "years"],
];

const capitalized = (word: string) => word[0]!.toUpperCase() + word.slice(1);

/** The usual choices, with the words that find them. */
function presets(today: string): readonly (DateSuggestion & { readonly words: readonly string[] })[] {
  return [
    { label: "Today", date: today, words: ["today", "now"] },
    { label: "Tomorrow", date: addDays(today, 1), words: ["tomorrow", "tmr"] },
    { label: "Next Monday", date: nextWeekday(today, 1), words: ["next monday", "monday"] },
    { label: "In a week", date: addDays(today, 7), words: ["in a week", "week", "next week"] },
    { label: "End of month", date: endOfMonth(today), words: ["end of month", "eom", "month"] },
    { label: "Pick a date…", date: null, words: ["pick a date", "calendar", "date"] },
  ];
}

/** Dates `query` names, best first; everything usual for an empty query, nothing for one that names no date. */
export function dateSuggestions(query: string, today: string): DateSuggestion[] {
  const text = query.trim().toLowerCase().replace(/\s+/g, " ");
  const found: DateSuggestion[] = [];
  if (isDate(text)) found.push({ label: formatDate(text, { weekday: true }), date: text });
  const day = text.replace(/^next /, "");
  if (day.length >= 2)
    WEEKDAYS.forEach((name, index) => {
      if (name.startsWith(day)) found.push({ label: capitalized(name), date: nextWeekday(today, index) });
    });
  const distance = /^(?:in )?(\d{1,3}) ?([a-z]*)$/.exec(text);
  if (distance) {
    const count = Number(distance[1]);
    for (const [unit, add, one, many] of UNITS)
      if (unit.test(distance[2]!) || !distance[2])
        found.push({ label: `In ${count} ${count === 1 ? one : many}`, date: add(today, count) });
  }
  const usual = presets(today).filter((preset) => !text || preset.words.some((word) => word.startsWith(text)));
  const suggestions = [...found, ...usual];
  // A date shows once, under its first name; the calendar only along with dates.
  const dates = suggestions.filter(
    (suggestion, index) => suggestion.date !== null && suggestions.findIndex((other) => other.date === suggestion.date) === index,
  );
  return dates.length || usual.length ? [...dates, presets(today).at(-1)!] : [];
}
