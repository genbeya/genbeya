/** Colours of workflow states, shared by the task board and task references in Markdown. */
export type StatusTone = "gray" | "blue" | "yellow" | "purple" | "orange" | "green" | "other";

const MIDDLE: readonly StatusTone[] = ["blue", "yellow", "purple", "orange"];

/** Grey for the first state, green for the last, distinct colours between; "other" for states not configured. */
export function statusTone(index: number, count: number): StatusTone {
  if (index < 0) return "other";
  if (index === count - 1) return "green";
  if (index === 0) return "gray";
  return MIDDLE[(index - 1) % MIDDLE.length]!;
}
