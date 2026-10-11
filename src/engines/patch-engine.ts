/**
 * Staging, unstaging and discarding parts of a file: from git's diff of the
 * file and the lines the user chose, builds a patch for `git apply` that
 * holds only those changes. Applied forward (staging), lines left out of a
 * removal stay as context and additions left out go; applied in reverse
 * (unstaging, discarding), it is the other way round. Hunk headers are
 * counted anew, and a hunk's start follows what the hunks before it now add.
 */
import type { LineRange, LineSelection } from "../contracts/model";

/** Forward: the patch turns the original into the result (`git apply`). Reverse: it is applied with `--reverse`. */
export type PatchDirection = "forward" | "reverse";

export interface DiffLine {
  readonly kind: " " | "-" | "+";
  /** Without the leading marker or the line break; a carriage return stays. */
  readonly text: string;
  /** The line ends its version(s) without a line break ("\ No newline at end of file"). */
  readonly noNewline: boolean;
  /** 1-based, in the original; null for added lines. */
  readonly oldLine: number | null;
  /** 1-based, in the modified version; null for removed lines. */
  readonly newLine: number | null;
}

export interface Hunk {
  readonly oldStart: number;
  readonly newStart: number;
  readonly lines: readonly DiffLine[];
}

/** One file's diff as git prints it. */
export interface FileDiff {
  /** As on the `---` and `+++` lines (`a/path`, `"b/q\"uoted"`, with a tab after names with spaces); null for /dev/null. */
  readonly oldName: string | null;
  readonly newName: string | null;
  /** The mode of a file the diff creates or deletes. */
  readonly createdMode: string | null;
  readonly deletedMode: string | null;
  readonly binary: boolean;
  readonly hunks: readonly Hunk[];
}

const WHOLE_FILE = "GitDesk can only stage this file as a whole.";
const NO_NEWLINE = "\\ No newline at end of file";
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** A line of the patch being built, with what it says about the end of each version. */
interface PatchLine {
  readonly kind: " " | "-" | "+";
  readonly text: string;
  /** Ends the original (for context and removed lines) without a line break. */
  readonly oldEnd: boolean;
  /** Ends the result (for context and added lines) without a line break. */
  readonly newEnd: boolean;
}

/**
 * Whether lines asked for in ascending order lie in `ranges`: one walk
 * through the ranges, sorted once, however many lines and ranges there are.
 */
function within(ranges: readonly LineRange[]): (line: number | null) => boolean {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  let next = 0;
  return (line) => {
    if (line === null) return false;
    while (next < sorted.length && sorted[next]!.to < line) next++;
    return next < sorted.length && sorted[next]!.from <= line;
  };
}

/** `a/x` as `b/x`, quoted or not. */
const withPrefix = (name: string, prefix: "a/" | "b/") => (name.startsWith('"') ? `"${prefix}${name.slice(3)}` : prefix + name.slice(2));

/** Lines before a hunk in one version: its start, or the line it follows when it has none. */
const before = (start: number, count: number) => (count > 0 ? start - 1 : start);
const startAfter = (preceding: number, count: number) => (count > 0 ? preceding + 1 : preceding);

const flip = (kind: PatchLine["kind"]): PatchLine["kind"] => (kind === "-" ? "+" : kind === "+" ? "-" : " ");

/**
 * The order of lines at the same position of a changed run: in the patch,
 * a removed line comes before the line it is replaced with, and before an
 * added line next to a kept one.
 */
const RANKS: Readonly<Record<PatchDirection, Readonly<Record<PatchLine["kind"], number>>>> = {
  forward: { "-": 0, " ": 1, "+": 2 },
  // Built with the versions swapped: "+" is a removal of the patch.
  reverse: { "+": 0, " ": 1, "-": 2 },
};

export class PatchEngine {
  /** The diff of one file, from `git diff` output; refuses output with several files. */
  parse(output: string): FileDiff {
    const rows = output.split("\n");
    if (rows.at(-1) === "") rows.pop();
    if (rows.filter((row) => row.startsWith("diff --git ")).length > 1) throw new Error(WHOLE_FILE);
    let oldName: string | null = null;
    let newName: string | null = null;
    let createdMode: string | null = null;
    let deletedMode: string | null = null;
    let binary = false;
    const hunks: Hunk[] = [];
    let i = 0;
    for (; i < rows.length && !rows[i]!.startsWith("@@"); i++) {
      const row = rows[i]!;
      if (row.startsWith("--- ")) oldName = row === "--- /dev/null" ? null : row.slice(4);
      else if (row.startsWith("+++ ")) newName = row === "+++ /dev/null" ? null : row.slice(4);
      else if (row.startsWith("new file mode ")) createdMode = row.slice(14);
      else if (row.startsWith("deleted file mode ")) deletedMode = row.slice(18);
      else if (row.startsWith("Binary files ") || row === "GIT binary patch") binary = true;
    }
    while (i < rows.length) {
      const match = HUNK_HEADER.exec(rows[i++]!);
      if (!match) throw new Error(WHOLE_FILE);
      const oldStart = Number(match[1]);
      const newStart = Number(match[3]);
      let oldLeft = Number(match[2] ?? 1);
      let newLeft = Number(match[4] ?? 1);
      let oldLine = oldStart;
      let newLine = newStart;
      const lines: DiffLine[] = [];
      while (i < rows.length && (oldLeft > 0 || newLeft > 0 || rows[i] === NO_NEWLINE)) {
        const row = rows[i++]!;
        if (row === NO_NEWLINE) {
          const last = lines.pop();
          if (last) lines.push({ ...last, noNewline: true });
          continue;
        }
        const kind = row[0];
        const text = row.slice(1);
        if (kind === "-") {
          lines.push({ kind, text, noNewline: false, oldLine: oldLine++, newLine: null });
          oldLeft--;
        } else if (kind === "+") {
          lines.push({ kind, text, noNewline: false, oldLine: null, newLine: newLine++ });
          newLeft--;
        } else if (kind === " " || row === "") {
          lines.push({ kind: " ", text, noNewline: false, oldLine: oldLine++, newLine: newLine++ });
          oldLeft--;
          newLeft--;
        } else throw new Error(WHOLE_FILE);
      }
      hunks.push({ oldStart, newStart, lines });
    }
    return { oldName, newName, createdMode, deletedMode, binary, hunks };
  }

  /**
   * A patch with only the selected changes of `diff`: added lines by their
   * number in the modified version, removed ones by their number in the
   * original. Applied in `direction`, it changes nothing else.
   */
  patch(diff: FileDiff, selection: LineSelection, direction: PatchDirection): string {
    if (diff.binary || (diff.oldName === null && diff.newName === null)) throw new Error(WHOLE_FILE);
    const reverse = direction === "reverse";
    // Asked in order: removed lines by their old number, added ones by their new one.
    const [removed, added] = [within(selection.original), within(selection.modified)];
    const chosen = (line: DiffLine) => (line.kind === "-" ? removed(line.oldLine) : line.kind === "+" && added(line.newLine));
    // Reversed patches are built forward with the versions swapped, then swapped back.
    let shift = 0;
    let original = false;
    let modified = false;
    const text: string[] = [];
    for (const hunk of diff.hunks) {
      const lines = this.select(
        hunk.lines.map((line) => ({ kind: reverse ? flip(line.kind) : line.kind, chosen: chosen(line), line })),
        RANKS[direction],
      );
      if (!lines) continue;
      const kept = lines.filter((line) => line.kind !== "+").length;
      const result = lines.filter((line) => line.kind !== "-").length;
      const keptStart = reverse ? hunk.newStart : hunk.oldStart;
      const resultStart = startAfter(before(keptStart, kept) + shift, result);
      shift += result - kept;
      const [oldStart, oldCount, newStart, newCount] = reverse
        ? [resultStart, result, keptStart, kept]
        : [keptStart, kept, resultStart, result];
      original ||= oldCount > 0;
      modified ||= newCount > 0;
      text.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n`);
      for (const line of lines) {
        const ends = line.kind === "+" ? line.newEnd : line.oldEnd;
        text.push(`${reverse ? flip(line.kind) : line.kind}${line.text}\n${ends ? `${NO_NEWLINE}\n` : ""}`);
      }
    }
    if (!text.length) throw new Error("Select changed lines first.");
    return this.header(diff, original, modified, reverse) + text.join("");
  }

  /**
   * The lines of a forward patch with only the chosen changes; null when it
   * has none. Removals left out become context, additions left out go.
   * Within a run of changed lines, the n-th removal and the n-th addition
   * belong together, so a removal kept as context goes where the
   * corresponding addition would have gone: choosing the first of two
   * replaced lines replaces the first.
   */
  private select(
    lines: readonly { kind: DiffLine["kind"]; chosen: boolean; line: DiffLine }[],
    rank: Readonly<Record<PatchLine["kind"], number>>,
  ): PatchLine[] | null {
    const picked: { kind: DiffLine["kind"]; line: DiffLine }[] = [];
    for (let start = 0; start < lines.length;) {
      if (lines[start]!.kind === " ") {
        picked.push(lines[start++]!);
        continue;
      }
      let end = start;
      while (end < lines.length && lines[end]!.kind !== " ") end++;
      const counts = { "-": 0, "+": 0 };
      const block = lines.slice(start, end).flatMap(({ kind, chosen, line }) => {
        const position = counts[kind as "-" | "+"]++;
        if (chosen) return [{ kind, line, position }];
        return kind === "-" ? [{ kind: " " as const, line, position }] : [];
      });
      picked.push(...block.sort((a, b) => a.position - b.position || rank[a.kind] - rank[b.kind]));
      start = end;
    }
    if (!picked.some(({ kind }) => kind !== " ")) return null;
    const result: PatchLine[] = [];
    // The last line of the result: only removals come after it.
    const last = picked.findLastIndex((next) => next.kind !== "-");
    picked.forEach(({ kind, line: { text, noNewline } }, index) => {
      const lastOfResult = index >= last;
      if (kind === "-") return result.push({ kind, text, oldEnd: noNewline, newEnd: false });
      if (kind === "+") return result.push({ kind, text, oldEnd: false, newEnd: noNewline && lastOfResult });
      // A kept line that ended the original without a line break gains one when the result goes on after it.
      if (noNewline && !lastOfResult) {
        result.push({ kind: "-", text, oldEnd: true, newEnd: false });
        return result.push({ kind: "+", text, oldEnd: false, newEnd: false });
      }
      return result.push({ kind, text, oldEnd: noNewline, newEnd: noNewline });
    });
    return result;
  }

  /**
   * A renamed file is patched under the name the patch applies to, so the
   * rename stays as it is; a creation or deletion that now leaves lines on
   * its empty side becomes a change of the file.
   */
  private header(diff: FileDiff, original: boolean, modified: boolean, reverse: boolean): string {
    const created = diff.createdMode !== null && !original;
    const deleted = diff.deletedMode !== null && !modified;
    const name = (reverse ? (diff.newName ?? diff.oldName) : (diff.oldName ?? diff.newName))!;
    const [a, b] = [withPrefix(name, "a/"), withPrefix(name, "b/")];
    return [
      `diff --git ${a.replace(/\t$/, "")} ${b.replace(/\t$/, "")}\n`,
      created ? `new file mode ${diff.createdMode}\n` : "",
      deleted ? `deleted file mode ${diff.deletedMode}\n` : "",
      `--- ${created ? "/dev/null" : a}\n`,
      `+++ ${deleted ? "/dev/null" : b}\n`,
    ].join("");
  }
}
