/**
 * Which renderer shows a file: the one place that knows the kinds of files
 * Genbeya shows rendered, in **Code** beside or instead of their text, and
 * in the diffs of **Changes** and **History**. A new kind, such as PDF,
 * audio or video, is a renderer here plus its view in the file editor and,
 * when it compares differently, in the diff pane.
 */
import { imageType } from "../../../../utilities/image-types";

export type PreviewKind = "markdown" | "mermaid" | "plantuml" | "svg" | "image";

/** How a diff compares two versions: line by line, as two images, or not at all, for binary files without a renderer. */
export type Comparison = "text" | "image" | "binary";

export interface FilePreview {
  readonly kind: PreviewKind;
  /** Text Genbeya edits, beside its preview or instead of it; other files are only shown, never read as text. */
  readonly text: boolean;
  /** How diffs compare two versions of the file. */
  readonly comparison: Exclude<Comparison, "binary">;
}

interface Renderer extends FilePreview {
  readonly matches: (path: string) => boolean;
}

const named = (pattern: RegExp) => (path: string) => pattern.test(path);

/** The first renderer that matches a file shows it. */
const RENDERERS: readonly Renderer[] = [
  { kind: "markdown", matches: named(/\.(md|markdown)$/i), text: true, comparison: "text" },
  { kind: "mermaid", matches: named(/\.(mmd|mermaid)$/i), text: true, comparison: "text" },
  { kind: "plantuml", matches: named(/\.(puml|plantuml|pu|iuml)$/i), text: true, comparison: "text" },
  // SVG is text: edited and compared as such, previewed as an image.
  { kind: "svg", matches: named(/\.svg$/i), text: true, comparison: "text" },
  // The raster images the content manager serves as data URLs.
  { kind: "image", matches: (path) => imageType(path) !== null, text: false, comparison: "image" },
];

/** How a file is shown rendered, or null for files that are only edited as text. */
export function filePreview(path: string): FilePreview | null {
  return RENDERERS.find((renderer) => renderer.matches(path)) ?? null;
}

/** How a diff compares two versions of `path`, where `binary` says whether Git found either side binary or too large. */
export function comparisonOf(path: string, binary: boolean): Comparison {
  if (filePreview(path)?.comparison === "image") return "image";
  return binary ? "binary" : "text";
}

/**
 * The Markdown that renders a file: Markdown as it is, a diagram source as
 * a diagram block, which draws it as the wiki does. Images are shown as such.
 */
export function previewMarkdown(kind: "markdown" | "mermaid" | "plantuml", source: string): string {
  if (kind === "markdown") return source;
  // A fence longer than any backtick run inside keeps the source in one block.
  const longest = Math.max(2, ...[...source.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${kind}\n${source}\n${fence}\n`;
}
