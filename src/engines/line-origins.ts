/**
 * Who added each line of a file: the author of the oldest commit whose
 * version of the file has the line, where the one before didn't. For
 * pull request verdicts, which say who gave them, Git says who wrote them.
 */

export interface Revision {
  readonly author: string;
  /** The file before and after the commit, when Git showed them. */
  readonly before: string | null;
  readonly after: string | null;
}

const linesOf = (text: string | null) => new Set((text ?? "").split("\n").map((line) => line.replace(/\r$/, "").trimEnd()));

/** For each of `lines`, the author who added it in `revisions` (newest first, as Git lists them); null when no commit has it yet. */
export function lineAuthors(revisions: readonly Revision[], lines: readonly string[]): (string | null)[] {
  const oldestFirst = [...revisions]
    .reverse()
    .map((revision) => ({ ...revision, added: linesOf(revision.after), had: linesOf(revision.before) }));
  return lines.map((line) => {
    const wanted = line.trimEnd();
    return oldestFirst.find((revision) => revision.added.has(wanted) && !revision.had.has(wanted))?.author ?? null;
  });
}

/** Lines asked about, checked: up to 200 lines of up to 2,000 characters. */
export function lineList(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 200 ||
    value.some((line) => typeof line !== "string" || line.length > 2000 || line.includes("\n"))
  )
    throw new Error("Invalid lines.");
  return value as string[];
}
