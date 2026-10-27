/**
 * Comments on a task live at the end of its file, below a "## Comments"
 * heading, one "### Author — 2026-10-10 14:32+02:00" heading each. That
 * reads well as plain Markdown, and new comments go last, so comments
 * written on two branches merge as appended lines.
 */
import type { TaskComment } from "../contracts/model";

const SECTION_HEADING = "## Comments";
const SECTION = /^## Comments[ \t]*$/;
/** Author, then a date and time to the minute or second, with an optional UTC offset. */
const COMMENT = /^### (\S.*?) [—–-] (\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?[ \t]*$/;

/** One comment, its heading line and its whole text as written. */
export interface CommentBlock {
  readonly comment: TaskComment;
  readonly heading: string;
  readonly text: string;
}

export interface SplitBody {
  /** The Markdown above the comments, as written. */
  readonly description: string;
  readonly blocks: readonly CommentBlock[];
}

const isBlank = (line: string) => !line.trim();

function trimBlankLines(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && isBlank(lines[start]!)) start++;
  while (end > start && isBlank(lines[end - 1]!)) end--;
  return lines.slice(start, end);
}

function commentOf(match: RegExpExecArray, body: string): TaskComment {
  const [, author, day, time, offset] = match;
  const zone = offset && offset !== "Z" && !offset.includes(":") ? `${offset.slice(0, 3)}:${offset.slice(3)}` : (offset ?? "");
  return { author: author!.trim(), date: `${day}T${time}${zone}`, body };
}

/** An opening or closing code fence: three or more backticks or tildes, indented at most three spaces. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Which lines lie in a fenced code block, fences included, and the fence
 * still open at the end, if any. Lines are without their `\r`.
 */
function fences(lines: readonly string[]): { fenced: boolean[]; open: string | null } {
  const fenced: boolean[] = [];
  let open: string | null = null;
  for (const line of lines) {
    const fence = FENCE.exec(line);
    const rest = fence ? line.slice(fence[0].length) : "";
    if (open) {
      fenced.push(true);
      if (fence && fence[1]![0] === open[0] && fence[1]!.length >= open.length && !rest.trim()) open = null;
    } else if (fence && !(fence[1]![0] === "`" && rest.includes("`"))) {
      fenced.push(true);
      open = fence[1]!;
    } else fenced.push(false);
  }
  return { fenced, open };
}

/**
 * The description and the comments of a task's body. The comments start at
 * the first "## Comments" heading followed by a comment, so the description
 * may have such a heading of its own, and comments may quote it. Headings in
 * code blocks are code, such as an example of this format.
 */
export function splitComments(body: string): SplitBody {
  const lines = body.split("\n").map((line) => line.replace(/\r$/, ""));
  const { fenced } = fences(lines);
  // From the end, so the line after each heading is known: the first heading wins.
  let start = -1;
  let next = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!fenced[i] && SECTION.test(lines[i]!) && next >= 0 && !fenced[next] && COMMENT.test(lines[next]!)) start = i;
    if (!isBlank(lines[i]!)) next = i;
  }
  if (start < 0) return { description: body, blocks: [] };
  const before = body.split("\n").slice(0, start).join("\n").trimEnd();
  const blocks: CommentBlock[] = [];
  let match: RegExpExecArray | null = null;
  let heading = "";
  let content: string[] = [];
  const close = () => {
    if (!match) return;
    const text = trimBlankLines(content).join("\n");
    blocks.push({ comment: commentOf(match, text), heading, text: commentBlock(heading, text) });
  };
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    const next = fenced[i] ? null : COMMENT.exec(line);
    if (next) {
      close();
      match = next;
      heading = line.trimEnd();
      content = [];
    } else content.push(line);
  }
  close();
  return { description: before ? `${before}${body.includes("\r\n") ? "\r\n" : "\n"}` : "", blocks };
}

/** `description` followed by the comment `blocks`; no section without comments. */
export function joinComments(description: string, blocks: readonly string[]): string {
  const text = description.trimEnd();
  if (!blocks.length) return text ? `${text}\n` : "";
  return `${text ? `${text}\n\n` : ""}${SECTION_HEADING}\n\n${blocks.join("\n\n")}\n`;
}

export const commentHeading = (author: string, timestamp: string): string => `### ${author} — ${timestamp}`;

/** A comment's text as written to the file. */
export const commentBlock = (heading: string, body: string): string => (body ? `${heading}\n\n${body}` : heading);

/**
 * Escapes lines that would read as a comment heading, and closes a code
 * fence left open, so descriptions and comments never split into comments
 * and never swallow the ones after them. Code blocks stay as written.
 */
export function protectHeadings(text: string): string {
  const lines = text.split("\n");
  const { fenced, open } = fences(lines.map((line) => line.replace(/\r$/, "")));
  const protectedText = lines.map((line, i) => (!fenced[i] && COMMENT.test(line.replace(/\r$/, "")) ? `\\${line}` : line)).join("\n");
  return open ? `${protectedText}${protectedText.endsWith("\n") ? "" : "\n"}${open}` : protectedText;
}

export { timestampOf } from "../utilities/timestamps";
