/** Parsers for git's machine-readable output formats. */
import type { Change, Commit, CommitFile, ConflictKind, Head, Stash } from "../../contracts/model";

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
