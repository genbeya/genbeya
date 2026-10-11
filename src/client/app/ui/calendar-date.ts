/**
 * Calendar days as Markdown and frontmatter write them, `2026-10-11`: no
 * time, no zone. Shown in the user's language, with how far away they are
 * and, for things still to do, whether they are due.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY = 86_400_000;

/** Days since the epoch of a valid ISO date ("2026-02-30" is none); null otherwise. */
export function dayNumber(iso: string): number | null {
  const match = ISO_DATE.exec(iso);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? time / DAY : null;
}

export const isDate = (iso: string): boolean => dayNumber(iso) !== null;

/** The ISO date of a day number. */
const isoOf = (days: number): string => new Date(days * DAY).toISOString().slice(0, 10);

/** Today on this computer's calendar. */
export function today(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whole days from `from` to `to`; negative when `to` is earlier. Both must be valid. */
export const daysBetween = (from: string, to: string): number => dayNumber(to)! - dayNumber(from)!;

export const addDays = (iso: string, days: number): string => isoOf(dayNumber(iso)! + days);

/** The same day `months` later, or the month's last day when it is shorter (31 Jan + 1 month = 28 Feb). */
export function addMonths(iso: string, months: number): string {
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return isoOf(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, last)) / DAY);
}

export function endOfMonth(iso: string): string {
  const [year, month] = iso.split("-").map(Number) as [number, number];
  return isoOf(Date.UTC(year, month, 0) / DAY);
}

/** 0 for Sunday to 6 for Saturday, as `Date.getDay`. */
export const weekday = (iso: string): number => new Date(dayNumber(iso)! * DAY).getUTCDay();

/** The next `day` (0 Sunday … 6 Saturday) after `iso`: a week later when `iso` is one. */
export const nextWeekday = (iso: string, day: number): string => addDays(iso, ((day - weekday(iso) + 6) % 7) + 1);

/** "11 Oct 2026", or the user's language's way of writing it; `weekday` adds the day ("Sun, 11 Oct 2026"). */
export function formatDate(iso: string, options: { weekday?: boolean } = {}): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(options.weekday ? { weekday: "short" } : {}),
  }).format(new Date(dayNumber(iso)! * DAY));
}

/** "today", "in 3 days", "2 weeks ago", "next month", in the user's language. */
export function relativeDay(iso: string, from: string): string {
  const days = daysBetween(from, iso);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const size = Math.abs(days);
  if (size < 7) return format.format(days, "day");
  if (size < 30) return format.format(Math.round(days / 7), "week");
  if (size < 365) return format.format(Math.round(days / 30.44), "month");
  return format.format(Math.round(days / 365.25), "year");
}

/** Open work due within this many days is due soon. */
export const DUE_SOON_DAYS = 2;

export type DueTone = "overdue" | "soon";

/** How urgent open work due on `iso` is on `on`; null when it is not due yet, or for work done. */
export function dueTone(iso: string, on: string, done = false): DueTone | null {
  if (done) return null;
  const days = daysBetween(on, iso);
  return days < 0 ? "overdue" : days <= DUE_SOON_DAYS ? "soon" : null;
}
