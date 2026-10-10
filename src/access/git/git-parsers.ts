/** Parsers for git's machine-readable output formats. */
import type { Change, Commit, CommitFile, ConflictKind, Head, Operation, RebaseCommit, Stash } from "../../contracts/model";

/** Files of the git directory that tell which operation is in progress, and how far it got. */
export const OPERATION_FILES = [
  "MERGE_HEAD",
  "MERGE_MSG",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "rebase-merge/head-name",
  "rebase-merge/onto",
  "rebase-merge/msgnum",
  "rebase-merge/end",
  "rebase-apply/head-name",
  "rebase-apply/onto",
  "rebase-apply/next",
  "rebase-apply/last",
] as const;

export type OperationFiles = Partial<Record<(typeof OPERATION_FILES)[number], string>>;

/**
 * The operation in progress, from the {@link OPERATION_FILES} that exist; null
 * when there is none. `branch` is the checked-out branch, which merges, picks
 * and reverts go into; a rebase names the commit it goes onto.
 */
export function parseOperation(files: OperationFiles, branch: string | null): Operation | null {
  const firstLine = (text?: string) => text?.split("\n")[0]!.trim() ?? "";
  const number = (text?: string) => (text?.trim() ? Number(text.trim()) : null);
  const progress = { step: null, steps: null };
  for (const backend of ["rebase-merge", "rebase-apply"] as const) {
    const head = files[`${backend}/head-name`];
    if (head === undefined) continue;
    const merge = backend === "rebase-merge";
    return {
      kind: "rebase",
      source: firstLine(head).replace(/^refs\/heads\//, ""),
      target: firstLine(files[`${backend}/onto`]) || null,
      step: number(merge ? files["rebase-merge/msgnum"] : files["rebase-apply/next"]),
      steps: number(merge ? files["rebase-merge/end"] : files["rebase-apply/last"]),
    };
  }
  const message = firstLine(files.MERGE_MSG);
  if (files.MERGE_HEAD !== undefined) {
    const named = /^Merge (?:remote-tracking branch|branch|tag|commit) '([^']+)'/.exec(message);
    return { kind: "merge", source: named?.[1] ?? firstLine(files.MERGE_HEAD).slice(0, 7), target: branch, ...progress };
  }
  if (files.CHERRY_PICK_HEAD !== undefined) return { kind: "cherry-pick", source: message, target: branch, ...progress };
  if (files.REVERT_HEAD !== undefined)
    return { kind: "revert", source: /^Revert "(.*)"$/.exec(message)?.[1] ?? message, target: branch, ...progress };
  return null;
}

/** The XY letters of an unmerged entry in `git status`. */
const CONFLICTS: Readonly<Record<string, ConflictKind>> = {
  UU: "both-modified",
  AA: "both-added",
  DD: "both-deleted",
  AU: "added-by-us",
  UA: "added-by-them",
  DU: "deleted-by-us",
  UD: "deleted-by-them",
};

/** `git status --porcelain=v2 --branch -z` → branch state and changes. */
export function parseStatus(output: string): { head: Head; changes: Change[] } {
  let head: Head = { branch: null, commit: null, upstream: null, ahead: 0, behind: 0 };
  const changes: Change[] = [];
  const records = output.split("\0");
  const letter = (c: string) => (c === "." ? " " : c);
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (record.startsWith("# ")) {
      const [, key, ...rest] = record.split(" ");
      const value = rest.join(" ");
      if (key === "branch.oid" && value !== "(initial)") head = { ...head, commit: value.slice(0, 7) };
      else if (key === "branch.head" && value !== "(detached)") head = { ...head, branch: value };
      else if (key === "branch.upstream") head = { ...head, upstream: value };
      else if (key === "branch.ab") head = { ...head, ahead: Number(rest[0]), behind: -Number(rest[1]) };
    } else if (record.startsWith("1 ")) {
      const fields = record.split(" ");
      const xy = fields[1]!;
      changes.push({ path: fields.slice(8).join(" "), index: letter(xy[0]!), worktree: letter(xy[1]!) });
    } else if (record.startsWith("u ")) {
      const fields = record.split(" ");
      const xy = fields[1]!;
      const conflict = CONFLICTS[xy];
      changes.push({ path: fields.slice(10).join(" "), index: xy[0]!, worktree: xy[1]!, ...(conflict ? { conflict } : {}) });
    } else if (record.startsWith("2 ")) {
      const fields = record.split(" ");
      const xy = fields[1]!;
      changes.push({ path: fields.slice(9).join(" "), oldPath: records[++i]!, index: letter(xy[0]!), worktree: letter(xy[1]!) });
    } else if (record.startsWith("? ")) {
      changes.push({ path: record.slice(2), index: "?", worktree: "?" });
    }
  }
  return { head, changes };
}

/** Hash, parents, author, email, date, subject, refs; NUL-separated. */
export const LOG_FORMAT = "%H%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%D%x00";
const LOG_FIELDS = 7;

export function parseLog(output: string): Commit[] {
  const parts = output.split("\0");
  const commits: Commit[] = [];
  for (let i = 0; i + LOG_FIELDS - 1 < parts.length; i += LOG_FIELDS) {
    const hash = parts[i]!.trim();
    if (!hash) continue;
    commits.push({
      hash,
      parents: parts[i + 1]!.split(" ").filter(Boolean),
      author: parts[i + 2]!,
      email: parts[i + 3]!,
      date: parts[i + 4]!,
      subject: parts[i + 5]!,
      refs: parts[i + 6]!.split(", ").filter(Boolean),
    });
  }
  return commits;
}

/** Hash, parents, author, date and full message of commits to rebase; NUL-separated. */
export const REBASE_FORMAT = "%H%x00%P%x00%an%x00%aI%x00%B%x00";

export function parseRebaseCommits(output: string): RebaseCommit[] {
  const parts = output.split("\0");
  const commits: RebaseCommit[] = [];
  for (let i = 0; i + 4 < parts.length; i += 5) {
    const hash = parts[i]!.trim();
    if (!hash) continue;
    const message = parts[i + 4]!.trim();
    commits.push({
      hash,
      subject: message.split("\n")[0]!,
      message,
      author: parts[i + 2]!,
      date: parts[i + 3]!,
      merge: parts[i + 1]!.split(" ").filter(Boolean).length > 1,
    });
  }
  return commits;
}

/** Hash, date and reflog subject of each stash, one per line. */
export const STASH_FORMAT = "%H%x00%cI%x00%gs";

/** `git stash list` in STASH_FORMAT → stashes, newest first. */
export function parseStashes(output: string): Stash[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      const [hash = "", date = "", subject = ""] = line.split("\0");
      // "On main: message" or "WIP on main: 1234567 subject"; branch names cannot hold colons.
      const match = /^(?:WIP on|On) ([^:]+): ([\s\S]*)$/.exec(subject);
      const branch = match && match[1] !== "(no branch)" ? match[1]! : null;
      return { hash, index, date, branch, message: match ? match[2]! : subject };
    });
}

/** `--name-status -z` output; renames and copies report the new path and keep the old one. */
export function parseNameStatus(output: string): CommitFile[] {
  const fields = output.split("\0").filter(Boolean);
  const files: CommitFile[] = [];
  for (let i = 0; i < fields.length; i++) {
    const status = fields[i]![0]!;
    const oldPath = status === "R" || status === "C" ? fields[++i] : undefined;
    files.push({ status, path: fields[++i]!, ...(oldPath ? { oldPath } : {}) });
  }
  return files;
}

/** A commit that changed a file, with the file before and after it. */
export interface FileRevision {
  readonly hash: string;
  readonly author: string;
  readonly date: string;
  readonly subject: string;
  readonly path: string;
  /** The path before the commit; null when the commit added the file. */
  readonly oldPath: string | null;
  /** The file before and after, when the patch showed them: not for moves without edits, binary files or partial patches. */
  readonly before: string | null;
  readonly after: string | null;
}

/** Hash, author, date, subject; the leading NUL starts every commit's line. */
export const FILE_LOG_FORMAT = "%x00%H%x00%an%x00%aI%x00%s";

/** A C-quoted path as git writes names with special characters ("tasks/\303\251.md"). */
function unquotePath(text: string): string {
  if (!text.startsWith('"') || !text.endsWith('"')) return text;
  const escapes: Readonly<Record<string, number>> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 };
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  const body = text.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const character = body[i]!;
    if (character !== "\\") bytes.push(...encoder.encode(character));
    else if (/[0-7]{3}/.test(body.slice(i + 1, i + 4))) {
      bytes.push(parseInt(body.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      const escaped = body[++i] ?? "";
      bytes.push(escapes[escaped] ?? escaped.charCodeAt(0));
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/**
 * `git log --follow -p --format=FILE_LOG_FORMAT -- <path>`, newest first,
 * where `path` is the file's path at the newest commit. With `whole`, the
 * patches have context enough to hold the whole file, so both versions are
 * read from them. Commits without a patch (merges) are left out.
 */
export function parseFileLog(output: string, path: string, whole: boolean): FileRevision[] {
  const revisions: FileRevision[] = [];
  let current = path;
  let commit: string[] | null = null;
  let diff = { found: false, added: false, from: null as string | null, to: null as string | null, hunks: false };
  let before: string[] = [];
  let after: string[] = [];
  const finish = () => {
    if (!commit || !diff.found) return;
    const [, hash, author, date, subject] = commit;
    const newPath = diff.to ?? current;
    const oldPath = diff.added ? null : (diff.from ?? newPath);
    const shown = whole && diff.hunks;
    revisions.push({
      hash: hash!,
      author: author!,
      date: date!,
      subject: subject!,
      path: newPath,
      oldPath,
      before: shown && oldPath !== null ? `${before.join("\n")}\n` : null,
      after: shown ? `${after.join("\n")}\n` : null,
    });
    current = oldPath ?? newPath;
  };
  for (const line of output.replace(/\n$/, "").split("\n")) {
    if (line.startsWith("\0")) {
      finish();
      commit = line.split("\0");
      diff = { found: false, added: false, from: null, to: null, hunks: false };
      before = [];
      after = [];
    } else if (diff.hunks) {
      // Every line of a hunk starts with its kind; "\" notes a missing final newline.
      if (line.startsWith("@@") || line.startsWith("\\")) continue;
      const text = line.slice(1);
      if (line[0] !== "+") before.push(text);
      if (line[0] !== "-") after.push(text);
    } else if (line.startsWith("diff --git ")) diff.found = true;
    else if (line.startsWith("new file mode ")) diff.added = true;
    else if (line.startsWith("rename from ")) diff.from = unquotePath(line.slice(12));
    else if (line.startsWith("rename to ")) diff.to = unquotePath(line.slice(10));
    else if (line.startsWith("@@")) diff.hunks = true;
  }
  finish();
  return revisions;
}

/** `git worktree list --porcelain` → branch ref → path, leaving out stale (prunable) entries. */
export function parseWorktrees(output: string): Map<string, string> {
  const worktrees = new Map<string, string>();
  for (const block of output.split(/\n\n+/)) {
    const lines = block.split("\n");
    const path = lines.find((line) => line.startsWith("worktree "))?.slice(9);
    const branch = lines.find((line) => line.startsWith("branch "))?.slice(7);
    if (path && branch && !lines.some((line) => line.startsWith("prunable"))) worktrees.set(branch, path);
  }
  return worktrees;
}

/** `git remote -v` → fetch URLs by remote. */
export function parseRemotes(output: string): { name: string; url: string }[] {
  const remotes: { name: string; url: string }[] = [];
  for (const line of output.split("\n")) {
    const match = /^(\S+)\t(.+) \(fetch\)$/.exec(line);
    if (match) remotes.push({ name: match[1]!, url: match[2]! });
  }
  return remotes;
}

export const isCommitId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{40,64}$/.test(value);
