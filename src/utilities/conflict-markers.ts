/**
 * Conflict markers git writes into conflicted files, in the merge style
 * (current, incoming) and the diff3 and zdiff3 styles (with the common
 * ancestor between them). Markers are seven characters or more, as the
 * `conflict-marker-size` attribute allows.
 */

export interface ConflictHunk {
  /** Offset of the opening marker line in the text. */
  readonly from: number;
  /** Offset just after the closing marker line, including its line break. */
  readonly to: number;
  /** Line number of the opening marker, counted from 1. */
  readonly line: number;
  /** Lines in the hunk, markers included. */
  readonly lines: number;
  /** HEAD's side, with its line breaks. */
  readonly ours: string;
  /** The common ancestor (diff3 style), or null. */
  readonly base: string | null;
  /** The incoming side. */
  readonly theirs: string;
  /** What the markers name the sides, such as "HEAD" and "feature". */
  readonly oursLabel: string;
  readonly theirsLabel: string;
}

export type HunkChoice = "ours" | "theirs" | "both";

/** The text's lines, each with its line break. */
function linesOf(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/** The marker (such as "<<<<<<<") and label of a line, or null. */
function marker(line: string, char: string, size: number | null): { size: number; label: string } | null {
  const content = line.replace(/\r?\n$/, "");
  let count = 0;
  while (content[count] === char) count++;
  if (count < 7 || (size !== null && count !== size)) return null;
  const rest = content.slice(count);
  if (rest && !rest.startsWith(" ")) return null;
  return { size: count, label: rest.trim() };
}

/** Every complete conflict hunk, in order. Unfinished hunks are left out. */
export function parseConflicts(text: string): ConflictHunk[] {
  const hunks: ConflictHunk[] = [];
  const lines = linesOf(text);
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const open = marker(lines[i]!, "<", null);
    if (!open) {
      offset += lines[i]!.length;
      continue;
    }
    const hunk = readHunk(lines, i, open.size);
    if (!hunk) {
      offset += lines[i]!.length;
      continue;
    }
    const length = lines.slice(i, hunk.end + 1).join("").length;
    hunks.push({
      from: offset,
      to: offset + length,
      line: i + 1,
      lines: hunk.end - i + 1,
      ours: hunk.ours,
      base: hunk.base,
      theirs: hunk.theirs,
      oursLabel: open.label,
      theirsLabel: hunk.theirsLabel,
    });
    offset += length;
    i = hunk.end;
  }
  return hunks;
}

/** The sections of the hunk opened at `start`, or null when its markers are incomplete. */
function readHunk(lines: string[], start: number, size: number) {
  const ours: string[] = [];
  let base: string[] | null = null;
  const theirs: string[] = [];
  let section: "ours" | "base" | "theirs" = "ours";
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (section === "ours" && marker(line, "|", size)) {
      section = "base";
      base = [];
    } else if (section !== "theirs" && marker(line, "=", size)?.label === "") {
      section = "theirs";
    } else if (section === "theirs" && marker(line, ">", size)) {
      return {
        end: i,
        ours: ours.join(""),
        base: base?.join("") ?? null,
        theirs: theirs.join(""),
        theirsLabel: marker(line, ">", size)!.label,
      };
    } else (section === "ours" ? ours : section === "base" ? base! : theirs).push(line);
  }
  return null;
}

/** `text` with `hunk` replaced by the chosen side, or both (current first). */
export function resolveHunk(text: string, hunk: ConflictHunk, choice: HunkChoice): string {
  const kept = choice === "ours" ? hunk.ours : choice === "theirs" ? hunk.theirs : joinSides(hunk.ours, hunk.theirs);
  return text.slice(0, hunk.from) + kept + text.slice(hunk.to);
}

/** Both sides; a side without a final line break gets one, so their lines stay apart. */
function joinSides(ours: string, theirs: string): string {
  if (!ours || ours.endsWith("\n")) return ours + theirs;
  return ours + (theirs.includes("\r\n") || ours.includes("\r\n") ? "\r\n" : "\n") + theirs;
}

export const hasConflictMarkers = (text: string): boolean => parseConflicts(text).length > 0;
