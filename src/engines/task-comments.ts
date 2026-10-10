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

/**
 * The description and the comments of a task's body. The comments start at
 * the first "## Comments" heading followed by a comment, so the description
 * may have such a heading of its own, and comments may quote it.
 */
export function splitComments(body: string): SplitBody {
  const lines = body.split("\n").map((line) => line.replace(/\r$/, ""));
  const start = lines.findIndex((line, i) => SECTION.test(line) && COMMENT.test(lines.slice(i + 1).find((next) => !isBlank(next)) ?? ""));
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
  for (const line of lines.slice(start + 1)) {
    const next = COMMENT.exec(line);
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

/** Escapes lines that would read as a comment heading, so descriptions and comments never split into comments. */
export const protectHeadings = (text: string): string =>
  text
    .split("\n")
    .map((line) => (COMMENT.test(line.replace(/\r$/, "")) ? `\\${line}` : line))
    .join("\n");

const pad = (value: number) => String(value).padStart(2, "0");

/** `date` in local time to the minute, with the UTC offset: "2026-10-10 14:32+02:00". */
export function timestampOf(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const zone = `${offset < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}${zone}`;
}
