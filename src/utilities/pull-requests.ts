/**
 * The body of a pull request file: the description, `## Review` with one
 * `###` topic per issue and one `####` code range (a pinned reference)
 * under it, and `## Discussion` with replies and verdicts. Shared by the
 * app, its Markdown and VS Code. Everything here reads or rewrites the text;
 * what is derived from it (which approvals count, what is ready) is worked
 * out from the text and the branches, never written into the file.
 */
import { parseFileFragment, type LineRange } from "./references";

// Replies and verdicts.

export type VerdictKind = "requested review" | "approved" | "requested changes" | "withdrew approval";

export interface Verdict {
  readonly kind: VerdictKind;
  /** The commit an approval or a request for changes names; null for the others. */
  readonly revision: string | null;
}

/** `**Alex — 2026-10-23 12:41+02:00:** text`, or with a verdict before the colon. */
export interface PullReply {
  readonly author: string;
  /** As written: `2026-10-23 12:41+02:00`. */
  readonly date: string;
  readonly verdict: Verdict | null;
  readonly text: string;
  /** The line the reply starts on, counted from 0. */
  readonly line: number;
}

export interface PullTodo {
  readonly text: string;
  readonly done: boolean;
  readonly line: number;
}

/** A code range a topic is about: `#### [[src/auth.ts#L42-L48@<commit>]]`. */
export interface PullLocation {
  /** What the heading's reference names, without the brackets. */
  readonly reference: string;
  readonly path: string;
  readonly lines: LineRange | null;
  readonly revision: string | null;
  /** The text of the first `diff` code block under it. */
  readonly suggestion: string | null;
  readonly replies: readonly PullReply[];
  readonly todos: readonly PullTodo[];
  readonly line: number;
  /** The line after its last one. */
  readonly end: number;
}

export interface PullTopic {
  readonly title: string;
  /** What came of it, once the topic was shortened: `**Outcome:** text`. */
  readonly outcome: string | null;
  /** Replies before the first code range: remarks on the topic as a whole. */
  readonly replies: readonly PullReply[];
  readonly todos: readonly PullTodo[];
  readonly locations: readonly PullLocation[];
  readonly line: number;
  readonly end: number;
}

export interface PullBody {
  /** The Markdown above `## Review` and `## Discussion`. */
  readonly description: string;
  readonly topics: readonly PullTopic[];
  readonly discussion: readonly PullReply[];
  /** Every to-do: in the description, the topics, the code ranges and the discussion. */
  readonly todos: readonly PullTodo[];
  /** Every reply, in the order of the file. */
  readonly replies: readonly PullReply[];
  /** Lines that start like a reply but can't be read: flagged, never dropped. */
  readonly unreadable: readonly string[];
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const REVIEW = /^##\s+Review\s*$/i;
const DISCUSSION = /^##\s+Discussion\s*$/i;
const SECTION = /^#{1,2}\s/;
const TOPIC = /^###\s+(.+?)\s*#*\s*$/;
const LOCATION = /^####\s+\[\[([^\]\n]+)\]\]\s*$/;
const OUTCOME = /^\*\*Outcome:\*\*\s*(.*)$/;
const TODO = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
const COMMIT = "`?([0-9a-f]{7,64})`?";
/** Name, then the date and time to the minute or second with an optional offset, an optional verdict, then the text. */
const REPLY = /^\*\*(\S.*?) [—–-] (\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)(?: [—–-] ([^*]+?))?:\*\*\s*(.*)$/;
/** What starts like a reply: bold text with a dash, ending in a colon. */
const REPLY_LIKE = /^\*\*[^*\n]+ [—–-] [^*\n]*:\*\*/;
const VERDICTS: readonly [RegExp, VerdictKind][] = [
  [/^requested review$/i, "requested review"],
  [new RegExp(`^approved ${COMMIT}$`, "i"), "approved"],
  [new RegExp(`^requested changes at ${COMMIT}$`, "i"), "requested changes"],
  [/^withdrew approval$/i, "withdrew approval"],
];

/** Whether each line is inside a fenced code block, fences included. */
function fencedLines(lines: readonly string[]): boolean[] {
  let open: string | null = null;
  return lines.map((line) => {
    const fence = FENCE.exec(line)?.[1];
    if (!fence) return open !== null;
    if (!open) open = fence;
    else if (fence[0] === open[0] && fence.length >= open.length) open = null;
    return true;
  });
}

function verdictOf(text: string | undefined): Verdict | null | undefined {
  if (text === undefined) return null;
  for (const [pattern, kind] of VERDICTS) {
    const match = pattern.exec(text.trim());
    if (match) return { kind, revision: match[1]?.toLowerCase() ?? null };
  }
  return undefined;
}

const isBlank = (line: string) => !line.trim();

/** Reads the body of a pull request file. */
export function parsePullBody(body: string): PullBody {
  const lines = body.split("\n").map((line) => line.replace(/\r$/, ""));
  const fenced = fencedLines(lines);
  const heading = (pattern: RegExp) => lines.findIndex((line, i) => !fenced[i] && pattern.test(line));
  const review = heading(REVIEW);
  const discussion = heading(DISCUSSION);
  const ends = [review, discussion].filter((index) => index >= 0);
  const descriptionEnd = ends.length ? Math.min(...ends) : lines.length;
  const sectionEnd = (start: number) => {
    const next = lines.findIndex((line, i) => i > start && !fenced[i] && SECTION.test(line));
    return next < 0 ? lines.length : next;
  };

  const replies: PullReply[] = [];
  const todos: PullTodo[] = [];
  const unreadable: string[] = [];
  /** Replies and to-dos of lines `from` to `to`; outside the description, what looks like a reply but isn't is flagged. */
  const read = (from: number, to: number, flag = true) => {
    const found = { replies: [] as PullReply[], todos: [] as PullTodo[] };
    for (let i = from; i < to; i++) {
      if (fenced[i]) continue;
      const line = lines[i]!;
      const todo = TODO.exec(line);
      if (todo) {
        found.todos.push({ text: todo[2]!.trim(), done: todo[1] !== " ", line: i });
        continue;
      }
      const match = REPLY.exec(line);
      const verdict = match ? verdictOf(match[3]) : undefined;
      if (!match || verdict === undefined) {
        if (flag && REPLY_LIKE.test(line)) unreadable.push(line.trim());
        continue;
      }
      // A reply is one paragraph: it runs to the next blank line.
      const text = [match[4]!];
      while (i + 1 < to && !fenced[i + 1] && !isBlank(lines[i + 1]!) && !REPLY_LIKE.test(lines[i + 1]!) && !TODO.test(lines[i + 1]!))
        text.push(lines[++i]!);
      found.replies.push({ author: match[1]!.trim(), date: match[2]!, verdict, text: text.join("\n").trim(), line: i - text.length + 1 });
    }
    replies.push(...found.replies);
    todos.push(...found.todos);
    return found;
  };

  read(0, descriptionEnd, false);
  const topics: PullTopic[] = [];
  if (review >= 0) {
    const end = sectionEnd(review);
    const starts: number[] = [];
    for (let i = review + 1; i < end; i++) if (!fenced[i] && TOPIC.test(lines[i]!)) starts.push(i);
    read(review + 1, starts[0] ?? end);
    starts.forEach((start, index) => {
      const topicEnd = starts[index + 1] ?? end;
      const locationStarts: number[] = [];
      for (let i = start + 1; i < topicEnd; i++) if (!fenced[i] && lines[i]!.startsWith("#### ")) locationStarts.push(i);
      const own = read(start + 1, locationStarts[0] ?? topicEnd);
      const locations = locationStarts.flatMap((at, n): PullLocation[] => {
        const locationEnd = locationStarts[n + 1] ?? topicEnd;
        const found = read(at + 1, locationEnd);
        const match = LOCATION.exec(lines[at]!);
        if (!match) {
          unreadable.push(lines[at]!.trim());
          return [];
        }
        const reference = match[1]!.split("|")[0]!.trim();
        const hash = reference.indexOf("#");
        const fragment = parseFileFragment(hash < 0 ? undefined : reference.slice(hash + 1));
        return [
          {
            reference,
            path: hash < 0 ? reference : reference.slice(0, hash),
            lines: fragment.lines,
            revision: fragment.revision,
            suggestion: suggestionOf(lines, at + 1, locationEnd),
            replies: found.replies,
            todos: found.todos,
            line: at,
            end: locationEnd,
          },
        ];
      });
      const outcome = lines.slice(start + 1, locationStarts[0] ?? topicEnd).find((line) => OUTCOME.test(line));
      topics.push({
        title: TOPIC.exec(lines[start]!)![1]!,
        outcome: outcome ? OUTCOME.exec(outcome)![1]!.trim() : null,
        replies: own.replies,
        todos: own.todos,
        locations,
        line: start,
        end: topicEnd,
      });
    });
  }
  const discussed = discussion >= 0 ? read(discussion + 1, sectionEnd(discussion)).replies : [];
  return {
    description: lines.slice(0, descriptionEnd).join("\n").trim(),
    topics,
    discussion: discussed,
    todos: todos.sort((a, b) => a.line - b.line),
    replies: replies.sort((a, b) => a.line - b.line),
    unreadable,
  };
}

/** The text of the first `diff` code block in lines `from` to `to`. */
function suggestionOf(lines: readonly string[], from: number, to: number): string | null {
  const start = lines.findIndex((line, i) => i >= from && i < to && /^ {0,3}(`{3,}|~{3,})\s*diff\s*$/.test(line));
  if (start < 0) return null;
  const fence = FENCE.exec(lines[start]!)![1]!;
  const end = lines.findIndex((line, i) => i > start && line.trim().startsWith(fence) && !line.trim().slice(fence.length).trim());
  return lines.slice(start + 1, end < 0 ? to : end).join("\n");
}

// Writing.

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** A verdict as it is written in a reply's heading. */
export function verdictText(verdict: Verdict): string {
  switch (verdict.kind) {
    case "approved":
      return `approved \`${verdict.revision}\``;
    case "requested changes":
      return `requested changes at \`${verdict.revision}\``;
    default:
      return verdict.kind;
  }
}

export interface NewReply {
  readonly author: string;
  /** As task comments write it: `2026-10-23 12:41+02:00`. */
  readonly date: string;
  readonly text: string;
  readonly verdict?: Verdict | null;
}

/**
 * A reply as one paragraph: line breaks within it are kept as Markdown
 * line breaks, blank lines are folded, so the reply stays one paragraph.
 */
export function replyText({ author, date, text, verdict }: NewReply): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim());
  const heading = `**${oneLine(author)} — ${date}${verdict ? ` — ${verdictText(verdict)}` : ""}:**`;
  return [lines.length ? `${heading} ${lines[0]!.trim()}` : heading, ...lines.slice(1)].join("\n");
}

interface Lines {
  readonly lines: string[];
  readonly newline: string;
}

const linesOf = (body: string): Lines => ({
  lines: body.split("\n").map((line) => line.replace(/\r$/, "")),
  newline: body.includes("\r\n") ? "\r\n" : "\n",
});

/** The body with `block` inserted before line `at`, set off from what is around it by blank lines. */
function insertBlock({ lines, newline }: Lines, at: number, block: string): string {
  let end = at;
  while (end > 0 && isBlank(lines[end - 1]!)) end--;
  let next = at;
  while (next < lines.length && isBlank(lines[next]!)) next++;
  const before = lines.slice(0, end);
  const after = lines.slice(next);
  const text = [...before, ...(before.length ? [""] : []), ...block.split("\n"), ...(after.length ? ["", ...after] : [])].join(newline);
  return after.length ? text : `${text}${newline}`;
}

/** Where a section starts and ends; -1 when the body has none. */
function section(lines: readonly string[], pattern: RegExp): { start: number; end: number } {
  const fenced = fencedLines(lines);
  const start = lines.findIndex((line, i) => !fenced[i] && pattern.test(line));
  if (start < 0) return { start, end: -1 };
  const next = lines.findIndex((line, i) => i > start && !fenced[i] && SECTION.test(line));
  return { start, end: next < 0 ? lines.length : next };
}

/** The body with a reply at the end of `## Discussion`, which is added at the end when there is none. */
export function addDiscussionReply(body: string, reply: NewReply): string {
  const text = linesOf(body);
  const { start, end } = section(text.lines, DISCUSSION);
  if (start < 0) return insertBlock(text, text.lines.length, `## Discussion\n\n${replyText(reply)}`);
  return insertBlock(text, end, replyText(reply));
}

/**
 * The body with a reply after the others of the topic or code range on
 * line `line`: before the topic's first code range, before the to-dos
 * that follow the replies.
 */
export function addReplyAt(body: string, line: number, reply: NewReply): string {
  const parsed = parsePullBody(body);
  const topic = parsed.topics.find((candidate) => candidate.line === line);
  const block = topic ?? parsed.topics.flatMap((candidate) => candidate.locations).find((location) => location.line === line);
  if (!block) throw new Error("That topic or code range is no longer in the pull request.");
  const end = topic ? (topic.locations[0]?.line ?? topic.end) : block.end;
  const last = block.replies.at(-1)?.line ?? block.line;
  const todo = block.todos.find((candidate) => candidate.line > last)?.line;
  return insertBlock(linesOf(body), todo ?? end, replyText(reply));
}

export interface NewLocation {
  /** `src/auth.ts#L42-L48@<commit>`. */
  readonly reference: string;
  /** The lines of a `diff` block, without its fences. */
  readonly suggestion?: string | null;
  readonly reply?: NewReply | null;
  readonly todo?: string | null;
}

function locationBlock(location: NewLocation): string {
  const parts = [`#### [[${location.reference}]]`];
  if (location.suggestion?.trim()) parts.push(["```diff", location.suggestion.replace(/\s+$/, ""), "```"].join("\n"));
  if (location.reply?.text.trim()) parts.push(replyText(location.reply));
  if (location.todo?.trim()) parts.push(`- [ ] ${oneLine(location.todo)}`);
  return parts.join("\n\n");
}

/**
 * The body with a new topic at the end of `## Review`, which is added
 * before `## Discussion`, or at the end, when there is none.
 */
export function addTopic(body: string, title: string, location: NewLocation | null, reply?: NewReply | null): string {
  const text = linesOf(body);
  const parts = [`### ${oneLine(title)}`];
  if (reply?.text.trim()) parts.push(replyText(reply));
  if (location) parts.push(locationBlock(location));
  const topic = parts.join("\n\n");
  const review = section(text.lines, REVIEW);
  if (review.start >= 0) return insertBlock(text, review.end, topic);
  const discussion = section(text.lines, DISCUSSION);
  const block = `## Review\n\n${topic}`;
  return insertBlock(text, discussion.start >= 0 ? discussion.start : text.lines.length, block);
}

/** The body with a code range added at the end of the topic on line `line`. */
export function addLocation(body: string, line: number, location: NewLocation): string {
  const topic = parsePullBody(body).topics.find((candidate) => candidate.line === line);
  if (!topic) throw new Error("That topic is no longer in the pull request.");
  return insertBlock(linesOf(body), topic.end, locationBlock(location));
}

/** Rewrites the to-do on line `line`, refusing when it is no longer there. */
function editTodo(body: string, line: number, edit: (todo: PullTodo) => string): string {
  const todo = parsePullBody(body).todos.find((candidate) => candidate.line === line);
  if (!todo) throw new Error("That to-do is no longer in the pull request.");
  const { lines, newline } = linesOf(body);
  const indent = /^\s*[-*+]\s+/.exec(lines[line]!)![0];
  lines[line] = `${indent}${edit(todo)}`;
  return lines.join(newline);
}

/** The body with the to-do on line `line` ticked or unticked. */
export const setTodo = (body: string, line: number, done: boolean): string =>
  editTodo(body, line, (todo) => `[${done ? "x" : " "}] ${todo.text}`);

/** Resolved: the change was made. */
export const resolveTodo = (body: string, line: number): string => setTodo(body, line, true);

/** Dismissed: not acted on, for `reason`. */
export const dismissTodo = (body: string, line: number, reason: string): string =>
  editTodo(body, line, (todo) => `[x] ~~${todo.text}~~ (dismissed: ${oneLine(reason)})`);

/** Promoted: turned into a task or a page, which `reference` names (`GENBEYA-70`, a page title). */
export const promoteTodo = (body: string, line: number, reference: string): string =>
  editTodo(body, line, (todo) => `[x] ${todo.text} → [[${reference}]]`);

/**
 * The topic on line `line` shortened to its outcome: its remarks, code
 * ranges and to-dos replaced by `outcome`, its verdicts kept. The full
 * discussion stays in Git.
 */
export function shortenTopic(body: string, line: number, outcome: string): string {
  const topic = parsePullBody(body).topics.find((candidate) => candidate.line === line);
  if (!topic) throw new Error("That topic is no longer in the pull request.");
  const { lines, newline } = linesOf(body);
  const verdicts = [...topic.replies, ...topic.locations.flatMap((location) => location.replies)].filter((reply) => reply.verdict);
  const paragraph = (start: number) => {
    let end = start + 1;
    while (end < topic.end && !isBlank(lines[end]!)) end++;
    return lines.slice(start, end).join("\n");
  };
  const block = [lines[topic.line]!, `**Outcome:** ${oneLine(outcome)}`, ...verdicts.map((reply) => paragraph(reply.line))].join("\n\n");
  const after = lines.slice(topic.end);
  return [...lines.slice(0, topic.line), ...block.split("\n"), ...(after.length ? ["", ...after] : [])].join(newline);
}

// Open items, approvals and readiness.

/** What is still open: unticked to-dos, and topics with no outcome whose to-dos aren't all done. */
export function openItems(parsed: PullBody): { todos: PullTodo[]; topics: PullTopic[] } {
  return {
    todos: parsed.todos.filter((todo) => !todo.done),
    topics: parsed.topics.filter((topic) => topic.outcome === null),
  };
}

export type ApprovalState = "effective" | "stale" | "unknown";

export interface ReviewerState {
  readonly person: string;
  /** The latest verdict that counts: an approval, a request for changes, or a withdrawal. */
  readonly reply: PullReply;
  /** For an approval: whether the change it approved is the change to merge. */
  readonly approval: ApprovalState | null;
}

export interface Approvals {
  readonly reviewers: readonly ReviewerState[];
  readonly effective: number;
  readonly stale: number;
  /** People whose request for changes is still open. */
  readonly changesRequested: readonly string[];
  /** Who was asked for a review and hasn't given a verdict yet. */
  readonly waitingFor: readonly string[];
}

const samePerson = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Which approvals still count. Each person's latest verdict counts: an
 * approval is effective while the change it approved (`changes` maps a
 * revision to its change ID) is `current`, the change to merge, and stale
 * once code changed; a request for changes stays open until that person
 * approves or withdraws. Requests for review only ask.
 */
export function approvalsOf(
  replies: readonly PullReply[],
  reviewers: readonly string[],
  changes: ReadonlyMap<string, string | null>,
  current: string | null,
): Approvals {
  const latest = new Map<string, PullReply>();
  for (const reply of replies)
    if (reply.verdict && reply.verdict.kind !== "requested review") latest.set(reply.author.trim().toLowerCase(), reply);
  const states = [...latest.values()].map((reply): ReviewerState => {
    if (reply.verdict!.kind !== "approved") return { person: reply.author, reply, approval: null };
    const change = changeOf(changes, reply.verdict!.revision);
    const approval: ApprovalState = change === undefined || current === null ? "unknown" : change === current ? "effective" : "stale";
    return { person: reply.author, reply, approval };
  });
  return {
    reviewers: states,
    effective: states.filter((state) => state.approval === "effective").length,
    stale: states.filter((state) => state.approval === "stale").length,
    changesRequested: states.filter((state) => state.reply.verdict!.kind === "requested changes").map((state) => state.person),
    waitingFor: reviewers.filter((reviewer) => !states.some((state) => samePerson(state.person, reviewer))),
  };
}

/** The change ID of `revision`, which may be abbreviated; undefined when it wasn't compared, null when it has none. */
function changeOf(changes: ReadonlyMap<string, string | null>, revision: string | null): string | null | undefined {
  if (!revision) return undefined;
  if (changes.has(revision)) return changes.get(revision);
  for (const [compared, change] of changes) if (compared.startsWith(revision) || revision.startsWith(compared)) return change;
  return undefined;
}

/** The revisions verdicts name, to compare with the change to merge. */
export const verdictRevisions = (replies: readonly PullReply[]): string[] => [
  ...new Set(replies.flatMap((reply) => (reply.verdict?.revision ? [reply.verdict.revision] : []))),
];

/** Task IDs the pull request names: in its source branch, its title and its body. */
export function taskIdsOf(pull: { readonly source: string; readonly title: string; readonly body: string }, prefix: string): string[] {
  const pattern = new RegExp(`\\b${prefix}-\\d+\\b`, "gi");
  const found = [pull.source, pull.title, pull.body].flatMap((text) => text.match(pattern) ?? []);
  return [...new Set(found.map((id) => id.toUpperCase()))];
}

export type GateState = "passed" | "failed" | "unknown";

/** One condition for merging, shown on its own: Genbeya advises, it can't enforce. */
export interface PullGate {
  readonly key: "approvals" | "changes" | "todos" | "conflicts" | "uncommitted";
  readonly state: GateState;
  readonly text: string;
}

export interface GateInput {
  readonly approvals: Approvals;
  /** How many approvals the project asks for. */
  readonly required: number;
  readonly openTodos: number;
  /** Whether merging conflicts; null when it can't be checked. */
  readonly conflicts: boolean | null;
  /** Changed files in the checkout, which merging here would meet; null when the checkout is on neither branch. */
  readonly uncommitted: number | null;
  readonly target: string;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** What stands between a pull request and its merge, condition by condition. */
export function gatesOf({ approvals, required, openTodos, conflicts, uncommitted, target }: GateInput): PullGate[] {
  const stale = approvals.stale ? ` (${approvals.stale} stale: code changed since)` : "";
  const gates: PullGate[] = [
    {
      key: "approvals",
      state: approvals.effective >= required ? "passed" : "failed",
      text: required ? `${approvals.effective} of ${plural(required, "approval")}${stale}` : `No approvals needed${stale}`,
    },
    approvals.changesRequested.length
      ? { key: "changes", state: "failed", text: `Changes requested by ${approvals.changesRequested.join(", ")}` }
      : { key: "changes", state: "passed", text: "No changes requested" },
    { key: "todos", state: openTodos ? "failed" : "passed", text: openTodos ? `${plural(openTodos, "open to-do")}` : "No open to-dos" },
    conflicts === null
      ? { key: "conflicts", state: "unknown", text: "Conflicts can't be checked (needs Git 2.38 or later, and both branches)" }
      : {
          key: "conflicts",
          state: conflicts ? "failed" : "passed",
          text: conflicts ? `Conflicts with ${target}` : `Merges into ${target} cleanly`,
        },
  ];
  if (uncommitted !== null)
    gates.push(
      uncommitted
        ? { key: "uncommitted", state: "failed", text: `${plural(uncommitted, "uncommitted change")} in the checkout` }
        : { key: "uncommitted", state: "passed", text: "No uncommitted changes" },
    );
  return gates;
}
