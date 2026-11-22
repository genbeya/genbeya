/** The Markdown that shows lines of a file in place (`![[path#L1-L9]]`). */

/** Embeds stay readable; longer ranges are cut with a note. */
export const MAX_EMBED_LINES = 400;

/** Extensions the highlighter knows by name; anything else shows as plain text. */
const LANGUAGES = new Set(
  "ts tsx js jsx mjs cjs json py rb rs go java kt cs cpp cc c h hpp swift php sh bash zsh ps1 sql yml yaml xml html css scss less md toml ini dockerfile makefile lua r scala dart vue".split(
    " ",
  ),
);

export interface EmbedSource {
  readonly markdown: string;
  readonly from: number;
  readonly to: number;
  /** More lines were asked for than an embed shows. */
  readonly cut: boolean;
}

/** `lines` is "10-20" or null for the whole file; throws when the file has no such lines. */
export function embedSource(path: string, content: string, lines: string | null): EmbedSource {
  const all = content.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  const [first, last] = lines ? lines.split("-").map(Number) : [1, all.length];
  const from = first ?? 1;
  const to = Math.min(last ?? from, all.length);
  if (from > all.length) throw new Error(`${path} has only ${all.length} ${all.length === 1 ? "line" : "lines"}.`);
  const end = Math.min(to, from + MAX_EMBED_LINES - 1);
  const code = all.slice(from - 1, end).join("\n");
  const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase() ?? path.split("/").at(-1)!.toLowerCase();
  // A fence longer than any backtick run in the code keeps the code intact.
  const fence = "`".repeat(Math.max(3, ...[...code.matchAll(/`+/g)].map((run) => run[0].length + 1)));
  return { markdown: `${fence}${LANGUAGES.has(extension) ? extension : "text"}\n${code}\n${fence}\n`, from, to: end, cut: end < to };
}

const lineList = (text: string) => text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");

/**
 * Whether `lines` ("10-20", or null for the whole file) read the same in
 * `current`, the file now, as in `pinned`, the file at a revision. Lines that
 * only moved count as changed: a pinned reference names line numbers.
 */
export function sameLines(pinned: string, current: string, lines: string | null): boolean {
  const [before, now] = [lineList(pinned), lineList(current)];
  const [from, to] = lines ? lines.split("-").map(Number) : [1, Math.max(before.length, now.length)];
  const range = (all: string[]) => all.slice((from ?? 1) - 1, to ?? from).join("\n");
  return range(before) === range(now) && (lines !== null || before.length === now.length);
}
