/**
 * Dates written as `2026-10-11` show as chips in the user's language, with
 * how far away they are. In a task list, an open item's date says whether
 * it is overdue or due soon. The source keeps ISO dates, which sort and
 * read the same everywhere.
 */
import type { Root } from "mdast";
import { dueTone, formatDate, isDate, relativeDay, today } from "../ui/calendar-date";
import { inline, replaceInProse } from "./prose-text";

export interface DateOptions {
  /** The day dates are measured from, `2026-10-11`; today unless given. */
  readonly today?: string;
}

/** A date on its own: not part of a word, number, path, version or timestamp. */
const DATE = /(?<![\p{L}\p{N}_/\\.:-])(\d{4}-\d{2}-\d{2})(?![\p{L}\p{N}_]|[-/:.][\p{L}\p{N}])/gu;

const TONE_WORDS = { overdue: "overdue", soon: "due soon" } as const;

export function remarkDates(options: DateOptions = {}) {
  return (tree: Root) => {
    const on = options.today ?? today();
    replaceInProse(tree, DATE, (match, { checked }) => {
      const iso = match[1]!;
      if (!isDate(iso)) return null;
      const tone = checked === null ? null : dueTone(iso, on, checked);
      const relative = relativeDay(iso, on);
      return inline(tone ? `md-date is-${tone}` : "md-date", formatDate(iso), {
        title: tone ? `${relative} · ${TONE_WORDS[tone]}` : relative,
      });
    });
  };
}
