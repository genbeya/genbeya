/** Files that **Code** can show rendered, beside or instead of their text: Markdown, diagram sources and SVG images. */

export type PreviewKind = "markdown" | "mermaid" | "plantuml" | "svg";

const KINDS: readonly (readonly [RegExp, PreviewKind])[] = [
  [/\.(md|markdown)$/i, "markdown"],
  [/\.(mmd|mermaid)$/i, "mermaid"],
  [/\.(puml|plantuml|pu|iuml)$/i, "plantuml"],
  [/\.svg$/i, "svg"],
];

/** How a file can be previewed, or null for files that can only be edited. */
export function previewKind(path: string): PreviewKind | null {
  return KINDS.find(([pattern]) => pattern.test(path))?.[1] ?? null;
}

/**
 * The Markdown that renders a file: Markdown as it is, a diagram source as
 * a diagram block, which draws it as the wiki does. SVG is shown as an image.
 */
export function previewMarkdown(kind: Exclude<PreviewKind, "svg">, source: string): string {
  if (kind === "markdown") return source;
  // A fence longer than any backtick run inside keeps the source in one block.
  const longest = Math.max(2, ...[...source.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${kind}\n${source}\n${fence}\n`;
}
