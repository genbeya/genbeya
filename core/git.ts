import type { Change, Commit, CommitFile, Head } from "../shared/api.js";
import type { Host } from "./host.js";

export class GitError extends Error {}

/** Runs git in one working tree with settings that keep app-issued commands predictable. */
export class Git {
  constructor(
    readonly host: Host,
    readonly cwd: string,
  ) {}

  private args(args: string[]) {
    return [
      "--literal-pathspecs",
      "-c", "core.quotepath=false",
      "-c", "color.ui=false",
      // App-issued commands never run repository hooks.
      "-c", "core.hooksPath=" + (this.host.posix ? "/dev/null" : "NUL"),
      ...args,
    ];
  }

  async buffer(args: string[], timeout?: number): Promise<Buffer> {
    const result = await this.host.run("git", this.args(args), { cwd: this.cwd, timeout });
    if (result.code !== 0)
      throw new GitError(
        result.stderr.replace(/^(fatal|error): /gm, "").trim() ||
          `git ${args[0]} failed with exit code ${result.code}.`,
      );
    return result.stdout;
  }

  async text(args: string[], timeout?: number) {
    return (await this.buffer(args, timeout)).toString("utf8");
  }

  /** Like {@link text}, but resolves to null instead of throwing. */
  async try(args: string[]) {
    const result = await this.host.run("git", this.args(args), { cwd: this.cwd });
    return result.code === 0 ? result.stdout.toString("utf8") : null;
  }

  async lines(args: string[]) {
    return (await this.text(args)).split("\n").filter(Boolean);
  }

  /** Paths of all tracked and untracked, not ignored, files that exist. */
  async files() {
    const [listed, deleted] = await Promise.all([
      this.text(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]),
      this.text(["ls-files", "-z", "--deleted"]),
    ]);
    const gone = new Set(deleted.split("\0"));
    return [...new Set(listed.split("\0"))].filter((p) => p && !gone.has(p));
  }

  /** Branch state and changes from a single `git status` call. */
  async status() {
    return parseStatusV2(
      await this.text(["status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"]),
    );
  }
}

export function parseStatusV2(output: string): { head: Head; changes: Change[] } {
  const head: Head = { branch: null, commit: null, upstream: null, ahead: 0, behind: 0 };
  const changes: Change[] = [];
  const records = output.split("\0");
  const letter = (c: string) => (c === "." ? " " : c);
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.startsWith("# ")) {
      const [, key, ...rest] = record.split(" ");
      const value = rest.join(" ");
      if (key === "branch.oid" && value !== "(initial)") head.commit = value.slice(0, 7);
      else if (key === "branch.head" && value !== "(detached)") head.branch = value;
      else if (key === "branch.upstream") head.upstream = value;
      else if (key === "branch.ab") {
        const [ahead, behind] = rest;
        head.ahead = Number(ahead);
        head.behind = -Number(behind);
      }
    } else if (record.startsWith("1 ") || record.startsWith("u ")) {
      const fields = record.split(" ");
      const xy = fields[1];
      const path = fields.slice(record[0] === "1" ? 8 : 10).join(" ");
      changes.push({ path, index: letter(xy[0]), worktree: letter(xy[1]) });
    } else if (record.startsWith("2 ")) {
      const fields = record.split(" ");
      const xy = fields[1];
      changes.push({
        path: fields.slice(9).join(" "),
        oldPath: records[++i],
        index: letter(xy[0]),
        worktree: letter(xy[1]),
      });
    } else if (record.startsWith("? ")) {
      changes.push({ path: record.slice(2), index: "?", worktree: "?" });
    }
  }
  return { head, changes };
}

export const LOG_FORMAT = "%H%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%D%x00";

export function parseLog(output: string): Commit[] {
  const parts = output.split("\0");
  const commits: Commit[] = [];
  for (let i = 0; i + 6 < parts.length; i += 7) {
    const hash = parts[i].trim();
    if (!hash) continue;
    commits.push({
      hash,
      parents: parts[i + 1].split(" ").filter(Boolean),
      author: parts[i + 2],
      email: parts[i + 3],
      date: parts[i + 4],
      subject: parts[i + 5],
      refs: parts[i + 6].split(", ").filter(Boolean),
    });
  }
  return commits;
}

/** Parses `--name-status -z` output; renames report the new path. */
export function parseNameStatus(output: string): CommitFile[] {
  const fields = output.split("\0").filter(Boolean);
  const files: CommitFile[] = [];
  for (let i = 0; i < fields.length; i++) {
    const status = fields[i][0];
    const oldPath = status === "R" || status === "C" ? fields[++i] : undefined;
    files.push({ status, path: fields[++i], ...(oldPath ? { oldPath } : {}) });
  }
  return files;
}

export const isCommitId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{40,64}$/.test(value);
