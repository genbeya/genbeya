/** Runs git in one working tree with settings that keep app-issued commands predictable. */
import type { Change, Head } from "../../contracts/model";
import { decodeLenient } from "../../utilities/bytes";
import type { Host } from "../hosts/host";
import { parseStatus } from "./git-parsers";

export class GitError extends Error {}

export class Git {
  constructor(
    readonly host: Host,
    readonly cwd: string,
  ) {}

  private args(args: readonly string[]): string[] {
    return [
      // Paths are never globs.
      "--literal-pathspecs",
      "-c",
      "core.quotepath=false",
      "-c",
      "color.ui=false",
      // App-issued commands never run repository hooks.
      "-c",
      `core.hooksPath=${this.host.paths.separator === "/" ? "/dev/null" : "NUL"}`,
      ...args,
    ];
  }

  async bytes(args: readonly string[], timeout?: number): Promise<Uint8Array> {
    const result = await this.host.run("git", this.args(args), { cwd: this.cwd, ...(timeout ? { timeout } : {}) });
    if (result.code !== 0)
      throw new GitError(result.stderr.replace(/^(fatal|error): /gm, "").trim() || `git ${args[0]} failed with exit code ${result.code}.`);
    return result.stdout;
  }

  async text(args: readonly string[], timeout?: number): Promise<string> {
    return decodeLenient(await this.bytes(args, timeout));
  }

  /** Like {@link text}, but null instead of an error. */
  async attempt(args: readonly string[]): Promise<string | null> {
    const result = await this.host.run("git", this.args(args), { cwd: this.cwd });
    return result.code === 0 ? decodeLenient(result.stdout) : null;
  }

  async lines(args: readonly string[]): Promise<string[]> {
    return (await this.text(args)).split("\n").filter(Boolean);
  }

  /** Tracked and untracked files that exist and are not ignored. */
  async files(): Promise<string[]> {
    const [listed, deleted] = await Promise.all([
      this.text(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]),
      this.text(["ls-files", "-z", "--deleted"]),
    ]);
    const gone = new Set(deleted.split("\0"));
    return [...new Set(listed.split("\0"))].filter((path) => path && !gone.has(path));
  }

  /** Branch state and changes from one `git status` call. */
  async status(): Promise<{ head: Head; changes: Change[] }> {
    return parseStatus(await this.text(["status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"]));
  }

  async config(key: string): Promise<string | null> {
    return (await this.attempt(["config", "--get", key]))?.trim() || null;
  }

  async hasRef(ref: string): Promise<boolean> {
    return (await this.attempt(["rev-parse", "--verify", "--quiet", ref])) !== null;
  }
}
